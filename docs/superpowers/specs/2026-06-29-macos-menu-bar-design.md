# WinPlate macOS Menu Bar Design

## Summary

WinPlate will add a native macOS menu bar experience based on the supplied hand-drawn reference. One native status item combines a monochrome WinPlate icon with the current temperature. Clicking it opens a narrow, vertically ordered status panel for Codex quota, DeepSeek balance, and weather. This specification replaces the 2 × 2 macOS popover layout in `2026-06-28-winplate-windows-macos-design.md`; the rest of that cross-platform design remains valid.

The feature is fully interactive and uses the project's existing data sources. Windows keeps its current floating window, main window, and status presentation unchanged. macOS does not create, display, or configure a desktop floating capsule.

## Menu Bar Item

- Use one native macOS status item rather than separate icon and temperature items.
- Render the WinPlate icon as a monochrome Template Image so macOS controls its light and dark appearance.
- Display the latest whole-number temperature after the icon, for example `26°C`.
- Display `--°` when no current temperature is available. The status item must remain present and clickable.
- Do not reproduce the macOS date, time, Wi-Fi, battery, or other system-owned status items.
- Left click toggles the anchored panel.
- Right click opens a native menu with Open WinPlate, Settings, Refresh, and Quit.

## Anchored Panel

Create a frameless, non-resizable macOS panel with a preferred size of 320 × 420px. On a display whose work area is shorter than 436px, reduce the panel height to the work-area height minus the 16px combined inset and allow its content to scroll. Use macOS popover vibrancy, a system shadow, and native-looking spacing rather than reproducing the hand-drawn line style literally.

Position the panel directly below and horizontally centered on the status item. Clamp it inside the nearest display work area with an 8px inset, including displays with negative coordinates. Hide it when it loses focus, when Escape is pressed, or when the status item is clicked again.

The panel uses this vertical order:

1. **Codex** — a compact section with 5-hour and 7-day remaining-quota rows. Each row contains its label, neutral progress bar, remaining percentage, and reset time.
2. **DeepSeek** — current balance in CNY and the last successful update time.
3. **Weather** — source-provided weather icon, whole-number temperature, condition text, and location when available.
4. **Actions** — compact controls for Open WinPlate, Refresh, and Settings.

Sections use dividers instead of independent cards. This keeps the panel narrow and matches the reference's compact information hierarchy.

## Status Presentation

Codex must not use yellow, red, or quota-threshold warning colors. Its progress bars remain visually neutral at every quota level.

Codex and DeepSeek use the same status-point language as the current Windows renderer:

- A 7px green point with the existing soft glow means the service is active.
- A 7px gray point without glow means the service is unavailable or unconfigured.
- The point reports source availability only; it does not classify remaining quota or balance.

Weather does not add another service-status point. Its content or fallback copy communicates whether current weather is available.

## Data Flow and Refresh

- Reuse the existing Codex main-process usage reader, DeepSeek usage reader, and QWeather backend response.
- Keep a single normalized menu-panel summary in the renderer and send only the bounded temperature label needed by the native status item to the main process.
- Refresh automatically on the existing 30-second renderer interval.
- Refresh immediately when the user selects Refresh without closing the panel.
- Update existing DOM nodes so the open panel does not flash or lose focus during routine refreshes.
- Show the last successful update time for Codex and DeepSeek when current requests fail but cached data exists.
- Do not add new network services, alerts, notifications, or medical interpretations.

## Window and Lifecycle Boundaries

- Implement the menu panel as a dedicated macOS renderer entry point; do not add the panel markup to the existing main/floating renderer.
- Keep context isolation, sandboxing, disabled Node integration, and the narrow preload bridge.
- Keep the panel renderer alive while hidden so refresh and cached state remain available.
- Creating or recreating the status item and panel must be idempotent and must not register duplicate event handlers.
- The panel and native right-click menu must remain usable when one or all data sources are unavailable.
- Closing the main window continues to hide it. Quit remains the explicit termination path.

## Error and Empty States

- **Codex unavailable:** preserve cached quota values when present, show the gray status point, and label the source unavailable. Without cached values, show `--` for quota and reset time.
- **DeepSeek unconfigured:** show the gray status point and a direct link to Settings instead of a fabricated balance.
- **DeepSeek request failure:** preserve the most recent balance when present, show the gray point, and expose the last successful update time.
- **Weather unavailable:** keep the menu bar title at `--°` and show a concise unavailable or configuration message in the weather section.
- **All sources unavailable:** keep Open WinPlate, Refresh, Settings, and Quit reachable; never destroy or hide the status item because of data failure.

## Accessibility and Native Behavior

- Give the status item, every action, and every progress indicator an accessible label.
- Expose quota bars as progress indicators with numeric values when known.
- Preserve visible keyboard focus and support Escape dismissal.
- Respect macOS light/dark appearance through Template Image rendering, system vibrancy, and existing theme variables.
- Do not rely on color alone: active/unavailable copy accompanies every status point.

## Testing and Acceptance

### Automated tests

- Verify temperature-title normalization for normal, missing, decimal, extreme, and malformed values.
- Verify left-click toggle and right-click menu dispatch without duplicate handlers.
- Verify panel positioning at left, center, and right menu bar locations; secondary displays; negative coordinates; and work-area clamping.
- Verify the renderer's fixed Codex → DeepSeek → Weather → Actions ordering.
- Verify both Codex windows render neutral progress bars and Windows-style green/gray status points without quota warning classes.
- Verify refresh updates content without replacing the panel root or closing the panel.
- Verify cached, unconfigured, partial-failure, and all-offline states.
- Keep Windows policy, Tray behavior, floating-window dimensions, and renderer tests passing.

### macOS smoke test

- Confirm first launch shows one WinPlate icon plus temperature in the menu bar.
- Confirm the status item remains visible as `--°` when weather is unavailable.
- Confirm left click opens and closes the panel and right click opens the native menu.
- Confirm blur and Escape dismiss the panel.
- Confirm the panel stays on-screen near both display edges and on a secondary display.
- Confirm Codex, DeepSeek, and weather use real project data and refresh without flicker.
- Confirm Codex quota changes never introduce warning colors.
- Confirm green and gray status points visually match the Windows implementation.
- Confirm the Windows experience remains unchanged.

## Out of Scope

- Separate menu bar items for the WinPlate icon and temperature.
- Replacing or redrawing macOS system status items.
- The previous 2 × 2 macOS popover grid.
- A macOS desktop floating capsule, including its enablement and pinning preferences.
- New alerts, system notifications, data sources, or quota-severity rules.
- Changes to the existing Windows visual design.

## Completion Criteria

On macOS, WinPlate presents one stable native menu bar item with a live temperature and a compact anchored panel ordered as Codex, DeepSeek, weather, and actions, with no desktop floating capsule. Real data refreshes without disrupting the open panel, partial failures degrade locally, Codex never uses quota warning colors, service availability uses the Windows green/gray status points, and the existing Windows product behavior remains intact.
