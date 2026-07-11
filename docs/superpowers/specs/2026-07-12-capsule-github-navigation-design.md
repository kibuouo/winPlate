# Capsule GitHub navigation

## Goal

Selecting the GitHub module in the floating status capsule opens and focuses the main WinPlate window on its `GitHub` section, rather than opening the GitHub profile in an external browser.

## Scope

- Change the floating capsule GitHub module's click handler to request `showMainWindow("GitHub")`.
- Change its Enter and Space keyboard activation handler to request the same destination.
- Update the capsule module's accessible label to describe opening the GitHub section.
- Keep main-window controls marked `data-open-github` unchanged; they still open the external GitHub profile.

## Flow

1. The user activates the GitHub item in the floating capsule.
2. The renderer sends `window:show-main` with `GitHub` through the existing preload bridge.
3. The main process shows and focuses the main window, then emits its existing `main:navigate` event.
4. The main renderer selects and renders the GitHub section.

## Error handling

The change reuses the established window-navigation path and adds no new IPC channel or error state.

## Verification

- Add a renderer test that asserts capsule GitHub activation routes to `showMainWindow("GitHub")`.
- Assert the capsule no longer calls `openGithubProfile`.
- Run the focused renderer test, then the Windows Electron unit suite.
