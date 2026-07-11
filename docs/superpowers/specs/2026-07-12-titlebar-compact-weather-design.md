# Titlebar compact weather

## Goal

Show the current weather immediately to the left of the date in the Windows main-window titlebar.

## Scope

- Reuse the existing `statusData.weather` fields and local QWeather icon assets.
- Render a non-interactive titlebar weather group before the existing date/time clock.
- Show icon, temperature, and weather condition at normal widths.
- At narrow widths, retain icon and temperature while hiding the weather condition.
- Keep the date, time, drag region, and window-control layout intact.
- Keep the macOS native titlebar unchanged.

## Data flow

The titlebar uses the existing weather data already rendered in the floating capsule. Initial main-window rendering uses current `statusData.weather`; an existing weather refresh re-renders the main view and supplies updated titlebar content.

## Error handling

Missing weather values use the existing fallback icon and `--°` temperature. The condition falls back to `天气未知` before CSS applies narrow-width concealment.

## Verification

- Add source assertions for titlebar weather markup and responsive CSS.
- Run the focused renderer test before and after implementation.
- Run the Windows Electron unit suite.
