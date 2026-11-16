#!/usr/bin/python3
"""Renew the configured, already-trusted WinPlate iOS app using Xcode.

Run periodically; no build or device connection is attempted until renewal is due.
Configuration and signing metadata stay in the user's private Application Support.
"""
import argparse
import datetime as dt
import fcntl
import json
import os
from pathlib import Path
import plistlib
import shutil
import signal
import subprocess
import sys
import time


DEFAULT_ROOT = Path.home() / "Library/Application Support/WinPlate/iOSAutoRenew"


def read_profile(path):
    raw = subprocess.check_output(
        ["/usr/bin/security", "cms", "-D", "-i", str(path)], stderr=subprocess.DEVNULL
    )
    return plistlib.loads(raw)


def expiry(profile):
    return profile["ExpirationDate"].replace(tzinfo=dt.timezone.utc).timestamp()


def is_due(state, now, threshold=48 * 3600):
    return state["installed_expires_at"] - now <= threshold


def validate_profile(profile, config, previous_expiry, now):
    entitlements = profile.get("Entitlements", {})
    if entitlements.get("application-identifier") != config["application_identifier"]:
        raise RuntimeError("Unexpected application identifier; installation stopped")
    if not entitlements.get("com.apple.developer.healthkit"):
        raise RuntimeError("HealthKit entitlement is missing; installation stopped")
    if config["device_id"] not in profile.get("ProvisionedDevices", []):
        raise RuntimeError("Target iPhone is not included in the signing profile")
    if expiry(profile) <= max(previous_expiry, now + 48 * 3600):
        raise RuntimeError("Xcode did not extend the signing validity; installation stopped")


def archive_app_profiles(root, config):
    """Move only this app's cached profiles; preserve them for recovery."""
    backup = root / "profile-backups" / str(time.time_ns())
    moved = []
    for cache in (
        Path.home() / "Library/Developer/Xcode/UserData/Provisioning Profiles",
        Path.home() / "Library/MobileDevice/Provisioning Profiles",
    ):
        for path in cache.glob("*.mobileprovision"):
            try:
                profile = read_profile(path)
            except (subprocess.CalledProcessError, plistlib.InvalidFileException):
                continue
            if profile.get("Entitlements", {}).get("application-identifier") != config["application_identifier"]:
                continue
            destination = backup / cache.parent.name / path.name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(path), str(destination))
            moved.append((path, destination))
    return moved


def save_state(path, state):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(state, indent=2) + "\n")
    temporary.replace(path)


def renew(root, config, state, run):
    # Ask the physical device first so an absent phone doesn't cause needless
    # profile rotation or builds. devicectl's cached device list isn't sufficient.
    device = config["device_id"]
    bundle = config["bundle_id"]
    run(["xcrun", "devicectl", "device", "info", "apps", "--device", device,
         "--filter", 'bundleIdentifier == "' + bundle + '"'], 90)
    archived = archive_app_profiles(root, config)
    try:
        run(["xcodebuild", "-project", config["project"], "-scheme", "WinPlateHealth",
             "-configuration", "Debug", "-destination", "generic/platform=iOS",
             "-derivedDataPath", str(root / "DerivedData"),
             # A profile refresh alone may not trigger Xcode's incremental
             # CodeSign step. Clean this dedicated build before signing again.
             "-allowProvisioningUpdates", "clean", "build"], 600)
        app = root / "DerivedData/Build/Products/Debug-iphoneos/WinPlate.app"
        profile = read_profile(app / "embedded.mobileprovision")
        validate_profile(profile, config, state["installed_expires_at"], time.time())
        run(["/usr/bin/codesign", "--verify", "--deep", "--strict", str(app)], 30)
        run(["xcrun", "devicectl", "device", "install", "app", "--device", device,
             str(app)], 180)
        # Never record a successful renewal before installation succeeds.
        updated = dict(state, installed_expires_at=expiry(profile),
                       last_installed_at=time.time(), profile_uuid=profile["UUID"])
        save_state(root / "state.json", updated)
        return updated
    finally:
        # Keep the previous profiles available even after a failed build/install.
        # Certificates, private keys, and other apps' profiles are never changed.
        for original, backup in archived:
            if not original.exists():
                shutil.copy2(backup, original)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--check", action="store_true", help="Inspect expiry without changing anything")
    parser.add_argument("--force", action="store_true", help="Renew now even outside the 48-hour window")
    args = parser.parse_args()
    os.umask(0o077)
    root = args.root.expanduser().resolve()
    config = json.loads((root / "config.json").read_text())
    state = json.loads((root / "state.json").read_text())
    due = is_due(state, time.time())
    result = {"status": "due" if due else "not_due",
              "expires_at": dt.datetime.fromtimestamp(state["installed_expires_at"], dt.timezone.utc).isoformat()}
    if args.check or (not due and not args.force):
        print(json.dumps(result))
        return 0
    with (root / "renew.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print(json.dumps({"status": "already_running"}))
            return 0
        # Re-read under the lock in case another invocation just finished.
        state = json.loads((root / "state.json").read_text())
        if not args.force and not is_due(state, time.time()):
            print(json.dumps({"status": "not_due"}))
            return 0
        with (root / "last-run.log").open("w") as log:
            def run(command, timeout):
                with subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT,
                                      stdin=subprocess.DEVNULL, start_new_session=True) as process:
                    try:
                        code = process.wait(timeout=timeout)
                    except subprocess.TimeoutExpired:
                        os.killpg(process.pid, signal.SIGKILL)
                        process.wait()
                        raise
                    if code:
                        raise subprocess.CalledProcessError(code, command)
            try:
                updated = renew(root, config, state, run)
            except (RuntimeError, subprocess.SubprocessError, OSError) as error:
                print(json.dumps({"status": "needs_retry_or_attention", "reason": str(error),
                                  "log": str(root / "last-run.log"),
                                  "expires_at": result["expires_at"]}))
                return 1
        print(json.dumps({"status": "renewed_and_installed",
                          "expires_at": dt.datetime.fromtimestamp(updated["installed_expires_at"], dt.timezone.utc).isoformat()}))
        return 0


if __name__ == "__main__":
    sys.exit(main())
