const { normalizeAppSettings } = require("./appSettings");

function createAppPreferencesController({
  platform,
  initialSettings,
  createMenuBar,
  applyLoginItem,
  showMainWindow,
  reportError
}) {
  let settings = normalizeAppSettings(initialSettings);
  let menuBar = null;
  let destroyed = false;

  function copySettings() {
    return { ...settings };
  }

  function destroyMenuBar() {
    if (!menuBar) {
      return;
    }
    const currentMenuBar = menuBar;
    menuBar = null;
    currentMenuBar.destroy();
  }

  return {
    apply(value) {
      if (destroyed) {
        return copySettings();
      }

      settings = normalizeAppSettings(value);
      if (platform !== "darwin") {
        return copySettings();
      }

      applyLoginItem(settings.launchAtLogin);
      if (!settings.menuBarEnabled) {
        destroyMenuBar();
        return copySettings();
      }

      if (!menuBar) {
        try {
          menuBar = createMenuBar();
        } catch (error) {
          reportError(error);
          showMainWindow("Dashboard");
        }
      }
      return copySettings();
    },

    getSettings() {
      return copySettings();
    },

    ownsSender(sender) {
      return !destroyed && Boolean(menuBar?.ownsSender(sender));
    },

    setTemperature(value) {
      return destroyed ? undefined : menuBar?.setTemperature(value);
    },

    hide() {
      return destroyed ? undefined : menuBar?.hide();
    },

    refresh() {
      return destroyed ? undefined : menuBar?.refresh();
    },

    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      destroyMenuBar();
    }
  };
}

module.exports = { createAppPreferencesController };
