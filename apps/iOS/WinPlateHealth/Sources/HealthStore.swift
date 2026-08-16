import Foundation
import Combine
import HealthKit

private struct HealthMetricValue {
    let value: Double?
    let sampleAt: Date?
}

@MainActor
final class HealthStore: ObservableObject {
    @Published private(set) var latestHeartRate: Double?
    @Published private(set) var stepCount: Double?
    @Published private(set) var activeEnergy: Double?
    @Published private(set) var isLoading = false
    @Published private(set) var hasRequestedAccess = UserDefaults.standard.bool(forKey: "winplate.health.requestedAccess")
    @Published private(set) var lastUpdated: Date?
    @Published private(set) var message: String?
    @Published private(set) var syncState: HealthPeerConnectionState = .idle
    @Published private(set) var lastSyncSentAt: Date?
    @Published private(set) var syncError: String?
    @Published private(set) var windowsEndpoint = WindowsHealthLink.savedEndpoint
    @Published private(set) var windowsSyncState: WindowsHealthSyncState = .notConfigured
    @Published private(set) var lastWindowsSyncSentAt: Date?
    @Published private(set) var desktopStatus = DesktopStatusSnapshot.empty
    @Published private(set) var lastDesktopStatusAt: Date?
    @Published private(set) var desktopStatusError: String?
    @Published private(set) var lastHealthKitObserverWakeAt: Date?
    @Published private(set) var pendingWindowsSnapshotCount = 0
    @Published private(set) var isHealthKitBackgroundSyncEnabled = false

    private let store = HKHealthStore()
    private let peerLink: HealthPeerLink
    private let backgroundCoordinator: HealthBackgroundCoordinator
    private let backgroundUploader = HealthBackgroundUploader.shared
    private var lastHeartRateSampleAt: Date?
    private var lastStepCountSampleAt: Date?
    private var lastActiveEnergySampleAt: Date?
    private var syncTask: Task<Void, Never>?
    private var desktopStatusTask: Task<Void, Never>?

