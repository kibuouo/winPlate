# Dual-platform smoke verification

- Date: 2026-07-01
- Branch: `codex/macos-menu-bar`
- Implementation SHA tested: `c244dbc4ae7738ebf6e72aabdb16499465617480`
- Host: macOS 26.5.1 (25F80), Apple silicon (`arm64`)

This report distinguishes direct runtime observations from executable tests. A
platform-policy test is not treated as real-device evidence.

## Repository commands

| Command | Result |
| --- | --- |
| `npm run check` | pass — 219 total tests (7 precheck + 212 main), 219 passed, 0 failed/skipped/cancelled |
| `npm run backend:test` | pass — 20 tests, `OK` |
| `git diff --check` | pass |
| `npm audit --omit=dev` | pass — 0 vulnerabilities |
| prohibited runtime identifier search (exact command below) | pass — no matches; historical specs/plans and this command-bearing report are excluded |
| final process cleanup | pass — development WinPlate and its backend were stopped; port 8765 had no listener |

```sh
if rg -n '(desktopCapsule|menuBarDisplay|renderMacFloating|mac-floating)' src README.md docs/verification --glob '!*.test.js' --glob '!dual-platform-smoke.md'; then exit 1; fi
```

The current-head worktree was clean and port 8765 had no listener before launch.
The run logged FastAPI startup completion,
`Uvicorn running on http://127.0.0.1:8765`, and `GET /api/health` 200. It remained
stable through initial weather/status reads and two subsequent 30-second status
reads, all 200, with no uncaught main-process error.

Computer Use was invoked once before UI actions, but it attached to an unrelated
Electron process in another worktree. No Computer Use action was sent and the
attachment was not retried. Accessibility, Core Graphics window metadata, and
Chromium DevTools Protocol renderer capture were used as bounded fallbacks. The
current Electron Accessibility tree did not expose the status item. Native
screen capture remained unavailable in this environment, so claims that require
native pixels remain incomplete.

The current head includes the final native-surface lifecycle and transactional
settings-persistence fixes. Their presence did not destabilize this current-head
runtime observation, but the native lifecycle transitions and settings failure/
rollback behaviors were not directly exercised.

## macOS checklist

| Runtime item | Result | Direct evidence |
| --- | --- | --- |
| One menu item with icon/temperature fallback; no desktop capsule | incomplete | Current-head Accessibility did not expose the status item. Current-head Core Graphics listed the 320 × 420 panel and 1040 × 720 main window, with no 460 × 104 capsule window. Status title/icon pixels and the closed state were unavailable. |
| Left click opens a panel beneath the item | incomplete | Current-head Core Graphics and CDP found the 320 × 420 panel/page, but Accessibility did not expose the status item and its default action was not exercised. Item/panel coordinates, visibility, anchoring, and native pixels remain unverified. The retained panel content image is from the earlier `910a053` run: [2026-07-01-macos-menu-panel-open.png](../qa/2026-07-01-macos-menu-panel-open.png). |
| Right-click menu contains Open WinPlate, Settings, Refresh, Quit | incomplete | Computer Use could not establish an active Electron session, so right-click was not exercised. The exact menu remains covered by the executable `macMenuBar` test. |
| Escape/blur hides the panel | incomplete | Not directly exercised in this run; covered by renderer/controller tests. |
| Panel order Codex, DeepSeek, Weather, Actions; neutral bars/status; actions reachable | incomplete | The retained `910a053` panel capture shows the order and neutral unavailable state. On the current head, the panel preload bridge directly opened Settings, but a new panel capture was intentionally skipped because a safe unavailable state could not be guaranteed without exposing live account-derived usage. |
| Explicit refresh updates in place | incomplete | The Refresh control is present in the direct panel capture, but no before/after runtime observation proves in-place update behavior. Executable renderer/controller tests are indirect evidence only. |
| Native main window, Sidebar, no Windows custom title bar | incomplete | Current-head Core Graphics reported `WinPlate` at the 1040 × 720 policy bounds and on-screen after the panel bridge opened Settings. The refreshed safe Settings renderer capture proves the shared Sidebar and absence of Windows title-bar markup, but the native frame and traffic lights were not verified. |
| Close hides; Dock/menu action reopens | incomplete | Main-window opening from the menu panel was directly observed. The locked/unavailable GUI session prevented a trustworthy native close/reopen observation. |
| Settings contains exactly Menu bar status and Launch at login, no capsule option | pass | [2026-07-01-macos-settings.png](../qa/2026-07-01-macos-settings.png) shows exactly those two macOS Application toggles and no capsule setting. |
| Menu-bar enable/disable recreates once | incomplete | Not toggled because the unavailable native UI made same-session restoration unreliable. Focused lifecycle tests pass. |
| Launch at login applies/persists | incomplete | Deliberately not toggled: it changes a local system setting and no action-time confirmation was obtained. Focused normalization/application tests pass but are not runtime evidence. |
| Light/dark legibility | incomplete | The refreshed current-head Settings capture is legible in the current light appearance; the retained panel capture is older dark-appearance evidence. Theme switching was not performed because the GUI automation session could not reliably restore it. |
| Keyboard focus visibility | incomplete | No direct keyboard traversal or focus-ring observation was completed; executable accessibility styling tests are indirect evidence only. |
| Service configuration and redaction | incomplete | No service fields, configured flags, save behavior, or returned values were directly observed. Renderer/main boundary tests cover configured flags and secret redaction, but do not substitute for runtime evidence. |
| Service-settings restart persistence | incomplete | No service setting was changed and no restart-persistence cycle was performed. Focused persistence tests are indirect evidence only. |
| Partial/offline recovery | incomplete | The panel directly displayed stable unavailable fallbacks while retaining all actions. A deliberate total outage was not induced because it could disturb user configuration; executable reducer/controller tests cover source isolation and recovery. |

There is no new closed-state screenshot: current-head Accessibility did not
expose the status item, and native capture remained unavailable. The safe Settings
renderer capture was refreshed on `c244dbc`; the unavailable-state panel capture
is retained from `910a053` and is not represented as current-head evidence. No
sensitive contents were observed in either retained image.

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
| Both platforms share FastAPI/SQLite and recover from partial/complete failure | Current-head macOS FastAPI health and repeated status reads returned 200; the stable panel fallback capture is retained from `910a053`. Focused backend/reducer tests pass, but Windows and deliberate complete-outage runtime evidence are absent. | incomplete |
| Security, accessibility, lifecycle, persistence requirements have focused tests | `npm run check` passed 219 total focused tests (7 precheck + 212 main), including activation coordination, native reuse/replacement, sender ownership, CSP, semantic controls, transactional settings rollback, encryption/redaction, lifecycle, and persistence. | pass |
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
