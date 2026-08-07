import Foundation
import Combine
import HealthKit

@MainActor
final class HealthStore: ObservableObject {
    @Published private(set) var latestHeartRate: Double?
    @Published private(set) var stepCount: Double?
    @Published private(set) var activeEnergy: Double?
    @Published private(set) var isLoading = false
    @Published private(set) var hasRequestedAccess = false
    @Published private(set) var lastUpdated: Date?
    @Published private(set) var message: String?
    @Published private(set) var syncState: HealthPeerConnectionState = .idle
    @Published private(set) var lastSyncSentAt: Date?
    @Published private(set) var syncError: String?
    @Published private(set) var windowsEndpoint = WindowsHealthLink.savedEndpoint
    @Published private(set) var windowsSyncState: WindowsHealthSyncState = .notConfigured
    @Published private(set) var lastWindowsSyncSentAt: Date?

    private let store = HKHealthStore()
    private let peerLink: HealthPeerLink
    private var syncTask: Task<Void, Never>?

    init() {
        peerLink = HealthPeerLink(
            role: .advertiser,
            displayName: ProcessInfo.processInfo.hostName
        )

        peerLink.onStateChange = { [weak self] state in
            DispatchQueue.main.async {
                self?.syncState = state
                self?.syncError = state.detail
                if state.isConnected {
                    self?.sendCurrentSnapshot()
                }
            }
        }
        peerLink.onPayloadSent = { [weak self] date in
            DispatchQueue.main.async {
                self?.lastSyncSentAt = date
                self?.syncError = nil
            }
        }

        peerLink.start()
        syncTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(30))
                guard !Task.isCancelled else { return }
                await self?.refresh()
            }
        }
    }

    deinit {
        syncTask?.cancel()
        peerLink.stop()
    }

    private var heartRateType: HKQuantityType {
        HKObjectType.quantityType(forIdentifier: .heartRate)!
    }

    private var stepCountType: HKQuantityType {
        HKObjectType.quantityType(forIdentifier: .stepCount)!
    }

    private var activeEnergyType: HKQuantityType {
        HKObjectType.quantityType(forIdentifier: .activeEnergyBurned)!
    }

    private var readTypes: Set<HKObjectType> {
        [heartRateType, stepCountType, activeEnergyType]
    }

    var isHealthDataAvailable: Bool {
        HKHealthStore.isHealthDataAvailable()
    }

    func requestAccess() async {
        guard isHealthDataAvailable else {
            message = "当前设备不支持 Apple 健康数据。"
            return
        }

        isLoading = true
        message = nil

        do {
            try await store.requestAuthorization(toShare: [], read: readTypes)
            hasRequestedAccess = true
            await refresh()
        } catch {
            message = "无法打开健康数据权限，请稍后重试。"
            isLoading = false
        }
    }

    func refresh() async {
        guard isHealthDataAvailable else {
            message = "当前设备不支持 Apple 健康数据。"
            return
        }

        isLoading = true
        message = nil

        let heartRate = try? await latestHeartRateSample()
        let steps = try? await todayTotal(for: stepCountType, unit: .count())
        let energy = try? await todayTotal(for: activeEnergyType, unit: .kilocalorie())

        latestHeartRate = heartRate
        stepCount = steps
        activeEnergy = energy
        if heartRate != nil || steps != nil || energy != nil {
            hasRequestedAccess = true
        }
        lastUpdated = (heartRate != nil || steps != nil || energy != nil) ? Date() : nil

        if heartRate == nil && steps == nil && energy == nil {
            message = hasRequestedAccess
                ? "暂时没有可显示的健康记录，请确认“健康”中已允许 WinPlate 读取数据。"
                : "开启健康数据后，这里会显示本机的健康概览。"
        }

        isLoading = false
        sendCurrentSnapshot()
    }

    func saveWindowsEndpoint(_ value: String) async {
        guard let endpoint = WindowsHealthLink.saveEndpoint(value) else {
            windowsSyncState = .error("Windows 地址无效，请粘贴健康页提供的完整地址。")
            return
        }
        windowsEndpoint = endpoint
        windowsSyncState = .sending
        await sendWindowsSnapshot(currentPayload(), to: endpoint)
    }

    private func currentPayload() -> HealthSyncPayload {
        HealthSyncPayload(
            schemaVersion: HealthSyncPayload.currentSchemaVersion,
            sender: ProcessInfo.processInfo.hostName,
            sentAt: Date(),
            healthUpdatedAt: lastUpdated,
            permissionGranted: hasRequestedAccess,
            heartRate: latestHeartRate,
            stepCount: stepCount,
            activeEnergy: activeEnergy
        )
    }

    private func sendCurrentSnapshot() {
        let payload = currentPayload()
        peerLink.send(payload)
        guard !windowsEndpoint.isEmpty else {
            windowsSyncState = .notConfigured
            return
        }
        windowsSyncState = .sending
        let endpoint = windowsEndpoint
        Task { [weak self] in
            await self?.sendWindowsSnapshot(payload, to: endpoint)
        }
    }

    private func sendWindowsSnapshot(_ payload: HealthSyncPayload, to endpoint: String) async {
        do {
            try await WindowsHealthLink.send(payload, to: endpoint)
            windowsSyncState = .connected
            lastWindowsSyncSentAt = Date()
        } catch {
            windowsSyncState = .error("Windows 同步失败：\(error.localizedDescription)")
        }
    }

    private func latestHeartRateSample() async throws -> Double? {
        try await withCheckedThrowingContinuation { continuation in
            let sortDescriptor = NSSortDescriptor(
                key: HKSampleSortIdentifierEndDate,
                ascending: false
            )
            let query = HKSampleQuery(
                sampleType: heartRateType,
                predicate: nil,
                limit: 1,
                sortDescriptors: [sortDescriptor]
            ) { _, samples, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }

                let sample = samples?.first as? HKQuantitySample
                let unit = HKUnit.count().unitDivided(by: .minute())
                continuation.resume(returning: sample?.quantity.doubleValue(for: unit))
            }
            store.execute(query)
        }
    }

    private func todayTotal(for type: HKQuantityType, unit: HKUnit) async throws -> Double? {
        let calendar = Calendar.current
        let start = calendar.startOfDay(for: Date())
        let predicate = HKQuery.predicateForSamples(
            withStart: start,
            end: Date(),
            options: .strictStartDate
        )

        return try await withCheckedThrowingContinuation { continuation in
            let query = HKStatisticsQuery(
                quantityType: type,
                quantitySamplePredicate: predicate,
                options: .cumulativeSum
            ) { _, statistics, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }

                continuation.resume(
                    returning: statistics?.sumQuantity()?.doubleValue(for: unit)
                )
            }
            store.execute(query)
        }
    }
}
