import unittest

from winplate_local_api.main import api


class PackageBoundaryTest(unittest.TestCase):
    def test_fastapi_app_remains_importable(self):
        self.assertEqual(api.title, "WinPlate API")


if __name__ == "__main__":
    unittest.main()
