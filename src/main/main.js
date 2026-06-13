const { app, ipcMain, nativeTheme, session, shell } = require("electron");
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
  minimizeMainWindow,
  toggleMaximizeMainWindow,
  closeMainWindow
} = require("./windows");
const { createAppTray } = require("./tray");
const { startPythonService, stopPythonService } = require("./pythonService");
const { readCodexUsage } = require("./codexUsage");
const {
  DEFAULT_BASE_URL: DEEPSEEK_DEFAULT_BASE_URL,
  normalizeBaseUrl: normalizeDeepSeekBaseUrl,
  readDeepSeekUsage
} = require("./deepseekUsage");
const {
  readAppearanceSettings,
  writeAppearanceSettings
} = require("./appearanceSettings");

let tray;
const execFileAsync = promisify(execFile);
const STATUS_CACHE_TTL_MS = 5_000;
const WEATHER_USAGE_CACHE_TTL_MS = 5 * 60_000;
const responseCaches = new Map();

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
    responseCaches.set(key, { value, updatedAt: Date.now() });
    return value;
  }).catch((error) => {
    responseCaches.delete(key);
    throw error;
  });
  responseCaches.set(key, {
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
    const appearanceSettings = await readAppearanceSettings(app.getPath("userData"));
    const initialTheme = appearanceSettings.theme === "system"
      ? (nativeTheme.shouldUseDarkColors ? "dark" : "light")
      : appearanceSettings.theme;
    ipcMain.handle("appearance:get-settings", () => (
      readAppearanceSettings(app.getPath("userData"))
    ));
    ipcMain.handle("appearance:save-settings", (_event, settings) => (
      writeAppearanceSettings(app.getPath("userData"), settings)
    ));
    createMainWindow(initialTheme);
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
      return readDeepSeekUsage({
        ...options,
        apiKey,
        baseUrl: baseUrl || DEEPSEEK_DEFAULT_BASE_URL
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
