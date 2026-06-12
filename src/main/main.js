const { app, ipcMain, shell } = require("electron");
const {
  createFloatingWindow,
  createMainWindow,
  showMainWindow,
  showFloatingWindow,
  hideFloatingWindow,
  setQuitting,
  setFloatingPinned,
  setFloatingPinInteractive,
  showTooltipWindow,
  hideTooltipWindow,
  setMainWindowTheme,
  minimizeMainWindow,
  toggleMaximizeMainWindow,
  closeMainWindow
} = require("./windows");
const { createAppTray } = require("./tray");
const { startPythonService, stopPythonService } = require("./pythonService");
const { readCodexUsage } = require("./codexUsage");

let tray;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", showMainWindow);

  app.whenReady().then(async () => {
    try {
      await startPythonService();
    } catch (error) {
      console.error(error.message);
    }
    createMainWindow();
    createFloatingWindow();

    tray = createAppTray({
      showMainWindow,
      showFloatingWindow,
      hideFloatingWindow,
      quit: () => {
        setQuitting(true);
        app.quit();
      }
    });

    ipcMain.on("window:show-main", (_event, section) => showMainWindow(section));
    ipcMain.on("github:open-profile", (_event, url) => {
      if (typeof url === "string" && /^https:\/\/github\.com\/[^/]+\/?$/.test(url)) {
        shell.openExternal(url);
      }
    });
    ipcMain.handle("github:refresh", async () => {
      const response = await fetch("http://127.0.0.1:8765/api/github/refresh", { method: "POST" });
      if (!response.ok) {
        throw new Error(`GitHub refresh failed: HTTP ${response.status}`);
      }
      return response.json();
    });
    ipcMain.handle("codex:usage", (_event, options) => readCodexUsage(options));
    ipcMain.on("window:set-theme", (_event, theme) => setMainWindowTheme(theme));
    ipcMain.on("window:minimize", minimizeMainWindow);
    ipcMain.handle("window:toggle-maximize", toggleMaximizeMainWindow);
    ipcMain.on("window:close", closeMainWindow);
    ipcMain.handle("floating:set-pinned", (_event, value) => setFloatingPinned(value));
    ipcMain.on("floating:pin-interactive", (_event, value) => {
      setFloatingPinInteractive(value);
    });
    ipcMain.on("tooltip:show", (_event, payload) => showTooltipWindow(payload));
    ipcMain.on("tooltip:hide", hideTooltipWindow);
    app.on("activate", showMainWindow);
  });

  app.on("before-quit", () => {
    setQuitting(true);
    stopPythonService();
  });
  app.on("window-all-closed", (event) => event.preventDefault());
}
