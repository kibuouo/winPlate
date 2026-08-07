@preconcurrency import Foundation

@MainActor
final class HealthBackgroundUploader: NSObject {
    static let sessionIdentifier = "com.kiko.winplate.health.background-upload"
    static let shared = HealthBackgroundUploader()

    private let outbox: HealthOutbox
    private var session: URLSession!
    private var schedulingSnapshotIds = Set<UUID>()
    private var backgroundEventsCompletionHandler: (() -> Void)?

    var onSuccess: ((UUID, Date) -> Void)?
    var onFailure: ((String) -> Void)?

    init(outbox: HealthOutbox = .shared) {
        self.outbox = outbox
        super.init()
        let configuration = URLSessionConfiguration.background(withIdentifier: Self.sessionIdentifier)
        configuration.sessionSendsLaunchEvents = true
        configuration.waitsForConnectivity = true
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 5 * 60
        session = URLSession(configuration: configuration, delegate: self, delegateQueue: .main)
    }

    func enqueue(_ payload: HealthSyncPayload, to endpoint: String) async {
        do {
            let uploadURL = try await outbox.enqueue(payload)
            schedule(payload, endpoint: endpoint, uploadURL: uploadURL)
        } catch {
            onFailure?("无法保存健康快照：\(error.localizedDescription)")
        }
    }

    func resumePending(to endpoint: String) {
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                guard let payload = try await outbox.pendingSnapshot(),
                      let uploadURL = try await outbox.uploadFileURL(for: payload.snapshotId) else {
                    return
                }
                schedule(payload, endpoint: endpoint, uploadURL: uploadURL)
            } catch {
                onFailure?("无法恢复待发送健康快照：\(error.localizedDescription)")
            }
        }
    }

    func markDelivered(_ snapshotId: UUID) {
        Task { @MainActor [weak self] in
            guard let self else { return }
            try? await outbox.markDelivered(snapshotId: snapshotId)
        }
    }

    func pendingCount() async -> Int {
        (try? await outbox.pendingCount()) ?? 0
    }

    func handleEvents(for identifier: String, completionHandler: @escaping () -> Void) {
        guard identifier == Self.sessionIdentifier else {
            completionHandler()
            return
        }
        backgroundEventsCompletionHandler = completionHandler
        _ = session
    }

    private func schedule(_ payload: HealthSyncPayload, endpoint: String, uploadURL: URL) {
        guard let url = URL(string: endpoint), let scheme = url.scheme?.lowercased(), ["http", "https"].contains(scheme) else {
            onFailure?("Windows 地址无效，无法安排后台上传")
            return
        }
        guard schedulingSnapshotIds.insert(payload.snapshotId).inserted else { return }

        session.getAllTasks { [weak self] tasks in
            Task { @MainActor [weak self] in
                guard let self else { return }
                defer { schedulingSnapshotIds.remove(payload.snapshotId) }
                if tasks.contains(where: { $0.taskDescription == payload.snapshotId.uuidString }) {
                    return
                }

                for task in tasks {
                    guard let taskSnapshotId = task.taskDescription.flatMap(UUID.init(uuidString:)),
                          taskSnapshotId != payload.snapshotId else {
                        continue
                    }
                    task.cancel()
                    try? await outbox.removeUploadFile(for: taskSnapshotId)
                }

                var request = URLRequest(url: url)
                request.httpMethod = "POST"
                request.timeoutInterval = 30
                request.cachePolicy = .reloadIgnoringLocalCacheData
                request.httpShouldHandleCookies = false
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                let task = session.uploadTask(with: request, fromFile: uploadURL)
                task.taskDescription = payload.snapshotId.uuidString
                task.resume()
            }
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let snapshotId = task.taskDescription.flatMap(UUID.init(uuidString:))
        let response = task.response as? HTTPURLResponse
        let successfulStatus = response.map { (200..<300).contains($0.statusCode) } ?? false

        if let error {
            onFailure?("后台上传健康快照失败：\(error.localizedDescription)")
            return
        }
        guard successfulStatus, let snapshotId else {
            let statusCode = response?.statusCode ?? 0
            onFailure?("后台上传健康快照失败：Windows 返回 HTTP \(statusCode)")
            return
        }

        markDelivered(snapshotId)
        onSuccess?(snapshotId, Date())
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        backgroundEventsCompletionHandler?()
        backgroundEventsCompletionHandler = nil
    }
}

extension HealthBackgroundUploader: @preconcurrency URLSessionDelegate, @preconcurrency URLSessionTaskDelegate {}
