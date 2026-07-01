# WinPlate architecture

WinPlate is a local-first monorepo. Platform lifecycle and UI belong in `apps/`; deterministic product rules belong in `packages/`; network, mail, weather, GitHub, and SQLite I/O belong in `backend/local-api/`.

Dependencies point inward: platform apps may consume `packages/core`, `packages/shared-types`, and `packages/icons`; shared packages must not import Electron, SwiftUI, AppKit, FastAPI, SQLite, or filesystem persistence. The Electron macOS menu-bar workspace is a transition adapter consumed by the current Electron startup shell, not a general shared shell.

The local API binds only to `127.0.0.1:8765`. It is not a hosted service and must not be exposed on a LAN interface. Credentials remain in privileged local processes and are never returned to renderer code. SQLite and caches remain implementation details of the local API.

```text
apps/windows-electron ─┐
apps/macos/* ──────────┼─> packages/core + shared-types + icons
                       └─> backend/local-api (loopback only)
```

`apps/ios` and `apps/watchos` are documentation boundaries until health-data privacy, consent, retention, and synchronization are designed separately.
