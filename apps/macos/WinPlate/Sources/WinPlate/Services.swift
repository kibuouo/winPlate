import Foundation
import LocalAuthentication
import Security

actor LocalAPIClient {
    private let baseURL = URL(string: "http://127.0.0.1:8765")!

    func status(force: Bool) async -> ResultValue<StatusSnapshot> {
        await request(path: "/api/status", force: force)
    }

    func refreshGitHub() async -> ResultValue<GitHubSnapshot> {
        await request(path: "/api/github/refresh", method: "POST")
    }

    func mail(force: Bool) async -> ResultValue<MailOutline> {
        await request(path: force ? "/api/mail/refresh" : "/api/mail/outline", method: force ? "POST" : "GET")
    }

    func connectMail() async -> ResultValue<MailConnection> {
        await request(path: "/api/mail/connect", method: "POST")
    }

    func readMail(uid: String) async -> ResultValue<MailMessage> {
        await request(path: "/api/mail/messages/\(uid)/read", method: "POST")
    }

    func notifications() async -> ResultValue<NotificationSummary> {
        await request(path: "/api/notifications")
    }

    func markNotificationRead(id: String) async -> ResultValue<NotificationSummary> {
        await request(path: "/api/notifications/\(id)/read", method: "POST")
    }

    func markAllNotificationsRead() async -> ResultValue<NotificationSummary> {
        await request(path: "/api/notifications/read-all", method: "POST")
    }

    func searchWeatherLocations(query: String) async -> ResultValue<WeatherLocationSearch> {
        let encoded = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        return await request(path: "/api/weather/locations/search?q=\(encoded)")
    }

    func selectWeatherLocation(_ location: WeatherLocation) async -> ResultValue<WeatherSnapshot> {
        struct Payload: Encodable { let locationId: String; let name: String; let adm1: String; let latitude: Double?; let longitude: Double? }
        let payload = Payload(locationId: location.id, name: location.name, adm1: location.adm1, latitude: Double(location.lat ?? ""), longitude: Double(location.lon ?? ""))
        return await request(path: "/api/weather/location/manual", method: "POST", payload: AnyEncodable(payload))
    }

    func weatherAlerts() async -> ResultValue<WeatherAlertSummary> {
        await request(path: "/api/weather/alerts")
    }

    private func request<T: Decodable>(path: String, method: String = "GET", force: Bool = false, payload: AnyEncodable? = nil) async -> ResultValue<T> {
        guard let url = URL(string: path, relativeTo: baseURL) else {
            return ResultValue(value: nil, error: "本地服务地址无效")
        }
        // `appending(path:)` encodes a query string as part of the path.  Keep
        // query items intact so city searches reach FastAPI as `?q=...`.
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 12
        request.cachePolicy = force ? .reloadIgnoringLocalCacheData : .useProtocolCachePolicy
        if let payload {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try? JSONEncoder().encode(payload)
        }
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                let reason = (try? JSONDecoder().decode(APIError.self, from: data).detail) ?? "请求失败"
                return ResultValue(value: nil, error: reason)
            }
            return ResultValue(value: try JSONDecoder().decode(T.self, from: data), error: nil)
        } catch {
            return ResultValue(value: nil, error: "本地服务不可用")
        }
    }
}

private struct APIError: Decodable { let detail: String }
private struct AnyEncodable: Encodable {
    private let encodeValue: (Encoder) throws -> Void
    init(_ value: some Encodable) { encodeValue = value.encode }
    func encode(to encoder: Encoder) throws { try encodeValue(encoder) }
}

