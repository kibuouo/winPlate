import AppKit
import SwiftUI

struct WeatherWorkspace: View {
    @EnvironmentObject private var state: AppState

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                PageHeader(
                    title: "天气与服务状态",
                    subtitle: "实时天气、未来预报与 API 配额使用情况。"
                ) {
                    NativeRefreshButton(
                        title: "刷新天气",
                        isRefreshing: state.isRefreshing
                    ) {
                        state.refresh(force: true)
                    }
                }

                if let error = state.weatherError, !error.isEmpty {
                    WeatherErrorBanner(message: error)
                }

                WeatherDashboard(
                    weather: state.snapshot.weather,
                    alerts: state.weatherAlerts,
                    alertError: state.weatherAlertError,
                    updatedAt: state.weatherUpdatedAt
                )
            }
            .padding(28)
        }
        .background(Color(nsColor: .controlBackgroundColor).opacity(0.28))
    }
}

private struct WeatherDashboard: View {
    @EnvironmentObject private var state: AppState
    let weather: WeatherSnapshot
    let alerts: WeatherAlertSummary
    let alertError: String?
    let updatedAt: Date?

    @State private var isLocationPickerPresented = false

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            currentPanel
                .frame(maxWidth: .infinity, alignment: .topLeading)
            Divider()
                .padding(.vertical, 24)
            WeatherForecastPanel(forecast: weather.forecast)
                .frame(width: 248)
        }
        .background {
            WeatherSceneView(weather: weather)
        }
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .strokeBorder(.primary.opacity(0.09))
        }
        .shadow(color: .black.opacity(0.06), radius: 18, y: 8)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("天气详情，\(weather.location)，\(weather.condition)")
    }

    private var currentPanel: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top, spacing: 16) {
                Button {
                    isLocationPickerPresented.toggle()
                } label: {
                    HStack(spacing: 7) {
                        Image(systemName: "location.north.fill")
                            .font(.system(size: 11, weight: .semibold))
                        Text(weather.location.isEmpty ? "选择城市" : weather.location)
                            .lineLimit(1)
                        Image(systemName: "chevron.down")
                            .font(.system(size: 8, weight: .bold))
                    }
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.tint)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help("搜索并切换天气城市")
                .popover(isPresented: $isLocationPickerPresented, arrowEdge: .bottom) {
                    WeatherLocationPicker(
                        onSelect: { location in
                            state.selectWeatherLocation(location)
                            isLocationPickerPresented = false
                        }
                    )
                    .environmentObject(state)
                }

                Spacer(minLength: 10)

                VStack(alignment: .trailing, spacing: 3) {
                    Text(weather.isAvailable ? "QWeather 实时数据" : "等待天气数据")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(.secondary)
                    Text(updatedAt.map { "更新于 \($0.formatted(date: .omitted, time: .shortened))" } ?? "尚无成功更新")
                        .font(.system(size: 9))
                        .foregroundStyle(.tertiary)
                }
            }

            HStack(alignment: .center, spacing: 15) {
                WeatherIconView(code: weather.icon, fallbackCondition: weather.condition)
                    .frame(width: 68, height: 68)

                Text(weather.temperature.map { "\(Int($0.rounded()))°" } ?? "--°")
                    .font(.system(size: 56, weight: .bold, design: .rounded).monospacedDigit())
                    .tracking(-3)

                VStack(alignment: .leading, spacing: 6) {
                    Text(weather.condition)
                        .font(.system(size: 18, weight: .bold))
                    Text(weather.weatherSummary.isEmpty ? summaryFallback : weather.weatherSummary)
                        .font(.system(size: 12))
                        .foregroundStyle(.secondary)
                        .lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            WeatherLiveInsights(weather: weather)
            WeatherAlertsPanel(alerts: alerts, error: alertError)
            WeatherMetricGrid(weather: weather)
        }
        .padding(24)
    }

    private var summaryFallback: String {
        weather.isAvailable ? "天气数据已更新，更多实况信息将在这里显示。" : "请配置 QWeather 并选择城市。"
    }
}

private struct WeatherSceneView: View {
    @Environment(\.colorScheme) private var colorScheme
    let weather: WeatherSnapshot

    var body: some View {
        ZStack {
            Color(nsColor: .windowBackgroundColor)
            if let image = WeatherAssets.sceneImage(for: weather) {
                Image(nsImage: image)
                    .resizable()
                    .interpolation(.high)
                    .scaledToFill()
                    .opacity(colorScheme == .dark ? 0.34 : 0.38)
            }
            Rectangle()
                .fill(.ultraThinMaterial)
                .opacity(colorScheme == .dark ? 0.58 : 0.48)
            WeatherAssets.sceneTint(for: weather)
                .opacity(colorScheme == .dark ? 0.12 : 0.08)
        }
        .clipped()
        .accessibilityHidden(true)
    }
}

