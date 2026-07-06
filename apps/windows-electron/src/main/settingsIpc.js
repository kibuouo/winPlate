const { normalizeAppSettings } = require("./appSettings");

function weatherSettingsResponse(settings, publicServiceSettings) {
  const publicSettings = publicServiceSettings(settings);
  return {
    hasApiKey: publicSettings.hasQWeatherApiKey,
    apiHost: publicSettings.qweatherApiHost,
    projectId: publicSettings.qweatherProjectId,
    credentialId: publicSettings.qweatherCredentialId,
    hasPrivateKey: publicSettings.hasQWeatherPrivateKey
  };
}

function deepSeekSettingsResponse(settings, publicServiceSettings) {
  const publicSettings = publicServiceSettings(settings);
  return {
    hasApiKey: publicSettings.hasDeepSeekApiKey,
    baseUrl: publicSettings.deepseekBaseUrl
  };
}

function registerSettingsIpc({
  ipcMain,
  ownsMainWindowSender,
  getAppPreferences,
  userDataPath,
  writeAppSettings,
  serviceSettingsLifecycle,
  normalizeDeepSeekBaseUrl,
  defaultDeepSeekBaseUrl,
  readDeepSeekUsage,
  readDeepSeekTokenUsage,
  publicServiceSettings,
  safeObject
}) {
  let appSettingsSaveQueue = Promise.resolve();

  function requireMainWindowSender(event) {
    if (!ownsMainWindowSender(event.sender)) {
      throw new Error("Unauthorized settings sender");
    }
  }

  ipcMain.handle("app:get-settings", (event) => {
    requireMainWindowSender(event);
    return getAppPreferences().getSettings();
  });

  async function saveAppSettings(payload) {
    const appPreferences = getAppPreferences();
    const previous = appPreferences.getSettings();
    const merged = normalizeAppSettings({ ...previous, ...payload });
    const written = await writeAppSettings(userDataPath, merged);
    try {
      appPreferences.apply(written, { strictLoginItem: true });
      return appPreferences.getSettings();
    } catch (applyError) {
      let rollbackError;
      try {
        await writeAppSettings(userDataPath, previous);
      } catch (error) {
        rollbackError = error;
      }
      appPreferences.apply(previous);
      if (rollbackError) {
        throw new AggregateError(
          [applyError, rollbackError],
          "Failed to apply app settings and restore persisted settings"
        );
      }
      throw applyError;
    }
  }

  ipcMain.handle("app:save-settings", (event, payload) => {
    requireMainWindowSender(event);
    const safePayload = { ...safeObject(payload) };
    const operation = appSettingsSaveQueue.then(() => saveAppSettings(safePayload));
    appSettingsSaveQueue = operation.catch(() => undefined);
    return operation;
  });

  ipcMain.handle("weather:get-settings", (event) => {
    requireMainWindowSender(event);
    return weatherSettingsResponse(
      serviceSettingsLifecycle.effectiveSettings(),
      publicServiceSettings
    );
  });

  ipcMain.handle("weather:save-settings", async (event, settings) => {
    requireMainWindowSender(event);
    const input = safeObject(settings);
    const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
    const apiHost = typeof input.apiHost === "string" ? input.apiHost.trim() : "";
    const projectId = typeof input.projectId === "string" ? input.projectId.trim() : "";
    const credentialId = typeof input.credentialId === "string" ? input.credentialId.trim() : "";
    const privateKey = typeof input.privateKey === "string" ? input.privateKey.trim() : "";
    if (!apiHost || !/^[a-z0-9.-]+$/i.test(apiHost)) {
      throw new Error("API Host 格式无效");
    }
    const patch = {
      qweatherApiHost: apiHost,
      qweatherProjectId: projectId,
      qweatherCredentialId: credentialId
    };
    if (apiKey) patch.qweatherApiKey = apiKey;
    if (privateKey) patch.qweatherPrivateKey = privateKey;
    await serviceSettingsLifecycle.persist(patch);
    return weatherSettingsResponse(
      serviceSettingsLifecycle.effectiveSettings(),
      publicServiceSettings
    );
  });

  ipcMain.handle("deepseek:get-settings", (event) => {
    requireMainWindowSender(event);
    return deepSeekSettingsResponse(
      serviceSettingsLifecycle.effectiveSettings(),
      publicServiceSettings
    );
  });

  ipcMain.handle("deepseek:save-settings", async (event, settings) => {
    requireMainWindowSender(event);
    const input = safeObject(settings);
    const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
    const requestedBaseUrl = typeof input.baseUrl === "string" ? input.baseUrl.trim() : "";
    const baseUrl = normalizeDeepSeekBaseUrl(requestedBaseUrl || defaultDeepSeekBaseUrl);
    let parsed;
    try {
      parsed = new URL(baseUrl);
    } catch {
      throw new Error("DeepSeek Base URL 格式无效");
    }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      throw new Error("DeepSeek Base URL 必须是 HTTPS 地址");
    }
    const patch = { deepseekBaseUrl: baseUrl };
    if (apiKey) patch.deepseekApiKey = apiKey;
    await serviceSettingsLifecycle.persist(patch);
    return deepSeekSettingsResponse(
      serviceSettingsLifecycle.effectiveSettings(),
      publicServiceSettings
    );
  });

  ipcMain.handle("deepseek:usage", async (_event, options) => {
    const settings = serviceSettingsLifecycle.effectiveSettings();
    const usage = await readDeepSeekUsage({
      ...safeObject(options),
      apiKey: settings.deepseekApiKey,
      baseUrl: settings.deepseekBaseUrl
    });
    return {
      ...usage,
      tokenUsage: await readDeepSeekTokenUsage(userDataPath)
    };
  });
}

module.exports = { registerSettingsIpc };
