#!/bin/zsh
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
xcode_developer_dir="/Applications/Xcode.app/Contents/Developer"

# The standalone Command Line Tools package can lag its bundled SDK. Prefer
# the complete Xcode toolchain, which keeps Swift and the macOS SDK in sync.
if [[ -z "${DEVELOPER_DIR:-}" && -d "$xcode_developer_dir" ]]; then
  export DEVELOPER_DIR="$xcode_developer_dir"
fi

if [[ ! -d "${DEVELOPER_DIR:-}/Platforms/MacOSX.platform" ]]; then
  print -u2 "WinPlate tests require the full Xcode developer directory."
  print -u2 "Install Xcode, then run: sudo xcode-select --switch $xcode_developer_dir"
  exit 1
fi

export CLANG_MODULE_CACHE_PATH="${CLANG_MODULE_CACHE_PATH:-$root/.build/clang-module-cache}"
mkdir -p "$CLANG_MODULE_CACHE_PATH"

swift test --package-path "$root" "$@"
