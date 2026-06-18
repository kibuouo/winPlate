const path = require("path");
const { BrowserWindow, screen } = require("electron");

let floatingWindow;
let mainWindow;
let tooltipWindow;
let tooltipVisible = false;
let quitting = false;

const rendererPath = path.join(__dirname, "..", "renderer", "index.html");
const preloadPath = path.join(__dirname, "..", "preload", "preload.js");
const iconPath = path.join(__dirname, "..", "..", "assets", "icon.ico");
const FLOATING_WINDOW_WIDTH = 460;
const CODEX_TOOLTIP_SIZE = { width: 232, height: 128 };
const SYSTEM_TOOLTIP_SIZE = { width: 200, height: 96 };
const GITHUB_TOOLTIP_SIZE = { width: 340, height: 264 };
const NOTIFICATION_TOOLTIP_SIZE = { width: 320, height: 238 };
let floatingPinned = false;
function setFloatingPinned(value) {
  floatingPinned = Boolean(value);

  if (!floatingWindow) {
    return floatingPinned;
  }

  // 置顶
  floatingWindow.setAlwaysOnTop(true, "screen-saver");

  // pinned=true 时默认鼠标穿透
  floatingWindow.setIgnoreMouseEvents(floatingPinned, { forward: true });

  return floatingPinned;
}

function setFloatingPinInteractive(value) {
  if (!floatingWindow || !floatingPinned) {
    return;
  }

  // 鼠标在 pin 按钮上：允许点击悬浮窗
  // 鼠标不在 pin 按钮上：点击穿透到下面软件
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

function positionFloatingWindow() {
  const display = screen.getPrimaryDisplay();
  const { x, y, width } = display.workArea;
  floatingWindow.setPosition(x + width - FLOATING_WINDOW_WIDTH - 32, y + 80);
}

function createFloatingWindow() {
  floatingWindow = new BrowserWindow({
    width: FLOATING_WINDOW_WIDTH,
    height: 104,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    hasShadow: false,
    icon: iconPath,
    webPreferences: secureWebPreferences()
  });

  floatingWindow.loadFile(rendererPath, { query: { view: "floating" } });
  floatingWindow.once("ready-to-show", () => floatingWindow.show());
  floatingWindow.on("closed", () => {
    hideTooltipWindow();
    floatingWindow = null;
  });
  positionFloatingWindow();

  return floatingWindow;
}

function createTooltipWindow() {
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
  tooltipWindow.on("closed", () => {
    tooltipWindow = null;
  });
  return tooltipWindow;
}

function showTooltipWindow({ anchor, data }) {
  if (!anchor || !data) {
    return;
  }

  tooltipVisible = true;
  const window = tooltipWindow || createTooltipWindow();
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
  const sendAndShow = () => {
    if (!tooltipVisible || window.isDestroyed()) {
      return;
    }
    window.webContents.send("tooltip:update", { ...data, placement });
    window.showInactive();
  };

  if (window.webContents.isLoading()) {
    window.webContents.once("did-finish-load", sendAndShow);
  } else {
    sendAndShow();
  }
}

function hideTooltipWindow() {
  tooltipVisible = false;
  tooltipWindow?.hide();
}

function createMainWindow(initialTheme = "dark") {
  const dark = initialTheme !== "light";
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 860,
    minHeight: 560,
    show: false,
    backgroundColor: dark ? "#202123" : "#ffffff",
    title: "WinPlate",
    icon: iconPath,
    autoHideMenuBar: true,
    frame: false,
    webPreferences: secureWebPreferences()
  });

  mainWindow.loadFile(rendererPath, { query: { view: "main" } });
  mainWindow.once("ready-to-show", () => {
    if (mainWindow.__showWhenReady) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send("main:navigate", mainWindow.__pendingSection || "Dashboard");
      mainWindow.__showWhenReady = false;
      mainWindow.__pendingSection = null;
    }
  });
  mainWindow.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.on("maximize", () => mainWindow?.webContents.send("window:maximized", true));
  mainWindow.on("unmaximize", () => mainWindow?.webContents.send("window:maximized", false));

  return mainWindow;
}

function setMainWindowTheme(theme) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const dark = theme !== "light";
  mainWindow.setBackgroundColor(dark ? "#202123" : "#ffffff");
  mainWindow.setBackgroundMaterial?.("none");
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

function showMainWindow(section = "Dashboard") {
  if (!mainWindow) {
    createMainWindow();
  }

  if (mainWindow.webContents.isLoading()) {
    mainWindow.__showWhenReady = true;
    mainWindow.__pendingSection = section;
    return;
  }

  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send("main:navigate", section);
}

function showFloatingWindow() {
  if (!floatingWindow) {
    createFloatingWindow();
  } else {
    floatingWindow.show();
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
  createMainWindow,
  showMainWindow,
  showFloatingWindow,
  hideFloatingWindow,
  showTooltipWindow,
  hideTooltipWindow,
  setQuitting,
  setMainWindowTheme,
  minimizeMainWindow,
  toggleMaximizeMainWindow,
  closeMainWindow,
  setFloatingPinned,
  setFloatingPinInteractive
};
