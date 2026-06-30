# Dual-platform smoke verification

- Date: 2026-07-01
- Branch: `codex/macos-menu-bar`
- Implementation SHA tested: `910a053287e04d4cecff7c4e1a51609538a46e1f`
- Host: macOS 26.5.1 (25F80), Apple silicon (`arm64`)

This report distinguishes direct runtime observations from executable tests. A
platform-policy test is not treated as real-device evidence.

## Repository commands

| Command | Result |
| --- | --- |
| `npm run check` | pass — 196 tests, 196 passed, 0 failed/skipped/cancelled |
| `npm run backend:test` | pass — 20 tests, `OK` |
| `git diff --check` | pass |
| `npm audit --omit=dev` | pass — 0 vulnerabilities |
| prohibited runtime identifier search (exact command below) | pass — no matches; historical specs/plans and this command-bearing report are excluded |
| final process cleanup | pass — development WinPlate and its backend were stopped; port 8765 had no listener |

```sh
if rg -n '(desktopCapsule|menuBarDisplay|renderMacFloating|mac-floating)' src README.md docs/verification --glob '!*.test.js' --glob '!dual-platform-smoke.md'; then exit 1; fi
```

The initial worktree was clean. During the first launch, an orphaned backend
from this same worktree was found listening on port 8765. It was stopped before
the coherent run. The clean run logged FastAPI startup completion,
`Uvicorn running on http://127.0.0.1:8765`, and `GET /api/health` 200. It stayed
alive for approximately 20 minutes while the renderer performed periodic status
reads, with no uncaught main-process error.

Computer Use was invoked before UI actions, but its Electron attachment returned
only `remoteConnection`/timed out and did not establish an active session. The
first attempted attachment coincided with an Electron `SIGSEGV`; a clean retry
without attachment remained stable, so this is recorded as an automation
attachment concern rather than a reproduced product defect. Accessibility,
Core Graphics window metadata, and Chromium DevTools Protocol renderer capture
were used as bounded fallbacks. Full-screen capture was black and window-only
`screencapture` failed, so claims that require native pixels remain incomplete.

## macOS checklist

| Runtime item | Result | Direct evidence |
| --- | --- | --- |
| One menu item with icon/temperature fallback; no desktop capsule | incomplete | Accessibility proves one app status item titled `--°`, and Core Graphics listed only `WinPlate 状态` (320 × 420) and `WinPlate` (1040 × 720 policy bounds), with no capsule window. Icon pixels and the closed state were unavailable. |
| Left click opens a panel beneath the item | incomplete | Accessibility `AXPress` proves the status item's default action opened `WinPlate 状态`, and Core Graphics reported a 320 × 420 on-screen panel. Item/panel coordinates and native pixels were unavailable, so anchoring beneath the item is unverified. Panel content: [2026-07-01-macos-menu-panel-open.png](../qa/2026-07-01-macos-menu-panel-open.png). |
| Right-click menu contains Open WinPlate, Settings, Refresh, Quit | incomplete | Computer Use could not establish an active Electron session, so right-click was not exercised. The exact menu remains covered by the executable `macMenuBar` test. |
| Escape/blur hides the panel | incomplete | Not directly exercised in this run; covered by renderer/controller tests. |
| Panel order Codex, DeepSeek, Weather, Actions; neutral bars/status; actions reachable | pass | Direct panel capture shows the fixed order, gray status points, neutral bars, and Open WinPlate/Refresh/Settings actions. The panel bridge directly opened the main Codex and Settings destinations. |
| Explicit refresh updates in place | incomplete | The Refresh control is present in the direct panel capture, but no before/after runtime observation proves in-place update behavior. Executable renderer/controller tests are indirect evidence only. |
| Native main window, Sidebar, no Windows custom title bar | incomplete | Core Graphics reported `WinPlate` at the 1040 × 720 policy bounds and on-screen after an app action. The safe Settings renderer capture proves the shared Sidebar and absence of Windows title-bar markup, but the native frame and traffic lights were not verified. |
| Close hides; Dock/menu action reopens | incomplete | Main-window opening from the menu panel was directly observed. The locked/unavailable GUI session prevented a trustworthy native close/reopen observation. |
| Settings contains exactly Menu bar status and Launch at login, no capsule option | pass | [2026-07-01-macos-settings.png](../qa/2026-07-01-macos-settings.png) shows exactly those two macOS Application toggles and no capsule setting. |
| Menu-bar enable/disable recreates once | incomplete | Not toggled because the unavailable native UI made same-session restoration unreliable. Focused lifecycle tests pass. |
| Launch at login applies/persists | incomplete | Deliberately not toggled: it changes a local system setting and no action-time confirmation was obtained. Focused normalization/application tests pass but are not runtime evidence. |
| Light/dark legibility | incomplete | Current dark appearance is legible in both safe captures. Theme switching was not performed because the GUI automation session could not reliably restore it. |
| Keyboard focus visibility | incomplete | No direct keyboard traversal or focus-ring observation was completed; executable accessibility styling tests are indirect evidence only. |
| Service configuration and redaction | incomplete | No service fields, configured flags, save behavior, or returned values were directly observed. Renderer/main boundary tests cover configured flags and secret redaction, but do not substitute for runtime evidence. |
| Service-settings restart persistence | incomplete | No service setting was changed and no restart-persistence cycle was performed. Focused persistence tests are indirect evidence only. |
| Partial/offline recovery | incomplete | The panel directly displayed stable unavailable fallbacks while retaining all actions. A deliberate total outage was not induced because it could disturb user configuration; executable reducer/controller tests cover source isolation and recovery. |

