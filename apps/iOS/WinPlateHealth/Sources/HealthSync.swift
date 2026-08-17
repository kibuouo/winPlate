import Combine
import CryptoKit
import Foundation
import MultipeerConnectivity
import Security

enum HealthOverviewCache {
    struct Snapshot {
        var desktopStatus: DesktopStatusSnapshot?
        var lastDesktopStatusAt: Date?
        var latestHeartRate: Double?
        var lastHeartRateSampleAt: Date?
        var stepCount: Double?
        var lastStepCountSampleAt: Date?
        var activeEnergy: Double?
        var lastActiveEnergySampleAt: Date?
        var lastUpdated: Date?
        var lastHeartRateSamples: [HeartRateSample]
    }

    private static let defaultsKey = "winplate.health.overview-cache-v2"
    private static var supportDirectory: URL? {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
            .appendingPathComponent("WinPlateHealth", isDirectory: true)
    }
    private static var cacheURL: URL? {
        supportDirectory?.appendingPathComponent("overview-cache-v2.json")
    }
    private static var samplesURL: URL? {
        supportDirectory?.appendingPathComponent("heart-rate-samples.json")
    }

    static var hasCachedOverview: Bool {
        guard let snapshot = load() else { return false }
        return snapshot.desktopStatus != nil || snapshot.lastUpdated != nil || snapshot.latestHeartRate != nil
    }

    static func load() -> Snapshot? {
        if let snapshot = load(from: cacheURL.flatMap { try? Data(contentsOf: $0) }) {
            return snapshot
        }
        return load(from: UserDefaults.standard.data(forKey: defaultsKey))
    }

    static func save(_ snapshot: Snapshot) {
        let merged = merge(snapshot, onto: load())
        let stored = Stored(
            desktopStatus: merged.desktopStatus.flatMap { status in
                status.hasUsefulData ? status : nil
            },
            lastDesktopStatusAt: merged.lastDesktopStatusAt?.timeIntervalSince1970,
            latestHeartRate: merged.latestHeartRate,
            lastHeartRateSampleAt: merged.lastHeartRateSampleAt?.timeIntervalSince1970,
            stepCount: merged.stepCount,
            lastStepCountSampleAt: merged.lastStepCountSampleAt?.timeIntervalSince1970,
            activeEnergy: merged.activeEnergy,
            lastActiveEnergySampleAt: merged.lastActiveEnergySampleAt?.timeIntervalSince1970,
            lastUpdated: merged.lastUpdated?.timeIntervalSince1970,
            github: merged.desktopStatus?.github.flatMap { $0.hasContent ? $0 : nil },
            mail: merged.desktopStatus?.mail
        )
        guard let data = try? JSONEncoder().encode(stored) else { return }
        UserDefaults.standard.set(data, forKey: defaultsKey)
        UserDefaults.standard.synchronize()
        if let cacheURL {
            do {
                try FileManager.default.createDirectory(
                    at: cacheURL.deletingLastPathComponent(),
                    withIntermediateDirectories: true
                )
                try data.write(to: cacheURL, options: .atomic)
            } catch {
                // UserDefaults already holds a copy for the next launch.
            }
        }
        saveSamples(merged.lastHeartRateSamples)
    }

    private static func load(from data: Data?) -> Snapshot? {
        guard let data, let stored = try? JSONDecoder().decode(Stored.self, from: data) else {
            return nil
        }
        let desktopStatus = DesktopStatusSnapshot.merging(
            stored.desktopStatus,
            onto: DesktopStatusSnapshot(
                sender: stored.desktopStatus?.sender ?? "",
                sentAt: stored.desktopStatus?.sentAt ?? "",
                weather: stored.desktopStatus?.weather,
                github: stored.github,
                mail: stored.mail,
                codex: stored.desktopStatus?.codex,
                superGrok: stored.desktopStatus?.superGrok,
                deepSeek: stored.desktopStatus?.deepSeek
            )
        )
        return Snapshot(
            desktopStatus: desktopStatus.hasUsefulData ? desktopStatus : nil,
            lastDesktopStatusAt: stored.lastDesktopStatusAt.map(Date.init(timeIntervalSince1970:)),
            latestHeartRate: stored.latestHeartRate,
            lastHeartRateSampleAt: stored.lastHeartRateSampleAt.map(Date.init(timeIntervalSince1970:)),
            stepCount: stored.stepCount,
            lastStepCountSampleAt: stored.lastStepCountSampleAt.map(Date.init(timeIntervalSince1970:)),
            activeEnergy: stored.activeEnergy,
            lastActiveEnergySampleAt: stored.lastActiveEnergySampleAt.map(Date.init(timeIntervalSince1970:)),
            lastUpdated: stored.lastUpdated.map(Date.init(timeIntervalSince1970:)),
            lastHeartRateSamples: loadSamples()
        )
    }

