import SwiftUI

struct HealthDashboardView: View {
    @EnvironmentObject private var healthStore: HealthStore
    @State private var windowsEndpointDraft = ""

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    header

                    if healthStore.isHealthDataAvailable {
                        heartRateCard
                        dailyMetrics
                        communicationCard
                        privacyNote
                    } else {
                        unavailableCard
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 18)
            }
            .background(Color(uiColor: .systemGroupedBackground))
            .navigationTitle("健康")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await healthStore.refresh() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .disabled(healthStore.isLoading)
                    .accessibilityLabel("刷新健康数据")
                }
            }
            .refreshable {
                await healthStore.refresh()
            }
            .task {
                windowsEndpointDraft = healthStore.windowsEndpoint
                await healthStore.refresh()
            }
        }
        .tint(.pink)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("WinPlate Health")
                .font(.system(.largeTitle, design: .rounded, weight: .bold))

            Text("把今天的身体状态，放在一个安静的概览里。")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            if let lastUpdated = healthStore.lastUpdated {
                Label(
                    "更新于 \(lastUpdated.formatted(.relative(presentation: .named)))",
                    systemImage: "checkmark.circle.fill"
                )
                .font(.caption.weight(.medium))
                .foregroundStyle(.secondary)
            }
        }
    }

    private var heartRateCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Label("最近心率", systemImage: "heart.fill")
                    .font(.headline)
                    .foregroundStyle(.pink)

                Spacer()

                Text("HealthKit")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
            }

            HStack(alignment: .lastTextBaseline, spacing: 8) {
                Text(HealthFormatting.heartRate(healthStore.latestHeartRate))
                    .font(.system(size: 62, weight: .bold, design: .rounded))
                    .contentTransition(.numericText())

                Text("BPM")
                    .font(.headline.weight(.semibold))
                    .foregroundStyle(.secondary)
            }

            Text("显示 Apple 健康中的最近一次心率记录。")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            LinearGradient(
                colors: [Color.pink.opacity(0.18), Color.pink.opacity(0.06)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 26, style: .continuous)
                .stroke(Color.pink.opacity(0.18), lineWidth: 1)
        }
    }

    private var dailyMetrics: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("今天")
                .font(.title3.weight(.bold))

            HStack(spacing: 12) {
                MetricTile(
                    title: "步数",
                    value: HealthFormatting.count(healthStore.stepCount),
                    unit: "步",
                    icon: "figure.walk",
                    color: .blue
                )

                MetricTile(
                    title: "活动能量",
                    value: HealthFormatting.kilocalories(healthStore.activeEnergy),
                    unit: "千卡",
                    icon: "flame.fill",
                    color: .orange
                )
            }
        }
    }

    private var privacyNote: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("数据留在你的设备上", systemImage: "lock.shield.fill")
                .font(.headline)

            Text("WinPlate 只读取心率、步数和活动能量，不写入 HealthKit，也不上传到互联网。Mac 使用加密的近距离连接；Windows 使用你配置的局域网地址同步当前概览。")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            Button {
                Task { await healthStore.requestAccess() }
            } label: {
                Label(
                    healthStore.hasRequestedAccess ? "重新检查健康权限" : "开启健康数据",
                    systemImage: "heart.text.square.fill"
                )
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(.pink)
            .disabled(healthStore.isLoading)

            if let message = healthStore.message {
                Text(message)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(uiColor: .secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private var communicationCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label("WinPlate 通信", systemImage: healthStore.syncState.symbolName)
                    .font(.headline)
                    .foregroundStyle(syncTint)

                Spacer()

                Text(healthStore.syncState.title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(syncTint)
            }

            Text(healthStore.syncState.detail)
                .font(.subheadline)
                .foregroundStyle(.secondary)

            HStack(spacing: 6) {
                Image(systemName: "arrow.up.circle")
                Text(
                    healthStore.lastSyncSentAt.map {
                        "最近发送于 \($0.formatted(date: .omitted, time: .shortened))"
                    } ?? "尚未发送健康快照"
                )
            }
            .font(.caption)
            .foregroundStyle(.secondary)

            Divider()

            HStack {
                Label("Windows WinPlate", systemImage: healthStore.windowsSyncState.symbolName)
                    .font(.headline)
                    .foregroundStyle(windowsSyncTint)

                Spacer()

                Text(healthStore.windowsSyncState.title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(windowsSyncTint)
            }

            Text(healthStore.windowsSyncState.detail)
                .font(.subheadline)
                .foregroundStyle(.secondary)

            TextField("http://192.168.1.20:8766/api/health/sync?token=...", text: $windowsEndpointDraft)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)
                .textFieldStyle(.roundedBorder)

            Button {
                Task { await healthStore.saveWindowsEndpoint(windowsEndpointDraft) }
            } label: {
                Label("保存地址并测试", systemImage: "arrow.up.right.circle.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .disabled(windowsEndpointDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

            if let lastWindowsSyncSentAt = healthStore.lastWindowsSyncSentAt {
                Text("最近发送于 \(lastWindowsSyncSentAt.formatted(date: .omitted, time: .shortened))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(uiColor: .secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private var syncTint: Color {
        switch healthStore.syncState {
        case .connected: return .green
        case .connecting: return .orange
        case .error: return .red
        case .idle, .searching: return .secondary
        }
    }

    private var windowsSyncTint: Color {
        switch healthStore.windowsSyncState {
        case .connected: return .green
        case .sending: return .orange
        case .error: return .red
        case .notConfigured: return .secondary
        }
    }

    private var unavailableCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Image(systemName: "heart.slash.fill")
                .font(.largeTitle)
                .foregroundStyle(.secondary)

            Text("这台设备不支持健康数据")
                .font(.headline)

            Text("请在支持 HealthKit 的 iPhone 真机上运行 WinPlate Health。")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(uiColor: .secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
    }
}

private struct MetricTile: View {
    let title: String
    let value: String
    let unit: String
    let icon: String
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(color)

            Text(title)
                .font(.subheadline)
                .foregroundStyle(.secondary)

            HStack(alignment: .lastTextBaseline, spacing: 4) {
                Text(value)
                    .font(.system(.title2, design: .rounded, weight: .bold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)

                Text(unit)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(uiColor: .secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }
}
