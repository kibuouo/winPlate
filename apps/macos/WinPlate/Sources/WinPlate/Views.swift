import AppKit
import Foundation
import ServiceManagement
import SwiftUI

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

private func menuBarStatus(_ status: String) -> String {
    switch status {
    case "Normal": return "可用"
    case "Unconfigured": return "未配置"
    case "Insufficient": return "余额不足"
    default: return "不可用"
    }
}

private struct UsageProgress: View {
    let label: String
    let usage: UsageWindow?

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text(label).font(.subheadline)
                Spacer()
                Text(usage?.remainingPct.map { "\(Int($0.rounded()))%" } ?? "--%")
                    .font(.subheadline.monospacedDigit().weight(.medium))
            }
            ProgressView(value: usage?.remainingPct ?? 0, total: 100)
                .tint(.secondary)
                .accessibilityLabel(label)
                .accessibilityValue(usage?.remainingPct.map { "\(Int($0.rounded()))%" } ?? "不可用")
            Text("重置：\(usage?.resetText ?? "--")")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
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
                case .overview: OverviewWorkspace()
                case .weather: WeatherWorkspace()
                case .github: GitHubWorkspace()
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

private enum WorkspaceDestination: CaseIterable, Hashable {
    case overview, weather, github, mail, notifications, settings
    var title: String {
        switch self { case .overview: "概览"; case .weather: "天气"; case .github: "GitHub"; case .mail: "邮件"; case .notifications: "通知"; case .settings: "设置" }
    }
    var symbol: String {
        switch self { case .overview: "rectangle.3.group"; case .weather: "cloud.sun"; case .github: "chevron.left.forwardslash.chevron.right"; case .mail: "envelope"; case .notifications: "bell"; case .settings: "gearshape" }
    }
}

private struct OverviewWorkspace: View {
    @EnvironmentObject private var state: AppState
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                PageHeader(title: "今日状态", subtitle: "来自本机服务与已配置账户的实时摘要") {
                    Button { state.refresh(force: true) } label: { Label("刷新", systemImage: "arrow.clockwise") }.disabled(state.isRefreshing)
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 16)], spacing: 16) {
                    DashboardCard(title: "Codex", symbol: "terminal", status: state.codex.status) {
                        UsageProgress(label: "5 小时剩余", usage: state.codex.fiveHour)
                        UsageProgress(label: "7 天剩余", usage: state.codex.windows?.sevenDay)
                        if let error = state.codexError { Text(error).font(.caption2).foregroundStyle(.red) }
                    }
                    DashboardCard(title: "DeepSeek", symbol: "sparkles", status: state.deepSeek.status) {
                        Text(state.deepSeek.cnyBalance.map { "¥\($0)" } ?? "¥--").font(.title.monospacedDigit().weight(.semibold))
                        Text("人民币余额").font(.caption).foregroundStyle(.secondary)
                        if let error = state.deepSeekError { Text(error).font(.caption2).foregroundStyle(.red) }
                    }
                    DashboardCard(title: "天气", symbol: "cloud.sun", status: state.snapshot.weather.temperature == nil ? "Unavailable" : "Normal") { HStack { Text(state.menuBarTemperature).font(.title.monospacedDigit().weight(.semibold)); VStack(alignment: .leading) { Text(state.snapshot.weather.condition); Text(state.snapshot.weather.location).font(.caption).foregroundStyle(.secondary) } } }
                    DashboardCard(title: "通知", symbol: "bell", status: state.notifications.unreadCount > 0 ? "Normal" : "Unavailable") { Text("\(state.notifications.unreadCount)").font(.title.monospacedDigit().weight(.semibold)); Text("未读通知").font(.caption).foregroundStyle(.secondary) }
                }
                if let error = state.lastError { Label(error, systemImage: "exclamationmark.triangle").font(.subheadline).foregroundStyle(.secondary) }
            }.padding(28)
        }
    }
}

private struct WeatherWorkspace: View {
    @EnvironmentObject private var state: AppState
    @State private var query = ""
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            PageHeader(title: "天气", subtitle: "搜索城市并保存为当前天气位置") { Button { state.refresh(force: true) } label: { Label("刷新", systemImage: "arrow.clockwise") } }
            HStack {
                TextField("城市，例如：上海", text: $query).onSubmit { state.searchWeatherLocations(query) }
                Button("搜索") { state.searchWeatherLocations(query) }.disabled(query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .textFieldStyle(.roundedBorder)
            if let error = state.weatherError {
                Label(error, systemImage: "exclamationmark.triangle")
                    .font(.caption)
                    .foregroundStyle(.red)
            }
            WeatherSection(weather: state.snapshot.weather, updatedAt: state.weatherUpdatedAt).background(.quaternary, in: RoundedRectangle(cornerRadius: 14))
            List(state.weatherLocations) { location in
                Button { state.selectWeatherLocation(location) } label: {
                    VStack(alignment: .leading) { Text(location.displayName); Text(location.id).font(.caption).foregroundStyle(.secondary) }
                }.buttonStyle(.plain)
            }
            .overlay { if state.weatherLocations.isEmpty { ContentUnavailableView("搜索天气位置", systemImage: "magnifyingglass", description: Text("输入城市后选择结果，应用会保存该位置。")) } }
        }.padding(28)
    }
}