    private static func merge(_ snapshot: Snapshot, onto existing: Snapshot?) -> Snapshot {
        Snapshot(
            desktopStatus: {
                let merged = DesktopStatusSnapshot.merging(snapshot.desktopStatus, onto: existing?.desktopStatus)
                return merged.hasUsefulData ? merged : nil
            }(),
            lastDesktopStatusAt: snapshot.lastDesktopStatusAt ?? existing?.lastDesktopStatusAt,
            latestHeartRate: snapshot.latestHeartRate ?? existing?.latestHeartRate,
            lastHeartRateSampleAt: snapshot.lastHeartRateSampleAt ?? existing?.lastHeartRateSampleAt,
            stepCount: snapshot.stepCount ?? existing?.stepCount,
            lastStepCountSampleAt: snapshot.lastStepCountSampleAt ?? existing?.lastStepCountSampleAt,
            activeEnergy: snapshot.activeEnergy ?? existing?.activeEnergy,
            lastActiveEnergySampleAt: snapshot.lastActiveEnergySampleAt ?? existing?.lastActiveEnergySampleAt,
            lastUpdated: snapshot.lastUpdated ?? existing?.lastUpdated,
            lastHeartRateSamples: snapshot.lastHeartRateSamples.isEmpty
                ? (existing?.lastHeartRateSamples ?? [])
                : snapshot.lastHeartRateSamples
        )
    }

    private static func loadSamples() -> [HeartRateSample] {
        guard let samplesURL, let data = try? Data(contentsOf: samplesURL) else { return [] }
        return (try? JSONDecoder().decode([StoredSample].self, from: data))?.compactMap(\.sample) ?? []
    }

    private static func saveSamples(_ samples: [HeartRateSample]) {
        guard let samplesURL else { return }
        do {
            try FileManager.default.createDirectory(
                at: samplesURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            try JSONEncoder().encode(samples.map(StoredSample.init)).write(to: samplesURL, options: .atomic)
        } catch {
            return
        }
    }

    private struct Stored: Codable {
        var desktopStatus: DesktopStatusSnapshot?
        var lastDesktopStatusAt: TimeInterval?
        var latestHeartRate: Double?
        var lastHeartRateSampleAt: TimeInterval?
        var stepCount: Double?
        var lastStepCountSampleAt: TimeInterval?
        var activeEnergy: Double?
        var lastActiveEnergySampleAt: TimeInterval?
        var lastUpdated: TimeInterval?
        var github: DesktopGitHubSnapshot?
        var mail: DesktopMailSnapshot?

        private enum CodingKeys: String, CodingKey {
            case desktopStatus
            case lastDesktopStatusAt
            case latestHeartRate
            case lastHeartRateSampleAt
            case stepCount
            case lastStepCountSampleAt
            case activeEnergy
            case lastActiveEnergySampleAt
            case lastUpdated
            case github
            case mail
        }

        init(
            desktopStatus: DesktopStatusSnapshot?,
            lastDesktopStatusAt: TimeInterval?,
            latestHeartRate: Double?,
            lastHeartRateSampleAt: TimeInterval?,
            stepCount: Double?,
            lastStepCountSampleAt: TimeInterval?,
            activeEnergy: Double?,
            lastActiveEnergySampleAt: TimeInterval?,
            lastUpdated: TimeInterval?,
            github: DesktopGitHubSnapshot?,
            mail: DesktopMailSnapshot?
        ) {
            self.desktopStatus = desktopStatus
            self.lastDesktopStatusAt = lastDesktopStatusAt
            self.latestHeartRate = latestHeartRate
            self.lastHeartRateSampleAt = lastHeartRateSampleAt
            self.stepCount = stepCount
            self.lastStepCountSampleAt = lastStepCountSampleAt
            self.activeEnergy = activeEnergy
            self.lastActiveEnergySampleAt = lastActiveEnergySampleAt
            self.lastUpdated = lastUpdated
            self.github = github
            self.mail = mail
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            if let status = try? container.decode(DesktopStatusSnapshot.self, forKey: .desktopStatus) {
                desktopStatus = status
            } else if let data = try? container.decode(Data.self, forKey: .desktopStatus) {
                desktopStatus = try? JSONDecoder().decode(DesktopStatusSnapshot.self, from: data)
            } else {
                desktopStatus = nil
            }
            lastDesktopStatusAt = try container.decodeIfPresent(TimeInterval.self, forKey: .lastDesktopStatusAt)
            latestHeartRate = try container.decodeIfPresent(Double.self, forKey: .latestHeartRate)
            lastHeartRateSampleAt = try container.decodeIfPresent(TimeInterval.self, forKey: .lastHeartRateSampleAt)
            stepCount = try container.decodeIfPresent(Double.self, forKey: .stepCount)
            lastStepCountSampleAt = try container.decodeIfPresent(TimeInterval.self, forKey: .lastStepCountSampleAt)
            activeEnergy = try container.decodeIfPresent(Double.self, forKey: .activeEnergy)
            lastActiveEnergySampleAt = try container.decodeIfPresent(TimeInterval.self, forKey: .lastActiveEnergySampleAt)
            lastUpdated = try container.decodeIfPresent(TimeInterval.self, forKey: .lastUpdated)
            github = try container.decodeIfPresent(DesktopGitHubSnapshot.self, forKey: .github)
            mail = try container.decodeIfPresent(DesktopMailSnapshot.self, forKey: .mail)
        }
    }

    private struct StoredSample: Codable {
        var sampleAt: TimeInterval
        var heartRate: Double

        init(_ sample: HeartRateSample) {
            sampleAt = sample.sampleAt.timeIntervalSince1970
            heartRate = sample.heartRate
        }

        var sample: HeartRateSample? {
            guard (30...300).contains(heartRate) else { return nil }
            return HeartRateSample(sampleAt: Date(timeIntervalSince1970: sampleAt), heartRate: heartRate)
        }
    }
}

enum HealthSecretStore {
    private static let service = "com.kiko.winplate.health"

    static func string(for account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }

