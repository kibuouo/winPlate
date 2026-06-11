const path = require("path");
const { BrowserWindow, screen } = require("electron");

let floatingWindow;
let mainWindow;
let quitting = false;

const rendererPath = path.join(__dirname, "..", "renderer", "index.html");
const preloadPath = path.join(__dirname, "..", "preload", "preload.js");
const iconPath = path.join(__dirname, "..", "..", "assets", "icon.ico");
const FLOATING_WINDOW_WIDTH = 460;
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
    floatingWindow = null;
  });
  positionFloatingWindow();

  return floatingWindow;
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
  setQuitting,
  setFloatingPinned,
  setFloatingPinInteractive
};
