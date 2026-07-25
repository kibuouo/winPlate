import Combine
import Foundation

@MainActor
final class AppState: ObservableObject {
    @Published private(set) var snapshot = StatusSnapshot.empty
    @Published private(set) var codex = UsageSnapshot.unavailable(source: "codex-app-server")
    @Published private(set) var deepSeek = UsageSnapshot.unconfigured
    @Published private(set) var mail = MailOutline.empty
    @Published private(set) var notifications = NotificationSummary.empty
    @Published private(set) var selectedMail: MailMessage?
    @Published private(set) var weatherLocations = [WeatherLocation]()
    @Published private(set) var weatherAlerts = WeatherAlertSummary.empty
    @Published private(set) var weatherError: String?
    @Published private(set) var weatherAlertError: String?
    @Published private(set) var isTestingWeatherAlertConnection = false
    @Published private(set) var isWeatherAlertConnected = false
    @Published private(set) var mailConnectionError: String?
    @Published private(set) var isMailConnected = false
    @Published private(set) var isTestingMailConnection = false
    @Published private(set) var codexError: String?
    @Published private(set) var deepSeekError: String?
    @Published private(set) var isRefreshing = false
    @Published private(set) var lastError: String?
    @Published private(set) var codexUpdatedAt: Date?
    @Published private(set) var deepSeekUpdatedAt: Date?
    @Published private(set) var weatherUpdatedAt: Date?
    @Published var menuBarEnabled: Bool

    let settings = AppSettingsStore()
    private let api = LocalAPIClient()
    private let codexClient = CodexUsageClient()
    private let deepSeekClient = DeepSeekUsageClient()
    private let backend = LocalBackendSupervisor()
    private var refreshTask: Task<Void, Never>?
    private var weatherAlertsUpdatedAt: Date?
    private var hasStarted = false

    init() {
        menuBarEnabled = settings.menuBarEnabled
    }

