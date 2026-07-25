import Foundation

enum MenuBarTemperatureFormatter {
    static func title(for temperature: Double?) -> String {
        guard let temperature, temperature.isFinite else { return "--°" }
        let rounded = Int(temperature.rounded())
        return "\(min(99, max(-99, rounded)))°C"
    }
}

enum MenuBarWeatherIcon {
    static func filename(for icon: String?) -> String {
        guard
            let icon,
            icon.range(of: #"^\d{3,4}$"#, options: .regularExpression) != nil
        else {
            return "999"
        }
        return icon
    }
}

struct ResultValue<Value> {
    let value: Value?
    let error: String?
}

struct StatusSnapshot: Decodable {
    let weather: WeatherSnapshot
    let github: GitHubSnapshot?

    static let empty = StatusSnapshot(weather: .empty, github: nil)

    init(weather: WeatherSnapshot, github: GitHubSnapshot?) { self.weather = weather; self.github = github }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        weather = try container.decodeIfPresent(WeatherSnapshot.self, forKey: .weather) ?? .empty
        github = try container.decodeIfPresent(GitHubSnapshot.self, forKey: .github)
    }

    private enum CodingKeys: String, CodingKey { case weather, github }
}

struct WeatherSnapshot: Decodable {
    let source: String
    let temperature: Double?
    let feelsLike: Double?
    let condition: String
    let location: String
    let icon: String?
    let humidity: Int?
    let precipitation: Double?
    let precipitationProbability: Int?
    let visibility: Double?
    let cloudCover: Int?
    let windSpeed: Double?
    let windDegrees: Int?
    let windDirection: String
    let windScale: String
    let weatherSummary: String
    let minutelySummary: String
    let airQuality: WeatherAirQuality?
    let forecast: [WeatherForecast]
    let error: String?

    static let empty = WeatherSnapshot(
        source: "unavailable",
        temperature: nil,
        condition: "不可用",
        location: "--",
        icon: nil
    )
    var isAvailable: Bool { source == "qweather" && temperature?.isFinite == true }

    init(
        source: String,
        temperature: Double?,
        condition: String,
        location: String,
        icon: String?,
        feelsLike: Double? = nil,
        humidity: Int? = nil,
        precipitation: Double? = nil,
        precipitationProbability: Int? = nil,
        visibility: Double? = nil,
        cloudCover: Int? = nil,
        windSpeed: Double? = nil,
        windDegrees: Int? = nil,
        windDirection: String = "",
        windScale: String = "",
        weatherSummary: String = "",
        minutelySummary: String = "",
        airQuality: WeatherAirQuality? = nil,
        forecast: [WeatherForecast] = [],
        error: String? = nil
    ) {
        self.source = source
        self.temperature = temperature
        self.feelsLike = feelsLike
        self.condition = condition
        self.location = location
        self.icon = icon
        self.humidity = humidity
        self.precipitation = precipitation
        self.precipitationProbability = precipitationProbability
        self.visibility = visibility
        self.cloudCover = cloudCover
        self.windSpeed = windSpeed
        self.windDegrees = windDegrees
        self.windDirection = windDirection
        self.windScale = windScale
        self.weatherSummary = weatherSummary
        self.minutelySummary = minutelySummary
        self.airQuality = airQuality
        self.forecast = forecast
        self.error = error
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        source = try container.decodeIfPresent(String.self, forKey: .source) ?? "unavailable"
        condition = try container.decodeIfPresent(String.self, forKey: .condition) ?? "不可用"
        location = try container.decodeIfPresent(String.self, forKey: .location) ?? "--"
        icon = try container.decodeIfPresent(String.self, forKey: .icon)
        forecast = try container.decodeIfPresent([WeatherForecast].self, forKey: .forecast) ?? []
        error = try container.decodeIfPresent(String.self, forKey: .error)
        temperature = Self.decodeDouble(container, forKey: .temperature)
        feelsLike = Self.decodeDouble(container, forKey: .feelsLike)
        humidity = Self.decodeInt(container, forKey: .humidity)
        precipitation = Self.decodeDouble(container, forKey: .precipitation)
        precipitationProbability = Self.decodeInt(container, forKey: .precipitationProbability)
        visibility = Self.decodeDouble(container, forKey: .visibility)
        cloudCover = Self.decodeInt(container, forKey: .cloudCover)
        windSpeed = Self.decodeDouble(container, forKey: .windSpeed)
        windDegrees = Self.decodeInt(container, forKey: .windDegrees)
        windDirection = try container.decodeIfPresent(String.self, forKey: .windDirection) ?? ""
        windScale = try container.decodeIfPresent(String.self, forKey: .windScale) ?? ""
        weatherSummary = try container.decodeIfPresent(String.self, forKey: .weatherSummary) ?? ""
        minutelySummary = try container.decodeIfPresent(String.self, forKey: .minutelySummary) ?? ""
        airQuality = try container.decodeIfPresent(WeatherAirQuality.self, forKey: .airQuality)
    }

