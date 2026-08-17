import AppKit
import SwiftUI

struct HealthWorkspace: View {
    @EnvironmentObject private var state: AppState
    @State private var selectedHeartRateRange: HeartRateRange = .day

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                PageHeader(
                    title: "健康",
                    subtitle: "从 iPhone WinPlate Health 接收 HealthKit 概览"
                ) {
                    EmptyView()
                }

                connectionCard
                snapshotCard
                heartRateTrendCard
                diagnosticsCard
            }
            .padding(28)
            .frame(maxWidth: 980, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .center)
        }
        .background(Color(nsColor: .controlBackgroundColor).opacity(0.32))
    }

    private var connectionCard: some View {
        HealthPanel {
            VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                Image(systemName: state.healthConnectionState.symbolName)
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(connectionColor)
                    .frame(width: 42, height: 42)
                    .background(connectionColor.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))

                VStack(alignment: .leading, spacing: 4) {
                    Text("iPhone 通信")
                        .font(.headline)
                    Text(state.healthConnectionState.detail)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                Text(state.healthConnectionState.title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(connectionColor)
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("配对码")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                HStack(spacing: 10) {
                    Text(state.healthPairingCode)
                        .font(.system(.title3, design: .monospaced).weight(.semibold))
                        .textSelection(.enabled)
                    Button("复制") {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(state.healthPairingCode, forType: .string)
                    }
                    .buttonStyle(.bordered)
                }
                Text("在 iPhone 的 WinPlate Health 中输入此 6 位配对码，附近未配对设备无法接收健康数据。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            }
        }
    }

    private var snapshotCard: some View {
        let displayedHeartRate = state.healthSnapshot.heartRate ?? state.heartRateHistory.last?.bpm

        return HealthPanel {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Label("健康快照", systemImage: "heart.text.square.fill")
                        .font(.headline)
                        .foregroundStyle(.pink)
                    Spacer()
                    if let receivedAt = state.healthLastReceivedAt {
                        Text("收到 \(receivedAt.formatted(date: .omitted, time: .shortened))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                if state.healthLastReceivedAt == nil {
                    ContentUnavailableView(
                        "等待 iPhone 数据",
                        systemImage: "iphone.slash",
                        description: Text("打开 iPhone 上的 WinPlate Health，允许本地网络访问后会自动同步。")
                    )
                    .frame(maxWidth: .infinity, minHeight: 150)
                } else {
                    HStack(spacing: 12) {
                        HealthMetric(
                            title: "最近心率",
                            value: displayedHeartRate.map { "\(Int($0.rounded()))" } ?? "--",
                            unit: "BPM",
                            symbol: "heart.fill",
                            color: .pink
                        )
                        HealthMetric(
                            title: "今日步数",
                            value: state.healthSnapshot.stepCount.map { "\(Int($0.rounded()))" } ?? "--",
                            unit: "步",
                            symbol: "figure.walk",
                            color: .blue
                        )
                        HealthMetric(
                            title: "活动能量",
                            value: state.healthSnapshot.activeEnergy.map { "\(Int($0.rounded()))" } ?? "--",
                            unit: "千卡",
                            symbol: "flame.fill",
                            color: .orange
                        )
                    }
                }
            }
        }
    }

    private var diagnosticsCard: some View {
        HealthPanel {
            VStack(alignment: .leading, spacing: 10) {
                Label("通信诊断", systemImage: "waveform.path.ecg")
                    .font(.headline)

                HealthDiagnosticRow(
                    title: "设备",
                    value: state.healthSnapshot.sender.isEmpty ? "尚未识别" : state.healthSnapshot.sender
                )
                HealthDiagnosticRow(
                    title: "健康权限",
                    value: state.healthSnapshot.permissionGranted ? "已允许读取" : "未确认"
                )
                HealthDiagnosticRow(
                    title: "数据时间",
                    value: state.healthSnapshot.healthUpdatedAt.map {
                        $0.formatted(date: .abbreviated, time: .shortened)
                    } ?? "尚无有效健康记录"
                )
                if let error = state.healthSyncError, state.healthConnectionState.isConnected == false {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.orange)
                        .textSelection(.enabled)
                }
            }
        }
    }

    private var heartRateTrendCard: some View {
        let points = state.heartRateHistory.filter {
            $0.date >= Date().addingTimeInterval(-selectedHeartRateRange.duration)
        }
        let latest = points.last?.bpm

        return HealthPanel {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    Label("心率趋势", systemImage: "waveform.path.ecg")
                        .font(.headline)
                        .foregroundStyle(.pink)
                    Spacer(minLength: 8)
                    Picker("统计范围", selection: $selectedHeartRateRange) {
                        ForEach(HeartRateRange.allCases) { range in
                            Text(range.rawValue).tag(range)
                        }
                    }
                    .labelsHidden()
                    .pickerStyle(.segmented)
                    .frame(width: 126)
                    Text(latest.map { "最新 \(Int($0.rounded())) BPM" } ?? "暂无数据")
                        .font(.system(size: 10, weight: .medium, design: .rounded).monospacedDigit())
                        .foregroundStyle(.tertiary)
                }

                HeartRateTrendChart(
                    points: points,
                    tint: .pink,
                    range: selectedHeartRateRange
                )
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(
            latest.map { "心率趋势，最新 \(Int($0.rounded())) BPM，\(selectedHeartRateRange.rawValue)" }
                ?? "心率趋势暂无数据"
        )
    }

    private var connectionColor: Color {
        switch state.healthConnectionState {
        case .connected: return .green
        case .connecting: return .orange
        case .error: return .red
        case .idle, .searching: return .secondary
        }
    }
}

