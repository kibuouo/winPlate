import XCTest
@testable import WinPlate

final class GrokTokenUsageTests: XCTestCase {
    func testAggregatesPromptGrowthIntoHourlyAndDailyBuckets() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let now = date("2026-08-05T15:30:00Z")
        let lines = [
            updateLine(timestamp: "2026-08-04T23:15:00Z", prompt: "p1", tokens: 1000),
            updateLine(timestamp: "2026-08-04T23:16:00Z", prompt: "p1", tokens: 2500),
            updateLine(timestamp: "2026-08-05T15:00:00Z", prompt: "p2", tokens: 80),
            updateLine(timestamp: "2026-08-05T15:05:00Z", prompt: "p2", tokens: 80),
            "{\"not\":\"a session update\"}",
        ]

        let usage = GrokTokenUsageReader.parse(lines: lines, now: now, calendar: calendar)

        XCTAssertTrue(usage.isAvailable)
        XCTAssertEqual(usage.hourly.count, 17)
        XCTAssertEqual(usage.daily.count, 2)
        // p1 growth 2500-1000=1500; p2 single/no-growth falls back to peak 80
        XCTAssertEqual(usage.hourly.first?.tokens, 1500)
        XCTAssertEqual(usage.hourly.last?.tokens, 80)
        XCTAssertEqual(usage.daily.first?.tokens, 1500)
        XCTAssertEqual(usage.daily.last?.tokens, 80)
        XCTAssertEqual(usage.totalTokens, 1580)
    }

    func testKeepsMaxPerPromptAndIgnoresOldSamplesBeforeCutoff() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let now = date("2026-08-05T12:00:00Z")
        let cutoff = Int64(date("2026-08-05T00:00:00Z").timeIntervalSince1970)
        let lines = [
            updateLine(timestamp: "2026-08-04T10:00:00Z", prompt: "old", tokens: 9999),
            updateLine(timestamp: "2026-08-05T10:00:00Z", prompt: "p", tokens: 200),
            updateLine(timestamp: "2026-08-05T10:30:00Z", prompt: "p", tokens: 500),
            updateLine(timestamp: "2026-08-05T10:20:00Z", prompt: "p", tokens: 300),
        ]

        let usage = GrokTokenUsageReader.parse(
            lines: lines,
            cutoff: cutoff,
            now: now,
            calendar: calendar
        )

        XCTAssertTrue(usage.isAvailable)
        XCTAssertEqual(usage.totalTokens, 300) // 500 - 200
        XCTAssertEqual(usage.hourly.count, 3) // 10:00, 11:00, 12:00 hour starts
        XCTAssertEqual(usage.hourly.first?.tokens, 300)
    }

    func testReturnsUnavailableWhenNoPromptsWereRecorded() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!

        let usage = GrokTokenUsageReader.parse(
            lines: [],
            now: date("2026-08-05T15:30:00Z"),
            calendar: calendar
        )

        XCTAssertFalse(usage.isAvailable)
        XCTAssertTrue(usage.hourly.isEmpty)
        XCTAssertTrue(usage.daily.isEmpty)
    }

    private func updateLine(timestamp: String, prompt: String, tokens: Int64) -> String {
        let ts = Int64(date(timestamp).timeIntervalSince1970)
        return """
        {"timestamp":\(ts),"method":"session/update","params":{"sessionId":"s","update":{"sessionUpdate":"agent_message_chunk"},"_meta":{"totalTokens":\(tokens),"promptId":"\(prompt)"}}}
        """
    }

    private func date(_ value: String) -> Date {
        ISO8601DateFormatter().date(from: value)!
    }
}
