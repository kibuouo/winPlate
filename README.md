# WinPlate

WinPlate is a local-first desktop workspace that keeps each platform client
independent while sharing product rules and one loopback-only local API.

## Repository map

| Path | Responsibility |
| --- | --- |
| [`apps/Windows`](apps/Windows) | Windows Electron client and Windows-specific integrations |
| [`apps/macOS/WinPlate`](apps/macOS/WinPlate) | Native SwiftUI/AppKit macOS client |
| [`backend/local-api`](backend/local-api) | FastAPI, SQLite, mail, weather, GitHub, and network boundary |
| [`packages`](packages) | Shared deterministic rules, types, and icons |
| [`docs`](docs) | Architecture, product decisions, and verification evidence |

## Common commands

From the repository root:

```sh
npm install
npm run venv:create
npm run backend:install
```

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

## Documentation

- [Architecture](docs/architecture.md)
- [Platform roadmap](docs/platform-roadmap.md)
- [Notification center](docs/notification-center.md)
- [Windows client guide](apps/Windows/README.md)
- [macOS client guide](apps/macOS/README.md)
- [Local API guide](backend/local-api/README.md)