There is no new closed-state screenshot: the menu item was confirmed through
Accessibility, but native screen capture returned black. The two remaining safe
captures are the unavailable-state panel and the Settings renderer. No sensitive
contents were observed in either retained image.

After capture, the development WinPlate process and child backend were stopped.
An independent final check found no listener on port 8765.

## Windows checklist

| Runtime item | Result |
| --- | --- |
| Initial 460 × 104 capsule | incomplete — Windows host unavailable |
| Tray menu and Tray double click | incomplete — Windows host unavailable |
| Frameless main window and controls | incomplete — Windows host unavailable |
| Close-to-hide lifecycle | incomplete — Windows host unavailable |
| Pin and click-through behavior | incomplete — Windows host unavailable |
| Tooltips | incomplete — Windows host unavailable |
| Settings and live refresh | incomplete — Windows host unavailable |
| Partial/total failure behavior | incomplete — Windows host unavailable |
| Restart persistence | incomplete — Windows host unavailable |

## CI

The matrix workflow is present at `.github/workflows/test.yml` and defines
`macos-latest` and `windows-latest` jobs that run both suites. This branch was
not pushed as part of this audit, so a run URL and successful macOS/Windows jobs
are **incomplete**. Local policy tests do not substitute for those jobs.

## Completion Criteria audit

| Completion criterion | Evidence | Result |
| --- | --- | --- |
| One integrated branch contains the approved Windows and macOS experiences | Startup/window policy and renderer tests pass on the integrated branch; README documents both. No Windows runtime host was available. | incomplete |
| macOS native main window, persisted menu/login preferences, durable service configuration, and no capsule path/setting | Core Graphics observed policy-sized main/panel windows and no capsule; the safe Settings renderer shows the shared Sidebar and two macOS toggles. Native chrome, menu preference recreation, launch-at-login, and service restart persistence were not directly observed. | incomplete |
| Windows retains main window, Tray, capsule, pin, tooltip, startup behavior | Focused Windows policy/static tests pass. | incomplete — Windows runtime unavailable |
| Both platforms share FastAPI/SQLite and recover from partial/complete failure | macOS FastAPI health 200 and direct stable panel fallbacks; focused backend/reducer tests pass. Windows and deliberate complete-outage runtime evidence are absent. | incomplete |
| Security, accessibility, lifecycle, persistence requirements have focused tests | `npm run check` passed 196 focused tests including sender ownership, CSP, semantic controls, settings encryption/redaction, lifecycle, and persistence. | pass |
| Node/backend checks pass on macOS and Windows CI | Local macOS checks pass; workflow exists. No remote workflow run exists. | incomplete |
| macOS and Windows runtime checklists have direct evidence | Partial macOS direct evidence is linked above; Windows has none. | incomplete |
| Repository documents setup/behavior for both development platforms | `README.md` includes macOS/Windows setup, surfaces, backend, settings, security boundary, and verification commands. | pass |

## Remaining blockers and actions

- Run the complete Windows checklist on a real Windows device and attach direct evidence.
- Push the branch when authorized and obtain successful GitHub Actions URLs for
  both `macos-latest` and `windows-latest` jobs.
- Repeat the macOS native-pixel checklist in an interactive capture-capable
  session: closed menu bar, anchored placement, right-click menu, traffic lights,
  Escape/blur, close/reopen, and restored light/dark switching.
- With explicit action-time confirmation, observe launch-at-login application and
  persistence; it was intentionally not changed here.
- Re-run menu-bar enable/disable with reliable same-session restoration.
- Directly observe explicit Refresh updating values in place without closing or
  rebuilding the panel.
- Traverse the panel and main renderer by keyboard and verify visible focus for
  every actionable control.
- Using safe non-production test credentials/data and without committing any
  secret, observe service configured-flag/redaction behavior and verify settings
  persistence across a restart.
- Deliberately stop all data sources in a safe test configuration, verify total
  outage fallbacks and retained actions, then restore sources and verify recovery.

Overall status: **DONE_WITH_CONCERNS** — coherent local macOS process, backend,
renderer, and partial visual evidence are present; external Windows, remote CI,
and confirmation-gated/native-capture items remain incomplete.
