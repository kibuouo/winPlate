const path = require("path");
const { Menu, Tray, nativeImage } = require("electron");

function createTrayIcon() {
  return nativeImage
    .createFromPath(path.join(__dirname, "..", "..", "assets", "icon.png"))
    .resize({ width: 16, height: 16 });
}

function createAppTray(actions) {
  const tray = new Tray(createTrayIcon());
  tray.setToolTip("WinPlate");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Show WinPlate", click: actions.showMainWindow },
      { type: "separator" },
      { label: "Show Floating Window", click: actions.showFloatingWindow },
      { label: "Hide Floating Window", click: actions.hideFloatingWindow },
      { type: "separator" },
      { label: "Quit", click: actions.quit }
    ])
  );
  tray.on("double-click", actions.showMainWindow);
  return tray;
}

module.exports = { createAppTray };