    static func set(_ value: String?, for account: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        SecItemDelete(query as CFDictionary)
        guard let value, !value.isEmpty, let data = value.data(using: .utf8) else { return }
        var item = query
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(item as CFDictionary, nil)
    }
}

enum HealthPeerPairing {
    static let codeAccount = "health-peer-pairing-v1"

    static var savedCode: String? {
        HealthSecretStore.string(for: codeAccount)
    }

    static func generateCode() -> String {
        String(format: "%06d", Int.random(in: 0...999_999))
    }

    static func normalize(_ value: String) -> String? {
        let digits = value.filter(\.isNumber)
        guard digits.count == 6 else { return nil }
        return digits
    }

    static func save(_ value: String) -> String? {
        guard let code = normalize(value) else { return nil }
        HealthSecretStore.set(code, for: codeAccount)
        return code
    }

    static func invitationContext(for code: String) -> Data {
        Data("winplate-health:\(code)".utf8)
    }

    static func discoveryToken(for code: String) -> String {
        SHA256.hash(data: Data(code.utf8)).prefix(8).map { String(format: "%02x", $0) }.joined()
    }

    static func matches(_ context: Data?, expectedCode: String?) -> Bool {
        guard let expectedCode, !expectedCode.isEmpty else { return false }
        return context == invitationContext(for: expectedCode)
    }
}

enum HealthRefreshReason: String, Codable, Equatable {
    case appLaunch
    case foregroundTimer
    case healthKitObserver
    case retry
    case manual
}

struct HealthSyncPayload: Codable, Equatable {
    static let currentSchemaVersion = 2

    let schemaVersion: Int
    let snapshotId: UUID
    let reason: HealthRefreshReason
    let sender: String
    let sentAt: Date
    let healthUpdatedAt: Date?
    let permissionGranted: Bool
    let heartRate: Double?
    let heartRateSampleAt: Date?
    let heartRateSamples: [HeartRateSample]
    let stepCount: Double?
    let stepCountSampleAt: Date?
    let activeEnergy: Double?
    let activeEnergySampleAt: Date?
    let desktopStatus: DesktopStatusSnapshot?

    init(
        schemaVersion: Int = currentSchemaVersion,
        snapshotId: UUID = UUID(),
        reason: HealthRefreshReason = .manual,
        sender: String,
        sentAt: Date,
        healthUpdatedAt: Date?,
        permissionGranted: Bool,
        heartRate: Double?,
        heartRateSampleAt: Date? = nil,
        heartRateSamples: [HeartRateSample] = [],
        stepCount: Double?,
        stepCountSampleAt: Date? = nil,
        activeEnergy: Double?,
        activeEnergySampleAt: Date? = nil,
        desktopStatus: DesktopStatusSnapshot? = nil
    ) {
        self.schemaVersion = schemaVersion
        self.snapshotId = snapshotId
        self.reason = reason
        self.sender = sender
        self.sentAt = sentAt
        self.healthUpdatedAt = healthUpdatedAt
        self.permissionGranted = permissionGranted
        self.heartRate = heartRate
        self.heartRateSampleAt = heartRateSampleAt
        self.heartRateSamples = heartRateSamples
        self.stepCount = stepCount
        self.stepCountSampleAt = stepCountSampleAt
        self.activeEnergy = activeEnergy
        self.activeEnergySampleAt = activeEnergySampleAt
        self.desktopStatus = desktopStatus
    }

    private enum CodingKeys: String, CodingKey {
        case schemaVersion
        case snapshotId
        case reason
        case sender
        case sentAt
        case healthUpdatedAt
        case permissionGranted
        case heartRate
        case heartRateSampleAt
        case heartRateSamples
        case stepCount
        case stepCountSampleAt
        case activeEnergy
        case activeEnergySampleAt
        case desktopStatus
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try container.decodeIfPresent(Int.self, forKey: .schemaVersion) ?? 1
        snapshotId = try container.decodeIfPresent(UUID.self, forKey: .snapshotId) ?? UUID()
        reason = try container.decodeIfPresent(HealthRefreshReason.self, forKey: .reason) ?? .manual
        sender = try container.decode(String.self, forKey: .sender)
        sentAt = try container.decode(Date.self, forKey: .sentAt)
        healthUpdatedAt = try container.decodeIfPresent(Date.self, forKey: .healthUpdatedAt)
        permissionGranted = try container.decode(Bool.self, forKey: .permissionGranted)
        heartRate = try container.decodeIfPresent(Double.self, forKey: .heartRate)
        heartRateSampleAt = try container.decodeIfPresent(Date.self, forKey: .heartRateSampleAt)
        heartRateSamples = try container.decodeIfPresent([HeartRateSample].self, forKey: .heartRateSamples) ?? []
        stepCount = try container.decodeIfPresent(Double.self, forKey: .stepCount)
        stepCountSampleAt = try container.decodeIfPresent(Date.self, forKey: .stepCountSampleAt)
        activeEnergy = try container.decodeIfPresent(Double.self, forKey: .activeEnergy)
        activeEnergySampleAt = try container.decodeIfPresent(Date.self, forKey: .activeEnergySampleAt)
        desktopStatus = try container.decodeIfPresent(DesktopStatusSnapshot.self, forKey: .desktopStatus)
    }
}

struct HeartRateSample: Codable, Equatable {
    let sampleAt: Date
    let heartRate: Double
}

enum HeartRateHistory {
    static let retention: TimeInterval = 7 * 24 * 60 * 60
    static let maximumPoints = 720
    static let queryLimit = 10_000

