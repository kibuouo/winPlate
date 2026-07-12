# Settings sidebar state isolation

## Goal

Opening Settings while the application sidebar is collapsed must show the full
settings navigation. Returning to the application must preserve the previous
collapsed state.

## Considered approaches

1. Recommended: do not apply the application-only `sidebar-collapsed` class to
   the Settings workspace. The existing `sidebarCollapsed` value remains
   unchanged and is applied again when returning to any application section.
2. Override every collapsed selector under `.settings-workspace`. This would
   require duplicating several generic sidebar rules and risks future drift.
3. Reset `sidebarCollapsed` on entering Settings. This would discard the user’s
   chosen application layout state, so it is not acceptable.

## Design

`renderMain()` will assign `settings-workspace` for Settings, but assign
`sidebar-collapsed` only for non-Settings sections. The settings shell continues
to use its existing 286px sidebar state. Consequently, generic compact rules
cannot shrink the settings navigation buttons, while the saved collapsed state
is still active immediately after returning to the application.

## Regression coverage

Extend the existing renderer source-level layout test to assert that the
workspace class expression excludes `sidebar-collapsed` for Settings and keeps
it for collapsed non-Settings pages. Run that focused test first, then the
Windows Electron unit suite and syntax check.

## Scope

No settings data, navigation behavior, or ordinary application sidebar styling
will change.
