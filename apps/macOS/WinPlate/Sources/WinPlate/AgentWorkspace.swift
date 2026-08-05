import AppKit
import SwiftUI

/// Sidebar workspace: ChatGPT (Codex remaining), DeepSeek balance, SuperGrok remaining (inverted from used).
struct AgentWorkspace: View {
    @EnvironmentObject private var state: AppState

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                PageHeader(
                    title: "Agent",
                    subtitle: "ChatGPT、DeepSeek、SuperGrok 的用量与额度（统一展示剩余）"
                ) {
                    NativeRefreshButton(title: "刷新用量", isRefreshing: state.isRefreshing) {
                        state.refresh(force: true)
                    }
                }

                if let codexItem = agentItems.first(where: { $0.id == "chatgpt" }) {
                    AgentQuotaCard(item: codexItem)
                }

                LazyVGrid(
                    columns: [
                        GridItem(.flexible(minimum: 240), spacing: 16),
                        GridItem(.flexible(minimum: 240), spacing: 16),
                    ],
                    spacing: 16
                ) {
                    ForEach(agentItems.filter { $0.id != "chatgpt" }) { item in
                        AgentQuotaCard(item: item)
                    }
                }

                if let error = [state.codexError, state.deepSeekError, state.superGrokError]
                    .compactMap({ $0 })
                    .first(where: { !$0.isEmpty })
                {
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .font(.subheadline)
                        .foregroundStyle(.orange)
                        .padding(14)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.orange.opacity(0.10), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
            }
            .padding(28)
            .frame(maxWidth: 1120, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .center)
        }
        .background(Color(nsColor: .windowBackgroundColor))
        .onAppear {
            state.refresh(force: false)
        }
    }

    private var agentItems: [AgentUsageItem] {
        AgentUsageItem.build(
            codex: state.codex,
            codexError: state.codexError,
            codexTokenUsage: state.codexTokenUsage,
            deepSeek: state.deepSeek,
            deepSeekError: state.deepSeekError,
            deepSeekUpdatedAt: state.deepSeekUpdatedAt,
            superGrok: state.superGrok,
            superGrokError: state.superGrokError,
            relativeTime: relativeTime
        )
    }

    private func relativeTime(_ date: Date) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}

// MARK: - Models

/// Pure assembly for agent quota rows (remaining polarity for ChatGPT / SuperGrok).
struct AgentUsageItem: Identifiable, Equatable {
    enum Polarity: String, Equatable {
        case remaining
        case balance
    }

    enum StatusKind: Equatable {
        case ok
        case warn
        case muted

        var color: Color {
            switch self {
            case .ok: return .green
            case .warn: return .orange
            case .muted: return .secondary
            }
        }
    }

    let id: String
    let name: String
    let symbol: String
    let via: String?
    let statusKind: StatusKind
    let statusText: String
    let primary: String
    let secondary: String
    let progress: Double?
    let polarity: Polarity
    let tint: Color
    let tokenUsage: CodexTokenUsage

