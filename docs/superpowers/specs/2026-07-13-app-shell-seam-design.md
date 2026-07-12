# App Shell Seam Design

**Status:** approved design, awaiting specification review
**Date:** 2026-07-13

## Goal

Make the Windows app shell read as one continuous surface: the custom title
bar's left portion flows into the navigation sidebar, while the main page
begins at their shared boundary with one deliberate top-left rounded corner.
The result should match the structural relationship in the reference without
copying its product-specific menu controls.

## Scope

This change is limited to the renderer shell made by `renderMain()` and its
shell CSS. It applies to the Dashboard, module pages, Notifications, Settings,
and both expanded and collapsed sidebar states.

It preserves:

- the current WinPlate title-bar icon, weather, clock, and window controls;
- all existing navigation and settings behavior;
- page content, notification data, and page-specific visual layouts;
- the macOS native-title-bar path.

## Layout

1. The title bar and workspace share one sidebar-width value for the current
   view. The value changes with the Settings workspace and with the collapsed
   primary sidebar state.
2. The title bar's left region uses the sidebar surface. Its right region uses
   the main surface and retains the existing drag, weather, time, and window
   control areas.
3. The sidebar starts directly below the matching title-bar region with no
   doubled divider or visually separate cap.
4. The main-content surface has one top and left boundary and a top-left
   radius. Its corner is anchored exactly at the title-bar/sidebar boundary.
5. The same seam is used by every Windows section. Settings no longer owns an
   incompatible, page-specific version of the corner.

## Implementation Shape

`renderMain()` will expose shell state that both the title bar and workspace
can consume: normal versus Settings sidebar width and expanded versus collapsed
navigation state. CSS custom properties and shell selectors will derive the
title-bar split, workspace grid, and main-content corner from that state.

The change remains structural CSS plus minimal shell classes. It does not move
interactive controls between processes or alter their event handlers.

## Accessibility and Platform Behavior

- Existing drag and no-drag regions remain unchanged: title-bar controls are
  interactive and the main/side surfaces remain normal renderer content.
- The border and radius are purely visual; they do not create clipping that
  prevents keyboard focus or scrolling.
- macOS continues using its native title-bar layout and does not receive the
  Windows custom-title-bar seam.

## Verification

1. Add renderer coverage that asserts shared shell state and the common seam
   selectors instead of a Settings-only corner.
2. Run the focused Windows Electron renderer tests, including the new test.
3. Run the package validation command and inspect the Windows shell manually
   in Notifications and Settings, both before and after collapsing the sidebar.

