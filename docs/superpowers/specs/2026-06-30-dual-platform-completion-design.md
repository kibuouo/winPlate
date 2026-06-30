# WinPlate Dual-Platform Completion Design

## Summary

WinPlate will ship one coherent development application for Windows and macOS from the same repository. Windows retains its existing floating-capsule-first experience, frameless main window, and Tray behavior. macOS retains the newer native menu bar status item and compact anchored panel, adds a native main window and macOS-only application preferences, and never creates a desktop floating capsule.

The `codex/macos-menu-bar` branch is the sole implementation baseline because it contains the approved menu bar direction, the supplied status artwork, a completed macOS smoke pass, and the stronger menu bar test suite. The older `codex/winplate-windows-macos` branch is an implementation reference only. Code may be ported from it when it still matches the approved product, but the branches will not be merged wholesale.

This design completes the runnable development product and its dual-platform verification. Signed installers, macOS notarization, auto-update, Linux, mobile, and watch clients remain outside this iteration.

## Product Boundaries

### Shared product core

- Keep Electron as the desktop shell and the local FastAPI/SQLite service as the shared data layer.
- Keep GitHub, Codex, DeepSeek, QWeather, appearance, caching, and offline behavior shared across platforms.
- Keep one main renderer for Dashboard, GitHub, Codex, Heart, QWeather, and Settings.
- Keep the macOS menu panel in its existing isolated renderer and preload entry points.
- Select platform-native surfaces once during startup. Business modules and renderers must not accumulate unrelated `process.platform` checks.

### Windows experience

- Start the hidden main window, 460 × 104 floating capsule, and existing Windows Tray.
- Preserve the current 1080 × 720 frameless main window, 860 × 560 minimum size, self-rendered title bar, window controls, capsule interactions, tooltips, Tray menu, and Tray double-click behavior.
- Preserve the current capsule position, always-on-top behavior, pin interaction, visual treatment, and status data.
- Closing the main window hides it. An explicit Tray Quit action terminates the application.

### macOS experience

- Start one native status item containing the approved monochrome icon and bounded current-temperature title.
- Left click toggles the existing 320 × 420 anchored panel. Right click opens Open WinPlate, Settings, Refresh, and Quit.
- Keep the existing Codex → DeepSeek → Weather → Actions panel order, neutral quota bars, green/gray availability points, in-place refresh, and partial-failure behavior.
- Create the main window at 1040 × 720 with an 880 × 580 minimum, native frame, `hiddenInset` title bar, traffic lights at `{ x: 16, y: 16 }`, transparent background, and window vibrancy.
- Omit Windows title-bar markup and event binding on macOS while retaining the shared Sidebar and pages. Reserve safe space around the traffic lights.
- Never create, offer, or configure a macOS desktop floating capsule.
- Closing the main window hides it. Dock activation and the menu bar continue to reopen it. Explicit Quit is the only normal termination path.

## Architecture and Module Responsibilities

### Platform selection and windows

`src/main/startupPolicy.js` remains the single source of truth for which native surfaces start. It continues to return the Windows Tray plus floating window on Windows and the native menu bar without a floating window on macOS.

Add a small pure window-policy module that returns the main-window options for `win32` and `darwin`. `src/main/windows.js` continues to own creation, close-to-hide, activation, navigation, and window-control operations. It consumes the selected options rather than duplicating the lifecycle. Windows options must preserve every observable current default; macOS options implement the native window described above.

`src/main/macMenuBar.js` remains the only owner of the macOS Tray and panel. Do not port the older Tray adapter, 380 × 540 menu panel, status digest, compact title modes, or optional capsule implementation.

### Application preferences

Add `src/main/appSettings.js` with exactly these persisted preferences:

- `menuBarEnabled`, Boolean, default `true`.
- `launchAtLogin`, Boolean, default `false`.

The module validates unknown and malformed values, reads missing or corrupt files as defaults, and writes through a temporary file followed by an atomic rename. Applying `launchAtLogin` uses Electron login-item APIs and avoids redundant writes.

On macOS, Settings shows both preferences and applies them immediately. Turning off `menuBarEnabled` destroys the controller once but leaves the Dock and main window reachable. Turning it on constructs one new controller without duplicate events or IPC ownership. Windows does not display or apply these macOS-only preferences.

### Service configuration and secrets

The existing Windows environment-variable behavior remains compatible, but the Settings UI must also work after a macOS restart. Add a main-process service-settings store for QWeather and DeepSeek configuration:

- Non-secret values such as API host, project ID, credential ID, and DeepSeek base URL are validated and stored in an atomic JSON file under Electron `userData`.
- API keys and the QWeather private key are encrypted with Electron `safeStorage` before persistence. They are never exposed back to a renderer; renderer responses contain only `hasApiKey` and `hasPrivateKey` flags.
- Process environment values have highest precedence, preserving existing deployment and Windows-user configuration.
- Persisted values are loaded into the backend environment before `startPythonService()` so both platforms use the same FastAPI service without a second configuration protocol.
- If secure storage is unavailable, saving a new secret fails clearly without logging or writing the secret in plaintext. Existing process-environment configuration remains usable.

### Renderer and IPC boundaries

Expose a bounded `platform` string and the two application-preference methods through the main-window preload. Do not expose Electron objects, file paths, raw credentials, or arbitrary IPC channels.