    static func build(
        codex: UsageSnapshot,
        codexError: String?,
        codexTokenUsage: CodexTokenUsage = .unavailable,
        deepSeek: UsageSnapshot,
        deepSeekError: String?,
        deepSeekUpdatedAt: Date?,
        superGrok: UsageSnapshot,
        superGrokError: String?,
        relativeTime: (Date) -> String
    ) -> [AgentUsageItem] {
        let five = codex.fiveHour?.remainingPct
        let seven = codex.windows?.sevenDay?.remainingPct
        let chatPrimary = five.map { "\(Int($0.rounded()))%" } ?? "--%"
        var chatSecondaryParts: [String] = ["5h 剩余"]
        if let seven {
            chatSecondaryParts.append("7d 剩余 \(Int(seven.rounded()))%")
        }
        if let reset = codex.fiveHour?.resetText, !reset.isEmpty {
            chatSecondaryParts.append("重置 \(reset)")
        }
        if let codexError, !codex.isAvailable {
            chatSecondaryParts.append(codexError)
        }

        let deepPrimary = deepSeek.cnyBalance.map { "¥\($0)" } ?? "¥--"
        var deepSecondary = menuBarStatus(deepSeek.status)
        if let deepSeekUpdatedAt {
            deepSecondary += " · \(relativeTime(deepSeekUpdatedAt))"
        }
        if let deepSeekError, !deepSeek.isAvailable {
            deepSecondary = deepSeekError
        }

        let grokRemaining = superGrok.remainingPct
        let grokPrimary = grokRemaining.map { "\(Int($0.rounded()))%" } ?? "--%"
        var grokSecondary = "剩余"
        if let reset = superGrok.resetText, !reset.isEmpty {
            grokSecondary += " · 账期 \(reset)"
        }
        if let superGrokError, !superGrok.isAvailable {
            grokSecondary = superGrokError
        }

        return [
            AgentUsageItem(
                id: "chatgpt",
                name: "ChatGPT",
                symbol: "bubble.left.and.bubble.right.fill",
                via: "via Codex",
                statusKind: statusKind(codex),
                statusText: statusText(codex),
                primary: chatPrimary,
                secondary: chatSecondaryParts.joined(separator: " · "),
                progress: five,
                polarity: .remaining,
                tint: .blue,
                tokenUsage: codexTokenUsage
            ),
            AgentUsageItem(
                id: "deepseek",
                name: "DeepSeek",
                symbol: "sparkles",
                via: nil,
                statusKind: statusKind(deepSeek),
                statusText: statusText(deepSeek),
                primary: deepPrimary,
                secondary: deepSecondary,
                progress: nil,
                polarity: .balance,
                tint: .purple,
                tokenUsage: .unavailable
            ),
            AgentUsageItem(
                id: "supergrok",
                name: "SuperGrok",
                symbol: "bolt.fill",
                via: "via Grok CLI",
                statusKind: statusKind(superGrok),
                statusText: statusText(superGrok),
                primary: grokPrimary,
                secondary: grokSecondary,
                progress: grokRemaining,
                polarity: .remaining,
                tint: .orange,
                tokenUsage: .unavailable
            ),
        ]
    }

    private static func statusKind(_ usage: UsageSnapshot) -> StatusKind {
        switch usage.status {
        case "Normal": return .ok
        case "Unconfigured": return .muted
        default: return .warn
        }
    }

    private static func statusText(_ usage: UsageSnapshot) -> String {
        switch usage.status {
        case "Normal": return "正常"
        case "Unconfigured": return "未配置"
        default: return menuBarStatus(usage.status)
        }
    }
}

// MARK: - Cards

private struct AgentQuotaCard: View {
    let item: AgentUsageItem

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                Image(systemName: item.symbol)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(item.tint)
                    .frame(width: 30, height: 30)
                    .background(item.tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.name)
                        .font(.system(size: 13, weight: .bold, design: .rounded))
                    if let via = item.via {
                        Text(via)
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }
                Spacer(minLength: 8)
                AgentStatusPill(kind: item.statusKind, text: item.statusText)
            }

            Text(item.primary)
                .font(.system(size: 34, weight: .bold, design: .rounded).monospacedDigit())
                .foregroundStyle(item.statusKind == .muted ? Color.secondary : Color.primary)

            Text(item.secondary)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)

            if item.id == "chatgpt" {
                CodexTokenUsageCharts(usage: item.tokenUsage)
            }

            Spacer(minLength: 0)
        }
        .padding(18)
        .frame(maxWidth: .infinity, minHeight: item.id == "chatgpt" ? 390 : 200, alignment: .topLeading)
        .background {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(Color(nsColor: .windowBackgroundColor).opacity(0.88))
        }
        .overlay {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .strokeBorder(Color.primary.opacity(0.06))
        }
        .shadow(color: .black.opacity(0.05), radius: 16, y: 6)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(item.name)，\(item.statusText)，\(item.primary)，\(item.secondary)")
    }
}

private struct CodexTokenUsageCharts: View {
    private enum Granularity: String {
        case hour = "按小时"
        case day = "按天"
    }

