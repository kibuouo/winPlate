# WinPlate for Windows

This is the Windows-only Electron client. It owns the tray, floating window,
native title bar, desktop registration, and Windows-specific notification
integration.

## Health sync

The Health module receives the current HealthKit snapshot from the WinPlate
iPhone app over a dedicated LAN HTTP listener on port `8766`. The existing
local API stays loopback-only on `127.0.0.1:8765` and is not exposed on the
LAN.

To pair:

1. Open Health in WinPlate.
2. Copy an address from Windows receive address that is on the same LAN as
   the iPhone.
3. Paste it into the iPhone app's WinPlate communication card.
4. Allow WinPlate through the Windows Firewall for private networks when
   prompted.

Windows may list several addresses when Wi-Fi, Ethernet, VPN, or virtual
adapters are present. If the iPhone cannot connect, try another displayed
address. The setup URL includes a persistent per-installation pairing token.

## Heart-rate trend

The Health detail page keeps a bounded, de-duplicated history of synchronized
heart-rate samples in the Electron user-data directory: up to seven days and
at most 2,048 normalized time/value points. It never stores original
HealthKit objects.

The heart-rate trend card can show the last 24 hours or seven days, with
average, high, low, and hover details. The rest of the page still shows the
latest snapshot, freshness, and communication diagnostics.

## Installed application

From the repository root:

```powershell
npm run windows:app
```

This runs the Windows and backend tests, packages FastAPI as a standalone
executable, builds a per-user NSIS installer, installs WinPlate at
`%LOCALAPPDATA%\Programs\WinPlate\WinPlate.exe`, and verifies
`http://127.0.0.1:8765/api/health`.

Use the installed desktop or Start menu shortcut for normal use. `npm run
dev` remains the development entry point. Settings and the SQLite database
stay in the stable Electron user-data directory across application updates.

## Platform boundary

macOS is implemented independently in `apps/macOS/WinPlate` with SwiftUI and
AppKit. This workspace must not import or package macOS client code.
