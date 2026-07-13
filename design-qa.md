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
- Pass — Codex, GitHub, Mail, and QWeather each use a distinct, readable
  circular source icon treatment; the live window was checked for Codex,
  QWeather, and Mail.
- Pass — Selecting a timeline row renders a compact, two-line inline summary
  with source navigation and read-state actions, replacing the oversized
  title, metadata, and long-body cards.
- Pass — The renderer contracts cover source grouping, HTML escaping, compact
  inline selection, clear-read wiring, responsive rules, and focus styling.
- Note — The live window was already receiving user input during final QA, so
  no additional click was injected; the selected-summary state is covered by
  the automated renderer contract.

**Final result:** passed

## Codex multi-turn notification folding

- Pass — Two Codex Toasts with the same normalized title and less than four
  hours between them render as one timeline row with a `2 条更新` label and the
  latest reply preview.
- Pass — Expanding the row keeps the concise latest-detail treatment and adds a
  labelled, escaped, newest-first update history.
- Pass — Selecting a historical child notification ID resolves to the group's
  latest row; marking the group read uses one atomic development-only batch
  operation for all unread children.
- Pass — Different titles, unsupported sources, blank titles, and a gap over
  four hours remain separate notifications. A conversation remains unread when
  an older child is unread even if its newest reply has already been read.
- Pass — Core, backend, Electron main-process, renderer-security, syntax, and
  repository validation cover the grouping and existing notification flows.
