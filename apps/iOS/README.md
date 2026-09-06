# WinPlate Health for iPhone

This is the first native iOS slice of WinPlate. It currently covers a health
overview only:

- Reads the latest heart rate from HealthKit
- Summarizes today's steps and active energy
- Supports first-time authorization, manual refresh, and pull-to-refresh
- Reads from HealthKit and never writes to it; health data is not sent to
  the internet

A Mac receives the current overview over an encrypted nearby-device
connection. Windows receives it through a token-protected LAN address. The
iPhone keeps one latest overview in the app sandbox for system-allowed
background retries. Windows also stores up to seven days of de-duplicated
heart-rate sample summaries for its trend chart, and never stores original
HealthKit samples.

The project lives in [`WinPlateHealth`](./WinPlateHealth). Minimum iOS is 17.
The target device is a physical iPhone.

## Run from Xcode

1. Open `WinPlateHealth/WinPlateHealth.xcodeproj` in full Xcode.
2. Sign in under Xcode **Settings > Apple Accounts**.
3. Select the `WinPlateHealth` target, choose your Team in **Signing &
   Capabilities**, and keep **Automatically manage signing**.
4. If Xcode asks you to change the bundle identifier, replace
   `com.kiko.winplate.health` with a unique value of your own.
5. Connect an iPhone, select it as the run destination, and click Run. On
   first launch, enable Developer Mode in iPhone **Settings > Privacy &
   Security > Developer Mode**, and trust the developer.
6. In the app, tap Enable health data and allow read access to heart rate,
   steps, and active energy.

## 7-day signing

Without the Apple Developer Program, Xcode's Personal Team can install onto
your own device, but the provisioning profile lasts only seven days. After
it expires you must Build & Run again. That signing is not a long-term
distribution path.

This project already includes the `com.apple.developer.healthkit`
entitlement. HealthKit is a restricted capability. If your Personal Team
cannot produce a profile that includes it, signing fails. Join the paid
Apple Developer Program, or remove the HealthKit entitlement and run a UI
demo only. The repository does not contain certificates, private keys, or
provisioning profiles.

## Privacy boundary

This version does not store raw health data, does not upload to the
internet, and does not request write access.

- The iPhone persists only the latest outbound health overview, for
  system-allowed background retries.
- The Mac keeps the overview received during the current run.
- Windows also keeps up to seven days of de-duplicated heart-rate sample
  summaries for the heart-rate trend chart.

Weather, Codex / Grok usage, and DeepSeek balance can sync to the iPhone
over the local connection. API keys and other secrets are not included.
The Windows receiver opens only port `8766` and uses a WinPlate-generated
pairing token. The existing local API still binds solely to
`127.0.0.1:8765`.

When HealthKit reports heart-rate, step, or active-energy changes, iOS may
wake the app through `HKObserverQuery` and trigger a background HTTP
upload. Background scheduling is decided by the system; there is no fixed
interval. Force-closing the app from the app switcher also does not
guarantee continued sync.

## Connect to Windows

1. On Windows WinPlate, open Health and copy a Windows receive address on
   the same LAN as the iPhone. If several addresses appear, try them one
   by one.
2. Confirm the iPhone and the PC are on the same LAN. On first Windows
   launch, allow private-network access in the firewall prompt.
3. Paste the address into the iPhone WinPlate communication card and tap
   Save address and test.
4. After a successful test, each HealthKit refresh on the iPhone syncs to
   Windows. Windows shows connection state, latest heart rate, steps, and
   active energy, and shows the heart-rate trend once it has multiple
   samples.

If the iPhone cannot connect, check the sync state on the Windows Health
card: `waiting` means the receiver has not seen data yet; `error` usually
points to the token or the port. Also confirm the firewall allows private
TCP `8766`.

The pairing address includes a random token. Do not share it with
untrusted devices. Cross-network use, or stronger transport protection,
should move to TLS or device-level encrypted pairing.
