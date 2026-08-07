import XCTest
@testable import WinPlate

final class HealthSyncTests: XCTestCase {
    func testHealthSnapshotRoundTripsAcrossThePeerLink() throws {
        let sentAt = Date(timeIntervalSince1970: 1_725_000_000)
        let updatedAt = Date(timeIntervalSince1970: 1_724_999_900)
        let payload = HealthSyncPayload(
            schemaVersion: HealthSyncPayload.currentSchemaVersion,
            sender: "iPhone",
            sentAt: sentAt,
            healthUpdatedAt: updatedAt,
            permissionGranted: true,
            heartRate: 86,
            stepCount: 8_765,
            activeEnergy: 412.5
        )

        let data = try JSONEncoder().encode(payload)
        let decoded = try JSONDecoder().decode(HealthSyncPayload.self, from: data)

        XCTAssertEqual(decoded, payload)
    }

    func testSearchingStateExplainsHowToReconnect() {
        let state = HealthPeerConnectionState.searching

        XCTAssertEqual(state.title, "搜索 iPhone")
        XCTAssertTrue(state.detail.contains("WinPlate Health"))
        XCTAssertFalse(state.isConnected)
    }

    func testHeartRateHistoryReplacesDuplicateSampleAndDropsExpiredPoints() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let expired = HeartRateHistoryPoint(
            date: now.addingTimeInterval(-HeartRateHistory.retention - 1),
            bpm: 72
        )
        let sampleDate = now.addingTimeInterval(-60)
        let first = HeartRateHistoryPoint(date: sampleDate, bpm: 84)
        let replacement = HeartRateHistoryPoint(date: sampleDate, bpm: 86)

        let once = HeartRateHistory.appending(expired, to: [], now: now)
        let twice = HeartRateHistory.appending(first, to: once, now: now)
        let result = HeartRateHistory.appending(replacement, to: twice, now: now)

        XCTAssertEqual(result, [replacement])
    }
}
