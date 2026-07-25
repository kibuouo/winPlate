# Local API boundary

The importable FastAPI application lives in `winplate_local_api/`, with tests in
`tests/`. It is the only process permitted to bind to `127.0.0.1:8765`; never
expose it on a LAN interface.

From the repository root:

```sh
npm run venv:create
npm run backend:install
npm run backend
npm run backend:test
```

The macOS packaging flow copies this API package and the repository `.venv`
packages into `~/Applications/WinPlate.app`. The installed client then runs the
bundled API with `/usr/bin/python3`, keeping normal app launches independent of
the checkout path and the Documents folder.

Runtime SQLite state is stored under `WINPLATE_DATA_DIR` when provided; Electron
sets this to its writable user-data directory. Standalone launches fall back to
the platform's user-local application-data location.
