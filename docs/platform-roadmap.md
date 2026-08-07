# Platform roadmap

- **Windows:** `apps/Windows` is the current production application and remains the primary runnable client. Its Health module now accepts the iPhone HealthKit snapshot over a dedicated token-protected LAN listener.
- **macOS native:** `apps/macOS/WinPlate` is the SwiftUI/AppKit-native client. It owns the main window, functional workspaces, settings, Keychain access, login item, and local API lifecycle without Electron UI code.
- **iOS:** `apps/iOS/WinPlateHealth` now contains a small HealthKit module. It reads the latest heart rate plus today’s steps and active energy with explicit read-only consent, then synchronizes the current snapshot to macOS over an encrypted nearby-device connection or to Windows over the configured token-protected LAN endpoint.
- **watchOS:** this remains a documentation-only boundary until privacy, consent, HealthKit permissions, retention, offline behavior, and synchronization have an approved design.

macOS no longer ships or depends on an Electron transition layer. iPhone and Apple Watch work does not begin merely because directories exist.