    private static func decodeDouble(
        _ container: KeyedDecodingContainer<CodingKeys>,
        forKey key: CodingKeys
    ) -> Double? {
        if let number = try? container.decode(Double.self, forKey: key) { return number }
        if let text = try? container.decode(String.self, forKey: key) { return Double(text) }
        return nil
    }

    private static func decodeInt(
        _ container: KeyedDecodingContainer<CodingKeys>,
        forKey key: CodingKeys
    ) -> Int? {
        if let number = try? container.decode(Int.self, forKey: key) { return number }
        if let number = try? container.decode(Double.self, forKey: key) { return Int(number.rounded()) }
        if let text = try? container.decode(String.self, forKey: key), let number = Double(text) {
            return Int(number.rounded())
        }
        return nil
    }

    private enum CodingKeys: String, CodingKey {
        case source, temperature, feelsLike, condition, location, icon
        case humidity, precipitation, precipitationProbability, visibility
        case cloudCover, windSpeed, windDegrees, windDirection, windScale
        case weatherSummary, minutelySummary, airQuality, forecast, error
    }
}

struct WeatherAirQuality: Decodable {
    let aqi: Double?
    let display: String
    let category: String

    var summary: String {
        let value = display.isEmpty ? aqi.map { String(Int($0.rounded())) } ?? "--" : display
        return category.isEmpty ? value : "\(value) · \(category)"
    }

    init(aqi: Double?, display: String, category: String) {
        self.aqi = aqi
        self.display = display
        self.category = category
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if let number = try? container.decode(Double.self, forKey: .aqi) {
            aqi = number
        } else if let text = try? container.decode(String.self, forKey: .aqi) {
            aqi = Double(text)
        } else {
            aqi = nil
        }
        display = try container.decodeIfPresent(String.self, forKey: .display) ?? ""
        category = try container.decodeIfPresent(String.self, forKey: .category) ?? ""
    }

    private enum CodingKeys: String, CodingKey { case aqi, display, category }
}

struct WeatherForecast: Decodable, Identifiable {
    let date: String
    let icon: String?
    let condition: String
    let tempMax: Int?
    let tempMin: Int?

    var id: String { date }
    var temperatureText: String {
        switch (tempMin, tempMax) {
        case let (minimum?, maximum?): return "\(minimum)–\(maximum)°"
        case let (minimum?, nil): return "\(minimum)°"
        case let (nil, maximum?): return "\(maximum)°"
        default: return "--°"
        }
    }

    enum CodingKeys: String, CodingKey {
        case date, icon, condition, tempMax, tempMin
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        date = try container.decodeIfPresent(String.self, forKey: .date) ?? ""
        icon = try container.decodeIfPresent(String.self, forKey: .icon)
        condition = try container.decodeIfPresent(String.self, forKey: .condition) ?? "未知"
        tempMax = try container.decodeIfPresent(Int.self, forKey: .tempMax)
        tempMin = try container.decodeIfPresent(Int.self, forKey: .tempMin)
    }
}

struct WeatherAlertSummary: Decodable {
    let source: String
    let alerts: [WeatherAlert]
    let updatedAt: Int64?
    let error: String?

    static let empty = WeatherAlertSummary(source: "unavailable", alerts: [], updatedAt: nil, error: nil)

    init(source: String, alerts: [WeatherAlert], updatedAt: Int64?, error: String?) {
        self.source = source
        self.alerts = alerts
        self.updatedAt = updatedAt
        self.error = error
    }
}

struct WeatherAlert: Decodable, Identifiable {
    let id: String
    let title: String
    let message: String
    let level: String
    let lifecycle: String
    let createdAt: Int64?

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        title = try container.decodeIfPresent(String.self, forKey: .title) ?? "天气预警"
        message = try container.decodeIfPresent(String.self, forKey: .message) ?? ""
        level = try container.decodeIfPresent(String.self, forKey: .level) ?? "warning"
        lifecycle = try container.decodeIfPresent(String.self, forKey: .lifecycle) ?? "active"
        createdAt = try container.decodeIfPresent(Int64.self, forKey: .createdAt)
    }

    private enum CodingKeys: String, CodingKey { case id, title, message, level, lifecycle, createdAt }
}

struct UsageWindow: Decodable {
    let remainingPct: Double?
    let resetText: String?
}

struct UsageSnapshot: Decodable {
    let source: String
    let status: String
    let remainingPct: Double?
    let resetText: String?
    let windows: UsageWindows?
    let balances: [Balance]