private struct WeatherLiveInsights: View {
    let weather: WeatherSnapshot

    var body: some View {
        HStack(spacing: 10) {
            WeatherInsightCard(
                title: "临近降水",
                value: weather.minutelySummary.isEmpty ? "暂无临近降水数据" : weather.minutelySummary
            )
            WeatherInsightCard(
                title: "空气质量",
                value: weather.airQuality?.summary ?? "--"
            )
        }
    }
}

private struct WeatherInsightCard: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(title)
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.system(size: 12, weight: .semibold))
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(.primary.opacity(0.07))
        }
    }
}

private struct WeatherAlertsPanel: View {
    let alerts: WeatherAlertSummary
    let error: String?

    private var visibleAlerts: [WeatherAlert] {
        alerts.alerts
            .sorted { priority($0) > priority($1) }
            .prefix(2)
            .map { $0 }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 11) {
            HStack {
                Text("天气预警")
                    .font(.system(size: 13, weight: .bold))
                Spacer()
                Text(syncText)
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
            }

            if visibleAlerts.isEmpty {
                HStack(spacing: 8) {
                    Image(systemName: error == nil ? "checkmark.shield" : "exclamationmark.triangle")
                        .foregroundStyle(error == nil ? .green : .orange)
                    Text(error ?? "当前城市暂无生效天气预警")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, minHeight: 42, alignment: .leading)
            } else {
                VStack(spacing: 10) {
                    ForEach(visibleAlerts) { alert in
                        WeatherAlertCard(alert: alert)
                    }
                }
            }
        }
        .padding(16)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 15, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 15, style: .continuous)
                .strokeBorder(.primary.opacity(0.08))
        }
    }

    private var syncText: String {
        guard let timestamp = alerts.updatedAt else { return error == nil ? "等待同步" : "同步失败" }
        let date = Date(timeIntervalSince1970: TimeInterval(timestamp) / 1_000)
        let interval = max(0, Date().timeIntervalSince(date))
        if interval < 60 { return "刚刚同步" }
        if interval < 3_600 { return "\(Int(interval / 60)) 分钟前同步" }
        return date.formatted(date: .omitted, time: .shortened)
    }

    private func priority(_ alert: WeatherAlert) -> Int {
        if alert.lifecycle == "resolved" { return 0 }
        if alert.level == "critical" { return 3 }
        if alert.lifecycle == "upgraded" { return 2 }
        return 1
    }
}

private struct WeatherAlertCard: View {
    let alert: WeatherAlert

    private var tone: Color {
        if alert.lifecycle == "resolved" { return .green }
        return alert.level == "critical" ? .red : .orange
    }

    private var status: String {
        if alert.lifecycle == "resolved" { return "已解除" }
        if alert.lifecycle == "upgraded" { return "已升级" }
        return alert.level == "critical" ? "高风险" : "生效中"
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Text(status)
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(.white)
                .padding(.horizontal, 10)
                .frame(height: 26)
                .background(tone.opacity(0.78), in: Capsule())

            VStack(alignment: .leading, spacing: 5) {
                Text(alert.title)
                    .font(.system(size: 12, weight: .bold))
                    .lineLimit(2)
                Text(alert.message.isEmpty ? "请留意最新天气变化。" : alert.message)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .lineLimit(4)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(tone.opacity(0.075), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(tone.opacity(0.2))
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(status)，\(alert.title)，\(alert.message)")
    }
}

private struct WeatherMetricGrid: View {
    let weather: WeatherSnapshot

    private var wind: String {
        let text = [weather.windDirection, weather.windScale.isEmpty ? "" : "\(weather.windScale)级"]
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        return text.isEmpty ? "--" : text
    }

    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 8) {
            WeatherMetric(title: "体感", value: weather.feelsLike.map { "\(Int($0.rounded()))°" } ?? "--")
            WeatherMetric(title: "湿度", value: weather.humidity.map { "\($0)%" } ?? "--")
            WeatherMetric(title: "降雨", value: weather.precipitationProbability.map { "\($0)%" } ?? "--")
            WeatherMetric(title: "风力", value: wind)
        }
    }
}

