import AppKit
import Combine
import Foundation

@MainActor
final class AppState: ObservableObject {
    @Published private(set) var snapshot = StatusSnapshot.empty
    @Published private(set) var codex = UsageSnapshot.unavailable(source: "codex-app-server")
    @Published private(set) var codexTokenUsage = CodexTokenUsage.unavailable
    @Published private(set) var deepSeek = UsageSnapshot.unconfigured
    @Published private(set) var superGrok = UsageSnapshot.unconfigured(source: "grok-cli")
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
    @Published private(set) var superGrokError: String?
    @Published private(set) var isRefreshing = false
    @Published private(set) var isRefreshingGitHub = false
    @Published private(set) var isRefreshingMail = false
    @Published private(set) var isRefreshingNotifications = false
    @Published private(set) var isClearingReadNotifications = false
    @Published private(set) var notificationError: String?
    @Published private(set) var lastError: String?
    @Published private(set) var codexUpdatedAt: Date?
    @Published private(set) var deepSeekUpdatedAt: Date?
    @Published private(set) var superGrokUpdatedAt: Date?
    @Published private(set) var weatherUpdatedAt: Date?
    @Published private(set) var githubContributionDetail = GitHubContributionDetail.empty
    @Published private(set) var isLoadingGitHubContributionDetail = false
    @Published private(set) var githubContributionError: String?
    @Published private(set) var selectedGitHubDateKey: String?
    @Published private(set) var selectedGitHubContributionRepository: GitHubContributionRepository?
    @Published private(set) var githubRepositoryCommits = GitHubRepositoryCommits.empty
    @Published private(set) var isLoadingGitHubRepositoryCommits = false
    @Published private(set) var githubRepositoryCommitsError: String?
    @Published var selectedGitHubMonthKey: String?
    @Published var menuBarEnabled: Bool
    @Published var selectedWorkspace: WorkspaceDestination? = .overview
    @Published var selectedNotificationID: String?
    @Published var isMainSidebarVisible: Bool {
        didSet {
            UserDefaults.standard.set(
                isMainSidebarVisible,
                forKey: SidebarPresentation.visibilityDefaultsKey
            )
        }
    }

    let settings = AppSettingsStore()
    private let api = LocalAPIClient()
    private let codexClient = CodexUsageClient()
    private let codexTokenClient = CodexTokenUsageClient()
    private let deepSeekClient = DeepSeekUsageClient()
    private let grokClient = GrokUsageClient()
    private let backend = LocalBackendSupervisor()
    private var refreshTask: Task<Void, Never>?
    private var notificationStartupTask: Task<Void, Never>?
    private var weatherAlertsUpdatedAt: Date?
    private var hasStarted = false
    private var githubContributionRequestID = 0
    private var githubContributionDetailCache: [String: GitHubContributionDetail] = [:]
    private var githubRepositoryCommitsRequestID = 0
    private var githubRepositoryCommitsCache: [String: GitHubRepositoryCommits] = [:]
    private var dismissedAcknowledgementIDs: Set<String> = []

    init() {
        menuBarEnabled = settings.menuBarEnabled
        isMainSidebarVisible = UserDefaults.standard.object(
            forKey: SidebarPresentation.visibilityDefaultsKey
        ) as? Bool ?? true
    }

