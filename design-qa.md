# Native macOS menu-bar redesign QA

- Source visual truth: `/Users/will/Pictures/Photos Library.photoslibrary/originals/2/2C21E723-A5CB-47A8-A8F9-B50F148027EE.png` (2388 × 1668 px, hand-drawn layout reference), `/var/folders/x_/jb3zmmcx1wsgq6w1cf9s63380000gn/T/codex-clipboard-9a00b3f7-ccaa-4a12-bac9-cc36cbaf9e51.png` (5h / 7d reset-row treatment), and `/var/folders/x_/jb3zmmcx1wsgq6w1cf9s63380000gn/T/codex-clipboard-95609206-0c6e-40d3-bee0-8e36f5d42eb4.png` (compact top-bar quota summary)
- Implementation target: `apps/macos/WinPlate/Sources/WinPlate/Views.swift`
- Implementation screenshot: unavailable — native app visual capture is blocked by the local Computer Use service.
- Intended state: light-mode native macOS menu-bar panel, with real Codex, DeepSeek, and QWeather data.

## Comparison target

The reference calls for a compact dashboard instead of stacked status rows: a branded utility header; a left-hand, concentric usage overview; a right-hand Codex / DeepSeek account summary; then a lower weather section with location, temperature, date, and a short forecast.

The native SwiftUI implementation follows that arrangement at 408 × 392 pt. The two header actions remain functional: opening the main window and Settings. Service rows continue opening the main window, and the unconfigured DeepSeek state retains its Settings shortcut. The Codex summary always shows both reset rows: `5h 重置` and `7d 重置`; unavailable values use `--` rather than removing the row.

The native `NSStatusItem` now keeps the temperature at left and adds a compact two-line `5h` / `7d` summary at right. Each row has a native progress indicator, percentage, and reset value; a missing 7d value is explicitly represented by an empty track, `--%`, and `--`.

The weather section now includes a QWeather alert strip below the three-day forecast. It shows the highest-priority current alert's title and summary when available, or an explicit green `暂无天气预警` state otherwise. Alert requests are throttled to once every five minutes, except on a user-forced refresh.

The native application bundle includes its own 1024 × 1024 macOS artwork at `apps/macos/WinPlate/Resources/AppIcon.icns`, referenced by `CFBundleIconFile`, with all standard 16–1024 px macOS representations.

## Evidence

- Static syntax check: `xcrun swiftc -frontend -parse` passed for the edited Swift sources.
- Native build and test: `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer CLANG_MODULE_CACHE_PATH=/private/tmp/winplate-clang-module-cache swift test` passed.
- Tests: 8 passed, 0 failed, including `testDecodesWeatherForecastForTheMenuBarOverview` and `testDecodesQWeatherAlertSummary`, after the alert integration.
- Native bundle check: `Info.plist` validated with `plutil`; the rebuilt `WinPlate.app` contains `Contents/Resources/AppIcon.icns`; `iconutil` successfully expands the packaged icon to all 10 standard iconset representations; the packaging script completes `codesign --verify --deep --strict` successfully after removing generated Finder metadata.
- Visual capture attempt: the Computer Use request for `WinPlate` timed out (`Computer Use server error -10005: timeoutReached`). Starting the debug executable did not surface a discoverable app through the same service, so no implementation screenshot can be supplied for a fair side-by-side comparison.

## Required fidelity surfaces

- Fonts and typography: native system font hierarchy is specified in code; not visually verified.
- Spacing and layout rhythm: the panel height was reduced from 524 pt to 392 pt, header and section padding were tightened, forecast cells were reduced to a 54 pt minimum, the circle inset was reduced from 18 pt to 12 pt, and the alert strip was added below the forecast; not visually verified.
- Colors and visual tokens: semantic system green, orange, tint, and system background are specified; not visually verified.
- Colors and visual tokens: the menu-bar progress indicators use the system's native accent treatment so they remain legible in both menu-bar appearances; not visually verified.
- Image and icon fidelity: the design uses native SF Symbols for standard application and weather icons; no raster or hand-drawn substitute assets were introduced.
- Copy and content: all labels use the real native Codex, DeepSeek, weather, date, and forecast values; forecast data is decoded from the existing local API response.

## Findings

- [P1] Native visual comparison pending.
  Location: macOS menu-bar panel.
  Evidence: the source reference is available, but no screenshot of the executed native panel could be captured.
  Impact: spacing, optical balance, and the final panel height cannot be confirmed against the reference.
  Fix: launch the built `WinPlate` target in a normal logged-in macOS session, open its menu-bar item, capture the 408 × 392 pt panel, and repeat the comparison at the same scale.

## Implementation checklist

1. Capture the visible native panel.
2. Compare header, concentric quota rings, account rows, and forecast cells to the reference.
3. Correct any P0–P2 visual differences and capture the final state again.

## Comparison history

1. 2026-07-24: implementation and automated checks completed; visual capture blocked before first full-view or focused-region comparison.
2. 2026-07-24: tightened the panel from 524 pt to 360 pt and added fixed `5h 重置` / `7d 重置` rows. Native tests still pass; visual capture remains blocked.
3. 2026-07-24: added a two-line native menu-bar summary next to the temperature. Native tests still pass; visual capture remains blocked.
4. 2026-07-24: reduced the concentric-ring gap and added a throttled QWeather alert strip below the forecast. Native tests still pass; visual capture remains blocked.
5. 2026-07-24: generated and packaged the existing macOS app icon as a standard `.icns` bundle. Package-level icon validation passed; visual capture remains blocked.

final result: blocked
