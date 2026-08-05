import XCTest
@testable import WinPlate

final class CodexTokenUsageTests: XCTestCase {
    func testAggregatesFinalTurnTotalsIntoHourlyAndDailyBuckets() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let now = date("2026-08-05T15:30:00Z")
        let lines = [
            logLine("2026-08-04T23:15:00Z", turn: "turn-b", tokens: 180),
            logLine("2026-08-04T23:16:00Z", turn: "turn-b", tokens: 250),
            logLine("2026-08-05T15:00:00Z", turn: "turn-c", tokens: 80),
            "not-a-log-line"
        ]

        let usage = CodexTokenUsageReader.parse(lines: lines, now: now, calendar: calendar)

        XCTAssertTrue(usage.isAvailable)
        XCTAssertEqual(usage.hourly.count, 17)
        XCTAssertEqual(usage.daily.count, 2)
        XCTAssertEqual(usage.hourly.first?.tokens, 250)
        XCTAssertEqual(usage.hourly.last?.tokens, 80)
        XCTAssertEqual(usage.daily.first?.tokens, 250)
        XCTAssertEqual(usage.daily.last?.tokens, 80)
        XCTAssertEqual(usage.totalTokens, 330)
    }

    func testReturnsUnavailableWhenNoTurnsWereRecorded() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!

        let usage = CodexTokenUsageReader.parse(
            lines: [],
            now: date("2026-08-05T15:30:00Z"),
            calendar: calendar
        )

        XCTAssertFalse(usage.isAvailable)
        XCTAssertTrue(usage.hourly.isEmpty)
        XCTAssertTrue(usage.daily.isEmpty)
    }

    private func logLine(_ timestamp: String, turn: String, tokens: Int64) -> String {
        "\(Int64(date(timestamp).timeIntervalSince1970))\tsession turn_id=\(turn) total_usage_tokens=\(tokens)"
    }

    private func date(_ value: String) -> Date {
        ISO8601DateFormatter().date(from: value)!
    }
}
