const assert = require("node:assert/strict");
const test = require("node:test");

const { normalizeBaseUrl } = require("./deepseekUsage");
const { publicServiceSettings } = require("./serviceSettings");
const { safeObject } = require("./serviceSettingsLifecycle");
const { registerSettingsIpc } = require("./settingsIpc");

const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";

function completeServiceSettings() {
  return {
    qweatherApiKey: "weather-secret",
    qweatherApiHost: "devapi.qweather.com",
    qweatherProjectId: "project-one",
    qweatherCredentialId: "credential-one",
    qweatherPrivateKey: "private-secret",
    deepseekApiKey: "deepseek-secret",
    deepseekBaseUrl: DEFAULT_DEEPSEEK_BASE_URL
  };
}

function createHarness() {
  assert.equal(typeof registerSettingsIpc, "function", "settings IPC registration must exist");

  const handlers = new Map();
  const order = [];
  const writes = [];
  const applied = [];
  const persisted = [];
  const usageReads = [];
  const mainSender = { name: "main" };
  const menuSender = { name: "menu" };
  const foreignSender = { name: "foreign" };
  let appSettings = { menuBarEnabled: true, launchAtLogin: false };
  let serviceSettings = completeServiceSettings();

  const appPreferences = {
    getSettings() {
      return { ...appSettings };
    },
    apply(settings) {
      order.push("apply");
      appSettings = { ...settings };
      applied.push({ ...settings });
      return { ...appSettings };
    },
    ownsSender(sender) {
      return sender === menuSender;
    }
  };

  const serviceSettingsLifecycle = {
    effectiveSettings() {
      return { ...serviceSettings };
    },
    async persist(patch) {
      persisted.push({ ...patch });
      serviceSettings = { ...serviceSettings, ...patch };
      return publicServiceSettings(serviceSettings);
    }
  };

  registerSettingsIpc({
    ipcMain: {
      handle(channel, handler) {
        assert.equal(handlers.has(channel), false, `${channel} registered once`);
        handlers.set(channel, handler);
      }
    },
    ownsMainWindowSender: (sender) => sender === mainSender,
    getAppPreferences: () => appPreferences,
    userDataPath: "/user/data",
    writeAppSettings: async (userDataPath, settings) => {
      order.push("write");
      writes.push({ userDataPath, settings: { ...settings } });
      return { ...settings };
    },
    serviceSettingsLifecycle,
    normalizeDeepSeekBaseUrl: normalizeBaseUrl,
    defaultDeepSeekBaseUrl: DEFAULT_DEEPSEEK_BASE_URL,
    readDeepSeekUsage: async (options) => {
      usageReads.push({ ...options });
      return { status: "usage-result" };
    },
    publicServiceSettings,
    safeObject
  });

  async function invoke(channel, sender, ...args) {
    const handler = handlers.get(channel);
    assert.equal(typeof handler, "function", `${channel} is registered`);
    return handler({ sender }, ...args);
  }

  return {
    applied,
    foreignSender,
    handlers,
    invoke,
    mainSender,
    menuSender,
    order,
    persisted,
    usageReads,
    writes
  };
}

test("registers the exact settings and DeepSeek usage channel set", () => {
  const { handlers } = createHarness();

  assert.deepEqual([...handlers.keys()].sort(), [
    "app:get-settings",
    "app:save-settings",
    "deepseek:get-settings",
    "deepseek:save-settings",
    "deepseek:usage",
    "weather:get-settings",
    "weather:save-settings"
  ]);
});

test("settings handlers reject foreign senders and accept the live main sender", async () => {
  const cases = [
    ["app:get-settings"],
    ["app:save-settings", { menuBarEnabled: false }],
    ["weather:get-settings"],
    ["weather:save-settings", { apiHost: "weather.example" }],
    ["deepseek:get-settings"],
    ["deepseek:save-settings", { baseUrl: "https://deepseek.example" }]
  ];

  for (const [channel, payload] of cases) {
    const foreign = createHarness();
    await assert.rejects(
      foreign.invoke(channel, foreign.foreignSender, payload),
      { name: "Error", message: "Unauthorized settings sender" },
      `${channel} rejects a foreign sender`
    );

    const live = createHarness();
    await assert.doesNotReject(
      live.invoke(channel, live.mainSender, payload),
      `${channel} accepts the live main sender`
    );
  }
});

test("app save merges safe object payloads and writes before applying", async () => {
  const harness = createHarness();

  const saved = await harness.invoke(
    "app:save-settings",
    harness.mainSender,
    { launchAtLogin: true }
  );

  assert.deepEqual(harness.order, ["write", "apply"]);
  assert.deepEqual(harness.writes[0], {
    userDataPath: "/user/data",
    settings: { menuBarEnabled: true, launchAtLogin: true }
  });
  assert.deepEqual(harness.applied[0], saved);

  await harness.invoke("app:save-settings", harness.mainSender, null);
  await harness.invoke("app:save-settings", harness.mainSender, ["injected"]);
  assert.deepEqual(harness.writes[1].settings, saved);
  assert.deepEqual(harness.writes[2].settings, saved);
  assert.equal(Object.hasOwn(harness.writes[2].settings, "0"), false);
});

