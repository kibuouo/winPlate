import AppKit
import Combine
import SwiftUI

@MainActor
final class MenuBarController: NSObject {
    private let state: AppState
    private let statusItem: NSStatusItem
    private let panel: NSPanel
    private var statusSummary: MenuBarStatusSummary?
    private var cancellables = Set<AnyCancellable>()
    private var localEventMonitor: Any?
    private var globalEventMonitor: Any?

    init(state: AppState) {
        self.state = state
        // Weather + heart rate + Codex/SuperGrok remaining.
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 408, height: 392),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        super.init()
        configureStatusItem()
        configurePanel()
        observeState()
    }

    private func configureStatusItem() {
        guard let button = statusItem.button else { return }
        let summary = MenuBarStatusSummary()
        summary.translatesAutoresizingMaskIntoConstraints = false
        summary.setContentHuggingPriority(.required, for: .horizontal)
        summary.setContentCompressionResistancePriority(.required, for: .horizontal)
        button.addSubview(summary)
        NSLayoutConstraint.activate([
            summary.leadingAnchor.constraint(equalTo: button.leadingAnchor, constant: 4),
            summary.trailingAnchor.constraint(equalTo: button.trailingAnchor, constant: -4),
            summary.centerYAnchor.constraint(equalTo: button.centerYAnchor),
        ])
        statusSummary = summary
        button.image = nil
        button.title = ""
        button.target = self
        button.action = #selector(handleStatusItemClick)
        button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        button.toolTip = "WinPlate 状态"
        button.setAccessibilityLabel("WinPlate 状态")
        resizeStatusItem()
    }

    private func resizeStatusItem() {
        guard let summary = statusSummary else { return }
        summary.layoutSubtreeIfNeeded()
        let width = ceil(summary.fittingSize.width) + 8
        guard width > 8, abs(statusItem.length - width) > 0.5 else { return }
        statusItem.length = width
    }

    private func configurePanel() {
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.isFloatingPanel = true
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .transient, .ignoresCycle]
        panel.hidesOnDeactivate = false
        let hosting = NSHostingController(
            rootView: MenuBarPopoverView()
                .environmentObject(state)
        )
        hosting.view.wantsLayer = true
        panel.contentViewController = hosting
        refreshPanelScale()
    }

    private func refreshPanelScale() {
        let scale = panel.screen?.backingScaleFactor
            ?? NSScreen.main?.backingScaleFactor
            ?? 2
        panel.contentView?.wantsLayer = true
        panel.contentView?.layer?.contentsScale = scale
        panel.contentViewController?.view.layer?.contentsScale = scale
    }

    private func observeState() {
        let serviceSummary = state.$snapshot.combineLatest(state.$codex, state.$superGrok)
        let healthSummary = state.$healthSnapshot.combineLatest(state.$heartRateHistory)
        serviceSummary
            .combineLatest(healthSummary)
            .sink { [weak self] services, health in
                let (snapshot, codex, superGrok) = services
                let (healthSnapshot, heartRateHistory) = health
                let heartRate = healthSnapshot.heartRate ?? heartRateHistory.last?.bpm
                self?.updateStatusItem(
                    weather: snapshot.weather,
                    codex: codex,
                    superGrok: superGrok,
                    heartRate: heartRate
                )
            }
            .store(in: &cancellables)

        state.$menuBarEnabled
            .removeDuplicates()
            .sink { [weak self] enabled in
                guard let self else { return }
                if !enabled { self.hidePanel() }
                self.statusItem.isVisible = enabled
            }
            .store(in: &cancellables)

        NotificationCenter.default.publisher(for: .showWinPlateMainWindow)
            .merge(with: NotificationCenter.default.publisher(for: .showWinPlateSettingsWindow))
            .sink { [weak self] _ in self?.hidePanel() }
            .store(in: &cancellables)
    }

    private func updateStatusItem(
        weather: WeatherSnapshot,
        codex: UsageSnapshot,
        superGrok: UsageSnapshot,
        heartRate: Double?
    ) {
        guard let button = statusItem.button else { return }
        let temperature = MenuBarTemperatureFormatter.title(
            for: weather.isAvailable ? weather.temperature : nil
        )
        let sevenDayQuota = codex.sevenDay?.remainingPct.map { "\(Int($0.rounded()))%" } ?? "--%"
        let grokQuota = superGrok.remainingPct.map { "\(Int($0.rounded()))%" } ?? "--%"
        statusSummary?.update(
            temperature: temperature,
            weatherIcon: weather.isAvailable ? weather.icon : nil,
            codex: codex,
            superGrok: superGrok,
            heartRate: heartRate
        )
        resizeStatusItem()
        let heartRateValue = heartRate.map { "\(Int($0.rounded())) BPM" } ?? "-- BPM"
        button.toolTip =
            "天气 \(temperature) · 心率 \(heartRateValue) · Codex 7d \(sevenDayQuota)\(statusBarStatusSuffix(codex.status)) · SuperGrok \(grokQuota)\(statusBarStatusSuffix(superGrok.status))"
        button.setAccessibilityLabel(
            "WinPlate，天气 \(temperature)，心率 \(heartRateValue)，Codex 7 天剩余 \(sevenDayQuota)\(statusBarStatusSpokenSuffix(codex.status))，SuperGrok 剩余 \(grokQuota)\(statusBarStatusSpokenSuffix(superGrok.status))"
        )
    }

    @objc private func handleStatusItemClick() {
        guard let button = statusItem.button else { return }
        if NSApp.currentEvent?.type == .rightMouseUp {
            hidePanel()
            showContextMenu(from: button)
            return
        }

        if panel.isVisible {
            hidePanel()
        } else {
            state.refresh()
            showPanel(from: button)
        }
    }

    private func showPanel(from button: NSStatusBarButton) {
        guard let buttonWindow = button.window else { return }
        let buttonFrame = buttonWindow.convertToScreen(button.convert(button.bounds, to: nil))
        let screenFrame = buttonWindow.screen?.visibleFrame ?? NSScreen.main?.visibleFrame ?? .zero
        let panelFrame = panel.frame
        let horizontalMargin: CGFloat = 8
        let x = min(
            max(buttonFrame.midX - (panelFrame.width / 2), screenFrame.minX + horizontalMargin),
            screenFrame.maxX - panelFrame.width - horizontalMargin
        )
        let y = max(screenFrame.minY + horizontalMargin, buttonFrame.minY - panelFrame.height - horizontalMargin)
        panel.setFrameOrigin(NSPoint(x: x, y: y))
        refreshPanelScale()
        panel.orderFrontRegardless()
        button.highlight(true)
        installDismissalMonitors()
    }

    private func hidePanel() {
        guard panel.isVisible else { return }
        panel.orderOut(nil)
        statusItem.button?.highlight(false)
        removeDismissalMonitors()
    }

    private func installDismissalMonitors() {
        removeDismissalMonitors()
        let events: NSEvent.EventTypeMask = [.leftMouseDown, .rightMouseDown]
        localEventMonitor = NSEvent.addLocalMonitorForEvents(matching: events) { [weak self] event in
            self?.dismissPanelIfNeeded()
            return event
        }
        globalEventMonitor = NSEvent.addGlobalMonitorForEvents(matching: events) { [weak self] _ in
            DispatchQueue.main.async { self?.dismissPanelIfNeeded() }
        }
    }

    private func removeDismissalMonitors() {
        if let localEventMonitor { NSEvent.removeMonitor(localEventMonitor) }
        if let globalEventMonitor { NSEvent.removeMonitor(globalEventMonitor) }
        localEventMonitor = nil
        globalEventMonitor = nil
    }

    private func dismissPanelIfNeeded() {
        let location = NSEvent.mouseLocation
        guard !panel.frame.contains(location) else { return }
        guard let button = statusItem.button, let window = button.window else {
            hidePanel()
            return
        }
        let buttonFrame = window.convertToScreen(button.convert(button.bounds, to: nil))
        if !buttonFrame.contains(location) { hidePanel() }
    }

    private func showContextMenu(from button: NSStatusBarButton) {
        let menu = NSMenu()
        menu.addItem(withTitle: "打开 WinPlate", action: #selector(openWinPlate), keyEquivalent: "")
        menu.addItem(withTitle: "设置…", action: #selector(openSettings), keyEquivalent: ",")
        menu.addItem(withTitle: "刷新", action: #selector(refresh), keyEquivalent: "r")
        menu.addItem(.separator())
        menu.addItem(withTitle: "退出 WinPlate", action: #selector(quit), keyEquivalent: "q")
        for item in menu.items { item.target = self }

        statusItem.menu = menu
        button.performClick(nil)
        statusItem.menu = nil
    }

    @objc private func openWinPlate() {
        NotificationCenter.default.post(name: .showWinPlateMainWindow, object: nil)
    }

    @objc private func openSettings() {
        NotificationCenter.default.post(name: .showWinPlateSettingsWindow, object: nil)
    }

    @objc private func refresh() {
        state.refresh(force: true)
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }

}

private final class MenuBarStatusSummary: NSView {
    private let temperatureLabel = MenuBarStatusSummary.label(size: 11, weight: .semibold, color: .labelColor)
    private let weatherIconView = NSImageView()
    private let heartRateLabel = MenuBarStatusSummary.label(size: 10, weight: .semibold, color: .labelColor)
    private let sevenDayRow = MenuBarQuotaRow(tint: .systemBlue)
    private let superGrokRow = MenuBarQuotaRow(tint: .systemGreen)
    private static var weatherIcons = [String: NSImage]()

    init() {
        super.init(frame: .zero)

        weatherIconView.translatesAutoresizingMaskIntoConstraints = false
        weatherIconView.contentTintColor = .labelColor
        weatherIconView.setContentHuggingPriority(.required, for: .horizontal)
        weatherIconView.setAccessibilityElement(false)

        let usageStack = NSStackView(views: [sevenDayRow, superGrokRow])
        usageStack.orientation = .vertical
        usageStack.alignment = .leading
        usageStack.spacing = 0

        let heartIcon = NSImageView(
            image: NSImage(
                systemSymbolName: "heart.fill",
                accessibilityDescription: "心率"
            ) ?? NSImage()
        )
        heartIcon.translatesAutoresizingMaskIntoConstraints = false
        heartIcon.contentTintColor = .systemPink
        heartIcon.setAccessibilityElement(false)

        let usageDivider = NSBox()
        usageDivider.boxType = .separator
        usageDivider.translatesAutoresizingMaskIntoConstraints = false

        usageStack.setContentHuggingPriority(.required, for: .horizontal)
        usageStack.setContentCompressionResistancePriority(.required, for: .horizontal)

        let stack = NSStackView(
            views: [weatherIconView, temperatureLabel, heartIcon, heartRateLabel, usageDivider, usageStack]
        )
        stack.orientation = .horizontal
        stack.alignment = .centerY
        stack.spacing = 5
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.setContentHuggingPriority(.required, for: .horizontal)
        stack.setContentCompressionResistancePriority(.required, for: .horizontal)
        addSubview(stack)

        NSLayoutConstraint.activate([
            weatherIconView.widthAnchor.constraint(equalToConstant: 13),
            weatherIconView.heightAnchor.constraint(equalToConstant: 13),
            heartIcon.widthAnchor.constraint(equalToConstant: 11),
            heartIcon.heightAnchor.constraint(equalToConstant: 11),
            usageDivider.widthAnchor.constraint(equalToConstant: 1),
            usageDivider.heightAnchor.constraint(equalToConstant: 15),
            stack.leadingAnchor.constraint(equalTo: leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: trailingAnchor),
            stack.topAnchor.constraint(equalTo: topAnchor),
            stack.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
    }

    required init?(coder: NSCoder) { nil }

    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    func update(
        temperature: String,
        weatherIcon: String?,
        codex: UsageSnapshot,
        superGrok: UsageSnapshot,
        heartRate: Double?
    ) {
        temperatureLabel.stringValue = temperature
        weatherIconView.image = Self.weatherIcon(for: weatherIcon)
        heartRateLabel.stringValue = heartRate.map { "\(Int($0.rounded()))" } ?? "--"
        sevenDayRow.update(
            percentage: codex.sevenDay?.remainingPct,
            resetText: codex.sevenDay?.resetText,
            status: codex.status
        )
        superGrokRow.update(
            percentage: superGrok.remainingPct,
            resetText: superGrok.resetText,
            status: superGrok.status
        )
    }

    private static func weatherIcon(for code: String?) -> NSImage? {
        let filename = MenuBarWeatherIcon.filename(for: code)
        if let image = weatherIcons[filename] { return image }
        guard
            let url = Bundle.main.url(
                forResource: filename,
                withExtension: "svg",
                subdirectory: "QWeatherIcons"
            ),
            let image = NSImage(contentsOf: url)
        else {
            return nil
        }
        image.isTemplate = true
        image.size = NSSize(width: 13, height: 13)
        weatherIcons[filename] = image
        return image
    }

    fileprivate static func label(size: CGFloat, weight: NSFont.Weight, color: NSColor) -> NSTextField {
        let label = NSTextField(labelWithString: "--")
        label.font = .systemFont(ofSize: size, weight: weight)
        label.textColor = color
        label.alignment = .left
        label.lineBreakMode = .byClipping
        label.setContentHuggingPriority(.required, for: .horizontal)
        label.setContentCompressionResistancePriority(.required, for: .horizontal)
        return label
    }
}

private final class MenuBarQuotaRow: NSView {
    private let percentageLabel = MenuBarStatusSummary.label(size: 9, weight: .semibold, color: .labelColor)
    private let resetLabel = MenuBarStatusSummary.label(size: 9, weight: .regular, color: .secondaryLabelColor)
    private let sourceLabel = MenuBarStatusSummary.label(size: 8, weight: .semibold, color: .secondaryLabelColor)
    private let progress: MenuBarQuotaBar

    init(tint: NSColor) {
        progress = MenuBarQuotaBar(tint: tint)
        super.init(frame: .zero)

        progress.translatesAutoresizingMaskIntoConstraints = false

        let stack = NSStackView(views: [progress, percentageLabel, resetLabel, sourceLabel])
        stack.orientation = .horizontal
        stack.alignment = .centerY
        stack.spacing = 3
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)

        NSLayoutConstraint.activate([
            progress.widthAnchor.constraint(equalToConstant: 25),
            progress.heightAnchor.constraint(equalToConstant: 4),
            stack.leadingAnchor.constraint(equalTo: leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: trailingAnchor),
            stack.topAnchor.constraint(equalTo: topAnchor),
            stack.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
    }

    required init?(coder: NSCoder) { nil }

    func update(percentage: Double?, resetText: String?, status: String) {
        progress.progress = max(0, min(percentage ?? 0, 100))
        percentageLabel.stringValue = percentage.map { "\(Int($0.rounded()))%" } ?? "--%"
        resetLabel.stringValue = resetText ?? "--"
        let showStatus = status != "Normal"
        sourceLabel.stringValue = showStatus ? menuBarStatus(status) : ""
        sourceLabel.isHidden = !showStatus
        switch status {
        case "Cached": sourceLabel.textColor = .systemOrange
        default: sourceLabel.textColor = .secondaryLabelColor
        }
    }
}

private final class MenuBarQuotaBar: NSView {
    private let tint: NSColor
    var progress: Double = 0 {
        didSet { needsDisplay = true }
    }

    init(tint: NSColor) {
        self.tint = tint
        super.init(frame: .zero)
    }

    required init?(coder: NSCoder) { nil }

    override var intrinsicContentSize: NSSize {
        NSSize(width: 25, height: 4)
    }

    override func draw(_ dirtyRect: NSRect) {
        let track = NSBezierPath(roundedRect: bounds, xRadius: 2, yRadius: 2)
        tint.withAlphaComponent(0.18).setFill()
        track.fill()

        let width = bounds.width * CGFloat(progress / 100)
        guard width > 0 else { return }
        let fillRect = NSRect(x: bounds.minX, y: bounds.minY, width: max(width, 3), height: bounds.height)
        let fill = NSBezierPath(roundedRect: fillRect, xRadius: 2, yRadius: 2)
        tint.setFill()
        fill.fill()
    }
}
