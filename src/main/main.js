const path = require("path");
const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  safeStorage,
  screen,
  session,
  shell,
  Tray
} = require("electron");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
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
  closeMainWindow,
  ownsMainWindowSender
} = require("./windows");
const { createAppTray } = require("./tray");
const { createMacMenuBar } = require("./macMenuBar");
const { startupPolicy } = require("./startupPolicy");
const { startPythonService, stopPythonService } = require("./pythonService");
const { readCodexUsage } = require("./codexUsage");
const {
  normalizeBaseUrl: normalizeDeepSeekBaseUrl,
  readDeepSeekUsage
} = require("./deepseekUsage");
const {
  readAppearanceSettings,
  writeAppearanceSettings
} = require("./appearanceSettings");
const {
  DEFAULT_APP_SETTINGS,
  readAppSettings,
  writeAppSettings,
  applyLoginItemSetting
} = require("./appSettings");
const { readInitialAppSettings } = require("./appSettingsStartup");
const { createAppPreferencesController } = require("./appPreferencesController");
const {
  DEFAULT_SERVICE_SETTINGS,
  readServiceSettings,
  writeServiceSettings,
  resolveServiceSettings,
  publicServiceSettings,
  toServiceEnvironment
} = require("./serviceSettings");
const {
  createServiceSettingsLifecycle,
  safeObject
} = require("./serviceSettingsLifecycle");
const { registerSettingsIpc } = require("./settingsIpc");
const {
  loadExternalServiceEnvironment,
  readWindowsServiceEnvironment
} = require("./windowsEnvironment");

let tray;
let appPreferences = null;
const execFileAsync = promisify(execFile);
const STATUS_CACHE_TTL_MS = 5_000;
const WEATHER_USAGE_CACHE_TTL_MS = 5 * 60_000;
const MAX_RESPONSE_CACHE_ENTRIES = 16;
const responseCaches = new Map();
const appIconPath = path.join(__dirname, "..", "..", "assets", "icon.png");
const processServiceEnvironment = Object.freeze({
  QWEATHER_API_KEY: process.env.QWEATHER_API_KEY,
  QWEATHER_API_HOST: process.env.QWEATHER_API_HOST,
  QWEATHER_PROJECT_ID: process.env.QWEATHER_PROJECT_ID,
  QWEATHER_CREDENTIAL_ID: process.env.QWEATHER_CREDENTIAL_ID,
  QWEATHER_PRIVATE_KEY: process.env.QWEATHER_PRIVATE_KEY,
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
  DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL
});

function quitApplication() {
  setQuitting(true);
  app.quit();
}

function setResponseCache(key, value) {
  responseCaches.delete(key);
  responseCaches.set(key, value);
  while (responseCaches.size > MAX_RESPONSE_CACHE_ENTRIES) {
    responseCaches.delete(responseCaches.keys().next().value);
  }
}

