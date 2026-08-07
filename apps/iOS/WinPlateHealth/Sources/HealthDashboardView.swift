import SwiftUI

struct HealthDashboardView: View {
    @EnvironmentObject private var healthStore: HealthStore
    @State private var windowsEndpointDraft = ""
    @State private var isWindowsSetupExpanded = false

    var body: some View {
        NavigationStack {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 24) {
                    header
                    healthHeroCard
                    activitySection
                    connectionsSection
                    privacyCard

                    if !healthStore.isHealthDataAvailable {
                        unavailableCard
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 12)
                .padding(.bottom, 28)
            }
            .background(Color(uiColor: .systemGroupedBackground).ignoresSafeArea())
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await healthStore.refresh() }
                    } label: {
                        if healthStore.isLoading {
                            ProgressView()
                                .controlSize(.small)
                        } else {
                            Image(systemName: "arrow.clockwise")
                        }
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
                isWindowsSetupExpanded = healthStore.windowsEndpoint.isEmpty
                await healthStore.refresh()
            }
        }
        .tint(.primary)
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 14) {
            VStack(alignment: .leading, spacing: 5) {
                Text("健康概览")
                    .font(.system(.largeTitle, design: .rounded, weight: .bold))

                Text("今天，照顾好自己。")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            Spacer(minLength: 12)

            Image("WinPlateMark")
                .resizable()
                .scaledToFill()
                .frame(width: 48, height: 48)
                .clipShape(RoundedRectangle(cornerRadius: 15, style: .continuous))
                .accessibilityHidden(true)
        }
    }

    private var healthHeroCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center) {
                Label("今日状态", systemImage: "waveform.path.ecg")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.78))

                Spacer()

                StatusPill(
                    title: healthStore.lastUpdated == nil ? "等待数据" : "数据已更新",
                    color: healthStore.lastUpdated == nil ? .white.opacity(0.55) : .green,
                    isOnDark: true
                )
            }

            Text("最近心率")
                .font(.subheadline)
                .foregroundStyle(.white.opacity(0.65))
                .padding(.top, 28)

            HStack(alignment: .lastTextBaseline, spacing: 8) {
                Text(HealthFormatting.heartRate(healthStore.latestHeartRate))
                    .font(.system(size: 64, weight: .bold, design: .rounded))
                    .contentTransition(.numericText())
                    .minimumScaleFactor(0.7)

                Text("BPM")
                    .font(.headline.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.65))
            }
            .foregroundStyle(.white)

            Text("显示 Apple 健康中的最近一次心率记录。")
                .font(.footnote)
                .foregroundStyle(.white.opacity(0.65))
                .padding(.top, 2)

            HStack(spacing: 8) {
                Image(systemName: "checkmark.shield.fill")
                Text(lastUpdatedText)
            }
            .font(.caption.weight(.medium))
            .foregroundStyle(.white.opacity(0.72))
            .padding(.top, 24)
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            ZStack(alignment: .bottomTrailing) {
                LinearGradient(
                    colors: [Color(red: 0.12, green: 0.09, blue: 0.18), Color(red: 0.34, green: 0.12, blue: 0.25)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )

                Circle()
                    .fill(Color.pink.opacity(0.35))
                    .frame(width: 160, height: 160)
                    .blur(radius: 12)
                    .offset(x: 42, y: 50)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .stroke(.white.opacity(0.12), lineWidth: 1)
        }
        .shadow(color: .pink.opacity(0.14), radius: 20, y: 12)
    }

    private var activitySection: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeading(title: "今天的活动", subtitle: "来自 Apple 健康")

            LazyVGrid(
                columns: [
                    GridItem(.flexible(), spacing: 12),
                    GridItem(.flexible(), spacing: 12),
                ],
                spacing: 12
            ) {
                MetricCard(
                    title: "步数",
                    value: HealthFormatting.count(healthStore.stepCount),
                    unit: "步",
                    icon: "figure.walk",
                    tint: .blue
                )

                MetricCard(
                    title: "活动能量",
                    value: HealthFormatting.kilocalories(healthStore.activeEnergy),
                    unit: "千卡",
                    icon: "flame.fill",
                    tint: .orange
                )
            }
        }
    }

    private var connectionsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeading(title: "连接设备", subtitle: "只在本地传输当前概览")

            VStack(spacing: 0) {
                DeviceConnectionRow(
                    icon: "desktopcomputer",
                    tint: .indigo,
                    title: "Mac",
                    status: healthStore.syncState.title,
                    detail: macConnectionDetail,
                    statusColor: syncTint
                )

                Divider()
                    .padding(.leading, 58)

                Button {
                    withAnimation(.snappy) {
                        isWindowsSetupExpanded.toggle()
                    }
                } label: {
                    DeviceConnectionRow(
                        icon: "pc",
                        tint: .teal,
                        title: "Windows",
                        status: healthStore.windowsSyncState.title,
                        detail: windowsConnectionDetail,
                        statusColor: windowsSyncTint,
                        showsChevron: true,
                        isExpanded: isWindowsSetupExpanded
                    )
                }
                .buttonStyle(.plain)

                if isWindowsSetupExpanded {
                    windowsSetup
                        .transition(.opacity.combined(with: .move(edge: .top)))
                }
            }
            .padding(.vertical, 4)
            .background(Color(uiColor: .secondarySystemGroupedBackground))
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        }
    }

    private var windowsSetup: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("从 Windows 健康页复制接收地址，粘贴到这里即可配对。")
                .font(.footnote)
                .foregroundStyle(.secondary)

            TextField("192.168.1.20:8766/api/health/sync?token=...", text: $windowsEndpointDraft)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)
                .textFieldStyle(.roundedBorder)

            Button {
                Task { await healthStore.saveWindowsEndpoint(windowsEndpointDraft) }
            } label: {
                Label(windowsActionTitle, systemImage: "arrow.up.right.circle.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(.teal)
            .disabled(windowsEndpointDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

            if let lastWindowsSyncSentAt = healthStore.lastWindowsSyncSentAt {
                Text("最近发送于 \(lastWindowsSyncSentAt.formatted(date: .omitted, time: .shortened))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 14)
    }

    private var privacyCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "lock.shield.fill")
                    .font(.title3)
                    .foregroundStyle(.pink)
                    .frame(width: 30, height: 30)
                    .background(Color.pink.opacity(0.12), in: Circle())

                VStack(alignment: .leading, spacing: 4) {
                    Text("数据留在你的设备上")
                        .font(.headline)

                    Text("WinPlate 只读取心率、步数和活动能量，不写入 HealthKit，也不上传到互联网。")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }

            Button {
                Task { await healthStore.requestAccess() }
            } label: {
                Label(
                    healthStore.hasRequestedAccess ? "重新检查健康权限" : "开启健康数据",
                    systemImage: "heart.text.square.fill"
                )
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .disabled(healthStore.isLoading)

            if let message = healthStore.message {
                Text(message)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(uiColor: .secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private var unavailableCard: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "heart.slash.fill")
                .font(.title3)
                .foregroundStyle(.secondary)

            VStack(alignment: .leading, spacing: 4) {
                Text("这台设备不支持健康数据")
                    .font(.headline)

                Text("请在支持 HealthKit 的 iPhone 真机上运行 WinPlate Health。")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(uiColor: .secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private var lastUpdatedText: String {
        guard let lastUpdated = healthStore.lastUpdated else { return "等待健康权限" }
        return "更新于 \(lastUpdated.formatted(.relative(presentation: .named)))"
    }

    private var macConnectionDetail: String {
        if let lastSyncSentAt = healthStore.lastSyncSentAt {
            return "最近发送于 \(lastSyncSentAt.formatted(date: .omitted, time: .shortened))"
        }
        return healthStore.syncState.detail
    }

    private var windowsConnectionDetail: String {
        if healthStore.windowsEndpoint.isEmpty {
            return "点击配置 Windows 接收地址"
        }
        return healthStore.windowsSyncState.detail
    }

    private var windowsActionTitle: String {
        let draft = windowsEndpointDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        return draft == healthStore.windowsEndpoint && !draft.isEmpty ? "测试连接" : "保存并测试"
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
}

private struct SectionHeading: View {
    let title: String
    let subtitle: String

    var body: some View {
        HStack(alignment: .lastTextBaseline) {
            Text(title)
                .font(.title3.weight(.bold))

            Spacer()

            Text(subtitle)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}

private struct StatusPill: View {
    let title: String
    let color: Color
    var isOnDark = false

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(color)
                .frame(width: 7, height: 7)

            Text(title)
                .font(.caption.weight(.semibold))
        }
        .foregroundStyle(isOnDark ? .white.opacity(0.86) : color)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(isOnDark ? .white.opacity(0.12) : color.opacity(0.12), in: Capsule())
    }
}

private struct MetricCard: View {
    let title: String
    let value: String
    let unit: String
    let icon: String
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 13) {
            Image(systemName: icon)
                .font(.title3.weight(.semibold))
                .foregroundStyle(tint)
                .frame(width: 34, height: 34)
                .background(tint.opacity(0.13), in: RoundedRectangle(cornerRadius: 11, style: .continuous))

            Text(title)
                .font(.subheadline)
                .foregroundStyle(.secondary)

            HStack(alignment: .lastTextBaseline, spacing: 4) {
                Text(value)
                    .font(.system(.title2, design: .rounded, weight: .bold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.65)

                Text(unit)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, minHeight: 132, alignment: .leading)
        .background(Color(uiColor: .secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }
}

private struct DeviceConnectionRow: View {
    let icon: String
    let tint: Color
    let title: String
    let status: String
    let detail: String
    let statusColor: Color
    var showsChevron = false
    var isExpanded = false

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.headline)
                .foregroundStyle(tint)
                .frame(width: 34, height: 34)
                .background(tint.opacity(0.13), in: RoundedRectangle(cornerRadius: 10, style: .continuous))

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(title)
                        .font(.subheadline.weight(.semibold))

                    StatusPill(title: status, color: statusColor)
                }

                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
            }

            Spacer(minLength: 8)

            if showsChevron {
                Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.tertiary)
                    .padding(.top, 6)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .contentShape(Rectangle())
    }
}
