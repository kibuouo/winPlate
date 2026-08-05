import AppKit
import SwiftUI

/// Clean overview dashboard: aligned cards, quiet chrome, clear hierarchy.
struct OverviewWorkspace: View {
    @EnvironmentObject private var state: AppState
    @State private var now = Date()

    private let clock = Timer.publish(every: 30, on: .main, in: .common).autoconnect()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                dashboardHeader
                metricGrid
                if let error = state.lastError, !error.isEmpty {
                    OverviewErrorBanner(message: error)
                }
                systemFooter
            }
            .padding(28)
            .frame(maxWidth: 1120, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .center)
        }
        .background(Color(nsColor: .controlBackgroundColor).opacity(0.32))
        .onReceive(clock) { now = $0 }
        .onAppear {
            if state.mail.items.isEmpty { state.loadMail() }
        }
    }

    // MARK: - Header

    private var dashboardHeader: some View {
        HStack(alignment: .center, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Circle()
                        .fill(overallHealthy ? Color.green : Color.orange)
                        .frame(width: 8, height: 8)
                    Text("LIVE STATUS")
                        .font(.system(size: 11, weight: .bold, design: .rounded))
                        .tracking(1.1)
                        .foregroundStyle(.secondary)
                }
                Text("今日概览")
                    .font(.system(size: 28, weight: .bold, design: .rounded))
                Text("本机服务与已连接账户的实时摘要")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            Spacer(minLength: 12)

            VStack(alignment: .trailing, spacing: 4) {
                Text(now.formatted(date: .numeric, time: .omitted))
                    .font(.subheadline.monospacedDigit().weight(.semibold))
                Text(now.formatted(date: .omitted, time: .shortened) + " · " + weekdayLabel(now))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            NativeRefreshButton(
                title: "刷新所有状态",
                isRefreshing: state.isRefreshing,
                showsTitle: true
            ) {
                state.refresh(force: true)
                state.loadMail(force: true)
            }
        }
        .padding(.horizontal, 4)
    }

    // MARK: - Grid

    private var metricGrid: some View {
        VStack(alignment: .leading, spacing: 16) {
            // Row 1: weather full width
            OverviewCard(
                eyebrow: "WEATHER",
                symbol: weatherSymbol,
                tint: .cyan,
                status: weatherStatus,
                minHeight: 148
            ) {
                weatherCardContent
            }

            // Remaining modules in a 2-column grid
            LazyVGrid(
                columns: [
                    GridItem(.flexible(minimum: 260), spacing: 16),
                    GridItem(.flexible(minimum: 260), spacing: 16)
                ],
                spacing: 16
            ) {
                OverviewCard(
                    eyebrow: "GITHUB",
                    symbol: "chevron.left.forwardslash.chevron.right",
                    tint: .primary,
                    status: githubStatus
                ) {
                    if let github = state.snapshot.github, github.isAvailable {
                        Text(github.username.isEmpty ? github.name : github.username)
                            .font(.system(size: 26, weight: .bold, design: .rounded))
                            .lineLimit(1)
                        Text("\(github.repos) 个仓库 · \(github.followers) 关注者")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        OverviewMetricStrip(items: [
                            .init(value: "\(github.repos)", label: "仓库"),
                            .init(value: "\(github.stars)", label: "星标"),
                            .init(value: "\(github.commitsThisMonth)", label: "本月贡献"),
                            .init(value: "\(github.streakDays)", label: "连续天")
                        ])
                    } else {
                        OverviewEmptyMetric(title: "尚未同步", detail: "打开 GitHub 页或点击刷新")
                    }
                }

                OverviewCard(
                    eyebrow: "CODEX",
                    symbol: "terminal",
                    tint: .blue,
                    status: codexStatus
                ) {
                    let seven = state.codex.sevenDay
                    Text(seven?.remainingPct.map { "\(Int($0.rounded()))%" } ?? "--%")
                        .font(.system(size: 34, weight: .bold, design: .rounded).monospacedDigit())
                    Text("7 天窗口剩余")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    OverviewProgressBar(value: seven?.remainingPct, tint: .blue)
                    HStack {
                        Text("重置 \(seven?.resetText ?? "--")")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Spacer()
                    }
                    if let error = state.codexError {
                        Text(error).font(.caption2).foregroundStyle(.red).lineLimit(2)
                    }
                }

                OverviewCard(
                    eyebrow: "DEEPSEEK",
                    symbol: "sparkles",
                    tint: .purple,
                    status: deepSeekStatus
                ) {
                    Text(state.deepSeek.cnyBalance.map { "¥\($0)" } ?? "¥--")
                        .font(.system(size: 34, weight: .bold, design: .rounded).monospacedDigit())
                    Text("人民币余额")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    OverviewMetricStrip(items: [
                        .init(
                            value: menuBarStatus(state.deepSeek.status),
                            label: "状态"
                        ),
                        .init(
                            value: state.deepSeekUpdatedAt.map { relativeTime($0) } ?? "--",
                            label: "更新"
                        )
                    ])
                    if let error = state.deepSeekError {
                        Text(error).font(.caption2).foregroundStyle(.red).lineLimit(2)
                    }
                }

                OverviewCard(
                    eyebrow: "MAIL",
                    symbol: "envelope.fill",
                    tint: .indigo,
                    status: mailStatus
                ) {
                    let unread = state.mail.unreadCount ?? state.mail.items.filter(\.unread).count
                    Text("\(unread)")
                        .font(.system(size: 34, weight: .bold, design: .rounded).monospacedDigit())
                    Text("未读邮件")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    OverviewMetricStrip(items: [
                        .init(value: "\(state.mail.items.count)", label: "列表"),
                        .init(
                            value: mailAvailabilityLabel,
                            label: "连接"
                        )
                    ])
                    if let error = state.mail.error ?? state.mailConnectionError {
                        Text(error)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }
                }
            }
        }
    }

    /// Full-width weather row: temperature/condition left, metrics right.
    private var weatherCardContent: some View {
        let weather = state.snapshot.weather
        return HStack(alignment: .center, spacing: 24) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text(state.menuBarTemperature)
                    .font(.system(size: 40, weight: .bold, design: .rounded).monospacedDigit())
                VStack(alignment: .leading, spacing: 4) {
                    Text(weather.condition)
                        .font(.title3.weight(.semibold))
                        .lineLimit(1)
                    Text(weather.location.isEmpty ? "未选择城市" : weather.location)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            .frame(minWidth: 200, alignment: .leading)

            Spacer(minLength: 8)

            OverviewMetricStrip(items: [
                .init(
                    value: weather.feelsLike.map { "\(Int($0.rounded()))°" } ?? "--",
                    label: "体感"
                ),
                .init(
                    value: weather.humidity.map { "\($0)%" } ?? "--",
                    label: "湿度"
                ),
                .init(
                    value: weather.windScale.isEmpty
                        ? (weather.windDirection.isEmpty ? "--" : weather.windDirection)
                        : "\(weather.windDirection)\(weather.windScale)级",
                    label: "风力"
                ),
                .init(
                    value: state.weatherUpdatedAt.map { relativeTime($0) } ?? "--",
                    label: "更新"
                )
            ])
            .frame(maxWidth: 420)
        }
    }

    // MARK: - Footer

    private var systemFooter: some View {
        HStack(spacing: 14) {
            HStack(spacing: 8) {
                Circle()
                    .fill(overallHealthy ? Color.green : Color.orange)
                    .frame(width: 8, height: 8)
                VStack(alignment: .leading, spacing: 2) {
                    Text(overallHealthy ? "All systems normal" : "Partial services degraded")
                        .font(.subheadline.weight(.semibold))
                    Text(footerDetail)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            OverviewFooterChip(
                symbol: "arrow.clockwise",
                title: "刷新全部",
                subtitle: state.isRefreshing ? "刷新中…" : "立即同步"
            ) {
                state.refresh(force: true)
                state.loadMail(force: true)
            }
            OverviewFooterChip(
                symbol: "gearshape",
                title: "打开设置",
                subtitle: "账户与密钥"
            ) {
                NotificationCenter.default.post(name: .showWinPlateSettingsWindow, object: nil)
            }
        }
        .padding(16)
        .background {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(Color(nsColor: .windowBackgroundColor).opacity(0.72))
        }
        .overlay {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(Color.primary.opacity(0.06))
        }
    }

    // MARK: - Status helpers

    private var overallHealthy: Bool {
        weatherOK || codexOK || deepSeekOK || githubOK
    }

    private var weatherOK: Bool { state.snapshot.weather.isAvailable }
    private var codexOK: Bool { state.codex.isAvailable }
    private var deepSeekOK: Bool { state.deepSeek.isAvailable }
    private var githubOK: Bool { state.snapshot.github?.isAvailable == true }

    private var footerDetail: String {
        var parts: [String] = []
        parts.append(codexOK ? "Codex 可用" : "Codex 离线")
        parts.append(weatherOK ? "天气正常" : "天气待配置")
        parts.append(githubOK ? "GitHub 已同步" : "GitHub 待同步")
        return parts.joined(separator: " · ")
    }

    private var githubStatus: OverviewCardStatus {
        guard let github = state.snapshot.github, github.isAvailable else {
            return .muted("未同步")
        }
        return .ok(github.status == "Live" ? "Live" : "正常")
    }

    private var codexStatus: OverviewCardStatus {
        state.codex.isAvailable ? .ok("正常") : .muted(menuBarStatus(state.codex.status))
    }

    private var deepSeekStatus: OverviewCardStatus {
        switch state.deepSeek.status {
        case "Normal": return .ok("正常")
        case "Unconfigured": return .muted("未配置")
        default: return .warn(menuBarStatus(state.deepSeek.status))
        }
    }

    private var weatherStatus: OverviewCardStatus {
        weatherOK ? .ok("服务正常") : .muted("不可用")
    }

    private var mailStatus: OverviewCardStatus {
        if state.mail.availability == "live" || state.isMailConnected { return .ok("已连接") }
        if state.mail.availability == "unconfigured" { return .muted("未配置") }
        return .muted(state.mail.error == nil ? "待机" : "异常")
    }

    private var mailAvailabilityLabel: String {
        switch state.mail.availability {
        case "live": return "在线"
        case "unconfigured": return "未配置"
        default: return state.isMailConnected ? "已测" : "离线"
        }
    }

    private var weatherSymbol: String {
        let weather = state.snapshot.weather
        guard weather.temperature != nil else { return "cloud.slash" }
        if weather.condition.localizedCaseInsensitiveContains("雨") { return "cloud.rain.fill" }
        if weather.condition.localizedCaseInsensitiveContains("雪") { return "cloud.snow.fill" }
        if weather.condition.localizedCaseInsensitiveContains("晴") { return "sun.max.fill" }
        return "cloud.sun.fill"
    }

    private func weekdayLabel(_ date: Date) -> String {
        date.formatted(.dateTime.weekday(.wide))
    }

    private func relativeTime(_ date: Date) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}

// MARK: - Card chrome

private enum OverviewCardStatus {
    case ok(String)
    case warn(String)
    case muted(String)

    var text: String {
        switch self {
        case .ok(let t), .warn(let t), .muted(let t): return t
        }
    }

    var color: Color {
        switch self {
        case .ok: return .green
        case .warn: return .orange
        case .muted: return .secondary
        }
    }
}

private struct OverviewCard<Content: View>: View {
    let eyebrow: String
    let symbol: String
    let tint: Color
    let status: OverviewCardStatus
    var minHeight: CGFloat = 188
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                Image(systemName: symbol)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(tint)
                    .frame(width: 30, height: 30)
                    .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                Text(eyebrow)
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .tracking(1.0)
                    .foregroundStyle(.secondary)
                Spacer(minLength: 8)
                OverviewStatusPill(status: status)
            }
            content
            Spacer(minLength: 0)
        }
        .padding(18)
        .frame(maxWidth: .infinity, minHeight: minHeight, alignment: .topLeading)
        .background {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(Color(nsColor: .windowBackgroundColor).opacity(0.88))
        }
        .overlay {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .strokeBorder(Color.primary.opacity(0.06))
        }
        .shadow(color: .black.opacity(0.05), radius: 16, y: 6)
    }
}

