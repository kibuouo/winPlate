import SwiftUI

/// A shared 24-point grid keeps sidebar artwork, strokes and optical centers consistent.
struct SidebarIcon: View {
    let destination: WorkspaceDestination

    var body: some View {
        SidebarIconShape(destination: destination)
            .stroke(style: StrokeStyle(lineWidth: 1.75, lineCap: .round, lineJoin: .round))
            .foregroundStyle(.tint)
            .aspectRatio(1, contentMode: .fit)
            .accessibilityHidden(true)
    }
}

private struct SidebarIconShape: Shape {
    let destination: WorkspaceDestination

    func path(in rect: CGRect) -> Path {
        var path = Path()
        func move(_ x: CGFloat, _ y: CGFloat) { path.move(to: CGPoint(x: x, y: y)) }
        func line(_ x: CGFloat, _ y: CGFloat) { path.addLine(to: CGPoint(x: x, y: y)) }
        func curve(_ x: CGFloat, _ y: CGFloat, _ x1: CGFloat, _ y1: CGFloat, _ x2: CGFloat, _ y2: CGFloat) {
            path.addCurve(to: CGPoint(x: x, y: y), control1: CGPoint(x: x1, y: y1), control2: CGPoint(x: x2, y: y2))
        }
        func roundedRect(_ x: CGFloat, _ y: CGFloat, _ width: CGFloat, _ height: CGFloat, _ radius: CGFloat) {
            path.addRoundedRect(in: CGRect(x: x, y: y, width: width, height: height), cornerSize: CGSize(width: radius, height: radius))
        }

        switch destination {
        case .overview:
            for x: CGFloat in [3.5, 13.5] {
                for y: CGFloat in [3.5, 13.5] {
                    roundedRect(x, y, 7, 7, 1.5)
                }
            }
        case .agent:
            roundedRect(6, 6, 12, 12, 2)
            roundedRect(9, 9, 6, 6, 0.75)
            for pin: CGFloat in [9, 15] {
                move(pin, 3); line(pin, 6)
                move(pin, 18); line(pin, 21)
                move(3, pin); line(6, pin)
                move(18, pin); line(21, pin)
            }
        case .health:
            move(12, 20)
            curve(3, 8.5, 9, 17.8, 3, 13.3)
            curve(12, 6, 3, 3.3, 9.5, 2.4)
            curve(21, 8.5, 14.5, 2.4, 21, 3.3)
            curve(12, 20, 21, 13.3, 15, 17.8)
            path.closeSubpath()
            move(6, 11.5); line(9, 11.5); line(10.5, 9)
            line(13, 15); line(14.5, 11.5); line(18, 11.5)
        case .weather:
            move(12, 5.2)
            curve(19, 10.5, 17, 2.6, 21.4, 6.5)
            move(16.5, 1.8); line(16.5, 2.6)
            move(21, 3.5); line(21.6, 2.9)
            move(21.5, 7.7); line(22.3, 7.7)
            move(12.2, 2.9); line(12.8, 3.5)
            move(6, 20)
            curve(5.8, 12, 0.8, 20, 0.7, 12.3)
            curve(16.8, 12.4, 5.5, 5.5, 15.2, 5.4)
            curve(18, 20, 22.4, 11.4, 23, 20)
            line(6, 20)
        case .github:
            move(7.5, 6.5); line(2.5, 12); line(7.5, 17.5)
            move(16.5, 6.5); line(21.5, 12); line(16.5, 17.5)
            move(14, 3.5); line(10, 20.5)
        case .mail:
            roundedRect(3, 5, 18, 14, 2)
            move(3.8, 6.2); line(12, 12.8); line(20.2, 6.2)
            move(3.8, 17.8); line(8.5, 13.5)
            move(20.2, 17.8); line(15.5, 13.5)
        case .notifications:
            move(5, 17.5)
            curve(7, 9, 7.2, 15, 7, 12)
            curve(17, 9, 7, 2.3, 17, 2.3)
            curve(19, 17.5, 17, 12, 16.8, 15)
            path.closeSubpath()
            move(12, 2.5); line(12, 4)
            move(9.5, 20); curve(14.5, 20, 10.2, 22, 13.8, 22)
        case .settings:
            for tooth in 0..<8 {
                let center = CGFloat(tooth) * .pi / 4 - .pi / 2
                for (offset, radius): (CGFloat, CGFloat) in [(-22.5, 7.5), (-12, 7.5), (-9, 9.5), (9, 9.5), (12, 7.5)] {
                    let angle = center + offset * .pi / 180
                    let point = CGPoint(x: 12 + cos(angle) * radius, y: 12 + sin(angle) * radius)
                    if path.isEmpty { path.move(to: point) } else { path.addLine(to: point) }
                }
            }
            path.closeSubpath()
            path.addEllipse(in: CGRect(x: 8.75, y: 8.75, width: 6.5, height: 6.5))
        }

        let scale = min(rect.width, rect.height) / 24
        return path.applying(CGAffineTransform(a: scale, b: 0, c: 0, d: scale,
                                               tx: rect.midX - 12 * scale, ty: rect.midY - 12 * scale))
    }
}
