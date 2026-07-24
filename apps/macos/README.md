# WinPlate for macOS

`WinPlate/` is the native macOS client. It is a SwiftUI/AppKit application
using a native main window, native settings, SF Symbols, system materials,
Keychain storage, and the macOS login-item service. It does not embed Electron,
HTML, a preload bridge, or a browser renderer.

## Run locally

Open `WinPlate/Package.swift` in Xcode and run the `WinPlate` scheme, or run:

```sh
cd apps/macos/WinPlate
swift run WinPlate
```

Run the test suite with the bundled Xcode-compatible wrapper:

```sh
cd apps/macos/WinPlate
./scripts/test.sh
```

For a Finder- and Dock-recognized development bundle, run
`./scripts/make-app.sh` and open `~/Applications/WinPlate.app`. Run the script
again after source changes: SwiftPM updates its debug executable during
`swift build` and `swift test`, but it does not automatically refresh an
existing `.app` bundle. `.build/WinPlate.app` is a symlink to the installed
app, so both launch paths always open the same version.

`swift run` and Xcode's default Run action execute the Swift Package's bare
executable, so macOS bundle resources such as `AppIcon.icns` are not applied.
Use the installed app when checking the Dock and Finder icon:

```sh
cd apps/macos/WinPlate
./scripts/make-app.sh
open ~/Applications/WinPlate.app
```

The client starts the local FastAPI service from this repository when run from
the checkout. Set `WINPLATE_SKIP_LOCAL_API=1` when attaching to an already
running local API. It only calls `http://127.0.0.1:8765`.

Codex usage is queried through `codex app-server`; DeepSeek credentials are
stored in the user's Keychain and are requested directly by the native client.
Configure the QWeather API Key and the project-specific API Host in
**设置 → 天气**. To show extreme-weather alerts, also enter the QWeather JWT
project ID, credential ID, and Ed25519 private-key PEM in the same section.
The host is shown in the QWeather Console; do not use a legacy shared host
when the console has assigned a dedicated one. Credentials are stored in the
macOS Keychain and passed only to the local FastAPI process when saved.

QQ Mail uses IMAP over TLS. In **设置 → QQ 邮箱**, save the mailbox address and
QQ Mail authorization code (not the account password); WinPlate then tests the
IMAP connection and shows its exact result in Settings.
The menu bar and dashboard degrade independently when a source is unavailable.

Health-data implementation remains outside this client until its privacy and
synchronization design is approved.
