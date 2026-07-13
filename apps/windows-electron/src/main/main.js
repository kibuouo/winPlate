const {
  app,
  BrowserWindow,
  clipboard,
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
const http = require("node:http");
const path = require("node:path");
const { promisify } = require("node:util");
const { assetPath } = require("./repositoryPaths");
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
  setAppWindowOpacity,
  minimizeMainWindow,
  toggleMaximizeMainWindow,
  closeMainWindow,
  ownsMainWindowSender,
  ownsFloatingWindowSender,
  sendToWindow
} = require("./windows");
const { createActivationCoordinator } = require("./activationCoordinator");
const { normalizeWeatherCoordinates } = require("./weatherCoordinates");
const { createMacMenuBar } = require("@winplate/macos-electron-menubar");
const macMenuBarPaths = require("@winplate/macos-electron-menubar/paths");
const { startupPolicy } = require("./startupPolicy");
const { createAppTray } = require("./tray");
const { registerWindowsDesktopApp } = require("./desktopAppRegistration");
const { startPythonService, stopPythonService } = require("./pythonService");
const { readCodexUsage } = require("./codexUsage");
const { readNetworkSpeed } = require("./networkSpeed");
const {
  DEFAULT_BASE_URL: DEEPSEEK_DEFAULT_BASE_URL,
  normalizeBaseUrl: normalizeDeepSeekBaseUrl,
  readDeepSeekUsage
} = require("./deepseekUsage");
const { DEFAULT_MODEL: DEEPSEEK_CHAT_MODEL, callDeepSeekChat, testDeepSeekChat } = require("./deepseekChatClient");
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
  serviceSettingsFileExists,
  readServiceSettings,
  writeServiceSettings,
  resolveServiceSettings,
  publicServiceSettings,
  toServiceEnvironment
} = require("./serviceSettings");
const { createServiceSettingsMigration } = require("./serviceSettingsMigration");
const {
  createServiceSettingsLifecycle,
  safeObject
} = require("./serviceSettingsLifecycle");
const { registerSettingsIpc } = require("./settingsIpc");
const { readWindowsServiceEnvironment } = require("./windowsEnvironment");
const {
  readDeepSeekTokenUsage,
  recordDeepSeekTokenUsage
} = require("./deepseekTokenUsage");
const { createNotificationStore } = require("./notifications/notificationStore");
const { createNotificationDetailService } = require("./notifications/detailService");
const { createNotificationSummaryService } = require("./ai/notificationSummaryService");
const { mainModules, validateMainModules } = require("./modules");
const { readSettings, writeSettings } = require("./settingsStore");
const MODULES = validateMainModules().map((module) => module.meta);

let tray;
let appPreferences = null;
const activationCoordinator = createActivationCoordinator(showMainWindow);
const execFileAsync = promisify(execFile);
const STATUS_CACHE_TTL_MS = 5_000;
const WEATHER_USAGE_CACHE_TTL_MS = 5 * 60_000;
const WEATHER_ALERT_CACHE_TTL_MS = 10 * 60_000;
const MAIL_CACHE_TTL_MS = 60_000;
const NOTIFICATION_CACHE_TTL_MS = 5_000;
const LOCAL_API_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_CACHE_ENTRIES = 16;
const responseCaches = new Map();
const macAppIconPath = assetPath("icon-macos.png");
const processServiceEnvironment = Object.freeze({
  QWEATHER_API_KEY: process.env.QWEATHER_API_KEY,
  QWEATHER_API_HOST: process.env.QWEATHER_API_HOST,
  QWEATHER_PROJECT_ID: process.env.QWEATHER_PROJECT_ID,
  QWEATHER_CREDENTIAL_ID: process.env.QWEATHER_CREDENTIAL_ID,
  QWEATHER_PRIVATE_KEY: process.env.QWEATHER_PRIVATE_KEY,
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
  DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL,
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  QQ_MAIL_ADDRESS: process.env.QQ_MAIL_ADDRESS,
  QQ_MAIL_AUTH_CODE: process.env.QQ_MAIL_AUTH_CODE,
  QQ_MAIL_IMAP_HOST: process.env.QQ_MAIL_IMAP_HOST,
  QQ_MAIL_IMAP_PORT: process.env.QQ_MAIL_IMAP_PORT,
  QQ_MAIL_SMTP_HOST: process.env.QQ_MAIL_SMTP_HOST,
  QQ_MAIL_SMTP_PORT: process.env.QQ_MAIL_SMTP_PORT
});
const responseCacheVersions = new Map();
let notificationSummaryService = null;
let notificationDetailService = null;
let currentSettings = null;
let serviceSettingsLifecycle = null;
const desktopIconPath = assetPath("icon.ico");

