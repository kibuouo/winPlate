import Combine
import Foundation
import MultipeerConnectivity

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
    let stepCount: Double?
    let stepCountSampleAt: Date?
    let activeEnergy: Double?
    let activeEnergySampleAt: Date?

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
        activeEnergySampleAt: Date? = nil
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
    }
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
        case .notConfigured: return "在 Windows 健康页复制地址后粘贴到这里"
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

enum WindowsHealthLink {
    private static let endpointKey = "winplate.windowsHealthEndpoint"

    static var savedEndpoint: String {
        UserDefaults.standard.string(forKey: endpointKey) ?? ""
    }

    static func normalizeEndpoint(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let candidate = trimmed.contains("://") ? trimmed : "http://\(trimmed)"
        guard var components = URLComponents(string: candidate),
              let scheme = components.scheme?.lowercased(),
              ["http", "https"].contains(scheme),
              let host = components.host,
              !host.isEmpty else {
            return nil
        }

        if components.path.isEmpty || components.path == "/" {
            components.path = "/api/health/sync"
        }
        guard components.path == "/api/health/sync" else { return nil }
        return components.url?.absoluteString
    }

    static func saveEndpoint(_ value: String) -> String? {
        guard let endpoint = normalizeEndpoint(value) else { return nil }
        UserDefaults.standard.set(endpoint, forKey: endpointKey)
        return endpoint
    }

    static func send(_ payload: HealthSyncPayload, to endpoint: String) async throws {
        guard let url = URL(string: endpoint), let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else {
            throw URLError(.badURL)
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 8
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.httpShouldHandleCookies = false
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(payload)

        let configuration = URLSessionConfiguration.default
        configuration.waitsForConnectivity = true
        configuration.timeoutIntervalForRequest = 8
        configuration.timeoutIntervalForResource = 12
        let session = URLSession(configuration: configuration)
        let response: URLResponse
        do {
            (_, response) = try await session.data(for: request)
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
                ? "Windows 配对令牌无效，请从 Windows 健康页重新复制地址。"
                : "Windows 返回 HTTP \(statusCode)"
            throw NSError(
                domain: "WinPlateWindowsHealth",
                code: statusCode,
                userInfo: [NSLocalizedDescriptionKey: detail]
            )
        }
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
        case .searching: return "请保持 WinPlate 在 macOS 上运行"
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
    private var advertiser: MCNearbyServiceAdvertiser?
    private var browser: MCNearbyServiceBrowser?

    init(role: Role, displayName: String) {
        self.role = role
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
            let advertiser = MCNearbyServiceAdvertiser(
                peer: peerID,
                discoveryInfo: ["role": "iphone", "schema": "1"],
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
        }

        publish(.searching)
    }

    func stop() {
        advertiser?.stopAdvertisingPeer()
        browser?.stopBrowsingForPeers()
        advertiser = nil
        browser = nil
        session.disconnect()
        publish(.idle)
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
        publish(.connecting)
        browser.invitePeer(peerID, to: session, withContext: nil, timeout: 30)
    }

    func browser(_ browser: MCNearbyServiceBrowser, lostPeer peerID: MCPeerID) {
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
