# Notification Timeline Redesign

**Status:** awaiting user review
**Date:** 2026-07-12

## Goal

Replace only the main content area of WinPlate's Notifications section with the
reference's calm, date-grouped timeline. Keep the existing application sidebar,
global title bar, notification data sources, read-state persistence, safe
actions, and navigation contracts intact.

## Scope

The redesign applies inside `.notifications-page` only. It does not change the
left navigation, the custom window title bar, the notification API, source-card
navigation, persistence, severity semantics, or the existing red-weather
acknowledgement modal.

## Layout

The notification content has three stacked areas:

1. **Page heading and actions.** The heading remains “通知中心” with its existing
   supporting description. On the right, show the unread-count pill, “全部标记已读”,
   “清空已读”, and settings entry using the existing permitted controls. The
   development-only test-notification control remains available but does not
   compete with the primary actions.
2. **Source and order bar.** Replace native source/state select controls with
   source chips: 全部, Codex, GitHub, 邮件, and QWeather when those sources are
   present. Each chip includes its matching count and uses an active blue state.
   The current read-state filter remains accessible through a compact secondary
   control. A newest-first order control appears on the right.
3. **Date-grouped timeline.** Notifications are grouped by local calendar date
   and rendered newest first. Each date group has a label such as “今天 7月12日”,
   “昨天 7月11日”, or “7月10日”. A single vertical rule and level-colored timeline
   dots connect the notification rows. Each row presents source icon, title,
   unread badge where applicable, message preview, time, relative date, and
   semantic level.

The page is a single reading column instead of the current master-detail split.
The timeline maintains generous horizontal padding and separators so adjacent
rows remain easy to scan.

## Interaction and Data Flow

- Source chips update `notificationFilters.source`; the active chip is reflected
  with `aria-pressed` and does not lose the current selected notification.
- The compact state filter continues to select all, unread, or read items.
- Selecting a timeline row calls the existing safe detail loader. It preserves
  the selection, marks an unread notification read through the existing API,
  and expands detail directly below that row.
- The inline detail shows metadata, full body, safe actions, retry feedback, and
  a “标记已读” action when relevant. It does not open a drawer or a modal.
- “全部标记已读” preserves its existing behavior. “清空已读” removes only already
  read entries; unread notifications are never cleared by that control.
- Dashboard, Codex, GitHub, QWeather, and mail notification previews continue
  to navigate to Notifications with a `notificationId`; the matching timeline
  row is then selected and expanded.
- The red QWeather acknowledgement flow remains unchanged and takes priority
  over ordinary timeline interaction.

## Visual Treatment

Use the reference's light, restrained system:

- dark text, soft gray rules and backgrounds, and blue only for current
  selection, unread state, and information-level signals;
- compact rounded chips with source icons and count badges;
- 44px-plus keyboard-operable row targets, clear focus rings, and no color-only
  severity distinction;
- source icons continue to come from the existing icon system rather than new
  image assets;
- the selected row's inline detail uses a subtle blue outline and a flat,
  readable metadata block rather than a floating card;
- at narrow widths, timeline metadata wraps beneath the title while source
  filters scroll or wrap without clipping; inline detail remains in the flow.

## Accessibility and Failure Handling

- Timeline rows remain semantic buttons with `aria-expanded`; the selected
  detail has a labelled region.
- Chips expose their pressed state and labels include both source and count.
- Read/unread and severity always include textual labels or badges as well as
  colored dots.
- Loading and failed detail states render inline under the selected row. Retry
  retains the same selected notification.
- Empty filters show a non-interactive empty state inside the timeline area.

## Verification

Automated coverage will verify:

1. Filtering by source and read state produces the expected date groups.
2. Timeline rows contain safe escaped source, title, message, level, and time
   data and are keyboard-operable.
3. Selecting a row expands only that row, loads its detail, and marks an unread
   item read through the existing API.
4. External `notificationId` navigation selects and expands the intended row.
5. Mark-all-read and clear-read controls preserve their existing safety
   boundaries.
6. Renderer syntax, focused Electron unit coverage, and repository checks pass.