    init() {
        peerLink = HealthPeerLink(
            role: .advertiser,
            displayName: ProcessInfo.processInfo.hostName
        )
        backgroundCoordinator = HealthBackgroundCoordinator(store: store)

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
        peerLink.onPayload = { [weak self] payload in
            guard let status = payload.desktopStatus else { return }
            DispatchQueue.main.async {
                self?.applyDesktopStatus(status)
            }
        }

        backgroundCoordinator.onDataChanged = { [weak self] reason, completionHandler in
            Task { @MainActor [weak self] in
                self?.lastHealthKitObserverWakeAt = Date()
                await self?.refresh(reason: reason)
                completionHandler()
            }
        }
        backgroundCoordinator.onError = { [weak self] error in
            self?.message = error
            self?.isHealthKitBackgroundSyncEnabled = false
        }
        backgroundUploader.onSuccess = { [weak self] _, date in
            self?.lastWindowsSyncSentAt = date
            self?.windowsSyncState = .connected
            self?.refreshPendingCount()
        }
        backgroundUploader.onFailure = { [weak self] error in
            self?.windowsSyncState = .error(error)
            self?.refreshPendingCount()
        }

        peerLink.start()
        if hasRequestedAccess {
            backgroundCoordinator.start()
        }
        isHealthKitBackgroundSyncEnabled = backgroundCoordinator.isRunning
        if !windowsEndpoint.isEmpty {
            backgroundUploader.resumePending(to: windowsEndpoint)
            startDesktopStatusPolling()
        }

        syncTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(30))
                guard !Task.isCancelled else { return }
                await self?.refresh(reason: .foregroundTimer)
            }
        }
    }

    deinit {
        syncTask?.cancel()
        desktopStatusTask?.cancel()
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
            UserDefaults.standard.set(true, forKey: "winplate.health.requestedAccess")
            backgroundCoordinator.start()
            isHealthKitBackgroundSyncEnabled = backgroundCoordinator.isRunning
            await refresh(reason: .appLaunch)
        } catch {
            message = "无法打开健康数据权限，请稍后重试。"
            isLoading = false
        }
    }

    func refresh() async {
        await refresh(reason: .manual)
    }

    func reconnectPeerIfNeeded() {
        peerLink.restartIfNeeded()
    }

    func refresh(reason: HealthRefreshReason) async {
        guard isHealthDataAvailable else {
            message = "当前设备不支持 Apple 健康数据。"
            return
        }

        let showsProgress = reason == .manual || reason == .appLaunch
        if showsProgress {
            isLoading = true
        }
        message = nil

        let heartRate = try? await latestHeartRateSample()
        let steps = try? await todayTotal(for: stepCountType, unit: .count())
        let energy = try? await todayTotal(for: activeEnergyType, unit: .kilocalorie())

        latestHeartRate = heartRate?.value
        stepCount = steps?.value
        activeEnergy = energy?.value
        lastHeartRateSampleAt = heartRate?.sampleAt ?? lastHeartRateSampleAt
        lastStepCountSampleAt = steps?.sampleAt ?? lastStepCountSampleAt
        lastActiveEnergySampleAt = energy?.sampleAt ?? lastActiveEnergySampleAt
        if heartRate?.value != nil || steps?.value != nil || energy?.value != nil {
            hasRequestedAccess = true
        }

        let sampleDates = [
            heartRate?.sampleAt ?? lastHeartRateSampleAt,
            steps?.sampleAt ?? lastStepCountSampleAt,
            energy?.sampleAt ?? lastActiveEnergySampleAt
        ].compactMap { $0 }
        lastUpdated = sampleDates.max()

        if latestHeartRate == nil && stepCount == nil && activeEnergy == nil {
            message = hasRequestedAccess
                ? "暂时没有可显示的健康记录，请确认“健康”中已允许 WinPlate 读取数据。"
                : "开启健康数据后，这里会显示本机的健康概览。"
        }

        if showsProgress {
            isLoading = false
        }
        sendCurrentSnapshot(reason: reason, heartRate: heartRate, steps: steps, energy: energy)
        await pollDesktopStatus()
    }

    func saveWindowsEndpoint(_ value: String) async {
        guard let endpoint = WindowsHealthLink.saveEndpoint(value) else {
            windowsSyncState = .error("Windows 地址无效，请粘贴健康页提供的完整地址。")
            return
        }
        windowsEndpoint = endpoint
        windowsSyncState = .sending
        await sendWindowsSnapshot(currentPayload(reason: .manual), to: endpoint)
        startDesktopStatusPolling()
        await pollDesktopStatus()
    }

    private func startDesktopStatusPolling() {
        guard desktopStatusTask == nil else { return }
        desktopStatusTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(60))
                guard !Task.isCancelled else { return }
                await self?.pollDesktopStatus()
            }
        }
    }

    private func pollDesktopStatus() async {
        guard !windowsEndpoint.isEmpty else { return }
        do {
            if let status = try await WindowsHealthLink.fetchDesktopStatus(from: windowsEndpoint) {
                applyDesktopStatus(status)
            }
        } catch {
            desktopStatusError = error.localizedDescription
        }
    }

    private func applyDesktopStatus(_ status: DesktopStatusSnapshot) {
        desktopStatus = status
        lastDesktopStatusAt = ISO8601DateFormatter().date(from: status.sentAt) ?? Date()
        desktopStatusError = nil
    }

    private func currentPayload(
        reason: HealthRefreshReason = .manual,
        heartRate: HealthMetricValue? = nil,
        steps: HealthMetricValue? = nil,
        energy: HealthMetricValue? = nil
    ) -> HealthSyncPayload {
        let heartRateValue = heartRate?.value ?? latestHeartRate
        let stepValue = steps?.value ?? stepCount
        let energyValue = energy?.value ?? activeEnergy
        let heartRateDate = heartRate?.sampleAt ?? lastHeartRateSampleAt
        let stepDate = steps?.sampleAt ?? lastStepCountSampleAt
        let energyDate = energy?.sampleAt ?? lastActiveEnergySampleAt
        let dates = [heartRateDate, stepDate, energyDate].compactMap { $0 }
        let updatedAt = dates.max() ?? lastUpdated

        return HealthSyncPayload(
            reason: reason,
            sender: ProcessInfo.processInfo.hostName,
            sentAt: Date(),
            healthUpdatedAt: updatedAt,
            permissionGranted: hasRequestedAccess,
            heartRate: heartRateValue,
            heartRateSampleAt: heartRateDate,
            stepCount: stepValue,
            stepCountSampleAt: stepDate,
            activeEnergy: energyValue,
            activeEnergySampleAt: energyDate
        )
    }

    private func sendCurrentSnapshot(
        reason: HealthRefreshReason = .manual,
        heartRate: HealthMetricValue? = nil,
        steps: HealthMetricValue? = nil,
        energy: HealthMetricValue? = nil
    ) {
        let payload = currentPayload(reason: reason, heartRate: heartRate, steps: steps, energy: energy)
        peerLink.send(payload)
        guard !windowsEndpoint.isEmpty else {
            windowsSyncState = .notConfigured
            return
        }

        windowsSyncState = .sending
        let endpoint = windowsEndpoint
        Task { @MainActor [weak self] in
            await self?.sendWindowsSnapshot(payload, to: endpoint)
        }
    }

    private func sendWindowsSnapshot(_ payload: HealthSyncPayload, to endpoint: String) async {
        await backgroundUploader.enqueue(payload, to: endpoint)
        do {
            try await WindowsHealthLink.send(payload, to: endpoint)
            backgroundUploader.markDelivered(payload.snapshotId)
            windowsSyncState = .connected
            lastWindowsSyncSentAt = Date()
            syncError = nil
        } catch {
            windowsSyncState = .error("Windows 同步失败：\(error.localizedDescription)")
        }
        refreshPendingCount()
    }

    private func refreshPendingCount() {
        Task { @MainActor [weak self] in
            guard let self else { return }
            pendingWindowsSnapshotCount = await backgroundUploader.pendingCount()
        }
    }

    private func latestHeartRateSample() async throws -> HealthMetricValue {
        let sample = try await latestQuantitySample(for: heartRateType, predicate: nil)
        guard let sample else { return HealthMetricValue(value: nil, sampleAt: nil) }
        let unit = HKUnit.count().unitDivided(by: .minute())
        return HealthMetricValue(
            value: sample.quantity.doubleValue(for: unit),
            sampleAt: sample.endDate
        )
    }

    private func todayTotal(for type: HKQuantityType, unit: HKUnit) async throws -> HealthMetricValue {
        let end = Date()
        let start = Calendar.current.startOfDay(for: end)
        let predicate = HKQuery.predicateForSamples(
            withStart: start,
            end: end,
            options: .strictStartDate
        )
        let total: Double? = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Double?, Error>) in
            let query = HKStatisticsQuery(
                quantityType: type,
                quantitySamplePredicate: predicate,
                options: .cumulativeSum
            ) { _, statistics, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                continuation.resume(returning: statistics?.sumQuantity()?.doubleValue(for: unit))
            }
            store.execute(query)
        }
        let latestSample = try await latestQuantitySample(for: type, predicate: predicate)
        return HealthMetricValue(value: total, sampleAt: latestSample?.endDate)
    }

    private func latestQuantitySample(
        for type: HKQuantityType,
        predicate: NSPredicate?
    ) async throws -> HKQuantitySample? {
        try await withCheckedThrowingContinuation { continuation in
            let sortDescriptor = NSSortDescriptor(
                key: HKSampleSortIdentifierEndDate,
                ascending: false
            )
            let query = HKSampleQuery(
                sampleType: type,
                predicate: predicate,
                limit: 1,
                sortDescriptors: [sortDescriptor]
            ) { _, samples, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                continuation.resume(returning: samples?.first as? HKQuantitySample)
            }
            store.execute(query)
        }
    }
}
