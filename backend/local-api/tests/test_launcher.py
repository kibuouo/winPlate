from __future__ import annotations

import unittest
from unittest.mock import patch

from winplate_local_api import launcher


class LauncherTests(unittest.TestCase):
    def test_resolve_port_defaults_to_winplate_port(self) -> None:
        self.assertEqual(launcher.resolve_port({}), 8765)

    def test_resolve_port_accepts_probe_override(self) -> None:
        self.assertEqual(launcher.resolve_port({"WINPLATE_BACKEND_PORT": "18765"}), 18765)

    def test_resolve_port_rejects_invalid_values(self) -> None:
        for value in ("not-a-port", "0", "65536"):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    launcher.resolve_port({"WINPLATE_BACKEND_PORT": value})

    @patch("winplate_local_api.launcher.uvicorn.run")
    def test_main_binds_only_to_loopback(self, run) -> None:
        with patch.dict("os.environ", {"WINPLATE_BACKEND_PORT": "18765"}):
            launcher.main()

        run.assert_called_once_with(
            launcher.api,
            host="127.0.0.1",
            port=18765,
            use_colors=True,
            log_config=launcher.LOG_CONFIG,
        )


if __name__ == "__main__":
    unittest.main()
