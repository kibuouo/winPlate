# QWeather notification preview removal

**Status:** approved
**Date:** 2026-07-13

## Goal

Stop the QWeather page from presenting an additional long-lived notification
preview over weather content when the same alert is already visible in the
weather alert panel.

## Scope

- Exclude the `qweather` source from card-level notification previews.
- Keep QWeather alerts in the weather alert panel and Notifications center.
- Keep existing card-level previews and navigation for every non-QWeather
  source, including GitHub.
- Keep the existing unread state, alert refresh, and notification detail flows.

## Design

The renderer's existing preview selector will continue to select unread warning
and critical notifications for sources that support a card preview. QWeather
will be explicitly excluded at this selector boundary, so neither the weather
dashboard card nor the QWeather service card receives preview markup or an
interactive preview attribute. No timing mechanism is needed because the
duplicate layer is not rendered at all.

## Non-goals

- Do not delete, mark read, suppress, or alter QWeather notification records.
- Do not remove weather alert cards, forecasts, or Notifications-center rows.
- Do not change preview behavior for GitHub or other module cards.
- Do not redesign notification styling.

## Verification

Add a renderer regression assertion that QWeather is excluded from the
card-preview path while the existing generic preview behavior and navigation
remain present for other sources. Run the focused renderer test, Electron
package checks, and the repository validation gate.
