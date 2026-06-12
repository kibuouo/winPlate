import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import main


class DatabaseTests(unittest.TestCase):
    def test_github_token_prefers_process_environment(self):
        with patch.dict(main.os.environ, {"GITHUB_TOKEN": "process-token"}):
            self.assertEqual(main.github_token(), "process-token")

    def test_default_status_is_persisted(self):
        original_path = main.DATABASE_PATH
        with tempfile.TemporaryDirectory() as directory:
            main.DATABASE_PATH = Path(directory) / "test.db"
            main.initialize_database()
            with patch.object(main, "github_status", return_value={"source": "github"}):
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


if __name__ == "__main__":
    unittest.main()
