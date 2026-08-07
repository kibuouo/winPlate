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

    var body: some Scene {
        WindowGroup {
            HealthDashboardView()
                .environmentObject(healthStore)
        }
    }
}
