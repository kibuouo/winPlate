import AppKit
import SwiftUI

struct NotificationsWorkspace: View {
    @EnvironmentObject private var state: AppState
    @State private var selectedSource = "all"
    @State private var selectedState = "all"

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
        .onChange(of: conversations.map(\.id)) { _, ids in
            if let selectedNotificationID = state.selectedNotificationID,
               !conversations.contains(where: { $0.memberIDs.contains(selectedNotificationID) })
            {
                state.selectedNotificationID = nil
            }
        }
        .onChange(of: state.selectedNotificationID) { _, notificationID in
            guard let notificationID,
                  let conversation = conversations.first(where: { $0.memberIDs.contains(notificationID) })
            else { return }
            state.selectedNotificationID = conversation.id
            selectedSource = "all"
            selectedState = "all"
        }
    }

    private var header: some View {
        let unreadConversationCount = conversations.filter(\.unread).count
        return PageHeader(
            title: "通知中心",
            subtitle: state.notificationError ?? "统一收纳邮件、天气预警和本地任务提示，帮助你快速理解变化并采取行动。"
        ) {
            HStack(spacing: 8) {
                Text("\(unreadConversationCount) 条未读")
                    .font(.caption.weight(.semibold).monospacedDigit())
                    .foregroundStyle(unreadConversationCount > 0 ? Color.accentColor : .secondary)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(Color.accentColor.opacity(0.12), in: Capsule())

                Button("全部标为已读") {
                    state.markAllNotificationsRead()
                }
                .buttonStyle(.bordered)
                .controlSize(.regular)
                .disabled(unreadConversationCount == 0)

                Button("清空已读") {
                    state.clearReadNotifications()
                }
                .buttonStyle(.bordered)
                .controlSize(.regular)
                .disabled(!conversations.contains { !$0.unread } || state.isClearingReadNotifications)

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
                    sourceChip("all", label: "全部", count: conversations.count)
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
                            conversations: group.conversations,
                            selectedNotificationID: $state.selectedNotificationID,
                            openNotification: { conversation in
                                state.openNotification(conversation)
                            }
                        )
                    }
                }
            }
        }
    }

    private var availableSources: [String] {
        let sources = conversations.map { $0.latest.source }
        let extras = Set(sources).subtracting(sourceOrder)
        return sourceOrder.filter { sources.contains($0) } + extras.sorted()
    }

    private var conversations: [NotificationConversation] {
        NotificationConversation.fold(state.notifications.items)
    }

    private var filteredItems: [NotificationConversation] {
        conversations
            .filter { selectedSource == "all" || $0.latest.source == selectedSource }
            .filter { selectedState == "all" || (selectedState == "unread" ? $0.unread : !$0.unread) }
            .sorted { $0.latest.createdAt > $1.latest.createdAt }
    }

    private var groupedItems: [NotificationGroup] {
        let groups = Dictionary(grouping: filteredItems) { dateLabel(for: $0.latest.createdAt) }
        return groups.map {
            NotificationGroup(
                title: $0.key,
                conversations: $0.value.sorted { $0.latest.createdAt > $1.latest.createdAt }
            )
        }
        .sorted {
            ($0.conversations.first?.latest.createdAt ?? 0) > ($1.conversations.first?.latest.createdAt ?? 0)
        }
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
        conversations.filter { $0.latest.source == source }.count
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
    let conversations: [NotificationConversation]
}

private struct NotificationTimelineGroup: View {
    let title: String
    let conversations: [NotificationConversation]
    @Binding var selectedNotificationID: String?
    let openNotification: (NotificationConversation) -> Void

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
                    ForEach(conversations) { conversation in
                        NotificationTimelineRow(
                            conversation: conversation,
                            isSelected: selectedNotificationID == conversation.id,
                            onTap: {
                                selectedNotificationID = selectedNotificationID == conversation.id ? nil : conversation.id
                                openNotification(conversation)
                            }
                        )
                    }
                }
            }
        }
    }
}

private struct NotificationTimelineRow: View {
    @EnvironmentObject private var state: AppState
    let conversation: NotificationConversation
    let isSelected: Bool
    let onTap: () -> Void

    private var notification: AppNotification { conversation.latest }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button(action: onTap) {
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
                            if conversation.unread {
                                Text("未读")
                                    .font(.caption2.weight(.semibold))
                                    .foregroundStyle(Color.accentColor)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(Color.accentColor.opacity(0.12), in: Capsule())
                            }
                            if conversation.updateCount > 1 {
                                Text("\(conversation.updateCount) 条更新")
                                    .font(.caption2.weight(.semibold))
                                    .foregroundStyle(.secondary)
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
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                    }
                }
            }
            .buttonStyle(.plain)

            if isSelected {
                Divider()
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 18) {
                        detailValue("来源", sourceLabel)
                        detailValue("状态", conversation.unread ? "未读" : "已读")
                        detailValue("级别", levelLabel)
                        Spacer()
                    }

                    if !notification.message.isEmpty {
                        Text(notification.message)
                            .font(.subheadline)
                            .textSelection(.enabled)
                    }

                    if conversation.updateCount > 1 {
                        VStack(alignment: .leading, spacing: 7) {
                            Text("本轮更新")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)
                            ForEach(conversation.updates) { update in
                                HStack(alignment: .top, spacing: 10) {
                                    Text(timeLabel(for: update.createdAt))
                                        .font(.caption2.monospacedDigit())
                                        .foregroundStyle(.tertiary)
                                        .frame(width: 52, alignment: .leading)
                                    Text(update.message.isEmpty ? update.title : update.message)
                                        .font(.caption)
                                        .textSelection(.enabled)
                                }
                            }
                        }
                    }

                    HStack {
                        Button("复制内容") {
                            NSPasteboard.general.clearContents()
                            NSPasteboard.general.setString(
                                [notification.title, notification.message]
                                    .filter { !$0.isEmpty }
                                    .joined(separator: "\n\n"),
                                forType: .string
                            )
                        }
                        .buttonStyle(.bordered)

                        if ["mail", "qweather", "github"].contains(notification.source)
                            || notification.resolvedExternalURL != nil
                        {
                            Button("打开来源") {
                                state.openNotificationSource(notification)
                            }
                                .buttonStyle(.borderedProminent)
                        }
                        Spacer()
                    }
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(isSelected ? Color.accentColor.opacity(0.09) : Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(isSelected ? Color.accentColor.opacity(0.3) : Color.secondary.opacity(0.12), lineWidth: 1))
        .accessibilityLabel("\(sourceLabel)，\(notification.title)，\(conversation.unread ? "未读" : "已读")")
    }

    private func detailValue(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.tertiary)
            Text(value)
                .font(.caption)
        }
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
        // Unified 3-way labels: 信息 | 预警 | 危险 (matches Windows).
        switch notification.displaySeverity {
        case "danger": return "危险"
        case "warning": return "预警"
        default: return "信息"
        }
    }

    private var levelColor: Color {
        switch notification.displaySeverity {
        case "danger": return .red
        case "warning": return .orange
        // Emerald-style info treatment matching Windows digest strip.
        default: return Color(red: 0.06, green: 0.73, blue: 0.51)
        }
    }

    private var timeLabel: String {
        timeLabel(for: notification.createdAt)
    }

    private func timeLabel(for timestamp: Int64) -> String {
        let raw = TimeInterval(timestamp)
        let date = Date(timeIntervalSince1970: raw > 10_000_000_000 ? raw / 1000 : raw)
        return date.formatted(date: .omitted, time: .shortened)
    }
}
