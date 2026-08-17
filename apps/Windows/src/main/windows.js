const path = require("path");
const { BrowserWindow, screen } = require("electron");
const { getMainWindowOptions } = require("./windowPolicy");
const { normalizeMainSection } = require("./activationCoordinator");
const { sendToWindow } = require("./windowMessaging");
const { assetPath } = require("./repositoryPaths");
let floatingWindow;
let mainWindow;
let tooltipWindow;
let tooltipVisible = false;
let quitting = false;

const rendererPath = path.join(__dirname, "..", "renderer", "index.html");
const preloadPath = path.join(__dirname, "..", "preload", "preload.js");
const iconPath = assetPath("icon.ico");
const FLOATING_WINDOW_WIDTH = 460;
const FLOATING_WINDOW_HEIGHT = 104;
const FLOATING_DOCK_WIDTH = 392;
const FLOATING_DOCK_HEIGHT = 44;
const FLOATING_DOCK_THRESHOLD = 18;
const FLOATING_RESTORE_HITBOX = { right: 10, top: 6, width: 32, height: 32 };
// Taller to fit peer Codex + SuperGrok sections without clipping.
const CODEX_TOOLTIP_SIZE = { width: 248, height: 196 };
const SYSTEM_TOOLTIP_SIZE = { width: 200, height: 96 };
const NETWORK_TOOLTIP_SIZE = { width: 244, height: 160 };
const GITHUB_TOOLTIP_SIZE = { width: 340, height: 264 };
const NOTIFICATION_TOOLTIP_SIZE = { width: 300, height: 216 };
let floatingPinned = false;
let floatingDocked = false;
let floatingRestoreBounds = null;
let floatingMoveTimer = null;
let floatingTopmostTimer = null;
let floatingInteractionTimer = null;
let floatingDockControlInteractive = false;
function isLiveNativeSurface(surface) {
  if (!surface) return false;
  try {
    return typeof surface.isDestroyed !== "function" || !surface.isDestroyed();
  } catch {
    return false;
  }
}

function setFloatingPinned(value) {
  floatingPinned = Boolean(value);

  if (!floatingWindow) {
    return floatingPinned;
  }

  enforceFloatingAlwaysOnTop();
  floatingWindow.setIgnoreMouseEvents(floatingPinned, { forward: true });

  return floatingPinned;
}

function setFloatingPinInteractive(value) {
  if (!floatingWindow || !floatingPinned || floatingDocked) {
    return;
  }

  floatingWindow.setIgnoreMouseEvents(!value, { forward: true });
}

function secureWebPreferences() {
  return {
    preload: preloadPath,
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true
  };
}

function enforceFloatingAlwaysOnTop() {
  if (!isLiveNativeSurface(floatingWindow)) {
    return;
  }
  if (typeof floatingWindow.isVisible === "function" && !floatingWindow.isVisible()) {
    return;
  }
  floatingWindow.setAlwaysOnTop(true, "screen-saver", 1);
  floatingWindow.moveTop?.();
}

function startFloatingTopmostWatchdog() {
  clearInterval(floatingTopmostTimer);
  floatingTopmostTimer = setInterval(enforceFloatingAlwaysOnTop, 1_000);
  floatingTopmostTimer.unref?.();
}

function updateDockedFloatingInteraction() {
  if (!isLiveNativeSurface(floatingWindow) || !floatingDocked) {
    return;
  }
  const bounds = floatingWindow.getBounds();
  const cursor = screen.getCursorScreenPoint();
  const right = bounds.x + bounds.width - FLOATING_RESTORE_HITBOX.right;
  const left = right - FLOATING_RESTORE_HITBOX.width;
  const top = bounds.y + FLOATING_RESTORE_HITBOX.top;
  const bottom = top + FLOATING_RESTORE_HITBOX.height;
  const overRestore = cursor.x >= left
    && cursor.x <= right
    && cursor.y >= top
    && cursor.y <= bottom;
  if (overRestore === floatingDockControlInteractive) {
    return;
  }
  floatingDockControlInteractive = overRestore;
  floatingWindow.setIgnoreMouseEvents(!overRestore, { forward: true });
}

function startFloatingInteractionWatchdog() {
  clearInterval(floatingInteractionTimer);
  floatingInteractionTimer = setInterval(updateDockedFloatingInteraction, 60);
  floatingInteractionTimer.unref?.();
}

function displayForFloatingBounds(bounds) {
  return screen.getDisplayNearestPoint({
    x: Math.round(bounds.x + bounds.width / 2),
    y: Math.round(bounds.y + bounds.height / 2)
  });
}

function defaultFloatingBounds(display = screen.getPrimaryDisplay()) {
  const { x, y, width } = display.workArea;
  return {
    x: x + width - FLOATING_WINDOW_WIDTH - 32,
    y: y + 80,
    width: FLOATING_WINDOW_WIDTH,
    height: FLOATING_WINDOW_HEIGHT
  };
}

