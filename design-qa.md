# Design QA

- Source visual truth: `/tmp/codex-remote-attachments/019f11b8-c332-7bb3-99a0-60beda859ce2/81A40378-ACED-42CF-950A-A8C32EFA8E9C/1-照片-1.jpg`
- Implementation target: WinPlate native macOS menu bar item and anchored status panel
- Viewport: macOS 1440 × 900 points (2880 × 1800 capture)
- State: dark system appearance with Codex, DeepSeek, and weather unavailable fallbacks
- Combined reference/implementation evidence: `docs/qa/macos-menu-bar-2026-06-29-comparison.png`

## Visual comparison findings

- The implementation preserves the sketch's single menu bar item, temperature title, narrow anchored panel, and Codex → DeepSeek → weather order.
- The panel uses native macOS placement and vibrancy while retaining WinPlate's existing neutral surfaces, dividers, typography, progress bars, and action treatment.
- Codex and DeepSeek use the Windows green-active / gray-unavailable status points. Codex quota values never introduce yellow or red warning presentation.
- The final 16 px QWeather template image remains crisp in the menu bar and appears beside the `--°` failure title.
- No overlapping controls, clipped rows, horizontal overflow, desktop floating capsule, or detached tooltip window were found.

## macOS menu bar smoke test — 2026-06-29

- [x] Left click opens and closes the panel beneath the status item.
- [x] Right click offers Open WinPlate, Settings, Refresh, and Quit.
- [x] Blur dismisses the panel in the running app; Escape dismissal passes the renderer interaction test.
- [x] Deterministic bounds tests keep the panel on-screen at left/right edges, short work areas, and negative-coordinate secondary displays.
- [x] Dark appearance was inspected in the running app; light/dark template image, text, divider, weather-icon, and focus styling pass regression coverage.
- [x] No macOS desktop floating capsule is created.
- [x] Codex shows 5-hour and 7-day values with neutral progress bars.
- [x] Codex and DeepSeek use the Windows green active / gray unavailable status points.
- [x] Quota changes never add yellow or red presentation.
- [x] DeepSeek unconfigured/unavailable states do not fabricate a balance and retain the Settings route.
- [x] Weather failure keeps the status item visible as `--°`.
- [x] Refresh updates values in place without closing or rebuilding the panel.
- [x] Partial and all-source failures keep Open WinPlate, Settings, Refresh, and Quit usable.

## Patches made during QA

- Replaced the oversized illustration source with a crisp monochrome QWeather template icon converted from the installed icon library.
- Added a dedicated seven-method menu bar preload bridge; the main-window preload no longer exposes menu-only channels.
- Kept initial and 30-second refreshes cache-aware while reserving forced reads for explicit button/native-menu refreshes.
- Added a platform-neutral virtualenv Python launcher so `npm run backend:test` works on both macOS and Windows.
- Added regression coverage for the menu bar icon source, narrow bridge, refresh policy, and cross-platform Python launcher.

## Verification

- `npm run check`: passed
- `npm run backend:test`: passed (17 tests)
- `node --test src/main/startupPolicy.test.js src/renderer/security.test.js`: passed
- `git diff --check`: passed
- Manual macOS smoke test: passed for status item, anchored panel, left click, right-click native menu, refresh availability, and blur dismissal
- Open P0/P1/P2 findings: none

final result: passed
