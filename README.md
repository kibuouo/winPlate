# WinPlate

WinPlate is a native status center for Windows and macOS, built with Electron
and a local FastAPI and SQLite backend.

## Development

### macOS

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
npm install
npm run dev
```

macOS starts one native menu bar item with an anchored panel and a native main
window. It never creates the desktop capsule.

### Windows (PowerShell)

```powershell
py -m venv .venv
.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
npm install
npm run dev
```

Windows starts the 460 × 104 desktop capsule, Windows Tray, and frameless main
window.

Electron starts `backend/main.py`, waits for `http://127.0.0.1:8765/api/health`,
then creates the platform-specific shell. The renderer refreshes
`GET /api/status` every 30 seconds.

Codex usage is read separately by the Electron main process. It starts a hidden
Codex CLI PTY, sends `/status`, parses the primary remaining percentage and
reset text, and caches the result for 30 seconds. The UI treats a longer bar as
more quota remaining.

The setup scripts use `scripts/venvPython.js` to resolve `.venv/bin/python` on
macOS and `.venv\Scripts\python.exe` on Windows. Electron uses those same
platform paths when it starts the backend, so the virtual environment does not
need to be activated before `npm run dev`. Set `WINPLATE_PYTHON` to an explicit
interpreter path to override Electron's automatic resolution.

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

## Platform and settings

On macOS, Settings exposes `menuBarEnabled` and `launchAtLogin`.
`menuBarEnabled` creates or removes the native menu bar item and panel;
`launchAtLogin` controls whether WinPlate starts when you sign in. The Dock icon
and native main window remain reachable even when the menu bar item is disabled.

QWeather and DeepSeek are configured in the main window's Settings page on both
platforms. Public fields are stored under Electron's `userData` directory.
QWeather API keys/private keys and the DeepSeek API key are encrypted with
Electron `safeStorage`. The renderer receives only public values and configured
flags, never secret values.

Process environment variables are advanced overrides and take precedence over
stored values on both platforms. The exact supported overrides are
`QWEATHER_API_KEY`, `QWEATHER_API_HOST`, `QWEATHER_PROJECT_ID`,
`QWEATHER_CREDENTIAL_ID`, `QWEATHER_PRIVATE_KEY`, `DEEPSEEK_API_KEY`, and
`DEEPSEEK_BASE_URL`.

For compatibility on Windows, legacy values from `HKCU\Environment` are read
once only when no encrypted settings file exists. The first successful encrypted
save takes over and stops that migration read. WinPlate does not write new
registry values.

Restart WinPlate after changing QWeather credentials because the Python backend
receives its environment at startup. A saved DeepSeek change may be used
immediately by the Electron main-process request path, but restart if a result
still reflects an earlier configuration.

## QWeather

Weather data is loaded by the Python backend and cached for ten minutes. Create a
project and API key in the [QWeather console](https://console.qweather.com/),
then open WinPlate's main window and enter its API Key and assigned API Host in
Settings. Project ID, Credential ID, and an Ed25519 private key are optional and
enable official usage statistics.

For automation or temporary overrides, set process environment variables before
starting WinPlate. For example, in PowerShell:

```powershell
$env:QWEATHER_API_KEY = "your-api-key"
$env:QWEATHER_API_HOST = "your-project-api-host"
npm run dev
```

WinPlate requests system location permission and sends only the resulting
coordinates to the local backend. `QWEATHER_LOCATION` is an optional process
environment fallback when system location is unavailable; it accepts a city
name or location ID. There is no default fallback location. The QWeather API key
is injected into the local Python backend at startup and is never sent to the
renderer.

## DeepSeek

Open the main window's Settings page and enter the DeepSeek API Key and Base URL
(the default is `https://api.deepseek.com`). The key is used only by Electron's
main process; it is never sent to the renderer or Python backend. Advanced users
can override the saved values for a launch with `DEEPSEEK_API_KEY` and
`DEEPSEEK_BASE_URL` in the process environment.

## Verification

Run the same Node and Python suites used by CI:

```sh
npm run check
npm run backend:test
git diff --check
```

GitHub Actions runs both suites on `macos-latest` and `windows-latest` with
Node.js 22 and Python 3.12.

## Future Packaging

Packaging remains future work and is out of scope for the current development
build. The backend is intentionally isolated behind `src/main/pythonService.js`.
A future packaging flow could build it as a one-file executable:

```powershell
python -m pip install pyinstaller
pyinstaller --onefile --name winplate-backend backend/main.py
```

Package the resulting executable as an Electron extra resource, then update
`pythonService.js` to launch that executable in packaged builds and
`backend/main.py` during development.
