import unittest
from pathlib import Path

from fastapi.middleware.cors import CORSMiddleware

from winplate_local_api.main import api


class PackageBoundaryTest(unittest.TestCase):
    def test_fastapi_app_remains_importable(self):
        self.assertEqual(api.title, "WinPlate API")

    def test_local_api_does_not_install_browser_cors_middleware(self):
        self.assertFalse(
            any(middleware.cls is CORSMiddleware for middleware in api.user_middleware)
        )

    def test_notification_writes_are_owned_by_notification_manager(self):
        package_root = Path(__file__).resolve().parents[1] / "winplate_local_api"
        main_source = (package_root / "main.py").read_text(encoding="utf-8")
        manager_source = (package_root / "notification_manager.py").read_text(encoding="utf-8")
        for statement in (
            "INSERT INTO notifications",
            "UPDATE notifications",
            "DELETE FROM notifications",
            "INSERT OR IGNORE INTO notification_imports",
        ):
            self.assertNotIn(statement, main_source)
            self.assertIn(statement, manager_source)
        self.assertNotIn("def upsert_notification(", main_source)


if __name__ == "__main__":
    unittest.main()
