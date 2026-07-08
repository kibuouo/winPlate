import unittest

from fastapi.middleware.cors import CORSMiddleware

from winplate_local_api.main import api


class PackageBoundaryTest(unittest.TestCase):
    def test_fastapi_app_remains_importable(self):
        self.assertEqual(api.title, "WinPlate API")

    def test_local_api_does_not_install_browser_cors_middleware(self):
        self.assertFalse(
            any(middleware.cls is CORSMiddleware for middleware in api.user_middleware)
        )


if __name__ == "__main__":
    unittest.main()
