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

    func testDesktopStatusRoundTripsAcrossThePeerLink() throws {
        let status = DesktopStatusSnapshot(
            sender: "MacBook Pro",
            sentAt: "2026-08-16T10:00:00Z",
            weather: DesktopWeatherSnapshot(
                source: "qweather",
                location: "上海",
                condition: "晴",
                temperature: 28,
                feelsLike: 30,
                humidity: 65,
                icon: "100"
            ),
            codex: DesktopQuotaSnapshot(status: "Normal", remainingPct: 84, resetText: "6d 20h"),
            superGrok: DesktopQuotaSnapshot(status: "Unavailable", remainingPct: nil, resetText: nil),
            deepSeek: DesktopBalanceSnapshot(status: "Normal", currency: "CNY", balance: "12.34")
        )
        let payload = HealthSyncPayload(
            schemaVersion: HealthSyncPayload.currentSchemaVersion,
            sender: "MacBook Pro",
            sentAt: Date(timeIntervalSince1970: 1_755_000_000),
            healthUpdatedAt: nil,
            permissionGranted: false,
            heartRate: nil,
            stepCount: nil,
            activeEnergy: nil,
            desktopStatus: status
        )

        let decoded = try JSONDecoder().decode(
            HealthSyncPayload.self,
            from: JSONEncoder().encode(payload)
        )

        XCTAssertEqual(decoded, payload)
        XCTAssertEqual(decoded.desktopStatus?.weather?.location, "上海")
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

    func testPeerPairingContextMatchesOnlyTheExpectedCode() {
        let code = "482917"
        let context = HealthPeerPairing.invitationContext(for: code)

        XCTAssertEqual(HealthPeerPairing.normalize(" 482 917 "), code)
        XCTAssertTrue(HealthPeerPairing.matches(context, expectedCode: code))
        XCTAssertFalse(HealthPeerPairing.matches(context, expectedCode: "000000"))
        XCTAssertFalse(HealthPeerPairing.matches(nil, expectedCode: code))
        XCTAssertNil(HealthPeerPairing.normalize("12345"))
        XCTAssertEqual(
            HealthPeerPairing.discoveryToken(for: code),
            HealthPeerPairing.discoveryToken(for: code)
        )
        XCTAssertNotEqual(
            HealthPeerPairing.discoveryToken(for: code),
            HealthPeerPairing.discoveryToken(for: "000000")
        )
    }

    func testSchema2HeartRateSampleDateSurvivesDecoding() throws {
        let sampleAt = Date(timeIntervalSince1970: 1_800_000_100)
        let payload = HealthSyncPayload(
            schemaVersion: 2,
            snapshotId: UUID(uuidString: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE")!,
            reason: .healthKitObserver,
            sender: "iPhone",
            sentAt: Date(timeIntervalSince1970: 1_800_000_200),
            healthUpdatedAt: Date(timeIntervalSince1970: 1_800_000_150),
            permissionGranted: true,
            heartRate: 91,
            heartRateSampleAt: sampleAt,
            stepCount: 1200,
            stepCountSampleAt: Date(timeIntervalSince1970: 1_800_000_050),
            activeEnergy: 88
        )

        let decoded = try JSONDecoder().decode(
            HealthSyncPayload.self,
            from: JSONEncoder().encode(payload)
        )

        XCTAssertEqual(decoded.schemaVersion, 2)
        XCTAssertEqual(decoded.heartRateSampleAt, sampleAt)
        XCTAssertEqual(decoded.reason, .healthKitObserver)
    }
}