    func toggleMainSidebar() {
        isMainSidebarVisible.toggle()
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
            overrideQQMailConfiguration: settings.qqMailAuthCode != nil,
            githubToken: settings.githubToken,
            overrideGitHubToken: settings.hasGitHubToken,
            githubUsername: settings.githubUsername
        )
        refresh()
        refreshWhenLocalAPIReady()
        refreshMailWhenLocalAPIReady()
        refreshNotificationsWhenLocalAPIReady()
        refreshTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(30))
                self?.refresh()
                self?.loadNotifications()
            }
        }
    }

    private func restartLocalBackend() {
        backend.restart(
            weatherAPIKey: settings.weatherAPIKey,
            weatherAPIHost: settings.weatherAPIHost,
            weatherProjectID: settings.weatherProjectID,
            weatherCredentialID: settings.weatherCredentialID,
            weatherPrivateKey: settings.weatherPrivateKey,
            overrideWeatherAlertCredentials: settings.hasWeatherAlertCredentials,
            qqMailAddress: settings.qqMailAddress,
            qqMailAuthCode: settings.qqMailAuthCode,
            overrideQQMailConfiguration: settings.qqMailAuthCode != nil,
            githubToken: settings.githubToken,
            overrideGitHubToken: true,
            githubUsername: settings.githubUsername
        )
    }

    func loadSensitiveSettings() {
        Task { [weak self] in
            guard let self else { return }
            let loaded = await self.settings.loadSensitiveValues()
            guard loaded else { return }
            self.restartLocalBackend()
            self.refreshWhenLocalAPIReady()
            self.refreshNotificationsWhenLocalAPIReady()
            self.refreshMailWhenLocalAPIReady()
        }
    }

    func stop() {
        refreshTask?.cancel()
        refreshTask = nil
        notificationStartupTask?.cancel()
        notificationStartupTask = nil
        backend.stop()
    }

    deinit {
        refreshTask?.cancel()
        notificationStartupTask?.cancel()
        backend.stop()
    }

    var menuBarTemperature: String {
        MenuBarTemperatureFormatter.title(
            for: snapshot.weather.isAvailable ? snapshot.weather.temperature : nil
        )
    }

    var pendingAcknowledgement: AppNotification? {
        notifications.items
            .filter { $0.unread && $0.requiresAcknowledgement && !dismissedAcknowledgementIDs.contains($0.id) }
            .max { $0.createdAt < $1.createdAt }
    }

    func acknowledgeNotification(_ notification: AppNotification) {
        dismissedAcknowledgementIDs.insert(notification.id)
        markNotificationRead(notification)
    }

    func dismissAcknowledgement(_ notification: AppNotification) {
        dismissedAcknowledgementIDs.insert(notification.id)
        objectWillChange.send()
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
        restartLocalBackend()
        refreshWhenLocalAPIReady()
        if settings.hasWeatherAlertCredentials {
            testWeatherAlertConnectionWhenLocalAPIReady()
        }
    }

    func saveGitHubConfiguration(username usernameValue: String, token tokenValue: String) {
        let username = usernameValue.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "@"))
        let token = tokenValue.trimmingCharacters(in: .whitespacesAndNewlines)
        settings.githubUsername = username.isEmpty ? "kibuouo" : username
        // Empty token field means "keep the stored value", same as other secrets.
        if !token.isEmpty {
            settings.githubToken = token
        }
        restartLocalBackend()
        refreshWhenLocalAPIReady()
        // Force a GitHub refresh after the local API restarts with the new token.
        Task {
            try? await Task.sleep(for: .milliseconds(800))
            refreshGitHub()
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
        restartLocalBackend()
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
            async let codexTokenResult = codexTokenClient.read(force: force)
            async let deepSeekResult = deepSeekClient.read(configuration: deepSeekConfiguration, force: force)
            async let grokResult = grokClient.read(force: force)

            let (status, codexUsage, codexTokenUsageResult, deepSeekUsage, grokUsage) = await (
                statusResult, codexResult, codexTokenResult, deepSeekResult, grokResult
            )
            if let statusValue = status.value {
                snapshot = statusValue
                if statusValue.weather.isAvailable { weatherUpdatedAt = Date() }
                weatherError = statusValue.weather.error
                if let github = statusValue.github {
                    if selectedGitHubMonthKey == nil
                        || !(github.contributionMonths.contains { $0.key == selectedGitHubMonthKey })
                    {
                        selectedGitHubMonthKey = github.contributionMonths.last?.key
                        selectedGitHubDateKey = nil
                    }
                    if let dateKey = selectedGitHubDateKey {
                        if githubContributionDetail.rangeKey != dateKey {
                            await loadGitHubContributionDetail(date: dateKey)
                        }
                    } else if let monthKey = selectedGitHubMonthKey,
                              githubContributionDetail.rangeKey != monthKey
                    {
                        await loadGitHubContributionDetail(month: monthKey)
                    }
                }
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
            if let tokenUsage = codexTokenUsageResult.value {
                codexTokenUsage = tokenUsage
            }
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
            if let grokValue = grokUsage.value {
                if grokValue.isAvailable {
                    superGrok = grokValue
                    superGrokUpdatedAt = Date()
                } else {
                    superGrok = grokValue.status == "Unconfigured"
                        ? grokValue
                        : superGrok.preservingValues(status: "Unavailable")
                }
            }
            superGrokError = grokUsage.error
            lastError = status.error
                ?? weatherError
                ?? codexUsage.error
                ?? deepSeekUsage.error
                ?? grokUsage.error
                ?? weatherAlertError
            isRefreshing = false
        }
    }

    func refreshGitHub() {
        guard !isRefreshingGitHub else { return }
        isRefreshingGitHub = true
        Task {
            let result = await api.refreshGitHub()
            if let github = result.value {
                snapshot = StatusSnapshot(weather: snapshot.weather, github: github)
                // Fresh calendar data invalidates previous drill-down cache and day selection.
                clearGitHubContributionCache(resetSelectionToCurrentMonth: true, github: github)
                if let monthKey = selectedGitHubMonthKey {
                    await loadGitHubContributionDetail(month: monthKey)
                }
            }
            lastError = result.error
            isRefreshingGitHub = false
        }
    }

    func selectGitHubMonth(_ key: String) {
        let monthChanged = selectedGitHubMonthKey != key
        selectedGitHubMonthKey = key
        // Switching months always clears the day drill-down (design invariant).
        if monthChanged || selectedGitHubDateKey != nil {
            selectedGitHubDateKey = nil
            Task { await loadGitHubContributionDetail(month: key) }
        }
    }

    func selectGitHubContributionRepository(_ repository: GitHubContributionRepository) {
        guard selectedGitHubContributionRepository?.nameWithOwner != repository.nameWithOwner else { return }
        selectedGitHubContributionRepository = repository
        let rangeKey = githubContributionDetail.rangeKey
        let dateKey = selectedGitHubDateKey
        Task {
            await loadGitHubRepositoryCommits(
                repository,
                rangeKey: rangeKey,
                dateKey: dateKey
            )
        }
    }

    /// Toggle a calendar day: re-selecting the same day returns to the month summary.
    func selectGitHubDate(_ dateKey: String) {
        if selectedGitHubDateKey == dateKey {
            clearGitHubDateSelection()
            return
        }
        if dateKey.count >= 7 {
            let monthKey = String(dateKey.prefix(7))
            if selectedGitHubMonthKey != monthKey {
                selectedGitHubMonthKey = monthKey
            }
        }
        selectedGitHubDateKey = dateKey
        Task { await loadGitHubContributionDetail(date: dateKey) }
    }

    func clearGitHubDateSelection() {
        guard selectedGitHubDateKey != nil else { return }
        selectedGitHubDateKey = nil
        if let monthKey = selectedGitHubMonthKey {
            Task { await loadGitHubContributionDetail(month: monthKey) }
        }
    }

    func loadGitHubContributionDetail(month: String? = nil, date: String? = nil) async {
        let monthKey = month ?? selectedGitHubMonthKey
        let dateKey = date
        guard dateKey != nil || monthKey != nil else { return }

        resetGitHubRepositoryCommitSelection()

        if let dateKey {
            selectedGitHubDateKey = dateKey
        } else {
            selectedGitHubDateKey = nil
        }

        let cacheKey = GitHubContributionFormatting.cacheKey(month: dateKey == nil ? monthKey : nil, date: dateKey)
        if let cacheKey, let cached = githubContributionDetailCache[cacheKey] {
            githubContributionDetail = cached
            githubContributionError = cached.message.isEmpty ? nil : cached.message
            isLoadingGitHubContributionDetail = false
            await loadDefaultGitHubRepositoryCommits(for: cached)
            return
        }

        // Show calendar-backed totals immediately while GraphQL detail loads.
        if let fallback = contributionFallback(monthKey: monthKey, dateKey: dateKey) {
            githubContributionDetail = fallback
        }

        githubContributionRequestID += 1
        let requestID = githubContributionRequestID
        isLoadingGitHubContributionDetail = true
        githubContributionError = nil

        let result = await api.githubContributions(
            month: dateKey == nil ? monthKey : nil,
            date: dateKey
        )

        // Ignore stale responses when the user clicked another day/month quickly.
        guard requestID == githubContributionRequestID else { return }

        if let detail = result.value {
            githubContributionDetail = detail
            githubContributionError = detail.message.isEmpty ? nil : detail.message
            if let cacheKey {
                githubContributionDetailCache[cacheKey] = detail
            }
            await loadDefaultGitHubRepositoryCommits(for: detail)
        } else if let fallback = contributionFallback(
            monthKey: monthKey,
            dateKey: dateKey,
            message: result.error ?? "提交明细暂时不可用"
        ) {
            githubContributionDetail = fallback
            githubContributionError = result.error
        } else {
            githubContributionDetail = .empty
            githubContributionError = result.error
        }
        isLoadingGitHubContributionDetail = false
    }

    private func clearGitHubContributionCache(resetSelectionToCurrentMonth: Bool, github: GitHubSnapshot?) {
        githubContributionDetailCache.removeAll()
        githubRepositoryCommitsCache.removeAll()
        selectedGitHubDateKey = nil
        resetGitHubRepositoryCommitSelection()
        githubContributionRequestID += 1
        if resetSelectionToCurrentMonth {
            if let github {
                if selectedGitHubMonthKey == nil
                    || !(github.contributionMonths.contains { $0.key == selectedGitHubMonthKey })
                {
                    selectedGitHubMonthKey = github.contributionMonths.last?.key
                }
            }
        }
    }

    private func loadDefaultGitHubRepositoryCommits(for detail: GitHubContributionDetail) async {
        guard let repository = detail.repositories.first else { return }
        selectedGitHubContributionRepository = repository
        await loadGitHubRepositoryCommits(
            repository,
            rangeKey: detail.rangeKey,
            dateKey: selectedGitHubDateKey
        )
    }

    private func loadGitHubRepositoryCommits(
        _ repository: GitHubContributionRepository,
        rangeKey: String,
        dateKey: String?
    ) async {
        guard !rangeKey.isEmpty else { return }
        let cacheKey = GitHubContributionFormatting.cacheKey(
            month: dateKey == nil ? rangeKey : nil,
            date: dateKey
        ).map { "\($0)|repository:\(repository.nameWithOwner)" }
        if let cacheKey, let cached = githubRepositoryCommitsCache[cacheKey] {
            githubRepositoryCommits = cached
            githubRepositoryCommitsError = cached.message.isEmpty ? nil : cached.message
            isLoadingGitHubRepositoryCommits = false
            return
        }

        githubRepositoryCommitsRequestID += 1
        let requestID = githubRepositoryCommitsRequestID
        isLoadingGitHubRepositoryCommits = true
        githubRepositoryCommitsError = nil
        let result = await api.githubRepositoryCommits(
            repository: repository.nameWithOwner,
            month: dateKey == nil ? rangeKey : nil,
            date: dateKey
        )
        guard requestID == githubRepositoryCommitsRequestID else { return }

        if let commits = result.value {
            githubRepositoryCommits = commits
            githubRepositoryCommitsError = commits.message.isEmpty ? nil : commits.message
            if let cacheKey, commits.detailsAvailable {
                githubRepositoryCommitsCache[cacheKey] = commits
            }
        } else {
            githubRepositoryCommits = .empty
            githubRepositoryCommitsError = result.error
        }
        isLoadingGitHubRepositoryCommits = false
    }

    private func resetGitHubRepositoryCommitSelection() {
        selectedGitHubContributionRepository = nil
        githubRepositoryCommits = .empty
        githubRepositoryCommitsError = nil
        githubRepositoryCommitsRequestID += 1
        isLoadingGitHubRepositoryCommits = false
    }

    private func contributionFallback(
        monthKey: String?,
        dateKey: String?,
        message: String = ""
    ) -> GitHubContributionDetail? {
        let months = snapshot.github?.contributionMonths ?? []
        if let dateKey {
            let monthPrefix = String(dateKey.prefix(7))
            guard let month = months.first(where: { $0.key == monthPrefix }) else { return nil }
            return .fallback(month: month, dateKey: dateKey, message: message)
        }
        guard let monthKey, let month = months.first(where: { $0.key == monthKey }) else { return nil }
        return .fallback(month: month, message: message)
    }

    func loadMail(force: Bool = false) {
        guard !isRefreshingMail else { return }
        isRefreshingMail = true
        Task {
            let result = await api.mail(force: force)
            mail = result.value ?? .unavailable(error: result.error, keeping: mail.items)
            mailConnectionError = result.value?.error ?? result.error
            if force { isMailConnected = result.value?.availability == "live" }
            lastError = mailConnectionError
            isRefreshingMail = false
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
            for attempt in 0..<20 {
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
                    if status.weather.isAvailable {
                        _ = await self.refreshWeatherAlerts()
                    }
                    self.loadNotifications()
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
        openMail(uid: item.uid)
    }

    private func openMail(uid: String) {
        Task {
            let result = await api.readMail(uid: uid)
            selectedMail = result.value
            lastError = result.error
            if result.value != nil {
                loadMail()
                loadNotifications()
            }
        }
    }

    func closeMail() { selectedMail = nil }

    func openNotification(_ notification: AppNotification) {
        openNotification(NotificationConversation(latest: notification, updates: [notification]))
    }

    func openNotification(_ conversation: NotificationConversation) {
        let notification = conversation.latest
        if notification.source == "mail", let uid = notification.sourceID {
            openMail(uid: uid)
        } else if conversation.unreadIDs.count > 1 {
            markNotificationsRead(conversation.unreadIDs)
        } else if notification.unread {
            markNotificationRead(notification)
        }
    }

    func openNotificationSource(_ notification: AppNotification) {
        switch notification.source {
        case "mail":
            if let uid = notification.sourceID { openMail(uid: uid) }
        case "qweather":
            selectedWorkspace = .weather
        case "github":
            selectedWorkspace = .github
        default:
            if let url = notification.resolvedExternalURL {
                NSWorkspace.shared.open(url)
            }
        }
    }

    func loadNotifications() {
        guard !isRefreshingNotifications else { return }
        isRefreshingNotifications = true
        Task {
            let result = await api.notifications()
            if let value = result.value {
                notifications = value
                notificationError = nil
            } else {
                notificationError = result.error
            }
            lastError = result.error
            isRefreshingNotifications = false
        }
    }

    private func refreshNotificationsWhenLocalAPIReady() {
        notificationStartupTask?.cancel()
        isRefreshingNotifications = true
        notificationStartupTask = Task { [weak self] in
            guard let self else { return }
            for attempt in 0..<20 {
                guard !Task.isCancelled else { return }
                if attempt > 0 {
                    try? await Task.sleep(for: .milliseconds(500))
                }
                let result = await self.api.notifications()
                if let value = result.value {
                    self.notifications = value
                    self.notificationError = nil
                    self.lastError = nil
                    self.isRefreshingNotifications = false
                    self.notificationStartupTask = nil
                    return
                }
                if result.error != "本地服务不可用" {
                    self.notificationError = result.error
                    self.lastError = result.error
                    self.isRefreshingNotifications = false
                    self.notificationStartupTask = nil
                    return
                }
            }
            self.notificationError = "本地通知服务启动超时"
            self.lastError = self.notificationError
            self.isRefreshingNotifications = false
            self.notificationStartupTask = nil
        }
    }

    func markNotificationRead(_ notification: AppNotification) {
        guard notification.unread else { return }
        Task {
            let result = await api.markNotificationRead(id: notification.id)
            notifications = result.value ?? notifications
            notificationError = result.error
            lastError = result.error
        }
    }

    func markNotificationRead(id: String) {
        guard let notification = notifications.items.first(where: { $0.id == id }) else { return }
        markNotificationRead(notification)
    }

    private func markNotificationsRead(_ ids: [String]) {
        guard !ids.isEmpty else { return }
        Task {
            let result = await api.markNotificationsRead(ids: ids)
            notifications = result.value ?? notifications
            notificationError = result.error
            lastError = result.error
        }
    }

    func markAllNotificationsRead() {
        Task {
            let result = await api.markAllNotificationsRead()
            notifications = result.value ?? notifications
            notificationError = result.error
            lastError = result.error
        }
    }

    func clearReadNotifications() {
        guard !isClearingReadNotifications else { return }
        isClearingReadNotifications = true
        Task {
            let result = await api.clearReadNotifications()
            notifications = result.value ?? notifications
            notificationError = result.error
            lastError = result.error
            isClearingReadNotifications = false
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
