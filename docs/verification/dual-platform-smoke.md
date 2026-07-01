# Dual-platform smoke verification

- Date: 2026-07-01
- Branch: `codex/macos-menu-bar`
- Implementation SHA tested: `4191b39dff01f053c2bc149b465920202c83caee`
- Host: macOS 26.5.1 (25F80), Apple silicon (`arm64`)

This report distinguishes direct runtime observations from executable tests. A
platform-policy test is not treated as real-device evidence.

## Repository commands

| Command | Result |
| --- | --- |
| `npm run check` | pass — 222 total tests (7 precheck + 215 main), 222 passed, 0 failed/skipped/cancelled |
| `npm run backend:test` | pass — 20 tests, `OK` |
| `git diff --check` | pass |
| `npm audit --omit=dev` | pass — 0 vulnerabilities |
| prohibited runtime identifier search (exact command below) | pass — no matches; historical specs/plans and this command-bearing report are excluded |
| final process cleanup | pass — development WinPlate and its backend were stopped; port 8765 had no listener |

```sh
if rg -n '(desktopCapsule|menuBarDisplay|renderMacFloating|mac-floating)' src README.md docs/verification --glob '!*.test.js' --glob '!dual-platform-smoke.md'; then exit 1; fi
```

Port 8765 had no listener before launch. The run logged FastAPI startup completion,
`Uvicorn running on http://127.0.0.1:8765`, and `GET /api/health` 200. It remained
stable through repeated 30-second status reads, all 200. The application ran with
an isolated `/tmp/winplate-qa-16f947e` user-data directory, service environment
variables removed, and Codex absent from `PATH`, so retained menu-panel evidence
contains only unavailable-state placeholders.

Computer Use was targeted by the current worktree's full Electron application
path. Native `screencapture`, Accessibility, Core Graphics window metadata, and
Chromium DevTools Protocol were used together. Runtime inspection exposed a
classic-script lexical collision that prevented `menubar.js` from initializing;
`37a368b` fixes it and adds a regression test that compiles the shared model and
renderer in one classic-script scope. After the fix, the cold-start panel had one
listener on each action, refreshed, navigated, and dismissed correctly.

Partial-source recovery used a temporary HTTPS server bound only to
`127.0.0.1:9443`, a one-day self-signed certificate, a dummy API key, and a
fictional CNY 12.34 balance. TLS verification was disabled only in that isolated
test process. DeepSeek transitioned `Normal → Unavailable → Normal`; the panel
kept the last successful balance during the failure while Codex and weather
remained unavailable.

## macOS checklist

| Runtime item | Result | Direct evidence |
| --- | --- | --- |
| One menu item with icon/temperature fallback; no desktop capsule | pass | Native menu-bar pixels show the supplied Template Image and `--°` fallback in [the right-click capture](../qa/2026-07-01-macos-menu-right-click-current.png). Core Graphics listed only the 320 × 420 panel and 1040 × 720 main window for WinPlate; no 460 × 104 capsule existed. [Dock evidence](../qa/2026-07-01-macos-dock-current.png) also shows the scaled current application icon. |
| Left click opens a panel beneath the item | pass | The status item occupied `x=765..822`; the opened panel occupied `x=634..954, y=38..458`, so both centers were exactly `x=794`. [Current-head panel capture](../qa/2026-07-01-macos-menu-panel-current.png). |
| Right-click menu contains Open WinPlate, Settings, Refresh, Quit | pass | A native right-click event produced the exact four-item menu in [2026-07-01-macos-menu-right-click-current.png](../qa/2026-07-01-macos-menu-right-click-current.png). |
| Escape/blur hides the panel | pass | After the fix, a real renderer Escape event changed panel BrowserWindow id 3 from `visible=true` to `visible=false` without destruction. Activating Finder independently hid the open panel through its native blur handler. |
| Panel order Codex, DeepSeek, Weather, Actions; neutral bars/status; actions reachable | pass | [Current-head panel capture](../qa/2026-07-01-macos-menu-panel-current.png) shows the required order and neutral unavailable state. Cold-start runtime inspection found one listener on each action; Open WinPlate displayed the main window and Settings navigated to Settings. |
| Explicit refresh updates in place | pass | Clicking Refresh retained BrowserWindow id 3, the same 320 × 420 bounds, and `visible=true`; it did not rebuild or close the panel. |
| Native main window, Sidebar, no Windows custom title bar | pass | Core Graphics measured 1040 × 720. [Light Settings](../qa/2026-07-01-macos-settings-current.png) and [dark Settings](../qa/2026-07-01-macos-settings-dark-current.png) show native traffic lights, the shared Sidebar, and no Windows title bar. |
| Close hides; Dock/menu action reopens | pass | Native close left main BrowserWindow id 1 `destroyed=false, visible=false` while the menu item remained. The repaired panel action then made the same main window visible immediately. |
| Settings contains exactly Menu bar status and Launch at login, no capsule option | pass | [Current Settings capture](../qa/2026-07-01-macos-settings-current.png) shows exactly those two macOS Application toggles and no capsule setting. |
| Menu-bar enable/disable recreates once | pass | Disabling removed status item window id 2037 and destroyed the panel; re-enabling created exactly one replacement item, id 2060. The setting was restored to enabled in the same session and persisted across restart. |
| Launch at login applies/persists | pass | With explicit confirmation, the isolated setting was changed from off to on. Electron reported the login item enabled, the renderer persisted `launchAtLogin: true`, and both remained on after a full restart. [The enabled-state capture](../qa/2026-07-01-macos-launch-at-login-enabled-current.png) shows the checked control. It was then restored to off; a second restart retained `launchAtLogin: false`, and System Events listed no WinPlate/Electron login item. |
| Light/dark legibility | pass | Current-head light and dark main-window captures are legible. With explicit confirmation, macOS Appearance was temporarily changed from Auto to Dark; [the native dark-system panel capture](../qa/2026-07-01-macos-menu-panel-dark-current.png) shows legible status sections, neutral bars, and actions. Appearance was restored to the original Auto selection immediately afterward. |
| Keyboard focus visibility | pass | Tab traversal reached Open WinPlate, Refresh, then Settings in order. [The current-head focus capture](../qa/2026-07-01-macos-keyboard-focus-current.png) shows the visible blue focus ring. |
| Service configuration and redaction | pass | Isolated dummy QWeather and DeepSeek values saved successfully. Renderer returns contained only `hasApiKey` plus public Host/URL; [dark Settings](../qa/2026-07-01-macos-settings-dark-current.png) shows configured flags and blank secret fields. `rg` found neither dummy plaintext in the isolated user-data directory; `service-settings.json` contained ciphertext only. |
| Service-settings restart persistence | pass | After a complete app/backend restart with the same isolated user-data directory, both services returned `hasApiKey: true`, their public Host/URL, and no secret. Theme and menu-enabled settings also persisted. |
| Partial/offline recovery | pass | The isolated current-head panel displayed total-outage fallbacks while retaining all actions. A local dummy DeepSeek source then produced [the partial-success state](../qa/2026-07-01-macos-partial-source-current.png); stopping it changed only DeepSeek to unavailable while retaining ¥12.34, and restarting it restored Active without rebuilding the panel. |