    let usage: CodexTokenUsage
    @State private var selectedGranularity: Granularity = .hour

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Label("使用趋势", systemImage: "chart.line.uptrend.xyaxis")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.secondary)
                Spacer(minLength: 4)
                Picker("统计粒度", selection: $selectedGranularity) {
                    Text("按小时").tag(Granularity.hour)
                    Text("按天").tag(Granularity.day)
                }
                .labelsHidden()
                .pickerStyle(.segmented)
                .frame(width: 132)
                Text(usage.isAvailable ? summaryText : "暂无数据")
                    .font(.system(size: 10, weight: .medium, design: .rounded).monospacedDigit())
                    .foregroundStyle(.tertiary)
            }

            CodexTokenTrendChart(
                title: selectedGranularity.rawValue,
                buckets: selectedGranularity == .hour ? usage.hourly : usage.daily,
                tint: selectedGranularity == .hour ? .blue : .teal,
                showHourLabels: selectedGranularity == .hour
            )
        }
        .padding(12)
        .background(Color.primary.opacity(0.035), in: RoundedRectangle(cornerRadius: 13, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 13, style: .continuous)
                .strokeBorder(Color.primary.opacity(0.05))
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            usage.isAvailable
                ? "Codex Token 用量，\(selectedGranularity.rawValue)，\(summaryText)"
                : "Codex Token 用量暂无数据"
        )
    }

    private var summaryText: String {
        let buckets = selectedGranularity == .hour ? usage.hourly : usage.daily
        let total = selectedGranularity == .hour ? usage.hourlyTotalTokens : usage.totalTokens
        let unit = selectedGranularity == .hour ? "小时" : "天"
        return "共 \(buckets.count) \(unit) · \(formatTokenCount(total))"
    }
}

private struct CodexTokenTrendChart: View {
    let title: String
    let buckets: [CodexTokenUsage.Bucket]
    let tint: Color
    let showHourLabels: Bool

    private let chartHeight: CGFloat = 88
    private let horizontalInset: CGFloat = 4
    private let verticalAxisWidth: CGFloat = 32
    @State private var hoveredIndex: Int?

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(title)
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(.secondary)

