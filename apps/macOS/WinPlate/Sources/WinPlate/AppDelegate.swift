import AppKit
import Combine
import Darwin
import SwiftUI

extension Notification.Name {
    static let showWinPlateMainWindow = Notification.Name("showWinPlateMainWindow")
    static let showWinPlateSettings = Notification.Name("showWinPlateSettings")
}

@MainActor
final class WinPlateAppDelegate: NSObject, NSApplicationDelegate {
    let state = AppState()

    private var mainWindow: NSWindow?
    private var reopenMainWindow: (() -> Void)?
    private var menuBarController: MenuBarController?
    private let systemNotificationCoordinator = SystemNotificationCoordinator()
    private var notificationSummaryCancellable: AnyCancellable?
    private var instanceLockFileDescriptor: Int32 = -1

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard claimPrimaryInstance() else { return }
        state.settings.applyAppearanceTheme()
        systemNotificationCoordinator.configure(state: state)
        notificationSummaryCancellable = state.$notifications
            .dropFirst()
            .sink { [weak systemNotificationCoordinator] summary in
                systemNotificationCoordinator?.synchronize(summary)
            }
        state.start()
        NSApp.setActivationPolicy(.regular)
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(showMainWindow),
            name: .showWinPlateMainWindow,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(showSettings),
            name: .showWinPlateSettings,
            object: nil
        )
        menuBarController = MenuBarController(state: state)
        activateMainWindow()
    }

    private func claimPrimaryInstance() -> Bool {
        let lockPath = (NSTemporaryDirectory() as NSString)
            .appendingPathComponent("com.kiko.winplate.instance.lock")
        let fileDescriptor = open(lockPath, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
        guard fileDescriptor >= 0 else { return true }
        guard flock(fileDescriptor, LOCK_EX | LOCK_NB) == 0 else {
            close(fileDescriptor)
            activateExistingInstance()
            NSApp.terminate(nil)
            return false
        }
        instanceLockFileDescriptor = fileDescriptor
        return true
    }

    private func activateExistingInstance() {
        let bundleIdentifier = Bundle.main.bundleIdentifier ?? "com.kiko.winplate"
        let currentProcessIdentifier = ProcessInfo.processInfo.processIdentifier
        let existing = NSWorkspace.shared.runningApplications.first {
            $0.processIdentifier != currentProcessIdentifier
                && ($0.bundleIdentifier == bundleIdentifier || $0.localizedName == "WinPlate")
        }
        existing?.activate(options: [.activateAllWindows])
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        activateMainWindow()
        state.reconnectHealthPeerIfNeeded()
        return false
    }

    func applicationDidBecomeActive(_ notification: Notification) {
        state.reconnectHealthPeerIfNeeded()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    func applicationShouldRestoreApplicationState(_ app: NSApplication, coder: NSCoder) -> Bool {
        // Launch the main scene afresh instead of restoring legacy settings windows.
        false
    }

    func applicationWillTerminate(_ notification: Notification) {
        notificationSummaryCancellable = nil
        state.stop()
    }

    @objc private func showMainWindow() { activateMainWindow() }
    @objc private func showSettings() { activateSettings() }

    func configureMainWindow(_ window: NSWindow, reopen: @escaping () -> Void) {
        mainWindow = window
        reopenMainWindow = reopen
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.titlebarSeparatorStyle = .none
        window.toolbarStyle = .unified
        window.isRestorable = false
    }

    private func activateMainWindow() {
        NSApp.activate(ignoringOtherApps: true)
        if let mainWindow, mainWindow.isVisible || mainWindow.isMiniaturized {
            if mainWindow.isMiniaturized { mainWindow.deminiaturize(nil) }
            mainWindow.makeKeyAndOrderFront(nil)
        } else {
            reopenMainWindow?()
        }
    }

    private func activateSettings() {
        state.selectedWorkspace = .settings
        activateMainWindow()
    }
}
