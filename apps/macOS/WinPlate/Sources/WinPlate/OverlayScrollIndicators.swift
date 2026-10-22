import AppKit
import SwiftUI

/// Keeps every scroll view in the main window on the same fading overlay style.
struct OverlayScrollIndicators: NSViewRepresentable {
    func makeNSView(context: Context) -> ScrollViewProbe {
        ScrollViewProbe()
    }

    func updateNSView(_ view: ScrollViewProbe, context: Context) {
        view.configureScrollView()
    }

    final class ScrollViewProbe: NSView {
        override func viewDidMoveToSuperview() {
            super.viewDidMoveToSuperview()
            configureScrollView()
        }

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            configureScrollView()
        }

        func configureScrollView() {
            // Page changes can create new scroll views. Apply after SwiftUI has
            // attached them, including nested lists and text editors.
            DispatchQueue.main.async { [weak self] in
                guard let contentView = self?.window?.contentView else { return }
                Self.configureScrollViews(in: contentView)
            }
        }

        private static func configureScrollViews(in view: NSView) {
            if let scrollView = view as? NSScrollView {
                if scrollView.scrollerStyle != .overlay {
                    scrollView.scrollerStyle = .overlay
                }
                if let scroller = scrollView.verticalScroller, scroller.controlSize != .small {
                    scroller.controlSize = .small
                }
            }
            for subview in view.subviews {
                configureScrollViews(in: subview)
            }
        }
    }
}
