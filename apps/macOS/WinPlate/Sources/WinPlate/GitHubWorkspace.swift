import AppKit
import SwiftUI

struct GitHubWorkspace: View {
    @EnvironmentObject private var state: AppState

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                PageHeader(
                    title: "GitHub",
                    subtitle: "贡献热力图与近期维护的仓库。"
                ) {
                    NativeRefreshButton(
                        title: "同步 GitHub",
                        isRefreshing: state.isRefreshingGitHub
                    ) {
                        state.refreshGitHub()
                    }
                }

                if let github = state.snapshot.github, github.isAvailable {
                    GitHubProfileBar(github: github)

                    if let message = github.stateMessage, !message.isEmpty {
                        Label(message, systemImage: "exclamationmark.triangle.fill")
                            .font(.caption)
                            .foregroundStyle(.orange)
                            .padding(12)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }

                    GitHubContributionSection(github: github)
                    GitHubMaintainedRepositoriesSection(repositories: github.repositories, fallbackProject: github)
                } else {
                    ContentUnavailableView(
                        "尚未同步 GitHub",
                        systemImage: "chevron.left.forwardslash.chevron.right",
                        description: Text("同步后将显示贡献热力图与维护中的仓库。")
                    )
                    .frame(maxWidth: .infinity, minHeight: 280)
                }
            }
            .padding(28)
        }
        .background(Color(nsColor: .controlBackgroundColor).opacity(0.28))
        .onAppear {
            if state.selectedGitHubMonthKey == nil {
                state.selectedGitHubMonthKey = state.snapshot.github?.contributionMonths.last?.key
            }
            if let key = state.selectedGitHubMonthKey {
                Task { await state.loadGitHubContributionDetail(month: key) }
            }
        }
    }
}

// MARK: - Profile

private struct GitHubProfileBar: View {
    let github: GitHubSnapshot

    var body: some View {
        HStack(spacing: 16) {
            AsyncImage(url: URL(string: github.avatarUrl)) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().scaledToFill()
                default:
                    Image(systemName: "person.crop.circle.fill")
                        .font(.system(size: 28))
                        .foregroundStyle(.secondary)
                }
            }
            .frame(width: 56, height: 56)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .background(.quaternary, in: RoundedRectangle(cornerRadius: 14, style: .continuous))

            VStack(alignment: .leading, spacing: 4) {
                Text(github.name).font(.title2.weight(.bold))
                Text(github.username).foregroundStyle(.secondary)
            }

            Spacer(minLength: 12)

            HStack(spacing: 22) {
                GitHubMetric(value: "\(github.repos)", label: "仓库")
                GitHubMetric(value: "\(github.followers)", label: "关注者")
                GitHubMetric(value: "\(github.streakDays)", label: "连续天")
                GitHubMetric(value: "\(github.commitsThisMonth)", label: "本月贡献")
            }

