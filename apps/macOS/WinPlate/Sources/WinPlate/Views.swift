import AppKit
import Foundation
import ServiceManagement
import SwiftUI
import WebKit

struct MenuBarPopoverView: View {
    @EnvironmentObject private var state: AppState

    var body: some View {
        VStack(spacing: 0) {
            MenuBarHeader()
            Divider()
            MenuBarOverview(codex: state.codex, deepSeek: state.deepSeek, codexUpdatedAt: state.codexUpdatedAt, deepSeekUpdatedAt: state.deepSeekUpdatedAt)
            Divider()
            MenuBarWeatherOverview(weather: state.snapshot.weather, alerts: state.weatherAlerts, alertError: state.weatherAlertError)
        }
        .frame(width: 408, height: 392, alignment: .top)
        .background(Color(nsColor: .windowBackgroundColor))
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("WinPlate 状态")
    }
}

private struct MenuBarHeader: View {
    var body: some View {
        HStack(spacing: 10) {
            Image(nsImage: appIcon)
                .resizable()
                .interpolation(.high)
                .scaledToFit()
                .frame(width: 30, height: 30)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                .accessibilityHidden(true)
            Spacer()
            HeaderIconButton(symbol: "rectangle.on.rectangle", label: "打开 WinPlate") {
                NotificationCenter.default.post(name: .showWinPlateMainWindow, object: nil)
            }
            HeaderIconButton(symbol: "gearshape", label: "打开设置") {
                NotificationCenter.default.post(name: .showWinPlateSettingsWindow, object: nil)
            }
        }
        .padding(.horizontal, 16)
        .frame(height: 50)
    }

    private var appIcon: NSImage {
        NSImage(named: NSImage.Name("AppIcon"))
            ?? NSImage(systemSymbolName: "rectangle.3.group.fill", accessibilityDescription: "WinPlate")
            ?? NSImage()
    }
}

private struct HeaderIconButton: View {
    let symbol: String
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 15, weight: .medium))
                .frame(width: 26, height: 26)
                .contentShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
        }
        .buttonStyle(.borderless)
        .help(label)
        .accessibilityLabel(label)
    }
}

private struct MenuBarOverview: View {
    let codex: UsageSnapshot
    let deepSeek: UsageSnapshot
    let codexUpdatedAt: Date?
    let deepSeekUpdatedAt: Date?