async function fetchJsonCached(key, url, ttlMs) {
  const now = Date.now();
  const cached = responseCaches.get(key);
  if (cached?.value && now - cached.updatedAt < ttlMs) {
    return cached.value;
  }
  if (cached?.promise) {
    return cached.promise;
  }

  const promise = fetch(url).then(async (response) => {
    if (!response.ok) {
      throw new Error(`${key} failed: HTTP ${response.status}`);
    }
    const value = await response.json();
    setResponseCache(key, { value, updatedAt: Date.now() });
    return value;
  }).catch((error) => {
    responseCaches.delete(key);
    throw error;
  });
  setResponseCache(key, {
    value: cached?.value,
    updatedAt: cached?.updatedAt || 0,
    promise
  });
  return promise;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", showMainWindow);

  app.whenReady().then(async () => {
    const userDataPath = app.getPath("userData");
    const externalServiceEnvironment = Object.freeze(
      await loadExternalServiceEnvironment({
        platform: process.platform,
        processEnvironment: processServiceEnvironment,
        readLegacyEnvironment: () => readWindowsServiceEnvironment(execFileAsync)
      })
    );
    const serviceSettingsLifecycle = createServiceSettingsLifecycle({
      defaults: DEFAULT_SERVICE_SETTINGS,
      externalEnvironment: externalServiceEnvironment,
      targetEnvironment: process.env,
      read: () => readServiceSettings(userDataPath, safeStorage),
      write: (settings) => writeServiceSettings(userDataPath, settings, safeStorage),
      resolve: resolveServiceSettings,
      publicProjection: publicServiceSettings,
      toEnvironment: toServiceEnvironment,
      reportError: (message) => console.error(message)
    });

    if (process.platform === "darwin") {
      app.dock.setIcon(nativeImage.createFromPath(appIconPath));
    }
    session.defaultSession.setPermissionCheckHandler((_webContents, permission) => permission === "geolocation");
    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      callback(permission === "geolocation");
    });
    await serviceSettingsLifecycle.loadForStartup();
    try {
      await startPythonService();
    } catch (error) {
      console.error(error.message);
    }
    const appearanceSettings = await readAppearanceSettings(userDataPath);
    const initialTheme = appearanceSettings.theme === "system"
      ? (nativeTheme.shouldUseDarkColors ? "dark" : "light")
      : appearanceSettings.theme;
    ipcMain.handle("appearance:get-settings", () => (
      readAppearanceSettings(userDataPath)
    ));
    ipcMain.handle("appearance:save-settings", (_event, settings) => (
      writeAppearanceSettings(userDataPath, settings)
    ));
    createMainWindow(initialTheme);
    const policy = startupPolicy();
    app.on("activate", showMainWindow);
    const initialAppSettings = await readInitialAppSettings({
      read: () => readAppSettings(userDataPath),
      defaults: DEFAULT_APP_SETTINGS,
      reportError: (message) => console.error(message)
    });

    appPreferences = createAppPreferencesController({
      platform: policy.createMacMenuBar ? "darwin" : process.platform,
      initialSettings: initialAppSettings,
      createMenuBar: () => createMacMenuBar({
        BrowserWindow,
        Menu,
        Tray,
        nativeImage,
        screen,
        preloadPath: path.join(__dirname, "..", "preload", "menuBarPreload.js"),
        rendererPath: path.join(__dirname, "..", "renderer", "menubar.html"),
        iconPath: path.join(__dirname, "..", "..", "assets", "icon-transparent.png"),
        actions: {
          showMainWindow,
          quit: quitApplication
        }
      }),
      applyLoginItem: (enabled) => applyLoginItemSetting(app, enabled),
      showMainWindow,
      reportError: (error) => console.error(error.message)
    });
    appPreferences.apply(appPreferences.getSettings());

    registerSettingsIpc({
      ipcMain,
      ownsMainWindowSender,
      getAppPreferences: () => appPreferences,
      userDataPath,
      writeAppSettings,
      serviceSettingsLifecycle,
      normalizeDeepSeekBaseUrl,
      defaultDeepSeekBaseUrl: DEFAULT_SERVICE_SETTINGS.deepseekBaseUrl,
      readDeepSeekUsage,
      publicServiceSettings,
      safeObject
    });

    if (policy.createFloatingWindow) {
      createFloatingWindow();
      ipcMain.handle("floating:set-pinned", (_event, value) => setFloatingPinned(value));
      ipcMain.on("floating:pin-interactive", (_event, value) => {
        setFloatingPinInteractive(value);
      });
      ipcMain.on("tooltip:show", (_event, payload) => showTooltipWindow(payload));
      ipcMain.on("tooltip:hide", hideTooltipWindow);
    }

    if (policy.createWindowsTray) {
      tray = createAppTray({
        showMainWindow,
        showFloatingWindow,
        hideFloatingWindow,
        quit: quitApplication
      });
    }

    ipcMain.on("window:show-main", (_event, section) => showMainWindow(section));
    ipcMain.on("menubar:update-temperature", (event, payload) => {
      if (appPreferences?.ownsSender(event.sender)) {
        appPreferences.setTemperature(payload);
      }
    });
    ipcMain.on("menubar:hide", (event) => {
      if (appPreferences?.ownsSender(event.sender)) {
        appPreferences.hide();
      }
    });
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
    ipcMain.handle("status:get", () => (
      fetchJsonCached("Status", "http://127.0.0.1:8765/api/status", STATUS_CACHE_TTL_MS)
    ));
    ipcMain.handle("weather:set-location", async (_event, location) => {
      const latitude = Number(location?.latitude);
      const longitude = Number(location?.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        throw new Error("Invalid weather coordinates");
      }
      const response = await fetch("http://127.0.0.1:8765/api/weather/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ latitude, longitude })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const detail = payload?.detail ? `: ${payload.detail}` : "";
        throw new Error(`Weather refresh failed: HTTP ${response.status}${detail}`);
      }
      return response.json();
    });
    ipcMain.handle("weather:get-usage", () => (
      fetchJsonCached(
        "QWeather usage",
        "http://127.0.0.1:8765/api/weather/usage",
        WEATHER_USAGE_CACHE_TTL_MS
      )
    ));
    ipcMain.handle("weather:refresh-official-usage", async () => {
      const response = await fetch("http://127.0.0.1:8765/api/weather/usage/official", { method: "POST" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail || `QWeather official usage failed: HTTP ${response.status}`);
      }
      return response.json();
    });
    ipcMain.handle("codex:usage", (_event, options) => readCodexUsage(options));
    ipcMain.on("window:set-theme", (_event, theme) => setMainWindowTheme(theme));
    ipcMain.on("window:minimize", minimizeMainWindow);
    ipcMain.handle("window:toggle-maximize", toggleMaximizeMainWindow);
    ipcMain.on("window:close", closeMainWindow);
  });

  app.on("before-quit", () => {
    setQuitting(true);
    appPreferences?.destroy();
    appPreferences = null;
    stopPythonService();
  });
  app.on("window-all-closed", (event) => event.preventDefault());
}