function broadcastStatusRefresh(weather = null) {
  BrowserWindow.getAllWindows().forEach((window) => {
    sendToWindow(window, "status:refresh", weather ? { weather } : null);
  });
}

function broadcastNotificationDigest(digest) {
  BrowserWindow.getAllWindows().forEach((window) => {
    sendToWindow(window, "notification:digest-updated", digest);
  });
}

function broadcastSettingsUpdated(settings) {
  BrowserWindow.getAllWindows().forEach((window) => {
    sendToWindow(window, "settings:updated", settings);
  });
}

function scheduleNotificationDigestRefresh() {
  notificationSummaryService?.scheduleRefresh().catch((error) => {
    console.warn("notification digest refresh failed:", error.message);
  });
}

function clearNotificationCaches() {
  responseCaches.delete("Notifications");
}

function clearMailCaches() {
  responseCaches.delete("Mail outline");
}

function clearWeatherAlertCaches() {
  responseCaches.delete("QWeather alerts");
}

async function fetchMailMessageByUid(uid, { markRead = false } = {}) {
  const messageUid = typeof uid === "string" || typeof uid === "number" ? String(uid).trim() : "";
  if (!messageUid) {
    throw new Error("邮件 UID 不能为空");
  }
  const method = markRead ? "POST" : "GET";
  const response = await fetchWithTimeout(
    `http://127.0.0.1:8765/api/mail/messages/${encodeURIComponent(messageUid)}${markRead ? "/read" : ""}`,
    { method }
  );
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.detail || `邮件读取失败: HTTP ${response.status}`);
  }
  const message = await response.json();
  if (markRead) {
    clearMailCaches();
    clearNotificationCaches();
    scheduleNotificationDigestRefresh();
  }
  return message;
}

async function fetchWeatherAlertById(alertId) {
  const safeAlertId = typeof alertId === "string" || typeof alertId === "number" ? String(alertId).trim() : "";
  if (!safeAlertId) {
    throw new Error("天气预警 ID 不能为空");
  }
  const response = await fetch(`http://127.0.0.1:8765/api/weather/alerts/${encodeURIComponent(safeAlertId)}`);
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.detail || `天气预警读取失败: HTTP ${response.status}`);
  }
  return response.json();
}

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

function invalidateResponseCache(key) {
  responseCaches.delete(key);
  responseCacheVersions.set(key, (responseCacheVersions.get(key) || 0) + 1);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = LOCAL_API_TIMEOUT_MS) {
  if (String(url).startsWith("http://127.0.0.1:8765/")) {
    return fetchLocalApi(url, options, timeoutMs);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function fetchLocalApi(url, options = {}, timeoutMs = LOCAL_API_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const request = http.request({
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: options.method || "GET",
      headers: options.headers || {}
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        const status = Number(response.statusCode) || 0;
        resolve({
          ok: status >= 200 && status < 300,
          status,
          json: async () => JSON.parse(body),
          text: async () => body
        });
      });
    });
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
    });
    request.on("error", reject);
    if (options.body !== undefined) request.write(options.body);
    request.end();
  });
}

async function readJsonWithTimeout(response, label, timeoutMs = LOCAL_API_TIMEOUT_MS) {
  let timeout = null;
  const timeoutPromise = new Promise((resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} response timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([response.json(), timeoutPromise]);
  } finally {
    clearTimeout(timeout);
  }
}