    var body: some View {
        HStack(alignment: .center, spacing: 18) {
            UsageRings(fiveHour: codex.fiveHour?.remainingPct, sevenDay: codex.windows?.sevenDay?.remainingPct)
                .frame(width: 132, height: 132)
            VStack(alignment: .leading, spacing: 9) {
                MenuBarCodexSummary(usage: codex, updatedAt: codexUpdatedAt)
                Divider()
                MenuBarAccountRow(name: "DeepSeek", detail: menuBarStatus(deepSeek.status), value: deepSeek.cnyBalance.map { "¥\($0)" } ?? "¥--", updatedAt: deepSeekUpdatedAt, available: deepSeek.isAvailable)
                if deepSeek.status == "Unconfigured" {
                    Button("配置 DeepSeek") {
                        NotificationCenter.default.post(name: .showWinPlateSettingsWindow, object: nil)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.tint)
                    .font(.system(size: 11, weight: .semibold))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }
}

private struct UsageRings: View {
    let fiveHour: Double?
    let sevenDay: Double?

    var body: some View {
        ZStack {
            UsageRing(progress: fiveHour, color: .green, lineWidth: 11)
            UsageRing(progress: sevenDay, color: .orange, lineWidth: 8)
                .padding(12)
            VStack(spacing: 1) {
                Text("5H")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(.secondary)
                Text(fiveHour.map { "\(Int($0.rounded()))%" } ?? "--%")
                    .font(.system(size: 22, weight: .bold).monospacedDigit())
                Text("7D  \(sevenDay.map { "\(Int($0.rounded()))%" } ?? "--%")")
                    .font(.system(size: 10, weight: .semibold).monospacedDigit())
                    .foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Codex 5 小时剩余 \(fiveHour.map { "\(Int($0.rounded()))%" } ?? "不可用")，7 天剩余 \(sevenDay.map { "\(Int($0.rounded()))%" } ?? "不可用")")
    }
}

private struct MenuBarCodexSummary: View {
    let usage: UsageSnapshot
    let updatedAt: Date?

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 7) {
                Circle()
                    .fill(usage.isAvailable ? .green : .secondary)
                    .frame(width: 7, height: 7)
                Text("Codex")
                    .font(.system(size: 14, weight: .semibold))
                Text(menuBarStatus(usage.status))
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
                Spacer()
                Text(updatedAt.map { $0.formatted(date: .omitted, time: .shortened) } ?? "--")
                    .font(.system(size: 9))
                    .foregroundStyle(.secondary)
            }
            VStack(alignment: .leading, spacing: 3) {
                UsageSummaryMetric(label: "5h", resetText: usage.fiveHour?.resetText)
                UsageSummaryMetric(label: "7d", resetText: usage.windows?.sevenDay?.resetText)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Codex，\(menuBarStatus(usage.status))，5 小时剩余 \(usage.fiveHour?.remainingPct.map { "\(Int($0.rounded()))%" } ?? "不可用")，7 天剩余 \(usage.windows?.sevenDay?.remainingPct.map { "\(Int($0.rounded()))%" } ?? "暂无数据")")
    }
}

private struct UsageSummaryMetric: View {
    let label: String
    let resetText: String?

    var body: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(.tint.opacity(0.72))
                .frame(width: 5, height: 5)
            Text("\(label) 重置")
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(.secondary)
            Spacer(minLength: 2)
            Text(resetText ?? "--")
                .font(.system(size: 10, weight: .semibold).monospacedDigit())
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct UsageRing: View {
    let progress: Double?
    let color: Color
    let lineWidth: CGFloat

    var body: some View {
        Circle()
            .stroke(.quaternary, style: StrokeStyle(lineWidth: lineWidth))
            .overlay {
                Circle()
                    .trim(from: 0, to: max(0, min((progress ?? 0) / 100, 1)))
                    .stroke(color, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                    .rotationEffect(.degrees(-90))
            }
    }
}

private struct MenuBarAccountRow: View {
    let name: String
    let detail: String
    let value: String
    let updatedAt: Date?
    let available: Bool

    var body: some View {
        Button {
            NotificationCenter.default.post(name: .showWinPlateMainWindow, object: nil)
        } label: {
            HStack(spacing: 8) {
                Circle()
                    .fill(available ? .green : .secondary)
                    .frame(width: 7, height: 7)
                VStack(alignment: .leading, spacing: 1) {
                    Text(name).font(.system(size: 14, weight: .semibold))
                    Text(detail).font(.system(size: 10)).foregroundStyle(.secondary)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 1) {
                    Text(value)
                        .font(.system(size: 14, weight: .semibold).monospacedDigit())
                    Text(updatedAt.map { $0.formatted(date: .omitted, time: .shortened) } ?? "--")
                        .font(.system(size: 9))
                        .foregroundStyle(.secondary)
                }
            }
        }
        .buttonStyle(.plain)
        .contentShape(Rectangle())
        .accessibilityLabel("\(name)，\(detail)，\(value)")
    }
}

private struct MenuBarWeatherOverview: View {
    let weather: WeatherSnapshot
    let alerts: WeatherAlertSummary
    let alertError: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(alignment: .top) {
                HStack(spacing: 10) {
                    Image(systemName: weatherSymbol)
                        .font(.system(size: 23, weight: .regular))
                        .frame(width: 31)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(weather.location)
                        .font(.system(size: 13, weight: .semibold))
                            .lineLimit(1)
                        Text(weather.condition)
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text(weather.temperature.map { "\(Int($0.rounded()))°" } ?? "--°")
                        .font(.system(size: 23, weight: .bold).monospacedDigit())
                    Text(menuBarDate)
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(.secondary)
                }
            }
            if weather.forecast.isEmpty {
                Text("天气预报将在天气位置配置后显示")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, minHeight: 42, alignment: .leading)
            } else {
                HStack(spacing: 8) {
                    ForEach(Array(weather.forecast.prefix(3).enumerated()), id: \.element.id) { index, forecast in
                        ForecastCell(forecast: forecast, label: forecastLabel(for: forecast, index: index))
                    }
                }
            }
            WeatherAlertStrip(alerts: alerts, error: alertError)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 11)
        .contentShape(Rectangle())
        .onTapGesture {
            NotificationCenter.default.post(name: .showWinPlateMainWindow, object: nil)
        }
    }

    private var weatherSymbol: String {
        guard weather.temperature != nil else { return "cloud.slash" }
        if weather.condition.localizedCaseInsensitiveContains("雨") { return "cloud.rain" }
        if weather.condition.localizedCaseInsensitiveContains("雪") { return "cloud.snow" }
        if weather.condition.localizedCaseInsensitiveContains("晴") { return "sun.max" }
        return "cloud"
    }

    private var menuBarDate: String {
        Date.now.formatted(.dateTime.year().month(.wide).day().weekday(.wide))
    }

    private func forecastLabel(for forecast: WeatherForecast, index: Int) -> String {
        if index == 0 { return "今天" }
        if index == 1 { return "明天" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.dateFormat = "yyyy-MM-dd"
        guard let date = formatter.date(from: forecast.date) else { return forecast.date }
        return date.formatted(.dateTime.weekday(.abbreviated))
    }
}

private struct WeatherAlertStrip: View {
    let alerts: WeatherAlertSummary
    let error: String?

    private var alert: WeatherAlert? {
        alerts.alerts.max { alertPriority($0) < alertPriority($1) }
    }

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: symbol)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 16)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .font(.system(size: 10, weight: .semibold))
                    .lineLimit(1)
                Text(detail)
                    .font(.system(size: 9))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            Text("QWeather")
                .font(.system(size: 9, weight: .medium))
                .foregroundStyle(.tertiary)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background(tint.opacity(alert == nil ? 0.07 : 0.12), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("QWeather 预警，\(title)，\(detail)")
    }

    private var title: String {
        if alert == nil, let error, !error.isEmpty { return "天气预警读取失败" }
        guard let alert else { return "暂无天气预警" }
        return alert.title
    }

    private var detail: String {
        if alert == nil, let error, !error.isEmpty { return error }
        guard let alert else { return "当前地点未发现生效预警" }
        return alert.message.isEmpty ? "预警状态：\(alert.lifecycle)" : alert.message
    }

    private var tint: Color {
        if alert == nil, error?.isEmpty == false { return .orange }
        guard let alert else { return .green }
        switch alert.level {
        case "critical": return .red
        case "success": return .green
        default: return .orange
        }
    }

    private var symbol: String {
        if alert == nil, error?.isEmpty == false { return "exclamationmark.triangle.fill" }
        guard alert != nil else { return "checkmark.shield" }
        return "exclamationmark.triangle.fill"
    }

    private func alertPriority(_ alert: WeatherAlert) -> Int {
        switch alert.level {
        case "critical": return 3
        case "warning": return 2
        case "success": return 1
        default: return 0
        }
    }
}

private struct ForecastCell: View {
    let forecast: WeatherForecast
    let label: String

    var body: some View {
        VStack(spacing: 3) {
            Text(label)
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(.secondary)
            Image(systemName: weatherSymbol)
                .font(.system(size: 17, weight: .regular))
                .frame(height: 20)
                .accessibilityHidden(true)
            Text(forecast.temperatureText)
                .font(.system(size: 11, weight: .semibold).monospacedDigit())
            Text(forecast.condition)
                .font(.system(size: 9))
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, minHeight: 54)
        .padding(.vertical, 5)
        .background(.quinary, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(label)，\(forecast.condition)，\(forecast.temperatureText)")
    }

    private var weatherSymbol: String {
        if forecast.condition.localizedCaseInsensitiveContains("雨") { return "cloud.rain" }
        if forecast.condition.localizedCaseInsensitiveContains("雪") { return "cloud.snow" }
        if forecast.condition.localizedCaseInsensitiveContains("晴") { return "sun.max" }
        return "cloud"
    }
}

func menuBarStatus(_ status: String) -> String {
    switch status {
    case "Normal": return "可用"
    case "Unconfigured": return "未配置"
    case "Insufficient": return "余额不足"
    default: return "不可用"
    }
}

private struct WeatherSection: View {
    let weather: WeatherSnapshot
    var updatedAt: Date? = nil

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: weatherSymbol)
                .font(.system(size: 34, weight: .regular))
                .frame(width: 48)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(weather.temperature.map { "\(Int($0.rounded()))°" } ?? "--°")
                    .font(.title2.monospacedDigit().weight(.semibold))
                Text(weather.condition).font(.subheadline.weight(.medium))
                Text(weather.location).font(.caption).foregroundStyle(.secondary)
                Text(updatedAt.map { "更新于 \($0.formatted(date: .omitted, time: .shortened))" } ?? "尚无成功更新")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
            Spacer()
        }
        .padding(16)
    }

