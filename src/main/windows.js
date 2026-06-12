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
const CODEX_TOOLTIP_SIZE = { width: 230, height: 150 };
const GITHUB_TOOLTIP_SIZE = { width: 340, height: 248 };
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
  const display = screen.getDisplayNearestPoint({
    x: Math.round(anchor.x),
    y: Math.round(anchor.y)
  });
  const workArea = display.workArea;
  const tooltipSize = data.type === "github" ? GITHUB_TOOLTIP_SIZE : CODEX_TOOLTIP_SIZE;
  window.setSize(tooltipSize.width, tooltipSize.height);
  let x = Math.round(anchor.x + 22);
  let y = Math.round(anchor.y + anchor.height + 8);

  if (floatingWindow && !floatingWindow.isDestroyed()) {
    const floatingBounds = floatingWindow.getBounds();
    y = Math.max(y, floatingBounds.y + floatingBounds.height + 8);
  }

  x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - tooltipSize.width));
  if (y + tooltipSize.height > workArea.y + workArea.height) {
    y = Math.round(anchor.y - tooltipSize.height - 8);
  }
  y = Math.max(workArea.y, y);

  window.setPosition(x, y);
  const sendAndShow = () => {
    if (!tooltipVisible || window.isDestroyed()) {
      return;
    }
    window.webContents.send("tooltip:update", data);
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

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 860,
    minHeight: 560,
    show: false,
    backgroundColor: "#09090b",
    title: "WinPlate",
    icon: iconPath,
    autoHideMenuBar: true,
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

  return mainWindow;
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
  setFloatingPinned,
  setFloatingPinInteractive
};
