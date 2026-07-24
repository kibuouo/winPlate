const assert = require("node:assert/strict");
const test = require("node:test");

const { normalizeBaseUrl } = require("./deepseekUsage");
const { publicServiceSettings } = require("./serviceSettings");
const { safeObject } = require("./serviceSettingsLifecycle");
const { registerSettingsIpc } = require("./settingsIpc");

function createHarness() {
  const handlers = new Map();
  const mainSender = {};
  const floatingSender = {};
  const foreignSender = {};
  const persisted = [];
  let settings = {
    qweatherApiKey: "weather-secret",
    qweatherApiHost: "devapi.qweather.com",
    qweatherProjectId: "project",
    qweatherCredentialId: "credential",
    qweatherPrivateKey: "private-secret",
    deepseekApiKey: "deepseek-secret",
    deepseekBaseUrl: "https://api.deepseek.com"
  };

  registerSettingsIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    ownsMainWindowSender: (sender) => sender === mainSender,
    ownsFloatingWindowSender: (sender) => sender === floatingSender,
    userDataPath: "/user/data",
    serviceSettingsLifecycle: {
      effectiveSettings: () => ({ ...settings }),
      persist: async (patch) => {
        persisted.push({ ...patch });
        settings = { ...settings, ...patch };
      }
    },
    normalizeDeepSeekBaseUrl: normalizeBaseUrl,
    defaultDeepSeekBaseUrl: "https://api.deepseek.com",
    readDeepSeekUsage: async (options) => ({ status: "ok", apiKey: options.apiKey }),
    readDeepSeekTokenUsage: async () => ({ total: { inputTokens: 1, outputTokens: 1 } }),
    publicServiceSettings,
    safeObject
  });

  return {
    foreignSender,
    floatingSender,
    handlers,
    mainSender,
    persisted,
    invoke(channel, sender, payload) {
      return handlers.get(channel)({ sender }, payload);
    }
  };
}

test("registers only Windows service settings and usage channels", () => {
  const { handlers } = createHarness();
  assert.deepEqual([...handlers.keys()].sort(), [
    "deepseek:get-settings",
    "deepseek:save-settings",
    "deepseek:usage",
    "weather:get-settings",
    "weather:save-settings"
  ]);
});

test("settings channels require the main window and never expose secrets", async () => {
  const harness = createHarness();
  assert.throws(
    () => harness.invoke("weather:get-settings", harness.foreignSender),
    new Error("Unauthorized settings sender")
  );

  const weather = await harness.invoke("weather:get-settings", harness.mainSender);
  assert.deepEqual(weather, {
    hasApiKey: true,
    apiHost: "devapi.qweather.com",
    projectId: "project",
    credentialId: "credential",
    hasPrivateKey: true
  });
  assert.equal(Object.hasOwn(weather, "apiKey"), false);
  assert.equal(Object.hasOwn(weather, "privateKey"), false);
  assert.equal(Object.hasOwn(weather, "qweatherPrivateKey"), false);
});

test("service saves normalize inputs and usage accepts only owned renderers", async () => {
  const harness = createHarness();
  await harness.invoke("weather:save-settings", harness.mainSender, {
    apiHost: " weather.example ",
    apiKey: " new-key "
  });
  assert.deepEqual(harness.persisted[0], {
    qweatherApiHost: "weather.example",
    qweatherProjectId: "",
    qweatherCredentialId: "",
    qweatherApiKey: "new-key"
  });

  const usage = await harness.invoke("deepseek:usage", harness.floatingSender, {});
  assert.equal(usage.status, "ok");
  assert.equal(usage.apiKey, "deepseek-secret");
  await assert.rejects(
    harness.invoke("deepseek:usage", harness.foreignSender, {}),
    new Error("Unauthorized usage sender")
  );
});
