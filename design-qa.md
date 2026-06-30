# Design QA

- Source visual truth: `/tmp/codex-remote-attachments/019f11b8-c332-7bb3-99a0-60beda859ce2/81A40378-ACED-42CF-950A-A8C32EFA8E9C/1-照片-1.jpg`
- Final status icon source: `assets/icon-transparent.png` (tight transparent crop of the supplied title-bar PNG, SHA-256 `05428f9ccfd8fd5453a9bd02c9050ecba79a5a1d40847ddaee9905884b3ab150`)
- Final application icon source: `assets/icon.png` (inset portrait on a white rounded-rectangle app tile, SHA-256 `0e23755d77628c8a3ea06bca96065a9faf2bf369f4510ce0e344c19bc0f20ec2`)
- Implementation target: WinPlate native macOS menu bar item and anchored status panel
- Viewport: macOS 1440 × 900 points (2880 × 1800 capture)
- State: dark system appearance with Codex, DeepSeek, and weather unavailable fallbacks
- Closed-state evidence: `docs/qa/01-macos-menu-bar-closed.png`
- Open-panel evidence: `docs/qa/02-macos-menu-bar-panel-open.png`
- Combined supplied/closed/open evidence: `docs/qa/macos-menu-bar-2026-06-30-comparison.png`

## Visual comparison findings

- The implementation preserves the sketch's single menu bar item, temperature title, narrow anchored panel, and Codex → DeepSeek → weather order.
- The panel uses native macOS placement and vibrancy while retaining WinPlate's existing neutral surfaces, dividers, typography, progress bars, and action treatment.
- Codex and DeepSeek use the Windows green-active / gray-unavailable status points. Codex quota values never introduce yellow or red warning presentation.
- The menu bar uses the supplied pixel-art star without Template Image tinting. At the real 16-point menu-bar size, the four-point silhouette and small upper-right plus remain distinct beside the `--°` fallback title instead of collapsing into a solid white blob.
- macOS Dock and in-app branding use `assets/icon.png`; Windows native windows continue to use `assets/icon.ico`.
- No overlapping controls, clipped rows, horizontal overflow, desktop floating capsule, or detached tooltip window were found.

## macOS menu bar smoke test — 2026-06-30

- [x] Left click opens and closes the panel beneath the status item.
- [x] Right click offers Open WinPlate, Settings, Refresh, and Quit.
- [x] Blur dismisses the panel in the running app; Escape dismissal passes the renderer interaction test.
- [x] Deterministic bounds tests keep the panel on-screen at left/right edges, short work areas, and negative-coordinate secondary displays.
- [x] Dark appearance was inspected in the running app; light/dark text, divider, weather-icon, and focus styling pass regression coverage.
- [x] The final supplied star was captured on the host at the real 16-point menu-bar size; its silhouette and small plus are legible and it does not become a solid white blob.
- [x] No macOS desktop floating capsule is created.
- [x] Codex shows 5-hour and 7-day values with neutral progress bars.
- [x] Codex and DeepSeek use the Windows green active / gray unavailable status points.
- [x] Quota changes never add yellow or red presentation.
- [x] DeepSeek unconfigured/unavailable states do not fabricate a balance and retain the Settings route.
- [x] Weather failure keeps the status item visible as `--°`.
- [x] Refresh updates values in place without closing or rebuilding the panel.
- [x] Partial and all-source failures keep Open WinPlate, Settings, Refresh, and Quit usable.

## Patches made during QA

- Replaced the previous portrait status artwork with a tight transparent crop of the supplied title-bar star, preserving the source pixel geometry while removing near-transparent outlier pixels and excess canvas.
- Reduced the portrait to roughly 72% of the white rounded-rectangle app tile, adding balanced internal safe-area padding so its Dock weight matches neighboring macOS icons.
- Disabled Template Image tinting so the supplied star's black, white, and gray detail remains visible.
- Kept application branding platform-native: `icon.png` for macOS/Dock and in-app branding, `icon.ico` for Windows native windows.
- Added a dedicated seven-method menu bar preload bridge; the main-window preload no longer exposes menu-only channels.
- Kept initial and 30-second refreshes cache-aware while reserving forced reads for explicit button/native-menu refreshes.
- Added a platform-neutral virtualenv Python launcher so `npm run backend:test` works on both macOS and Windows.
- Added regression coverage for the menu bar icon source, narrow bridge, refresh policy, and cross-platform Python launcher.

## Verification

- `npm run check`: passed (98 tests)
- `npm run backend:test`: passed (17 tests)
- `git diff --check`: passed
- Manual macOS visual smoke test: passed for status item closed/open states, anchored panel, real 16-point icon legibility, and absence of a desktop floating capsule
- Final status/application icon wiring and supplied artwork hashes: passed by regression coverage
- Screenshot evidence limit: screenshots confirm the requested visible states; keyboard, screen-reader, and full light/dark accessibility behavior remain covered only by automated regression checks in this run.
- Open P0/P1/P2 findings: none

final result: passed