    static let unconfigured = UsageSnapshot(source: "deepseek-api", status: "Unconfigured", remainingPct: nil, resetText: nil, windows: nil, balances: [])
    static func unavailable(source: String) -> UsageSnapshot {
        UsageSnapshot(source: source, status: "Unavailable", remainingPct: nil, resetText: nil, windows: nil, balances: [])
    }

    var isAvailable: Bool { status == "Normal" }
    var fiveHour: UsageWindow? { windows?.fiveHour ?? UsageWindow(remainingPct: remainingPct, resetText: resetText) }
    var cnyBalance: String? { balances.first(where: { $0.currency.uppercased() == "CNY" })?.totalBalance }

    func preservingValues(status: String) -> UsageSnapshot {
        UsageSnapshot(
            source: source,
            status: status,
            remainingPct: remainingPct,
            resetText: resetText,
            windows: windows,
            balances: balances
        )
    }
}

struct UsageWindows: Decodable { let fiveHour: UsageWindow?; let sevenDay: UsageWindow? }
struct Balance: Decodable { let currency: String; let totalBalance: String }

struct GitHubSnapshot: Decodable {
    let name: String
    let username: String
    let profileUrl: String
    let repos: Int
    let followers: Int
    let project: String
    let language: String
    let stars: Int
    let status: String
    let stateMessage: String?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? "GitHub"
        username = try c.decodeIfPresent(String.self, forKey: .username) ?? ""
        profileUrl = try c.decodeIfPresent(String.self, forKey: .profileUrl) ?? ""
        repos = try c.decodeIfPresent(Int.self, forKey: .repos) ?? 0
        followers = try c.decodeIfPresent(Int.self, forKey: .followers) ?? 0
        project = try c.decodeIfPresent(String.self, forKey: .project) ?? "--"
        language = try c.decodeIfPresent(String.self, forKey: .language) ?? "--"
        stars = try c.decodeIfPresent(Int.self, forKey: .stars) ?? 0
        status = try c.decodeIfPresent(String.self, forKey: .status) ?? "Unavailable"
        stateMessage = try c.decodeIfPresent(String.self, forKey: .stateMessage)
    }
    private enum CodingKeys: String, CodingKey { case name, username, profileUrl, repos, followers, project, language, stars, status, stateMessage }
}

struct MailOutline: Decodable {
    let availability: String
    let items: [MailItem]
    let unreadCount: Int?
    let error: String?

    static let empty = MailOutline(availability: "unavailable", items: [], unreadCount: 0, error: nil)

    static func unavailable(error: String?, keeping items: [MailItem] = []) -> MailOutline {
        MailOutline(
            availability: "unavailable",
            items: items,
            unreadCount: nil,
            error: error ?? "本地邮件服务暂时不可用"
        )
    }
}

struct MailConnection: Decodable {
    let connected: Bool

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        connected = try container.decodeIfPresent(Bool.self, forKey: .connected) ?? false
    }

    private enum CodingKeys: String, CodingKey { case connected }
}
struct MailItem: Decodable, Identifiable {
    let uid: String
    let sender: String
    let subject: String
    let sentAt: Int64
    let snippet: String
    let unread: Bool
    var id: String { uid }
}
struct MailMessage: Decodable {
    let uid: String
    let sender: String
    let subject: String
    let textBody: String
    let unread: Bool
    enum CodingKeys: String, CodingKey { case uid, sender, subject, textBody, unread }
}

struct NotificationSummary: Decodable {
    let items: [AppNotification]
    let unreadCount: Int
    let latest: AppNotification?
    let updatedAt: Int64?

    static let empty = NotificationSummary(items: [], unreadCount: 0, latest: nil, updatedAt: nil)

    init(items: [AppNotification], unreadCount: Int, latest: AppNotification? = nil, updatedAt: Int64? = nil) {
        self.items = items
        self.unreadCount = unreadCount
        self.latest = latest
        self.updatedAt = updatedAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        items = try container.decodeIfPresent([AppNotification].self, forKey: .items) ?? []
        unreadCount = try container.decodeIfPresent(Int.self, forKey: .unreadCount) ?? items.filter(\.unread).count
        latest = try container.decodeIfPresent(AppNotification.self, forKey: .latest)
        updatedAt = try container.decodeIfPresent(Int64.self, forKey: .updatedAt)
    }

    private enum CodingKeys: String, CodingKey { case items, unreadCount, latest, updatedAt }
}
struct AppNotification: Decodable, Identifiable {
    let id: String
    let source: String
    let level: String
    let title: String
    let message: String
    let unread: Bool
    let createdAt: Int64
}

struct WeatherLocationSearch: Decodable { let locations: [WeatherLocation] }
struct WeatherLocation: Decodable, Identifiable {
    let id: String
    let name: String
    let adm1: String
    let displayName: String
    let lat: String?
    let lon: String?
}