    private var weatherSymbol: String {
        guard weather.temperature != nil else { return "cloud.slash" }
        if weather.condition.localizedCaseInsensitiveContains("雨") { return "cloud.rain" }
        if weather.condition.localizedCaseInsensitiveContains("雪") { return "cloud.snow" }
        if weather.condition.localizedCaseInsensitiveContains("晴") { return "sun.max" }
        return "cloud"
    }
}

struct DashboardView: View {
    @EnvironmentObject private var state: AppState
    @State private var selection: WorkspaceDestination? = .overview

    var body: some View {
        NavigationSplitView {
            List(selection: $selection) {
                ForEach(WorkspaceDestination.allCases, id: \.self) { destination in
                    Label(destination.title, systemImage: destination.symbol)
                        .tag(destination)
                }
            }
            .navigationTitle("WinPlate")
            .frame(minWidth: 190)
        } detail: {
            Group {
                switch selection ?? .overview {
                case .overview: OverviewWorkspace { selection = $0 }
                case .weather: WeatherWorkspace()
                case .github: GitHubWorkspace()
                case .agent: AgentWorkspace()
                case .mail: MailWorkspace()
                case .notifications: NotificationsWorkspace()
                case .settings: SettingsView()
                }
            }
        }
        .task { state.refresh(); state.loadMail(); state.loadNotifications() }
        .sheet(isPresented: Binding(get: { state.selectedMail != nil }, set: { if !$0 { state.closeMail() } })) {
            if let message = state.selectedMail { MailDetail(message: message) }
        }
    }
}

