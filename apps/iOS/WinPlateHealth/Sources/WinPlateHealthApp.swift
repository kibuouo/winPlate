import SwiftUI

@main
struct WinPlateHealthApp: App {
    @StateObject private var healthStore = HealthStore()

    var body: some Scene {
        WindowGroup {
            HealthDashboardView()
                .environmentObject(healthStore)
        }
    }
}
