# Design QA

## Dual-platform completion QA — 2026-07-01

This is the current completion audit and does not claim a Windows visual pass.

- Host: macOS 26.5.1 (25F80), Apple silicon
- Tested implementation: `910a053287e04d4cecff7c4e1a51609538a46e1f`
- Panel: `docs/qa/2026-07-01-macos-menu-panel-open.png`
- Settings: `docs/qa/2026-07-01-macos-settings.png`
- Detailed evidence and limitations: `docs/verification/dual-platform-smoke.md`

The two safe current dark-theme captures show legible neutral quota/status
treatment, Codex → DeepSeek → Weather → Actions panel order, and the Settings
renderer with the shared Sidebar, no Windows custom title-bar markup, and
exactly the two macOS Application settings (Menu bar status and Launch at
login). Core Graphics reported the main window at the 1040 × 720 policy bounds
and no desktop capsule window. This is structural evidence only: native frame,
traffic-light, status-icon, and anchored-placement pixels were not captured.

Computer Use could not establish an active Electron attachment, and native
screen capture was unavailable. Therefore the closed menu-bar screenshot and
icon, anchored placement, right-click menu, native frame/traffic lights,
Escape/blur, close/reopen, direct light-theme view, refresh-in-place, keyboard
focus, menu enable/disable, service configured flags/redaction and restart
persistence, deliberate total-outage recovery, and launch-at-login runtime
application remain incomplete. Launch at login was not toggled because doing so
requires action-time confirmation for a local system-setting change. No secrets
were read or entered.

No Windows host was available. Windows visual/runtime QA remains incomplete;
passing Windows policy tests and the presence of the CI matrix are not presented
as a Windows visual pass. The workflow has no recorded remote run URL yet.

Current verification: Node 196/196 pass, backend 20/20 pass, `git diff --check`
pass, and `npm audit --omit=dev` reports 0 vulnerabilities. Overall result:
**DONE_WITH_CONCERNS**.