            if let url = URL(string: github.profileUrl), !github.profileUrl.isEmpty {
                Link(destination: url) {
                    Label("打开主页", systemImage: "arrow.up.right")
                        .font(.subheadline.weight(.semibold))
                }
                .buttonStyle(.bordered)
            }
        }
        .padding(18)
        .background(.quaternary.opacity(0.55), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

// MARK: - Contribution heatmap

private struct GitHubContributionSection: View {
    @EnvironmentObject private var state: AppState
    let github: GitHubSnapshot

    private var months: [GitHubContributionMonth] { github.contributionMonths }
    private var selectedIndex: Int {
        guard let key = state.selectedGitHubMonthKey,
              let index = months.firstIndex(where: { $0.key == key })
        else { return max(0, months.count - 1) }
        return index
    }
    private var selectedMonth: GitHubContributionMonth? {
        guard !months.isEmpty else { return nil }
        return months[selectedIndex]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let month = selectedMonth {
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("贡献热力图")
                            .font(.headline)
                        Text("\(month.commits) 次贡献 · \(month.label)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    monthNavigation
                }

                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: 18) {
                        contributionCalendarColumn(month: month, github: github)
                        GitHubContributionActivityPanel(
                            detail: state.githubContributionDetail,
                            isLoading: state.isLoadingGitHubContributionDetail,
                            error: state.githubContributionError,
                            selectedDateKey: state.selectedGitHubDateKey,
                            onClearDate: { state.clearGitHubDateSelection() }
                        )
                        .frame(minWidth: 240, idealWidth: 280, maxWidth: 320)
                    }
                    VStack(alignment: .leading, spacing: 16) {
                        contributionCalendarColumn(month: month, github: github)
                        GitHubContributionActivityPanel(
                            detail: state.githubContributionDetail,
                            isLoading: state.isLoadingGitHubContributionDetail,
                            error: state.githubContributionError,
                            selectedDateKey: state.selectedGitHubDateKey,
                            onClearDate: { state.clearGitHubDateSelection() }
                        )
                    }
                }
            } else {
                ContentUnavailableView(
                    "暂无贡献数据",
                    systemImage: "calendar",
                    description: Text("同步 GitHub 后将显示近 12 个月贡献热力图。")
                )
                .frame(maxWidth: .infinity, minHeight: 180)
            }
        }
        .padding(18)
        .background(.quaternary.opacity(0.45), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    @ViewBuilder
    private func contributionCalendarColumn(month: GitHubContributionMonth, github: GitHubSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            GitHubYearHeatmap(months: months, selectedKey: state.selectedGitHubMonthKey) { key in
                state.selectGitHubMonth(key)
            }
            GitHubMonthCalendar(
                month: month,
                selectedDateKey: state.selectedGitHubDateKey
            ) { dateKey in
                state.selectGitHubDate(dateKey)
            }
            HStack(spacing: 18) {
                GitHubStatChip(value: "\(month.commits)", label: "本月贡献")
                GitHubStatChip(value: "\(month.activeDays)", label: "活跃天")
                GitHubStatChip(value: "\(month.peakDaily)", label: "单日峰值")
                GitHubStatChip(value: "\(github.streakDays)", label: "连续天")
                Spacer()
                contributionLegend
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var monthNavigation: some View {
        HStack(spacing: 8) {
            Button {
                guard selectedIndex > 0 else { return }
                state.selectGitHubMonth(months[selectedIndex - 1].key)
            } label: {
                Image(systemName: "chevron.left")
            }
            .disabled(selectedIndex <= 0)

            Button("今天") {
                if let last = months.last {
                    state.selectGitHubMonth(last.key)
                }
            }
            .buttonStyle(.bordered)

            Button {
                guard selectedIndex < months.count - 1 else { return }
                state.selectGitHubMonth(months[selectedIndex + 1].key)
            } label: {
                Image(systemName: "chevron.right")
            }
            .disabled(selectedIndex >= months.count - 1)
        }
        .buttonStyle(.borderless)
    }

    private var contributionLegend: some View {
        HStack(spacing: 4) {
            Text("少").font(.caption2).foregroundStyle(.secondary)
            ForEach(0..<5, id: \.self) { level in
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .fill(GitHubContributionPalette.color(for: level))
                    .frame(width: 11, height: 11)
            }
            Text("多").font(.caption2).foregroundStyle(.secondary)
        }
    }
}

/// Compact 12-month strip heatmap (one cell per day), GitHub-green levels.
private struct GitHubYearHeatmap: View {
    let months: [GitHubContributionMonth]
    let selectedKey: String?
    let onSelectMonth: (String) -> Void

    private let cell: CGFloat = 9
    private let gap: CGFloat = 2

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("近 12 个月")
                .font(.subheadline.weight(.semibold))
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 10) {
                    ForEach(months) { month in
                        Button {
                            onSelectMonth(month.key)
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                LazyVGrid(
                                    columns: Array(
                                        repeating: GridItem(.fixed(cell), spacing: gap),
                                        count: 7
                                    ),
                                    spacing: gap
                                ) {
                                    ForEach(Array(month.levels.enumerated()), id: \.offset) { _, level in
                                        RoundedRectangle(cornerRadius: 2, style: .continuous)
                                            .fill(GitHubContributionPalette.color(for: level))
                                            .frame(width: cell, height: cell)
                                    }
                                }
                                Text(shortMonthLabel(month.key))
                                    .font(.system(size: 10, weight: selectedKey == month.key ? .bold : .regular))
                                    .foregroundStyle(selectedKey == month.key ? Color.primary : Color.secondary)
                            }
                            .padding(6)
                            .background(
                                selectedKey == month.key
                                    ? Color.accentColor.opacity(0.12)
                                    : Color.clear,
                                in: RoundedRectangle(cornerRadius: 8, style: .continuous)
                            )
                        }
                        .buttonStyle(.plain)
                        .help("\(month.label)：\(month.commits) 次贡献")
                    }
                }
            }
        }
    }

    private func shortMonthLabel(_ key: String) -> String {
        let parts = key.split(separator: "-")
        guard parts.count == 2, let month = Int(parts[1]) else { return key }
        return "\(month)月"
    }
}