actor DeepSeekUsageClient {
    private var cached: (UsageSnapshot, Date)?

    func read(configuration: DeepSeekConfiguration, force: Bool) async -> ResultValue<UsageSnapshot> {
        if !force, let cached, Date().timeIntervalSince(cached.1) < 300 { return .init(value: cached.0, error: nil) }
        guard let key = configuration.apiKey, !key.isEmpty else { return .init(value: .unconfigured, error: nil) }
        guard let url = URL(string: configuration.baseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/user/balance") else {
            return .init(value: .unavailable(source: "deepseek-api"), error: "DeepSeek 地址无效")
        }
        var request = URLRequest(url: url)
        request.timeoutInterval = 10
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                return .init(value: .unavailable(source: "deepseek-api"), error: "DeepSeek 响应无效")
            }
            guard http.statusCode == 200 else {
                let message: String
                switch http.statusCode {
                case 401, 403: message = "DeepSeek API Key 无效或无权读取余额"
                case 429: message = "DeepSeek 请求过于频繁，请稍后重试"
                default: message = "DeepSeek 返回 HTTP \(http.statusCode)"
                }
                return .init(value: .unavailable(source: "deepseek-api"), error: message)
            }
            let payload = try JSONDecoder().decode(DeepSeekBalanceResponse.self, from: data)
            let usage = UsageSnapshot(source: "deepseek-api", status: payload.isAvailable && !payload.balances.isEmpty ? "Normal" : "Unavailable", remainingPct: nil, resetText: nil, windows: nil, balances: payload.balances)
            cached = (usage, Date())
            return .init(value: usage, error: nil)
        } catch let error as URLError {
            return .init(value: .unavailable(source: "deepseek-api"), error: "DeepSeek 网络错误：\(error.localizedDescription)")
        } catch {
            return .init(value: .unavailable(source: "deepseek-api"), error: "DeepSeek 响应无法解析")
        }
    }
}

private struct DeepSeekBalanceResponse: Decodable {
    let isAvailable: Bool
    let balances: [Balance]
    enum CodingKeys: String, CodingKey { case isAvailable = "is_available", balances = "balance_infos" }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        isAvailable = try c.decodeIfPresent(Bool.self, forKey: .isAvailable) ?? false
        balances = (try c.decodeIfPresent([DeepSeekBalance].self, forKey: .balances) ?? []).map { Balance(currency: $0.currency, totalBalance: $0.totalBalance) }
    }
}
private struct DeepSeekBalance: Decodable { let currency: String; let totalBalance: String; enum CodingKeys: String, CodingKey { case currency; case totalBalance = "total_balance" } }

actor CodexUsageClient {
    private var cached: (UsageSnapshot, Date)?

    func read(force: Bool) async -> ResultValue<UsageSnapshot> {
        if !force, let cached, Date().timeIntervalSince(cached.1) < 900 { return .init(value: cached.0, error: nil) }
        let usage = await ProcessCodexReader.read()
        if usage.status == "Normal" { cached = (usage, Date()) }
        return .init(value: usage, error: usage.status == "Normal" ? nil : "Codex 用量不可用")
    }
}

private enum ProcessCodexReader {
    static func read() async -> UsageSnapshot {
        await withTaskGroup(of: UsageSnapshot.self) { group in
            group.addTask { await query() }
            group.addTask { try? await Task.sleep(for: .seconds(15)); return .unavailable(source: "codex-app-server") }
            let first = await group.next() ?? .unavailable(source: "codex-app-server")
            group.cancelAll()
            return first
        }
    }

    private static func query() async -> UsageSnapshot {
        await withCheckedContinuation { continuation in
            let process = Process()
            let bundledCodex = "/Applications/ChatGPT.app/Contents/Resources/codex"
            let configuredCodex = ProcessInfo.processInfo.environment["CODEX_CLI_PATH"]
            let executable = [configuredCodex, bundledCodex]
                .compactMap { $0 }
                .first(where: { FileManager.default.isExecutableFile(atPath: $0) })
            if let executable {
                process.executableURL = URL(fileURLWithPath: executable)
                process.arguments = ["app-server", "--listen", "stdio://"]
            } else {
                process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
                process.arguments = ["codex", "app-server", "--listen", "stdio://"]
            }
            let input = Pipe(); let output = Pipe()
            process.standardInput = input; process.standardOutput = output; process.standardError = Pipe()
            let state = CodexReadState()
            let finish: (UsageSnapshot) -> Void = { result in
                guard state.claimCompletion() else { return }
                output.fileHandleForReading.readabilityHandler = nil
                if process.isRunning { process.terminate() }
                continuation.resume(returning: result)
            }
            output.fileHandleForReading.readabilityHandler = { handle in
                let data = handle.availableData
                guard !data.isEmpty else {
                    finish(.unavailable(source: "codex-app-server"))
                    return
                }
                for line in state.appendAndReadLines(data) {
                    guard let object = try? JSONSerialization.jsonObject(with: line) as? [String: Any], let id = object["id"] as? Int else { continue }
                    if id == 1 {
                        let initialized = "{\"method\":\"initialized\"}\n{\"id\":2,\"method\":\"account/rateLimits/read\",\"params\":{}}\n"
                        input.fileHandleForWriting.write(Data(initialized.utf8))
                    } else if id == 2 {
                        finish(parse(object))
                    }
                }
            }
            process.terminationHandler = { _ in finish(.unavailable(source: "codex-app-server")) }
            do {
                try process.run()
                let initialize = "{\"id\":1,\"method\":\"initialize\",\"params\":{\"clientInfo\":{\"name\":\"winplate\",\"version\":\"1.0\"},\"capabilities\":{\"experimentalApi\":true}}}\n"
                input.fileHandleForWriting.write(Data(initialize.utf8))
            } catch { finish(.unavailable(source: "codex-app-server")) }
        }
    }

