import SwiftUI

@main
struct WinPlateApp: App {
    @NSApplicationDelegateAdaptor(WinPlateAppDelegate.self) private var appDelegate

    var body: some Scene {
        Settings {
            SettingsView()
                .environmentObject(appDelegate.state)
        }
        .commands {
            SidebarCommands(state: appDelegate.state)
        }
    }
}

private struct SidebarCommands: Commands {
    @ObservedObject var state: AppState

    var body: some Commands {
        CommandGroup(after: .toolbar) {
            Divider()
            Button(SidebarPresentation.actionLabel(isVisible: state.isMainSidebarVisible)) {
                state.toggleMainSidebar()
            }
            .keyboardShortcut("s", modifiers: [.command, .control])
        }
    }
}