private enum HeartRateRange: String, CaseIterable, Identifiable {
    case day = "24小时"
    case week = "7天"

    var id: String { rawValue }

    var duration: TimeInterval {
        switch self {
        case .day: return 24 * 60 * 60
        case .week: return 7 * 24 * 60 * 60
        }
    }
}

private struct HealthPanel<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        content
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(nsColor: .windowBackgroundColor).opacity(0.78))
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(Color.primary.opacity(0.07))
            }
    }
}

private struct HealthMetric: View {
    let title: String
    let value: String
    let unit: String
    let symbol: String
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: symbol)
                .foregroundStyle(color)
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            HStack(alignment: .lastTextBaseline, spacing: 4) {
                Text(value)
                    .font(.system(size: 28, weight: .bold, design: .rounded).monospacedDigit())
                Text(unit)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(color.opacity(0.08), in: RoundedRectangle(cornerRadius: 14))
    }
}

private struct HealthDiagnosticRow: View {
    let title: String
    let value: String

    var body: some View {
        HStack {
            Text(title)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .font(.system(.subheadline, design: .monospaced))
                .textSelection(.enabled)
        }
        .font(.subheadline)
    }
}

private struct HeartRateTrendChart: View {
    let points: [HeartRateHistoryPoint]
    let tint: Color
    let range: HeartRateRange

    private let chartHeight: CGFloat = 116
    private let horizontalInset: CGFloat = 4
    private let verticalAxisWidth: CGFloat = 34
    @State private var hoveredIndex: Int?

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(range.rawValue)
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(.secondary)

