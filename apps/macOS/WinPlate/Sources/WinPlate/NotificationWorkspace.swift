import SwiftUI

struct NotificationsWorkspace: View {
    @EnvironmentObject private var state: AppState
    @State private var selectedSource = "all"
    @State private var selectedState = "all"
    @State private var selectedNotificationID: String?

    private let sourceOrder = ["mail", "qweather", "codex", "chatgpt", "github", "system", "external"]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header
                filters
                timeline
            }
            .padding(28)
        }
        .background(Color(nsColor: .windowBackgroundColor))
        .onChange(of: state.notifications.items.map(\.id)) { _, ids in
            if let selectedNotificationID, !ids.contains(selectedNotificationID) {
                self.selectedNotificationID = nil
            }
        }
    }

    private var header: some View {
        PageHeader(
            title: "通知中心",
            subtitle: "统一收纳邮件、天气预警和本地任务提示，帮助你快速理解变化并采取行动。"
        ) {
            HStack(spacing: 8) {
                Text("\(state.notifications.unreadCount) 条未读")
                    .font(.caption.weight(.semibold).monospacedDigit())
                    .foregroundStyle(state.notifications.unreadCount > 0 ? Color.accentColor : .secondary)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(Color.accentColor.opacity(0.12), in: Capsule())

                Button("全部标为已读") {
                    state.markAllNotificationsRead()
                }
                .buttonStyle(.bordered)
                .controlSize(.regular)
                .disabled(state.notifications.unreadCount == 0)

                NativeRefreshButton(title: "刷新通知", isRefreshing: state.isRefreshingNotifications) {
                    state.loadNotifications()
                }
            }
        }
    }

    private var filters: some View {
        VStack(alignment: .leading, spacing: 12) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    sourceChip("all", label: "全部", count: state.notifications.items.count)
                    ForEach(availableSources, id: \.self) { source in
                        sourceChip(source, label: sourceLabel(source), count: sourceCount(source))
                    }
                }
            }

            HStack(spacing: 12) {
                Picker("显示", selection: $selectedState) {
                    Text("全部").tag("all")
                    Text("未读").tag("unread")
                    Text("已读").tag("read")
                }
                .pickerStyle(.menu)
                .labelsHidden()
                .frame(width: 100, alignment: .leading)

                Spacer()
                Label("最新优先", systemImage: "arrow.down")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var timeline: some View {
        Group {
            if filteredItems.isEmpty {
                ContentUnavailableView(
                    selectedState == "unread" ? "没有未读通知" : "没有通知",
                    systemImage: "bell.slash",
                    description: Text(selectedSource == "all" ? "本机 API 产生的状态和服务提醒会显示在这里。" : "切换来源或状态筛选后再试。")
                )
                .frame(maxWidth: .infinity, minHeight: 260)
            } else {
                VStack(alignment: .leading, spacing: 24) {
                    ForEach(groupedItems, id: \.title) { group in
                        NotificationTimelineGroup(
                            title: group.title,
                            items: group.items,
                            selectedNotificationID: $selectedNotificationID,
                            markRead: { notification in
                                state.markNotificationRead(notification)
                            }
                        )
                    }
                }
            }
        }
    }

    private var availableSources: [String] {
        let extras = Set(state.notifications.items.map(\.source)).subtracting(sourceOrder)
        return sourceOrder.filter { source in state.notifications.items.contains { $0.source == source } } + extras.sorted()
    }

    private var filteredItems: [AppNotification] {
        state.notifications.items
            .filter { selectedSource == "all" || $0.source == selectedSource }
            .filter { selectedState == "all" || (selectedState == "unread" ? $0.unread : !$0.unread) }
            .sorted { $0.createdAt > $1.createdAt }
    }

    private var groupedItems: [NotificationGroup] {
        let groups = Dictionary(grouping: filteredItems) { dateLabel(for: $0.createdAt) }
        return groups.map { NotificationGroup(title: $0.key, items: $0.value.sorted { $0.createdAt > $1.createdAt }) }
            .sorted { ($0.items.first?.createdAt ?? 0) > ($1.items.first?.createdAt ?? 0) }
    }

    private func sourceChip(_ source: String, label: String, count: Int) -> some View {
        let isSelected = selectedSource == source
        return Button {
            selectedSource = source
        } label: {
            HStack(spacing: 6) {
                Image(systemName: sourceIcon(source))
                    .font(.caption.weight(.semibold))
                Text(label)
                Text("\(count)")
                    .font(.caption2.monospacedDigit())
                    .opacity(0.72)
            }
            .padding(.horizontal, 11)
            .padding(.vertical, 7)
            .foregroundStyle(isSelected ? Color.white : Color.primary)
            .background(isSelected ? Color.accentColor : Color(nsColor: .controlBackgroundColor), in: Capsule())
            .overlay(Capsule().stroke(isSelected ? Color.clear : Color.secondary.opacity(0.2), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("筛选\(label)，\(count) 条")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private func sourceCount(_ source: String) -> Int {
        state.notifications.items.filter { $0.source == source }.count
    }

    private func sourceLabel(_ source: String) -> String {
        switch source {
        case "mail": return "邮件"
        case "qweather": return "天气"
        case "codex": return "Codex"
        case "chatgpt": return "ChatGPT"
        case "github": return "GitHub"
        case "system": return "系统"
        case "external": return "WinPlate"
        default: return source.capitalized
        }
    }

    private func sourceIcon(_ source: String) -> String {
        switch source {
        case "mail": return "envelope.fill"
        case "qweather": return "cloud.sun.fill"
        case "codex": return "terminal.fill"
        case "chatgpt": return "sparkles"
        case "github": return "chevron.left.forwardslash.chevron.right"
        case "system": return "gearshape.fill"
        default: return "bell.fill"
        }
    }

    private func dateLabel(for timestamp: Int64) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.dateFormat = "yyyy年M月d日 EEEE"
        return formatter.string(from: notificationDate(timestamp))
    }

    private func notificationDate(_ timestamp: Int64) -> Date {
        let value = TimeInterval(timestamp)
        return Date(timeIntervalSince1970: value > 10_000_000_000 ? value / 1000 : value)
    }
}

private struct NotificationGroup {
    let title: String
    let items: [AppNotification]
}

private struct NotificationTimelineGroup: View {
    let title: String
    let items: [AppNotification]
    @Binding var selectedNotificationID: String?
    let markRead: (AppNotification) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.headline)
                .foregroundStyle(.secondary)

            HStack(alignment: .top, spacing: 10) {
                VStack(spacing: 0) {
                    Circle()
                        .fill(Color.accentColor.opacity(0.6))
                        .frame(width: 8, height: 8)
                        .padding(.top, 19)
                    Rectangle()
                        .fill(Color.secondary.opacity(0.2))
                        .frame(width: 1)
                        .frame(maxHeight: .infinity)
                }
                .frame(width: 20)

                VStack(spacing: 8) {
                    ForEach(items) { notification in
                        NotificationTimelineRow(
                            notification: notification,
                            isSelected: selectedNotificationID == notification.id,
                            onTap: {
                                selectedNotificationID = selectedNotificationID == notification.id ? nil : notification.id
                                if notification.unread { markRead(notification) }
                            }
                        )
                    }
                }
            }
        }
    }
}

