# Notification Timeline Redesign QA

**Reference:** user-provided notification-center screenshot
**Captured viewport:** WinPlate desktop window, 1080 × 720

## Checks

- Pass — The global title bar and sidebar remain unchanged.
- Pass — The Notifications content uses source count chips, a compact state
  filter, an unread pill, and date-grouped timeline rows.
- Pass — The active source chip uses the reference's blue emphasis rather than
  the application's global green accent; the development test action is
  visually secondary.
- Pass — Timeline dots, source labels, relative time, semantic level text, and
  unread treatment are legible at the captured desktop width.
- Pass — Selecting a timeline row expands the safe notification detail directly
  below that row and updates the read count through the existing API.
- Pass — The renderer contracts cover source grouping, HTML escaping, inline
  selection, clear-read wiring, responsive rules, and focus styling.

**Final result:** passed
