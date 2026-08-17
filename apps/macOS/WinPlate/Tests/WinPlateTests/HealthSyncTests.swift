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
                icon: "100",
                alerts: [
                    DesktopWeatherAlert(title: "暴雨橙色预警", level: "warning", message: "今天下午到夜里有强降雨")
                ]
            ),
            github: DesktopGitHubSnapshot(
                status: "Live",
                username: "kibuouo",
                name: "Will",
                profileUrl: "https://github.com/kibuouo",
                commitsThisMonth: 42,
                streakDays: 8,
                contributions30d: [0, 1, 3],
                project: "winPlate"
            ),
            mail: DesktopMailSnapshot(status: "live", unreadCount: 4),
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
        XCTAssertEqual(decoded.desktopStatus?.weather?.alerts.first?.title, "暴雨橙色预警")
        XCTAssertEqual(decoded.desktopStatus?.github?.commitsThisMonth, 42)
        XCTAssertEqual(decoded.desktopStatus?.mail?.unreadCount, 4)
    }

    func testDesktopStatusMergeKeepsGitHubAndLiveMailWhenIncomingOmitsThem() {
        let existing = DesktopStatusSnapshot(
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
            github: DesktopGitHubSnapshot(
                status: "Live",
                username: "kibuouo",
                name: "Will",
                profileUrl: "https://github.com/kibuouo",
                commitsThisMonth: 42,
                streakDays: 8,
                contributions30d: [0, 1, 3],
                project: "winPlate"
            ),
            mail: DesktopMailSnapshot(status: "live", unreadCount: 4),
            codex: DesktopQuotaSnapshot(status: "Normal", remainingPct: 84, resetText: "6d 20h"),
            superGrok: DesktopQuotaSnapshot(status: "Unavailable", remainingPct: nil, resetText: nil),
            deepSeek: DesktopBalanceSnapshot(status: "Normal", currency: "CNY", balance: "12.34")
        )
        let incoming = DesktopStatusSnapshot(
            sender: "MacBook Pro",
            sentAt: "2026-08-16T10:01:00Z",
            weather: DesktopWeatherSnapshot(
                source: "qweather",
                location: "上海",
                condition: "多云",
                temperature: 26,
                feelsLike: 27,
                humidity: 70,
                icon: "101"
            ),
            github: nil,
            mail: DesktopMailSnapshot(status: "unavailable", unreadCount: 0),
            codex: DesktopQuotaSnapshot(status: "Normal", remainingPct: 80, resetText: "6d 19h"),
            superGrok: DesktopQuotaSnapshot(status: "Normal", remainingPct: 55, resetText: "4d"),
            deepSeek: DesktopBalanceSnapshot(status: "Normal", currency: "CNY", balance: "11.00")
        )

        let merged = DesktopStatusSnapshot.merging(incoming, onto: existing)

        XCTAssertEqual(merged.github?.username, "kibuouo")
        XCTAssertEqual(merged.github?.commitsThisMonth, 42)
        XCTAssertEqual(merged.mail?.status, "live")
        XCTAssertEqual(merged.mail?.unreadCount, 4)
        XCTAssertEqual(merged.codex?.remainingPct, 80)
        XCTAssertEqual(merged.superGrok?.remainingPct, 55)
        XCTAssertEqual(merged.deepSeek?.balance, "11.00")
        XCTAssertEqual(merged.weather?.condition, "多云")
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

    func testHeartRateHistoryMergesDistinctSamplesInsteadOfReplacingTheLatest() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let first = HeartRateHistoryPoint(date: now.addingTimeInterval(-120), bpm: 78)
        let second = HeartRateHistoryPoint(date: now.addingTimeInterval(-60), bpm: 92)
        let third = HeartRateHistoryPoint(date: now.addingTimeInterval(-30), bpm: 88)

        let result = HeartRateHistory.merging([first, second, third], into: [first], now: now)

        XCTAssertEqual(result, [first, second, third])
    }

    func testHeartRateSampleSeriesSurvivesDecodingAndBecomesHistoryPoints() throws {
        let now = Date(timeIntervalSince1970: 1_800_000_200)
        let samples = [
            HeartRateSample(sampleAt: now.addingTimeInterval(-180), heartRate: 74),
            HeartRateSample(sampleAt: now.addingTimeInterval(-90), heartRate: 81),
            HeartRateSample(sampleAt: now, heartRate: 86)
        ]
        let payload = HealthSyncPayload(
            schemaVersion: 2,
            sender: "iPhone",
            sentAt: now,
            healthUpdatedAt: now,
            permissionGranted: true,
            heartRate: 86,
            heartRateSampleAt: now,
            heartRateSamples: samples,
            stepCount: nil,
            activeEnergy: nil
        )

        let decoded = try JSONDecoder().decode(
            HealthSyncPayload.self,
            from: JSONEncoder().encode(payload)
        )

        XCTAssertEqual(decoded.heartRateSamples, samples)
        XCTAssertEqual(
            decoded.recordedHeartRatePoints.map(\.bpm),
            [74, 81, 86, 86]
        )
    }

    func testHeartRateHistoryStorePersistsMergedSamples() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("winplate-heart-rate-\(UUID().uuidString)", isDirectory: true)
        let url = directory.appendingPathComponent("health-heart-rate-history.json")
        defer { try? FileManager.default.removeItem(at: directory) }

        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let points = [
            HeartRateHistoryPoint(date: now.addingTimeInterval(-3_600), bpm: 70),
            HeartRateHistoryPoint(date: now.addingTimeInterval(-1_800), bpm: 84)
        ]

        HeartRateHistoryStore.save(points, to: url)
        let loaded = HeartRateHistoryStore.load(from: url, now: now)

        XCTAssertEqual(loaded, points)
    }
}
