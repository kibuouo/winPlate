import tempfile
import unittest
import gzip
import json
import sys
from contextlib import closing
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from email.message import Message
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError, URLError

from winplate_local_api import main


class DatabaseTests(unittest.TestCase):
    def setUp(self):
        self.notification_sync_patch = patch.object(main, "sync_openai_desktop_notifications")
        self.notification_sync_patch.start()

    def tearDown(self):
        self.notification_sync_patch.stop()

    def test_cross_language_contract_schemas_are_versioned_and_closed(self):
        schemas = Path(__file__).resolve().parents[3] / "packages" / "shared-types" / "schemas"
        for name in ("notification", "status-module", "usage"):
            schema = json.loads((schemas / f"{name}.v1.schema.json").read_text(encoding="utf-8"))
            self.assertEqual(schema["properties"]["schemaVersion"]["const"], 1)
            self.assertIn("schemaVersion", schema["required"])
            self.assertFalse(schema["additionalProperties"])

    def test_database_path_uses_and_creates_explicit_data_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            data_directory = Path(directory) / "nested" / "winplate"

            database_path = main.resolve_database_path(
                environment={"WINPLATE_DATA_DIR": str(data_directory)}
            )

            self.assertEqual(database_path, data_directory / "winplate.db")
            self.assertTrue(data_directory.is_dir())

    def test_database_path_fallback_is_user_local_not_package_local(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            database_path = main.resolve_database_path(
                environment={}, home=home, platform="linux"
            )

            self.assertEqual(database_path, home / ".local" / "share" / "WinPlate" / "winplate.db")
            self.assertNotEqual(database_path.parent, Path(main.__file__).parent)

    def test_uvicorn_log_formats_include_timestamp(self):
        config = main.build_log_config()
        for formatter in config["formatters"].values():
            self.assertIn("%(asctime)s", formatter["fmt"])
            self.assertEqual(formatter["datefmt"], "%Y-%m-%d %H:%M:%S")

    def test_environment_setting_prefers_process_environment(self):
        with patch.dict(main.os.environ, {"QWEATHER_API_KEY": "process-key"}):
            self.assertEqual(main.environment_setting("QWEATHER_API_KEY"), "process-key")

    def test_environment_setting_treats_present_empty_process_value_as_authoritative(self):
        winreg = SimpleNamespace(
            HKEY_CURRENT_USER=object(),
            OpenKey=MagicMock(),
            QueryValueEx=MagicMock(),
        )
        with (
            patch.dict(main.os.environ, {"QWEATHER_API_KEY": ""}),
            patch.object(main.os, "name", "nt"),
            patch.dict(sys.modules, {"winreg": winreg}),
        ):
            self.assertEqual(
                main.environment_setting("QWEATHER_API_KEY", "default-key"),
                "",
            )
        winreg.OpenKey.assert_not_called()

    def test_environment_setting_reads_legacy_windows_value_only_when_absent(self):
        key = MagicMock()
        winreg = SimpleNamespace(
            HKEY_CURRENT_USER=object(),
            OpenKey=MagicMock(return_value=key),
            QueryValueEx=MagicMock(return_value=("legacy-key", 1)),
        )
        with (
            patch.dict(main.os.environ, {}, clear=True),
            patch.object(main.os, "name", "nt"),
            patch.dict(sys.modules, {"winreg": winreg}),
        ):
            self.assertEqual(main.environment_setting("QWEATHER_API_KEY"), "legacy-key")
        winreg.OpenKey.assert_called_once_with(winreg.HKEY_CURRENT_USER, "Environment")
        winreg.QueryValueEx.assert_called_once_with(key.__enter__.return_value, "QWEATHER_API_KEY")

    def test_environment_setting_uses_default_when_legacy_windows_read_fails(self):
        winreg = SimpleNamespace(
            HKEY_CURRENT_USER=object(),
            OpenKey=MagicMock(side_effect=FileNotFoundError),
            QueryValueEx=MagicMock(),
        )
        with (
            patch.dict(main.os.environ, {}, clear=True),
            patch.object(main.os, "name", "nt"),
            patch.dict(sys.modules, {"winreg": winreg}),
        ):
            self.assertEqual(
                main.environment_setting("QWEATHER_API_KEY", "default-key"),
                "default-key",
            )

    def test_environment_setting_prefers_registry_for_truncated_windows_private_key(self):
        registry_key = MagicMock()
        registry_key.__enter__.return_value = object()
        registry_key.__exit__.return_value = None
        fake_winreg = MagicMock()
        fake_winreg.HKEY_CURRENT_USER = object()
        fake_winreg.OpenKey.return_value = registry_key
        fake_winreg.QueryValueEx.return_value = (
            "-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----",
            1,
        )
        with (
            patch.object(main.os, "name", "nt"),
            patch.dict(main.os.environ, {"QWEATHER_PRIVATE_KEY": "-----BEGIN PRIVATE KEY-----"}, clear=False),
            patch.dict(sys.modules, {"winreg": fake_winreg}),
        ):
            self.assertEqual(
                main.environment_setting("QWEATHER_PRIVATE_KEY"),
                "-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----",
            )

    def test_github_token_prefers_process_environment(self):
        with patch.dict(main.os.environ, {"GITHUB_TOKEN": "process-token"}):
            self.assertEqual(main.github_token(), "process-token")

    def test_github_username_is_read_dynamically_and_validated(self):
        with patch.dict(main.os.environ, {"WINPLATE_GITHUB_USERNAME": "octocat"}):
            self.assertEqual(main.github_username(), "octocat")
        with patch.dict(main.os.environ, {"WINPLATE_GITHUB_USERNAME": "invalid username"}):
            self.assertEqual(main.github_username(), main.DEFAULT_GITHUB_USERNAME)

    def test_module_registry_exposes_stable_backend_boundaries(self):
        payload = main.modules()
        module_ids = [item["id"] for item in payload["modules"]]
        self.assertEqual(
            module_ids,
            ["github", "codex", "notifications", "mail", "weather", "heart", "network"],
        )

    def test_default_status_is_persisted(self):
        original_path = main.DATABASE_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DATABASE_PATH = Path(directory) / "test.db"
            main.initialize_database()
            with (
                patch.object(main, "github_status", return_value={"source": "github"}),
                patch.object(main, "environment_setting", return_value=None),
            ):
                self.assertEqual(
                    main.status(),
                    {**main.DEFAULT_STATUS, "github": {"source": "github"}},
                )
        main.DATABASE_PATH = original_path

    def test_build_github_status_maps_profile_repository_and_contributions(self):
        now = datetime(2026, 6, 12, tzinfo=timezone.utc)
        class FixedDateTime(datetime):
            @classmethod
            def now(cls, tz=None):
                return now

        today = now.date().isoformat()
        yesterday = (now.date() - timedelta(days=1)).isoformat()
        responses = {
            "/users/octocat": {
                "login": "octocat",
                "name": "The Octocat",
                "html_url": "https://github.com/octocat",
                "avatar_url": "avatar",
                "public_repos": 8,
                "followers": 42,
            },
            "/users/octocat/repos?sort=pushed&direction=desc&per_page=100": [
                {"name": "hello-world", "language": "Python", "stargazers_count": 9, "pushed_at": "2026-06-12T00:00:00Z"}
            ],
        }
        with (
            patch.object(main, "github_request", side_effect=lambda path: responses[path]),
            patch.object(main, "github_contribution_days", return_value={yesterday: 2, today: 3}),
            patch.object(main, "datetime", FixedDateTime),
        ):
            result = main.build_github_status("octocat")
        self.assertEqual(result["username"], "@octocat")
        self.assertEqual(result["project"], "hello-world")
        self.assertEqual(result["repos"], 8)
        self.assertEqual(result["source"], "github")
        self.assertEqual(len(result["contributionMonths"]), 12)
        self.assertEqual(result["contributionMonths"][-1]["commits"], 5)
        self.assertEqual(result["commitsThisMonth"], 5)
        self.assertEqual(result["streakDays"], 2)

    def test_build_github_status_keeps_live_profile_when_contributions_temporarily_fail(self):
        responses = {
            "/users/octocat": {
                "login": "octocat",
                "name": "The Octocat",
                "html_url": "https://github.com/octocat",
                "avatar_url": "avatar",
                "public_repos": 8,
                "followers": 42,
            },
            "/users/octocat/repos?sort=pushed&direction=desc&per_page=100": [
                {"name": "hello-world", "language": "Python", "stargazers_count": 9, "pushed_at": "2026-06-12T00:00:00Z"}
            ],
        }
        cached_summary = {
            "source": "github",
            "username": "@octocat",
            "commitsThisMonth": 13,
            "streakDays": 4,
            "contributions30d": [1] * 30,
            "contributionMonth": "June",
            "contributionMonths": [{"key": "2026-06", "label": "June 2026", "commits": 13, "counts": [1] * 30, "levels": [1] * 30}],
        }
        with (
            patch.object(main, "github_request", side_effect=lambda path: responses[path]),
            patch.object(main, "github_contribution_days", side_effect=RuntimeError("slow: GitHub unavailable")),
            patch.object(main, "cached_github_status", return_value=cached_summary),
        ):
            result = main.build_github_status("octocat")
        self.assertEqual(result["source"], "github")
        self.assertEqual(result["status"], "Live")
        self.assertEqual(result["project"], "hello-world")
        self.assertEqual(result["commitsThisMonth"], 13)
        self.assertEqual(result["streakDays"], 4)
        self.assertEqual(result["contributionMonths"], cached_summary["contributionMonths"])
        self.assertIn("最近一次成功同步的数据", result["stateMessage"])

    def test_github_contribution_days_public_page_fallback_parses_counts(self):
        html = """
        <td data-date="2026-06-15" class="ContributionCalendar-day"></td>
        <tool-tip>2 contributions on June 15th.</tool-tip>
        <td data-date="2026-06-16" class="ContributionCalendar-day"></td>
        <tool-tip>No contributions on June 16th.</tool-tip>
        <td data-date="2026-06-17" class="ContributionCalendar-day"></td>
        <tool-tip>1 contribution on June 17th.</tool-tip>
        """
        now = datetime(2026, 6, 17, tzinfo=timezone.utc)
        with (
            patch.object(main, "github_token", return_value=None),
            patch.object(main, "github_public_page", return_value=html),
        ):
            result = main.github_contribution_days("octocat", now)
        self.assertEqual(
            result,
            {
                "2026-06-15": 2,
                "2026-06-16": 0,
                "2026-06-17": 1,
            },
        )

    def test_github_status_persists_and_restores_last_known_good_data(self):
        original_path = main.DATABASE_PATH
        original_cache = main._github_cache
        with tempfile.TemporaryDirectory() as directory:
            main.DATABASE_PATH = Path(directory) / "test.db"
            main._github_cache = None
            main.initialize_database()
            live = {
                "source": "github",
                "name": "The Octocat",
                "username": "@kibuouo",
                "profileUrl": "https://github.com/kibuouo",
                "repos": 8,
                "updatedAt": 123,
            }
            with patch.object(main, "build_github_status", return_value=live):
                self.assertEqual(main.github_status(force=True), live)
            main._github_cache = None
            with patch.object(
                main,
                "build_github_status",
                side_effect=RuntimeError("rate-limit: GitHub API rate limit reached"),
            ):
                cached = main.github_status(force=True)
            self.assertEqual(cached["source"], "github-cache")
            self.assertEqual(cached["repos"], 8)
            self.assertEqual(cached["availability"], "rate-limit")
            self.assertEqual(cached["status"], "Cached")
        main.DATABASE_PATH = original_path
        main._github_cache = original_cache

    def test_github_status_returns_lightweight_unavailable_state_without_cache(self):
        original_path = main.DATABASE_PATH
        original_cache = main._github_cache
        with tempfile.TemporaryDirectory() as directory:
            main.DATABASE_PATH = Path(directory) / "test.db"
            main._github_cache = None
            main.initialize_database()
            with patch.object(
                main,
                "build_github_status",
                side_effect=RuntimeError("auth: GitHub authentication was rejected"),
            ):
                result = main.github_status(force=True)
            self.assertEqual(result["source"], "unavailable")
            self.assertEqual(result["availability"], "auth")
            self.assertEqual(result["status"], "Unavailable")
            self.assertIn("没有可回退的缓存数据", result["stateMessage"])
        main.DATABASE_PATH = original_path
        main._github_cache = original_cache

    def test_build_weather_status_maps_qweather_response(self):
        responses = [
            {"code": "200", "location": [{"id": "101320101", "name": "香港", "adm1": "香港"}]},
            {"code": "200", "updateTime": "2026-06-13T12:00+08:00", "now": {
                "obsTime": "2026-06-13T11:55+08:00", "temp": "30", "feelsLike": "35",
                "icon": "305", "text": "小雨", "humidity": "81", "precip": "0.3",
                "pressure": "1005", "vis": "12", "windDir": "东南风", "windScale": "3",
            }},
            {"code": "200", "hourly": [{"fxTime": "2026-06-13T12:00+08:00", "pop": "75"}]},
            {"code": "200", "daily": [
                {"fxDate": "2026-06-13", "iconDay": "305", "textDay": "阵雨", "textNight": "多云", "tempMax": "31", "tempMin": "27", "precip": "2"},
                {"fxDate": "2026-06-14", "iconDay": "101", "textDay": "多云", "textNight": "晴", "tempMax": "32", "tempMin": "28", "precip": "0"},
                {"fxDate": "2026-06-15", "iconDay": "104", "textDay": "阴", "textNight": "多云", "tempMax": "31", "tempMin": "27", "precip": "1"},
                {"fxDate": "2026-06-16", "iconDay": "302", "textDay": "雷阵雨", "textNight": "阵雨", "tempMax": "30", "tempMin": "26", "precip": "6"},
                {"fxDate": "2026-06-17", "iconDay": "100", "textDay": "晴", "textNight": "晴", "tempMax": "33", "tempMin": "28", "precip": "0"},
                {"fxDate": "2026-06-18", "iconDay": "101", "textDay": "多云", "textNight": "晴", "tempMax": "34", "tempMin": "29", "precip": "0"},
            ]},
        ]
        with patch.object(main, "qweather_request", side_effect=responses):
            result = main.build_weather_status("Hong Kong")
        self.assertEqual(result["source"], "qweather")
        self.assertEqual(result["temperature"], 30)
        self.assertEqual(result["icon"], "305")
        self.assertEqual(result["location"], "香港")
        self.assertEqual(result["precipitationProbability"], 75)
        self.assertEqual(result["weatherSummary"], "今天白天阵雨，夜晚多云，现在30°，体感35°，会更闷热一些，东南风3级，出门记得带伞。")
        self.assertEqual(result["precipitation"], 0.3)
        self.assertEqual(result["pressure"], 1005)
        self.assertEqual(result["visibility"], 12)
        self.assertEqual(result["forecast"][0]["tempMax"], 31)
        self.assertEqual(result["forecast"][1]["condition"], "多云")
        self.assertEqual(len(result["forecast"]), 5)
        self.assertEqual(result["forecast"][-1]["date"], "2026-06-17")

    def test_weather_status_without_location_is_unconfigured(self):
        with (
            patch.object(main, "QWEATHER_LOCATION", ""),
            patch.object(main, "build_weather_status") as build_weather_status,
        ):
            result = main.weather_status()
        self.assertEqual(result["source"], "unconfigured")
        self.assertEqual(result["location"], "")
        self.assertEqual(result["condition"], "请配置天气位置")
        build_weather_status.assert_not_called()

    def test_status_does_not_reuse_stale_location_when_fallback_is_empty(self):
        original_path = main.DATABASE_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DATABASE_PATH = Path(directory) / "test.db"
            main.initialize_database()
            with closing(main.connect()) as connection:
                connection.execute(
                    "UPDATE status_modules SET payload = ? WHERE module = 'weather'",
                    (json.dumps({"source": "mock", "location": "Hong Kong", "temperature": 29}),),
                )
                connection.commit()
            with (
                patch.object(main, "QWEATHER_LOCATION", ""),
                patch.object(main, "github_status", return_value={"source": "github"}),
                patch.object(main, "environment_setting", return_value="configured-key"),
            ):
                result = main.status()
        main.DATABASE_PATH = original_path
        self.assertEqual(result["weather"]["source"], "unconfigured")
        self.assertEqual(result["weather"]["location"], "")

    def test_status_uses_stored_weather_location_without_env_fallback(self):
        original_path = main.DATABASE_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DATABASE_PATH = Path(directory) / "test.db"
            main.initialize_database()
            main.persist_weather_location(30.5928, 114.3055, "武汉")
            with (
                patch.object(main, "QWEATHER_LOCATION", ""),
                patch.object(main, "github_status", return_value={"source": "github"}),
                patch.object(main, "environment_setting", return_value="configured-key"),
                patch.object(main, "weather_status", return_value={"source": "qweather", "location": "武汉"}) as weather_status,
            ):
                result = main.status()
        main.DATABASE_PATH = original_path
        self.assertEqual(result["weather"], {"source": "qweather", "location": "武汉"})
        weather_status.assert_called_once_with(
            "114.31,30.59",
            display_location="武汉",
            location_source="system",
        )

    def test_refresh_weather_uses_longitude_latitude_order(self):
        with (
            patch.object(main, "weather_status", return_value={"source": "qweather", "location": "香港"}) as weather_status,
            patch.object(main, "persist_weather_location") as persist_weather_location,
        ):
            result = main.refresh_weather(main.WeatherLocation(latitude=22.3193, longitude=114.1694))
        self.assertEqual(result, {"source": "qweather", "location": "香港"})
        weather_status.assert_called_once_with("114.17,22.32", force=True, location_source="system")
        persist_weather_location.assert_called_once()

    def test_refresh_weather_persists_system_source_and_two_decimal_query(self):
        original_path = main.DATABASE_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DATABASE_PATH = Path(directory) / "test.db"
            main.initialize_database()
            data = {
                "source": "qweather",
                "location": "广州, 广东省",
                "locationId": "101280101",
                "resolvedLocation": {"name": "广州", "adm1": "广东省"},
            }
            with patch.object(main, "weather_status", return_value=data):
                main.refresh_weather(main.WeatherLocation(latitude=23.1291, longitude=113.2644))
            stored = main.read_weather_location()
        main.DATABASE_PATH = original_path
        self.assertEqual(stored["source"], "system")
        self.assertEqual(stored["query"], "113.26,23.13")
        self.assertEqual(stored["locationId"], "101280101")
        self.assertEqual(stored["displayLocation"], "广州, 广东省")

    def test_manual_weather_location_saves_location_id_and_status_uses_it(self):
        original_path = main.DATABASE_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DATABASE_PATH = Path(directory) / "test.db"
            main.initialize_database()
            with patch.object(main, "weather_status", return_value={"source": "qweather", "location": "广州, 广东省"}):
                main.set_manual_weather_location(main.ManualWeatherLocation(
                    locationId="101280101",
                    name="广州",
                    adm1="广东省",
                    latitude=23.13,
                    longitude=113.26,
                ))
            stored = main.read_weather_location()
            with (
                patch.object(main, "QWEATHER_LOCATION", ""),
                patch.object(main, "github_status", return_value={"source": "github"}),
                patch.object(main, "environment_setting", return_value="configured-key"),
                patch.object(main, "weather_status", return_value={"source": "qweather", "location": "广州"}) as weather_status,
            ):
                result = main.status()
        main.DATABASE_PATH = original_path
        self.assertEqual(stored["source"], "manual")
        self.assertEqual(stored["query"], "101280101")
        self.assertEqual(result["weather"]["location"], "广州")
        weather_status.assert_called_once_with(
            "101280101",
            display_location="广州, 广东省",
            location_source="manual",
        )

    def test_status_weather_failure_does_not_clear_stored_location(self):
        original_path = main.DATABASE_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DATABASE_PATH = Path(directory) / "test.db"
            main.initialize_database()
            main.persist_weather_location(
                23.13,
                113.26,
                "广州, 广东省",
                source="manual",
                query="101280101",
                location_id="101280101",
                name="广州",
                adm1="广东省",
            )
            with (
                patch.object(main, "QWEATHER_LOCATION", ""),
                patch.object(main, "github_status", return_value={"source": "github"}),
                patch.object(main, "environment_setting", return_value="configured-key"),
                patch.object(main, "weather_status", side_effect=RuntimeError("boom")),
            ):
                result = main.status()
            stored = main.read_weather_location()
        main.DATABASE_PATH = original_path
        self.assertEqual(result["weather"]["source"], "unavailable")
        self.assertEqual(stored["query"], "101280101")

    def test_build_weather_status_location_id_skips_city_lookup(self):
        calls = []

        def fake_qweather_request(path, params):
            calls.append((path, params))
            if path == "/v7/weather/now":
                return {"code": "200", "updateTime": "2026-06-13T12:00+08:00", "now": {
                    "obsTime": "2026-06-13T11:55+08:00", "temp": "30", "feelsLike": "35",
                    "icon": "305", "text": "小雨", "humidity": "81", "precip": "0.3",
                    "pressure": "1005", "vis": "12", "windDir": "东南风", "windScale": "3",
                }}
            if path == "/v7/weather/24h":
                return {"code": "200", "hourly": [{"pop": "75"}]}
            if path == "/v7/weather/7d":
                return {"code": "200", "daily": [
                    {"fxDate": "2026-06-13", "iconDay": "305", "textDay": "阵雨", "textNight": "多云", "tempMax": "31", "tempMin": "27", "precip": "2"},
                ]}
            raise AssertionError(f"Unexpected path: {path}")

        with patch.object(main, "qweather_request", side_effect=fake_qweather_request):
            result = main.build_weather_status("101280101", display_location="广州, 广东省")
        self.assertEqual(result["locationId"], "101280101")
        self.assertEqual(result["location"], "广州, 广东省")
        self.assertNotIn("/geo/v2/city/lookup", [path for path, _params in calls])

    def test_qweather_request_decompresses_gzip_response(self):
        payload = {"code": "200", "location": []}
        response = BytesIO(gzip.compress(json.dumps(payload).encode("utf-8")))
        headers = Message()
        headers["Content-Encoding"] = "gzip"
        response.headers = headers
        response.__enter__ = lambda value: value
        response.__exit__ = lambda *_args: None
        with (
            patch.object(main, "environment_setting", side_effect=lambda name, default=None: {
                "QWEATHER_API_KEY": "key",
                "QWEATHER_API_HOST": "example.com",
            }.get(name, default)),
            patch.object(main, "record_qweather_request"),
            patch.object(main, "urlopen", return_value=response),
        ):
            self.assertEqual(main.qweather_request("/test", {}), payload)

    def test_qweather_request_counts_success_and_network_failure(self):
        original_path = main.DATABASE_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DATABASE_PATH = Path(directory) / "test.db"
            main.initialize_database()
            response = BytesIO(b'{"code":"200"}')
            response.headers = Message()
            response.__enter__ = lambda value: value
            response.__exit__ = lambda *_args: None
            settings = lambda name, default=None: {
                "QWEATHER_API_KEY": "key",
                "QWEATHER_API_HOST": "example.com",
            }.get(name, default)
            with patch.object(main, "environment_setting", side_effect=settings):
                with patch.object(main, "urlopen", return_value=response):
                    main.qweather_request("/success", {})
                with patch.object(main, "urlopen", side_effect=URLError("offline")):
                    with self.assertRaises(RuntimeError):
                        main.qweather_request("/failure", {})
            self.assertEqual(main.qweather_usage()["used"], 2)
        main.DATABASE_PATH = original_path

    def test_qweather_usage_calculates_monthly_allowance(self):
        original_path = main.DATABASE_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DATABASE_PATH = Path(directory) / "test.db"
            main.initialize_database()
            for _ in range(200):
                main.record_qweather_request(datetime(2026, 6, 13))
            usage = main.qweather_usage(datetime(2026, 6, 13))
            self.assertEqual(usage, {
                "month": "2026-06",
                "used": 200,
                "total": 50000,
                "remaining": 49800,
                "percent": 0.4,
                "today": 200,
            })
            self.assertEqual(main.qweather_usage(datetime(2026, 6, 20))["today"], 0)
            self.assertEqual(main.qweather_usage(datetime(2026, 7, 1))["used"], 0)
        main.DATABASE_PATH = original_path

    def test_qweather_official_stats_requests_account_summary(self):
        payload = {
            "asOf": "2026-06-13T10:00:00Z",
            "data": [
                {"success": {"hours": [2, 3]}, "errors": {"hours": [1, 0]}},
                {"success": {"hours": [4]}, "errors": {"hours": [2]}},
            ],
        }
        response = BytesIO(json.dumps(payload).encode())
        response.__enter__ = lambda value: value
        response.__exit__ = lambda *_args: None
        settings = lambda name, default=None: {
            "QWEATHER_PROJECT_ID": "project",
            "QWEATHER_CREDENTIAL_ID": "credential",
            "QWEATHER_PRIVATE_KEY": "private-key",
            "QWEATHER_API_HOST": "example.com",
        }.get(name, default)
        with (
            patch.object(main, "environment_setting", side_effect=settings),
            patch.object(main.jwt, "encode", return_value="token"),
            patch.object(main, "record_qweather_request"),
            patch.object(main, "urlopen", return_value=response) as mock_urlopen,
        ):
            result = main.qweather_official_stats()
        request = mock_urlopen.call_args.args[0]
        self.assertEqual(request.full_url, "https://example.com/metrics/v1/stats")
        self.assertEqual(request.headers["Accept-encoding"], "gzip")
        self.assertEqual(result, {
            "total": 12,
            "success": 9,
            "errors": 3,
            "asOf": "2026-06-13T10:00:00Z",
        })

    def test_qweather_official_stats_decompresses_gzip_response(self):
        payload = {
            "asOf": "2026-06-13T10:00:00Z",
            "data": {"success": {"hours": [4]}, "errors": {"hours": [1]}},
        }

        class GzipResponse(BytesIO):
            headers = {"Content-Encoding": "gzip"}

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return None

        response = GzipResponse(gzip.compress(json.dumps(payload).encode()))
        settings = lambda name, default=None: {
            "QWEATHER_PROJECT_ID": "project",
            "QWEATHER_CREDENTIAL_ID": "credential",
            "QWEATHER_PRIVATE_KEY": "private-key",
            "QWEATHER_API_HOST": "example.com",
        }.get(name, default)
        with (
            patch.object(main, "environment_setting", side_effect=settings),
            patch.object(main.jwt, "encode", return_value="token"),
            patch.object(main, "record_qweather_request"),
            patch.object(main, "urlopen", return_value=response),
        ):
            result = main.qweather_official_stats()
        self.assertEqual(result["total"], 5)
        self.assertEqual(result["success"], 4)
        self.assertEqual(result["errors"], 1)

    def test_qweather_jwt_request_reports_invalid_private_key_format(self):
        settings = lambda name, default=None: {
            "QWEATHER_PROJECT_ID": "project",
            "QWEATHER_CREDENTIAL_ID": "credential",
            "QWEATHER_PRIVATE_KEY": "-----BEGIN PRIVATE KEY-----",
            "QWEATHER_API_HOST": "example.com",
        }.get(name, default)
        with (
            patch.object(main, "environment_setting", side_effect=settings),
            patch.object(main.jwt, "encode", side_effect=ValueError("MalformedFraming")),
        ):
            with self.assertRaisesRegex(RuntimeError, "QWeather 私钥格式无效"):
                main.qweather_jwt_request("/weatheralert/v1/current/22.32/114.17")

    def test_qweather_jwt_request_preserves_http_400_detail(self):
        settings = lambda name, default=None: {
            "QWEATHER_PROJECT_ID": "project",
            "QWEATHER_CREDENTIAL_ID": "credential",
            "QWEATHER_PRIVATE_KEY": "private-key",
            "QWEATHER_API_HOST": "example.com",
        }.get(name, default)
        error = HTTPError(
            "https://example.com/metrics/v1/stats?credential=credential",
            400,
            "Bad Request",
            {"Content-Encoding": ""},
            BytesIO(json.dumps({
                "error": {"detail": "credential traffic stats permission is disabled"},
            }).encode()),
        )
        self.addCleanup(error.close)
        with (
            patch.object(main, "environment_setting", side_effect=settings),
            patch.object(main.jwt, "encode", return_value="token"),
            patch.object(main, "record_qweather_request"),
            patch.object(main, "urlopen", side_effect=error),
        ):
            with self.assertRaisesRegex(
                RuntimeError,
                "credential traffic stats permission is disabled",
            ):
                main.qweather_jwt_request(
                    "/metrics/v1/stats",
                    {"credential": "credential"},
                )

    def test_github_contribution_detail_maps_repository_counts_for_a_day(self):
        payload = {
            "data": {"user": {"contributionsCollection": {
                "totalCommitContributions": 5,
                "commitContributionsByRepository": [
                    {"repository": {"nameWithOwner": "octocat/two", "url": "https://github.com/octocat/two"}, "contributions": {"totalCount": 2}},
                    {"repository": {"nameWithOwner": "octocat/one", "url": "https://github.com/octocat/one"}, "contributions": {"totalCount": 3}},
                ],
            }}}
        }
        with (
            patch.object(main, "github_token", return_value="token"),
            patch.object(main, "cached_github_status", return_value=None),
            patch.object(main, "github_graphql_request", return_value=payload) as request,
        ):
            result = main.github_contribution_detail("octocat", date_text="2026-07-11")

        self.assertEqual(result["rangeType"], "date")
        self.assertEqual(result["totalCount"], 5)
        self.assertEqual(result["repositoryCount"], 2)
        self.assertEqual(result["repositories"][0]["nameWithOwner"], "octocat/one")
        self.assertTrue(result["detailsAvailable"])
        variables = request.call_args.args[1]
        self.assertEqual(variables["from"], "2026-07-11T00:00:00Z")
        self.assertEqual(variables["to"], "2026-07-12T00:00:00Z")

    def test_github_contribution_detail_without_token_uses_cached_total_without_repository_guess(self):
        cached = {
            "username": "@octocat",
            "contributionMonths": [{
                "key": "2026-07", "label": "July 2026", "commits": 9,
                "counts": [0] * 10 + [5] + [0] * 20,
            }],
        }
        with (
            patch.object(main, "github_token", return_value=None),
            patch.object(main, "cached_github_status", return_value=cached),
        ):
            result = main.github_contribution_detail("octocat", date_text="2026-07-11")

        self.assertEqual(result["totalCount"], 5)
        self.assertEqual(result["repositories"], [])
        self.assertFalse(result["detailsAvailable"])
        self.assertIn("Token", result["message"])

    def test_named_metric_sum_supports_api_keyed_objects(self):
        payload = {
            "data": {
                "/v7/weather/now": {"success": {"hours": [5]}, "errors": {"hours": [1]}},
                "/v7/weather/3d": {"success": {"hours": [7]}, "errors": {"hours": [2]}},
            }
        }
        self.assertEqual(main._sum_named_metric(payload, "success"), 12)
        self.assertEqual(main._sum_named_metric(payload, "errors"), 3)

    def test_qweather_alerts_create_warning_notifications(self):
        original_path = main.DATABASE_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DATABASE_PATH = Path(directory) / "test.db"
            main.initialize_database()
            payload = {
                "alerts": [{
                    "id": "a1",
                    "headline": "大风蓝色预警",
                    "description": "预计未来24小时有大风。",
                    "severity": "moderate",
                    "issuedTime": "2026-06-17T12:00:00+08:00",
                }]
            }
            with patch.object(main, "qweather_jwt_request", return_value=payload) as request:
                result = main.qweather_alerts(22.3193, 114.1694)
            summary = main.notification_summary()
        main.DATABASE_PATH = original_path
        request.assert_called_once_with("/weatheralert/v1/current/22.32/114.17", None)
        self.assertEqual(result["alerts"][0]["title"], "大风蓝色预警")
        self.assertEqual(summary["latest"]["id"], "qweather:a1")
        self.assertEqual(summary["latest"]["level"], "warning")
        self.assertEqual(summary["latest"]["metadata"], {
            "severity": "moderate",
            "lifecycle": "issued",
            "riskDelta": "active",
        })

    def test_qweather_active_red_alert_persists_exact_acknowledgement_metadata(self):
        original_path = main.DATABASE_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DATABASE_PATH = Path(directory) / "test.db"
            main.initialize_database()
            payload = {"alerts": [{
                "id": "red-1",
                "headline": "暴雨红色预警",
                "description": "未来两小时有强降雨。",
                "severity": "red",
                "issuedTime": "2026-06-17T12:00:00+08:00",
            }]}
            with patch.object(main, "qweather_jwt_request", return_value=payload):
                result = main.qweather_alerts(22.3193, 114.1694)
            summary = main.notification_summary()
        main.DATABASE_PATH = original_path
        self.assertEqual(result["alerts"][0]["level"], "critical")
        self.assertEqual(summary["latest"]["metadata"], {
            "severity": "red",
            "lifecycle": "issued",
            "riskDelta": "active",
        })

    def test_qweather_alerts_use_stored_display_location_in_notifications(self):
        original_path = main.DATABASE_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DATABASE_PATH = Path(directory) / "test.db"
            main.initialize_database()
            main.persist_weather_location(22.3193, 114.1694, "香港")
            payload = {
                "alerts": [{
                    "id": "a1",
                    "headline": "天文台在6月18日上午1时30分发出雷暴警告",
                    "description": "预计有强烈狂风雷暴。",
                    "severity": "moderate",
                }]
            }
            with patch.object(main, "qweather_jwt_request", return_value=payload):
                result = main.qweather_alerts()
            summary = main.notification_summary()
        main.DATABASE_PATH = original_path
        self.assertEqual(result["alerts"][0]["title"], "香港：天文台在6月18日上午1时30分发出雷暴警告")
        self.assertEqual(summary["latest"]["title"], "香港：天文台在6月18日上午1时30分发出雷暴警告")

    def test_qweather_cancelled_alert_is_risk_reduction(self):
        original_path = main.DATABASE_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DATABASE_PATH = Path(directory) / "test.db"
            main.initialize_database()
            payload = {"alerts": [{
                "id": "a1",
                "headline": "暴雨红色预警",
                "description": "本轮降雨过程结束。",
                "severity": "extreme",
                "status": "cancelled",
            }]}
            with patch.object(main, "qweather_jwt_request", return_value=payload):
                result = main.qweather_alerts(22.3193, 114.1694)
            summary = main.notification_summary()
        main.DATABASE_PATH = original_path
        self.assertEqual(result["alerts"][0]["lifecycle"], "resolved")
        self.assertEqual(result["alerts"][0]["riskDelta"], "decreased")
        self.assertEqual(summary["latest"]["level"], "success")
        self.assertIn("风险降低", summary["latest"]["message"])
        self.assertEqual(summary["latest"]["metadata"], {
            "severity": "extreme",
            "lifecycle": "resolved",
            "riskDelta": "decreased",
        })

    def test_qweather_alert_detail_returns_single_alert_or_404_equivalent(self):
        with patch.object(main, "qweather_alerts", return_value={
            "source": "qweather",
            "alerts": [{
                "id": "a1",
                "title": "暴雨预警",
                "message": "未来两小时有强降雨。",
                "lifecycle": "issued",
                "severity": "red",
                "createdAt": 1780000000000,
            }],
            "updatedAt": 1780000000000,
        }):
            result = main.qweather_alert_detail("a1")
        self.assertEqual(result["id"], "a1")
        self.assertEqual(result["body"], "未来两小时有强降雨。")
        with (
            patch.object(main, "qweather_alerts", return_value={"source": "qweather", "alerts": [], "updatedAt": None}),
            self.assertRaises(RuntimeError),
        ):
            main.qweather_alert_detail("missing")

    def test_mail_query_uses_qq_imap_inbox_window(self):
        self.assertEqual(main.MAIL_QUERY, "IMAP INBOX SINCE 30 days")
        self.assertEqual(main.QQ_IMAP_HOST, "imap.qq.com")
        self.assertEqual(main.QQ_SMTP_HOST, "smtp.qq.com")

    def test_parse_imap_message_handles_encoded_headers_and_html_body(self):
        message = EmailMessage()
        message["Subject"] = "Launch"
        message["From"] = "Kiko <kiko@qq.com>"
        message["Date"] = "Thu, 18 Jun 2026 10:20:30 +0800"
        message.set_content("<p>Please <b>confirm</b> the launch checklist.</p>", subtype="html")
        result = main.parse_imap_message("m1", message.as_bytes(), [])
        self.assertEqual(result["uid"], "m1")
        self.assertEqual(result["messageId"], "m1")
        self.assertEqual(result["threadId"], "m1")
        self.assertEqual(result["sender"], "Kiko <kiko@qq.com>")
        self.assertEqual(result["subject"], "Launch")
        self.assertEqual(result["summary"], "Please confirm the launch checklist.")
        self.assertEqual(result["action"], "查看")
        self.assertIn("UNREAD", result["labels"])
        self.assertTrue(result["unread"])

    def test_message_body_parts_prefers_text_and_lists_attachments(self):
        message = EmailMessage()
        message["Subject"] = "Launch"
        message["From"] = "Kiko <kiko@qq.com>"
        message.set_content("Plain body")
        message.add_alternative("<p>HTML body</p><script>alert(1)</script>", subtype="html")
        message.add_attachment(b"hello", maintype="text", subtype="plain", filename="note.txt")
        parsed = main.message_from_bytes(message.as_bytes(), policy=main.policy.default)
        text_body, html_body, attachments = main.message_body_parts(parsed)
        self.assertEqual(text_body, "Plain body")
        self.assertIn("<p>HTML body</p>", html_body)
        self.assertEqual(attachments[0]["filename"], "note.txt")
        self.assertEqual(attachments[0]["size"], 5)

    def test_parse_imap_flags_detects_seen_mail(self):
        self.assertEqual(main.parse_imap_flags(b"1 (UID 1 FLAGS (\\Seen \\Flagged) RFC822 {1}"), ["\\Seen", "\\Flagged"])

    def test_parse_imap_fetch_payload_handles_split_flags(self):
        raw_message, flags = main.parse_imap_fetch_payload([
            (b"1975 (UID 2171 BODY[] {10}", b"hello"),
            b" FLAGS (\\Seen))",
        ])
        self.assertEqual(raw_message, b"hello")
        self.assertEqual(flags, ["\\Seen"])

    def test_mail_outline_returns_cached_payload_when_qq_refresh_fails(self):
        original_path = main.DATABASE_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DATABASE_PATH = Path(directory) / "test.db"
            main.initialize_database()
            main.persist_mail_outline([{
                "messageId": "m1",
                "threadId": "t1",
                "sender": "a@example.com",
                "subject": "Cached",
                "sentAt": 1780000000000,
                "snippet": "cached",
                "summary": "cached summary",
                "action": "查看",
                "labels": ["INBOX"],
            }])
            with (
                patch.object(main, "mail_configured", return_value=True),
                patch.object(main, "read_mail_outline_from_qq", side_effect=RuntimeError("offline")),
            ):
                result = main.mail_outline(force=True)
        main.DATABASE_PATH = original_path
        self.assertEqual(result["availability"], "cached")
        self.assertEqual(result["items"][0]["subject"], "Cached")
        self.assertEqual(result["error"], "offline")

    def test_mail_outline_uses_cache_without_force(self):
        original_path = main.DATABASE_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DATABASE_PATH = Path(directory) / "test.db"
            main.initialize_database()
            main.persist_mail_outline([{
                "messageId": "m1",
                "threadId": "t1",
                "sender": "a@example.com",
                "subject": "Cached",
                "sentAt": 1780000000000,
                "snippet": "cached",
                "summary": "cached summary",
                "action": "查看",
                "labels": ["INBOX"],
            }])
            with (
                patch.object(main, "mail_configured", return_value=True),
                patch.object(main, "read_mail_outline_from_qq") as read_mail_outline,
            ):
                result = main.mail_outline()
        main.DATABASE_PATH = original_path
        read_mail_outline.assert_not_called()
        self.assertEqual(result["availability"], "cached")
        self.assertEqual(result["items"][0]["subject"], "Cached")

    def test_push_notification_persists_unread_summary_and_mark_read(self):
        original_path = main.DATABASE_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DATABASE_PATH = Path(directory) / "test.db"
            main.initialize_database()
            created = main.push_notification(main.NotificationPayload(
                source="codex",
                level="success",
                title="Done",
                message="Task finished",
                id="codex:test",
            ))
            summary = main.notification_summary()
            self.assertEqual(created["id"], "codex:test")
            self.assertEqual(summary["unreadCount"], 1)
            self.assertEqual(summary["latest"]["title"], "Done")
            summary = main.mark_notification_read("codex:test")
            self.assertEqual(summary["unreadCount"], 0)
        main.DATABASE_PATH = original_path

    def test_persist_notification_digest_record_stores_time_and_content(self):
        original_path = main.DATABASE_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DATABASE_PATH = Path(directory) / "test.db"
            main.initialize_database()
            created = main.persist_notification_digest_record(main.NotificationDigestRecordPayload(
                source="deepseek",
                model="deepseek-v4-flash",
                title="开发任务已完成",
                summary="Codex 测试已通过。",
                content="开发任务已完成\nCodex 测试已通过。",
                severity="info",
                category="development",
                iconKey="check-circle",
                unreadCount=1,
                generatedAt=1780000000000,
                sourceIds=["codex:1"],
            ))
            records = main.notification_digest_records()
        main.DATABASE_PATH = original_path
        self.assertEqual(created["model"], "deepseek-v4-flash")
        self.assertEqual(created["generatedAt"], 1780000000000)
        self.assertTrue(created["generatedAtIso"].startswith("2026-"))
        self.assertEqual(created["content"], "开发任务已完成 Codex 测试已通过。")
        self.assertEqual(created["payload"]["sourceIds"], ["codex:1"])
        self.assertEqual(records["items"][0]["summary"], "Codex 测试已通过。")

    def test_clear_notifications_removes_all_items(self):
        original_path = main.DATABASE_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DATABASE_PATH = Path(directory) / "test.db"
            main.initialize_database()
            main.push_notification(main.NotificationPayload(
                source="codex",
                level="success",
                title="Done",
                message="Task finished",
                id="codex:test",
            ))
            summary = main.clear_notifications()
            self.assertEqual(summary["items"], [])
            self.assertIsNone(summary["latest"])
            self.assertEqual(summary["unreadCount"], 0)
        main.DATABASE_PATH = original_path

    def test_notification_summary_imports_openai_windows_toasts(self):
        self.notification_sync_patch.stop()
        original_path = main.DATABASE_PATH
        try:
            with tempfile.TemporaryDirectory() as directory:
                base = Path(directory)
                main.DATABASE_PATH = base / "test.db"
                main.initialize_database()
                notification_dir = base / "Microsoft" / "Windows" / "Notifications"
                notification_dir.mkdir(parents=True)
                windows_db = notification_dir / "wpndatabase.db"
                with closing(main.sqlite3.connect(windows_db)) as connection:
                    connection.execute(
                        "CREATE TABLE Notification (Id INTEGER, HandlerId INTEGER, Type TEXT, Payload BLOB, ArrivalTime INTEGER)"
                    )
                    connection.execute(
                        "CREATE TABLE NotificationHandler (RecordId INTEGER, PrimaryId TEXT)"
                    )
                    connection.execute(
                        "INSERT INTO NotificationHandler (RecordId, PrimaryId) VALUES (1, ?)",
                        ("OpenAI.Codex_2p2nqsd0c76g0!App",),
                    )
                    connection.execute(
                        "INSERT INTO Notification (Id, HandlerId, Type, Payload, ArrivalTime) VALUES (101, 1, 'toast', ?, ?)",
                        (
                            b'<toast><visual><binding><text>Codex task</text><text>Done cleanly</text></binding></visual></toast>',
                            (1780000000000 + main.WINDOWS_FILETIME_EPOCH_MS) * 10_000,
                        ),
                    )
                    connection.commit()
                with (
                    patch.dict(main.os.environ, {"LOCALAPPDATA": str(base)}),
                    patch.object(main.os, "name", "nt"),
                    patch.object(main, "windows_notification_database_path", return_value=windows_db),
                ):
                    summary = main.notification_summary()
                    self.assertEqual(summary["unreadCount"], 1)
                    self.assertEqual(summary["latest"]["source"], "codex")
                    self.assertEqual(summary["latest"]["title"], "Codex task")
                    main.clear_notifications()
                    self.assertEqual(main.notification_summary()["items"], [])
        finally:
            main.DATABASE_PATH = original_path
            self.notification_sync_patch.start()

    def test_mail_outline_syncs_new_mail_notifications(self):
        original_path = main.DATABASE_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DATABASE_PATH = Path(directory) / "test.db"
            main.initialize_database()
            with (
                patch.object(main, "mail_configured", return_value=True),
                patch.object(main, "read_mail_outline_from_qq", return_value=([{
                    "messageId": "m1",
                    "threadId": "t1",
                    "sender": "a@example.com",
                    "subject": "Launch",
                    "sentAt": 1780000000000,
                    "snippet": "hello",
                    "summary": "hello",
                    "action": "查看",
                    "labels": ["INBOX", "UNREAD"],
                    "unread": True,
                }], 1)),
            ):
                result = main.mail_outline(force=True)
            summary = main.notification_summary()
        main.DATABASE_PATH = original_path
        self.assertEqual(result["availability"], "live")
        self.assertEqual(summary["unreadCount"], 1)
        self.assertEqual(summary["latest"]["id"], "mail:m1")
        self.assertEqual(summary["latest"]["title"], "新邮件：Launch")

    def test_mail_outline_uses_server_read_state_across_refresh(self):
        original_path = main.DATABASE_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DATABASE_PATH = Path(directory) / "test.db"
            main.initialize_database()
            main.persist_mail_outline([{
                "messageId": "m1",
                "threadId": "t1",
                "sender": "a@example.com",
                "subject": "Launch",
                "sentAt": 1780000000000,
                "snippet": "hello",
                "summary": "hello",
                "action": "查看",
                "labels": ["INBOX", "UNREAD"],
                "unread": True,
            }])
            main.upsert_notification(
                notification_id="mail:m1",
                source="mail",
                title="新邮件：Launch",
                message="a@example.com",
                created_at=1780000000000,
                unread=True,
            )
            with (
                patch.object(main, "mail_configured", return_value=True),
                patch.object(main, "read_mail_outline_from_qq", return_value=([{
                    "messageId": "m1",
                    "threadId": "t1",
                    "sender": "a@example.com",
                    "subject": "Launch",
                    "sentAt": 1780000000000,
                    "snippet": "hello",
                    "summary": "hello",
                    "action": "归档参考",
                    "labels": ["INBOX"],
                    "unread": False,
                }], 0)),
            ):
                result = main.mail_outline(force=True)
            summary = main.notification_summary()
        main.DATABASE_PATH = original_path
        self.assertFalse(result["items"][0]["unread"])
        self.assertNotIn("UNREAD", result["items"][0]["labels"])
        self.assertEqual(summary["unreadCount"], 0)
        self.assertEqual(summary["items"], [])

    def test_clear_notifications_does_not_reimport_read_mail_items(self):
        original_path = main.DATABASE_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DATABASE_PATH = Path(directory) / "test.db"
            main.initialize_database()
            main.upsert_notification(
                notification_id="mail:m1",
                source="mail",
                title="新邮件：Launch",
                message="a@example.com",
                created_at=1780000000000,
                unread=True,
            )
            main.clear_notifications()
            with (
                patch.object(main, "mail_configured", return_value=True),
                patch.object(main, "read_mail_outline_from_qq", return_value=([{
                    "messageId": "m1",
                    "threadId": "t1",
                    "sender": "a@example.com",
                    "subject": "Launch",
                    "sentAt": 1780000000000,
                    "snippet": "hello",
                    "summary": "hello",
                    "action": "归档参考",
                    "labels": ["INBOX"],
                    "unread": False,
                }], 0)),
            ):
                main.mail_outline(force=True)
            summary = main.notification_summary()
        main.DATABASE_PATH = original_path
        self.assertEqual(summary["items"], [])
        self.assertEqual(summary["unreadCount"], 0)

    def test_mark_notification_read_syncs_mail_seen_flag_to_server(self):
        original_path = main.DATABASE_PATH
        class FakeImapConnection:
            def __init__(self):
                self.calls = []

            def select(self, mailbox, readonly=False):
                self.calls.append(("select", mailbox, readonly))
                return ("OK", [b"1"])

            def uid(self, command, uid, *args):
                self.calls.append(("uid", command, uid, *args))
                if command == "STORE":
                    return ("OK", [b"1"])
                raise AssertionError(f"Unexpected IMAP command: {command}")

            def logout(self):
                self.calls.append(("logout",))

        with tempfile.TemporaryDirectory() as directory:
            main.DATABASE_PATH = Path(directory) / "test.db"
            main.initialize_database()
            main.persist_mail_outline([{
                "messageId": "m1",
                "threadId": "t1",
                "sender": "a@example.com",
                "subject": "Launch",
                "sentAt": 1780000000000,
                "snippet": "hello",
                "summary": "hello",
                "action": "查看",
                "labels": ["INBOX", "UNREAD"],
            }])
            main.upsert_notification(
                notification_id="mail:m1",
                source="mail",
                title="新邮件：Launch",
                message="a@example.com",
                created_at=1780000000000,
                unread=True,
            )
            fake_connection = FakeImapConnection()
            with (
                patch.object(main, "mail_configured", return_value=True),
                patch.object(main, "qq_imap_connection", return_value=fake_connection),
            ):
                summary = main.mark_notification_read("mail:m1")
            outline = main.cached_mail_outline()
        main.DATABASE_PATH = original_path
        self.assertIn(("uid", "STORE", "m1", "+FLAGS.SILENT", r"(\Seen)"), fake_connection.calls)
        self.assertEqual(summary["unreadCount"], 0)
        self.assertFalse(outline[0]["unread"])

    def test_read_mail_message_without_mark_read_keeps_unread_state(self):
        message = EmailMessage()
        message["Subject"] = "Launch"
        message["From"] = "Kiko <kiko@qq.com>"
        message["To"] = "team@example.com"
        message["Date"] = "Thu, 18 Jun 2026 10:20:30 +0800"
        message.set_content("Plain body")

        class FakeImapConnection:
            def __init__(self, raw_message):
                self.calls = []
                self.raw_message = raw_message

            def select(self, mailbox, readonly=False):
                self.calls.append(("select", mailbox, readonly))
                return ("OK", [b"1"])

            def uid(self, command, uid, *args):
                self.calls.append(("uid", command, uid, *args))
                if command == "FETCH":
                    return ("OK", [(b"1 (UID m1 FLAGS ()) BODY[] {10}", self.raw_message)])
                if command == "STORE":
                    raise AssertionError("STORE should not be called for read-only message fetch")
                raise AssertionError(f"Unexpected IMAP command: {command}")

            def logout(self):
                self.calls.append(("logout",))

        fake_connection = FakeImapConnection(message.as_bytes())
        with (
            patch.object(main, "mail_configured", return_value=True),
            patch.object(main, "qq_imap_connection", return_value=fake_connection),
        ):
            result = main.read_mail_message("m1", mark_read=False)
        self.assertTrue(result["unread"])
        self.assertNotIn(("uid", "STORE", "m1", "+FLAGS.SILENT", r"(\Seen)"), fake_connection.calls)


if __name__ == "__main__":
    unittest.main()
