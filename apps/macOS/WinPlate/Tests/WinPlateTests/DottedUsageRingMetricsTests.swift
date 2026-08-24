import XCTest
@testable import WinPlate

final class DottedUsageRingMetricsTests: XCTestCase {
    func testFilledCountMapsClampsAndRejectsInvalidProgress() {
        XCTAssertEqual(DottedUsageRingMetrics.filledCount(progress: 0, total: 52), 0)
        XCTAssertEqual(DottedUsageRingMetrics.filledCount(progress: 50, total: 52), 26)
        XCTAssertEqual(DottedUsageRingMetrics.filledCount(progress: 100, total: 52), 52)
        XCTAssertEqual(DottedUsageRingMetrics.filledCount(progress: nil, total: 36), 0)
        XCTAssertEqual(DottedUsageRingMetrics.filledCount(progress: .nan, total: 36), 0)
        XCTAssertEqual(DottedUsageRingMetrics.filledCount(progress: .infinity, total: 36), 0)
        XCTAssertEqual(DottedUsageRingMetrics.filledCount(progress: 40, total: 0), 0)
        XCTAssertEqual(DottedUsageRingMetrics.filledCount(progress: -12, total: 40), 0)
        XCTAssertEqual(DottedUsageRingMetrics.filledCount(progress: 140, total: 40), 40)
    }
}
