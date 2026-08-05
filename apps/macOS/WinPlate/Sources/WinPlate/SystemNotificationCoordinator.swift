import AppKit
import UserNotifications

@MainActor
final class SystemNotificationCoordinator: NSObject, UNUserNotificationCenterDelegate {
    private enum Action {
        static let markRead = "WINPLATE_MARK_READ"
        static let openSource = "WINPLATE_OPEN_SOURCE"
    }

    private static let knownIDsDefaultsKey = "system-notification-known-ids-v1"
    private weak var state: AppState?
    private var knownNotificationIDs: Set<String>?
    private let center = UNUserNotificationCenter.current()

    func configure(state: AppState) {
        self.state = state
        center.delegate = self
        center.setNotificationCategories([
            UNNotificationCategory(
                identifier: "WINPLATE_NOTIFICATION",
                actions: [
                    UNNotificationAction(identifier: Action.openSource, title: "打开来源"),
                    UNNotificationAction(identifier: Action.markRead, title: "标记已读"),
                ],
                intentIdentifiers: []
            ),
        ])
        if let stored = UserDefaults.standard.stringArray(forKey: Self.knownIDsDefaultsKey) {
            knownNotificationIDs = Set(stored)
        }
        center.requestAuthorization(options: [.alert, .badge, .sound]) { _, _ in }
    }

    func synchronize(_ summary: NotificationSummary) {
        let currentIDs = Set(summary.items.map(\.id))
        guard let knownNotificationIDs else {
            self.knownNotificationIDs = currentIDs
            persistKnownIDs(preferredOrder: summary.items.map(\.id))
            updateBadge(summary.unreadCount)
            return
        }

        for notification in summary.items where notification.unread && !knownNotificationIDs.contains(notification.id) {
            deliver(notification)
        }
        self.knownNotificationIDs = knownNotificationIDs.union(currentIDs)
        persistKnownIDs(preferredOrder: summary.items.map(\.id))
        updateBadge(summary.unreadCount)
    }

    private func persistKnownIDs(preferredOrder: [String]) {
        guard let knownNotificationIDs else { return }
        var ordered: [String] = []
        var seen: Set<String> = []
        for id in preferredOrder + Array(knownNotificationIDs) where seen.insert(id).inserted {
            ordered.append(id)
            if ordered.count == 500 { break }
        }
        UserDefaults.standard.set(ordered, forKey: Self.knownIDsDefaultsKey)
    }

    private func deliver(_ notification: AppNotification) {
        let content = UNMutableNotificationContent()
        content.title = notification.title
        content.body = notification.message
        content.threadIdentifier = notification.source
        content.categoryIdentifier = "WINPLATE_NOTIFICATION"
        content.userInfo = [
            "notificationID": notification.id,
            "source": notification.source,
        ]

        if notification.requiresAcknowledgement {
            content.interruptionLevel = .timeSensitive
            content.sound = .default
        } else {
            content.interruptionLevel = .passive
        }

        center.add(UNNotificationRequest(
            identifier: notification.id,
            content: content,
            trigger: nil
        ))
    }

    private func updateBadge(_ count: Int) {
        center.setBadgeCount(max(0, count))
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        let content = notification.request.content
        let source = content.userInfo["source"] as? String
        if source == "qweather", content.interruptionLevel == .timeSensitive {
            return [.banner, .sound]
        }
        return []
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        guard let notificationID = response.notification.request.content.userInfo["notificationID"] as? String else {
            return
        }
        let actionIdentifier = response.actionIdentifier
        await MainActor.run {
            if actionIdentifier == Action.markRead {
                state?.markNotificationRead(id: notificationID)
                return
            }
            if actionIdentifier == Action.openSource,
               let notification = state?.notifications.items.first(where: { $0.id == notificationID })
            {
                state?.openNotificationSource(notification)
                NotificationCenter.default.post(name: .showWinPlateMainWindow, object: nil)
                return
            }
            state?.selectedWorkspace = .notifications
            state?.selectedNotificationID = notificationID
            NotificationCenter.default.post(name: .showWinPlateMainWindow, object: nil)
        }
    }

    static func sendTestNotification() {
        let content = UNMutableNotificationContent()
        content.title = "WinPlate 测试通知"
        content.body = "系统通知与点击路由已正常配置。"
        content.interruptionLevel = .active
        UNUserNotificationCenter.current().add(UNNotificationRequest(
            identifier: "winplate-test-\(UUID().uuidString)",
            content: content,
            trigger: nil
        ))
    }
}