private struct GitHubMonthCalendar: View {
    let month: GitHubContributionMonth
    let selectedDateKey: String?
    let onSelectDay: (String) -> Void

    private let weekdays = ["一", "二", "三", "四", "五", "六", "日"]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(GitHubContributionFormatting.localizedLabel(rangeType: "month", rangeKey: month.key))
                    .font(.subheadline.weight(.semibold))
                Spacer()
                if selectedDateKey != nil {
                    Text("点击已选日期可返回整月")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                } else {
                    Text("点击日期查看提交明细")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }

            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: 7), spacing: 4) {
                ForEach(weekdays, id: \.self) { day in
                    Text(day)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity)
                }
                ForEach(calendarCells) { cell in
                    if cell.isPlaceholder {
                        Color.clear.frame(height: 30)
                    } else {
                        let isSelected = selectedDateKey == cell.dateKey
                        Button {
                            onSelectDay(cell.dateKey)
                        } label: {
                            ZStack {
                                RoundedRectangle(cornerRadius: 6, style: .continuous)
                                    .fill(GitHubContributionPalette.color(for: cell.level))
                                RoundedRectangle(cornerRadius: 6, style: .continuous)
                                    .strokeBorder(
                                        isSelected ? Color.accentColor : Color.clear,
                                        lineWidth: 2
                                    )
                                Text("\(cell.day)")
                                    .font(.system(size: 11, weight: isSelected ? .bold : .semibold, design: .rounded))
                                    .foregroundStyle(cell.level >= 3 ? Color.white : Color.primary.opacity(0.85))
                            }
                            .frame(height: 30)
                            .scaleEffect(isSelected ? 1.04 : 1)
                        }
                        .buttonStyle(.plain)
                        .help("\(cell.count) 次贡献 · \(cell.dateKey)")
                        .accessibilityLabel("\(cell.dateKey)，\(cell.count) 次贡献")
                        .accessibilityAddTraits(isSelected ? .isSelected : [])
                    }
                }
            }
        }
    }

    private var calendarCells: [CalendarCell] {
        guard let first = firstWeekdayOffset else {
            return month.levels.enumerated().map { index, level in
                CalendarCell(
                    id: "\(month.key)-\(index)",
                    day: index + 1,
                    dateKey: String(format: "%@-%02d", month.key, index + 1),
                    level: level,
                    count: month.counts.indices.contains(index) ? month.counts[index] : 0,
                    isPlaceholder: false
                )
            }
        }
        var cells: [CalendarCell] = (0..<first).map {
            CalendarCell(id: "pad-\($0)", day: 0, dateKey: "", level: 0, count: 0, isPlaceholder: true)
        }
        for (index, level) in month.levels.enumerated() {
            cells.append(
                CalendarCell(
                    id: "\(month.key)-\(index)",
                    day: index + 1,
                    dateKey: String(format: "%@-%02d", month.key, index + 1),
                    level: level,
                    count: month.counts.indices.contains(index) ? month.counts[index] : 0,
                    isPlaceholder: false
                )
            )
        }
        return cells
    }

    private var firstWeekdayOffset: Int? {
        let parts = month.key.split(separator: "-")
        guard parts.count == 2,
              let year = Int(parts[0]),
              let monthNumber = Int(parts[1])
        else { return nil }
        var components = DateComponents()
        components.year = year
        components.month = monthNumber
        components.day = 1
        guard let date = Calendar(identifier: .gregorian).date(from: components) else { return nil }
        // Monday-first: Sunday=1 → 6, Monday=2 → 0, …
        let weekday = Calendar(identifier: .gregorian).component(.weekday, from: date)
        return (weekday + 5) % 7
    }
}

private struct CalendarCell: Identifiable {
    let id: String
    let day: Int
    let dateKey: String
    let level: Int
    let count: Int
    let isPlaceholder: Bool
}

private struct GitHubContributionActivityPanel: View {
    let detail: GitHubContributionDetail
    let isLoading: Bool
    let error: String?
    let selectedDateKey: String?
    let onClearDate: () -> Void