private struct GitHubWorkspace: View {
    @EnvironmentObject private var state: AppState
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            PageHeader(title: "GitHub", subtitle: "账户、仓库与最近同步状态") { Button { state.refreshGitHub() } label: { Label("同步", systemImage: "arrow.clockwise") } }
            if let github = state.snapshot.github {
                VStack(alignment: .leading, spacing: 14) {
                    HStack { VStack(alignment: .leading) { Text(github.name).font(.title2.bold()); Text(github.username).foregroundStyle(.secondary) }; Spacer(); if let url = URL(string: github.profileUrl) { Link("打开主页", destination: url) } }
                    Divider()
                    HStack(spacing: 36) { GitHubMetric(value: "\(github.repos)", label: "公开仓库"); GitHubMetric(value: "\(github.followers)", label: "关注者"); GitHubMetric(value: "★ \(github.stars)", label: github.language) }
                    Text("最近项目：\(github.project)").font(.subheadline)
                    if let message = github.stateMessage { Text(message).font(.caption).foregroundStyle(.secondary) }
                }.padding(22).background(.quaternary, in: RoundedRectangle(cornerRadius: 16))
            } else { ContentUnavailableView("尚未同步 GitHub", systemImage: "chevron.left.forwardslash.chevron.right", description: Text("请在后端环境中配置 GitHub Token 后同步。")) }
            Spacer()
        }.padding(28)
    }
}

private struct MailWorkspace: View {
    @EnvironmentObject private var state: AppState
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            PageHeader(title: "邮件", subtitle: state.mail.error ?? "最近 30 天的 QQ 邮箱邮件") { Button { state.loadMail(force: true) } label: { Label("刷新", systemImage: "arrow.clockwise") } }
            List(state.mail.items) { item in
                Button { state.openMail(item) } label: {
                    HStack(alignment: .top, spacing: 12) { Circle().fill(item.unread ? Color.accentColor : Color.clear).frame(width: 8, height: 8).padding(.top, 5); VStack(alignment: .leading, spacing: 3) { Text(item.subject).lineLimit(1); Text(item.sender).font(.caption).foregroundStyle(.secondary); Text(item.snippet).font(.caption).foregroundStyle(.secondary).lineLimit(2) }; Spacer(); Text(Date(timeIntervalSince1970: TimeInterval(item.sentAt) / 1000).formatted(date: .abbreviated, time: .shortened)).font(.caption2).foregroundStyle(.secondary) }
                }.buttonStyle(.plain)
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

private struct NotificationsWorkspace: View {
    @EnvironmentObject private var state: AppState
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            PageHeader(title: "通知", subtitle: "\(state.notifications.unreadCount) 条未读") { HStack { Button("全部标为已读") { state.markAllNotificationsRead() }.disabled(state.notifications.unreadCount == 0); Button { state.loadNotifications() } label: { Image(systemName: "arrow.clockwise") } } }
            List(state.notifications.items) { notification in
                Button { state.markNotificationRead(notification) } label: {
                    HStack(alignment: .top, spacing: 10) { Circle().fill(notification.unread ? severityColor(notification.level) : Color.clear).frame(width: 8, height: 8).padding(.top, 5); VStack(alignment: .leading, spacing: 3) { Text(notification.title); Text(notification.message).font(.caption).foregroundStyle(.secondary).lineLimit(2); Text(notification.source.uppercased()).font(.caption2).foregroundStyle(.tertiary) } }
                }.buttonStyle(.plain)
            }
            .overlay { if state.notifications.items.isEmpty { ContentUnavailableView("没有通知", systemImage: "bell", description: Text("本机 API 产生的状态和服务提醒会显示在这里。")) } }
        }.padding(28)
    }
    private func severityColor(_ level: String) -> Color { level == "critical" ? .red : level == "warning" ? .orange : .accentColor }
}

private struct PageHeader<Actions: View>: View {
    let title: String; let subtitle: String; @ViewBuilder let actions: Actions
    var body: some View { HStack { VStack(alignment: .leading, spacing: 4) { Text(title).font(.largeTitle.bold()); Text(subtitle).foregroundStyle(.secondary) }; Spacer(); actions } }
}

private struct GitHubMetric: View {
    let value: String; let label: String
    var body: some View { VStack(alignment: .leading, spacing: 2) { Text(value).font(.title3.monospacedDigit().weight(.semibold)); Text(label).font(.caption).foregroundStyle(.secondary) } }
}

private struct MailDetail: View {
    let message: MailMessage
    var body: some View { VStack(alignment: .leading, spacing: 14) { Text(message.subject).font(.title2.bold()); Text(message.sender).foregroundStyle(.secondary); Divider(); ScrollView { Text(message.textBody.isEmpty ? "此邮件没有可显示的纯文本内容。" : message.textBody).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading) } }.padding(24).frame(minWidth: 560, minHeight: 420) }
}

