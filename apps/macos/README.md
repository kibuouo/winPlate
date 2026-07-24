# WinPlate for macOS

`WinPlate/` is the native macOS client. It is a SwiftUI/AppKit application
using a native main window, native settings, SF Symbols, system materials,
Keychain storage, and the macOS login-item service. It does not embed Electron,
HTML, a preload bridge, or a browser renderer.

## Develop and test

Install the local API dependencies once from the repository root before
building an integrated macOS app:

```sh
npm run venv:create
npm run backend:install
```

Run the native test suite with the bundled Xcode-compatible wrapper:

```sh
npm run macos:test
```

Build the canonical Finder- and Dock-recognized bundle with:

```sh
npm run macos:app
open ~/Applications/WinPlate.app
```

Run the build again after source changes: SwiftPM updates its debug executable
during `swift build` and `swift test`, but it does not automatically refresh an
existing `.app` bundle. `.build/WinPlate.app` is a symlink to the installed app,
so both launch paths always open the same version.

`swift run` and Xcode's default Run action execute the bare SwiftPM executable;
they are suitable for SwiftUI iteration but do not include App bundle resources
or the packaged local API. Use the installed app for integration, Dock, and
Finder checks.

## Local API runtime

The installed App contains a copy of `backend/local-api/winplate_local_api` and
the Python packages from the repository `.venv`. It starts that bundled service
from App resources with `/usr/bin/python3`, so normal launches do not read the
repository or the user's Documents folder. The API only binds to
`http://127.0.0.1:8765`.

Set `WINPLATE_SKIP_LOCAL_API=1` only when launching a development build that
should attach to an already-running local API.

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