private struct NotificationTimelineRow: View {
    let notification: AppNotification
    let isSelected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: sourceIcon)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(levelColor)
                        .frame(width: 34, height: 34)
                        .background(levelColor.opacity(0.12), in: RoundedRectangle(cornerRadius: 9, style: .continuous))

                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 7) {
                            Text(sourceLabel)
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(levelColor)
                            Text(levelLabel)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                            if notification.unread {
                                Text("未读")
                                    .font(.caption2.weight(.semibold))
                                    .foregroundStyle(Color.accentColor)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(Color.accentColor.opacity(0.12), in: Capsule())
                            }
                            Spacer(minLength: 8)
                            Text(timeLabel)
                                .font(.caption2.monospacedDigit())
                                .foregroundStyle(.tertiary)
                        }

                        Text(notification.title)
                            .font(.body.weight(.semibold))
                            .foregroundStyle(.primary)
                            .multilineTextAlignment(.leading)

                        Text(notification.message)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .lineLimit(isSelected ? nil : 2)
                            .multilineTextAlignment(.leading)
                    }
                }

                if isSelected {
                    Divider()
                    Text("点击通知后会同步到本机 API；当前状态：\(notification.unread ? "未读" : "已读")")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(isSelected ? Color.accentColor.opacity(0.09) : Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(isSelected ? Color.accentColor.opacity(0.3) : Color.secondary.opacity(0.12), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(sourceLabel)，\(notification.title)，\(notification.unread ? "未读" : "已读")")
    }

    private var sourceLabel: String {
        switch notification.source {
        case "mail": return "邮件"
        case "qweather": return "天气"
        case "codex": return "Codex"
        case "chatgpt": return "ChatGPT"
        case "github": return "GitHub"
        case "system": return "系统"
        case "external": return "WinPlate"
        default: return notification.source.capitalized
        }
    }

    private var sourceIcon: String {
        switch notification.source {
        case "mail": return "envelope.fill"
        case "qweather": return "cloud.sun.fill"
        case "codex": return "terminal.fill"
        case "chatgpt": return "sparkles"
        case "github": return "chevron.left.forwardslash.chevron.right"
        case "system": return "gearshape.fill"
        default: return "bell.fill"
        }
    }

    private var levelLabel: String {
        switch notification.level {
        case "success": return "完成"
        case "warning": return "提醒"
        case "critical": return "紧急"
        default: return "信息"
        }
    }

    private var levelColor: Color {
        switch notification.level {
        case "success": return .green
        case "warning": return .orange
        case "critical": return .red
        default: return .accentColor
        }
    }

    private var timeLabel: String {
        let raw = TimeInterval(notification.createdAt)
        let date = Date(timeIntervalSince1970: raw > 10_000_000_000 ? raw / 1000 : raw)
        return date.formatted(date: .omitted, time: .shortened)
    }
}
