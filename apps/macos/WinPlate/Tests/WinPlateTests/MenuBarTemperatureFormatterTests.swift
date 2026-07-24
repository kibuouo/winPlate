import XCTest
@testable import WinPlate

final class MenuBarTemperatureFormatterTests: XCTestCase {
    func testFormatsRoundedCelsiusTemperature() {
        XCTAssertEqual(MenuBarTemperatureFormatter.title(for: 25.6), "26°C")
        XCTAssertEqual(MenuBarTemperatureFormatter.title(for: -4.6), "-5°C")
    }

    func testClampsExtremeTemperatureToTwoDigits() {
        XCTAssertEqual(MenuBarTemperatureFormatter.title(for: 140), "99°C")
        XCTAssertEqual(MenuBarTemperatureFormatter.title(for: -140), "-99°C")
    }

    func testUsesPlaceholderForMissingOrMalformedTemperature() {
        XCTAssertEqual(MenuBarTemperatureFormatter.title(for: nil), "--°")
        XCTAssertEqual(MenuBarTemperatureFormatter.title(for: .nan), "--°")
        XCTAssertEqual(MenuBarTemperatureFormatter.title(for: .infinity), "--°")
    }

    func testDecodesWeatherForecastForTheMenuBarOverview() throws {
        let payload = """
        {
          "source": "qweather",
          "temperature": 35,
          "condition": "多云",
          "location": "江夏, 湖北",
          "icon": "101",
          "forecast": [
            {
              "date": "2026-07-24",
              "icon": "101",
              "condition": "多云",
              "tempMax": 35,
              "tempMin": 27
            }
          ]
        }
        """.data(using: .utf8)!

        let weather = try JSONDecoder().decode(WeatherSnapshot.self, from: payload)

        XCTAssertEqual(weather.forecast.count, 1)
        XCTAssertEqual(weather.forecast.first?.temperatureText, "27–35°")
    }

    func testDecodesQWeatherAlertSummary() throws {
        let payload = """
        {
          "source": "qweather",
          "alerts": [{
            "id": "alert-1",
            "title": "江夏高温橙色预警",
            "message": "请注意防暑降温。",
            "level": "warning",
            "lifecycle": "active",
            "createdAt": 1784880000000
          }],
          "updatedAt": 1784880000000
        }
        """.data(using: .utf8)!

        let summary = try JSONDecoder().decode(WeatherAlertSummary.self, from: payload)

        XCTAssertEqual(summary.alerts.first?.title, "江夏高温橙色预警")
        XCTAssertEqual(summary.alerts.first?.level, "warning")
    }

    func testMailOutlineRetainsLocalAPIFailureForDisplay() {
        let outline = MailOutline.unavailable(error: "本地服务不可用")

        XCTAssertEqual(outline.availability, "unavailable")
        XCTAssertTrue(outline.items.isEmpty)
        XCTAssertEqual(outline.error, "本地服务不可用")
    }

    func testDecodesMailConnectionResult() throws {
        let result = try JSONDecoder().decode(
            MailConnection.self,
            from: Data(#"{"connected":true}"#.utf8)
        )

        XCTAssertTrue(result.connected)
    }

    func testDecodesFailedMailConnectionResult() throws {
        let result = try JSONDecoder().decode(
            MailConnection.self,
            from: Data(#"{}"#.utf8)
        )

        XCTAssertFalse(result.connected)
    }
}