async function syncWeatherAlertsIntoNotifications() {
  try {
    await fetchJsonCached(
      "QWeather alerts",
      "http://127.0.0.1:8765/api/weather/alerts",
      WEATHER_ALERT_CACHE_TTL_MS
    );
    invalidateResponseCache("Notifications");
  } catch (error) {
    console.warn("QWeather alert sync skipped:", error.message);
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

  const cacheVersion = responseCacheVersions.get(key) || 0;
  const promise = fetchWithTimeout(url).then(async (response) => {
    if (!response.ok) {
      throw new Error(`${key} failed: HTTP ${response.status}`);
    }
    const value = await readJsonWithTimeout(response, key);
    if ((responseCacheVersions.get(key) || 0) === cacheVersion) {
      setResponseCache(key, { value, updatedAt: Date.now() });
    }
    return value;
  }).catch((error) => {
    if ((responseCacheVersions.get(key) || 0) === cacheVersion) {
      responseCaches.delete(key);
    }
    throw error;
  });
  setResponseCache(key, {
    value: cached?.value,
    updatedAt: cached?.updatedAt || 0,
    promise
  });
  return promise;
}

async function writeUserEnvironment(name, value) {
  if (process.platform !== "win32") {
    process.env[name] = value;
    return;
  }
  await execFileAsync("reg.exe", [
    "add", "HKCU\\Environment", "/v", name, "/t", "REG_SZ", "/d", value, "/f"
  ], { windowsHide: true });
  process.env[name] = value;
}

function validateSettingsInput(settings = {}) {
  const username = String(settings?.integrations?.github?.username || "").trim();
  if (username && !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(username)) {
    throw new Error("GitHub 用户名格式无效");
  }
  const opacity = settings?.appearance?.opacity;
  if (opacity !== undefined && (!Number.isFinite(Number(opacity)) || Number(opacity) < 0.65 || Number(opacity) > 1)) {
    throw new Error("透明度必须介于 0.65 和 1 之间");
  }
  if (settings?.appearance?.density !== undefined && !["comfortable", "compact"].includes(settings.appearance.density)) {
    throw new Error("界面密度无效");
  }
  const refreshSeconds = settings?.modules?.refreshSeconds || {};
  MODULES.forEach((module) => {
    if (refreshSeconds[module.id] === undefined) return;
    const seconds = Number(refreshSeconds[module.id]);
    if (!Number.isFinite(seconds) || seconds < module.minRefreshSeconds || seconds > module.maxRefreshSeconds) {
      throw new Error(`${module.title} 刷新周期必须介于 ${module.minRefreshSeconds} 和 ${module.maxRefreshSeconds} 秒之间`);
    }
  });
}

async function publicSettingsPayload(settings = currentSettings) {
  const servicePublicSettings = serviceSettingsLifecycle.publicSettings();
  return {
    ...settings,
    integrations: {
      ...settings.integrations,
      github: {
        ...settings.integrations.github,
        hasToken: Boolean(servicePublicSettings.hasGitHubToken)
      }
    }
  };
}

async function recordDeepSeekTokenUsageSafely(usage, feature = "unknown") {
  try {
    await recordDeepSeekTokenUsage(app.getPath("userData"), usage, { feature });
  } catch (error) {
    console.warn("deepseek token usage record failed:", error.message);
  }
}
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", activationCoordinator.onSecondInstance);
  app.on("activate", activationCoordinator.onActivate);

  app.whenReady().then(async () => {
    const userDataPath = app.getPath("userData");
    const serviceSettingsMigration = await createServiceSettingsMigration({
      platform: process.platform,
      hasPersistedSettings: () => serviceSettingsFileExists(userDataPath),
      readStoredSettings: () => readServiceSettings(userDataPath, safeStorage),
      writeStoredSettings: (settings) => (
        writeServiceSettings(userDataPath, settings, safeStorage)
      ),
      readLegacyEnvironment: () => readWindowsServiceEnvironment(execFileAsync),
      resolveSettings: resolveServiceSettings,
      reportError: (message) => console.error(message)
    });
    serviceSettingsLifecycle = createServiceSettingsLifecycle({
      defaults: DEFAULT_SERVICE_SETTINGS,
      externalEnvironment: processServiceEnvironment,
      targetEnvironment: process.env,
      read: serviceSettingsMigration.read,
      write: serviceSettingsMigration.write,
      resolve: resolveServiceSettings,
      publicProjection: publicServiceSettings,
      toEnvironment: toServiceEnvironment,
      reportError: (message) => console.error(message)
    });

    try {
      await registerWindowsDesktopApp({
        app,
        shell,
        iconPath: desktopIconPath
      });
    } catch (error) {
      console.warn("WinPlate desktop app registration skipped:", error.message);
    }
    if (process.platform === "darwin") {
      app.dock.setIcon(nativeImage.createFromPath(macAppIconPath));
    }
    session.defaultSession.setPermissionCheckHandler((_webContents, permission) => permission === "geolocation");
    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      callback(permission === "geolocation");
    });
    await serviceSettingsLifecycle.loadForStartup();
    try {
      await startPythonService({
        isPackaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        userDataPath: app.getPath("userData")
      });
    } catch (error) {
      console.error(error.message);
    }
    currentSettings = await readSettings(userDataPath);
    const initialTheme = currentSettings.appearance.theme === "system"
      ? (nativeTheme.shouldUseDarkColors ? "dark" : "light")
      : currentSettings.appearance.theme;
    const restartPythonBackend = async () => {
      stopPythonService();
      try {
        await startPythonService({
          isPackaged: app.isPackaged,
          resourcesPath: process.resourcesPath,
          userDataPath
        });
      } catch (error) {
        console.error(error.message);
      }
    };
    const serviceSettingsRequireBackendRestart = new Set([
      "qweatherApiKey",
      "qweatherApiHost",
      "qweatherProjectId",
      "qweatherCredentialId",
      "qweatherPrivateKey",
      "githubToken",
      "qqMailAddress",
      "qqMailAuthCode",
      "qqMailImapHost",
      "qqMailImapPort",
      "qqMailSmtpHost",
      "qqMailSmtpPort"
    ]);

    function requireMainWindowSender(event) {
      if (!ownsMainWindowSender(event.sender)) {
        throw new Error("Unauthorized settings sender");
      }
    }

    function requireFloatingWindowSender(event) {
      if (!ownsFloatingWindowSender(event.sender)) {
        throw new Error("Unauthorized floating sender");
      }
    }

    ipcMain.handle("settings:get", () => publicSettingsPayload());
    ipcMain.handle("settings:save", async (event, settings) => {
      requireMainWindowSender(event);
      validateSettingsInput(settings);
      const previousDigestEnabled = currentSettings.notificationDigest.enabled;
      const github = settings?.integrations?.github || {};
      const username = typeof github.username === "string" ? github.username.trim() : "";
      const token = typeof github.token === "string" ? github.token.trim() : "";
      if (username) await writeUserEnvironment("WINPLATE_GITHUB_USERNAME", username);
      if (token) {
        await serviceSettingsLifecycle.persist({ githubToken: token });
        await restartPythonBackend();
      }
      currentSettings = await writeSettings(userDataPath, settings);
      setAppWindowOpacity(1);
      invalidateResponseCache("Status");
      if (previousDigestEnabled !== currentSettings.notificationDigest.enabled) {
        clearNotificationCaches();
        await notificationSummaryService?.refreshNow({ force: true });
      }
      const payload = await publicSettingsPayload();
      broadcastSettingsUpdated(payload);
      return payload;
    });
    ipcMain.handle("appearance:get-settings", async () => ({
      theme: currentSettings.appearance.theme,
      mailAutoRefreshSeconds: currentSettings.modules.refreshSeconds.mail
    }));
    ipcMain.handle("appearance:save-settings", async (event, settings) => {
      requireMainWindowSender(event);
      currentSettings = await writeSettings(userDataPath, {
        ...currentSettings,
        appearance: {
          ...currentSettings.appearance,
          ...(settings?.theme ? { theme: settings.theme } : {})
        },
        modules: {
          ...currentSettings.modules,
          refreshSeconds: {
            ...currentSettings.modules.refreshSeconds,
            ...(settings?.mailAutoRefreshSeconds !== undefined
              ? { mail: settings.mailAutoRefreshSeconds }
              : {})
          }
        }
      });
      const payload = await publicSettingsPayload();
      broadcastSettingsUpdated(payload);
      return {
        theme: currentSettings.appearance.theme,
        mailAutoRefreshSeconds: currentSettings.modules.refreshSeconds.mail
      };
    });
    createMainWindow(initialTheme);
    setAppWindowOpacity(1);
    activationCoordinator.markReady();
    const policy = startupPolicy();
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
        preloadPath: macMenuBarPaths.preloadPath,
        rendererPath: macMenuBarPaths.rendererPath,
        iconPath: assetPath("menu-bar-template.png"),
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
      ownsFloatingWindowSender,
      getAppPreferences: () => appPreferences,
      userDataPath,
      writeAppSettings,
      serviceSettingsLifecycle,
      afterServiceSettingsPersist: async (patch) => {
        if (Object.keys(patch).some((key) => serviceSettingsRequireBackendRestart.has(key))) {
          await restartPythonBackend();
        }
      },
      normalizeDeepSeekBaseUrl,
      defaultDeepSeekBaseUrl: DEFAULT_SERVICE_SETTINGS.deepseekBaseUrl,
      readDeepSeekUsage,
      readDeepSeekTokenUsage,
      publicServiceSettings,
      safeObject
    });

    if (policy.createFloatingWindow) {
      createFloatingWindow();
      ipcMain.handle("floating:set-pinned", (event, value) => {
        requireFloatingWindowSender(event);
        return setFloatingPinned(value);
      });
      ipcMain.on("floating:pin-interactive", (event, value) => {
        requireFloatingWindowSender(event);
        setFloatingPinInteractive(value);
      });
      ipcMain.on("tooltip:show", (event, payload) => {
        requireFloatingWindowSender(event);
        showTooltipWindow(payload);
      });
      ipcMain.on("tooltip:hide", (event) => {
        requireFloatingWindowSender(event);
        hideTooltipWindow();
      });
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
    ipcMain.handle("mail:open", async () => {
      await shell.openExternal("https://mail.qq.com/");
      return { opened: true };
    });
    ipcMain.handle("email:read-message", async (event, uid) => {
      requireMainWindowSender(event);
      return fetchMailMessageByUid(uid, { markRead: true });
    });
    ipcMain.handle("mail:get-message", async (_event, uid) => {
      return fetchMailMessageByUid(uid, { markRead: false });
    });
    ipcMain.handle("github:refresh", async () => {
      const response = await fetchWithTimeout("http://127.0.0.1:8765/api/github/refresh", { method: "POST" });
      if (!response.ok) {
        throw new Error(`GitHub refresh failed: HTTP ${response.status}`);
      }
      const github = await readJsonWithTimeout(response, "GitHub refresh");
      invalidateResponseCache("Status");
      return github;
    });
    ipcMain.handle("github:get-contributions", async (event, range) => {
      requireMainWindowSender(event);
      const keys = range && typeof range === "object" ? Object.keys(range) : [];
      const key = keys.length === 1 ? keys[0] : "";
      const value = key ? range[key] : "";
      const valid = (key === "date" && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value))
        || (key === "month" && typeof value === "string" && /^\d{4}-\d{2}$/.test(value));
      if (!valid) throw new Error("Invalid GitHub contribution range");
      const query = new URLSearchParams({ [key]: value });
      const response = await fetchWithTimeout(`http://127.0.0.1:8765/api/github/contributions?${query}`);
      if (!response.ok) throw new Error(`GitHub contributions failed: HTTP ${response.status}`);
      return readJsonWithTimeout(response, "GitHub contributions");
    });
    ipcMain.handle("status:get", () => (
      fetchJsonCached("Status", "http://127.0.0.1:8765/api/status", STATUS_CACHE_TTL_MS)
    ));
    ipcMain.handle("network:speed", () => readNetworkSpeed());
    ipcMain.handle("weather:set-location", async (event, location) => {
      requireMainWindowSender(event);
      const { latitude, longitude } = normalizeWeatherCoordinates(location);
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
      invalidateResponseCache("Status");
      responseCaches.delete("QWeather alerts");
      const weather = await response.json();
      broadcastStatusRefresh(weather);
      return weather;
    });
    ipcMain.handle("weather:search-locations", async (_event, query) => {
      const q = encodeURIComponent(String(query || "").trim());
      if (!q) return { locations: [] };
      return fetchJsonCached(
        `QWeather location search:${q}`,
        `http://127.0.0.1:8765/api/weather/locations/search?q=${q}`,
        30_000
      );
    });
    ipcMain.handle("weather:set-manual-location", async (event, location) => {
      requireMainWindowSender(event);
      const response = await fetch("http://127.0.0.1:8765/api/weather/location/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(location || {})
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const detail = payload?.detail ? `: ${payload.detail}` : "";
        throw new Error(`Weather location failed: HTTP ${response.status}${detail}`);
      }
      invalidateResponseCache("Status");
      responseCaches.delete("QWeather alerts");
      const weather = await response.json();
      broadcastStatusRefresh(weather);
      return weather;
    });
    ipcMain.handle("weather:get-usage", () => (
      fetchJsonCached(
        "QWeather usage",
        "http://127.0.0.1:8765/api/weather/usage",
        WEATHER_USAGE_CACHE_TTL_MS
      )
    ));
    ipcMain.handle("weather:get-alerts", () => (
      fetchJsonCached(
        "QWeather alerts",
        "http://127.0.0.1:8765/api/weather/alerts",
        WEATHER_ALERT_CACHE_TTL_MS
      )
    ));
    ipcMain.handle("weather:get-alert", async (_event, alertId) => fetchWeatherAlertById(alertId));
    ipcMain.handle("weather:refresh-official-usage", async (event) => {
      requireMainWindowSender(event);
      const response = await fetch("http://127.0.0.1:8765/api/weather/usage/official", { method: "POST" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail || `QWeather official usage failed: HTTP ${response.status}`);
      }
      return response.json();
    });
    ipcMain.handle("weather:refresh-alerts", async () => {
      clearWeatherAlertCaches();
      const alerts = await fetchJsonCached(
        "QWeather alerts",
        "http://127.0.0.1:8765/api/weather/alerts",
        WEATHER_ALERT_CACHE_TTL_MS
      );
      clearNotificationCaches();
      scheduleNotificationDigestRefresh();
      return alerts;
    });
    ipcMain.handle("mail:get-settings", () => (
      fetchJsonCached("Mail settings", "http://127.0.0.1:8765/api/mail/settings", MAIL_CACHE_TTL_MS)
    ));
    ipcMain.handle("mail:save-settings", async (event, settings) => {
      requireMainWindowSender(event);
      const address = typeof settings?.address === "string" ? settings.address.trim() : "";
      const authCode = typeof settings?.authCode === "string" ? settings.authCode.trim() : "";
      if (!address || !/^[^@\s]+@qq\.com$/i.test(address)) {
        throw new Error("QQ 邮箱地址格式无效");
      }
      if (!authCode) {
        throw new Error("QQ 邮箱授权码不能为空");
      }
      await serviceSettingsLifecycle.persist({
        qqMailAddress: address,
        qqMailAuthCode: authCode,
        qqMailImapHost: DEFAULT_SERVICE_SETTINGS.qqMailImapHost,
        qqMailImapPort: DEFAULT_SERVICE_SETTINGS.qqMailImapPort,
        qqMailSmtpHost: DEFAULT_SERVICE_SETTINGS.qqMailSmtpHost,
        qqMailSmtpPort: DEFAULT_SERVICE_SETTINGS.qqMailSmtpPort
      });
      await restartPythonBackend();
      responseCaches.delete("Mail settings");
      clearMailCaches();
      const servicePublicSettings = serviceSettingsLifecycle.publicSettings();
      return {
        configured: true,
        connected: true,
        address: servicePublicSettings.qqMailAddress,
        protocol: "IMAP",
        query: "IMAP INBOX SINCE 30 days",
        windowDays: 30,
        imap: {
          host: servicePublicSettings.qqMailImapHost,
          port: Number(servicePublicSettings.qqMailImapPort),
          secure: true
        },
        smtp: {
          host: servicePublicSettings.qqMailSmtpHost,
          port: Number(servicePublicSettings.qqMailSmtpPort),
          secure: true
        },
        updatedAt: null
      };
    });
    ipcMain.handle("mail:get-outline", () => (
      fetchJsonCached("Mail outline", "http://127.0.0.1:8765/api/mail/outline", MAIL_CACHE_TTL_MS)
    ));
    ipcMain.handle("mail:refresh", async () => {
      const response = await fetchWithTimeout("http://127.0.0.1:8765/api/mail/refresh", { method: "POST" });
      if (!response.ok) {
        const payload = await readJsonWithTimeout(response, "Mail refresh error").catch(() => null);
        throw new Error(payload?.detail || `Mail refresh failed: HTTP ${response.status}`);
      }
      const outline = await readJsonWithTimeout(response, "Mail refresh");
      clearMailCaches();
      clearNotificationCaches();
      scheduleNotificationDigestRefresh();
      return outline;
    });
    ipcMain.handle("mail:connect", async () => {
      const response = await fetchWithTimeout("http://127.0.0.1:8765/api/mail/connect", { method: "POST" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail || `QQ 邮箱连接失败: HTTP ${response.status}`);
      }
      const payload = await response.json();
      responseCaches.delete("Mail settings");
      clearMailCaches();
      return payload;
    });
    ipcMain.handle("notifications:get", async () => {
      await syncWeatherAlertsIntoNotifications();
      return fetchJsonCached("Notifications", "http://127.0.0.1:8765/api/notifications", NOTIFICATION_CACHE_TTL_MS);
    });
    const loadNotificationSummary = async () => {
      await syncWeatherAlertsIntoNotifications();
      return fetchJsonCached("Notifications", "http://127.0.0.1:8765/api/notifications", NOTIFICATION_CACHE_TTL_MS);
    };
    const notificationStore = createNotificationStore({
      loadNotifications: loadNotificationSummary
    });
    notificationDetailService = createNotificationDetailService({
      loadNotifications: loadNotificationSummary,
      fetchMailMessage: (uid) => fetchMailMessageByUid(uid, { markRead: false }),
      fetchWeatherAlert: (alertId) => fetchWeatherAlertById(alertId)
    });
    notificationSummaryService = createNotificationSummaryService({
      store: notificationStore,
      onUpdated: broadcastNotificationDigest,
      shouldUseAi: () => currentSettings.notificationDigest.enabled,
      aiModel: DEEPSEEK_CHAT_MODEL,
      persistDigest: async ({ digest, snapshot, model }) => {
        const response = await fetch("http://127.0.0.1:8765/api/notifications/digest-records", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source: "deepseek",
            model,
            title: digest.title,
            summary: digest.summary,
            content: `${digest.title}\n${digest.summary}`.trim(),
            severity: digest.severity,
            category: digest.category,
            iconKey: digest.iconKey,
            unreadCount: digest.unreadCount,
            generatedAt: digest.generatedAt,
            sourceIds: Array.isArray(snapshot?.items) ? snapshot.items.map((item) => item.id).filter(Boolean) : []
          })
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
      },
      callChat: async (options) => {
        const settings = serviceSettingsLifecycle.effectiveSettings();
        return callDeepSeekChat({
          ...options,
          apiKey: settings.deepseekApiKey,
          baseUrl: settings.deepseekBaseUrl || DEEPSEEK_DEFAULT_BASE_URL,
          onUsage: (usage) => recordDeepSeekTokenUsageSafely(usage, options.feature || "unknown")
        });
      }
    });
    ipcMain.handle("notification:get-digest", () => notificationSummaryService.getDigest());
    ipcMain.handle("notifications:get-smart-brief", () => notificationSummaryService.getDigest());
    ipcMain.handle("notifications:refresh-smart-brief", async (event) => {
      requireMainWindowSender(event);
      return notificationSummaryService.refreshNow({ force: true });
    });
    ipcMain.handle("notifications:get-detail", async (_event, id) => notificationDetailService.getNotificationDetail(id));
    ipcMain.handle("notifications:copy", (_event, value) => {
      const text = typeof value === "string" ? value : "";
      if (!text) throw new Error("Notification copy text is empty");
      clipboard.writeText(text);
      return { ok: true };
    });
    ipcMain.handle("notifications:navigate", async (_event, action) => {
      const resolvedAction = await notificationDetailService.resolveNavigation(action);
      if (resolvedAction.type !== "navigate") {
        throw new Error("Notification action is not navigable");
      }
      showMainWindow({
        section: resolvedAction.payload.section || "Notifications",
        moduleId: resolvedAction.payload.moduleId || null,
        source: resolvedAction.payload.source || null,
        sourceId: resolvedAction.payload.sourceId || null,
        notificationId: resolvedAction.payload.notificationId || null
      });
      return { ok: true, action: resolvedAction };
    });
    ipcMain.handle("notifications:mark-read", async (event, id) => {
      requireMainWindowSender(event);
      const notificationId = typeof id === "string" ? id.trim() : "";
      if (!notificationId) {
        throw new Error("Notification id is required");
      }
      const response = await fetch(
        `http://127.0.0.1:8765/api/notifications/${encodeURIComponent(notificationId)}/read`,
        { method: "POST" }
      );
      if (!response.ok) {
        throw new Error(`Notification read failed: HTTP ${response.status}`);
      }
      const summary = await response.json();
      clearNotificationCaches();
      scheduleNotificationDigestRefresh();
      return summary;
    });
    ipcMain.handle("notifications:mark-read-many", async (event, ids) => {
      requireMainWindowSender(event);
      const notificationIds = Array.isArray(ids) ? ids.map((id) => String(id || "").trim()) : [];
      if (!notificationIds.length || notificationIds.some((id) => !id) || new Set(notificationIds).size !== notificationIds.length) {
        throw new Error("Notification ids are required");
      }
      const response = await fetch("http://127.0.0.1:8765/api/notifications/read-many", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: notificationIds })
      });
      if (!response.ok) {
        throw new Error(`Notification batch read failed: HTTP ${response.status}`);
      }
      const summary = await response.json();
      clearNotificationCaches();
      scheduleNotificationDigestRefresh();
      return summary;
    });
    ipcMain.handle("notifications:mark-all-read", async (event) => {
      requireMainWindowSender(event);
      const response = await fetch("http://127.0.0.1:8765/api/notifications/read-all", { method: "POST" });
      if (!response.ok) {
        throw new Error(`Notification read-all failed: HTTP ${response.status}`);
      }
      const summary = await response.json();
      clearNotificationCaches();
      scheduleNotificationDigestRefresh();
      return summary;
    });
    ipcMain.handle("notifications:clear", async (event) => {
      requireMainWindowSender(event);
      const response = await fetch("http://127.0.0.1:8765/api/notifications", { method: "DELETE" });
      if (!response.ok) {
        throw new Error(`Notification clear failed: HTTP ${response.status}`);
      }
      const summary = await response.json();
      clearNotificationCaches();
      scheduleNotificationDigestRefresh();
      return summary;
    });
    ipcMain.handle("notifications:clear-read", async (event) => {
      requireMainWindowSender(event);
      const response = await fetch("http://127.0.0.1:8765/api/notifications/read", { method: "DELETE" });
      if (!response.ok) {
        throw new Error(`Notification clear-read failed: HTTP ${response.status}`);
      }
      const summary = await response.json();
      clearNotificationCaches();
      scheduleNotificationDigestRefresh();
      return summary;
    });
    ipcMain.handle("notifications:push-test", async (event) => {
      requireMainWindowSender(event);
      const response = await fetch("http://127.0.0.1:8765/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "codex",
          level: "success",
          title: "Codex 任务完成",
          message: "WinPlate 已收到一条本地测试通知"
        })
      });
      if (!response.ok) {
        throw new Error(`Notification push failed: HTTP ${response.status}`);
      }
      clearNotificationCaches();
      scheduleNotificationDigestRefresh();
      return fetchJsonCached("Notifications", "http://127.0.0.1:8765/api/notifications", 0);
    });
    ipcMain.handle("codex:usage", (_event, options) => readCodexUsage(options));
    ipcMain.handle("deepseek:test-chat", async (event) => {
      requireMainWindowSender(event);
      const settings = serviceSettingsLifecycle.effectiveSettings();
      return testDeepSeekChat({
        apiKey: settings.deepseekApiKey,
        baseUrl: settings.deepseekBaseUrl || DEEPSEEK_DEFAULT_BASE_URL,
        onUsage: (usage) => recordDeepSeekTokenUsageSafely(usage, "testChat")
      });
    });
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
