# WinPlate for Windows

This is the Windows-only Electron client. It owns the Windows tray, floating
window, native title bar controls, desktop registration, and Windows-specific
notification integration.

The Health module receives the current HealthKit snapshot from the WinPlate
iPhone app through a dedicated LAN HTTP listener on port `8766`. The existing
local API remains loopback-only on `127.0.0.1:8765`. Open `健康` in WinPlate,
copy an address from `Windows 接收地址` whose address belongs to the same LAN
as the iPhone, paste it into the iPhone app's `WinPlate 通信` card, and allow
WinPlate through the Windows Firewall for private networks when prompted.
Multiple addresses can appear when Windows has Wi-Fi, Ethernet, VPN, or
virtual adapters; try another displayed address if the iPhone cannot connect.
The setup URL includes a persistent per-installation pairing token.

The Health detail page keeps a bounded, de-duplicated history of synchronized
heart-rate samples in the Electron user-data directory. It retains up to seven
days (and at most 2,048 points) of normalized sample time/value pairs, never
the original HealthKit objects. The `心率趋势` card shows the last 24 hours or
seven days with average, high, low, and hover details; the rest of the page
continues to show the latest snapshot, freshness, and communication diagnostics.

macOS is implemented independently in `apps/macOS/WinPlate` with SwiftUI and
AppKit. This workspace must not import or package macOS client code.

## Installed application

From the repository root, run:

```powershell
npm run windows:app
```

This command runs the Windows and backend tests, packages the FastAPI service
as a standalone executable, builds a per-user NSIS installer, installs WinPlate
at `%LOCALAPPDATA%\Programs\WinPlate\WinPlate.exe`, and verifies
`http://127.0.0.1:8765/api/health`.

Use the installed desktop or Start menu shortcut for normal use. `npm run dev`
remains the development entry point. Settings and the SQLite database remain
under the stable Electron user-data directory across application updates.