    static func compacting(_ samples: [HeartRateSample], now: Date = Date()) -> [HeartRateSample] {
        let cutoff = now.addingTimeInterval(-retention)
        var unique: [Date: HeartRateSample] = [:]
        for sample in samples where sample.sampleAt >= cutoff && (30...300).contains(sample.heartRate) {
            unique[sample.sampleAt] = sample
        }
        let sorted = unique.values.sorted { $0.sampleAt < $1.sampleAt }
        guard sorted.count > maximumPoints, maximumPoints > 1 else { return sorted }

        var compacted: [HeartRateSample] = []
        compacted.reserveCapacity(maximumPoints)
        let lastIndex = sorted.count - 1
        for index in 0..<maximumPoints {
            let sourceIndex = index == maximumPoints - 1
                ? lastIndex
                : (index * lastIndex) / (maximumPoints - 1)
            let sample = sorted[sourceIndex]
            if compacted.last?.sampleAt != sample.sampleAt {
                compacted.append(sample)
            }
        }
        return compacted
    }
}

struct DesktopStatusSnapshot: Codable, Equatable {
    static let currentSchemaVersion = 1

    let schemaVersion: Int
    let sender: String
    let sentAt: String
    let weather: DesktopWeatherSnapshot?
    let github: DesktopGitHubSnapshot?
    let mail: DesktopMailSnapshot?
    let codex: DesktopQuotaSnapshot?
    let superGrok: DesktopQuotaSnapshot?
    let deepSeek: DesktopBalanceSnapshot?

    static let empty = DesktopStatusSnapshot(
        sender: "",
        sentAt: "",
        weather: nil,
        github: nil,
        mail: nil,
        codex: nil,
        superGrok: nil,
        deepSeek: nil
    )

    init(
        schemaVersion: Int = currentSchemaVersion,
        sender: String,
        sentAt: String,
        weather: DesktopWeatherSnapshot?,
        github: DesktopGitHubSnapshot? = nil,
        mail: DesktopMailSnapshot? = nil,
        codex: DesktopQuotaSnapshot?,
        superGrok: DesktopQuotaSnapshot?,
        deepSeek: DesktopBalanceSnapshot?
    ) {
        self.schemaVersion = schemaVersion
        self.sender = sender
        self.sentAt = sentAt
        self.weather = weather
        self.github = github
        self.mail = mail
        self.codex = codex
        self.superGrok = superGrok
        self.deepSeek = deepSeek
    }

    private enum CodingKeys: String, CodingKey {
        case schemaVersion, sender, sentAt, weather, github, mail, codex, superGrok, deepSeek
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try container.decodeIfPresent(Int.self, forKey: .schemaVersion) ?? Self.currentSchemaVersion
        sender = try container.decodeIfPresent(String.self, forKey: .sender) ?? ""
        sentAt = try container.decodeIfPresent(String.self, forKey: .sentAt) ?? ""
        weather = try container.decodeIfPresent(DesktopWeatherSnapshot.self, forKey: .weather)
        github = try container.decodeIfPresent(DesktopGitHubSnapshot.self, forKey: .github)
        mail = try container.decodeIfPresent(DesktopMailSnapshot.self, forKey: .mail)
        codex = try container.decodeIfPresent(DesktopQuotaSnapshot.self, forKey: .codex)
        superGrok = try container.decodeIfPresent(DesktopQuotaSnapshot.self, forKey: .superGrok)
        deepSeek = try container.decodeIfPresent(DesktopBalanceSnapshot.self, forKey: .deepSeek)
    }

    var hasUsefulData: Bool {
        !sender.isEmpty
            || weather?.hasContent == true
            || github?.hasContent == true
            || mail != nil
            || codex != nil
            || superGrok != nil
            || deepSeek != nil
    }

    static func merging(_ incoming: DesktopStatusSnapshot?, onto existing: DesktopStatusSnapshot?) -> DesktopStatusSnapshot {
        switch (incoming, existing) {
        case (nil, nil):
            return .empty
        case (let incoming?, nil):
            return incoming
        case (nil, let existing?):
            return existing
        case (let incoming?, let existing?):
            return DesktopStatusSnapshot(
                schemaVersion: incoming.schemaVersion,
                sender: incoming.sender.isEmpty ? existing.sender : incoming.sender,
                sentAt: incoming.sentAt.isEmpty ? existing.sentAt : incoming.sentAt,
                weather: DesktopWeatherSnapshot.preferred(incoming.weather, existing: existing.weather),
                github: DesktopGitHubSnapshot.preferred(incoming.github, existing: existing.github),
                mail: DesktopMailSnapshot.preferred(incoming.mail, existing: existing.mail),
                codex: incoming.codex ?? existing.codex,
                superGrok: incoming.superGrok ?? existing.superGrok,
                deepSeek: incoming.deepSeek ?? existing.deepSeek
            )
        }
    }
}

struct DesktopWeatherSnapshot: Codable, Equatable {
    let source: String
    let location: String
    let condition: String
    let temperature: Double?
    let feelsLike: Double?
    let humidity: Int?
    let icon: String?
    let alerts: [DesktopWeatherAlert]

    init(
        source: String,
        location: String,
        condition: String,
        temperature: Double?,
        feelsLike: Double?,
        humidity: Int?,
        icon: String?,
        alerts: [DesktopWeatherAlert] = []
    ) {
        self.source = source
        self.location = location
        self.condition = condition
        self.temperature = temperature
        self.feelsLike = feelsLike
        self.humidity = humidity
        self.icon = icon
        self.alerts = alerts
    }

