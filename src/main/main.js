const { app, ipcMain } = require("electron");
const {
  createFloatingWindow,
  createMainWindow,
  showMainWindow,
  showFloatingWindow,
  hideFloatingWindow,
  setQuitting,
  setFloatingPinned,
  setFloatingPinInteractive
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
    ipcMain.on("github:open-profile", () => {
      console.log("open github profile");
    });
    ipcMain.on("github:refresh", () => {
      console.log("refresh github profile");
    });
    ipcMain.handle("codex:usage", (_event, options) => readCodexUsage(options));
    ipcMain.handle("floating:set-pinned", (_event, value) => setFloatingPinned(value));
    ipcMain.on("floating:pin-interactive", (_event, value) => {
  setFloatingPinInteractive(value);
});
    app.on("activate", showMainWindow);
  });

  app.on("before-quit", () => {
    setQuitting(true);
    stopPythonService();
  });
  app.on("window-all-closed", (event) => event.preventDefault());
}