enum WorkspaceDestination: CaseIterable, Hashable {
    case overview, weather, github, agent, mail, notifications, settings
    var title: String {
        switch self { case .overview: "概览"; case .weather: "天气"; case .github: "GitHub"; case .agent: "Agent"; case .mail: "邮件"; case .notifications: "通知"; case .settings: "设置" }
    }
    var symbol: String {
        switch self { case .overview: "rectangle.3.group"; case .weather: "cloud.sun"; case .github: "chevron.left.forwardslash.chevron.right"; case .agent: "terminal"; case .mail: "envelope"; case .notifications: "bell"; case .settings: "gearshape" }
    }
}

private struct MailWorkspace: View {
    @EnvironmentObject private var state: AppState
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            PageHeader(title: "邮件", subtitle: state.mail.error ?? "最近 30 天的 QQ 邮箱邮件") {
                NativeRefreshButton(title: "刷新邮件", isRefreshing: state.isRefreshingMail) {
                    state.loadMail(force: true)
                }
            }
            List(state.mail.items) { item in
                Button { state.openMail(item) } label: {
                    MailOutlineRow(item: item)
                }
                .buttonStyle(.plain)
            }
            .overlay {
                if state.mail.items.isEmpty {
                    ContentUnavailableView(
                        state.mail.availability == "unconfigured" ? "需要邮箱配置" : state.mail.error == nil ? "没有邮件" : "无法读取邮箱",
                        systemImage: "envelope",
                        description: Text(state.mail.error ?? "刷新后会显示本机 API 返回的邮件。")
                    )
                }
            }
        }.padding(28)
    }
}

private struct MailOutlineRow: View {
    let item: MailItem

    private var sentLabel: String {
        guard item.sentAt > 0 else { return "未知时间" }
        return Date(timeIntervalSince1970: TimeInterval(item.sentAt) / 1000)
            .formatted(date: .abbreviated, time: .shortened)
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Circle()
                .fill(item.unread ? Color.accentColor : Color.clear)
                .frame(width: 8, height: 8)
                .padding(.top, 6)

            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Text(item.sender.isEmpty ? "未知发件人" : item.sender)
                        .font(.subheadline.weight(item.unread ? .semibold : .medium))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    Text(item.subject.isEmpty ? "(无主题)" : item.subject)
                        .font(.subheadline.weight(item.unread ? .semibold : .regular))
                        .foregroundStyle(.primary)
                        .multilineTextAlignment(.trailing)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }

                HStack(alignment: .top, spacing: 12) {
                    Text(item.snippet.isEmpty ? "暂无可用摘要" : item.snippet)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    Text(sentLabel)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                        .fixedSize(horizontal: true, vertical: false)
                }
            }
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(item.sender)，\(item.subject)，\(item.snippet)")
    }
}

struct PageHeader<Actions: View>: View {
    let title: String; let subtitle: String; @ViewBuilder let actions: Actions
    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.largeTitle.bold())
                    .lineLimit(1)
                Text(subtitle)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            .layoutPriority(1)
            Spacer()
            actions
                .fixedSize()
        }
    }
}

struct NativeRefreshButton: View {
    let title: String
    let isRefreshing: Bool
    var showsTitle = false
    let action: () -> Void

    @State private var isShowingMinimumFeedback = false

    private var isActive: Bool {
        isRefreshing || isShowingMinimumFeedback
    }

    var body: some View {
        Button {
            guard !isActive else { return }
            withAnimation(.easeInOut(duration: 0.16)) {
                isShowingMinimumFeedback = true
            }
            action()
            Task {
                try? await Task.sleep(for: .milliseconds(550))
                withAnimation(.easeInOut(duration: 0.16)) {
                    isShowingMinimumFeedback = false
                }
            }
        } label: {
            HStack(spacing: 6) {
                Group {
                    if isActive {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Image(systemName: "arrow.clockwise")
                            .font(.system(size: 13, weight: .semibold))
                    }
                }
                .frame(width: 15, height: 15)

                if showsTitle {
                    Text(isActive ? "正在刷新…" : title)
                }
            }
            .frame(minWidth: showsTitle ? nil : 18, minHeight: 18)
        }
        .buttonStyle(.bordered)
        .buttonBorderShape(showsTitle ? .capsule : .circle)
        .controlSize(.regular)
        .disabled(isActive)
        .help(isActive ? "\(title)中…" : title)
        .accessibilityLabel(isActive ? "\(title)中" : title)
        .keyboardShortcut("r", modifiers: .command)
        .animation(.easeInOut(duration: 0.16), value: isActive)
    }
}

private struct MailDetail: View {
    let message: MailMessage
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var colorScheme

