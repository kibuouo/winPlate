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
        statusItem = NSStatusBar.system.statusItem(withLength: 182)
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
        let configuration = NSImage.SymbolConfiguration(pointSize: 13, weight: .semibold, scale: .small)
        let image = NSImage(
            systemSymbolName: "square.grid.2x2.fill",
            accessibilityDescription: "WinPlate"
        )?.withSymbolConfiguration(configuration)
        image?.isTemplate = true
        let summary = MenuBarStatusSummary(icon: image)
        summary.translatesAutoresizingMaskIntoConstraints = false
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
    }

    private func configurePanel() {
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.isFloatingPanel = true
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .transient, .ignoresCycle]
        panel.hidesOnDeactivate = false
        panel.contentViewController = NSHostingController(
            rootView: MenuBarPopoverView()
                .environmentObject(state)
        )
    }

    private func observeState() {
        state.$snapshot
            .combineLatest(state.$codex)
            .sink { [weak self] snapshot, codex in
                self?.updateStatusItem(weather: snapshot.weather, codex: codex)
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

    private func updateStatusItem(weather: WeatherSnapshot, codex: UsageSnapshot) {
        guard let button = statusItem.button else { return }
        let temperature = MenuBarTemperatureFormatter.title(
            for: weather.isAvailable ? weather.temperature : nil
        )
        let quota = codex.fiveHour?.remainingPct.map { "\(Int($0.rounded()))%" } ?? "--%"
        let sevenDayQuota = codex.windows?.sevenDay?.remainingPct.map { "\(Int($0.rounded()))%" } ?? "--%"
        statusSummary?.update(
            temperature: temperature,
            weatherIcon: weather.isAvailable ? weather.icon : nil,
            fiveHour: codex.fiveHour,
            sevenDay: codex.windows?.sevenDay
        )
        button.toolTip = "天气 \(temperature) · Codex 5 小时剩余 \(quota) · 7 天剩余 \(sevenDayQuota)"
        button.setAccessibilityLabel(
            "WinPlate，天气 \(temperature)，Codex 5 小时剩余 \(quota)，7 天剩余 \(sevenDayQuota)"
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
    private let fiveHourRow = MenuBarQuotaRow(label: "5h")
    private let sevenDayRow = MenuBarQuotaRow(label: "7d")
    private static var weatherIcons = [String: NSImage]()

    init(icon: NSImage?) {
        super.init(frame: .zero)

        let iconView = NSImageView(image: icon ?? NSImage())
        iconView.translatesAutoresizingMaskIntoConstraints = false
        iconView.contentTintColor = .labelColor
        iconView.setContentHuggingPriority(.required, for: .horizontal)

        weatherIconView.translatesAutoresizingMaskIntoConstraints = false
        weatherIconView.contentTintColor = .labelColor
        weatherIconView.setContentHuggingPriority(.required, for: .horizontal)
        weatherIconView.setAccessibilityElement(false)

        let usageStack = NSStackView(views: [fiveHourRow, sevenDayRow])
        usageStack.orientation = .vertical
        usageStack.alignment = .leading
        usageStack.spacing = 0

        let divider = NSBox()
        divider.boxType = .separator
        divider.translatesAutoresizingMaskIntoConstraints = false

        let stack = NSStackView(views: [iconView, weatherIconView, temperatureLabel, divider, usageStack])
        stack.orientation = .horizontal
        stack.alignment = .centerY
        stack.spacing = 5
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)

        NSLayoutConstraint.activate([
            iconView.widthAnchor.constraint(equalToConstant: 15),
            iconView.heightAnchor.constraint(equalToConstant: 15),
            weatherIconView.widthAnchor.constraint(equalToConstant: 13),
            weatherIconView.heightAnchor.constraint(equalToConstant: 13),
            divider.widthAnchor.constraint(equalToConstant: 1),
            divider.heightAnchor.constraint(equalToConstant: 15),
            stack.leadingAnchor.constraint(equalTo: leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: trailingAnchor),
            stack.topAnchor.constraint(equalTo: topAnchor),
            stack.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
    }

    required init?(coder: NSCoder) { nil }

    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    func update(temperature: String, weatherIcon: String?, fiveHour: UsageWindow?, sevenDay: UsageWindow?) {
        temperatureLabel.stringValue = temperature
        weatherIconView.image = Self.weatherIcon(for: weatherIcon)
        fiveHourRow.update(percentage: fiveHour?.remainingPct, resetText: fiveHour?.resetText)
        sevenDayRow.update(percentage: sevenDay?.remainingPct, resetText: sevenDay?.resetText)
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
        label.setContentCompressionResistancePriority(.required, for: .horizontal)
        return label
    }
}

private final class MenuBarQuotaRow: NSView {
    private let percentageLabel = MenuBarStatusSummary.label(size: 9, weight: .semibold, color: .labelColor)
    private let resetLabel = MenuBarStatusSummary.label(size: 9, weight: .regular, color: .secondaryLabelColor)
    private let progress = NSProgressIndicator()

    init(label: String) {
        super.init(frame: .zero)

        let labelView = MenuBarStatusSummary.label(size: 9, weight: .medium, color: .secondaryLabelColor)
        labelView.stringValue = label

        progress.isIndeterminate = false
        progress.minValue = 0
        progress.maxValue = 100
        progress.style = .bar
        progress.controlSize = .mini
        progress.translatesAutoresizingMaskIntoConstraints = false

        let stack = NSStackView(views: [labelView, progress, percentageLabel, resetLabel])
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

    func update(percentage: Double?, resetText: String?) {
        progress.doubleValue = max(0, min(percentage ?? 0, 100))
        percentageLabel.stringValue = percentage.map { "\(Int($0.rounded()))%" } ?? "--%"
        resetLabel.stringValue = resetText ?? "--"
    }
}
