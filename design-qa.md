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

## Compact target-alignment QA

### Evidence

- Reference: `C:\Users\kiko\AppData\Local\Temp\codex-clipboard-9f2f3005-0323-465a-9b43-2a039137c17c.png`
- Implementation: `C:\Users\kiko\.codex\visualizations\2026\07\16\019f690f-869f-7001-b6c2-43b75881391b\winplate-notifications-qa.png`
- Side-by-side comparison: `C:\Users\kiko\.codex\visualizations\2026\07\16\019f690f-869f-7001-b6c2-43b75881391b\notification-comparison.png`
- Viewport: 1527 × 1029, light theme
- State: Notifications selected, all sources and states visible, first notification expanded

### Comparison

- Layout and hierarchy: compact page heading, action row, source filters, date groups, timeline rows, metadata columns, and inline detail follow the reference hierarchy.
- Timeline: dates are aligned with the content column, each date has a short connector, and the vertical line remains continuous across rows. Full-width row dividers were intentionally omitted because the requested WinPlate treatment uses spacing and the timeline rail as separation.
- Typography and density: notification-specific sizes were increased after the first pass so titles, descriptions, source chips, and status metadata remain readable without returning to the oversized original layout.
- Color and surfaces: existing WinPlate theme tokens and shared notification icons are retained. Severity colors remain semantic and restrained; the expanded detail uses a single light-blue surface.
- Interactions: source filtering reduced 7 items to 2 Codex items; combining it with the unread filter reduced the list to 1 item. Inline expansion remained functional.
- Responsiveness: at 900 px width, header actions and filters wrap without horizontal overflow. Below 860 px the application-wide desktop minimum width applies; this is not introduced by the notification page.
- Accessibility: headings, regions, buttons, pressed states, the labeled state select, expanded state, disabled state, and focus-visible styles are present.
- Runtime: no browser console errors were observed in the tested state.

### Intentional differences from the reference

- The native WinPlate title bar and existing English sidebar labels are preserved.
- The test-notification control remains available as a secondary toolbar action.
- The page omits full-width notification separators in favor of the requested continuous timeline and date connectors.

### Findings

- P0: none.
- P1: none.
- P2: none requiring changes for this scope.

Final result: passed

## Dark theme neutral-palette QA

### Evidence

- Source visual truth: `C:\Users\kiko\AppData\Local\Temp\codex-clipboard-dbca3ac2-5833-4470-8aa1-08ecf59d2cae.png`
- Original WinPlate state: `C:\Users\kiko\AppData\Local\Temp\codex-clipboard-aee2d64a-82cf-42f0-953c-bc48fed1cbe2.png`
- Implementation screenshot: `C:\Users\kiko\.codex\visualizations\2026\07\16\019f690f-869f-7001-b6c2-43b75881391b\winplate-notifications-dark-qa.png`
- Full-view comparison: `C:\Users\kiko\.codex\visualizations\2026\07\16\019f690f-869f-7001-b6c2-43b75881391b\dark-before-after.png`
- Focused tone comparison: `C:\Users\kiko\.codex\visualizations\2026\07\16\019f690f-869f-7001-b6c2-43b75881391b\dark-tone-comparison.png`
- Viewport: 1532 × 1078
- State: dark theme, Notifications selected, all sources and states visible

### Fidelity review

- Typography: font family, weights, sizes, truncation, and content hierarchy remain unchanged. Primary text is neutral `#f2f2f2`; secondary and muted text now use neutral gray instead of the previous blue-gray cast.
- Spacing and layout: no layout dimensions changed. Header, filters, timeline rail, dates, rows, metadata, and sidebar retain the existing responsive contract.
- Colors and tokens: dark chrome is `#1f1f1f`, the Windows content surface is `#181818`, muted controls use `#212121`, and raised controls use `#303030`. These match the reference's neutral black-gray hierarchy while preserving blue and semantic status colors for meaning.
- Image and icon quality: existing WinPlate logo and shared icon assets are unchanged; no placeholder or replacement artwork was introduced.
- Copy and content: application copy is unchanged. Realistic notification data was used only in the temporary QA fixture.
- Accessibility: primary and secondary text remain legible, status colors retain text labels, and focus-visible states remain present.
- Interaction and runtime: the Codex source filter reduced the list from 7 items to 2 and restored correctly. No horizontal overflow or browser console errors were observed.

### Comparison history

- Initial P2: the dark selected navigation state retained a brighter border than the neutral reference. Fix: changed dark active navigation and settings states to a `#2b2b2b` fill with transparent border and no shadow.
- Post-fix evidence: the focused tone comparison shows the sidebar and selected item using a flat neutral hierarchy without the previous raised-card effect.

### Findings

- P0: none.
- P1: none.
- P2: none.
- P3: the retained blue active source chip is intentionally semantic and remains consistent with WinPlate's notification filtering behavior.

final result: passed
