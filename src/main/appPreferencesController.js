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
    try {
      menuBar.destroy();
      menuBar = null;
    } catch (error) {
      reportError(error);
    }
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

      try {
        applyLoginItem(settings.launchAtLogin);
      } catch (error) {
        reportError(error);
      }
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
      destroyed = true;
      destroyMenuBar();
    }
  };
}

module.exports = { createAppPreferencesController };
