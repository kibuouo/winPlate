import tempfile
import unittest
import gzip
import json
import sys
from contextlib import closing
from datetime import datetime
from email.message import Message
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from urllib.error import URLError

import main


class DatabaseTests(unittest.TestCase):
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

    def test_github_token_prefers_process_environment(self):
        with patch.dict(main.os.environ, {"GITHUB_TOKEN": "process-token"}):
            self.assertEqual(main.github_token(), "process-token")

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

    def test_build_github_status_maps_profile_repository_and_events(self):
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
            "/users/octocat/events/public?per_page=100": [],
        }
        with patch.object(main, "github_request", side_effect=lambda path: responses[path]):
            result = main.build_github_status("octocat")
        self.assertEqual(result["username"], "@octocat")
        self.assertEqual(result["project"], "hello-world")
        self.assertEqual(result["repos"], 8)
        self.assertEqual(result["source"], "github")
        self.assertEqual(len(result["contributionMonths"]), 12)
        self.assertEqual(result["contributionMonths"][-1]["commits"], 0)

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
                "username": "@octocat",
                "profileUrl": "https://github.com/octocat",
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
            self.assertIn("no cached data", result["stateMessage"])
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
            ]},
        ]
        with patch.object(main, "qweather_request", side_effect=responses):
            result = main.build_weather_status("Hong Kong")
        self.assertEqual(result["source"], "qweather")
        self.assertEqual(result["temperature"], 30)
        self.assertEqual(result["icon"], "305")
        self.assertEqual(result["location"], "香港")
        self.assertEqual(result["precipitationProbability"], 75)
        self.assertEqual(result["weatherSummary"], "今天白天阵雨，夜晚多云，现在30°。")
        self.assertEqual(result["precipitation"], 0.3)
        self.assertEqual(result["pressure"], 1005)
        self.assertEqual(result["visibility"], 12)
        self.assertEqual(result["forecast"][0]["tempMax"], 31)
        self.assertEqual(result["forecast"][1]["condition"], "多云")

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

    def test_refresh_weather_uses_longitude_latitude_order(self):
        with patch.object(main, "weather_status", return_value={"source": "qweather"}) as weather_status:
            result = main.refresh_weather(main.WeatherLocation(latitude=22.3193, longitude=114.1694))
        self.assertEqual(result, {"source": "qweather"})
        weather_status.assert_called_once_with("114.169400,22.319300", force=True)

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

    def test_qweather_official_stats_sums_all_api_hours(self):
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
            patch.object(main, "urlopen", return_value=response) as mock_urlopen,
        ):
            result = main.qweather_official_stats()
        request = mock_urlopen.call_args.args[0]
        self.assertEqual(request.full_url, "https://example.com/metrics/v1/stats?credential=credential")
        self.assertNotIn("Accept-encoding", request.headers)
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
            patch.object(main, "urlopen", return_value=response),
        ):
            result = main.qweather_official_stats()
        self.assertEqual(result["total"], 5)
        self.assertEqual(result["success"], 4)
        self.assertEqual(result["errors"], 1)

    def test_named_metric_sum_supports_api_keyed_objects(self):
        payload = {
            "data": {
                "/v7/weather/now": {"success": {"hours": [5]}, "errors": {"hours": [1]}},
                "/v7/weather/3d": {"success": {"hours": [7]}, "errors": {"hours": [2]}},
            }
        }
        self.assertEqual(main._sum_named_metric(payload, "success"), 12)
        self.assertEqual(main._sum_named_metric(payload, "errors"), 3)


if __name__ == "__main__":
    unittest.main()
