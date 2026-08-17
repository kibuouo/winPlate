import Combine
import CryptoKit
import Foundation
import MultipeerConnectivity
import Security

enum HealthRefreshReason: String, Codable, Equatable {
    case appLaunch
    case foregroundTimer
    case healthKitObserver
    case retry
    case manual
}

enum HealthPeerPairing {
    private static let service = "com.kiko.winplate"
    private static let account = "health-peer-pairing-v1"

    static func loadOrCreateCode() -> String {
        if let stored = read(), HealthPeerPairing.normalize(stored) != nil {
            return stored
        }
        let code = String(format: "%06d", Int.random(in: 0...999_999))
        save(code)
        return code
    }

    static func normalize(_ value: String) -> String? {
        let digits = value.filter(\.isNumber)
        guard digits.count == 6 else { return nil }
        return digits
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

    private static func read() -> String? {
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

    private static func save(_ value: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        let attributes: [String: Any] = [
            kSecValueData as String: Data(value.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock
        ]
        if SecItemUpdate(query as CFDictionary, attributes as CFDictionary) == errSecItemNotFound {
            var item = query
            item.merge(attributes) { _, new in new }
            SecItemAdd(item as CFDictionary, nil)
        }
    }
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
        stepCount = try container.decodeIfPresent(Double.self, forKey: .stepCount)
        stepCountSampleAt = try container.decodeIfPresent(Date.self, forKey: .stepCountSampleAt)
        activeEnergy = try container.decodeIfPresent(Double.self, forKey: .activeEnergy)
        activeEnergySampleAt = try container.decodeIfPresent(Date.self, forKey: .activeEnergySampleAt)
        desktopStatus = try container.decodeIfPresent(DesktopStatusSnapshot.self, forKey: .desktopStatus)
    }
}

struct DesktopStatusSnapshot: Codable, Equatable {
    static let currentSchemaVersion = 1

    let schemaVersion: Int
    let sender: String
    let sentAt: String
    let weather: DesktopWeatherSnapshot?
    let codex: DesktopQuotaSnapshot?
    let superGrok: DesktopQuotaSnapshot?
    let deepSeek: DesktopBalanceSnapshot?

    init(
        schemaVersion: Int = currentSchemaVersion,
        sender: String,
        sentAt: String,
        weather: DesktopWeatherSnapshot?,
        codex: DesktopQuotaSnapshot?,
        superGrok: DesktopQuotaSnapshot?,
        deepSeek: DesktopBalanceSnapshot?
    ) {
        self.schemaVersion = schemaVersion
        self.sender = sender
        self.sentAt = sentAt
        self.weather = weather
        self.codex = codex
        self.superGrok = superGrok
        self.deepSeek = deepSeek
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

struct HeartRateHistoryPoint: Equatable, Identifiable {
    let date: Date
    let bpm: Double

    var id: Date { date }
}

enum HeartRateHistory {
    static let retention: TimeInterval = 7 * 24 * 60 * 60
    static let maximumPoints = 720

    static func appending(
        _ point: HeartRateHistoryPoint,
        to history: [HeartRateHistoryPoint],
        now: Date = Date()
    ) -> [HeartRateHistoryPoint] {
        let cutoff = now.addingTimeInterval(-retention)
        var next = history.filter { $0.date >= cutoff }

        if let existingIndex = next.lastIndex(where: { $0.date == point.date }) {
            next[existingIndex] = point
        } else {
            next.append(point)
        }

        next.sort { $0.date < $1.date }
        if next.count > maximumPoints {
            next.removeFirst(next.count - maximumPoints)
        }
        return next
    }
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
        case .searching: return "搜索 iPhone"
        case .connecting: return "连接中"
        case .connected: return "已连接"
        case .error: return "通信异常"
        }
    }

    var detail: String {
        switch self {
        case .idle: return "等待健康通信服务启动"
        case .searching: return "请在 iPhone 输入本页配对码，并保持 WinPlate Health 打开"
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

    init(role: Role, displayName: String, pairingCode: String? = nil) {
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
        guard !peers.isEmpty else {
            publish(.searching)
            restartIfNeeded()
            return
        }

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