private struct DashboardCard<Content: View>: View {
    let title: String; let symbol: String; let status: String; @ViewBuilder let content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Label(title, systemImage: symbol).font(.headline)
                Spacer()
                Circle().fill(status == "Normal" ? Color.green : Color.secondary).frame(width: 8, height: 8)
            }
            content
        }
        .padding(18)
        .frame(maxWidth: .infinity, minHeight: 154, alignment: .topLeading)
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
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

    private var hasMailDraft: Bool {
        let address = qqMailAddress.trimmingCharacters(in: .whitespacesAndNewlines)
        return !qqMailAuthCode.isEmpty || address != settings.qqMailAddress
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text("应用")
                    .font(.title2.weight(.bold))
                SettingsCard(title: "WinPlate", symbol: "macwindow", description: "控制应用在菜单栏和登录后的运行方式。") {
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

                Text("服务连接")
                    .font(.title2.weight(.bold))
                    .padding(.top, 8)
                SettingsCard(
                    title: "DeepSeek",
                    symbol: "sparkles",
                    description: "配置聊天与智能摘要使用的服务地址和 API Key。"
                ) {
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
                    Button("保存 DeepSeek 配置") {
                        state.saveDeepSeekConfiguration(apiKey: deepSeekAPIKey, baseURL: deepSeekBaseURL)
                        deepSeekAPIKey = ""
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(deepSeekAPIKey.isEmpty && settings.deepSeekAPIKey?.isEmpty != false)
                }
                Text("密钥仅存储在 macOS 钥匙串中，不会写入偏好设置或发送给本地 API。")
                    .font(.caption).foregroundStyle(.secondary)
                }
                SettingsCard(
                    title: "QWeather",
                    symbol: "cloud.sun.fill",
                    description: "实时天气使用 API Key；天气预警使用同一项目下的 JWT 凭据。"
                ) {
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
                Text("复用 Windows 已验证的项目 ID、JWT 凭据 ID 和 Ed25519 私钥。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
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
                        ConfigurationStatus("正在验证预警…", symbol: "arrow.triangle.2.circlepath", color: .secondary)
                    } else if let error = state.weatherError {
                        ConfigurationStatus(error, symbol: "exclamationmark.triangle.fill", color: .red)
                    } else if let error = state.weatherAlertError {
                        ConfigurationStatus(error, symbol: "exclamationmark.triangle.fill", color: .red)
                    } else if state.isWeatherAlertConnected {
                        ConfigurationStatus("预警接口验证成功", symbol: "checkmark.circle.fill", color: .green)
                    } else {
                        ConfigurationStatus(
                            settings.hasWeatherAlertCredentials ? "预警已保存，待验证" : "预警未配置",
                            symbol: settings.hasWeatherAlertCredentials ? "checkmark.circle" : "circle",
                            color: .secondary
                        )
                    }
                } actions: {
                    Button {
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
                    }
                    label: {
                        if state.isTestingWeatherAlertConnection {
                            HStack(spacing: 6) {
                                ProgressView().controlSize(.small)
                                Text("正在验证预警")
                            }
                        } else {
                            Text("保存并验证预警")
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(state.isTestingWeatherAlertConnection)
                }
                Text("私钥保存后会清空，属于正常安全行为。请粘贴完整 PEM，并保留 BEGIN/END 行和换行。")
                    .font(.caption).foregroundStyle(.secondary)
                }
                SettingsCard(
                    title: "QQ 邮箱",
                    symbol: "envelope.fill",
                    description: "使用 QQ 邮箱的 IMAP/SMTP 授权码获取邮件。"
                ) {
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
                        ConfigurationStatus("正在验证 IMAP…", symbol: "arrow.triangle.2.circlepath", color: .secondary)
                    } else if let error = state.mailConnectionError {
                        ConfigurationStatus(error, symbol: "exclamationmark.triangle.fill", color: .red)
                    } else if state.isMailConnected {
                        ConfigurationStatus("IMAP 连接成功", symbol: "checkmark.circle.fill", color: .green)
                    } else {
                        ConfigurationStatus(
                            settings.qqMailAuthCode?.isEmpty == false ? "已保存授权码，尚未验证" : "未配置",
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
                                Text("正在测试连接")
                            }
                        } else {
                            Text(hasMailDraft ? "保存并测试连接" : "测试连接")
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
                Button("刷新所有状态", systemImage: "arrow.clockwise") { state.refresh(force: true) }
                    .buttonStyle(.bordered)
            }
        }
        .frame(width: 560)
        .padding(24)
        .onAppear {
            deepSeekAPIKey = ""
            deepSeekBaseURL = settings.deepSeekBaseURL
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
    let description: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label(title, systemImage: symbol)
                .font(.headline)
            Text(description)
                .font(.caption)
                .foregroundStyle(.secondary)
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
