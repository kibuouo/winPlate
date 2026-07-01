# Platform roadmap

- **Windows:** `apps/windows-electron` is the current production application and remains the primary runnable client.
- **macOS transition:** `apps/macos/electron-menubar` preserves the tested Electron menu-bar behavior and provides migration evidence.
- **macOS native:** the next client is a separately designed SwiftUI/AppKit application under `apps/macos`; it will consume shared contracts and deterministic core rules rather than Electron UI code.
- **iOS and watchOS:** these remain documentation-only boundaries until privacy, consent, HealthKit permissions, retention, offline behavior, and synchronization have an approved design.

The transition workspace can be retired only after the native macOS client covers its accepted behavior. iPhone and Apple Watch work does not begin merely because directories exist.
