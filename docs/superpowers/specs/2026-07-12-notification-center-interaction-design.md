# Notification Center Interaction Design

**Status:** approved for implementation planning  
**Date:** 2026-07-12

## Goal

Make WinPlate notifications calm by default and interrupting only for an active
QWeather red alert. Ordinary information, warnings, and success messages are
handled inside a persistent master-detail notification center. Dashboard,
QWeather, and GitHub cards offer a quick hover preview for their related
unread anomalies, with a click taking the user to the selected notification.

## Scope

This change covers the Electron notification center, shared notification
navigation, weather-alert notification metadata, and the dashboard/QWeather/
GitHub preview entry points. It does not introduce new notification sources or
change notification persistence, deduplication, or AI-summary generation.

## Notification Classification

The central acknowledgement dialog is deliberately narrower than the existing
generic `critical` level.

An alert requires acknowledgement only when all of these conditions hold:

- `source` is `qweather`;
- its source metadata reports `severity` as `red`; and
- its lifecycle is still active (not resolved, cancelled, or otherwise ended).

The backend must preserve QWeather severity and lifecycle on the normalized
notification so the renderer can make this decision from structured data. It
must not infer red status from title or body text. Other `critical` events,
all warning events, and information/success events never open this dialog.

## Notification Center

The Notifications section is a stable master-detail workspace rather than a
summary card plus detail drawer.

- The header shows the smart summary, source/state filters, and unread count.
- The left pane contains the filtered raw-notification list. Each row presents
  source, title, compact content preview, priority, timestamp, and read state.
- Selecting a row marks it read and renders its full detail in the right pane.
- The right pane owns notification metadata and safe source actions.
- With no selection, the right pane shows today's deterministic or AI-backed
  summary and a short instruction to select a notification from the left pane.
- Existing mark-all-read and clear controls remain available in the header;
  the prior in-page detail drawer is removed.

## Quick Preview and Navigation

Dashboard, QWeather, and GitHub cards resolve their related unread anomalous
notification through the same notification list used by the center.

- Hover displays a compact, read-only preview using the existing tooltip
  surface: source, title, short body, severity, and relative time.
- Click sends main-window navigation with `section: Notifications` and the
  matching `notificationId`.
- The notification center selects that notification after navigation and shows
  its detail in the right pane.
- If the related item disappears or is no longer unread, the card shows no
  stale preview and clicks follow its existing normal navigation.

## Red Weather Alert Confirmation

When the notification data refresh finds an unread, active QWeather red alert,
the renderer presents a centered modal confirmation window. The modal shows
the alert title, concise alert content, source, and clear severity treatment.

- “我已知悉” marks that notification read, refreshes the digest and center,
  and closes the modal.
- Escape, the close affordance, or the backdrop closes the modal without
  changing the notification's unread state.
- A notification that was already read must not re-open the modal.
- If more than one red alert is present, confirmations are shown one at a time
  in newest-first order; closing one without acknowledging leaves it eligible
  on a later refresh but does not immediately loop it back onscreen.

## Accessibility and Failure Handling

- The master list uses semantic buttons or equivalent keyboard-operable rows.
- The selected row exposes its state, and the detail pane has a labelled empty
  state.
- The confirmation modal traps focus while open, restores focus on close, and
  has an accessible title and description.
- A failed detail request leaves the selected row intact and provides an
  in-place retry action in the detail pane.
- Missing QWeather metadata is treated as non-modal, preventing false
  interruption.

## Verification

Automated coverage must verify:

1. Only active QWeather alerts with exact red severity require acknowledgement.
2. Confirming marks the notification read; dismissal does not.
3. Rehydration does not re-open an already read red alert.
4. Source-card navigation reaches Notifications with the intended
   `notificationId` selected.
5. Filtering, no-selection content, detail retry, and unread-count changes
   preserve the master-detail state.
6. Existing notification safety and renderer syntax/unit suites continue to
   pass.
