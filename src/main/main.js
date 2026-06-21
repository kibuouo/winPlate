const { app, BrowserWindow, ipcMain, nativeTheme, session, shell } = require("electron");
const { execFile } = require("child_process");
const { promisify } = require("util");
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
  sendToWindow
} = require("./windows");
const { createAppTray } = require("./tray");
const { startPythonService, stopPythonService } = require("./pythonService");
const { readCodexUsage } = require("./codexUsage");
const { readNetworkSpeed } = require("./networkSpeed");
const {
  DEFAULT_BASE_URL: DEEPSEEK_DEFAULT_BASE_URL,
  normalizeBaseUrl: normalizeDeepSeekBaseUrl,
  readDeepSeekUsage
} = require("./deepseekUsage");
const { callDeepSeekChat, testDeepSeekChat } = require("./deepseekChatClient");
const {
  readDeepSeekTokenUsage,
  recordDeepSeekTokenUsage
} = require("./deepseekTokenUsage");
const { createNotificationStore } = require("./notifications/notificationStore");
const { createNotificationSummaryService } = require("./ai/notificationSummaryService");
const { mainModules, validateMainModules } = require("./modules");
const { readSettings, writeSettings } = require("./settingsStore");
const MODULES = validateMainModules().map((module) => module.meta);

