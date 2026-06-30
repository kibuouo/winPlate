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
  let teardownPending = false;
  let destroyed = false;

  function copySettings() {
    return { ...settings };
  }

  function destroyMenuBar() {
    if (!menuBar) {
      teardownPending = false;
      return;
    }
    teardownPending = true;
    try {
      menuBar.destroy();
      menuBar = null;
      teardownPending = false;
    } catch (error) {
      reportError(error);
    }
  }

  return {
    apply(value, { strictLoginItem = false } = {}) {
      if (destroyed) {
        return copySettings();
      }

      const nextSettings = normalizeAppSettings(value);
      if (platform !== "darwin") {
        settings = nextSettings;
        return copySettings();
      }

      if (strictLoginItem) {
        applyLoginItem(nextSettings.launchAtLogin);
      } else {
        try {
          applyLoginItem(nextSettings.launchAtLogin);
        } catch (error) {
          reportError(error);
        }
      }
      settings = nextSettings;
      if (teardownPending) {
        destroyMenuBar();
        if (teardownPending) {
          return copySettings();
        }
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
      return !destroyed && !teardownPending && Boolean(menuBar?.ownsSender(sender));
    },

    setTemperature(value) {
      return destroyed || teardownPending
        ? undefined
        : menuBar?.setTemperature(value);
    },

    hide() {
      return destroyed || teardownPending ? undefined : menuBar?.hide();
    },

    refresh() {
      return destroyed || teardownPending ? undefined : menuBar?.refresh();
    },

    destroy() {
      destroyed = true;
      destroyMenuBar();
    }
  };
}

module.exports = { createAppPreferencesController };