    private enum CodingKeys: String, CodingKey {
        case source, location, condition, temperature, feelsLike, humidity, icon, alerts
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        source = try container.decodeIfPresent(String.self, forKey: .source) ?? ""
        location = try container.decodeIfPresent(String.self, forKey: .location) ?? ""
        condition = try container.decodeIfPresent(String.self, forKey: .condition) ?? ""
        temperature = try container.decodeIfPresent(Double.self, forKey: .temperature)
        feelsLike = try container.decodeIfPresent(Double.self, forKey: .feelsLike)
        humidity = try container.decodeIfPresent(Int.self, forKey: .humidity)
        icon = try container.decodeIfPresent(String.self, forKey: .icon)
        alerts = try container.decodeIfPresent([DesktopWeatherAlert].self, forKey: .alerts) ?? []
    }

    var hasContent: Bool {
        !location.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || temperature != nil
    }

    static func preferred(_ incoming: DesktopWeatherSnapshot?, existing: DesktopWeatherSnapshot?) -> DesktopWeatherSnapshot? {
        if let incoming, incoming.hasContent { return incoming }
        return existing
    }
}

struct DesktopWeatherAlert: Codable, Equatable, Identifiable {
    var id: String { "\(level)|\(title)|\(message)" }
    let title: String
    let level: String
    let message: String
}

struct DesktopGitHubSnapshot: Codable, Equatable {
    let status: String
    let username: String
    let name: String
    let profileUrl: String
    let commitsThisMonth: Int?
    let streakDays: Int?
    let contributions30d: [Int]
    let project: String

    init(
        status: String,
        username: String,
        name: String,
        profileUrl: String,
        commitsThisMonth: Int?,
        streakDays: Int?,
        contributions30d: [Int] = [],
        project: String = ""
    ) {
        self.status = status
        self.username = username
        self.name = name
        self.profileUrl = profileUrl
        self.commitsThisMonth = commitsThisMonth
        self.streakDays = streakDays
        self.contributions30d = contributions30d
        self.project = project
    }

    private enum CodingKeys: String, CodingKey {
        case status, username, name, profileUrl, commitsThisMonth, streakDays, contributions30d, project
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        status = try container.decodeIfPresent(String.self, forKey: .status) ?? ""
        username = try container.decodeIfPresent(String.self, forKey: .username) ?? ""
        name = try container.decodeIfPresent(String.self, forKey: .name) ?? ""
        profileUrl = try container.decodeIfPresent(String.self, forKey: .profileUrl) ?? ""
        commitsThisMonth = try container.decodeIfPresent(Int.self, forKey: .commitsThisMonth)
        streakDays = try container.decodeIfPresent(Int.self, forKey: .streakDays)
        contributions30d = try container.decodeIfPresent([Int].self, forKey: .contributions30d) ?? []
        project = try container.decodeIfPresent(String.self, forKey: .project) ?? ""
    }

    var hasContent: Bool {
        !username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    static func preferred(_ incoming: DesktopGitHubSnapshot?, existing: DesktopGitHubSnapshot?) -> DesktopGitHubSnapshot? {
        if let incoming, incoming.hasContent { return incoming }
        return existing
    }
}

struct DesktopMailSnapshot: Codable, Equatable {
    let status: String
    let unreadCount: Int

    init(status: String, unreadCount: Int) {
        self.status = status
        self.unreadCount = max(0, unreadCount)
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        status = try container.decodeIfPresent(String.self, forKey: .status) ?? "unavailable"
        unreadCount = max(0, try container.decodeIfPresent(Int.self, forKey: .unreadCount) ?? 0)
    }

    private enum CodingKeys: String, CodingKey {
        case status, unreadCount
    }

    var isLive: Bool {
        status.caseInsensitiveCompare("live") == .orderedSame
    }

    static func preferred(_ incoming: DesktopMailSnapshot?, existing: DesktopMailSnapshot?) -> DesktopMailSnapshot? {
        if let incoming {
            if incoming.isLive { return incoming }
            if existing?.isLive == true { return existing }
            return incoming
        }
        return existing
    }
}

struct DesktopQuotaSnapshot: Codable, Equatable {
    let status: String
    let remainingPct: Double?
    let resetText: String?
}

struct DesktopBalanceSnapshot: Codable, Equatable {
    let status: String
    let currency: String?
    let balance: String?
}

enum WindowsHealthSyncState: Equatable {
    case notConfigured
    case sending
    case connected
    case error(String)

    var title: String {
        switch self {
        case .notConfigured: return "未配置"
        case .sending: return "发送中"
        case .connected: return "已同步"
        case .error: return "同步异常"
        }
    }

    var detail: String {
        switch self {
        case .notConfigured: return "在 Windows 健康页复制配对信息后粘贴到这里"
        case .sending: return "正在向 Windows 版 WinPlate 发送健康快照"
        case .connected: return "Windows 已收到最新健康快照"
        case .error(let message): return message
        }
    }

