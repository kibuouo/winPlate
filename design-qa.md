# Design QA

## Dual-platform completion QA — 2026-07-01

This is the current completion audit and does not claim a Windows visual pass.

- Host: macOS 26.5.1 (25F80), Apple silicon
- Tested implementation: `c244dbc4ae7738ebf6e72aabdb16499465617480`
- Panel: `docs/qa/2026-07-01-macos-menu-panel-open.png` (retained
  unavailable-state capture from `910a053`; not current-head evidence)
- Settings: `docs/qa/2026-07-01-macos-settings.png` (refreshed on `c244dbc`)
- Detailed evidence and limitations: `docs/verification/dual-platform-smoke.md`

The refreshed current-head light-appearance Settings capture shows the shared
Sidebar, no Windows custom title-bar markup, and exactly the two macOS
Application settings (Menu bar status and Launch at login). The retained older
dark panel capture shows the neutral unavailable structure and Codex → DeepSeek
→ Weather → Actions order, but is not current-head evidence. Current-head Core
Graphics reported the main window at the 1040 × 720 policy bounds, the panel at
320 × 420, and no 460 × 104 desktop capsule window. This is structural evidence
only: native frame, traffic-light, status-icon, and anchored-placement pixels
were not captured.

Computer Use attached to an unrelated Electron process and was not used for UI
actions or retried. Current-head Accessibility did not expose the status item,
and native screen capture was unavailable. Therefore the closed menu-bar
screenshot and icon, anchored placement, right-click menu, native frame/traffic lights,
Escape/blur, close/reopen, direct light-theme view, refresh-in-place, keyboard
focus, menu enable/disable, service configured flags/redaction and restart
persistence, deliberate total-outage recovery, and launch-at-login runtime
application remain incomplete. Launch at login was not toggled because doing so
requires action-time confirmation for a local system-setting change. No secrets
were read or entered.

No Windows host was available. Windows visual/runtime QA remains incomplete;
passing Windows policy tests and the presence of the CI matrix are not presented
as a Windows visual pass. The workflow has no recorded remote run URL yet.

The current head includes the final native-surface lifecycle and transactional
settings-persistence fixes and remained stable through repeated backend reads;
their unexercised native transitions and rollback paths remain test-only.

Current verification: Node 219/219 total pass (7 precheck + 212 main), backend
20/20 pass, `git diff --check` pass, and `npm audit --omit=dev` reports 0
vulnerabilities. Overall result:
**DONE_WITH_CONCERNS**.