After capture, the development WinPlate process and child backend were stopped.
An independent final check found no listener on port 8765.

## Windows checklist

| Runtime item | Result |
| --- | --- |
| Initial 460 × 104 capsule | accepted — existing stable Windows version; additional real-device rerun waived by product owner |
| Tray menu and Tray double click | accepted — existing stable Windows version; additional real-device rerun waived by product owner |
| Frameless main window and controls | accepted — existing stable Windows version; additional real-device rerun waived by product owner |
| Close-to-hide lifecycle | accepted — existing stable Windows version; additional real-device rerun waived by product owner |
| Pin and click-through behavior | accepted — existing stable Windows version; additional real-device rerun waived by product owner |
| Tooltips | accepted — existing stable Windows version; additional real-device rerun waived by product owner |
| Settings and live refresh | accepted — existing stable Windows version; additional real-device rerun waived by product owner |
| Partial/total failure behavior | accepted — existing stable Windows version; additional real-device rerun waived by product owner |
| Restart persistence | accepted — existing stable Windows version; additional real-device rerun waived by product owner |

## CI

The matrix workflow at `.github/workflows/test.yml` ran both suites on
`macos-latest` and `windows-latest`. [Run 28507139090](https://github.com/kibuouo/winPlate/actions/runs/28507139090)
completed successfully at implementation SHA `4191b39`: the macOS job passed in
28 seconds and the Windows job passed in 1 minute 36 seconds. The first run
exposed a timezone-bound assertion and overlapping Windows settings-file
renames; the committed fix serializes complete per-file write transactions and
uses platform-native test expectations.

## Completion Criteria audit

| Completion criterion | Evidence | Result |
| --- | --- | --- |
| One integrated branch contains the approved Windows and macOS experiences | The branch is pushed at `4191b39`; startup/window policy and renderer tests pass on both CI operating systems, and README documents both. | pass |
| macOS native main window, persisted menu/login preferences, durable service configuration, and no capsule path/setting | Native chrome, menu recreation, launch-at-login application/restoration, service configuration/redaction, and restart persistence have direct evidence. | pass |
| Windows retains main window, Tray, capsule, pin, tooltip, startup behavior | Focused Windows policy/static tests and the Windows CI job pass. The product owner accepted the existing stable Windows version and waived an additional real-device rerun. | pass — accepted scope |
| Both platforms share FastAPI/SQLite and recover from partial/complete failure | Current-head macOS FastAPI health and repeated status reads returned 200; direct total-outage fallback and isolated `Normal → Unavailable → Normal` source recovery passed. Both backend suites pass on macOS and Windows CI. | pass |
| Security, accessibility, lifecycle, persistence requirements have focused tests | `npm run check` passed 222 total focused tests (7 precheck + 215 main), including real-browser script-scope coverage, Windows rename-collision regressions, activation coordination, sender ownership, CSP, semantic controls, transactional rollback, encryption/redaction, lifecycle, and persistence. | pass |
| Node/backend checks pass on macOS and Windows CI | [Run 28507139090](https://github.com/kibuouo/winPlate/actions/runs/28507139090) passed both Node and backend suites on `macos-latest` and `windows-latest`. | pass |
| Runtime acceptance matches the approved delivery scope | The complete macOS direct evidence is linked above. The product owner explicitly accepted the existing stable Windows version without an additional real-device rerun. | pass — accepted scope |
| Repository documents setup/behavior for both development platforms | `README.md` includes macOS/Windows setup, surfaces, backend, settings, security boundary, and verification commands. | pass |

## Delivery decision

No delivery blockers remain in the approved scope. The current macOS runtime,
native pixels, panel interactions, keyboard path, encrypted settings, and restart
persistence are directly verified, including launch-at-login and native dark
appearance with both temporary system changes restored. The existing stable
Windows version is accepted without another real-device run, and both remote CI
operating-system jobs pass.

Overall status: **DONE**.
