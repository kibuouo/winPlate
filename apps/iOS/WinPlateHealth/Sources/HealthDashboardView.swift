import SwiftUI

struct HealthDashboardView: View {
    @EnvironmentObject private var healthStore: HealthStore
    @State private var windowsEndpointDraft = ""
    @State private var macPairingDraft = ""
    @State private var isWindowsSetupExpanded = false
    @State private var isMacSetupExpanded = false

    var body: some View {
        NavigationStack {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 16) {
                    header
                    desktopStatusSection
                    healthOverviewSection
                    connectionsSection
                    systemPrivacyCard

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
            .refreshable {
                await healthStore.refresh()
            }
            .task {
                windowsEndpointDraft = healthStore.windowsEndpoint
                macPairingDraft = healthStore.macPairingCode
                isWindowsSetupExpanded = healthStore.windowsEndpoint.isEmpty
                isMacSetupExpanded = healthStore.macPairingCode.isEmpty
                await healthStore.refresh()
            }
        }
        .tint(.primary)
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 14) {
            VStack(alignment: .leading, spacing: 0) {
                Text("Winplate")
                    .font(.system(.largeTitle, design: .rounded, weight: .bold))
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

    private var desktopStatusSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            DashboardModuleHeader(
                icon: "desktopcomputer",
                tint: .indigo,
                title: "桌面状态",
                subtitle: desktopStatusSubtitle
            )

            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .center, spacing: 12) {
                    Image(systemName: desktopWeatherSymbol)
                        .font(.title2.weight(.semibold))
                        .foregroundStyle(.orange)
                        .frame(width: 38, height: 38)
                        .background(Color.orange.opacity(0.13), in: RoundedRectangle(cornerRadius: 12, style: .continuous))

                    VStack(alignment: .leading, spacing: 3) {
                        Text(healthStore.desktopStatus.weather?.location ?? "等待桌面数据")
                            .font(.subheadline.weight(.semibold))
                        Text(healthStore.desktopStatus.weather?.condition ?? "打开 Mac 或 Windows 版 WinPlate 后同步")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    Spacer()

                    Text(desktopTemperature)
                        .font(.system(.title2, design: .rounded, weight: .bold))
                }

                Divider()

                LazyVGrid(
                    columns: [
                        GridItem(.flexible(), spacing: 8),
                        GridItem(.flexible(), spacing: 8),
                        GridItem(.flexible(), spacing: 8),
                    ],
                    spacing: 8
                ) {
                    DesktopQuotaCard(
                        title: "Codex",
                        value: quotaText(healthStore.desktopStatus.codex?.remainingPct),
                        detail: healthStore.desktopStatus.codex?.resetText ?? "额度",
                        tint: .blue
                    )
                    DesktopQuotaCard(
                        title: "Grok",
                        value: quotaText(healthStore.desktopStatus.superGrok?.remainingPct),
                        detail: healthStore.desktopStatus.superGrok?.resetText ?? "额度",
                        tint: .orange
                    )
                    DesktopQuotaCard(
                        title: "DeepSeek",
                        value: desktopBalanceText,
                        detail: healthStore.desktopStatus.deepSeek?.status == "Normal" ? "余额" : "未配置",
                        tint: .purple
                    )
                }

                if let error = healthStore.desktopStatusError {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(uiColor: .secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private var healthOverviewSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            DashboardModuleHeader(
                icon: "heart.fill",
                tint: .pink,
                title: "健康数据",
                subtitle: "Apple 健康"
            )

            healthHeroCard

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

    private var healthHeroCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "waveform.path.ecg")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(Color(uiColor: .systemPink))
                    .frame(width: 36, height: 36)
                    .background(
                        Color(uiColor: .systemPink).opacity(0.13),
                        in: RoundedRectangle(cornerRadius: 11, style: .continuous)
                    )

                VStack(alignment: .leading, spacing: 3) {
                    Text("最近心率")
                        .font(.subheadline.weight(.semibold))

                    Text("来自 Apple 健康的最新采样")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer(minLength: 8)

                StatusPill(
                    title: healthStore.lastUpdated == nil ? "等待数据" : "数据已更新",
                    color: healthStore.lastUpdated == nil ? .secondary : .green
                )
            }

            HStack(alignment: .lastTextBaseline, spacing: 8) {
                Text(HealthFormatting.heartRate(healthStore.latestHeartRate))
                    .font(.system(size: 60, weight: .bold, design: .rounded))
                    .contentTransition(.numericText())
                    .minimumScaleFactor(0.7)

                Text("BPM")
                    .font(.headline.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
            .foregroundStyle(.primary)
            .padding(.top, 20)

            HStack(spacing: 8) {
                Image(systemName: "checkmark.shield.fill")
                Text(lastUpdatedText)
            }
            .font(.caption.weight(.medium))
            .foregroundStyle(.secondary)
            .padding(.top, 14)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(uiColor: .secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private var connectionsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            DashboardModuleHeader(
                icon: "arrow.triangle.2.circlepath",
                tint: .teal,
                title: "设备连接",
                subtitle: "本地传输"
            )

            VStack(spacing: 0) {
                Button {
                    withAnimation(.snappy) {
                        isMacSetupExpanded.toggle()
                    }
                } label: {
                    DeviceConnectionRow(
                        icon: "desktopcomputer",
                        tint: .indigo,
                        title: "Mac",
                        status: healthStore.syncState.title,
                        detail: macConnectionDetail,
                        statusColor: syncTint,
                        showsChevron: true,
                        isExpanded: isMacSetupExpanded
                    )
                }
                .buttonStyle(.plain)

                if isMacSetupExpanded {
                    macSetup
                        .transition(.opacity.combined(with: .move(edge: .top)))
                }

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
        }
        .padding(16)
        .background(Color(uiColor: .secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private var macSetup: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("在 Mac 的健康页查看 6 位配对码，输入后才会接受附近设备连接。")
                .font(.footnote)
                .foregroundStyle(.secondary)

            TextField("Mac 配对码", text: $macPairingDraft)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.numberPad)
                .textFieldStyle(.roundedBorder)

            Button {
                healthStore.saveMacPairingCode(macPairingDraft)
            } label: {
                Label(healthStore.macPairingCode.isEmpty ? "保存配对码" : "更新配对码", systemImage: "lock.rotation")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(.indigo)
            .disabled(macPairingDraft.filter(\.isNumber).count != 6)
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 14)
    }

    private var windowsSetup: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("在 Windows 健康页点“复制配对信息”，然后粘贴到这里。旧版地址或带 token 的链接仍然可用。")
                .font(.footnote)
                .foregroundStyle(.secondary)

            TextField(
                healthStore.hasWindowsToken ? "已配置，重新粘贴可覆盖" : "winplate://192.168.1.20:8766#…",
                text: $windowsEndpointDraft,
                axis: .vertical
            )
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)
                .textFieldStyle(.roundedBorder)
                .lineLimit(2...4)

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

    private var systemPrivacyCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "lock.shield.fill")
                    .font(.title3)
                    .foregroundStyle(.pink)
                    .frame(width: 30, height: 30)
                    .background(Color.pink.opacity(0.12), in: Circle())

                VStack(alignment: .leading, spacing: 4) {
                    Text("系统与隐私")
                        .font(.headline)

                    Text("iOS 按需唤醒后台同步；数据只在本机处理。")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }

            Divider()

            VStack(alignment: .leading, spacing: 8) {
                diagnosticRow(
                    title: "后台通知",
                    value: healthStore.isHealthKitBackgroundSyncEnabled ? "已注册" : "未注册"
                )
                diagnosticRow(
                    title: "最近唤醒",
                    value: healthStore.lastHealthKitObserverWakeAt?.formatted(date: .omitted, time: .shortened) ?? "尚未唤醒"
                )
                diagnosticRow(
                    title: "待发送快照",
                    value: "\(healthStore.pendingWindowsSnapshotCount) 条"
                )
            }

            Text("系统会在 HealthKit 有新数据时尽量唤醒；强制关闭 App 后不保证恢复。")
                .font(.caption)
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

    private func diagnosticRow(title: String, value: String) -> some View {
        HStack {
            Text(title)
                .font(.footnote)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .font(.footnote.weight(.medium))
        }
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

    private var desktopStatusSubtitle: String {
        guard let date = healthStore.lastDesktopStatusAt else { return "等待 Mac / Windows" }
        return "更新于 \(date.formatted(date: .omitted, time: .shortened))"
    }

    private var desktopTemperature: String {
        guard let temperature = healthStore.desktopStatus.weather?.temperature else { return "--°" }
        return "\(Int(temperature.rounded()))°"
    }

    private var desktopBalanceText: String {
        guard let balance = healthStore.desktopStatus.deepSeek?.balance, !balance.isEmpty else { return "--" }
        let currency = healthStore.desktopStatus.deepSeek?.currency?.uppercased() == "CNY" ? "¥" : ""
        return "\(currency)\(balance)"
    }

    private var desktopWeatherSymbol: String {
        let condition = healthStore.desktopStatus.weather?.condition ?? ""
        if condition.localizedCaseInsensitiveContains("雨") { return "cloud.rain.fill" }
        if condition.localizedCaseInsensitiveContains("雪") { return "cloud.snow.fill" }
        if condition.localizedCaseInsensitiveContains("晴") { return "sun.max.fill" }
        return healthStore.desktopStatus.weather?.temperature == nil ? "cloud.fill" : "cloud.sun.fill"
    }

    private func quotaText(_ value: Double?) -> String {
        guard let value else { return "--%" }
        return "\(Int(value.rounded()))%"
    }

    private var macConnectionDetail: String {
        if healthStore.macPairingCode.isEmpty {
            return "点击输入 Mac 上显示的 6 位配对码"
        }
        if let lastSyncSentAt = healthStore.lastSyncSentAt {
            return "最近发送于 \(lastSyncSentAt.formatted(date: .omitted, time: .shortened))"
        }
        return healthStore.syncState.detail
    }

    private var windowsConnectionDetail: String {
        if healthStore.windowsEndpoint.isEmpty {
            return "点击粘贴 Windows 配对信息"
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

private struct DashboardModuleHeader: View {
    let icon: String
    let tint: Color
    let title: String
    let subtitle: String

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            Image(systemName: icon)
                .font(.subheadline.weight(.bold))
                .foregroundStyle(tint)
                .frame(width: 30, height: 30)
                .background(tint.opacity(0.13), in: RoundedRectangle(cornerRadius: 10, style: .continuous))

            Text(title)
                .font(.headline.weight(.semibold))

            Spacer()

            Text(subtitle)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
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

private struct DesktopQuotaCard: View {
    let title: String
    let value: String
    let detail: String
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.system(.title3, design: .rounded, weight: .bold))
                .lineLimit(1)
                .minimumScaleFactor(0.65)
            Text(detail)
                .font(.caption2)
                .foregroundStyle(.tertiary)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, minHeight: 82, alignment: .leading)
        .padding(.horizontal, 10)
        .padding(.vertical, 9)
        .background(tint.opacity(0.08), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
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