    private static func parse(_ response: [String: Any]) -> UsageSnapshot {
        guard let result = response["result"] as? [String: Any], let rates = (result["rateLimitsByLimitId"] as? [String: Any])?["codex"] as? [String: Any] ?? result["rateLimits"] as? [String: Any] else { return .unavailable(source: "codex-app-server") }
        func window(_ key: String) -> UsageWindow? {
            guard let value = rates[key] as? [String: Any], let used = value["usedPercent"] as? Double else { return nil }
            let reset = (value["resetsAt"] as? Double).map(formatRemaining)
            return UsageWindow(remainingPct: max(0, min(100, 100 - used)), resetText: reset)
        }
        let fiveHour = window("primary"), sevenDay = window("secondary")
        guard fiveHour?.remainingPct != nil else { return .unavailable(source: "codex-app-server") }
        return UsageSnapshot(source: "codex-app-server", status: "Normal", remainingPct: fiveHour?.remainingPct, resetText: fiveHour?.resetText, windows: UsageWindows(fiveHour: fiveHour, sevenDay: sevenDay), balances: [])
    }

    private static func formatRemaining(_ timestamp: Double) -> String {
        let minutes = max(0, Int((timestamp - Date().timeIntervalSince1970).rounded(.up) / 60))
        let days = minutes / 1_440; let hours = (minutes % 1_440) / 60; let remainder = minutes % 60
        if days > 0 { return hours > 0 ? "\(days)d \(hours)h" : "\(days)d" }
        if hours > 0 { return remainder > 0 ? "\(hours)h \(remainder)m" : "\(hours)h" }
        return "\(remainder)m"
    }
}

private final class CodexReadState: @unchecked Sendable {
    private let lock = NSLock()
    private var buffer = Data()
    private var completed = false

    func claimCompletion() -> Bool {
        lock.lock(); defer { lock.unlock() }
        guard !completed else { return false }
        completed = true
        return true
    }

    func appendAndReadLines(_ data: Data) -> [Data] {
        lock.lock(); defer { lock.unlock() }
        buffer.append(data)
        var lines = [Data]()
        while let range = buffer.range(of: Data([10])) {
            lines.append(buffer.subdata(in: buffer.startIndex..<range.lowerBound))
            buffer.removeSubrange(buffer.startIndex...range.lowerBound)
        }
        return lines
    }
}

struct DeepSeekConfiguration: Sendable {
    let apiKey: String?
    let baseURL: String
}

