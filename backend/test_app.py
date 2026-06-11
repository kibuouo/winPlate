import tempfile
import unittest
from pathlib import Path

import main


class DatabaseTests(unittest.TestCase):
    def test_default_status_is_persisted(self):
        original_path = main.DATABASE_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DATABASE_PATH = Path(directory) / "test.db"
            main.initialize_database()
            self.assertEqual(main.status(), main.DEFAULT_STATUS)
        main.DATABASE_PATH = original_path


if __name__ == "__main__":
    unittest.main()
