import SwiftUI

struct AgentWorkspace: View {
    @EnvironmentObject private var state: AppState

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                PageHeader(title: "Agent", subtitle: "查看 Codex 与 DeepSeek 用量状态") {
                    NativeRefreshButton(title: "刷新用量", isRefreshing: state.isRefreshing, showsTitle: true) {
                        state.refresh(force: true)
                    }
                }

                LazyVGrid(
                    columns: [
                        GridItem(.flexible(minimum: 300), spacing: 16),
                        GridItem(.flexible(minimum: 300), spacing: 16)
                    ],
                    spacing: 16
                ) {
                    AgentCard(title: "Codex", symbol: "terminal", tint: .blue, status: menuBarStatus(state.codex.status)) {
                        let fiveHour = state.codex.fiveHour
                        let sevenDay = state.codex.windows?.sevenDay
                        AgentUsageMetric(label: "5 小时窗口", value: fiveHour?.remainingPct, resetText: fiveHour?.resetText)
                        AgentUsageMetric(label: "7 天窗口", value: sevenDay?.remainingPct, resetText: sevenDay?.resetText)
                        if let error = state.codexError, !error.isEmpty {
                            Text(error)
                                .font(.caption)
                                .foregroundStyle(.red)
                                .lineLimit(2)
                        }
                    }

                    AgentCard(title: "DeepSeek", symbol: "sparkles", tint: .purple, status: menuBarStatus(state.deepSeek.status)) {
                        Text(state.deepSeek.cnyBalance.map { "¥\($0)" } ?? "¥--")
                            .font(.system(size: 34, weight: .bold, design: .rounded).monospacedDigit())
                        Text("人民币余额")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        if let error = state.deepSeekError, !error.isEmpty {
                            Text(error)
                                .font(.caption)
                                .foregroundStyle(.red)
                                .lineLimit(2)
                        }
                    }
                }
            }
            .padding(28)
            .frame(maxWidth: 1120, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .center)
        }
        .background(Color(nsColor: .controlBackgroundColor).opacity(0.32))
    }
}

private struct AgentCard<Content: View>: View {
    let title: String
    let symbol: String
    let tint: Color
    let status: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                Image(systemName: symbol)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(tint)
                    .frame(width: 30, height: 30)
                    .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                Text(title)
                    .font(.headline)
                Spacer()
                Text(status)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
            content
            Spacer(minLength: 0)
        }
        .padding(20)
        .frame(maxWidth: .infinity, minHeight: 210, alignment: .topLeading)
        .background(Color(nsColor: .windowBackgroundColor).opacity(0.88), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(Color.primary.opacity(0.06))
        }
    }
}

private struct AgentUsageMetric: View {
    let label: String
    let value: Double?
    let resetText: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(label)
                    .font(.subheadline.weight(.medium))
                Spacer()
                Text(value.map { "\(Int($0.rounded()))%" } ?? "--%")
                    .font(.subheadline.monospacedDigit().weight(.semibold))
            }
            if let value {
                ProgressView(value: max(0, min(value, 100)), total: 100)
                    .tint(.blue)
            } else {
                ProgressView()
                    .tint(.secondary)
            }
            Text(resetText.map { "重置 \($0)" } ?? "重置时间不可用")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}
