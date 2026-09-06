# WinPlate

WinPlate is a local-first status workspace. Each platform keeps its own UI
and lifecycle, while product rules live in shared packages and I/O goes
through one loopback-only local API.

The desktop clients surface GitHub activity, Codex / ChatGPT / Grok usage,
DeepSeek balance, QQ Mail, QWeather, a unified notification center, and a
HealthKit snapshot from the iPhone companion. WinPlate is not a hosted
product: credentials stay in privileged local processes, and the API binds
only to `127.0.0.1:8765`.

## Platforms

| Client | Path | Role |
| --- | --- | --- |
| Windows | [`apps/Windows`](apps/Windows) | Electron production client: frameless main window, tray, pin-able floating capsule, and a token-protected Health listener on TCP `8766` |
| macOS | [`apps/macOS/WinPlate`](apps/macOS/WinPlate) | Native SwiftUI/AppKit client: main window, menu bar, Keychain, login item, bundled local API |
| iPhone | [`apps/iOS/WinPlateHealth`](apps/iOS) | Read-only HealthKit companion: latest heart rate, today's steps and active energy; syncs to Mac or Windows |
| watchOS | [`apps/watchOS`](apps/watchOS) | Documentation boundary only until privacy, consent, and sync are designed |

Windows and macOS do not import each other's client code. iPhone talks to
Mac over an encrypted nearby-device session, or to Windows over the
narrow Health listener. It never calls the local API. The same local
session can send a non-secret desktop snapshot (weather, usage, balance)
back to the iPhone.

## Modules

| ID | Surface | Source |
| --- | --- | --- |
| `github` | Dashboard, detail, capsule | GitHub profile, contribution calendar, and activity |
| `codex` | Dashboard, detail, capsule | Local Codex / ChatGPT / Grok usage plus optional DeepSeek balance |
| `mail` | Detail | QQ Mail IMAP over TLS (authorization code, not the account password) |
| `notifications` | Detail, capsule | Mail, weather alerts, Codex/ChatGPT, GitHub, and system imports through one notification manager |
| `heart` | Dashboard, detail, capsule | Current HealthKit overview from iPhone; Windows also keeps a 7-day de-duplicated heart-rate trend |
| `weather` | Dashboard, detail, capsule | QWeather nowcast, forecast, and alerts |
| `network` | Capsule | Local download / upload / latency on Windows |

Settings, enablement, order, and refresh intervals all derive from the
shared module registry. Adding a module is documented in
[Adding a module](docs/adding-module.md).

## Network and data boundary

```text
iPhone HealthKit
  ├─ nearby encrypted session ─> macOS WinPlate
  └─ LAN HTTP + pairing token ─> Windows :8766 (health only)

apps/Windows  ─┐
apps/macOS/* ─┼─> packages/core + shared-types + icons
              └─> backend/local-api  127.0.0.1:8765
```

- The FastAPI process is the only thing allowed to bind `127.0.0.1:8765`.
  Do not expose it on a LAN interface.
- Windows Health sync is a separate listener on port `8766`. It validates
  a per-installation pairing token, accepts the current overview (not raw
  HealthKit objects), and does not proxy the local API.
- Secrets stay in Electron `safeStorage`, the macOS Keychain, or the
  privileged API process. Renderer and preload code never receive them.
- Windows may persist at most seven days and 2,048 normalized heart-rate
  points for the trend chart. iPhone keeps only the latest overview for
  background retry. Neither side uploads health data to the internet.

## Repository map

| Path | Responsibility |
| --- | --- |
| [`apps/Windows`](apps/Windows) | Windows Electron client and Windows-specific integrations |
| [`apps/macOS/WinPlate`](apps/macOS/WinPlate) | Native SwiftUI/AppKit macOS client |
| [`apps/iOS/WinPlateHealth`](apps/iOS/WinPlateHealth) | iPhone HealthKit companion |
| [`apps/watchOS`](apps/watchOS) | Future watchOS boundary |
| [`backend/local-api`](backend/local-api) | FastAPI, SQLite, mail, weather, GitHub, notifications |
| [`packages/core`](packages/core) | Module registry, notification rules, digest, heart-rate history |
| [`packages/shared-types`](packages/shared-types) | Versioned JSON schemas |
| [`packages/icons`](packages/icons) | Platform-neutral notification icon keys |
| [`docs`](docs) | Architecture and product decisions |

## Setup

From the repository root, with Node.js and Python 3 on `PATH`:

```sh
npm install
npm run venv:create
npm run backend:install
```

iPhone development is Xcode-only. Open
`apps/iOS/WinPlateHealth/WinPlateHealth.xcodeproj`, sign with your team,
and run on a physical iPhone. See the [iOS client guide](apps/iOS/README.md).

## Common commands

| Goal | Command |
| --- | --- |
| Run the Windows client | `npm run dev` |
| Test the Windows application | `npm run windows:test` |
| Build and install the canonical Windows application | `npm run windows:app` |
| Run the local API in development | `npm run backend` |
| Test the local API | `npm run backend:test` |
| Run JavaScript and workspace checks | `npm run check` |
| Test the native macOS client | `npm run macos:test` |
| Build the canonical macOS application | `npm run macos:app` |

`npm run macos:app` installs the only launchable macOS bundle at
`~/Applications/WinPlate.app`. The repository's
`apps/macOS/WinPlate/.build/WinPlate.app` path is a symlink to that installed
application and must not become a second bundle.

`npm run windows:app` tests WinPlate, builds a standalone local API, creates
an NSIS installer, and installs the canonical application at
`%LOCALAPPDATA%\Programs\WinPlate\WinPlate.exe`. It refreshes the desktop and
Start menu shortcuts, launches that installed application, and verifies the
loopback API before succeeding. The installed app does not run backend files
or Python from the repository.

## Pair iPhone Health

**macOS.** In WinPlate settings, use the six-digit Health pairing code stored
in Keychain. The Mac browses for WinPlate Health on the local network.

**Windows.** Open `健康`, copy a `Windows 接收地址` on the same LAN as the
iPhone, paste it into the iPhone app's `WinPlate 通信` card, and allow
WinPlate through the Windows Firewall for private networks. Multiple
addresses can appear (Wi-Fi, Ethernet, VPN, virtual adapters); try another
displayed address if the iPhone cannot connect.

## Documentation

- [Architecture](docs/architecture.md)
- [Platform roadmap](docs/platform-roadmap.md)
- [Notification center](docs/notification-center.md)
- [Adding a module](docs/adding-module.md)
- [Windows client guide](apps/Windows/README.md)
- [macOS client guide](apps/macOS/README.md)
- [iOS Health guide](apps/iOS/README.md)
- [Local API guide](backend/local-api/README.md)
