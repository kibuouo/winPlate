import tempfile
import unittest
import gzip
import json
from email.message import Message
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

import main


class DatabaseTests(unittest.TestCase):
    def test_environment_setting_prefers_process_environment(self):
        with patch.dict(main.os.environ, {"QWEATHER_API_KEY": "process-key"}):
            self.assertEqual(main.environment_setting("QWEATHER_API_KEY"), "process-key")

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
        responses = [
            {
                "login": "octocat",
                "name": "The Octocat",
                "html_url": "https://github.com/octocat",
                "avatar_url": "avatar",
                "public_repos": 8,
                "followers": 42,
            },
            [{"name": "hello-world", "language": "Python", "stargazers_count": 9, "pushed_at": "2026-06-12T00:00:00Z"}],
            [],
        ]
        with patch.object(main, "github_request", side_effect=responses):
            result = main.build_github_status("octocat")
        self.assertEqual(result["username"], "@octocat")
        self.assertEqual(result["project"], "hello-world")
        self.assertEqual(result["repos"], 8)
        self.assertEqual(result["source"], "github")
        self.assertEqual(len(result["contributionMonths"]), 12)
        self.assertEqual(result["contributionMonths"][-1]["commits"], 0)

    def test_build_weather_status_maps_qweather_response(self):
        responses = [
            {"code": "200", "location": [{"id": "101320101", "name": "香港", "adm1": "香港"}]},
            {"code": "200", "updateTime": "2026-06-13T12:00+08:00", "now": {
                "obsTime": "2026-06-13T11:55+08:00", "temp": "30", "feelsLike": "35",
                "icon": "305", "text": "小雨", "humidity": "81", "windDir": "东南风", "windScale": "3",
            }},
            {"code": "200", "hourly": [{"fxTime": "2026-06-13T12:00+08:00", "pop": "75"}]},
        ]
        with patch.object(main, "qweather_request", side_effect=responses):
            result = main.build_weather_status("Hong Kong")
        self.assertEqual(result["source"], "qweather")
        self.assertEqual(result["temperature"], 30)
        self.assertEqual(result["icon"], "🌧")
        self.assertEqual(result["location"], "香港")
        self.assertEqual(result["precipitationProbability"], 75)

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


if __name__ == "__main__":
    unittest.main()
