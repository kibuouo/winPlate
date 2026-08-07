import Foundation
import HealthKit

@MainActor
final class HealthBackgroundCoordinator {
    typealias ObserverCompletion = () -> Void

    private let store: HKHealthStore
    private var observerQueries = [HKObserverQuery]()
    private var registeredIdentifiers = Set<String>()

    var onDataChanged: ((HealthRefreshReason, @escaping ObserverCompletion) -> Void)?
    var onError: ((String) -> Void)?
    private(set) var lastObserverWakeAt: Date?
    private(set) var isRunning = false

    init(store: HKHealthStore) {
        self.store = store
    }

    func start() {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        isRunning = true
        registerObserver(for: .heartRate)
        registerObserver(for: .stepCount)
        registerObserver(for: .activeEnergyBurned)
    }

    private func registerObserver(for identifier: HKQuantityTypeIdentifier) {
        guard let type = HKObjectType.quantityType(forIdentifier: identifier) else { return }
        if registeredIdentifiers.insert(identifier.rawValue).inserted {
            let query = HKObserverQuery(sampleType: type, predicate: nil) { [weak self] _, completionHandler, error in
                DispatchQueue.main.async {
                    guard let self else {
                        completionHandler()
                        return
                    }

                    if let error {
                        self.onError?("HealthKit 后台通知失败：\(error.localizedDescription)")
                        completionHandler()
                        return
                    }

                    self.lastObserverWakeAt = Date()
                    if let onDataChanged = self.onDataChanged {
                        onDataChanged(.healthKitObserver, completionHandler)
                    } else {
                        completionHandler()
                    }
                }
            }

            observerQueries.append(query)
            store.execute(query)
        }

        store.enableBackgroundDelivery(for: type, frequency: .immediate) { [weak self] success, error in
            guard !success || error != nil else { return }
            DispatchQueue.main.async {
                let detail = error?.localizedDescription ?? "系统没有启用后台健康数据投递"
                self?.onError?("无法启用 \(identifier.rawValue) 后台同步：\(detail)")
            }
        }
    }
}