    private var isDark: Bool { colorScheme == .dark }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(message.subject.isEmpty ? "(无主题)" : message.subject)
                        .font(.title2.bold())
                        .textSelection(.enabled)
                    Text(message.sender.isEmpty ? "未知发件人" : message.sender)
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                HStack(spacing: 16) {
                    if !message.to.isEmpty {
                        labeledMeta(title: "收件人", value: message.to)
                    }
                    if !message.date.isEmpty {
                        labeledMeta(title: "时间", value: message.date)
                    }
                    labeledMeta(title: "状态", value: message.unread ? "未读" : "已读")
                }
                .font(.caption)
                .foregroundStyle(.secondary)

                Divider()

                Group {
                    if message.hasHTMLBody {
                        MailHTMLPreview(html: message.htmlBody, isDark: isDark)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .strokeBorder(Color.primary.opacity(0.08), lineWidth: 1)
                            )
                    } else if message.textBody.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        ContentUnavailableView(
                            "没有可展示的正文",
                            systemImage: "doc.text",
                            description: Text("这封邮件没有 HTML 或纯文本内容。")
                        )
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                    } else {
                        ScrollView {
                            Text(message.textBody)
                                .font(.body)
                                .foregroundStyle(.primary)
                                .textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }
            }
            .padding(24)
            .frame(minWidth: 720, idealWidth: 860, minHeight: 520, idealHeight: 640)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("关闭") { dismiss() }
                }
            }
        }
    }

    private func labeledMeta(title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.tertiary)
            Text(value)
                .lineLimit(2)
                .textSelection(.enabled)
        }
    }
}

/// Renders email HTML while preserving embedded `<style>` / inline CSS.
private struct MailHTMLPreview: NSViewRepresentable {
    let html: String
    var isDark: Bool = false

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeNSView(context: Context) -> WKWebView {
        let preferences = WKWebpagePreferences()
        preferences.allowsContentJavaScript = false

        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences = preferences
        configuration.preferences.isTextInteractionEnabled = true

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.setValue(false, forKey: "drawsBackground")
        webView.navigationDelegate = context.coordinator
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        let document = Self.makePreviewDocument(from: html, isDark: isDark)
        guard document != context.coordinator.lastDocument else { return }
        context.coordinator.lastDocument = document
        webView.setValue(false, forKey: "drawsBackground")
        webView.layer?.backgroundColor = (isDark
            ? NSColor(calibratedWhite: 0.07, alpha: 1)
            : NSColor.white).cgColor
        webView.loadHTMLString(document, baseURL: nil)
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        var lastDocument = ""

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            if navigationAction.navigationType == .other || navigationAction.navigationType == .reload {
                decisionHandler(.allow)
                return
            }
            if let url = navigationAction.request.url {
                NSWorkspace.shared.open(url)
            }
            decisionHandler(.cancel)
        }
    }

    static func makePreviewDocument(from rawHTML: String, isDark: Bool) -> String {
        // Dark mode uses the same smart-invert approach as Windows so white HTML
        // emails become dark without rewriting message CSS.
        let baseCSS: String
        if isDark {
            baseCSS = """
            html {
              margin: 0;
              min-width: 0;
              background: #ffffff;
              color-scheme: dark;
              filter: invert(1) hue-rotate(180deg) brightness(.96) contrast(.97);
            }
            body {
              margin: 0;
              padding: 16px 18px;
              overflow-wrap: anywhere;
              word-break: break-word;
            }
            img, picture, video, canvas, svg:not(:root) {
              filter: invert(1) hue-rotate(180deg) !important;
              max-width: 100%;
              height: auto;
            }
            table { max-width: 100%; border-collapse: collapse; }
            pre, code { white-space: pre-wrap; overflow-wrap: anywhere; }
            a { color: #2563eb; }
            """
        } else {
            baseCSS = """
            html, body {
              margin: 0;
              min-width: 0;
              background: #ffffff;
              color: #111827;
              color-scheme: light;
            }
            body {
              padding: 16px 18px;
              overflow-wrap: anywhere;
              word-break: break-word;
            }
            img, video { max-width: 100%; height: auto; }
            table { max-width: 100%; border-collapse: collapse; }
            pre, code { white-space: pre-wrap; overflow-wrap: anywhere; }
            a { color: #2563eb; }
            """
        }

        let trimmed = rawHTML.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return """
            <!doctype html><html><head><meta charset="utf-8"><style>\(baseCSS)</style></head><body></body></html>
            """
        }

        let lower = trimmed.lowercased()
        if lower.contains("<html") {
            var document = trimmed
            if let range = document.range(of: "</head>", options: [.caseInsensitive, .diacriticInsensitive]) {
                document.insert(contentsOf: "<style>\(baseCSS)</style>", at: range.lowerBound)
            } else if let range = document.range(of: "<body", options: [.caseInsensitive, .diacriticInsensitive]) {
                document.insert(
                    contentsOf: "<head><meta charset=\"utf-8\"><style>\(baseCSS)</style></head>",
                    at: range.lowerBound
                )
            } else {
                document = """
                <!doctype html><html><head><meta charset="utf-8"><style>\(baseCSS)</style></head><body>\(document)</body></html>
                """
            }
            if !document.lowercased().contains("charset") {
                if let range = document.range(of: "<head>", options: [.caseInsensitive, .diacriticInsensitive]) {
                    let insertAt = document.index(range.upperBound, offsetBy: 0)
                    document.insert(contentsOf: "<meta charset=\"utf-8\">", at: insertAt)
                }
            }
            return document
        }

        return """
        <!doctype html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>\(baseCSS)</style>
        </head>
        <body>\(trimmed)</body>
        </html>
        """
    }
}

