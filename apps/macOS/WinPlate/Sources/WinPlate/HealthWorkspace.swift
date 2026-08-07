import SwiftUI

struct HealthWorkspace: View {
    @EnvironmentObject private var state: AppState

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
        }
    }

    private var snapshotCard: some View {
        HealthPanel {
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
                            value: state.healthSnapshot.heartRate.map { "\(Int($0.rounded()))" } ?? "--",
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

    private var connectionColor: Color {
        switch state.healthConnectionState {
        case .connected: return .green
        case .connecting: return .orange
        case .error: return .red
        case .idle, .searching: return .secondary
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