            if buckets.isEmpty {
                HStack {
                    Spacer()
                    Text("暂无 Token 用量数据")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(.tertiary)
                    Spacer()
                }
                .frame(height: chartHeight + 23)
            } else {
                GeometryReader { geometry in
                    let plotOriginX = verticalAxisWidth + horizontalInset
                    let plotWidth = max(1, geometry.size.width - plotOriginX - horizontalInset)
                    let plotHeight = chartHeight
                    let maxTokens = max(1, buckets.map(\.tokens).max() ?? 0)

                    ZStack(alignment: .topLeading) {
                        ForEach([0.0, 0.5, 1.0], id: \.self) { fraction in
                            Text(yAxisLabel(for: fraction, maxTokens: maxTokens))
                                .font(.system(size: 8, weight: .medium, design: .rounded).monospacedDigit())
                                .foregroundStyle(.tertiary)
                                .position(
                                    x: verticalAxisWidth / 2,
                                    y: plotHeight * fraction
                                )
                        }

                        CodexTokenGridLines(
                            width: plotWidth,
                            height: plotHeight
                        )
                        .offset(x: plotOriginX)

                        CodexTokenTrendArea(
                            buckets: buckets,
                            maxTokens: maxTokens,
                            tint: tint,
                            width: plotWidth,
                            height: plotHeight
                        )
                        .offset(x: plotOriginX)

                        CodexTokenTrendLine(
                            buckets: buckets,
                            maxTokens: maxTokens,
                            tint: tint,
                            width: plotWidth,
                            height: plotHeight
                        )
                        .offset(x: plotOriginX)

                        if let hoveredIndex {
                            let hoveredBucket = buckets[hoveredIndex]
                            CodexTokenHoverGuide(
                                x: xPosition(for: hoveredIndex, width: plotWidth),
                                y: yPosition(for: hoveredBucket.tokens, maxTokens: maxTokens, height: plotHeight),
                                width: plotWidth,
                                height: plotHeight,
                                tint: tint
                            )
                            .offset(x: plotOriginX)

                            CodexTokenHoverCard(
                                date: tooltipDate(for: hoveredBucket.start),
                                tokens: hoveredBucket.tokens,
                                tint: tint
                            )
                            .position(
                                x: tooltipX(
                                    for: hoveredIndex,
                                    width: plotWidth,
                                    plotOriginX: plotOriginX,
                                    containerWidth: geometry.size.width
                                ),
                                y: 18
                            )
                        }

                        ForEach(labelIndexes, id: \.self) { index in
                            Text(label(for: buckets[index].start))
                                .font(.system(size: 8, weight: .medium, design: .rounded).monospacedDigit())
                                .foregroundStyle(.tertiary)
                                .lineLimit(1)
                                .position(
                                    x: plotOriginX + xPosition(for: index, width: plotWidth),
                                    y: plotHeight + 20
                                )
                        }
                    }
                    .contentShape(Rectangle())
                    .onContinuousHover(coordinateSpace: .local) { phase in
                        switch phase {
                        case .active(let location):
                            let x = min(max(location.x - plotOriginX, 0), plotWidth)
                            hoveredIndex = nearestIndex(for: x, width: plotWidth)
                        case .ended:
                            hoveredIndex = nil
                        }
                    }
                }
                .frame(height: chartHeight + 32)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var labelIndexes: [Int] {
        guard !buckets.isEmpty else { return [] }
        let labelCount = min(6, buckets.count)
        guard labelCount > 1 else { return [0] }
        return (0..<labelCount).map { index in
            Int((Double(index) * Double(buckets.count - 1) / Double(labelCount - 1)).rounded())
        }
    }

    private func label(for date: Date) -> String {
        let calendar = Calendar.current
        let month = calendar.component(.month, from: date)
        let day = calendar.component(.day, from: date)
        guard showHourLabels, buckets.count <= 48 else { return "\(month)/\(day)" }
        return String(
            format: "%02d:%02d",
            calendar.component(.hour, from: date),
            calendar.component(.minute, from: date)
        )
    }

    private func xPosition(for index: Int, width: CGFloat) -> CGFloat {
        buckets.count == 1 ? width / 2 : width * CGFloat(index) / CGFloat(buckets.count - 1)
    }

    private func yPosition(for tokens: Int64, maxTokens: Int64, height: CGFloat) -> CGFloat {
        let ratio = min(1, max(0, Double(tokens) / Double(maxTokens)))
        return height * (1 - CGFloat(ratio))
    }

    private func yAxisLabel(for fraction: Double, maxTokens: Int64) -> String {
        formatTokenCount(Int64((Double(maxTokens) * (1 - fraction)).rounded()))
    }

    private func nearestIndex(for x: CGFloat, width: CGFloat) -> Int {
        guard buckets.count > 1 else { return 0 }
        return Int((x / width * CGFloat(buckets.count - 1)).rounded())
    }

    private func tooltipDate(for date: Date) -> String {
        let calendar = Calendar.current
        let month = calendar.component(.month, from: date)
        let day = calendar.component(.day, from: date)
        guard showHourLabels else { return "\(month)/\(day)" }
        return String(
            format: "%02d/%02d %02d:%02d",
            month,
            day,
            calendar.component(.hour, from: date),
            calendar.component(.minute, from: date)
        )
    }

    private func tooltipX(
        for index: Int,
        width: CGFloat,
        plotOriginX: CGFloat,
        containerWidth: CGFloat
    ) -> CGFloat {
        let x = plotOriginX + xPosition(for: index, width: width)
        let halfWidth: CGFloat = 62
        return min(max(x, halfWidth + 4), containerWidth - halfWidth - 4)
    }
}

private struct CodexTokenHoverGuide: View {
    let x: CGFloat
    let y: CGFloat
    let width: CGFloat
    let height: CGFloat
    let tint: Color

    var body: some View {
        Canvas { context, size in
            var guide = Path()
            guide.move(to: CGPoint(x: x, y: 0))
            guide.addLine(to: CGPoint(x: x, y: size.height))
            context.stroke(
                guide,
                with: .color(tint.opacity(0.38)),
                style: StrokeStyle(lineWidth: 1, dash: [3, 3])
            )
            context.fill(
                Path(ellipseIn: CGRect(x: x - 4, y: y - 4, width: 8, height: 8)),
                with: .color(tint)
            )
        }
        .frame(width: width, height: height)
        .allowsHitTesting(false)
    }
}

private struct CodexTokenHoverCard: View {
    let date: String
    let tokens: Int64
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(date)
                .font(.system(size: 9, weight: .medium, design: .rounded).monospacedDigit())
                .foregroundStyle(.secondary)
            Text("\(tokens.formatted()) tokens")
                .font(.system(size: 10, weight: .semibold, design: .rounded).monospacedDigit())
                .foregroundStyle(.primary)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background(.thickMaterial, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .strokeBorder(tint.opacity(0.28))
        }
        .shadow(color: .black.opacity(0.18), radius: 5, y: 2)
        .frame(width: 124, alignment: .leading)
        .allowsHitTesting(false)
    }
}

