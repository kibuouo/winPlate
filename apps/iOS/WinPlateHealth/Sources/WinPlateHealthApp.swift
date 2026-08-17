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
    @State private var isShowingLaunchTransition = true
    @State private var hasStartedLaunchTransition = false
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            ZStack {
                HealthDashboardView()
                    .environmentObject(healthStore)

                if isShowingLaunchTransition {
                    LaunchTransitionView()
                        .transition(.opacity)
                        .zIndex(1)
                }
            }
            .task {
                guard !hasStartedLaunchTransition else { return }
                hasStartedLaunchTransition = true

                try? await Task.sleep(for: .milliseconds(950))
                guard !Task.isCancelled else { return }

                withAnimation(.easeInOut(duration: 0.32)) {
                    isShowingLaunchTransition = false
                }
            }
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            healthStore.reconnectPeerIfNeeded()
        }
    }
}

private struct LaunchTransitionView: View {
    @State private var isAnimating = false
    private let waveformHeights: [CGFloat] = [8, 16, 26, 16, 8]

    var body: some View {
        ZStack {
            Color(uiColor: .systemGroupedBackground)
                .ignoresSafeArea()

            VStack(spacing: 20) {
                HStack(spacing: 10) {
                    Image(systemName: "waveform.path.ecg")
                        .font(.title3.weight(.bold))
                        .foregroundStyle(Color.accentColor)
                        .frame(width: 44, height: 44)
                        .background(
                            Color.accentColor.opacity(0.13),
                            in: RoundedRectangle(cornerRadius: 14, style: .continuous)
                        )
                        .scaleEffect(isAnimating ? 1 : 0.84)

                    Text("Winplate")
                        .font(.system(size: 30, design: .rounded).weight(.bold))
                        .foregroundStyle(.primary)
                }
                .opacity(isAnimating ? 1 : 0)
                .offset(y: isAnimating ? 0 : 10)

                HStack(alignment: .center, spacing: 4) {
                    ForEach(waveformHeights.indices, id: \.self) { index in
                        Capsule()
                            .fill(index == 2 ? Color.accentColor : Color.secondary.opacity(0.35))
                            .frame(width: 4, height: waveformHeights[index])
                            .scaleEffect(y: isAnimating ? (index == 2 ? 1.15 : 1) : 0.65)
                            .animation(
                                .easeInOut(duration: 0.55)
                                    .repeatForever(autoreverses: true)
                                    .delay(Double(index) * 0.06),
                                value: isAnimating
                            )
                    }
                }
                .frame(height: 30)

                Text("健康数据正在准备")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
                    .opacity(isAnimating ? 1 : 0)
            }
            .padding(.horizontal, 32)
            .padding(.vertical, 28)
            .background(
                Color(uiColor: .secondarySystemGroupedBackground),
                in: RoundedRectangle(cornerRadius: 28, style: .continuous)
            )
            .overlay {
                RoundedRectangle(cornerRadius: 28, style: .continuous)
                    .stroke(Color(uiColor: .separator).opacity(0.45), lineWidth: 1)
            }
            .scaleEffect(isAnimating ? 1 : 0.94)
            .opacity(isAnimating ? 1 : 0)
            .onAppear {
                withAnimation(.spring(response: 0.55, dampingFraction: 0.82)) {
                    isAnimating = true
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Winplate，正在加载健康数据")
        }
    }
}