let tray;
const execFileAsync = promisify(execFile);
const STATUS_CACHE_TTL_MS = 5_000;
const WEATHER_USAGE_CACHE_TTL_MS = 5 * 60_000;
const WEATHER_ALERT_CACHE_TTL_MS = 10 * 60_000;
const MAIL_CACHE_TTL_MS = 60_000;
const NOTIFICATION_CACHE_TTL_MS = 5_000;
const MAX_RESPONSE_CACHE_ENTRIES = 16;
const responseCaches = new Map();
const responseCacheVersions = new Map();
let notificationSummaryService = null;
let currentSettings = null;

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
  const promise = fetch(url).then(async (response) => {
    if (!response.ok) {
      throw new Error(`${key} failed: HTTP ${response.status}`);
    }
    const value = await response.json();
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

async function readUserEnvironment(name) {
  if (process.platform !== "win32") {
    return process.env[name] || "";
  }
  try {
    const { stdout } = await execFileAsync("reg.exe", [
      "query", "HKCU\\Environment", "/v", name
    ], { windowsHide: true });
    const line = stdout.split(/\r?\n/).find((entry) => entry.includes(name));
    return line?.trim().split(/\s{2,}/).at(-1) || "";
  } catch {
    return "";
  }
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
  if (settings?.notificationDigest?.privacyMode !== undefined
      && !["sanitized", "local-only"].includes(settings.notificationDigest.privacyMode)) {
    throw new Error("通知摘要隐私模式无效");
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
  const githubToken = await readUserEnvironment("GITHUB_TOKEN");
  return {
    ...settings,
    integrations: {
      ...settings.integrations,
      github: {
        ...settings.integrations.github,
        hasToken: Boolean(githubToken)
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
  app.on("second-instance", showMainWindow);

  app.whenReady().then(async () => {
    session.defaultSession.setPermissionCheckHandler((_webContents, permission) => permission === "geolocation");
    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      callback(permission === "geolocation");
    });
    try {
      await startPythonService();
    } catch (error) {
      console.error(error.message);
    }
    currentSettings = await readSettings(app.getPath("userData"));
    const initialTheme = currentSettings.appearance.theme === "system"
      ? (nativeTheme.shouldUseDarkColors ? "dark" : "light")
      : currentSettings.appearance.theme;
    ipcMain.handle("settings:get", () => publicSettingsPayload());
    ipcMain.handle("settings:save", async (_event, settings) => {
      validateSettingsInput(settings);
      const github = settings?.integrations?.github || {};
      const username = typeof github.username === "string" ? github.username.trim() : "";
      const token = typeof github.token === "string" ? github.token.trim() : "";
      if (username) await writeUserEnvironment("WINPLATE_GITHUB_USERNAME", username);
      if (token) await writeUserEnvironment("GITHUB_TOKEN", token);
      currentSettings = await writeSettings(app.getPath("userData"), settings);
      setAppWindowOpacity(currentSettings.appearance.opacity);
      invalidateResponseCache("Status");
      const payload = await publicSettingsPayload();
      broadcastSettingsUpdated(payload);
      return payload;
    });
    ipcMain.handle("appearance:get-settings", async () => ({
      theme: currentSettings.appearance.theme,
      mailAutoRefreshSeconds: currentSettings.modules.refreshSeconds.mail
    }));
    ipcMain.handle("appearance:save-settings", async (_event, settings) => {
      currentSettings = await writeSettings(app.getPath("userData"), {
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
      return {
        theme: currentSettings.appearance.theme,
        mailAutoRefreshSeconds: currentSettings.modules.refreshSeconds.mail
      };
    });
    createMainWindow(initialTheme);
    createFloatingWindow();
    setAppWindowOpacity(currentSettings.appearance.opacity);

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
    ipcMain.handle("mail:open", async () => {
      await shell.openExternal("https://mail.qq.com/");
      return { opened: true };
    });
    ipcMain.handle("email:read-message", async (_event, uid) => {
      const messageUid = typeof uid === "string" || typeof uid === "number" ? String(uid).trim() : "";
      if (!messageUid) {
        throw new Error("邮件 UID 不能为空");
      }
      const response = await fetch(
        `http://127.0.0.1:8765/api/mail/messages/${encodeURIComponent(messageUid)}/read`,
        { method: "POST" }
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail || `邮件读取失败: HTTP ${response.status}`);
      }
      const message = await response.json();
      responseCaches.delete("Mail outline");
      responseCaches.delete("Notifications");
      scheduleNotificationDigestRefresh();
      return message;
    });
    ipcMain.handle("github:refresh", async () => {
      const response = await fetch("http://127.0.0.1:8765/api/github/refresh", { method: "POST" });
      if (!response.ok) {
        throw new Error(`GitHub refresh failed: HTTP ${response.status}`);
      }
      const github = await response.json();
      invalidateResponseCache("Status");
      return github;
    });
    ipcMain.handle("status:get", () => (
      fetchJsonCached("Status", "http://127.0.0.1:8765/api/status", STATUS_CACHE_TTL_MS)
    ));
    ipcMain.handle("network:speed", () => readNetworkSpeed());
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
    ipcMain.handle("weather:set-manual-location", async (_event, location) => {
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
    ipcMain.handle("weather:get-settings", async () => {
      const [apiKey, apiHost, projectId, credentialId, privateKey] = await Promise.all([
        readUserEnvironment("QWEATHER_API_KEY"),
        readUserEnvironment("QWEATHER_API_HOST"),
        readUserEnvironment("QWEATHER_PROJECT_ID"),
        readUserEnvironment("QWEATHER_CREDENTIAL_ID"),
        readUserEnvironment("QWEATHER_PRIVATE_KEY")
      ]);
      return {
        hasApiKey: Boolean(apiKey),
        apiHost: apiHost || "devapi.qweather.com",
        projectId,
        credentialId,
        hasPrivateKey: Boolean(privateKey)
      };
    });
    ipcMain.handle("weather:save-settings", async (_event, settings) => {
      const apiKey = typeof settings?.apiKey === "string" ? settings.apiKey.trim() : "";
      const apiHost = typeof settings?.apiHost === "string" ? settings.apiHost.trim() : "";
      const projectId = typeof settings?.projectId === "string" ? settings.projectId.trim() : "";
      const credentialId = typeof settings?.credentialId === "string" ? settings.credentialId.trim() : "";
      const privateKey = typeof settings?.privateKey === "string" ? settings.privateKey.trim() : "";
      if (!apiHost || !/^[a-z0-9.-]+$/i.test(apiHost)) {
        throw new Error("API Host 格式无效");
      }
      const writes = [
        writeUserEnvironment("QWEATHER_API_HOST", apiHost),
        writeUserEnvironment("QWEATHER_PROJECT_ID", projectId),
        writeUserEnvironment("QWEATHER_CREDENTIAL_ID", credentialId)
      ];
      if (apiKey) {
        writes.push(writeUserEnvironment("QWEATHER_API_KEY", apiKey));
      }
      if (privateKey) {
        writes.push(writeUserEnvironment("QWEATHER_PRIVATE_KEY", privateKey));
      }
      await Promise.all(writes);
      return {
        hasApiKey: Boolean(apiKey || await readUserEnvironment("QWEATHER_API_KEY")),
        apiHost,
        projectId,
        credentialId,
        hasPrivateKey: Boolean(privateKey || await readUserEnvironment("QWEATHER_PRIVATE_KEY"))
      };
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
    ipcMain.handle("weather:refresh-alerts", async () => {
      const alerts = await fetchJsonCached(
        "QWeather alerts",
        "http://127.0.0.1:8765/api/weather/alerts",
        WEATHER_ALERT_CACHE_TTL_MS
      );
      responseCaches.delete("Notifications");
      scheduleNotificationDigestRefresh();
      return alerts;
    });
    ipcMain.handle("mail:get-settings", () => (
      fetchJsonCached("Mail settings", "http://127.0.0.1:8765/api/mail/settings", MAIL_CACHE_TTL_MS)
    ));
    ipcMain.handle("mail:save-settings", async (_event, settings) => {
      const address = typeof settings?.address === "string" ? settings.address.trim() : "";
      const authCode = typeof settings?.authCode === "string" ? settings.authCode.trim() : "";
      if (!address || !/^[^@\s]+@qq\.com$/i.test(address)) {
        throw new Error("QQ 邮箱地址格式无效");
      }
      if (!authCode) {
        throw new Error("QQ 邮箱授权码不能为空");
      }
      await Promise.all([
        writeUserEnvironment("QQ_MAIL_ADDRESS", address),
        writeUserEnvironment("QQ_MAIL_AUTH_CODE", authCode),
        writeUserEnvironment("QQ_MAIL_IMAP_HOST", "imap.qq.com"),
        writeUserEnvironment("QQ_MAIL_IMAP_PORT", "993"),
        writeUserEnvironment("QQ_MAIL_SMTP_HOST", "smtp.qq.com"),
        writeUserEnvironment("QQ_MAIL_SMTP_PORT", "465")
      ]);
      responseCaches.delete("Mail settings");
      responseCaches.delete("Mail outline");
      return {
        configured: true,
        connected: true,
        address,
        protocol: "IMAP",
        query: "IMAP INBOX SINCE 30 days",
        windowDays: 30,
        imap: { host: "imap.qq.com", port: 993, secure: true },
        smtp: { host: "smtp.qq.com", port: 465, secure: true },
        updatedAt: null
      };
    });
    ipcMain.handle("mail:get-outline", () => (
      fetchJsonCached("Mail outline", "http://127.0.0.1:8765/api/mail/outline", MAIL_CACHE_TTL_MS)
    ));
    ipcMain.handle("mail:refresh", async () => {
      const response = await fetch("http://127.0.0.1:8765/api/mail/refresh", { method: "POST" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail || `Mail refresh failed: HTTP ${response.status}`);
      }
      const outline = await response.json();
      responseCaches.delete("Mail outline");
      responseCaches.delete("Notifications");
      scheduleNotificationDigestRefresh();
      return outline;
    });
    ipcMain.handle("mail:connect", async () => {
      const response = await fetch("http://127.0.0.1:8765/api/mail/connect", { method: "POST" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail || `QQ 邮箱连接失败: HTTP ${response.status}`);
      }
      const payload = await response.json();
      responseCaches.delete("Mail settings");
      responseCaches.delete("Mail outline");
      return payload;
    });
    ipcMain.handle("notifications:get", () => (
      fetchJsonCached("Notifications", "http://127.0.0.1:8765/api/notifications", NOTIFICATION_CACHE_TTL_MS)
    ));
    const notificationStore = createNotificationStore({
      loadNotifications: () => (
        fetchJsonCached("Notifications", "http://127.0.0.1:8765/api/notifications", NOTIFICATION_CACHE_TTL_MS)
      )
    });
    notificationSummaryService = createNotificationSummaryService({
      store: notificationStore,
      onUpdated: broadcastNotificationDigest,
      shouldUseAi: () => currentSettings.notificationDigest.enabled
        && currentSettings.notificationDigest.privacyMode !== "local-only",
      callChat: async (options) => {
        const [apiKey, baseUrl] = await Promise.all([
          readUserEnvironment("DEEPSEEK_API_KEY"),
          readUserEnvironment("DEEPSEEK_BASE_URL")
        ]);
        return callDeepSeekChat({
          ...options,
          apiKey,
          baseUrl: baseUrl || DEEPSEEK_DEFAULT_BASE_URL,
          onUsage: (usage) => recordDeepSeekTokenUsageSafely(usage, options.feature || "unknown")
        });
      }
    });
    ipcMain.handle("notification:get-digest", () => notificationSummaryService.getDigest());
    ipcMain.handle("notifications:get-smart-brief", () => notificationSummaryService.getDigest());
    ipcMain.handle("notifications:refresh-smart-brief", () => notificationSummaryService.refreshNow({ force: true }));
    ipcMain.handle("notifications:mark-read", async (_event, id) => {
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
      responseCaches.delete("Notifications");
      scheduleNotificationDigestRefresh();
      return summary;
    });
    ipcMain.handle("notifications:mark-all-read", async () => {
      const response = await fetch("http://127.0.0.1:8765/api/notifications/read-all", { method: "POST" });
      if (!response.ok) {
        throw new Error(`Notification read-all failed: HTTP ${response.status}`);
      }
      const summary = await response.json();
      responseCaches.delete("Notifications");
      scheduleNotificationDigestRefresh();
      return summary;
    });
    ipcMain.handle("notifications:clear", async () => {
      const response = await fetch("http://127.0.0.1:8765/api/notifications", { method: "DELETE" });
      if (!response.ok) {
        throw new Error(`Notification clear failed: HTTP ${response.status}`);
      }
      const summary = await response.json();
      responseCaches.delete("Notifications");
      scheduleNotificationDigestRefresh();
      return summary;
    });
    ipcMain.handle("notifications:push-test", async () => {
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
      responseCaches.delete("Notifications");
      scheduleNotificationDigestRefresh();
      return fetchJsonCached("Notifications", "http://127.0.0.1:8765/api/notifications", 0);
    });
    ipcMain.handle("codex:usage", (_event, options) => readCodexUsage(options));
    ipcMain.handle("deepseek:get-settings", async () => {
      const [apiKey, baseUrl] = await Promise.all([
        readUserEnvironment("DEEPSEEK_API_KEY"),
        readUserEnvironment("DEEPSEEK_BASE_URL")
      ]);
      return {
        hasApiKey: Boolean(apiKey),
        baseUrl: normalizeDeepSeekBaseUrl(baseUrl || DEEPSEEK_DEFAULT_BASE_URL)
      };
    });
    ipcMain.handle("deepseek:save-settings", async (_event, settings) => {
      const apiKey = typeof settings?.apiKey === "string" ? settings.apiKey.trim() : "";
      const baseUrl = normalizeDeepSeekBaseUrl(settings?.baseUrl || DEEPSEEK_DEFAULT_BASE_URL);
      let parsed;
      try {
        parsed = new URL(baseUrl);
      } catch {
        throw new Error("DeepSeek Base URL 格式无效");
      }
      if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
        throw new Error("DeepSeek Base URL 必须是 HTTPS 地址");
      }
      const writes = [writeUserEnvironment("DEEPSEEK_BASE_URL", baseUrl)];
      if (apiKey) writes.push(writeUserEnvironment("DEEPSEEK_API_KEY", apiKey));
      await Promise.all(writes);
      return {
        hasApiKey: Boolean(apiKey || await readUserEnvironment("DEEPSEEK_API_KEY")),
        baseUrl
      };
    });
    ipcMain.handle("deepseek:usage", async (_event, options) => {
      const [apiKey, baseUrl] = await Promise.all([
        readUserEnvironment("DEEPSEEK_API_KEY"),
        readUserEnvironment("DEEPSEEK_BASE_URL")
      ]);
      const usage = await readDeepSeekUsage({
        ...options,
        apiKey,
        baseUrl: baseUrl || DEEPSEEK_DEFAULT_BASE_URL
      });
      return {
        ...usage,
        tokenUsage: await readDeepSeekTokenUsage(app.getPath("userData"))
      };
    });
    ipcMain.handle("deepseek:test-chat", async () => {
      const [apiKey, baseUrl] = await Promise.all([
        readUserEnvironment("DEEPSEEK_API_KEY"),
        readUserEnvironment("DEEPSEEK_BASE_URL")
      ]);
      return testDeepSeekChat({
        apiKey,
        baseUrl: baseUrl || DEEPSEEK_DEFAULT_BASE_URL,
        onUsage: (usage) => recordDeepSeekTokenUsageSafely(usage, "testChat")
      });
    });
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