The main renderer uses the bounded platform value to omit the Windows title bar and display macOS-only settings. It keeps the shared navigation and page logic unchanged. Optional DOM lookup is used only for platform-conditional controls.

The menu panel keeps its dedicated preload. Its status, Codex, and DeepSeek reads continue through existing narrow methods. Only the menu panel's live `webContents` may update the native temperature title or hide itself. Main-process handlers validate sender ownership and normalize payloads before native API calls.

## Data Flow

1. Electron loads validated service settings and injects the effective values into the child-service environment.
2. Electron starts FastAPI, waits for health when possible, then creates the shared main window and the surfaces selected by `startupPolicy`.
3. The main renderer obtains FastAPI status, Codex usage, and DeepSeek usage through the existing preload bridge. It updates existing DOM nodes and preserves content scroll position.
4. The macOS menu renderer independently refreshes the same sources on its existing 30-second interval and reduces results through `menuBarModel` so failures remain isolated by source.
5. The menu renderer sends only its temperature value to the main process. `macMenuBar` bounds and formats the native title.
6. Explicit Refresh bypasses appropriate caches without closing or rebuilding the menu panel.
7. Successful source results replace their cached values and timestamps. Failed sources preserve their last successful values when available and show unavailable state otherwise.

## Lifecycle and Error Handling

- Backend startup failure is logged without secrets and does not prevent native navigation surfaces from appearing. Renderers show their existing offline fallbacks and can recover on a later refresh.
- A menu bar construction failure logs a concise error and opens the macOS main window so the application remains reachable.
- Corrupt preference or non-secret service-settings files recover to safe defaults. Corrupt encrypted secrets are ignored and reported as unconfigured.
- Main window, Windows Tray, floating window, macOS menu controller, and menu panel creation are idempotent. Re-creation does not register duplicate handlers.
- Destroyed windows, Tray objects, and stale renderer senders cannot perform native actions.
- Single-instance activation, Dock activation, Tray actions, and menu actions all route through the same `showMainWindow(section)` boundary.
- `before-quit` sets the quitting flag, destroys the macOS controller once, and stops the Python service.
- Data-source failures never remove Open WinPlate, Settings, Refresh, or Quit.

## Security and Accessibility

- Retain context isolation, sandboxing, disabled Node integration, strict CSP, and narrow preload bridges for every renderer.
- Validate URLs, settings shapes, coordinates, temperature payloads, navigation destinations, and native sender ownership in the main process.
- Never log, echo, or return API keys or private keys.
- Preserve keyboard focus visibility, semantic buttons, progress values, Escape dismissal, and labels for status points and actions.
- Respect system light/dark appearance through native Template Image behavior, window vibrancy, and existing theme variables.
- Do not communicate source health by color alone.

## Verification Strategy

### Automated tests

- Preserve all tests on `codex/macos-menu-bar` as the baseline.
- Add pure tests for Windows and macOS main-window options, including unchanged Windows dimensions and native macOS dimensions and chrome.
- Add application-preference tests for defaults, normalization, atomic persistence, corrupt-file recovery, login-item application, and live menu-controller transitions.
- Add service-settings tests for precedence, validation, encryption/decryption through injected fakes, secret redaction, atomic writes, corrupt data, and unavailable secure storage.
- Extend static and renderer tests for the platform bridge, macOS title-bar omission, Windows control preservation, macOS-only settings, and prohibited capsule UI.
- Retain menu controller tests for click routing, right-click actions, multi-display positioning, load failure, teardown, sender ownership, and bounded temperature titles.
- Run the Python backend suite through one cross-platform virtual-environment resolver.
- Add a GitHub Actions matrix for `windows-latest` and `macos-latest` that installs Node and Python dependencies and runs the Node and backend suites.

### Runtime verification

On macOS, verify and capture the menu bar closed state, open panel, native main window, Settings, light and dark themes, menu enable/disable, launch-at-login persistence, restart persistence for service settings, partial failures, total offline state, and close/reopen lifecycle.

On Windows, verify the initial capsule, Tray menu, Tray double click, frameless main window controls, close-to-hide, pin and click-through behavior, tooltips, Settings, live refresh, partial failures, and restart persistence. Automated platform-policy tests and CI are necessary but do not substitute for this real-device checklist.

Repository verification requires `npm run check`, `npm run backend:test`, `git diff --check`, a clean status for the delivered scope, and review of all runtime evidence. Tests must be inspected to ensure they cover the requirements rather than treated as proof by test count alone.

## Completion Criteria

The iteration is complete only when all of the following are true:

- One integrated branch contains the approved Windows experience and the approved macOS menu bar experience.
- macOS has its native main window, persisted menu-bar and login preferences, durable service configuration, and no desktop capsule code path or setting.
- Windows retains its current main window, Tray, capsule, pin, tooltip, and startup behavior.
- Both platforms use the shared FastAPI/SQLite data layer and recover locally from partial or complete source failure.
- Security, accessibility, lifecycle, and persistence requirements above are covered by focused tests.
- Node and backend checks pass on macOS and Windows CI.
- macOS and Windows runtime checklists have direct evidence; missing real-device evidence remains explicitly incomplete.
- The repository documents setup and behavior for both development platforms.

## Out of Scope

- A macOS desktop capsule or compact status-digest title.
- Quota severity colors, alerts, notifications, or medical interpretation.
- New external data sources.
- Signed Windows installers, DMG packaging, macOS notarization, auto-update, and release distribution.
- Linux, web, mobile, or watch clients.
