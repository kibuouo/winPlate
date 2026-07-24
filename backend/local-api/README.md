# Local API boundary

The importable FastAPI application lives in `winplate_local_api/`, with tests in
`tests/`. From the repository root, use `npm run backend` to start it on
`127.0.0.1:8765` and `npm run backend:test` to run its unit tests.

For the native macOS client, install the local runtime with
`python3 -m pip install -r backend/local-api/requirements.txt`. The client
prefers the repository `.venv` when it is available.

Runtime SQLite state is stored under `WINPLATE_DATA_DIR` when provided; Electron
sets this to its writable user-data directory. Standalone launches fall back to
the platform's user-local application-data location.
