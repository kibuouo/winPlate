const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DEFAULT_SERVICE_SETTINGS,
  resolveServiceSettings,
  toServiceEnvironment
} = require("./serviceSettings");
const { createServiceSettingsLifecycle } = require("./serviceSettingsLifecycle");

const { createServiceSettingsMigration } = require("./serviceSettingsMigration");

async function createHarness({
  platform = "win32",
  hasFile = false,
  stored = DEFAULT_SERVICE_SETTINGS,
  legacyEnvironment = {},
  legacyError = null,
  writeFailures = 0
} = {}) {
  assert.equal(
    typeof createServiceSettingsMigration,
    "function",
    "service settings migration helper must exist"
  );
  let currentStored = { ...stored };
  let remainingWriteFailures = writeFailures;
  let legacyReads = 0;
  const errors = [];
  const writes = [];

  const store = await createServiceSettingsMigration({
    platform,
    hasPersistedSettings: async () => hasFile,
    readStoredSettings: async () => ({ ...currentStored }),
    writeStoredSettings: async (settings) => {
      writes.push({ ...settings });
      if (remainingWriteFailures > 0) {
        remainingWriteFailures -= 1;
        throw new Error("encrypted write failed");
      }
      currentStored = { ...settings };
      return { ...currentStored };
    },
    readLegacyEnvironment: async () => {
      legacyReads += 1;
      if (legacyError) throw legacyError;
      return { ...legacyEnvironment };
    },
    resolveSettings: resolveServiceSettings,
    reportError: (message) => errors.push(message)
  });

  return {
    errors,
    getLegacyReads: () => legacyReads,
    getStored: () => ({ ...currentStored }),
    store,
    writes
  };
}

function createLifecycle(store, externalEnvironment = {}) {
  return createServiceSettingsLifecycle({
    defaults: DEFAULT_SERVICE_SETTINGS,
    externalEnvironment,
    targetEnvironment: {},
    read: store.read,
    write: store.write,
    resolve: resolveServiceSettings,
    publicProjection: (settings) => ({ ...settings }),
    toEnvironment: toServiceEnvironment,
    reportError: () => {}
  });
}

test("a missing file uses legacy values only as initial stored fallback", async () => {
  const harness = await createHarness({
    legacyEnvironment: {
      QWEATHER_API_KEY: "legacy-weather",
      QWEATHER_API_HOST: "legacy.weather.example",
      DEEPSEEK_API_KEY: "legacy-deepseek"
    }
  });
  const lifecycle = createLifecycle(harness.store, {
    QWEATHER_API_KEY: "process-weather"
  });

  const effective = await lifecycle.loadForStartup();

  assert.equal(effective.qweatherApiKey, "process-weather");
  assert.equal(effective.qweatherApiHost, "legacy.weather.example");
  assert.equal(effective.deepseekApiKey, "legacy-deepseek");
  assert.equal(harness.getLegacyReads(), 1);
});

test("the first successful encrypted save supersedes legacy values immediately", async () => {
  const harness = await createHarness({
    legacyEnvironment: { QWEATHER_API_KEY: "legacy-weather" }
  });
  const lifecycle = createLifecycle(harness.store);
  assert.equal((await lifecycle.loadForStartup()).qweatherApiKey, "legacy-weather");

  const saved = await lifecycle.persist({ qweatherApiKey: "encrypted-weather" });

  assert.equal(saved.qweatherApiKey, "encrypted-weather");
  assert.equal((await harness.store.read()).qweatherApiKey, "encrypted-weather");
  assert.equal(harness.getStored().qweatherApiKey, "encrypted-weather");
  assert.equal(harness.getLegacyReads(), 1);
});

test("a restart with an existing settings file ignores the registry entirely", async () => {
  const harness = await createHarness({
    hasFile: true,
    stored: {
      ...DEFAULT_SERVICE_SETTINGS,
      qweatherApiKey: "encrypted-weather"
    },
    legacyError: new Error("must not query registry")
  });

  assert.equal((await harness.store.read()).qweatherApiKey, "encrypted-weather");
  assert.equal(harness.getLegacyReads(), 0);
  assert.deepEqual(harness.errors, []);
});

test("a failed first write keeps migration fallback active for the next save", async () => {
  const harness = await createHarness({
    legacyEnvironment: { QWEATHER_API_KEY: "legacy-weather" },
    writeFailures: 1
  });
  const lifecycle = createLifecycle(harness.store);
  await lifecycle.loadForStartup();

  await assert.rejects(
    lifecycle.persist({ qweatherApiKey: "failed-weather" }),
    { message: "encrypted write failed" }
  );
  assert.equal((await harness.store.read()).qweatherApiKey, "legacy-weather");

  const saved = await lifecycle.persist({ qweatherApiKey: "encrypted-weather" });
  assert.equal(saved.qweatherApiKey, "encrypted-weather");
  assert.equal((await harness.store.read()).qweatherApiKey, "encrypted-weather");
});

test("Windows legacy query failures safely fall back to stored defaults", async () => {
  const harness = await createHarness({
    legacyError: new Error("legacy registry unavailable")
  });

  assert.deepEqual(await harness.store.read(), DEFAULT_SERVICE_SETTINGS);
  assert.deepEqual(harness.errors, ["legacy registry unavailable"]);
});

test("darwin never queries legacy Windows settings", async () => {
  const harness = await createHarness({
    platform: "darwin",
    legacyError: new Error("must not query registry")
  });

  assert.deepEqual(await harness.store.read(), DEFAULT_SERVICE_SETTINGS);
  assert.equal(harness.getLegacyReads(), 0);
  assert.deepEqual(harness.errors, []);
});
