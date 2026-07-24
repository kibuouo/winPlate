#!/bin/zsh
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
binary="$root/.build/arm64-apple-macosx/debug/WinPlate"
bundle="$root/.build/WinPlate.app"

swift build --package-path "$root"
rm -rf "$bundle"
mkdir -p "$bundle/Contents/MacOS" "$bundle/Contents/Resources"
cp "$binary" "$bundle/Contents/MacOS/WinPlate"
cp "$root/Resources/Info.plist" "$bundle/Contents/Info.plist"
cp "$root/Resources/AppIcon.icns" "$bundle/Contents/Resources/AppIcon.icns"

# Image conversion tools can leave Finder metadata on copied resources.  A
# bundled app must not include that metadata when it is code-signed.
xattr -cr "$bundle"

# Keychain access rules are tied to a code-signing identity.  For durable,
# app-specific access, set WINPLATE_SIGNING_IDENTITY to an Apple Development
# or Developer ID certificate.  Ad-hoc signing remains available for local
# builds, but cannot safely act as a persistent Keychain identity.
signing_identity="${WINPLATE_SIGNING_IDENTITY:--}"
codesign --force --sign "$signing_identity" --identifier com.kiko.winplate "$bundle"
xattr -cr "$bundle"
codesign --verify --deep --strict "$bundle"