private struct AppearanceThemePicker: View {
    @Binding var selection: AppearanceTheme

    var body: some View {
        HStack(spacing: 10) {
            ForEach(AppearanceTheme.allCases) { theme in
                Button {
                    selection = theme
                } label: {
                    VStack(spacing: 8) {
                        Image(systemName: theme.symbolName)
                            .font(.system(size: 18, weight: .semibold))
                            .symbolRenderingMode(.hierarchical)
                            .frame(height: 22)
                        Text(theme.title)
                            .font(.caption.weight(.semibold))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .padding(.horizontal, 8)
                    .background(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .fill(selection == theme ? Color.accentColor.opacity(0.16) : Color.primary.opacity(0.04))
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .strokeBorder(
                                selection == theme ? Color.accentColor.opacity(0.7) : Color.primary.opacity(0.12),
                                lineWidth: selection == theme ? 1.5 : 1
                            )
                    )
                    .foregroundStyle(selection == theme ? Color.accentColor : Color.primary)
                }
                .buttonStyle(.plain)
                .help(theme.detail)
                .accessibilityLabel(theme.title)
                .accessibilityAddTraits(selection == theme ? .isSelected : [])
            }
        }
    }
}

struct SettingsView: View {
    @EnvironmentObject private var state: AppState

    var body: some View {
        SettingsForm(state: state, settings: state.settings)
    }
}

private struct SettingsForm: View {
    let state: AppState
    @ObservedObject private var settings: AppSettingsStore
    @State private var loginItemError: String?
    @State private var deepSeekAPIKey = ""
    @State private var deepSeekBaseURL = ""
    @State private var githubUsername = ""
    @State private var githubToken = ""
    @State private var weatherAPIKey = ""
    @State private var weatherAPIHost = ""
    @State private var weatherProjectID = ""
    @State private var weatherCredentialID = ""
    @State private var weatherPrivateKey = ""
    @State private var qqMailAddress = ""
    @State private var qqMailAuthCode = ""

    init(state: AppState, settings: AppSettingsStore) {
        self.state = state
        _settings = ObservedObject(wrappedValue: settings)
    }

    private var hasWeatherDraft: Bool {
        !weatherAPIKey.isEmpty
            || !weatherProjectID.isEmpty
            || !weatherCredentialID.isEmpty
            || !weatherPrivateKey.isEmpty
            || weatherAPIHost != settings.weatherAPIHost
    }

