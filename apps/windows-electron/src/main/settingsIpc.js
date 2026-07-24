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
  ownsFloatingWindowSender = () => false,
  userDataPath,
  serviceSettingsLifecycle,
  afterServiceSettingsPersist = async () => {},
  normalizeDeepSeekBaseUrl,
  defaultDeepSeekBaseUrl,
  readDeepSeekUsage,
  readDeepSeekTokenUsage,
  publicServiceSettings,
  safeObject
}) {
  function requireMainWindowSender(event) {
    if (!ownsMainWindowSender(event.sender)) {
      throw new Error("Unauthorized settings sender");
    }
  }

  function requireUsageSender(event) {
    if (
      !ownsMainWindowSender(event.sender)
      && !ownsFloatingWindowSender(event.sender)
    ) {
      throw new Error("Unauthorized usage sender");
    }
  }

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
    await afterServiceSettingsPersist(patch);
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
    await afterServiceSettingsPersist(patch);
    return deepSeekSettingsResponse(
      serviceSettingsLifecycle.effectiveSettings(),
      publicServiceSettings
    );
  });

  ipcMain.handle("deepseek:usage", async (event, options) => {
    requireUsageSender(event);
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