@MainActor
final class AppSettingsStore: ObservableObject {
    @Published var menuBarEnabled: Bool { didSet { defaults.set(menuBarEnabled, forKey: "menuBarEnabled") } }
    @Published var launchAtLogin: Bool { didSet { defaults.set(launchAtLogin, forKey: "launchAtLogin") } }
    @Published var deepSeekBaseURL: String { didSet { defaults.set(deepSeekBaseURL, forKey: "deepSeekBaseURL") } }
    @Published var deepSeekAPIKey: String? { didSet { if !isLoadingSensitiveValues, oldValue != deepSeekAPIKey { saveSensitiveValues() } } }
    @Published var weatherAPIKey: String? { didSet { if !isLoadingSensitiveValues, oldValue != weatherAPIKey { saveSensitiveValues() } } }
    @Published var weatherProjectID: String? { didSet { if !isLoadingSensitiveValues, oldValue != weatherProjectID { saveSensitiveValues() } } }
    @Published var weatherCredentialID: String? { didSet { if !isLoadingSensitiveValues, oldValue != weatherCredentialID { saveSensitiveValues() } } }
    @Published var weatherPrivateKey: String? { didSet { if !isLoadingSensitiveValues, oldValue != weatherPrivateKey { saveSensitiveValues() } } }
    @Published var weatherAPIHost: String { didSet { defaults.set(weatherAPIHost, forKey: "weatherAPIHost") } }
    @Published var qqMailAddress: String { didSet { defaults.set(qqMailAddress, forKey: "qqMailAddress") } }
    @Published var qqMailAuthCode: String? { didSet { if !isLoadingSensitiveValues, oldValue != qqMailAuthCode { saveSensitiveValues() } } }
    private let defaults = UserDefaults.standard
    private var isLoadingSensitiveValues = false
    private var hasLoadedSensitiveValues = false

    init() {
        menuBarEnabled = defaults.object(forKey: "menuBarEnabled") as? Bool ?? true
        launchAtLogin = defaults.bool(forKey: "launchAtLogin")
        deepSeekBaseURL = defaults.string(forKey: "deepSeekBaseURL") ?? "https://api.deepseek.com"
        deepSeekAPIKey = nil
        weatherAPIKey = nil
        weatherProjectID = nil
        weatherCredentialID = nil
        weatherPrivateKey = nil
        weatherAPIHost = defaults.string(forKey: "weatherAPIHost") ?? "devapi.qweather.com"
        qqMailAddress = defaults.string(forKey: "qqMailAddress") ?? ""
        qqMailAuthCode = nil
    }

    func loadSensitiveValues() {
        guard !hasLoadedSensitiveValues else { return }
        hasLoadedSensitiveValues = true
        let context = LAContext()
        isLoadingSensitiveValues = true
        let storedValues = Keychain.readSensitiveValues(context: context)
        // Earlier versions wrote each secret separately.  Merge missing
        // values lazily. Eagerly opening every legacy item can block startup
        // when an item belongs to an older ad-hoc signing identity.
        let values = SensitiveValues(
            deepSeekAPIKey: storedValues?.deepSeekAPIKey
                ?? Keychain.read(account: "deepseek-api-key", context: context),
            weatherAPIKey: storedValues?.weatherAPIKey
                ?? Keychain.read(account: "qweather-api-key", context: context),
            weatherProjectID: storedValues?.weatherProjectID,
            weatherCredentialID: storedValues?.weatherCredentialID,
            weatherPrivateKey: storedValues?.weatherPrivateKey,
            qqMailAuthCode: storedValues?.qqMailAuthCode
                ?? Keychain.read(account: "qq-mail-auth-code", context: context)
        )
        applySensitiveValues(values)
        if values.hasValue { Keychain.saveSensitiveValues(values) }
        isLoadingSensitiveValues = false
    }

    private func applySensitiveValues(_ values: SensitiveValues) {
        deepSeekAPIKey = values.deepSeekAPIKey
        weatherAPIKey = values.weatherAPIKey
        weatherProjectID = values.weatherProjectID
        weatherCredentialID = values.weatherCredentialID
        weatherPrivateKey = values.weatherPrivateKey
        qqMailAuthCode = values.qqMailAuthCode
    }

    private func saveSensitiveValues() {
        Keychain.saveSensitiveValues(
            SensitiveValues(
                deepSeekAPIKey: deepSeekAPIKey,
                weatherAPIKey: weatherAPIKey,
                weatherProjectID: weatherProjectID,
                weatherCredentialID: weatherCredentialID,
                weatherPrivateKey: weatherPrivateKey,
                qqMailAuthCode: qqMailAuthCode
            )
        )
    }

    var deepSeekConfiguration: DeepSeekConfiguration {
        DeepSeekConfiguration(apiKey: deepSeekAPIKey, baseURL: deepSeekBaseURL)
    }