    var symbolName: String {
        switch self {
        case .notConfigured: return "link.badge.plus"
        case .sending: return "arrow.triangle.2.circlepath"
        case .connected: return "checkmark.circle.fill"
        case .error: return "exclamationmark.triangle.fill"
        }
    }
}

private struct WindowsHealthStatusResponse: Decodable {
    let desktopStatus: DesktopStatusSnapshot?
}

private struct WindowsHealthSyncResponse: Decodable {
    let desktopStatus: DesktopStatusSnapshot?
}

enum WindowsHealthLink {
    private static let endpointKey = "winplate.windowsHealthEndpoint"
    private static let tokenAccount = "windows-health-token-v1"

    static var savedEndpoint: String {
        migrateLegacyEndpointIfNeeded()
        return UserDefaults.standard.string(forKey: endpointKey) ?? ""
    }

    static var savedToken: String {
        migrateLegacyEndpointIfNeeded()
        return HealthSecretStore.string(for: tokenAccount) ?? ""
    }

    static func normalizeEndpoint(_ value: String) -> (endpoint: String, token: String)? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        let lines = trimmed
            .split(whereSeparator: \.isNewline)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        if lines.count >= 2, let first = parseSinglePairingValue(lines[0]) {
            let extraToken = String(lines[1])
            return (first.endpoint, first.token.isEmpty ? extraToken : first.token)
        }
        return parseSinglePairingValue(trimmed)
    }

    private static func parseSinglePairingValue(_ value: String) -> (endpoint: String, token: String)? {
        let candidate = value.contains("://") ? value : "http://\(value)"
        guard var components = URLComponents(string: candidate),
              let scheme = components.scheme?.lowercased(),
              ["http", "https", "winplate"].contains(scheme),
              let host = components.host,
              !host.isEmpty else {
            return nil
        }

        let token = components.fragment
            ?? components.queryItems?.first(where: { $0.name == "token" })?.value
            ?? ""
        let port = components.port ?? (scheme == "https" ? 443 : 8766)
        components.scheme = "http"
        components.host = host
        components.port = port
        components.path = "/api/health/sync"
        components.query = nil
        components.fragment = nil
        guard let endpoint = components.url?.absoluteString else { return nil }
        return (endpoint, token)
    }

    static func saveEndpoint(_ value: String, token: String? = nil) -> String? {
        guard let parsed = normalizeEndpoint(value) else { return nil }
        let nextToken = (token?.trimmingCharacters(in: .whitespacesAndNewlines)).flatMap { $0.isEmpty ? nil : $0 } ?? parsed.token
        guard !nextToken.isEmpty || !savedToken.isEmpty else { return nil }
        UserDefaults.standard.set(parsed.endpoint, forKey: endpointKey)
        if !nextToken.isEmpty {
            HealthSecretStore.set(nextToken, for: tokenAccount)
        }
        return parsed.endpoint
    }

    private static func migrateLegacyEndpointIfNeeded() {
        let migrationKey = "winplate.windowsHealthEndpoint.migrated"
        guard !UserDefaults.standard.bool(forKey: migrationKey),
              let stored = UserDefaults.standard.string(forKey: endpointKey),
              let parsed = normalizeEndpoint(stored) else {
            return
        }
        UserDefaults.standard.set(parsed.endpoint, forKey: endpointKey)
        if !parsed.token.isEmpty {
            HealthSecretStore.set(parsed.token, for: tokenAccount)
        }
        UserDefaults.standard.set(true, forKey: migrationKey)
    }

    static func authorizedRequest(url: URL, method: String) -> URLRequest {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 8
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.httpShouldHandleCookies = false
        let token = savedToken
        if !token.isEmpty {
            request.setValue(token, forHTTPHeaderField: "X-WinPlate-Health-Token")
        }
        return request
    }

    static func fetchDesktopStatus(from endpoint: String) async throws -> DesktopStatusSnapshot? {
        guard var components = URLComponents(string: endpoint),
              let scheme = components.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              components.host?.isEmpty == false else {
            throw URLError(.badURL)
        }
        components.query = nil
        components.path = "/api/health/status"
        guard let url = components.url else { throw URLError(.badURL) }

        var request = authorizedRequest(url: url, method: "GET")

        let configuration = URLSessionConfiguration.default
        configuration.waitsForConnectivity = true
        configuration.timeoutIntervalForRequest = 8
        configuration.timeoutIntervalForResource = 12
        let session = URLSession(configuration: configuration)
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch let error as URLError {
            let host = url.host ?? "Windows"
            let detail: String
            switch error.code {
            case .cannotConnectToHost, .networkConnectionLost, .timedOut, .notConnectedToInternet:
                detail = "无法读取 \(host):\(url.port ?? 80) 的桌面状态，请确认 Windows 正在运行并允许局域网访问。"
            default:
                detail = "读取 \(host) 桌面状态失败：\(error.localizedDescription)"
            }
            throw NSError(
                domain: "WinPlateWindowsStatus",
                code: error.errorCode,
                userInfo: [NSLocalizedDescriptionKey: detail]
            )
        }

        guard let httpResponse = response as? HTTPURLResponse,
              (200..<300).contains(httpResponse.statusCode) else {
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
            let detail = statusCode == 401
                ? "Windows 配对信息无效，请从 Windows 健康页重新复制。"
                : "Windows 返回 HTTP \(statusCode)"
            throw NSError(
                domain: "WinPlateWindowsStatus",
                code: statusCode,
                userInfo: [NSLocalizedDescriptionKey: detail]
            )
        }

        return try JSONDecoder().decode(WindowsHealthStatusResponse.self, from: data).desktopStatus
    }

