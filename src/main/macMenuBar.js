const {
  DEFAULT_PANEL_SIZE,
  formatTemperatureTitle,
  getMenuBarPanelBounds
} = require("./menuBarState");

function isObjectLike(value) {
  return value !== null && (typeof value === "object" || typeof value === "function");
}

function validateConstructor(value, name) {
  if (typeof value !== "function") {
    throw new TypeError(`${name} must be a constructor`);
  }

  try {
    Reflect.construct(Object, [], value);
  } catch {
    throw new TypeError(`${name} must be a constructor`);
  }
}

function validateMethod(owner, method, name) {
  if (!isObjectLike(owner) || typeof owner[method] !== "function") {
    throw new TypeError(`${name} must be a function`);
  }
}

function validatePath(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

function validatePrototypeMethods(Constructor, name, methods) {
  for (const method of methods) {
    validateMethod(
      Constructor.prototype,
      method,
      `${name}.prototype.${method}`
    );
  }
}

function validateDependencies(dependencies) {
  if (!isObjectLike(dependencies)) {
    throw new TypeError("dependencies must be an object");
  }

  validateConstructor(dependencies.BrowserWindow, "BrowserWindow");
  validatePrototypeMethods(dependencies.BrowserWindow, "BrowserWindow", [
    "loadFile",
    "on",
    "removeListener",
    "isVisible",
    "isDestroyed",
    "setBounds",
    "show",
    "focus",
    "hide",
    "destroy"
  ]);
  validateMethod(dependencies.Menu, "buildFromTemplate", "Menu.buildFromTemplate");
  validateConstructor(dependencies.Tray, "Tray");
  validatePrototypeMethods(dependencies.Tray, "Tray", [
    "setToolTip",
    "setTitle",
    "setIgnoreDoubleClickEvents",
    "on",
    "removeListener",
    "getBounds",
    "popUpContextMenu",
    "destroy",
    "isDestroyed"
  ]);
  validateMethod(
    dependencies.nativeImage,
    "createFromPath",
    "nativeImage.createFromPath"
  );
  validateMethod(
    dependencies.screen,
    "getDisplayNearestPoint",
    "screen.getDisplayNearestPoint"
  );
  validateMethod(
    dependencies.actions,
    "showMainWindow",
    "actions.showMainWindow"
  );
  validateMethod(dependencies.actions, "quit", "actions.quit");
  validatePath(dependencies.preloadPath, "preloadPath");
  validatePath(dependencies.rendererPath, "rendererPath");
  validatePath(dependencies.iconPath, "iconPath");
}

function safelyDestroy(resource) {
  if (!resource) {
    return;
  }

  try {
    if (!resource.isDestroyed()) {
      resource.destroy();
    }
  } catch {
    // Preserve the initialization error if cleanup also fails.
  }
}

function createMacMenuBar(dependencies) {
  validateDependencies(dependencies);
  const {
    BrowserWindow,
    Menu,
    Tray,
    nativeImage,
    screen,
    preloadPath,
    rendererPath,
    iconPath,
    actions
  } = dependencies;
  const sourceIcon = nativeImage.createFromPath(iconPath);
  validateMethod(
    sourceIcon,
    "resize",
    "nativeImage.createFromPath result.resize"
  );
  const icon = sourceIcon.resize({ width: 16, height: 16 });

  let tray;
  let panel;

  try {
    tray = new Tray(icon);
    tray.setToolTip("WinPlate");
    tray.setTitle("--°");
    tray.setIgnoreDoubleClickEvents(true);

    panel = new BrowserWindow({
      ...DEFAULT_PANEL_SIZE,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      hasShadow: true,
      vibrancy: "popover",
      visualEffectState: "active",
      webPreferences: {
        preload: preloadPath,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    });
    validateMethod(
      panel.webContents,
      "send",
      "BrowserWindow.webContents.send"
    );

    let teardownRequested = false;
    let destroyed = false;
    let loadFailed = false;
    let panelReady = false;
    let pendingRefresh = false;
    let pendingShow = false;

    function showPanel() {
      if (
        teardownRequested ||
        loadFailed ||
        !panelReady ||
        panel.isDestroyed() ||
        tray.isDestroyed()
      ) {
        return;
      }

      const trayBounds = tray.getBounds();
      const display = screen.getDisplayNearestPoint({
        x: Math.round(trayBounds.x + trayBounds.width / 2),
        y: Math.round(trayBounds.y + trayBounds.height)
      });
      panel.setBounds(getMenuBarPanelBounds(trayBounds, display.workArea));
      panel.show();
      panel.focus();
    }

    function hide() {
      pendingShow = false;
      if (!teardownRequested && !panel.isDestroyed()) {
        panel.hide();
      }
    }

    function refresh() {
      if (teardownRequested || loadFailed || panel.isDestroyed()) {
        return;
      }

      if (!panelReady) {
        pendingRefresh = true;
        return;
      }

      panel.webContents.send("menubar:refresh");
    }

    function handleClick() {
      if (teardownRequested || loadFailed || panel.isDestroyed()) {
        return;
      }

      if (!panelReady) {
        pendingShow = !pendingShow;
        return;
      }

      if (panel.isVisible()) {
        hide();
        return;
      }

      showPanel();
    }

    function handleRightClick() {
      if (teardownRequested || tray.isDestroyed()) {
        return;
      }

      const menu = Menu.buildFromTemplate([
        { label: "Open WinPlate", click: () => actions.showMainWindow("Dashboard") },
        { label: "Settings", click: () => actions.showMainWindow("Settings") },
        { label: "Refresh", click: refresh },
        { type: "separator" },
        { label: "Quit", click: actions.quit }
      ]);
      tray.popUpContextMenu(menu);
    }

    function setTemperature(value) {
      const title = formatTemperatureTitle(value);
      if (!teardownRequested && !tray.isDestroyed()) {
        tray.setTitle(title);
      }
      return title;
    }

    function ownsSender(sender) {
      return !teardownRequested && !panel.isDestroyed() && sender === panel.webContents;
    }

    function destroy() {
      if (destroyed) {
        return;
      }

      teardownRequested = true;
      pendingRefresh = false;
      pendingShow = false;
      let firstError;
      function attempt(operation) {
        try {
          operation();
        } catch (error) {
          firstError ??= error;
        }
      }

      if (!panel.isDestroyed()) {
        attempt(() => panel.removeListener("blur", hide));
      }
      if (!tray.isDestroyed()) {
        attempt(() => tray.removeListener("click", handleClick));
        attempt(() => tray.removeListener("right-click", handleRightClick));
      }

      if (!panel.isDestroyed()) {
        attempt(() => panel.destroy());
      }
      if (!tray.isDestroyed()) {
        attempt(() => tray.destroy());
      }

      destroyed = panel.isDestroyed() && tray.isDestroyed();
      if (firstError) {
        throw firstError;
      }
    }

    panel.on("blur", hide);
    tray.on("click", handleClick);
    tray.on("right-click", handleRightClick);

    function handleLoadSuccess() {
      if (teardownRequested || panel.isDestroyed()) {
        return;
      }

      panelReady = true;
      if (pendingRefresh) {
        pendingRefresh = false;
        refresh();
      }

      if (pendingShow) {
        pendingShow = false;
        showPanel();
      }
    }

    function handleLoadFailure() {
      loadFailed = true;
      pendingRefresh = false;
      pendingShow = false;
    }

    try {
      Promise.resolve(panel.loadFile(rendererPath))
        .then(handleLoadSuccess)
        .catch(handleLoadFailure);
    } catch {
      handleLoadFailure();
    }

    return {
      toggle: handleClick,
      setTemperature,
      refresh,
      hide,
      ownsSender,
      destroy
    };
  } catch (error) {
    safelyDestroy(panel);
    safelyDestroy(tray);
    throw error;
  }
}

module.exports = { createMacMenuBar };
