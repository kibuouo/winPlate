import SwiftUI

@main
struct WinPlateApp: App {
    @NSApplicationDelegateAdaptor(WinPlateAppDelegate.self) private var appDelegate

    var body: some Scene {
        // The dashboard is the only window scene. Settings commands navigate
        // to its sidebar destination instead of creating a separate window.
        Window("WinPlate", id: "main") {
            DashboardSceneView(appDelegate: appDelegate)
        }
        .defaultSize(width: 1040, height: 720)
        .commands {
            CommandGroup(replacing: .appSettings) {
                Button("设置…") {
                    NotificationCenter.default.post(name: .showWinPlateSettings, object: nil)
                }
                .keyboardShortcut(",", modifiers: .command)
            }
            SidebarCommands(state: appDelegate.state)
        }
    }
}

private struct DashboardSceneView: View {
    let appDelegate: WinPlateAppDelegate
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        DashboardView()
            .environmentObject(appDelegate.state)
            .frame(minWidth: 880, minHeight: 580)
            .background(MainWindowReader { window in
                appDelegate.configureMainWindow(window) {
                    openWindow(id: "main")
                }
            })
    }
}

private struct MainWindowReader: NSViewRepresentable {
    let onAttach: (NSWindow) -> Void

    func makeNSView(context: Context) -> WindowObserverView {
        WindowObserverView(onAttach: onAttach)
    }

    func updateNSView(_ view: WindowObserverView, context: Context) {
        view.onAttach = onAttach
    }

    final class WindowObserverView: NSView {
        var onAttach: (NSWindow) -> Void

        init(onAttach: @escaping (NSWindow) -> Void) {
            self.onAttach = onAttach
            super.init(frame: .zero)
        }

        required init?(coder: NSCoder) { nil }

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            if let window { onAttach(window) }
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
