import Foundation

actor HealthOutbox {
    static let shared = HealthOutbox()

    private let fileManager: FileManager
    private let directoryURL: URL
    private let pendingURL: URL
    private let uploadsDirectoryURL: URL

    init(fileManager: FileManager = .default) {
        self.fileManager = fileManager
        let applicationSupport = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? fileManager.temporaryDirectory
        directoryURL = applicationSupport.appendingPathComponent("WinPlateHealth", isDirectory: true)
        pendingURL = directoryURL.appendingPathComponent("pendingSnapshot.json")
        uploadsDirectoryURL = directoryURL.appendingPathComponent("uploads", isDirectory: true)
    }

    func enqueue(_ payload: HealthSyncPayload) throws -> URL {
        try ensureDirectories()
        let data = try encoded(payload)
        try data.write(to: pendingURL, options: [.atomic])

        let uploadURL = uploadsDirectoryURL.appendingPathComponent(
            "snapshot-\(payload.snapshotId.uuidString).json"
        )
        try data.write(to: uploadURL, options: [.atomic])
        return uploadURL
    }

    func pendingSnapshot() throws -> HealthSyncPayload? {
        try ensureDirectories()
        guard fileManager.fileExists(atPath: pendingURL.path) else { return nil }
        return try JSONDecoder().decode(HealthSyncPayload.self, from: Data(contentsOf: pendingURL))
    }

    func uploadFileURL(for snapshotId: UUID) throws -> URL? {
        try ensureDirectories()
        let url = uploadsDirectoryURL.appendingPathComponent("snapshot-\(snapshotId.uuidString).json")
        return fileManager.fileExists(atPath: url.path) ? url : nil
    }

    func removeUploadFile(for snapshotId: UUID) throws {
        try ensureDirectories()
        let url = uploadsDirectoryURL.appendingPathComponent("snapshot-\(snapshotId.uuidString).json")
        guard fileManager.fileExists(atPath: url.path) else { return }
        try fileManager.removeItem(at: url)
    }

    func markDelivered(snapshotId: UUID) throws {
        try ensureDirectories()
        let uploadURL = uploadsDirectoryURL.appendingPathComponent("snapshot-\(snapshotId.uuidString).json")
        if fileManager.fileExists(atPath: uploadURL.path) {
            try fileManager.removeItem(at: uploadURL)
        }

        guard fileManager.fileExists(atPath: pendingURL.path) else { return }
        let pending = try JSONDecoder().decode(HealthSyncPayload.self, from: Data(contentsOf: pendingURL))
        guard pending.snapshotId == snapshotId else { return }
        try fileManager.removeItem(at: pendingURL)
    }

    func pendingCount() throws -> Int {
        try ensureDirectories()
        return fileManager.fileExists(atPath: pendingURL.path) ? 1 : 0
    }

    private func ensureDirectories() throws {
        try fileManager.createDirectory(at: directoryURL, withIntermediateDirectories: true)
        try fileManager.createDirectory(at: uploadsDirectoryURL, withIntermediateDirectories: true)
    }

    private func encoded(_ payload: HealthSyncPayload) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(payload)
    }
}