    func start() {
        guard !hasStarted else { return }
        hasStarted = true
        backend.startIfAvailable(
            weatherAPIKey: settings.weatherAPIKey,
            weatherAPIHost: settings.weatherAPIHost,
            overrideWeatherAPIKey: settings.weatherAPIKey != nil,
            weatherProjectID: settings.weatherProjectID,
            weatherCredentialID: settings.weatherCredentialID,
            weatherPrivateKey: settings.weatherPrivateKey,
            overrideWeatherAlertCredentials: settings.hasWeatherAlertCredentials,
            qqMailAddress: settings.qqMailAddress,
            qqMailAuthCode: settings.qqMailAuthCode,
            overrideQQMailConfiguration: settings.qqMailAuthCode != nil
        )
        refresh()
        refreshMailWhenLocalAPIReady()
        refreshTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(30))
                self?.refresh()
            }
        }
    }

    func loadSensitiveSettings() {
        settings.loadSensitiveValues()
    }

    func stop() {
        refreshTask?.cancel()
        refreshTask = nil
        backend.stop()
    }

    deinit {
        refreshTask?.cancel()
        backend.stop()
    }

    var menuBarTemperature: String {
        MenuBarTemperatureFormatter.title(
            for: snapshot.weather.isAvailable ? snapshot.weather.temperature : nil
        )
    }

    func setMenuBarEnabled(_ enabled: Bool) {
        menuBarEnabled = enabled
        settings.menuBarEnabled = enabled
    }

    func saveWeatherConfiguration(
        apiKey value: String,
        apiHost: String,
        projectID projectIDValue: String,
        credentialID credentialIDValue: String,
        privateKey privateKeyValue: String
    ) {
        let key = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let host = apiHost.trimmingCharacters(in: .whitespacesAndNewlines)
        let projectID = projectIDValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let credentialID = credentialIDValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let privateKey = privateKeyValue.trimmingCharacters(in: .whitespacesAndNewlines)
        // Existing Keychain values are intentionally not shown in the form.
        // Treat an empty field as "keep", otherwise saving JWT fields would
        // silently remove the API key used for current-weather requests.
        if !key.isEmpty { settings.weatherAPIKey = key }
        settings.weatherAPIHost = host.isEmpty ? "devapi.qweather.com" : host
        // The form intentionally does not reveal existing Keychain values.
        // Empty fields therefore mean "keep the stored value", not "erase it".
        if !projectID.isEmpty { settings.weatherProjectID = projectID }
        if !credentialID.isEmpty { settings.weatherCredentialID = credentialID }
        if !privateKey.isEmpty { settings.weatherPrivateKey = privateKey }
        weatherAlertError = nil
        isWeatherAlertConnected = false
        backend.restart(
            weatherAPIKey: settings.weatherAPIKey,
            weatherAPIHost: settings.weatherAPIHost,
            weatherProjectID: settings.weatherProjectID,
            weatherCredentialID: settings.weatherCredentialID,
            weatherPrivateKey: settings.weatherPrivateKey,
            overrideWeatherAlertCredentials: settings.hasWeatherAlertCredentials,
            qqMailAddress: settings.qqMailAddress,
            qqMailAuthCode: settings.qqMailAuthCode,
            overrideQQMailConfiguration: settings.qqMailAuthCode != nil
        )
        refreshWhenLocalAPIReady()
        if settings.hasWeatherAlertCredentials {
            testWeatherAlertConnectionWhenLocalAPIReady()
        }
    }

    func testSavedWeatherAlertConnection() {
        guard settings.hasWeatherAlertCredentials else {
            weatherAlertError = "请先保存项目 ID、凭据 ID 和 Ed25519 私钥 PEM"
            isWeatherAlertConnected = false
            return
        }
        testWeatherAlertConnectionWhenLocalAPIReady()
    }

    func saveDeepSeekConfiguration(apiKey value: String, baseURL: String) {
        let enteredKey = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let serviceURL = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        if !enteredKey.isEmpty, enteredKey != settings.deepSeekAPIKey {
            settings.deepSeekAPIKey = enteredKey
        }
        settings.deepSeekBaseURL = serviceURL.isEmpty ? "https://api.deepseek.com" : serviceURL
        refresh(force: true)
    }

    func saveQQMailConfiguration(address addressValue: String, authCode authCodeValue: String) {
        let address = addressValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let authCode = authCodeValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard address.contains("@") else {
            mailConnectionError = "请输入有效的邮箱地址"
            return
        }
        guard !authCode.isEmpty else {
            mailConnectionError = "请输入 QQ 邮箱授权码"
            return
        }
        settings.qqMailAddress = address
        settings.qqMailAuthCode = authCode
        mailConnectionError = nil
        isMailConnected = false
        backend.restart(
            weatherAPIKey: settings.weatherAPIKey,
            weatherAPIHost: settings.weatherAPIHost,
            weatherProjectID: settings.weatherProjectID,
            weatherCredentialID: settings.weatherCredentialID,
            weatherPrivateKey: settings.weatherPrivateKey,
            overrideWeatherAlertCredentials: settings.hasWeatherAlertCredentials,
            qqMailAddress: settings.qqMailAddress,
            qqMailAuthCode: settings.qqMailAuthCode,
            overrideQQMailConfiguration: true
        )
        testQQMailConnectionWhenLocalAPIReady()
    }

    func testSavedQQMailConnection() {
        guard settings.qqMailAddress.isEmpty == false, settings.qqMailAuthCode?.isEmpty == false else {
            mailConnectionError = "请先保存 QQ 邮箱地址和授权码"
            isMailConnected = false
            return
        }
        testQQMailConnectionWhenLocalAPIReady()
    }

    func refresh(force: Bool = false) {
        guard !isRefreshing else { return }
        isRefreshing = true
        lastError = nil
        let deepSeekConfiguration = settings.deepSeekConfiguration

        Task {
            async let statusResult = api.status(force: force)
            async let codexResult = codexClient.read(force: force)
            async let deepSeekResult = deepSeekClient.read(configuration: deepSeekConfiguration, force: force)

            let (status, codexUsage, deepSeekUsage) = await (statusResult, codexResult, deepSeekResult)
            if let statusValue = status.value {
                snapshot = statusValue
                if statusValue.weather.isAvailable { weatherUpdatedAt = Date() }
                weatherError = statusValue.weather.error
            }
            let shouldRefreshAlerts = force || weatherAlertsUpdatedAt.map { Date().timeIntervalSince($0) > 300 } ?? true
            if snapshot.weather.isAvailable && shouldRefreshAlerts {
                _ = await refreshWeatherAlerts()
            } else if !snapshot.weather.isAvailable {
                weatherAlerts = .empty
                weatherAlertError = nil
                weatherAlertsUpdatedAt = nil
            }
            if let codexValue = codexUsage.value {
                if codexValue.isAvailable {
                    codex = codexValue
                    codexUpdatedAt = Date()
                } else {
                    codex = codexValue.status == "Unconfigured"
                        ? codexValue
                        : codex.preservingValues(status: "Unavailable")
                }
            }
            codexError = codexUsage.error
            if let deepSeekValue = deepSeekUsage.value {
                if deepSeekValue.isAvailable {
                    deepSeek = deepSeekValue
                    deepSeekUpdatedAt = Date()
                } else {
                    deepSeek = deepSeekValue.status == "Unconfigured"
                        ? deepSeekValue
                        : deepSeek.preservingValues(status: "Unavailable")
                }
            }
            deepSeekError = deepSeekUsage.error
            lastError = status.error ?? weatherError ?? codexUsage.error ?? deepSeekUsage.error ?? weatherAlertError
            isRefreshing = false
        }
    }

    func refreshGitHub() {
        Task {
            let result = await api.refreshGitHub()
            if let github = result.value {
                snapshot = StatusSnapshot(weather: snapshot.weather, github: github)
            }
            lastError = result.error
        }
    }

    func loadMail(force: Bool = false) {
        Task {
            let result = await api.mail(force: force)
            mail = result.value ?? .unavailable(error: result.error, keeping: mail.items)
            mailConnectionError = result.value?.error ?? result.error
            if force { isMailConnected = result.value?.availability == "live" }
            lastError = mailConnectionError
        }
    }

    private func refreshMailWhenLocalAPIReady() {
        guard settings.qqMailAddress.isEmpty == false, settings.qqMailAuthCode?.isEmpty == false else {
            mail = .unavailable(error: "请先配置 QQ 邮箱地址和授权码")
            mailConnectionError = "请先配置 QQ 邮箱地址和授权码"
            isMailConnected = false
            return
        }
        testQQMailConnectionWhenLocalAPIReady()
    }

    private func refreshWhenLocalAPIReady() {
        Task { [weak self] in
            guard let self else { return }
            for attempt in 0..<8 {
                guard !Task.isCancelled else { return }
                if attempt > 0 {
                    try? await Task.sleep(for: .milliseconds(500))
                }
                let result = await self.api.status(force: true)
                if let status = result.value {
                    self.snapshot = status
                    if status.weather.isAvailable { self.weatherUpdatedAt = Date() }
                    self.weatherError = status.weather.error
                    self.lastError = status.weather.error ?? result.error
                    return
                }
                if result.error != "本地服务不可用" { return }
            }
        }
    }

    private func testQQMailConnectionWhenLocalAPIReady() {
        Task { [weak self] in
            guard let self else { return }
            self.isTestingMailConnection = true
            self.mailConnectionError = nil
            for attempt in 0..<8 {
                guard !Task.isCancelled else { return }
                if attempt > 0 {
                    try? await Task.sleep(for: .milliseconds(500))
                }
                let result = await self.api.connectMail()
                if result.value?.connected == true {
                    self.isMailConnected = true
                    self.isTestingMailConnection = false
                    self.mailConnectionError = nil
                    self.loadMail(force: true)
                    return
                }
                // Retrying helps only while the local API is still starting.
                // Authentication and network failures are already definitive
                // and must be surfaced immediately instead of appearing hung.
                let error = result.error ?? "QQ 邮箱 IMAP 连接失败"
                if error == "本地服务不可用", attempt < 7 { continue }
                self.mail = .unavailable(error: error, keeping: self.mail.items)
                self.mailConnectionError = error
                self.lastError = error
                self.isMailConnected = false
                self.isTestingMailConnection = false
                return
            }
        }
    }

    private func testWeatherAlertConnectionWhenLocalAPIReady() {
        Task { [weak self] in
            guard let self else { return }
            self.isTestingWeatherAlertConnection = true
            self.weatherAlertError = nil
            self.isWeatherAlertConnected = false
            for attempt in 0..<8 {
                guard !Task.isCancelled else { return }
                if attempt > 0 {
                    try? await Task.sleep(for: .milliseconds(500))
                }
                let result = await self.api.weatherAlerts()
                if let alerts = result.value, alerts.error?.isEmpty != false {
                    self.weatherAlerts = alerts
                    self.weatherAlertsUpdatedAt = Date()
                    self.weatherAlertError = nil
                    self.lastError = nil
                    self.isWeatherAlertConnected = true
                    self.isTestingWeatherAlertConnection = false
                    return
                }
                let error = result.error ?? result.value?.error ?? "天气预警验证失败"
                if error == "本地服务不可用", attempt < 7 { continue }
                self.weatherAlertError = error
                self.lastError = error
                self.isWeatherAlertConnected = false
                self.isTestingWeatherAlertConnection = false
                return
            }
        }
    }

    func openMail(_ item: MailItem) {
        Task {
            let result = await api.readMail(uid: item.uid)
            selectedMail = result.value
            lastError = result.error
            if result.value != nil { loadMail() }
        }
    }

    func closeMail() { selectedMail = nil }

    func loadNotifications() {
        Task {
            let result = await api.notifications()
            notifications = result.value ?? .empty
            lastError = result.error
        }
    }

    func markNotificationRead(_ notification: AppNotification) {
        guard notification.unread else { return }
        Task {
            let result = await api.markNotificationRead(id: notification.id)
            notifications = result.value ?? notifications
            lastError = result.error
        }
    }

    func markAllNotificationsRead() {
        Task {
            let result = await api.markAllNotificationsRead()
            notifications = result.value ?? notifications
            lastError = result.error
        }
    }

    func searchWeatherLocations(_ query: String) {
        Task {
            let result = await api.searchWeatherLocations(query: query)
            weatherLocations = result.value?.locations ?? []
            weatherError = result.error
            lastError = result.error
        }
    }

    func selectWeatherLocation(_ location: WeatherLocation) {
        Task {
            let result = await api.selectWeatherLocation(location)
            if let weather = result.value {
                snapshot = StatusSnapshot(weather: weather, github: snapshot.github)
                if weather.isAvailable { weatherUpdatedAt = Date() }
                weatherError = nil
                weatherAlerts = .empty
                weatherAlertError = nil
                weatherAlertsUpdatedAt = nil
                if weather.isAvailable {
                    _ = await refreshWeatherAlerts()
                }
            }
            weatherError = result.error
            lastError = result.error ?? weatherAlertError
        }
    }

    @discardableResult
    private func refreshWeatherAlerts() async -> String? {
        let result = await api.weatherAlerts()
        if let alerts = result.value {
            weatherAlerts = alerts
            weatherAlertsUpdatedAt = Date()
        }
        weatherAlertError = result.error ?? result.value?.error
        isWeatherAlertConnected = result.value != nil && weatherAlertError == nil
        return weatherAlertError
    }
}
