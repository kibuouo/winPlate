import XCTest
@testable import WinPlate

final class MenuBarTemperatureFormatterTests: XCTestCase {
    func testSidebarPresentationMapsStoredVisibilityToSplitViewVisibility() {
        XCTAssertEqual(SidebarPresentation.visibility(isVisible: true), .all)
        XCTAssertEqual(SidebarPresentation.visibility(isVisible: false), .detailOnly)
        XCTAssertTrue(SidebarPresentation.isVisible(.all))
        XCTAssertTrue(SidebarPresentation.isVisible(.automatic))
        XCTAssertFalse(SidebarPresentation.isVisible(.detailOnly))
    }

    func testSidebarPresentationUsesStateSpecificAccessibleLabels() {
        XCTAssertEqual(SidebarPresentation.actionLabel(isVisible: true), "隐藏侧栏")
        XCTAssertEqual(SidebarPresentation.actionLabel(isVisible: false), "显示侧栏")
    }

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

    func testUsesQWeatherIconCodeOrFallbackAsset() {
        XCTAssertEqual(MenuBarWeatherIcon.filename(for: "101"), "101")
        XCTAssertEqual(MenuBarWeatherIcon.filename(for: "2204"), "2204")
        XCTAssertEqual(MenuBarWeatherIcon.filename(for: "sunny"), "999")
        XCTAssertEqual(MenuBarWeatherIcon.filename(for: nil), "999")
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

    func testDecodesWindowsWeatherDashboardFields() throws {
        let payload = """
        {
          "source": "qweather",
          "temperature": "35",
          "feelsLike": 37,
          "condition": "小雨",
          "location": "江夏, 湖北",
          "icon": "305",
          "humidity": "81",
          "precipitation": "0.3",
          "precipitationProbability": 75,
          "visibility": 12,
          "cloudCover": 84,
          "windSpeed": 18,
          "windDegrees": 135,
          "windDirection": "东南风",
          "windScale": "3",
          "weatherSummary": "今天白天阵雨，夜晚多云。",
          "minutelySummary": "50分钟后开始下小雨",
          "airQuality": {
            "aqi": 32,
            "display": "32",
            "category": "优"
          }
        }
        """.data(using: .utf8)!

        let weather = try JSONDecoder().decode(WeatherSnapshot.self, from: payload)

        XCTAssertEqual(weather.temperature, 35)
        XCTAssertEqual(weather.feelsLike, 37)
        XCTAssertEqual(weather.humidity, 81)
        XCTAssertEqual(weather.precipitation, 0.3)
        XCTAssertEqual(weather.precipitationProbability, 75)
        XCTAssertEqual(weather.airQuality?.summary, "32 · 优")
        XCTAssertEqual(WeatherAssets.scene(for: weather), .rain)
    }

    func testWeatherSceneFallsBackToCondition() {
        let weather = WeatherSnapshot(
            source: "qweather",
            temperature: 28,
            condition: "雷阵雨",
            location: "武汉",
            icon: "999"
        )

        XCTAssertEqual(WeatherAssets.scene(for: weather), .storm)
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

    func testDecodesMailMessageWithHTMLBody() throws {
        let payload = """
        {
          "uid": "42",
          "from": "Alice <alice@example.com>",
          "subject": "Weekly report",
          "textBody": "Hello plain",
          "htmlBody": "<html><head><style>.x{color:red}</style></head><body><p class=\\"x\\">Hello</p></body></html>",
          "to": "me@example.com",
          "date": "Mon, 27 Jul 2026 10:00:00 +0800",
          "unread": true
        }
        """
        let message = try JSONDecoder().decode(MailMessage.self, from: Data(payload.utf8))

        XCTAssertEqual(message.uid, "42")
        XCTAssertEqual(message.sender, "Alice <alice@example.com>")
        XCTAssertEqual(message.subject, "Weekly report")
        XCTAssertEqual(message.textBody, "Hello plain")
        XCTAssertTrue(message.hasHTMLBody)
        XCTAssertTrue(message.htmlBody.contains(".x{color:red}"))
        XCTAssertEqual(message.to, "me@example.com")
        XCTAssertTrue(message.unread)
    }

    func testDecodesMailMessageWithoutHTMLBody() throws {
        let payload = """
        {
          "uid": "7",
          "sender": "Bob",
          "subject": "Hi",
          "textBody": "plain only",
          "unread": false
        }
        """
        let message = try JSONDecoder().decode(MailMessage.self, from: Data(payload.utf8))

        XCTAssertEqual(message.sender, "Bob")
        XCTAssertEqual(message.htmlBody, "")
        XCTAssertFalse(message.hasHTMLBody)
        XCTAssertEqual(message.textBody, "plain only")
    }

    func testAppearanceThemeMatchesWindowsOptions() {
        XCTAssertEqual(AppearanceTheme.allCases.map(\.rawValue), ["light", "dark", "system"])
        XCTAssertEqual(AppearanceTheme.light.title, "浅色")
        XCTAssertEqual(AppearanceTheme.dark.title, "深色")
        XCTAssertEqual(AppearanceTheme.system.title, "系统")
        XCTAssertNil(AppearanceTheme.system.nsAppearance)
        XCTAssertEqual(AppearanceTheme.light.nsAppearance?.name, .aqua)
        XCTAssertEqual(AppearanceTheme.dark.nsAppearance?.name, .darkAqua)
    }

    func testDecodesGitHubSnapshotWithHeatmapAndRepositories() throws {
        let payload = """
        {
          "source": "github",
          "name": "kibuouo",
          "username": "@kibuouo",
          "profileUrl": "https://github.com/kibuouo",
          "avatarUrl": "https://avatars.githubusercontent.com/u/1?v=4",
          "repos": 4,
          "followers": 1,
          "project": "winPlate",
          "status": "Live",
          "language": "Swift",
          "stars": 2,
          "commitsThisMonth": 12,
          "streakDays": 3,
          "contributions30d": [0, 1, 2],
          "contributionMonth": "July",
          "contributionMonths": [{
            "key": "2026-07",
            "label": "July 2026",
            "commits": 12,
            "counts": [0, 4, 8],
            "levels": [0, 3, 4]
          }],
          "repositories": [{
            "name": "winPlate",
            "fullName": "kibuouo/winPlate",
            "description": "desktop workspace",
            "language": "Swift",
            "stars": 2,
            "forks": 0,
            "url": "https://github.com/kibuouo/winPlate",
            "pushedAt": "2026-07-25T00:00:00Z",
            "isPrivate": false,
            "isFork": false
          }]
        }
        """.data(using: .utf8)!

        let github = try JSONDecoder().decode(GitHubSnapshot.self, from: payload)

        XCTAssertEqual(github.username, "@kibuouo")
        XCTAssertEqual(github.commitsThisMonth, 12)
        XCTAssertEqual(github.contributionMonths.first?.activeDays, 2)
        XCTAssertEqual(github.repositories.first?.fullName, "kibuouo/winPlate")
        XCTAssertTrue(github.isAvailable)
    }

    func testDecodesGitHubContributionDetail() throws {
        let payload = """
        {
          "rangeType": "month",
          "rangeKey": "2026-07",
          "label": "July 2026",
          "totalCount": 10,
          "repositoryCount": 1,
          "repositories": [{
            "nameWithOwner": "kibuouo/winPlate",
            "url": "https://github.com/kibuouo/winPlate",
            "count": 10
          }],
          "detailsAvailable": true,
          "message": ""
        }
        """.data(using: .utf8)!

        let detail = try JSONDecoder().decode(GitHubContributionDetail.self, from: payload)

        XCTAssertEqual(detail.totalCount, 10)
        XCTAssertEqual(detail.repositories.first?.count, 10)
        XCTAssertEqual(detail.displayLabel, "2026年7月")
        XCTAssertEqual(detail.repositories.first?.shortName, "winPlate")
        XCTAssertTrue(detail.summaryText.contains("10"))
    }

    func testGitHubContributionFallbackUsesCalendarTotalsWithoutGuessingRepos() throws {
        let monthPayload = """
        {
          "key": "2026-07",
          "label": "July 2026",
          "commits": 12,
          "counts": [0, 4, 8],
          "levels": [0, 3, 4]
        }
        """.data(using: .utf8)!
        let month = try JSONDecoder().decode(GitHubContributionMonth.self, from: monthPayload)

        let day = GitHubContributionDetail.fallback(month: month, dateKey: "2026-07-02")
        XCTAssertEqual(day.rangeType, "date")
        XCTAssertEqual(day.totalCount, 4)
        XCTAssertTrue(day.repositories.isEmpty)
        XCTAssertFalse(day.detailsAvailable)
        XCTAssertEqual(day.displayLabel, "2026年7月2日")

        let wholeMonth = GitHubContributionDetail.fallback(month: month)
        XCTAssertEqual(wholeMonth.totalCount, 12)
        XCTAssertEqual(wholeMonth.displayLabel, "2026年7月")
    }

    func testGitHubContributionCacheKey() {
        XCTAssertEqual(GitHubContributionFormatting.cacheKey(date: "2026-07-24"), "date:2026-07-24")
        XCTAssertEqual(GitHubContributionFormatting.cacheKey(month: "2026-07"), "month:2026-07")
        XCTAssertNil(GitHubContributionFormatting.cacheKey())
    }

    func testNotificationDerivesMailSourceID() throws {
        let payload = """
        {
          "id": "mail:12345",
          "source": "mail",
          "level": "info",
          "title": "新邮件",
          "message": "sender@example.com",
          "unread": true,
          "createdAt": 1780000000000
        }
        """.data(using: .utf8)!

        let notification = try JSONDecoder().decode(AppNotification.self, from: payload)

        XCTAssertEqual(notification.sourceID, "12345")
    }

    func testNotificationRejectsMismatchedSourceID() throws {
        let payload = """
        {
          "id": "mail:12345",
          "source": "system",
          "level": "info",
          "title": "系统通知",
          "message": "",
          "unread": false,
          "createdAt": 1780000000000
        }
        """.data(using: .utf8)!

        let notification = try JSONDecoder().decode(AppNotification.self, from: payload)

        XCTAssertNil(notification.sourceID)
    }

    func testNotificationUsesStructuredSourceMetadata() throws {
        let payload = """
        {
          "id": "external:opaque",
          "source": "mail",
          "level": "info",
          "title": "新邮件",
          "message": "",
          "unread": true,
          "createdAt": 1780000000000,
          "externalUrl": "https://mail.qq.com/",
          "metadata": {
            "messageId": "67890"
          }
        }
        """.data(using: .utf8)!

        let notification = try JSONDecoder().decode(AppNotification.self, from: payload)

        XCTAssertEqual(notification.sourceID, "67890")
        XCTAssertEqual(notification.resolvedExternalURL?.host, "mail.qq.com")
    }

    func testFoldsDevelopmentNotificationsWithinFourHours() throws {
        let payload = """
        [
          {
            "id": "codex:latest",
            "source": "codex",
            "level": "success",
            "title": "  Build   WinPlate ",
            "message": "完成",
            "unread": false,
            "createdAt": 1780003600000
          },
          {
            "id": "codex:earlier",
            "source": "codex",
            "level": "info",
            "title": "build winplate",
            "message": "处理中",
            "unread": true,
            "createdAt": 1780000000000
          },
          {
            "id": "mail:1",
            "source": "mail",
            "level": "info",
            "title": "Build WinPlate",
            "message": "邮件",
            "unread": true,
            "createdAt": 1780000000000
          }
        ]
        """.data(using: .utf8)!

        let items = try JSONDecoder().decode([AppNotification].self, from: payload)
        let conversations = NotificationConversation.fold(items)

        XCTAssertEqual(conversations.count, 2)
        XCTAssertEqual(conversations.first?.updateCount, 2)
        XCTAssertEqual(conversations.first?.memberIDs, ["codex:latest", "codex:earlier"])
        XCTAssertTrue(conversations.first?.unread == true)
        XCTAssertEqual(conversations.last?.latest.id, "mail:1")
    }

    func testDoesNotFoldDevelopmentNotificationsOutsideFourHours() throws {
        let payload = """
        [
          {
            "id": "chatgpt:new",
            "source": "chatgpt",
            "level": "success",
            "title": "Review",
            "message": "完成",
            "unread": true,
            "createdAt": 1780020000000
          },
          {
            "id": "chatgpt:old",
            "source": "chatgpt",
            "level": "info",
            "title": "Review",
            "message": "开始",
            "unread": true,
            "createdAt": 1780000000000
          }
        ]
        """.data(using: .utf8)!

        let items = try JSONDecoder().decode([AppNotification].self, from: payload)

        XCTAssertEqual(NotificationConversation.fold(items).count, 2)
    }

    func testOnlyActiveRedWeatherAlertRequiresAcknowledgement() throws {
        let payload = """
        [
          {
            "id": "qweather:red-active",
            "source": "qweather",
            "level": "critical",
            "title": "红色预警",
            "message": "",
            "unread": true,
            "createdAt": 1780000000000,
            "metadata": {"severity": "red", "lifecycle": "issued"}
          },
          {
            "id": "qweather:red-resolved",
            "source": "qweather",
            "level": "success",
            "title": "红色预警解除",
            "message": "",
            "unread": true,
            "createdAt": 1780000000000,
            "metadata": {"severity": "red", "lifecycle": "resolved"}
          },
          {
            "id": "qweather:orange",
            "source": "qweather",
            "level": "critical",
            "title": "橙色预警",
            "message": "",
            "unread": true,
            "createdAt": 1780000000000,
            "metadata": {"severity": "severe", "lifecycle": "issued"}
          }
        ]
        """.data(using: .utf8)!

        let items = try JSONDecoder().decode([AppNotification].self, from: payload)

        XCTAssertTrue(items[0].requiresAcknowledgement)
        XCTAssertFalse(items[1].requiresAcknowledgement)
        XCTAssertFalse(items[2].requiresAcknowledgement)
    }
}