    private var maxRepoCount: Int {
        detail.repositories.map(\.count).max() ?? 0
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("提交明细")
                        .font(.subheadline.weight(.semibold))
                    Text(detail.displayLabel.isEmpty ? "选择月份或日期" : detail.displayLabel)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                if selectedDateKey != nil {
                    Button("整月", action: onClearDate)
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                        .help("清除日期选择，返回整月汇总")
                }
            }

            HStack(spacing: 10) {
                Image(systemName: "arrow.triangle.branch")
                    .font(.title3)
                    .foregroundStyle(.green)
                    .frame(width: 28, height: 28)
                    .background(Color.green.opacity(0.12), in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text(detail.summaryText)
                        .font(.subheadline.weight(.semibold))
                        .fixedSize(horizontal: false, vertical: true)
                    if isLoading {
                        Text("正在加载仓库明细…")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    } else if detail.detailsAvailable {
                        Text("已按仓库拆分")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            Divider()

            if isLoading && detail.repositories.isEmpty {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("加载中…").font(.caption).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, minHeight: 120, alignment: .leading)
            } else if detail.totalCount == 0 {
                ContentUnavailableView {
                    Label("无提交", systemImage: "calendar.badge.minus")
                } description: {
                    Text(detail.isDateRange ? "这一天没有提交贡献。" : "本月暂无提交贡献。")
                }
                .frame(maxWidth: .infinity, minHeight: 120)
            } else if !detail.repositories.isEmpty {
                ScrollView {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(detail.repositories) { repo in
                            GitHubContributionRepositoryRow(
                                repository: repo,
                                total: max(detail.totalCount, 1),
                                peak: max(maxRepoCount, 1)
                            )
                        }
                    }
                }
                .frame(maxWidth: .infinity, minHeight: 140, maxHeight: 280, alignment: .topLeading)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    Text("共 \(detail.totalCount) 次提交")
                        .font(.subheadline.weight(.semibold))
                    Text(statusMessage)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, minHeight: 120, alignment: .topLeading)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(.background.opacity(0.55), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private var statusMessage: String {
        if let error, !error.isEmpty { return error }
        if !detail.message.isEmpty { return detail.message }
        if !detail.detailsAvailable {
            return "仓库级明细需要已配置的 GitHub Token。总数来自本地日历缓存，不会猜测仓库分布。"
        }
        return "该时段暂无按仓库汇总的提交明细。"
    }
}

private struct GitHubContributionRepositoryRow: View {
    let repository: GitHubContributionRepository
    let total: Int
    let peak: Int

    private var share: Double {
        guard total > 0 else { return 0 }
        return min(1, Double(repository.count) / Double(total))
    }

    private var bar: Double {
        guard peak > 0 else { return 0 }
        return min(1, Double(repository.count) / Double(peak))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                if let url = URL(string: repository.url), !repository.url.isEmpty {
                    Link(destination: url) {
                        Text(repository.shortName)
                            .font(.caption.weight(.semibold))
                            .lineLimit(1)
                    }
                    .help(repository.nameWithOwner)
                } else {
                    Text(repository.shortName)
                        .font(.caption.weight(.semibold))
                        .lineLimit(1)
                        .help(repository.nameWithOwner)
                }
                Spacer(minLength: 4)
                Text("\(repository.count)")
                    .font(.caption.monospacedDigit().weight(.semibold))
                    .foregroundStyle(.secondary)
                Text(String(format: "%.0f%%", share * 100))
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.tertiary)
                    .frame(width: 34, alignment: .trailing)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.primary.opacity(0.06))
                    Capsule()
                        .fill(Color.green.opacity(0.75))
                        .frame(width: max(4, geo.size.width * bar))
                }
            }
            .frame(height: 5)
        }
    }
}

// MARK: - Maintained repositories

