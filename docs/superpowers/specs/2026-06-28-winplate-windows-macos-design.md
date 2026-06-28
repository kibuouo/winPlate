# WinPlate Windows + macOS Multi-Platform Design

## Summary

WinPlate will become a two-platform Electron desktop product rather than a Windows application migrated to macOS. The FastAPI backend, status collection, IPC security, settings persistence, and status-summary rules remain shared. Windows keeps its floating-capsule-first experience, while macOS uses a menu bar status item, anchored popover, native main window, and an optional compact desktop capsule.

This iteration targets a development build that runs through the existing npm workflow. Linux, mobile/watch clients, DMG generation, signing, and notarization are outside this iteration.

The untracked `design/` directory and all nine concept images will be deleted. None of those images will be used as implementation references. The macOS interface will follow the behavior, dimensions, hierarchy, and native-material guidance approved in this specification.

## Architecture

### Shared core

- Keep the existing FastAPI service and current GitHub, Codex, DeepSeek, heart, and weather sources shared by both platforms.
- Keep one shared Electron bootstrap and window registry. Select the platform implementation once through `src/main/platform/index.js`; do not scatter platform checks through business and renderer code.
- Add focused Windows and macOS window-policy modules plus focused Tray modules. Windows is a first-class implementation, not a legacy fallback.
- Add a shared, pure status-digest module that converts existing status data into metrics, attention items, a severity, and a short menu bar title.
- Add an application-preferences module with validated, atomic JSON persistence. Appearance preferences remain separate.

### Renderer boundaries

- Give the macOS popover its own HTML, JavaScript, and CSS entry point so the existing large renderer does not absorb another full view.
- Continue using the existing renderer for the main window and desktop capsule. Expose the platform through the preload bridge so the main renderer can omit Windows chrome and apply macOS layout classes without Node access.
- Preserve the current context isolation, sandbox, disabled Node integration, and narrow IPC bridge.

## Platform Experiences

### Windows

- Preserve the current startup behavior: create the main window hidden, show the 460 × 104 desktop capsule, and expose the existing Tray menu.
- Preserve the frameless main window, custom title bar, floating-window interactions, Tooltip behavior, and Tray double-click behavior.
- Keep current Windows window sizes and visual treatment unchanged except for internal routing through the platform adapter.

### macOS menu bar and popover

- Create a monochrome Template Image at 16px and 32px (@2x) for the menu bar status item.
- Do not attach a persistent context menu. Left click toggles the popover; right click manually opens a menu containing Open WinPlate, Settings, Show/Hide Desktop Capsule, and Quit.
- Create the popover hidden at startup with a fixed 380 × 540 size, `vibrancy: "popover"`, active visual effects, a transparent frameless surface, system shadow, no resizing, and no taskbar entry.
- Anchor the popover below the Tray bounds, center it on the status item, and clamp it to the nearest display's work area with an 8px margin. Hide it on blur or Escape.
- Keep the popover renderer alive while hidden so its existing 30-second refresh updates the menu bar summary.
- Lay out the popover as: status heading; a 2 × 2 grid for Codex, heart, weather, and GitHub; up to three digest items; and actions for opening the main window, opening Settings, and toggling the desktop capsule.

### macOS menu bar state

- Default to an icon-only menu bar item.
- Offer a compact preference that displays Codex remaining percentage and current temperature.
- When attention items exist, override the optional compact title with `⚠ n`, where `n` is the number of red or yellow digest items.
- Send only a validated bounded summary from the popover renderer to the main process; the Tray adapter owns the native title update.

### macOS native main window

- Use a 1040 × 720 main window with minimum size 880 × 580, a transparent background, `frame: true`, `titleBarStyle: "hiddenInset"`, native traffic lights at `{ x: 16, y: 16 }`, and window vibrancy.
- Keep the existing 220px Sidebar and Dashboard pages, but omit the Windows title bar and its event bindings on macOS. Reserve a safe region for the traffic lights.
- Preserve close-to-hide behavior. Keep the standard Dock icon available so the application remains reachable even if the menu bar item is disabled.

### macOS optional desktop capsule

