const { Menu, Tray, nativeImage } = require("electron");
const { assetPath } = require("./repositoryPaths");

let appTray;

function createTrayIcon() {
  return nativeImage
    .createFromPath(assetPath("icon.png"))
    .resize({ width: 16, height: 16 });
}

function createAppTray(actions) {
  try {
    if (appTray && !appTray.isDestroyed()) return appTray;
  } catch {
    appTray = null;
  }

  const tray = new Tray(createTrayIcon());
  appTray = tray;
  tray.setToolTip("WinPlate");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "打开 WinPlate", click: () => actions.showMainWindow("Dashboard") },
      { type: "separator" },
      { label: "显示浮窗", click: actions.showFloatingWindow },
      { label: "隐藏浮窗", click: actions.hideFloatingWindow },
      { type: "separator" },
      { label: "退出", click: actions.quit }
    ])
  );
  tray.on("double-click", () => actions.showMainWindow("Dashboard"));
  return tray;
}

module.exports = { createAppTray };
