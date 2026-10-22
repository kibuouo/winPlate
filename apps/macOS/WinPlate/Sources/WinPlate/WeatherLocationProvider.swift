import CoreLocation
import Foundation

@MainActor
final class WeatherLocationProvider: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var pending: CheckedContinuation<CLLocationCoordinate2D, Error>?
    private var timeoutTask: Task<Void, Never>?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyKilometer
    }

    func currentLocation() async throws -> CLLocationCoordinate2D {
        guard pending == nil else { throw LocationFailure(message: "正在定位，请稍候") }
        return try await withCheckedThrowingContinuation { continuation in
            pending = continuation
            timeoutTask = Task { [weak self] in
                do { try await Task.sleep(for: .seconds(30)) } catch { return }
                self?.finish(.failure(LocationFailure(message: "定位超时，请检查定位服务和 Wi-Fi，或手动选择城市")))
            }
            requestIfAuthorized()
        }
    }

    private func requestIfAuthorized() {
        guard pending != nil else { return }
        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse:
            manager.requestLocation()
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        case .denied, .restricted:
            finish(.failure(LocationFailure(message: "请在系统设置的定位服务中允许 WinPlate 获取位置")))
        @unknown default:
            finish(.failure(LocationFailure(message: "系统定位服务暂不可用，请手动选择城市")))
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor [weak self] in self?.requestIfAuthorized() }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last, location.horizontalAccuracy >= 0 else { return }
        let coordinate = location.coordinate
        Task { @MainActor [weak self] in self?.finish(.success(coordinate)) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let message = error.localizedDescription
        Task { @MainActor [weak self] in self?.finish(.failure(LocationFailure(message: "Mac 定位失败：\(message)"))) }
    }

    private func finish(_ result: Result<CLLocationCoordinate2D, Error>) {
        guard let continuation = pending else { return }
        pending = nil
        timeoutTask?.cancel()
        timeoutTask = nil
        manager.stopUpdatingLocation()
        continuation.resume(with: result)
    }

    private struct LocationFailure: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }
}