private struct WeatherMetric: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title)
                .font(.system(size: 9))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.system(size: 12, weight: .semibold).monospacedDigit())
                .lineLimit(1)
                .minimumScaleFactor(0.75)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(11)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .strokeBorder(.primary.opacity(0.07))
        }
    }
}

private struct WeatherForecastPanel: View {
    let forecast: [WeatherForecast]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("未来天气")
                    .font(.system(size: 14, weight: .bold))
                Spacer()
                Text("5 天预报")
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
            }
            .padding(.bottom, 14)

            if forecast.isEmpty {
                ContentUnavailableView(
                    "暂无天气预报",
                    systemImage: "calendar.badge.clock",
                    description: Text("配置 QWeather 并选择城市后显示。")
                )
                .frame(maxWidth: .infinity, minHeight: 250)
            } else {
                ForEach(Array(forecast.prefix(5).enumerated()), id: \.element.id) { index, day in
                    WeatherForecastRow(day: day, label: dayLabel(for: day, index: index))
                    if index < min(forecast.count, 5) - 1 {
                        Divider()
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(24)
    }

    private func dayLabel(for day: WeatherForecast, index: Int) -> String {
        if index == 0 { return "今天" }
        if index == 1 { return "明天" }
        let parser = DateFormatter()
        parser.locale = Locale(identifier: "zh_CN")
        parser.dateFormat = "yyyy-MM-dd"
        guard let date = parser.date(from: day.date) else { return day.date }
        let output = DateFormatter()
        output.locale = Locale(identifier: "zh_CN")
        output.dateFormat = "EEE"
        return output.string(from: date)
    }
}

private struct WeatherForecastRow: View {
    let day: WeatherForecast
    let label: String

    var body: some View {
        HStack(spacing: 10) {
            Text(label)
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
                .frame(width: 34, alignment: .leading)

            WeatherIconView(code: day.icon, fallbackCondition: day.condition)
                .frame(width: 30, height: 30)

            Text(day.condition)
                .font(.system(size: 12, weight: .semibold))
                .lineLimit(1)

            Spacer(minLength: 6)

            HStack(spacing: 4) {
                Text(day.tempMax.map { "\($0)°" } ?? "--°")
                    .foregroundStyle(.primary)
                Text(day.tempMin.map { "\($0)°" } ?? "--°")
                    .foregroundStyle(.secondary)
            }
            .font(.system(size: 12, weight: .semibold).monospacedDigit())
        }
        .frame(minHeight: 58)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(label)，\(day.condition)，最高 \(day.tempMax.map(String.init) ?? "未知") 度，最低 \(day.tempMin.map(String.init) ?? "未知") 度")
    }
}

private struct WeatherLocationPicker: View {
    @EnvironmentObject private var state: AppState
    @State private var query = ""
    let onSelect: (WeatherLocation) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("切换天气城市")
                .font(.headline)

            HStack(spacing: 8) {
                TextField("城市，例如：武汉", text: $query)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit(search)
                Button("搜索", action: search)
                    .disabled(trimmedQuery.isEmpty)
            }

            Divider()

            if state.weatherLocations.isEmpty {
                ContentUnavailableView(
                    "搜索城市",
                    systemImage: "magnifyingglass",
                    description: Text("输入城市名后从结果中选择。")
                )
                .frame(maxWidth: .infinity, minHeight: 150)
            } else {
                ScrollView {
                    LazyVStack(spacing: 4) {
                        ForEach(state.weatherLocations) { location in
                            Button {
                                onSelect(location)
                            } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(location.displayName)
                                            .foregroundStyle(.primary)
                                        Text(location.id)
                                            .font(.caption2)
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Image(systemName: "chevron.right")
                                        .font(.caption)
                                        .foregroundStyle(.tertiary)
                                }
                                .padding(8)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .frame(maxHeight: 220)
            }
        }
        .padding(16)
        .frame(width: 360)
    }

    private var trimmedQuery: String {
        query.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func search() {
        guard !trimmedQuery.isEmpty else { return }
        state.searchWeatherLocations(trimmedQuery)
    }
}

private struct WeatherErrorBanner: View {
    let message: String

    var body: some View {
        Label(message, systemImage: "exclamationmark.triangle.fill")
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(.orange)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(.orange.opacity(0.09), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

private struct WeatherIconView: View {
    let code: String?
    let fallbackCondition: String

    var body: some View {
        Group {
            if let image = WeatherAssets.icon(for: code) {
                Image(nsImage: image)
                    .resizable()
                    .renderingMode(.template)
                    .interpolation(.high)
                    .scaledToFit()
                    .foregroundStyle(.primary)
            } else {
                Image(systemName: WeatherAssets.systemSymbol(for: fallbackCondition))
                    .resizable()
                    .scaledToFit()
                    .symbolRenderingMode(.monochrome)
                    .foregroundStyle(.primary)
                    .padding(5)
            }
        }
        .accessibilityHidden(true)
    }
}

enum WeatherScene: String {
    case clearDay = "clear-day"
    case clearNight = "clear-night"
    case cloudDay = "cloud-day"
    case cloudNight = "cloud-night"
    case overcast, rain, storm, sleet, snow, mist, haze, sand, hot, cold, unknown
}

enum WeatherAssets {
    static func icon(for code: String?) -> NSImage? {
        let filename = MenuBarWeatherIcon.filename(for: code)
        guard let url = Bundle.main.url(
            forResource: filename,
            withExtension: "svg",
            subdirectory: "QWeatherIcons"
        ) else {
            return nil
        }
        return NSImage(contentsOf: url)
    }

    static func sceneImage(for weather: WeatherSnapshot) -> NSImage? {
        let filename: String
        switch scene(for: weather) {
        case .clearDay, .cloudDay, .hot:
            filename = "clear-day"
        case .clearNight, .cloudNight:
            filename = "clear-night"
        case .overcast, .rain, .storm, .sleet, .sand:
            filename = "storm"
        case .snow, .mist, .haze, .cold:
            filename = "snow-mist"
        case .unknown:
            return nil
        }
        guard let url = Bundle.main.url(
            forResource: filename,
            withExtension: "webp",
            subdirectory: "WeatherScenes"
        ) else {
            return nil
        }
        return NSImage(contentsOf: url)
    }

    static func sceneTint(for weather: WeatherSnapshot) -> Color {
        switch scene(for: weather) {
        case .clearDay, .cloudDay: return .cyan
        case .clearNight, .cloudNight: return .indigo
        case .rain, .sleet: return .blue
        case .storm, .overcast: return .gray
        case .snow, .mist, .cold: return .white
        case .haze, .sand, .hot: return .orange
        case .unknown: return .clear
        }
    }

    static func scene(for weather: WeatherSnapshot) -> WeatherScene {
        if ["unconfigured", "unavailable"].contains(weather.source) { return .unknown }
        switch weather.icon ?? "" {
        case "100": return .clearDay
        case "150": return .clearNight
        case "101", "102", "103": return .cloudDay
        case "151", "152", "153": return .cloudNight
        case "104": return .overcast
        case "300", "301", "305", "306", "307", "308", "309", "310", "311", "312",
             "314", "315", "316", "317", "318", "350", "351", "399":
            return .rain
        case "302", "303", "304": return .storm
        case "313", "404", "405", "406": return .sleet
        case "400", "401", "402", "403", "407", "408", "409", "410", "456", "457", "499":
            return .snow
        case "500", "501", "509", "510", "514", "515": return .mist
        case "502", "511", "512", "513": return .haze
        case "503", "504", "507", "508": return .sand
        case "900": return .hot
        case "901": return .cold
        default: return scene(from: weather.condition)
        }
    }

    static func systemSymbol(for condition: String) -> String {
        switch scene(from: condition) {
        case .clearDay: return "sun.max"
        case .clearNight: return "moon.stars"
        case .rain: return "cloud.rain"
        case .storm: return "cloud.bolt.rain"
        case .sleet: return "cloud.sleet"
        case .snow: return "cloud.snow"
        case .mist, .haze, .sand: return "cloud.fog"
        case .hot: return "thermometer.sun"
        case .cold: return "thermometer.snowflake"
        default: return "cloud"
        }
    }

    private static func scene(from condition: String) -> WeatherScene {
        if condition.contains("雷") || condition.contains("电") || condition.contains("冰雹") { return .storm }
        if condition.contains("雨夹雪") || condition.contains("冻雨") || condition.contains("雨雪") { return .sleet }
        if condition.contains("雪") { return .snow }
        if condition.contains("雨") { return .rain }
        if condition.contains("沙") || condition.contains("尘") { return .sand }
        if condition.contains("霾") { return .haze }
        if condition.contains("雾") { return .mist }
        if condition.contains("高温") || condition.contains("炎热") || condition.contains("热") { return .hot }
        if condition.contains("低温") || condition.contains("严寒") || condition.contains("寒冷") || condition.contains("冷") { return .cold }
        if condition.contains("阴") { return .overcast }
        if condition.contains("云") { return .cloudDay }
        if condition.contains("晴") { return .clearDay }
        return .unknown
    }
}
