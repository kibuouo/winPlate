# Codex conversation notification folding

**Status:** awaiting user review
**Date:** 2026-07-13

## Goal

Prevent a multi-turn Codex task from appearing as one notification per assistant
reply. The Notifications timeline will present the task as one conversation
entry whose preview is always the latest reply, while retaining its earlier
updates on demand.

## Evidence and constraint

WinPlate imports each Windows Toast with a unique Toast `tag` and database row
identifier. Current Codex Toast XML contains a task title and reply text, but
does not expose an application conversation or thread identifier. The title is
therefore the only stable grouping signal available to WinPlate.

## Scope

- Apply folding only to `codex` and `chatgpt` notification sources.
- Group adjacent notifications with the same normalized source and task title
  when their arrival times are within a bounded continuity window.
- Keep raw notification records and existing detail actions intact.
- Render one timeline row per folded conversation, showing its latest update
  and the number of included updates.
- Allow the row's existing inline detail area to reveal the earlier updates in
  chronological order.
- Treat the whole folded conversation as read when its latest row is opened or
  when its read action is used.

## Non-goals

- Do not delete or mutate imported Windows Toast history merely to hide it.
- Do not fold notifications from weather, mail, GitHub, or system sources.
- Do not infer conversation identity from reply text, which could incorrectly
  merge unrelated tasks.
- Do not change the Windows Toast importer protocol or require Codex Desktop to
  supply a new identifier.

## Grouping model

Each raw notification remains the persistence and navigation unit. The
Notifications view derives a presentation-only conversation group using:

1. source (`codex` or `chatgpt`),
2. a whitespace-normalized, case-insensitive task title, and
3. chronological continuity within a documented time window.

The default continuity window is **four hours**: a subsequent update with the
same task title continues the existing group when it arrives no more than four
hours after that group's newest update. A larger gap starts a new group so two
separate tasks with a reused generic title do not become permanent history.

The newest item supplies the row's ID, title, body preview, severity, time,
and navigation target. The group holds every constituent notification ID, its
unread count, and a newest-first update list. One-item groups render exactly as
today and receive no folding badge.

## Interaction and data flow

- Source chips and read-state filters operate on folded entries. Their counts
  represent conversations, not assistant replies.
- The source filter still maps every Codex and ChatGPT update into its
  respective source, while the read filter treats a group as unread if any of
  its updates are unread.
- A multi-update row displays a compact label such as `3 条更新`; its preview
  remains the newest reply so the list stays concise.
- Selecting a folded row preserves the current inline detail experience and
  adds a read-only `本轮更新` list beneath it. The latest reply is visibly
  identified; earlier replies retain their time and full text.
- Opening an unread folded row, its explicit read action, and the existing
  mark-all-read action mark every unread child notification as read. The normal
  one-item behavior is unchanged.
- Direct navigation by a raw `notificationId` resolves the containing folded
  group and expands it, so notification-capsule links continue to work.
- The AI/local digest receives folded development conversations so its unread
  count and summaries no longer inflate from multiple replies in one task.

## Failure handling and accessibility

- Missing titles fall back to the raw notification ID and are never merged
  solely by source.
- Invalid timestamps fall back to the existing raw ordering and form an
  individual group rather than risking a false merge.
- Every update's body is escaped with the existing renderer helper.
- A folded row remains a semantic keyboard-operable button. The update count is
  exposed as text, and the expanded update history has a labelled region.
- If a child read request fails, the group remains unread in the UI and the
  existing inline error/retry behavior is shown; no partial success is claimed.

## Verification

Automated tests will cover:

1. same-title Codex replies inside the continuity window fold into one group
   with the newest reply as preview;
2. different titles, unsupported sources, and a gap over four hours stay
   separate;
3. folded filter counts and unread state are based on conversation groups;
4. rendering shows the update count and safely escaped chronological history;
5. opening or marking a group read sends all of its unread child IDs, and a
   child failure leaves the presentation state accurate;
6. direct navigation to a child ID opens its parent group;
7. the digest counts the latest item from each folded conversation only; and
8. focused Electron and shared-core tests, syntax checks, and the repository
   validation gate pass.