private struct OverviewStatusPill: View {
    let status: OverviewCardStatus

    var body: some View {
        HStack(spacing: 5) {
            Circle()
                .fill(status.color)
                .frame(width: 6, height: 6)
            Text(status.text)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(status.color == .secondary ? Color.secondary : status.color)
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 5)
        .background(status.color.opacity(0.12), in: Capsule())
    }
}

private struct OverviewMetricItem: Identifiable {
    let id = UUID()
    let value: String
    let label: String
}

private struct OverviewMetricStrip: View {
    let items: [OverviewMetricItem]

    var body: some View {
        HStack(spacing: 8) {
            ForEach(items) { item in
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.value)
                        .font(.caption.monospacedDigit().weight(.semibold))
                        .lineLimit(1)
                    Text(item.label)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
        }
        .padding(.top, 4)
    }
}

private struct OverviewProgressBar: View {
    let value: Double?
    let tint: Color

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.primary.opacity(0.06))
                Capsule()
                    .fill(tint.opacity(0.85))
                    .frame(width: max(6, geo.size.width * CGFloat((value ?? 0) / 100)))
            }
        }
        .frame(height: 6)
        .padding(.vertical, 2)
        .accessibilityLabel("剩余配额")
        .accessibilityValue(value.map { "\(Int($0.rounded()))%" } ?? "不可用")
    }
}

private struct OverviewEmptyMetric: View {
    let title: String
    let detail: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.title3.weight(.semibold))
            Text(detail)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.top, 8)
    }
}

private struct OverviewErrorBanner: View {
    let message: String

    var body: some View {
        Label(message, systemImage: "exclamationmark.triangle.fill")
            .font(.subheadline)
            .foregroundStyle(.orange)
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.orange.opacity(0.10), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

private struct OverviewFooterChip: View {
    let symbol: String
    let title: String
    let subtitle: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: symbol)
                    .font(.system(size: 13, weight: .semibold))
                    .frame(width: 28, height: 28)
                    .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                VStack(alignment: .leading, spacing: 1) {
                    Text(title)
                        .font(.caption.weight(.semibold))
                    Text(subtitle)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}