function positionFloatingWindow() {
  floatingRestoreBounds = defaultFloatingBounds();
  floatingWindow.setBounds(floatingRestoreBounds);
}

function notifyFloatingDockState() {
  sendToWindow(floatingWindow, "floating:dock-state", { docked: floatingDocked });
}

function dockFloatingWindow() {
  if (!isLiveNativeSurface(floatingWindow) || floatingDocked) {
    return floatingDocked;
  }

  const currentBounds = floatingWindow.getBounds();
  const { workArea } = displayForFloatingBounds(currentBounds);
  floatingDocked = true;
  floatingDockControlInteractive = false;
  hideTooltipWindow();
  floatingWindow.setBounds({
    x: workArea.x + Math.round((workArea.width - FLOATING_DOCK_WIDTH) / 2),
    y: workArea.y,
    width: FLOATING_DOCK_WIDTH,
    height: FLOATING_DOCK_HEIGHT
  });
  floatingWindow.setIgnoreMouseEvents(true, { forward: true });
  enforceFloatingAlwaysOnTop();
  notifyFloatingDockState();
  return floatingDocked;
}

function clampFloatingRestoreBounds(bounds, workArea) {
  const width = FLOATING_WINDOW_WIDTH;
  const height = FLOATING_WINDOW_HEIGHT;
  const minimumY = Math.min(workArea.y + 48, workArea.y + workArea.height - height);
  return {
    x: Math.max(workArea.x, Math.min(bounds.x, workArea.x + workArea.width - width)),
    y: Math.max(minimumY, Math.min(bounds.y, workArea.y + workArea.height - height)),
    width,
    height
  };
}

function restoreFloatingCapsule() {
  if (!isLiveNativeSurface(floatingWindow)) {
    return false;
  }

  const fallbackBounds = defaultFloatingBounds(displayForFloatingBounds(floatingWindow.getBounds()));
  const targetBounds = floatingRestoreBounds || fallbackBounds;
  const { workArea } = displayForFloatingBounds(targetBounds);
  floatingDocked = false;
  floatingDockControlInteractive = false;
  floatingRestoreBounds = clampFloatingRestoreBounds(targetBounds, workArea);
  floatingWindow.setBounds(floatingRestoreBounds);
  floatingWindow.setIgnoreMouseEvents(floatingPinned, { forward: true });
  enforceFloatingAlwaysOnTop();
  notifyFloatingDockState();
  return floatingDocked;
}

function handleFloatingWindowMove() {
  if (!isLiveNativeSurface(floatingWindow) || floatingDocked) {
    return;
  }

  clearTimeout(floatingMoveTimer);
  floatingMoveTimer = setTimeout(() => {
    if (!isLiveNativeSurface(floatingWindow) || floatingDocked) {
      return;
    }
    const bounds = floatingWindow.getBounds();
    const { workArea } = displayForFloatingBounds(bounds);
    const offsetFromTop = bounds.y - workArea.y;
    if (offsetFromTop >= -Math.round(bounds.height / 2) && offsetFromTop <= FLOATING_DOCK_THRESHOLD) {
      dockFloatingWindow();
      return;
    }
    floatingRestoreBounds = bounds;
  }, 90);
}

function createFloatingWindow() {
  if (isLiveNativeSurface(floatingWindow)) return floatingWindow;

  floatingWindow = new BrowserWindow({
    width: FLOATING_WINDOW_WIDTH,
    height: FLOATING_WINDOW_HEIGHT,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    // The floating capsule is a pointer-only status surface. Keeping it out of
    // the keyboard focus chain prevents close accelerators such as Alt+F4 from
    // reaching it while it is in click-through mode.
    focusable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    hasShadow: false,
    icon: iconPath,
    webPreferences: secureWebPreferences()
  });
  const createdWindow = floatingWindow;

  floatingWindow.loadFile(rendererPath, { query: { view: "floating" } });
  floatingWindow.once("ready-to-show", () => {
    if (isLiveNativeSurface(createdWindow)) {
      enforceFloatingAlwaysOnTop();
      createdWindow.show();
      enforceFloatingAlwaysOnTop();
    }
  });
  floatingWindow.on("move", handleFloatingWindowMove);
  floatingWindow.on("blur", enforceFloatingAlwaysOnTop);
  floatingWindow.on("show", enforceFloatingAlwaysOnTop);
  floatingWindow.on("always-on-top-changed", (_event, alwaysOnTop) => {
    if (!alwaysOnTop) {
      setImmediate(enforceFloatingAlwaysOnTop);
    }
  });
  floatingWindow.on("close", (event) => {
    // The capsule/notch is persistent UI, not a separately closable document.
    // Only the explicit application quit flow may close its native window.
    if (!quitting) event.preventDefault();
  });
  floatingWindow.on("closed", () => {
    if (floatingWindow === createdWindow) {
      clearTimeout(floatingMoveTimer);
      floatingMoveTimer = null;
      clearInterval(floatingTopmostTimer);
      floatingTopmostTimer = null;
      clearInterval(floatingInteractionTimer);
      floatingInteractionTimer = null;
      hideTooltipWindow();
      floatingWindow = null;
      floatingDocked = false;
      floatingRestoreBounds = null;
    }
  });
  positionFloatingWindow();
  startFloatingTopmostWatchdog();
  startFloatingInteractionWatchdog();

  return floatingWindow;
}

