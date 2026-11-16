import datetime as dt
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("renew_health", Path(__file__).with_name("renew-health.py"))
renew = importlib.util.module_from_spec(spec)
spec.loader.exec_module(renew)


class RenewalTests(unittest.TestCase):
    def test_missing_phone_does_not_touch_profiles_or_installed_expiry(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state = {"installed_expires_at": 100}
            renew.save_state(root / "state.json", state)
            with patch.object(renew, "archive_app_profiles") as archive:
                def offline(command, timeout):
                    raise subprocess.CalledProcessError(1, command)
                with self.assertRaises(subprocess.CalledProcessError):
                    renew.renew(root, {"device_id": "phone", "bundle_id": "app"}, state, offline)
                archive.assert_not_called()
            self.assertEqual(json.loads((root / "state.json").read_text()), state)

    def test_reused_profile_stops_before_install_and_preserves_state(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = {"device_id": "phone", "bundle_id": "app", "project": "project",
                      "application_identifier": "team.app"}
            state = {"installed_expires_at": 1000000}
            renew.save_state(root / "state.json", state)
            profile = {"ExpirationDate": dt.datetime.fromtimestamp(1000000, dt.timezone.utc),
                       "Entitlements": {"application-identifier": "team.app", "com.apple.developer.healthkit": True},
                       "ProvisionedDevices": ["phone"]}
            calls = []
            with patch.object(renew, "archive_app_profiles", return_value=[]), \
                 patch.object(renew, "read_profile", return_value=profile):
                with self.assertRaisesRegex(RuntimeError, "did not extend"):
                    renew.renew(root, config, state, lambda command, timeout: calls.append(command))
            self.assertFalse(any("install" in command for command in calls))
            self.assertEqual(json.loads((root / "state.json").read_text()), state)

    def test_renewal_window_includes_expired_and_boundary_profiles(self):
        state = {"installed_expires_at": 200000}
        self.assertFalse(renew.is_due(state, 200000 - 48 * 3600 - 1))
        self.assertTrue(renew.is_due(state, 200000 - 48 * 3600))
        self.assertTrue(renew.is_due(state, 200001))

    def test_new_expiry_is_saved_only_after_installation_succeeds(self):
        for install_fails in (True, False):
            with self.subTest(install_fails=install_fails), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                now = renew.time.time()
                state = {"installed_expires_at": now + 3600}
                renew.save_state(root / "state.json", state)
                config = {"device_id": "phone", "bundle_id": "app", "project": "project",
                          "application_identifier": "team.app"}
                profile = {"UUID": "new-profile", "ExpirationDate": dt.datetime.fromtimestamp(now + 7 * 86400, dt.timezone.utc),
                           "Entitlements": {"application-identifier": "team.app", "com.apple.developer.healthkit": True},
                           "ProvisionedDevices": ["phone"]}
                def run(command, timeout):
                    if "install" in command and install_fails:
                        raise subprocess.CalledProcessError(1, command)
                with patch.object(renew, "archive_app_profiles", return_value=[]), \
                     patch.object(renew, "read_profile", return_value=profile):
                    if install_fails:
                        with self.assertRaises(subprocess.CalledProcessError):
                            renew.renew(root, config, state, run)
                        self.assertEqual(json.loads((root / "state.json").read_text()), state)
                    else:
                        renew.renew(root, config, state, run)
                        saved = json.loads((root / "state.json").read_text())
                        self.assertEqual(saved["installed_expires_at"], renew.expiry(profile))
                        self.assertEqual(saved["profile_uuid"], "new-profile")


if __name__ == "__main__":
    unittest.main()