            if points.isEmpty {
                HStack {
                    Spacer()
                    Text("暂无心率历史，等待 iPhone 快照")
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
                    let domain = valueDomain

                    ZStack(alignment: .topLeading) {
                        ForEach([0.0, 0.5, 1.0], id: \.self) { fraction in
                            Text(yAxisLabel(for: fraction, domain: domain))
                                .font(.system(size: 8, weight: .medium, design: .rounded).monospacedDigit())
                                .foregroundStyle(.tertiary)
                                .position(
                                    x: verticalAxisWidth / 2,
                                    y: plotHeight * fraction
                                )
                        }

                        HeartRateGridLines(width: plotWidth, height: plotHeight)
                            .offset(x: plotOriginX)

                        HeartRateTrendArea(
                            points: points,
                            domain: domain,
                            tint: tint,
                            width: plotWidth,
                            height: plotHeight
                        )
                        .offset(x: plotOriginX)

                        HeartRateTrendLine(
                            points: points,
                            domain: domain,
                            tint: tint,
                            width: plotWidth,
                            height: plotHeight
                        )
                        .offset(x: plotOriginX)

                        if let hoveredIndex {
                            let point = points[hoveredIndex]
                            HeartRateHoverGuide(
                                x: xPosition(for: hoveredIndex, width: plotWidth),
                                y: yPosition(for: point.bpm, domain: domain, height: plotHeight),
                                width: plotWidth,
                                height: plotHeight,
                                tint: tint
                            )
                            .offset(x: plotOriginX)

                            HeartRateHoverCard(point: point, tint: tint)
                                .position(
                                    x: tooltipX(
                                        for: hoveredIndex,
                                        width: plotWidth,
                                        plotOriginX: plotOriginX,
                                        containerWidth: geometry.size.width
                                    ),
                                    y: 20
                                )
                        }

                        ForEach(labelIndexes, id: \.self) { index in
                            Text(label(for: points[index].date))
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

    private var valueDomain: (lower: Double, upper: Double) {
        guard let minimum = points.map(\.bpm).min(), let maximum = points.map(\.bpm).max() else {
            return (60, 120)
        }
        let lower = max(30, floor((minimum - 8) / 10) * 10)
        let upper = max(lower + 40, ceil((maximum + 8) / 10) * 10)
        return (lower, upper)
    }

    private var labelIndexes: [Int] {
        let labelCount = min(6, points.count)
        guard labelCount > 1 else { return points.isEmpty ? [] : [0] }
        return (0..<labelCount).map { index in
            Int((Double(index) * Double(points.count - 1) / Double(labelCount - 1)).rounded())
        }
    }

    private func label(for date: Date) -> String {
        if range == .week {
            return date.formatted(.dateTime.month(.twoDigits).day(.twoDigits))
        }
        return date.formatted(.dateTime.hour(.twoDigits(amPM: .omitted)).minute(.twoDigits))
    }

    private func xPosition(for index: Int, width: CGFloat) -> CGFloat {
        points.count == 1 ? width / 2 : width * CGFloat(index) / CGFloat(points.count - 1)
    }

    private func yPosition(
        for bpm: Double,
        domain: (lower: Double, upper: Double),
        height: CGFloat
    ) -> CGFloat {
        let ratio = min(1, max(0, (bpm - domain.lower) / (domain.upper - domain.lower)))
        return height * (1 - CGFloat(ratio))
    }

    private func yAxisLabel(for fraction: Double, domain: (lower: Double, upper: Double)) -> String {
        let value = domain.upper - (domain.upper - domain.lower) * fraction
        return "\(Int(value.rounded()))"
    }

    private func nearestIndex(for x: CGFloat, width: CGFloat) -> Int {
        guard points.count > 1 else { return 0 }
        return Int((x / width * CGFloat(points.count - 1)).rounded())
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

private struct HeartRateGridLines: View {
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

private struct HeartRateTrendArea: View {
    let points: [HeartRateHistoryPoint]
    let domain: (lower: Double, upper: Double)
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
            context.fill(area, with: .color(tint.opacity(0.10)))
        }
        .frame(width: width, height: height)
        .allowsHitTesting(false)
    }

    private func trendPath(in size: CGSize) -> Path {
        var path = Path()
        for (index, point) in points.enumerated() {
            let x = points.count == 1
                ? size.width / 2
                : size.width * CGFloat(index) / CGFloat(points.count - 1)
            let ratio = min(1, max(0, (point.bpm - domain.lower) / (domain.upper - domain.lower)))
            let location = CGPoint(x: x, y: size.height * (1 - CGFloat(ratio)))
            if index == 0 { path.move(to: location) } else { path.addLine(to: location) }
        }
        return path
    }
}

private struct HeartRateTrendLine: View {
    let points: [HeartRateHistoryPoint]
    let domain: (lower: Double, upper: Double)
    let tint: Color
    let width: CGFloat
    let height: CGFloat

    var body: some View {
        Canvas { context, size in
            let path = trendPath(in: size)
            context.stroke(
                path,
                with: .color(tint.opacity(0.94)),
                style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round)
            )
            if let lastPoint = points.last {
                let point = pointLocation(for: lastPoint.bpm, index: points.count - 1, in: size)
                context.fill(
                    Path(ellipseIn: CGRect(x: point.x - 3.5, y: point.y - 3.5, width: 7, height: 7)),
                    with: .color(tint)
                )
            }
        }
        .frame(width: width, height: height)
        .allowsHitTesting(false)
    }

    private func trendPath(in size: CGSize) -> Path {
        var path = Path()
        for (index, point) in points.enumerated() {
            let location = pointLocation(for: point.bpm, index: index, in: size)
            if index == 0 { path.move(to: location) } else { path.addLine(to: location) }
        }
        return path
    }

    private func pointLocation(for bpm: Double, index: Int, in size: CGSize) -> CGPoint {
        let x = points.count == 1
            ? size.width / 2
            : size.width * CGFloat(index) / CGFloat(points.count - 1)
        let ratio = min(1, max(0, (bpm - domain.lower) / (domain.upper - domain.lower)))
        return CGPoint(x: x, y: size.height * (1 - CGFloat(ratio)))
    }
}

private struct HeartRateHoverGuide: View {
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

private struct HeartRateHoverCard: View {
    let point: HeartRateHistoryPoint
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(point.date.formatted(date: .abbreviated, time: .shortened))
                .font(.system(size: 9, weight: .medium, design: .rounded).monospacedDigit())
                .foregroundStyle(.secondary)
            Text("\(Int(point.bpm.rounded())) BPM")
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
