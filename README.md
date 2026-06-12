# WinPlate

Electron desktop UI with a local FastAPI and SQLite backend.

## Development

```powershell
npm run venv:create
npm run backend:install
npm install
npm run dev
```

Electron starts `backend/main.py`, waits for `http://127.0.0.1:8765/api/health`,
then creates the main and floating windows. The renderer refreshes
`GET /api/status` every 30 seconds.

Codex usage is read separately by the Electron main process. It starts a hidden
Codex CLI PTY, sends `/status`, parses the primary remaining percentage and
reset text, and caches the result for 30 seconds. The UI treats a longer bar as
more quota remaining.

Electron automatically uses `.venv\Scripts\python.exe` when it exists, so the
virtual environment does not need to be activated before `npm run dev`.
`WINPLATE_PYTHON` can override the interpreter path when needed.

GitHub data is loaded from the public GitHub REST API. The default account is
`kibuouo`; override it and optionally provide a token before starting WinPlate:

```powershell
$env:WINPLATE_GITHUB_USERNAME = "your-login"
$env:GITHUB_TOKEN = "github_pat_..."
npm run dev
```

`GITHUB_TOKEN` is optional for public profiles, but avoids the low unauthenticated
API rate limit. GitHub responses are cached for five minutes unless refreshed
explicitly.

To activate the environment manually in PowerShell:

```powershell
.\.venv\Scripts\Activate.ps1
```

## Future Packaging

The backend is intentionally isolated behind `src/main/pythonService.js`.
For production packaging, build it as a one-file executable:

```powershell
python -m pip install pyinstaller
pyinstaller --onefile --name winplate-backend backend/main.py
```

Package the resulting executable as an Electron extra resource, then update
`pythonService.js` to launch that executable in packaged builds and
`backend/main.py` during development.
