# Notification Digest Drawer Design

## Goal

Replace the notification digest card's redundant inline expansion with a useful right-side drawer. The drawer must let users understand and act on the notifications represented by the digest without first opening the raw notification history.

## Current Problem

The smart digest card currently toggles an inline "摘要详情" section. That section repeats the digest summary and adds category filters, but it does not expose the represented notifications, their full content, or their actions. The click therefore adds visual hierarchy without helping the user complete a task.

## Interaction Design

- The full smart digest card is the drawer trigger and must communicate that it is interactive.
- Clicking the card opens a right-side glass drawer using the same visual and interaction pattern as the Mail detail drawer.
- The drawer lists the notifications represented by the current digest, ordered by importance and then recency.
- Each entry shows its source, title, available body text, relative time, unread state, and relevant actions.
- Clicking an entry loads that notification's real detail and actions inside the same drawer, without stacking another drawer.
- A back control returns from a single notification to the digest notification list.
- Close button, backdrop behavior, Escape handling, focus behavior, width, rounded corners, scrolling, and motion should match the Mail detail experience where the existing implementation supports them.
- Closing the drawer returns the page to its prior scroll position and does not alter read state.
- Marking an item read refreshes the digest and drawer list while keeping the drawer open when other represented notifications remain.

## Content and Empty States

- The drawer title uses the digest headline and shows the current unread count.
- The drawer list is derived from the digest's represented source IDs when available. If those IDs are absent, it uses the same filtered unread notification set that produced the local digest.
- If a notification has source-backed detail, the existing notification detail service remains the source of truth.
- If source-backed detail is unavailable, the drawer shows the stored notification body and clearly labels the fallback; it must not show an empty metadata-only panel.
- If the digest has no represented notifications, the drawer shows a concise "暂无需要处理的通知" state and no inactive action controls.
- Loading and error states appear inside the drawer and include a retry action when detail retrieval fails.

## Page Simplification

- Remove the inline digest explorer and its category-filter state and event handling.
- Keep the collapsible raw notification section as the complete history entry point.
- Keep direct raw-notification clicks opening notification detail; reuse the same drawer shell rather than maintaining a second detail presentation.

## Architecture

- Extend the renderer notification digest component with pure rendering helpers for the digest drawer list and drawer state.
- Keep notification selection and ordering in testable pure functions.
- Reuse the existing notification detail retrieval and action execution IPC boundaries.
- Reuse the Mail drawer's layout tokens and interaction conventions instead of introducing a new overlay system.
- Keep all content HTML-escaped and preserve the existing action allowlist.

## Accessibility

- The digest trigger is keyboard-operable and exposes expanded state and drawer ownership.
- The drawer has dialog semantics and an accessible name.
- Opening moves focus into the drawer; closing restores focus to the digest card.
- Escape closes the drawer. The back control and all notification entries are keyboard-operable.
- Loading, success, and action feedback use appropriate live-region semantics.

## Testing and Acceptance Criteria

- A renderer test first demonstrates that clicking the digest trigger opens the drawer instead of rendering the inline digest explorer.
- Pure component tests cover represented-item selection, priority ordering, empty state, HTML escaping, and unread/read presentation.
- Interaction tests cover opening, closing, Escape, focus restoration, list-to-detail navigation, back navigation, retry, and mark-read refresh.
- Existing notification action and detail-service tests remain passing.
- Manual Electron verification confirms that the drawer visually matches the Mail module in both light and dark themes and remains usable at the minimum supported window size.
- Acceptance is met when one click on the smart digest exposes the actual underlying notifications and their useful actions, with no redundant summary layer left on the page.

## Out of Scope

- Changing digest-generation or AI-summary logic.
- Changing notification persistence or IPC contracts unless a failing test proves the current contract cannot identify represented notifications.
- Redesigning the Mail module or the raw notification history.
