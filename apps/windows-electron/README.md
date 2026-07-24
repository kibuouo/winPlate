# WinPlate for Windows

This is the Windows-only Electron client. It owns the Windows tray, floating
window, native title bar controls, desktop registration, and Windows-specific
notification integration.

macOS is implemented independently in `apps/macos/WinPlate` with SwiftUI and
AppKit. This workspace must not import or package macOS client code.