    var hasWeatherAlertCredentials: Bool {
        [weatherProjectID, weatherCredentialID, weatherPrivateKey].allSatisfy { value in
            guard let value else { return false }
            return !value.isEmpty
        }
    }
}

private struct SensitiveValues: Codable {
    let deepSeekAPIKey: String?
    let weatherAPIKey: String?
    let weatherProjectID: String?
    let weatherCredentialID: String?
    let weatherPrivateKey: String?
    let qqMailAuthCode: String?

    var hasValue: Bool {
        [deepSeekAPIKey, weatherAPIKey, weatherProjectID, weatherCredentialID, weatherPrivateKey, qqMailAuthCode].contains { value in
            guard let value else { return false }
            return !value.isEmpty
        }
    }
}

private enum Keychain {
    private static let accessibility = kSecAttrAccessibleAfterFirstUnlock
    private static let service = "com.kiko.winplate"
    private static let sensitiveValuesAccount = "sensitive-values-v1"

    static func read(account: String, context: LAContext? = nil) -> String? {
        guard let data = readData(account: account, context: context) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func readSensitiveValues(context: LAContext) -> SensitiveValues? {
        guard let data = readData(account: sensitiveValuesAccount, context: context) else { return nil }
        return try? JSONDecoder().decode(SensitiveValues.self, from: data)
    }

    static func saveSensitiveValues(_ values: SensitiveValues) {
        guard values.hasValue, let data = try? JSONEncoder().encode(values) else {
            delete(account: sensitiveValuesAccount)
            return
        }
        save(data: data, account: sensitiveValuesAccount)
    }

    private static func readData(account: String, context: LAContext?) -> Data? {
        var query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account, kSecReturnData as String: true]
        if let context { query[kSecUseAuthenticationContext as String] = context }
        var result: CFTypeRef?; guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return data
    }

    private static func save(data: Data, account: String) {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            // The app may refresh in the background after login.  Permit the
            // item's owner to read it after the user has unlocked the Mac once,
            // without weakening the item's Keychain protection at rest.
            kSecAttrAccessible as String: accessibility
        ]
        if SecItemUpdate(query as CFDictionary, attributes as CFDictionary) == errSecItemNotFound { var item = query; item.merge(attributes) { _, new in new }; SecItemAdd(item as CFDictionary, nil) }
    }

    private static func delete(account: String) {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
        SecItemDelete(query as CFDictionary)
    }
}