    static func send(_ payload: HealthSyncPayload, to endpoint: String) async throws -> DesktopStatusSnapshot? {
        guard var components = URLComponents(string: endpoint),
              let scheme = components.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              components.host?.isEmpty == false else {
            throw URLError(.badURL)
        }
        components.query = nil
        guard let url = components.url else { throw URLError(.badURL) }

        var request = authorizedRequest(url: url, method: "POST")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(payload)

        let configuration = URLSessionConfiguration.default
        configuration.waitsForConnectivity = true
        configuration.timeoutIntervalForRequest = 8
        configuration.timeoutIntervalForResource = 12
        let session = URLSession(configuration: configuration)
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch let error as URLError {
            let host = url.host ?? "Windows"
            let detail: String
            switch error.code {
            case .appTransportSecurityRequiresSecureConnection:
                detail = "iOS 阻止了局域网 HTTP，请确认 WinPlate Health 的本地网络权限已开启。"
            case .cannotConnectToHost, .networkConnectionLost, .timedOut, .notConnectedToInternet:
                detail = "无法连接 \(host):\(url.port ?? 80)，请确认 iPhone 与 Windows 在同一 Wi-Fi，并允许 Windows 防火墙的专用网络访问。"
            default:
                detail = "连接 \(host) 失败：\(error.localizedDescription)"
            }
            throw NSError(
                domain: "WinPlateWindowsHealth",
                code: error.errorCode,
                userInfo: [NSLocalizedDescriptionKey: detail]
            )
        }
        guard let httpResponse = response as? HTTPURLResponse,
              (200..<300).contains(httpResponse.statusCode) else {
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
            let detail = statusCode == 401
                ? "Windows 配对信息无效，请从 Windows 健康页重新复制。"
                : "Windows 返回 HTTP \(statusCode)"
            throw NSError(
                domain: "WinPlateWindowsHealth",
                code: statusCode,
                userInfo: [NSLocalizedDescriptionKey: detail]
            )
        }

        return try? JSONDecoder().decode(WindowsHealthSyncResponse.self, from: data).desktopStatus
    }
}

extension HealthSyncPayload {
    static let empty = HealthSyncPayload(
        schemaVersion: currentSchemaVersion,
        snapshotId: UUID(),
        reason: .appLaunch,
        sender: "",
        sentAt: .distantPast,
        healthUpdatedAt: nil,
        permissionGranted: false,
        heartRate: nil,
        stepCount: nil,
        activeEnergy: nil
    )
}

enum HealthPeerConnectionState: Equatable {
    case idle
    case searching
    case connecting
    case connected(String)
    case error(String)

    var title: String {
        switch self {
        case .idle: return "未启动"
        case .searching: return "搜索 WinPlate"
        case .connecting: return "连接中"
        case .connected: return "已连接"
        case .error: return "通信异常"
        }
    }

    var detail: String {
        switch self {
        case .idle: return "等待健康通信服务启动"
        case .searching: return "请在 iPhone 输入 Mac 配对码，并保持 WinPlate 在 Mac 上打开"
        case .connecting: return "正在建立加密连接"
        case .connected(let peer): return "已连接到 \(peer)"
        case .error(let message): return message
        }
    }

    var symbolName: String {
        switch self {
        case .idle: return "pause.circle"
        case .searching: return "antenna.radiowaves.left.and.right"
        case .connecting: return "arrow.triangle.2.circlepath"
        case .connected: return "checkmark.circle.fill"
        case .error: return "exclamationmark.triangle.fill"
        }
    }

    var isConnected: Bool {
        if case .connected = self { return true }
        return false
    }
}

final class HealthPeerLink: NSObject, ObservableObject {
    enum Role {
        case advertiser
        case browser
    }

    @Published private(set) var connectionState: HealthPeerConnectionState = .idle

    var onStateChange: ((HealthPeerConnectionState) -> Void)?
    var onPayload: ((HealthSyncPayload) -> Void)?
    var onPayloadSent: ((Date) -> Void)?

    private let role: Role
    private let serviceType = "winplate-health"
    private let session: MCSession
    private let peerID: MCPeerID
    private var pairingCode: String?
    private var advertiser: MCNearbyServiceAdvertiser?
    private var browser: MCNearbyServiceBrowser?
    private var nearbyPeers: [MCPeerID: [String: String]] = [:]
    private var inviteRetryWorkItem: DispatchWorkItem?

    init(role: Role, displayName: String, pairingCode: String? = HealthPeerPairing.savedCode) {
        self.role = role
        self.pairingCode = pairingCode
        self.peerID = MCPeerID(displayName: displayName)
        self.session = MCSession(
            peer: peerID,
            securityIdentity: nil,
            encryptionPreference: .required
        )
        super.init()
        session.delegate = self
    }

    func updatePairingCode(_ code: String?) {
        pairingCode = code
    }

    func start() {
        guard advertiser == nil, browser == nil else { return }

        switch role {
        case .advertiser:
            var discoveryInfo = ["role": "iphone", "schema": "2"]
            if let pairingCode, !pairingCode.isEmpty {
                discoveryInfo["pair"] = HealthPeerPairing.discoveryToken(for: pairingCode)
            }
            let advertiser = MCNearbyServiceAdvertiser(
                peer: peerID,
                discoveryInfo: discoveryInfo,
                serviceType: serviceType
            )
            advertiser.delegate = self
            self.advertiser = advertiser
            advertiser.startAdvertisingPeer()
        case .browser:
            let browser = MCNearbyServiceBrowser(peer: peerID, serviceType: serviceType)
            browser.delegate = self
            self.browser = browser
            browser.startBrowsingForPeers()
            scheduleInviteRetry()
        }

        publish(.searching)
    }