private struct GitHubMaintainedRepositoriesSection: View {
    let repositories: [GitHubRepository]
    let fallbackProject: GitHubSnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("维护的仓库")
                        .font(.headline)
                    Text(repositories.isEmpty ? "展示最近推送的公开仓库" : "按最近推送排序，优先非 fork")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Text("\(displayRepositories.count)")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
            }

            if displayRepositories.isEmpty {
                ContentUnavailableView(
                    "暂无仓库",
                    systemImage: "shippingbox",
                    description: Text("同步后将列出你维护的公开仓库。")
                )
                .frame(maxWidth: .infinity, minHeight: 120)
            } else {
                LazyVGrid(
                    columns: [GridItem(.adaptive(minimum: 240), spacing: 12)],
                    spacing: 12
                ) {
                    ForEach(displayRepositories) { repo in
                        GitHubRepositoryCard(repository: repo)
                    }
                }
            }
        }
        .padding(18)
        .background(.quaternary.opacity(0.45), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var displayRepositories: [GitHubRepository] {
        if !repositories.isEmpty { return repositories }
        // Backward-compatible fallback when older API payloads lack repositories[]
        guard fallbackProject.project != "--", !fallbackProject.project.isEmpty else { return [] }
        return [
            GitHubRepository(
                name: fallbackProject.project,
                fullName: fallbackProject.project,
                description: "",
                language: fallbackProject.language,
                stars: fallbackProject.stars,
                forks: 0,
                url: fallbackProject.profileUrl,
                pushedAt: "",
                isPrivate: false,
                isFork: false
            )
        ]
    }
}

private struct GitHubRepositoryCard: View {
    let repository: GitHubRepository

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: repository.isFork ? "arrow.triangle.branch" : "shippingbox.fill")
                    .foregroundStyle(.secondary)
                if let url = URL(string: repository.url), !repository.url.isEmpty {
                    Link(repository.name, destination: url)
                        .font(.headline)
                        .lineLimit(1)
                } else {
                    Text(repository.name)
                        .font(.headline)
                        .lineLimit(1)
                }
                Spacer(minLength: 4)
                if repository.isPrivate {
                    Text("Private")
                        .font(.caption2.weight(.semibold))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(.quaternary, in: Capsule())
                }
                if repository.isFork {
                    Text("Fork")
                        .font(.caption2.weight(.semibold))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(.quaternary, in: Capsule())
                }
            }

            Text(repository.description.isEmpty ? "暂无描述" : repository.description)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)
                .frame(maxWidth: .infinity, minHeight: 28, alignment: .topLeading)

            HStack(spacing: 12) {
                Label(repository.language, systemImage: "circle.fill")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .symbolRenderingMode(.hierarchical)
                Label("\(repository.stars)", systemImage: "star")
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.secondary)
                Label("\(repository.forks)", systemImage: "arrow.triangle.branch")
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.secondary)
                Spacer()
                if let relative = relativePushedAt(repository.pushedAt) {
                    Text(relative)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
        }
        .padding(14)
        .background(.background.opacity(0.55), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func relativePushedAt(_ value: String) -> String? {
        guard !value.isEmpty else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var date = formatter.date(from: value)
        if date == nil {
            formatter.formatOptions = [.withInternetDateTime]
            date = formatter.date(from: value)
        }
        guard let date else { return nil }
        let relative = RelativeDateTimeFormatter()
        relative.unitsStyle = .short
        return "推送 \(relative.localizedString(for: date, relativeTo: Date()))"
    }
}

// MARK: - Shared chrome

struct GitHubMetric: View {
    let value: String
    let label: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.title3.monospacedDigit().weight(.semibold))
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
    }
}

private struct GitHubStatChip: View {
    let value: String
    let label: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.headline.monospacedDigit())
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(.background.opacity(0.55), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

enum GitHubContributionPalette {
    static func color(for level: Int) -> Color {
        switch max(0, min(4, level)) {
        case 0: return Color(nsColor: .quaternaryLabelColor).opacity(0.22)
        case 1: return Color(red: 0.61, green: 0.91, blue: 0.64)
        case 2: return Color(red: 0.25, green: 0.75, blue: 0.39)
        case 3: return Color(red: 0.15, green: 0.58, blue: 0.27)
        default: return Color(red: 0.09, green: 0.37, blue: 0.17)
        }
    }
}

// Fallback initializer for repositories synthesized from legacy snapshot fields.
extension GitHubRepository {
    init(
        name: String,
        fullName: String,
        description: String,
        language: String,
        stars: Int,
        forks: Int,
        url: String,
        pushedAt: String,
        isPrivate: Bool,
        isFork: Bool
    ) {
        self.name = name
        self.fullName = fullName
        self.description = description
        self.language = language
        self.stars = stars
        self.forks = forks
        self.url = url
        self.pushedAt = pushedAt
        self.isPrivate = isPrivate
        self.isFork = isFork
    }
}
