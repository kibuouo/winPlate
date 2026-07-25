import SwiftUI

@main
struct WinPlateApp: App {
    @NSApplicationDelegateAdaptor(WinPlateAppDelegate.self) private var appDelegate

    var body: some Scene {
        Settings {
            SettingsView()
                .environmentObject(appDelegate.state)
        }
    }
}