    func stop() {
        advertiser?.stopAdvertisingPeer()
        browser?.stopBrowsingForPeers()
        advertiser = nil
        browser = nil
        nearbyPeers.removeAll()
        inviteRetryWorkItem?.cancel()
        inviteRetryWorkItem = nil
        session.disconnect()
        publish(.idle)
    }

    private func inviteMatchingPeers() {
        guard role == .browser, let browser, let pairingCode, session.connectedPeers.isEmpty else { return }
        let expected = HealthPeerPairing.discoveryToken(for: pairingCode)
        let matches = nearbyPeers.filter { $0.value["role"] == "iphone" && $0.value["pair"] == expected }
        guard !matches.isEmpty else { return }
        publish(.connecting)
        for peer in matches.keys {
            browser.invitePeer(
                peer,
                to: session,
                withContext: HealthPeerPairing.invitationContext(for: pairingCode),
                timeout: 12
            )
        }
    }

    private func scheduleInviteRetry() {
        inviteRetryWorkItem?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.session.connectedPeers.isEmpty else { return }
            self.inviteMatchingPeers()
            self.scheduleInviteRetry()
        }
        inviteRetryWorkItem = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 2, execute: work)
    }

    func restartIfNeeded() {
        guard session.connectedPeers.isEmpty else { return }
        if advertiser != nil || browser != nil {
            stop()
        }
        start()
    }

    func send(_ payload: HealthSyncPayload) {
        let peers = session.connectedPeers
        guard !peers.isEmpty else { return }

        do {
            let data = try JSONEncoder().encode(payload)
            try session.send(data, toPeers: peers, with: .reliable)
            let sentAt = Date()
            DispatchQueue.main.async { [weak self] in
                self?.onPayloadSent?(sentAt)
            }
        } catch {
            publish(.error("发送健康快照失败：\(error.localizedDescription)"))
        }
    }

    private func publish(_ state: HealthPeerConnectionState) {
        DispatchQueue.main.async { [weak self] in
            guard let self, self.connectionState != state else { return }
            self.connectionState = state
            self.onStateChange?(state)
        }
    }
}

extension HealthPeerLink: MCSessionDelegate {
    func session(_ session: MCSession, peer peerID: MCPeerID, didChange state: MCSessionState) {
        switch state {
        case .connecting:
            publish(.connecting)
        case .connected:
            publish(.connected(peerID.displayName))
        case .notConnected:
            publish(.searching)
            DispatchQueue.main.async { [weak self] in
                self?.inviteMatchingPeers()
            }
        @unknown default:
            publish(.error("收到未知的设备连接状态"))
        }
    }

    func session(_ session: MCSession, didReceive data: Data, fromPeer peerID: MCPeerID) {
        do {
            let payload = try JSONDecoder().decode(HealthSyncPayload.self, from: data)
            DispatchQueue.main.async { [weak self] in
                self?.onPayload?(payload)
            }
        } catch {
            if case .connected = connectionState { return }
            publish(.error("收到无法识别的健康数据"))
        }
    }

    func session(
        _ session: MCSession,
        didReceive stream: InputStream,
        withName streamName: String,
        fromPeer peerID: MCPeerID
    ) {}

    func session(
        _ session: MCSession,
        didStartReceivingResourceWithName resourceName: String,
        fromPeer peerID: MCPeerID,
        with progress: Progress
    ) {}

    func session(
        _ session: MCSession,
        didFinishReceivingResourceWithName resourceName: String,
        fromPeer peerID: MCPeerID,
        at localURL: URL?,
        withError error: Error?
    ) {}
}

extension HealthPeerLink: MCNearbyServiceAdvertiserDelegate {
    func advertiser(
        _ advertiser: MCNearbyServiceAdvertiser,
        didReceiveInvitationFromPeer peerID: MCPeerID,
        withContext context: Data?,
        invitationHandler: @escaping (Bool, MCSession?) -> Void
    ) {
        guard HealthPeerPairing.matches(context, expectedCode: pairingCode) else {
            invitationHandler(false, nil)
            return
        }
        invitationHandler(true, session)
    }

    func advertiser(
        _ advertiser: MCNearbyServiceAdvertiser,
        didNotStartAdvertisingPeer error: Error
    ) {
        publish(.error("无法广播健康服务：\(error.localizedDescription)"))
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
            self?.restartIfNeeded()
        }
    }
}

extension HealthPeerLink: MCNearbyServiceBrowserDelegate {
    func browser(
        _ browser: MCNearbyServiceBrowser,
        foundPeer peerID: MCPeerID,
        withDiscoveryInfo info: [String: String]?
    ) {
        nearbyPeers[peerID] = info ?? [:]
        inviteMatchingPeers()
        scheduleInviteRetry()
    }

    func browser(_ browser: MCNearbyServiceBrowser, lostPeer peerID: MCPeerID) {
        nearbyPeers.removeValue(forKey: peerID)
        guard session.connectedPeers.isEmpty else { return }
        publish(.searching)
    }

    func browser(
        _ browser: MCNearbyServiceBrowser,
        didNotStartBrowsingForPeers error: Error
    ) {
        publish(.error("无法搜索 iPhone 健康服务：\(error.localizedDescription)"))
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
            self?.restartIfNeeded()
        }
    }
}
