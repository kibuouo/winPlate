import tempfile
import unittest
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from winplate_local_api import main


class WeatherStateTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        database = patch.object(main, "DATABASE_PATH", Path(directory.name) / "weather.db")
        database.start()
        self.addCleanup(database.stop)
        cache = patch.object(main, "_weather_cache", {})
        cache.start()
        self.addCleanup(cache.stop)
        main.initialize_database()

    def test_refresh_and_status_share_saved_location_despite_env_fallback(self):
        main.persist_weather_location(23.13, 113.26, "广州", source="manual", query="101280101")
        with (
            patch.object(main, "QWEATHER_LOCATION", "wrong-city"),
            patch.object(main, "environment_setting", return_value="key"),
            patch.object(main, "github_status", return_value={}),
            patch.object(main, "weather_status", return_value={"location": "广州"}) as weather,
        ):
            self.assertEqual(main.refresh_weather(), main.status()["weather"])
        refresh, status = weather.call_args_list
        self.assertEqual(refresh.args, ("101280101",))
        self.assertEqual(refresh.args, status.args)
        self.assertEqual({**refresh.kwargs, "force": False}, status.kwargs)
        self.assertTrue(refresh.kwargs["force"])
        self.assertEqual(refresh.kwargs["location_source"], "manual")

    def test_refresh_uses_env_only_without_saved_location(self):
        with (
            patch.object(main, "QWEATHER_LOCATION", "101020100"),
            patch.object(main, "weather_status", return_value={}) as weather,
        ):
            main.refresh_weather()
        self.assertEqual(weather.call_args.args, ("101020100",))
        self.assertEqual(weather.call_args.kwargs["location_source"], "env")

    def test_failed_refresh_reuses_only_same_location_and_does_not_extend_cache_ttl(self):
        main._weather_cache["A"] = (100, {"source": "qweather", "temperature": 20})
        with (
            patch.object(main.time, "monotonic", return_value=800),
            patch.object(main, "build_weather_status", side_effect=RuntimeError("offline")),
        ):
            result = main.weather_status("A", force=True)
            self.assertEqual(result["availability"], "stale")
            self.assertEqual(result["temperature"], 20)
            self.assertEqual(result["locationQuery"], "A")
            self.assertEqual(result["error"], "offline")
            with self.assertRaisesRegex(RuntimeError, "offline"):
                main.weather_status("B", force=True)
        self.assertEqual(main._weather_cache["A"][0], 100)
        self.assertNotIn("B", main._weather_cache)

    def test_success_after_failure_clears_stale_state(self):
        main._weather_cache["A"] = (0, {"source": "qweather", "temperature": 20})
        with patch.object(main, "build_weather_status", return_value={"source": "qweather", "temperature": 21}):
            result = main.weather_status("A", force=True)
        self.assertEqual(result["availability"], "fresh")
        self.assertEqual(result["error"], "")
        self.assertEqual(result["temperature"], 21)

    def test_api_key_weather_and_missing_jwt_are_independent(self):
        main.persist_weather_location(23.13, 113.26, "广州")
        with (
            patch.object(main, "environment_setting", return_value="key"),
            patch.object(main, "github_status", return_value={}),
            patch.object(main, "build_weather_status", return_value={"source": "qweather", "temperature": 21}),
            patch.object(main, "qweather_jwt_request", side_effect=RuntimeError(main.qweather_jwt_configuration_error())),
        ):
            weather = main.status()["weather"]
            alerts = main.get_weather_alerts()
        self.assertEqual(weather["availability"], "fresh")
        self.assertEqual(alerts["availability"], "unconfigured")
        self.assertEqual(alerts["alerts"], [])

    def test_successful_empty_alerts_are_distinct_from_missing_coordinates(self):
        main.persist_weather_location(23.13, 113.26, "广州", source="manual", query="101280101")
        with patch.object(main, "qweather_jwt_request", return_value={"alerts": []}):
            result = main.qweather_alerts()
        self.assertEqual(result["availability"], "empty")
        self.assertEqual(result["locationQuery"], "101280101")
        with patch.object(main, "read_weather_location", return_value={"query": "101280101"}):
            result = main.qweather_alerts()
        self.assertEqual(result["availability"], "unavailable")

    def test_missing_api_key_keeps_location_identity_for_independent_jwt_alerts(self):
        main.persist_weather_location(23.13, 113.26, "广州", source="manual", query="101280101")
        with (
            patch.object(main, "environment_setting", return_value=""),
            patch.object(main, "github_status", return_value={}),
            patch.object(main, "qweather_jwt_request", return_value={"alerts": []}),
        ):
            weather = main.status()["weather"]
            alerts = main.get_weather_alerts()
        self.assertEqual(weather["source"], "unconfigured")
        self.assertEqual(weather["locationQuery"], alerts["locationQuery"])
        self.assertEqual(alerts["availability"], "empty")

    def test_late_backend_request_cannot_overwrite_newer_saved_city(self):
        started = threading.Event()
        release = threading.Event()

        def build(query, **kwargs):
            if query == "2.00,1.00":
                started.set()
                if not release.wait(5):
                    raise RuntimeError("test request was not released")
            return {"source": "qweather", "location": query}

        with patch.object(main, "weather_status", side_effect=build), ThreadPoolExecutor(max_workers=2) as executor:
            old = executor.submit(main.refresh_weather, main.WeatherLocation(latitude=1, longitude=2))
            try:
                self.assertTrue(started.wait(5))
                main.set_manual_weather_location(main.ManualWeatherLocation(locationId="101280101", latitude=23.13, longitude=113.26))
            finally:
                release.set()
            old.result(timeout=5)
        self.assertEqual(main.read_weather_location()["query"], "101280101")