function createTooltipWindow() {
  if (isLiveNativeSurface(tooltipWindow)) return tooltipWindow;

  tooltipWindow = new BrowserWindow({
    width: CODEX_TOOLTIP_SIZE.width,
    height: CODEX_TOOLTIP_SIZE.height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    hasShadow: false,
    webPreferences: secureWebPreferences()
  });

  tooltipWindow.setAlwaysOnTop(true, "screen-saver");
  tooltipWindow.setIgnoreMouseEvents(true);
  tooltipWindow.loadFile(rendererPath, { query: { view: "tooltip" } });
  const createdWindow = tooltipWindow;
  tooltipWindow.on("closed", () => {
    if (tooltipWindow === createdWindow) tooltipWindow = null;
  });
  return tooltipWindow;
}

function showTooltipWindow({ anchor, data }) {
  if (!anchor || !data) {
    return;
  }

  tooltipVisible = true;
  const window = createTooltipWindow();
  const floatingBounds = floatingWindow && !floatingWindow.isDestroyed()
    ? floatingWindow.getBounds()
    : null;
  const absoluteAnchor = anchor.relativeToFloatingWindow && floatingBounds
    ? {
        ...anchor,
        x: floatingBounds.x + anchor.x,
        y: floatingBounds.y + anchor.y
      }
    : anchor;
  const display = screen.getDisplayNearestPoint({
    x: Math.round(absoluteAnchor.x),
    y: Math.round(absoluteAnchor.y)
  });
  const workArea = display.workArea;
  const tooltipSize = data.type === "github"
    ? GITHUB_TOOLTIP_SIZE
      : data.type === "codex"
      ? CODEX_TOOLTIP_SIZE
      : data.type === "weather"
        ? { width: 292, height: 276 }
        : data.type === "notifications"
          ? NOTIFICATION_TOOLTIP_SIZE
          : data.type === "network"
            ? NETWORK_TOOLTIP_SIZE
        : SYSTEM_TOOLTIP_SIZE;
  let placement = "below";
  let x = Math.round(absoluteAnchor.x + 22);
  let y = Math.round(absoluteAnchor.y + absoluteAnchor.height + 8);

  if (data.type === "codex") {
    x = Math.round(absoluteAnchor.x + absoluteAnchor.width / 2 - tooltipSize.width / 2);
    y = Math.round((floatingBounds?.y ?? absoluteAnchor.y) - tooltipSize.height - 10);
    if (y < workArea.y) {
      y = Math.round(
        (floatingBounds?.y + floatingBounds?.height)
        ?? (absoluteAnchor.y + absoluteAnchor.height)
      ) + 10;
    } else {
      placement = "above";
    }
  } else if (floatingBounds) {
    y = Math.max(y, floatingBounds.y + floatingBounds.height + 8);
  }

  x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - tooltipSize.width));
  if (y + tooltipSize.height > workArea.y + workArea.height) {
    y = Math.round(absoluteAnchor.y - tooltipSize.height - 8);
  }
  y = Math.max(
    workArea.y,
    Math.min(y, workArea.y + workArea.height - tooltipSize.height)
  );

  window.setBounds({
    x,
    y,
    width: tooltipSize.width,
    height: tooltipSize.height
  });
  const payload = { ...data, placement };
  const sent = sendToWindow(window, "tooltip:update", payload);
  if (sent && tooltipVisible && !window.isDestroyed()) {
    window.showInactive();
  }
}

function hideTooltipWindow() {
  tooltipVisible = false;
  tooltipWindow?.hide();
}

