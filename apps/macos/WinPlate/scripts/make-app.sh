#!/bin/zsh
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
install_dir="${WINPLATE_INSTALL_DIR:-$HOME/Applications}"
bundle="$install_dir/WinPlate.app"
bundle_link="$root/.build/WinPlate.app"
staging_dir="$(mktemp -d "${TMPDIR:-/tmp}/winplate-app.XXXXXX")"
staging_bundle="$staging_dir/WinPlate.app"

# Command Line Tools can drift out of sync with the installed macOS SDK.
# Prefer the full Xcode toolchain when it is available.
if [[ -z "${DEVELOPER_DIR:-}" && -d /Applications/Xcode.app/Contents/Developer ]]; then
  export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
fi

export CLANG_MODULE_CACHE_PATH="${CLANG_MODULE_CACHE_PATH:-$root/.build/clang-module-cache}"
mkdir -p "$CLANG_MODULE_CACHE_PATH"

swift build --package-path "$root"
bin_path="$(swift build --package-path "$root" --show-bin-path)"
binary="$bin_path/WinPlate"
weather_icons="$root/../../windows-electron/assets/qweather-icons/icons"
local_api_source="$root/../../../backend/local-api/winplate_local_api"
python_runtime="$root/../../../.venv"

if [[ ! -x "$binary" ]]; then
  print -u2 "WinPlate executable not found at $binary"
  exit 1
fi

if [[ ! -d "$weather_icons" ]]; then
  print -u2 "QWeather icon assets not found at $weather_icons"
  exit 1
fi

if [[ ! -d "$local_api_source" ]]; then
  print -u2 "Local API source not found at $local_api_source"
  exit 1
fi

if [[ ! -x "$python_runtime/bin/python3" ]]; then
  print -u2 "Python runtime not found at $python_runtime/bin/python3"
  exit 1
fi

python_packages="$("$python_runtime/bin/python3" -c 'import sysconfig; print(sysconfig.get_paths()["purelib"])')"
venv_python_version="$("$python_runtime/bin/python3" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
system_python_version="$(/usr/bin/python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"

if [[ ! -d "$python_packages" ]]; then
  print -u2 "Python packages not found at $python_packages"
  exit 1
fi

if [[ "$venv_python_version" != "$system_python_version" ]]; then
  print -u2 "Python runtime version $venv_python_version does not match /usr/bin/python3 ($system_python_version)"
  exit 1
fi

trap 'rm -rf "$staging_dir"' EXIT
mkdir -p "$staging_bundle/Contents/MacOS" "$staging_bundle/Contents/Resources"
cp "$binary" "$staging_bundle/Contents/MacOS/WinPlate"
cp "$root/Resources/Info.plist" "$staging_bundle/Contents/Info.plist"
cp "$root/Resources/AppIcon.icns" "$staging_bundle/Contents/Resources/AppIcon.icns"
cp -R "$weather_icons" "$staging_bundle/Contents/Resources/QWeatherIcons"
mkdir -p "$staging_bundle/Contents/Resources/LocalAPI"
cp -R "$local_api_source" "$staging_bundle/Contents/Resources/LocalAPI/winplate_local_api"
cp -R "$python_packages" "$staging_bundle/Contents/Resources/PythonPackages"

if ! cmp -s "$binary" "$staging_bundle/Contents/MacOS/WinPlate"; then
  print -u2 "Packaged executable does not match the SwiftPM debug build"
  exit 1
fi

# Image conversion tools can leave Finder metadata on copied resources.  A
# bundled app must not include that metadata when it is code-signed.
xattr -cr "$staging_bundle"

# Keychain access rules are tied to a code-signing identity.  For durable,
# app-specific access, set WINPLATE_SIGNING_IDENTITY to an Apple Development
# or Developer ID certificate.  Ad-hoc signing remains available for local
# builds, but cannot safely act as a persistent Keychain identity.
signing_identity="${WINPLATE_SIGNING_IDENTITY:--}"
codesign --force --sign "$signing_identity" --identifier com.kiko.winplate "$staging_bundle"
codesign --verify --deep --strict "$staging_bundle"

mkdir -p "$install_dir"
rm -rf "$bundle"
mv "$staging_bundle" "$bundle"

# Keep the launchable bundle outside synced Documents folders, which can
# continuously reattach metadata that invalidates local code-signing checks.
xattr -cr "$bundle"
codesign --force --sign "$signing_identity" --identifier com.kiko.winplate "$bundle"
codesign --verify --deep --strict "$bundle"

rm -rf "$bundle_link"
ln -s "$bundle" "$bundle_link"

print "Built $bundle from $binary"
print "Linked $bundle_link -> $bundle"
