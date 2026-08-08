import SwiftUI
import UIKit

@MainActor
final class WinPlateHealthAppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        handleEventsForBackgroundURLSession identifier: String,
        completionHandler: @escaping () -> Void
    ) {
        HealthBackgroundUploader.shared.handleEvents(
            for: identifier,
            completionHandler: completionHandler
        )
    }
}

@main
struct WinPlateHealthApp: App {
    @UIApplicationDelegateAdaptor(WinPlateHealthAppDelegate.self) private var appDelegate
    @StateObject private var healthStore = HealthStore()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            HealthDashboardView()
                .environmentObject(healthStore)
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            healthStore.reconnectPeerIfNeeded()
        }
    }
}