test("weather get and save return the exact public shape while preserving blank secrets", async () => {
  const harness = createHarness();
  const initial = await harness.invoke("weather:get-settings", harness.mainSender);

  assert.deepEqual(initial, {
    hasApiKey: true,
    apiHost: "devapi.qweather.com",
    projectId: "project-one",
    credentialId: "credential-one",
    hasPrivateKey: true
  });

  const saved = await harness.invoke("weather:save-settings", harness.mainSender, {
    apiKey: "   ",
    apiHost: " weather.example ",
    projectId: " project-two ",
    credentialId: " credential-two ",
    privateKey: "\t"
  });

  assert.deepEqual(harness.persisted[0], {
    qweatherApiHost: "weather.example",
    qweatherProjectId: "project-two",
    qweatherCredentialId: "credential-two"
  });
  assert.deepEqual(saved, {
    hasApiKey: true,
    apiHost: "weather.example",
    projectId: "project-two",
    credentialId: "credential-two",
    hasPrivateKey: true
  });
  assert.deepEqual(Object.keys(saved), [
    "hasApiKey", "apiHost", "projectId", "credentialId", "hasPrivateKey"
  ]);
});

test("weather save rejects invalid hosts and persists trimmed nonblank secrets without returning them", async () => {
  for (const apiHost of ["", "bad/host", "host with spaces"]) {
    const harness = createHarness();
    await assert.rejects(
      harness.invoke("weather:save-settings", harness.mainSender, { apiHost }),
      { message: "API Host 格式无效" }
    );
    assert.equal(harness.persisted.length, 0);
  }

  const harness = createHarness();
  const saved = await harness.invoke("weather:save-settings", harness.mainSender, {
    apiKey: " new-weather-key ",
    apiHost: "weather.example",
    privateKey: " new-private-key "
  });
  assert.equal(harness.persisted[0].qweatherApiKey, "new-weather-key");
  assert.equal(harness.persisted[0].qweatherPrivateKey, "new-private-key");
  assert.equal(Object.hasOwn(saved, "qweatherApiKey"), false);
  assert.equal(Object.hasOwn(saved, "qweatherPrivateKey"), false);
  assert.equal(Object.hasOwn(saved, "apiKey"), false);
  assert.equal(Object.hasOwn(saved, "privateKey"), false);
});

test("DeepSeek get is public-only and save validates URL boundaries", async () => {
  const harness = createHarness();
  assert.deepEqual(
    await harness.invoke("deepseek:get-settings", harness.mainSender),
    { hasApiKey: true, baseUrl: DEFAULT_DEEPSEEK_BASE_URL }
  );

  for (const [baseUrl, message] of [
    ["not a url", "DeepSeek Base URL 格式无效"],
    ["http://deepseek.example", "DeepSeek Base URL 必须是 HTTPS 地址"],
    ["https://user:pass@deepseek.example", "DeepSeek Base URL 必须是 HTTPS 地址"]
  ]) {
    const invalid = createHarness();
    await assert.rejects(
      invalid.invoke("deepseek:save-settings", invalid.mainSender, { baseUrl }),
      { message }
    );
    assert.equal(invalid.persisted.length, 0);
  }
});

test("DeepSeek save normalizes the base URL and changes only nonblank keys", async () => {
  const blank = createHarness();
  const blankResult = await blank.invoke("deepseek:save-settings", blank.mainSender, {
    apiKey: "  ",
    baseUrl: " https://deepseek.example/// "
  });
  assert.deepEqual(blank.persisted[0], {
    deepseekBaseUrl: "https://deepseek.example"
  });
  assert.deepEqual(blankResult, {
    hasApiKey: true,
    baseUrl: "https://deepseek.example"
  });

  const replacement = createHarness();
  const result = await replacement.invoke("deepseek:save-settings", replacement.mainSender, {
    apiKey: " replacement-key ",
    baseUrl: "https://other.example/"
  });
  assert.deepEqual(replacement.persisted[0], {
    deepseekBaseUrl: "https://other.example",
    deepseekApiKey: "replacement-key"
  });
  assert.equal(Object.hasOwn(result, "deepseekApiKey"), false);
});

test("DeepSeek usage accepts owned renderers and forces effective credentials", async () => {
  const harness = createHarness();
  const fetchImpl = () => {};

  await assert.rejects(
    harness.invoke("deepseek:usage", harness.foreignSender, {}),
    { name: "Error", message: "Unauthorized usage sender" }
  );
  assert.deepEqual(
    await harness.invoke("deepseek:usage", harness.mainSender, {
      apiKey: "attacker-key",
      baseUrl: "https://attacker.example",
      fetchImpl
    }),
    { status: "usage-result" }
  );
  await harness.invoke("deepseek:usage", harness.menuSender, {});

  assert.deepEqual(harness.usageReads[0], {
    apiKey: "deepseek-secret",
    baseUrl: DEFAULT_DEEPSEEK_BASE_URL,
    fetchImpl
  });
  assert.equal(harness.usageReads.length, 2);
});
