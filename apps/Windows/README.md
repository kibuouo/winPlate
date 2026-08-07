# WinPlate for Windows

This is the Windows-only Electron client. It owns the Windows tray, floating
window, native title bar controls, desktop registration, and Windows-specific
notification integration.

The Health module receives the current HealthKit snapshot from the WinPlate
iPhone app through a dedicated LAN HTTP listener on port `8766`. The existing
local API remains loopback-only on `127.0.0.1:8765`. Open `Health snapshot` in
WinPlate, copy the displayed `iPhone setup URL`, paste it into the iPhone app,
and allow WinPlate through the Windows Firewall for private networks when
prompted. The setup URL includes a persistent per-installation pairing token.

macOS is implemented independently in `apps/macOS/WinPlate` with SwiftUI and
AppKit. This workspace must not import or package macOS client code.