final class LocalBackendSupervisor {
    private var process: Process?
    private var outputLog: FileHandle?
    func startIfAvailable(
        weatherAPIKey: String? = nil,
        weatherAPIHost: String? = nil,
        overrideWeatherAPIKey: Bool = false,
        weatherProjectID: String? = nil,
        weatherCredentialID: String? = nil,
        weatherPrivateKey: String? = nil,
        overrideWeatherAlertCredentials: Bool = false,
        qqMailAddress: String? = nil,
        qqMailAuthCode: String? = nil,
        overrideQQMailConfiguration: Bool = false
    ) {
        guard ProcessInfo.processInfo.environment["WINPLATE_SKIP_LOCAL_API"] != "1" else {
            fputs("WinPlate local API startup skipped by WINPLATE_SKIP_LOCAL_API\n", stderr)
            return
        }
        guard process?.isRunning != true else { return }
        guard let backend = Bundle.main.resourceURL?.appendingPathComponent(
            "LocalAPI",
            isDirectory: true
        ) else {
            fputs("WinPlate bundled local API resource directory not found\n", stderr)
            return
        }
        guard FileManager.default.fileExists(atPath: backend.path) else {
            fputs("WinPlate bundled local API not found at \(backend.path)\n", stderr)
            return
        }
        guard let pythonPackages = Bundle.main.resourceURL?.appendingPathComponent(
            "PythonPackages",
            isDirectory: true
        ), FileManager.default.fileExists(atPath: pythonPackages.path) else {
            fputs("WinPlate bundled Python packages not found\n", stderr)
            return
        }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
        process.arguments = [
            "-m", "uvicorn", "winplate_local_api.main:api",
            "--host", "127.0.0.1", "--port", "8765"
        ]
        var environment = ProcessInfo.processInfo.environment
        environment["PYTHONPATH"] = pythonPackages.path
        if overrideWeatherAPIKey {
            if let weatherAPIKey = weatherAPIKey?.trimmingCharacters(in: .whitespacesAndNewlines), !weatherAPIKey.isEmpty {
                environment["QWEATHER_API_KEY"] = weatherAPIKey
            } else {
                environment.removeValue(forKey: "QWEATHER_API_KEY")
            }
            if let weatherAPIHost = weatherAPIHost?.trimmingCharacters(in: .whitespacesAndNewlines), !weatherAPIHost.isEmpty {
                environment["QWEATHER_API_HOST"] = weatherAPIHost
            } else {
                environment.removeValue(forKey: "QWEATHER_API_HOST")
            }
        }
        if overrideWeatherAlertCredentials {
            environment["QWEATHER_PROJECT_ID"] = weatherProjectID?.trimmingCharacters(in: .whitespacesAndNewlines)
            environment["QWEATHER_CREDENTIAL_ID"] = weatherCredentialID?.trimmingCharacters(in: .whitespacesAndNewlines)
            environment["QWEATHER_PRIVATE_KEY"] = weatherPrivateKey?.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        if overrideQQMailConfiguration {
            if let qqMailAddress = qqMailAddress?.trimmingCharacters(in: .whitespacesAndNewlines), !qqMailAddress.isEmpty {
                environment["QQ_MAIL_ADDRESS"] = qqMailAddress
            } else {
                environment.removeValue(forKey: "QQ_MAIL_ADDRESS")
            }
            if let qqMailAuthCode = qqMailAuthCode?.trimmingCharacters(in: .whitespacesAndNewlines), !qqMailAuthCode.isEmpty {
                environment["QQ_MAIL_AUTH_CODE"] = qqMailAuthCode
            } else {
                environment.removeValue(forKey: "QQ_MAIL_AUTH_CODE")
            }
        }
        process.environment = environment
        process.currentDirectoryURL = backend
        outputLog?.closeFile()
        outputLog = localAPILogFile()
        process.standardOutput = outputLog
        process.standardError = outputLog
        do {
            try process.run()
            self.process = process
        } catch {
            fputs("WinPlate local API failed to start: \(error)\n", stderr)
        }
    }
    func restart(
        weatherAPIKey: String?,
        weatherAPIHost: String?,
        weatherProjectID: String? = nil,
        weatherCredentialID: String? = nil,
        weatherPrivateKey: String? = nil,
        overrideWeatherAlertCredentials: Bool = false,
        qqMailAddress: String? = nil,
        qqMailAuthCode: String? = nil,
        overrideQQMailConfiguration: Bool = false
    ) {
        if let process, process.isRunning {
            process.terminate()
            process.waitUntilExit()
        }
        process = nil
        startIfAvailable(
            weatherAPIKey: weatherAPIKey,
            weatherAPIHost: weatherAPIHost,
            overrideWeatherAPIKey: true,
            weatherProjectID: weatherProjectID,
            weatherCredentialID: weatherCredentialID,
            weatherPrivateKey: weatherPrivateKey,
            overrideWeatherAlertCredentials: overrideWeatherAlertCredentials,
            qqMailAddress: qqMailAddress,
            qqMailAuthCode: qqMailAuthCode,
            overrideQQMailConfiguration: overrideQQMailConfiguration
        )
    }
    func stop() {
        if process?.isRunning == true { process?.terminate() }
        outputLog?.closeFile()
        outputLog = nil
    }

    private func localAPILogFile() -> FileHandle? {
        guard let directory = FileManager.default.urls(
            for: .libraryDirectory,
            in: .userDomainMask
        ).first?.appendingPathComponent("Logs/WinPlate", isDirectory: true) else {
            return nil
        }
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let file = directory.appendingPathComponent("local-api.log")
            FileManager.default.createFile(atPath: file.path, contents: nil)
            let handle = try FileHandle(forWritingTo: file)
            try handle.seekToEnd()
            return handle
        } catch {
            return nil
        }
    }
}
