import AppKit
import Darwin
import SwiftUI

extension Notification.Name {
    static let showWinPlateMainWindow = Notification.Name("showWinPlateMainWindow")
    static let showWinPlateSettingsWindow = Notification.Name("showWinPlateSettingsWindow")
}

@MainActor
final class WinPlateAppDelegate: NSObject, NSApplicationDelegate {
    let state = AppState()

    private var mainWindow: NSWindow?
    private var settingsWindow: NSWindow?
    private var menuBarController: MenuBarController?
    private var instanceLockFileDescriptor: Int32 = -1

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard claimPrimaryInstance() else { return }
        state.loadSensitiveSettings()
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
            selector: #selector(showSettingsWindow),
            name: .showWinPlateSettingsWindow,
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
        if !flag { activateMainWindow() }
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    func applicationWillTerminate(_ notification: Notification) {
        state.stop()
    }

    @objc private func showMainWindow() { activateMainWindow() }
    @objc private func showSettingsWindow() { activateSettingsWindow() }

    private func activateMainWindow() {
        if mainWindow == nil {
            let rootView = DashboardView().environmentObject(state)
            let controller = NSHostingController(rootView: rootView)
            let window = NSWindow(contentViewController: controller)
            window.title = "WinPlate"
            window.styleMask = [.titled, .closable, .miniaturizable, .resizable]
            window.titlebarAppearsTransparent = false
            window.setContentSize(NSSize(width: 1040, height: 720))
            window.minSize = NSSize(width: 880, height: 580)
            window.center()
            window.isReleasedWhenClosed = false
            mainWindow = window
        }
        NSApp.activate(ignoringOtherApps: true)
        mainWindow?.makeKeyAndOrderFront(nil)
    }

    private func activateSettingsWindow() {
        if settingsWindow == nil {
            let rootView = SettingsView().environmentObject(state)
            let controller = NSHostingController(rootView: rootView)
            let window = NSWindow(contentViewController: controller)
            window.title = "WinPlate 设置"
            window.styleMask = [.titled, .closable, .miniaturizable]
            window.setContentSize(NSSize(width: 560, height: 430))
            window.isReleasedWhenClosed = false
            settingsWindow = window
        }
        NSApp.activate(ignoringOtherApps: true)
        settingsWindow?.makeKeyAndOrderFront(nil)
    }
}