function createMainWindow(initialTheme = "dark") {
  const dark = initialTheme !== "light";
  if (isLiveNativeSurface(mainWindow)) {
    mainWindow.setBackgroundColor(dark ? "#202123" : "#ffffff");
    return mainWindow;
  }

  mainWindow = new BrowserWindow(getMainWindowOptions({
    icon: iconPath,
    dark,
    webPreferences: secureWebPreferences()
  }));
  const createdWindow = mainWindow;

  mainWindow.loadFile(rendererPath, { query: { view: "main" } });
  mainWindow.once("ready-to-show", () => {
    if (createdWindow.__showWhenReady && isLiveNativeSurface(createdWindow)) {
      createdWindow.show();
      createdWindow.focus();
      sendToWindow(createdWindow, "main:navigate", createdWindow.__pendingSection || "Dashboard");
      sendToWindow(createdWindow, "status:refresh", null);
      createdWindow.__showWhenReady = false;
      createdWindow.__pendingSection = null;
    }
  });
  mainWindow.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      if (isLiveNativeSurface(createdWindow)) createdWindow.hide();
    }
  });
  mainWindow.on("closed", () => {
    if (mainWindow === createdWindow) mainWindow = null;
  });
  mainWindow.on("maximize", () => sendToWindow(createdWindow, "window:maximized", true));
  mainWindow.on("unmaximize", () => sendToWindow(createdWindow, "window:maximized", false));

  return mainWindow;
}

function setMainWindowTheme(theme) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const dark = theme !== "light";
  mainWindow.setBackgroundColor(dark ? "#202123" : "#ffffff");
  mainWindow.setBackgroundMaterial?.("none");
}

function setAppWindowOpacity(value) {
  const opacity = Math.max(0.65, Math.min(1, Number(value) || 1));
  [mainWindow, floatingWindow].forEach((window) => {
    if (window && !window.isDestroyed()) window.setOpacity(opacity);
  });
  return opacity;
}

function ownsMainWindowSender(sender) {
  return Boolean(
    mainWindow
    && !mainWindow.isDestroyed()
    && !mainWindow.webContents.isDestroyed()
    && sender === mainWindow.webContents
  );
}

function ownsFloatingWindowSender(sender) {
  return Boolean(
    floatingWindow
    && !floatingWindow.isDestroyed()
    && !floatingWindow.webContents.isDestroyed()
    && sender === floatingWindow.webContents
  );
}

function ownsTooltipWindowSender(sender) {
  return Boolean(
    tooltipWindow
    && !tooltipWindow.isDestroyed()
    && !tooltipWindow.webContents.isDestroyed()
    && sender === tooltipWindow.webContents
  );
}

function minimizeMainWindow() {
  mainWindow?.minimize();
}

function toggleMaximizeMainWindow() {
  if (!mainWindow) return false;
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  return mainWindow.isMaximized();
}

function closeMainWindow() {
  mainWindow?.close();
}

function normalizeMainNavigation(sectionOrPayload) {
  if (typeof sectionOrPayload === "string" && sectionOrPayload.trim()) {
    return normalizeMainSection(sectionOrPayload);
  }
  if (sectionOrPayload && typeof sectionOrPayload === "object") {
    const navigation = {
      section: normalizeMainSection(sectionOrPayload.section),
      moduleId: typeof sectionOrPayload.moduleId === "string" ? sectionOrPayload.moduleId : null,
      source: typeof sectionOrPayload.source === "string" ? sectionOrPayload.source : null,
      sourceId: typeof sectionOrPayload.sourceId === "string" ? sectionOrPayload.sourceId : null,
      notificationId: typeof sectionOrPayload.notificationId === "string" ? sectionOrPayload.notificationId : null
    };
    return Object.values(navigation).some((value, index) => index > 0 && value !== null)
      ? navigation
      : navigation.section;
  }
  return "Dashboard";
}

function showMainWindow(section = "Dashboard") {
  const targetNavigation = normalizeMainNavigation(section);
  if (!isLiveNativeSurface(mainWindow)) {
    createMainWindow();
  }

  if (mainWindow.webContents.isLoading()) {
    mainWindow.__showWhenReady = true;
    mainWindow.__pendingSection = targetNavigation;
    return;
  }

  mainWindow.show();
  mainWindow.focus();
  sendToWindow(mainWindow, "main:navigate", targetNavigation);
  sendToWindow(mainWindow, "status:refresh", null);
}

function showFloatingWindow() {
  if (!isLiveNativeSurface(floatingWindow)) {
    createFloatingWindow();
  } else {
    floatingWindow.show();
    enforceFloatingAlwaysOnTop();
  }
}

function hideFloatingWindow() {
  floatingWindow?.hide();
}

function setQuitting(value) {
  quitting = value;
}

module.exports = {
  createFloatingWindow,
  createTooltipWindow,
  createMainWindow,
  showMainWindow,
  showFloatingWindow,
  hideFloatingWindow,
  showTooltipWindow,
  hideTooltipWindow,
  setQuitting,
  setMainWindowTheme,
  ownsMainWindowSender,
  ownsFloatingWindowSender,
  ownsTooltipWindowSender,
  setAppWindowOpacity,
  minimizeMainWindow,
  toggleMaximizeMainWindow,
  closeMainWindow,
  setFloatingPinned,
  setFloatingPinInteractive,
  restoreFloatingCapsule,
  sendToWindow
};