    private var hasMailDraft: Bool {
        let address = qqMailAddress.trimmingCharacters(in: .whitespacesAndNewlines)
        return !qqMailAuthCode.isEmpty || address != settings.qqMailAddress
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text("应用")
                    .font(.title2.weight(.bold))
                SettingsCard(title: "WinPlate", symbol: "macwindow") {
                    Toggle(
                        "在菜单栏显示 WinPlate",
                        isOn: Binding(
                            get: { state.menuBarEnabled },
                            set: { state.setMenuBarEnabled($0) }
                        )
                    )
                    Toggle("登录时启动", isOn: $settings.launchAtLogin)
                        .onChange(of: settings.launchAtLogin) { _, enabled in updateLoginItem(enabled) }
                    if let loginItemError {
                        ConfigurationStatus(loginItemError, symbol: "exclamationmark.triangle.fill", color: .red)
                    }
                }

                SettingsCard(title: "外观", symbol: "paintpalette.fill") {
                    AppearanceThemePicker(selection: $settings.appearanceTheme)
                }

                Text("服务连接")
                    .font(.title2.weight(.bold))
                    .padding(.top, 8)
                SettingsCard(title: "DeepSeek", symbol: "sparkles") {
                SecureField(
                    settings.deepSeekAPIKey?.isEmpty == false ? "API Key（已配置，重新填写可覆盖）" : "API Key",
                    text: $deepSeekAPIKey
                )
                TextField("服务地址", text: $deepSeekBaseURL)
                SettingsCardActions {
                    ConfigurationStatus(
                        settings.deepSeekAPIKey?.isEmpty == false ? "已配置" : "未配置",
                        symbol: settings.deepSeekAPIKey?.isEmpty == false ? "checkmark.circle.fill" : "circle",
                        color: settings.deepSeekAPIKey?.isEmpty == false ? .green : .secondary
                    )
                } actions: {
                    Button("保存配置") {
                        state.saveDeepSeekConfiguration(apiKey: deepSeekAPIKey, baseURL: deepSeekBaseURL)
                        deepSeekAPIKey = ""
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(deepSeekAPIKey.isEmpty && settings.deepSeekAPIKey?.isEmpty != false)
                }
                }
                SettingsCard(title: "GitHub", symbol: "chevron.left.forwardslash.chevron.right") {
                    TextField("GitHub 用户名", text: $githubUsername)
                        .textContentType(.username)
                    SecureField(
                        settings.hasGitHubToken
                            ? "Personal Access Token（已配置，重新填写可覆盖）"
                            : "Personal Access Token（可选）",
                        text: $githubToken
                    )
                    SettingsCardActions {
                        ConfigurationStatus(
                            settings.hasGitHubToken ? "已配置" : "未配置",
                            symbol: settings.hasGitHubToken ? "checkmark.circle.fill" : "circle",
                            color: settings.hasGitHubToken ? .green : .secondary
                        )
                    } actions: {
                        Button("保存配置") {
                            state.saveGitHubConfiguration(username: githubUsername, token: githubToken)
                            githubToken = ""
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(
                            githubUsername.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                                && githubToken.isEmpty
                                && !settings.hasGitHubToken
                        )
                    }
                }
                SettingsCard(title: "QWeather", symbol: "cloud.sun.fill") {
                SettingsFieldGroup(title: "天气数据") {
                SecureField(
                    settings.weatherAPIKey?.isEmpty == false
                        ? "QWeather API Key（已配置，重新填写可覆盖）"
                        : "QWeather API Key",
                    text: $weatherAPIKey
                )
                    .textContentType(.password)
                TextField("API Host", text: $weatherAPIHost)
                    .textContentType(.URL)
                }
                SettingsFieldGroup(title: "天气预警（JWT）") {
                TextField(
                    settings.weatherProjectID?.isEmpty == false
                        ? "项目 ID（已配置，重新填写可覆盖）"
                        : "项目 ID",
                    text: $weatherProjectID
                )
                TextField(
                    settings.weatherCredentialID?.isEmpty == false
                        ? "JWT 凭据 ID（已配置，重新填写可覆盖）"
                        : "JWT 凭据 ID",
                    text: $weatherCredentialID
                )
                VStack(alignment: .leading, spacing: 5) {
                    Text("Ed25519 私钥 PEM")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    ZStack(alignment: .topLeading) {
                        TextEditor(text: $weatherPrivateKey)
                            .font(.system(.caption, design: .monospaced))
                            .frame(minHeight: 82)
                            .privacySensitive()
                        if weatherPrivateKey.isEmpty {
                            Text(
                                settings.weatherPrivateKey?.isEmpty == false
                                    ? "私钥已配置，重新填写可覆盖"
                                    : "粘贴完整 Ed25519 私钥 PEM"
                            )
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(.tertiary)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 7)
                            .allowsHitTesting(false)
                        }
                    }
                }
                }
                SettingsCardActions {
                    if state.isTestingWeatherAlertConnection {
                        ConfigurationStatus("正在测试…", symbol: "arrow.triangle.2.circlepath", color: .secondary)
                    } else if let error = state.weatherError {
                        ConfigurationStatus(error, symbol: "exclamationmark.triangle.fill", color: .red)
                    } else if let error = state.weatherAlertError {
                        ConfigurationStatus(error, symbol: "exclamationmark.triangle.fill", color: .red)
                    } else if hasWeatherDraft {
                        ConfigurationStatus("有未保存修改", symbol: "pencil.circle", color: .orange)
                    } else if state.isWeatherAlertConnected {
                        ConfigurationStatus("已配置，测试成功", symbol: "checkmark.circle.fill", color: .green)
                    } else {
                        ConfigurationStatus(
                            settings.hasWeatherAlertCredentials ? "已配置，待测试" : "未配置",
                            symbol: settings.hasWeatherAlertCredentials ? "checkmark.circle" : "circle",
                            color: .secondary
                        )
                    }
                } actions: {
                    Button {
                        if hasWeatherDraft {
                            state.saveWeatherConfiguration(
                                apiKey: weatherAPIKey,
                                apiHost: weatherAPIHost,
                                projectID: weatherProjectID,
                                credentialID: weatherCredentialID,
                                privateKey: weatherPrivateKey
                            )
                            weatherAPIKey = ""
                            weatherProjectID = ""
                            weatherCredentialID = ""
                            weatherPrivateKey = ""
                        } else {
                            state.testSavedWeatherAlertConnection()
                        }
                        } label: {
                        if state.isTestingWeatherAlertConnection {
                            HStack(spacing: 6) {
                                ProgressView().controlSize(.small)
                                Text("正在测试")
                            }
                        } else {
                            Text("保存配置")
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(
                        state.isTestingWeatherAlertConnection
                            || (!hasWeatherDraft && !settings.hasWeatherAlertCredentials)
                    )
                }
                }

                SettingsCard(title: "QQ 邮箱", symbol: "envelope.fill") {
                TextField("QQ 邮箱地址", text: $qqMailAddress)
                    .textContentType(.emailAddress)
                SecureField(
                    settings.qqMailAuthCode?.isEmpty == false
                        ? "QQ 邮箱授权码（已配置，重新填写可覆盖）"
                        : "QQ 邮箱授权码",
                    text: $qqMailAuthCode
                )
                    .textContentType(.password)
                SettingsCardActions {
                    if state.isTestingMailConnection {
                        ConfigurationStatus("正在测试…", symbol: "arrow.triangle.2.circlepath", color: .secondary)
                    } else if let error = state.mailConnectionError {
                        ConfigurationStatus(error, symbol: "exclamationmark.triangle.fill", color: .red)
                    } else if hasMailDraft {
                        ConfigurationStatus("有未保存修改", symbol: "pencil.circle", color: .orange)
                    } else if state.isMailConnected {
                        ConfigurationStatus("已配置，测试成功", symbol: "checkmark.circle.fill", color: .green)
                    } else {
                        ConfigurationStatus(
                            settings.qqMailAuthCode?.isEmpty == false ? "已配置，待测试" : "未配置",
                            symbol: settings.qqMailAuthCode?.isEmpty == false ? "checkmark.circle" : "circle",
                            color: .secondary
                        )
                    }
                } actions: {
                    Button {
                        if hasMailDraft {
                            state.saveQQMailConfiguration(address: qqMailAddress, authCode: qqMailAuthCode)
                            qqMailAuthCode = ""
                        } else {
                            state.testSavedQQMailConnection()
                        }
                    } label: {
                        if state.isTestingMailConnection {
                            HStack(spacing: 6) {
                                ProgressView().controlSize(.small)
                                Text("正在测试")
                            }
                        } else {
                            Text("保存配置")
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(
                        state.isTestingMailConnection
                        || (hasMailDraft && (qqMailAddress.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || qqMailAuthCode.isEmpty))
                    )
                }
                Text("请在 QQ 邮箱网页端开启 IMAP/SMTP，并使用授权码而非登录密码。授权码仅存储在 macOS 钥匙串中。")
                    .font(.caption).foregroundStyle(.secondary)
                }
                NativeRefreshButton(
                    title: "刷新所有状态",
                    isRefreshing: state.isRefreshing,
                    showsTitle: true
                ) {
                    state.refresh(force: true)
                }
            }
        }
        .frame(width: 560)
        .padding(24)
        .onAppear {
            deepSeekAPIKey = ""
            deepSeekBaseURL = settings.deepSeekBaseURL
            githubUsername = settings.githubUsername
            githubToken = ""
            weatherAPIKey = ""
            weatherAPIHost = settings.weatherAPIHost
            weatherProjectID = ""
            weatherCredentialID = ""
            weatherPrivateKey = ""
            qqMailAddress = settings.qqMailAddress
            qqMailAuthCode = ""
        }
    }

    private func updateLoginItem(_ enabled: Bool) {
        do {
            if enabled { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
            state.settings.launchAtLogin = enabled
        } catch {
            loginItemError = "无法更新登录项：\(error.localizedDescription)"
            settings.launchAtLogin.toggle()
        }
    }
}

private struct SettingsCard<Content: View>: View {
    let title: String
    let symbol: String
    var description: String? = nil
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label(title, systemImage: symbol)
                .font(.headline)
            if let description, !description.isEmpty {
                Text(description)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Divider()
            content
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

private struct SettingsFieldGroup<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.subheadline.weight(.semibold))
            content
        }
        .padding(14)
        .background(.background.opacity(0.55), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

private struct SettingsCardActions<Status: View, Actions: View>: View {
    @ViewBuilder let status: Status
    @ViewBuilder let actions: Actions

    init(@ViewBuilder status: () -> Status, @ViewBuilder actions: () -> Actions) {
        self.status = status()
        self.actions = actions()
    }

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            status
            Spacer(minLength: 12)
            actions
        }
    }
}

private struct ConfigurationStatus: View {
    let text: String
    let symbol: String
    let color: Color

    init(_ text: String, symbol: String, color: Color) {
        self.text = text
        self.symbol = symbol
        self.color = color
    }

    var body: some View {
        Label(text, systemImage: symbol)
            .font(.caption)
            .foregroundStyle(color)
            .lineLimit(2)
    }
}