- Default the desktop capsule to disabled. Create or show it only when the saved preference is enabled.
- Use a 360 × 84 compact layout containing heart rate, weather, Codex remaining percentage, and attention count.
- Do not reproduce the full notification center or Windows Tooltip density in the macOS capsule.
- Offer a separate pin preference/action. An unpinned capsule is not forced above full-screen applications; pinned mode enables the existing always-on-top/click-through behavior appropriate to macOS.

## Status Digest

- Derive the digest only from the current project sources. Network monitoring, email integration, and a new system-notification engine are outside this iteration.
- Red items represent explicit data-source errors/unavailability or critically low Codex remaining quota (10% or less).
- Yellow items represent Codex remaining quota of 11–20%, missing required weather configuration, GitHub authentication/rate-limit states, or a configured-but-unavailable DeepSeek service.
- Blue items report ordinary current status and updates when there are fewer than three higher-priority items.
- Sort red before yellow before blue and show at most three items. Use stable deterministic tie-breaking by source name.
- Do not infer medical risk from heart-rate values. Heart data is displayed as a metric only unless its source later supplies an explicit status.
- If all sources fail, keep the Tray, popover, main window, Settings, and Quit controls usable and display an offline digest instead of closing any window.

## Preferences and Live Application

On macOS, persist and apply these preferences immediately:

- `menuBarEnabled`: defaults to `true`; creates or destroys the status item and popover entry point.
- `menuBarDisplay`: `icon` by default, with `compact` as the alternative.
- `desktopCapsuleEnabled`: defaults to `false`; shows or hides the compact capsule.
- `desktopCapsulePinned`: defaults to `false`; controls always-on-top/click-through behavior.
- `launchAtLogin`: defaults to `false`; uses Electron's login-item APIs.

Invalid or corrupt preference files fall back to these defaults. Preferences that only apply to macOS are shown only in the macOS Settings UI and do not alter Windows defaults.

## Error Handling and Lifecycle

- An explicit Quit action is the only normal path that terminates the application. Closing the main window hides it on both platforms.
- Recreating a destroyed Tray, popover, main window, or capsule must be idempotent and must not register duplicate event handlers.
- If the Template Image cannot be loaded, fall back to a resized native image and log the problem without preventing startup.
- Reject malformed IPC preference and menu-summary payloads through normalization rather than forwarding arbitrary data to native APIs.
- Preserve cached/offline status behavior when FastAPI or an external data source is unavailable.

## Testing and Acceptance

### Automated tests

- Test platform selection and assert that Windows policy preserves current dimensions, startup capsule behavior, Tray menu, and custom-window chrome.
- Test popover positioning against left, center, and right Tray locations; secondary displays; negative display coordinates; and work-area clamping.
- Test preference defaults, normalization, atomic persistence, corrupt-file recovery, and macOS login-item application through injected fakes.
- Test digest severity, thresholds, sorting, three-item limit, offline behavior, non-medical heart handling, compact title, and warning override.
- Test macOS Tray left/right-click dispatch independently from the Windows context-menu/double-click behavior.
- Extend renderer security/static tests for the platform bridge, absence of unsafe inline handlers/styles, and Windows/macOS title-bar branching.

### macOS smoke test

- On first launch, verify that the menu bar item appears and the desktop capsule does not.
- Verify left-click toggle, right-click menu, blur/Escape dismissal, work-area positioning, and no duplicate handlers after recreation.
- Verify native traffic lights, close-to-hide, Dock reactivation, Sidebar navigation, light/dark appearance, and normal content scrolling.
- Verify each preference applies live and survives restart, including menu bar enablement, compact title, desktop capsule, pin state, and launch at login.
- Verify normal, attention, and offline data states while keeping all navigation and exit paths usable.

### Repository checks

- Run `npm run check`, the backend test suite, and `git diff --check`.
- Confirm that `design/` is removed and no code, documentation, or tests reference its former images.
- Windows compatibility is protected by automated policy/event tests in the current macOS environment; Windows real-device verification is not claimed in this iteration.

## Completion Criteria

The same repository and shared data layer provide two deliberate desktop experiences: Windows retains its current floating-capsule product behavior, and macOS provides a working menu bar status center, native main window, persisted preferences, and optional compact desktop capsule. All automated and macOS smoke checks pass, and no repository design concept images remain.