private struct CodexTokenGridLines: View {
    let width: CGFloat
    let height: CGFloat

    var body: some View {
        Canvas { context, size in
            for fraction in [0.0, 0.5, 1.0] {
                let y = size.height * fraction
                var path = Path()
                path.move(to: CGPoint(x: 0, y: y))
                path.addLine(to: CGPoint(x: size.width, y: y))
                context.stroke(
                    path,
                    with: .color(Color.primary.opacity(fraction == 1.0 ? 0.12 : 0.055)),
                    style: StrokeStyle(lineWidth: fraction == 1.0 ? 1 : 0.7, dash: fraction == 1.0 ? [] : [3, 4])
                )
            }
        }
        .frame(width: width, height: height)
    }
}

private struct CodexTokenTrendArea: View {
    let buckets: [CodexTokenUsage.Bucket]
    let maxTokens: Int64
    let tint: Color
    let width: CGFloat
    let height: CGFloat

    var body: some View {
        Canvas { context, size in
            let line = trendPath(in: size)
            var area = line
            area.addLine(to: CGPoint(x: size.width, y: size.height))
            area.addLine(to: CGPoint(x: 0, y: size.height))
            area.closeSubpath()
            context.fill(area, with: .color(tint.opacity(0.09)))
        }
        .frame(width: width, height: height)
        .allowsHitTesting(false)
    }

    private func trendPath(in size: CGSize) -> Path {
        var path = Path()
        for (index, bucket) in buckets.enumerated() {
            let point = point(for: bucket.tokens, index: index, in: size)
            if index == 0 { path.move(to: point) } else { path.addLine(to: point) }
        }
        return path
    }

    private func point(for tokens: Int64, index: Int, in size: CGSize) -> CGPoint {
        let x = buckets.count == 1 ? size.width / 2 : size.width * CGFloat(index) / CGFloat(buckets.count - 1)
        let ratio = min(1, max(0, Double(tokens) / Double(maxTokens)))
        return CGPoint(x: x, y: size.height * (1 - CGFloat(ratio)))
    }
}

private struct CodexTokenTrendLine: View {
    let buckets: [CodexTokenUsage.Bucket]
    let maxTokens: Int64
    let tint: Color
    let width: CGFloat
    let height: CGFloat

    var body: some View {
        Canvas { context, size in
            let path = trendPath(in: size)
            context.stroke(
                path,
                with: .color(tint.opacity(0.92)),
                style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round)
            )
            if let lastBucket = buckets.last {
                let lastPoint = point(for: lastBucket.tokens, index: buckets.count - 1, in: size)
                context.fill(
                    Path(ellipseIn: CGRect(x: lastPoint.x - 3.5, y: lastPoint.y - 3.5, width: 7, height: 7)),
                    with: .color(tint)
                )
            }
        }
        .frame(width: width, height: height)
        .allowsHitTesting(false)
    }

    private func trendPath(in size: CGSize) -> Path {
        var path = Path()
        for (index, bucket) in buckets.enumerated() {
            let point = point(for: bucket.tokens, index: index, in: size)
            if index == 0 { path.move(to: point) } else { path.addLine(to: point) }
        }
        return path
    }

    private func point(for tokens: Int64, index: Int, in size: CGSize) -> CGPoint {
        let x = buckets.count == 1 ? size.width / 2 : size.width * CGFloat(index) / CGFloat(buckets.count - 1)
        let ratio = min(1, max(0, Double(tokens) / Double(maxTokens)))
        return CGPoint(x: x, y: size.height * (1 - CGFloat(ratio)))
    }
}

private func formatTokenCount(_ value: Int64) -> String {
    switch value {
    case 1_000_000...:
        return String(format: "%.1fM", Double(value) / 1_000_000)
    case 1_000...:
        return String(format: "%.1fk", Double(value) / 1_000)
    default:
        return value.formatted()
    }
}

private struct AgentStatusPill: View {
    let kind: AgentUsageItem.StatusKind
    let text: String

    var body: some View {
        HStack(spacing: 5) {
            Circle()
                .fill(kind.color)
                .frame(width: 6, height: 6)
            Text(text)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(kind == .muted ? Color.secondary : kind.color)
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 5)
        .background(kind.color.opacity(0.12), in: Capsule())
    }
}
