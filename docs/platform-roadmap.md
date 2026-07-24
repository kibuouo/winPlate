# Platform roadmap

- **Windows:** `apps/windows-electron` is the current production application and remains the primary runnable client.
- **macOS native:** `apps/macos/WinPlate` is the SwiftUI/AppKit-native client. It owns the main window, functional workspaces, settings, Keychain access, login item, and local API lifecycle without Electron UI code.
- **iOS and watchOS:** these remain documentation-only boundaries until privacy, consent, HealthKit permissions, retention, offline behavior, and synchronization have an approved design.

macOS no longer ships or depends on an Electron transition layer. iPhone and Apple Watch work does not begin merely because directories exist.
