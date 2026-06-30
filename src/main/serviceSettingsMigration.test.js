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
  existenceError = null,
  readError = null,
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
    hasPersistedSettings: async () => {
      if (existenceError) throw existenceError;
      return hasFile;
    },
    readStoredSettings: async () => {
      if (readError) throw readError;
      return { ...currentStored };
    },
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

function createLifecycle(store, externalEnvironment = {}, reportError = () => {}) {
  return createServiceSettingsLifecycle({
    defaults: DEFAULT_SERVICE_SETTINGS,
    externalEnvironment,
    targetEnvironment: {},
    read: store.read,
    write: store.write,
    resolve: resolveServiceSettings,
    publicProjection: (settings) => ({ ...settings }),
    toEnvironment: toServiceEnvironment,
    reportError
  });
}

test("a missing file imports legacy values into encrypted storage on first read", async () => {
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
  assert.equal(harness.writes.length, 1);
  assert.equal(harness.getStored().qweatherApiKey, "legacy-weather");
  assert.equal(harness.getStored().deepseekApiKey, "legacy-deepseek");
});

test("a simulated restart uses the imported store without querying changed registry values", async () => {
  const first = await createHarness({
    legacyEnvironment: { QWEATHER_API_KEY: "legacy-weather" }
  });
  const lifecycle = createLifecycle(first.store);
  assert.equal((await lifecycle.loadForStartup()).qweatherApiKey, "legacy-weather");

  const restarted = await createHarness({
    hasFile: true,
    stored: first.getStored(),
    legacyEnvironment: { QWEATHER_API_KEY: "changed-registry-weather" }
  });

  assert.equal((await restarted.store.read()).qweatherApiKey, "legacy-weather");
  assert.equal(restarted.getLegacyReads(), 0);
  assert.equal(restarted.writes.length, 0);
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

test("a failed automatic import reports safely and retries on the next write", async () => {
  const harness = await createHarness({
    legacyEnvironment: { QWEATHER_API_KEY: "legacy-weather" },
    writeFailures: 1
  });
  const lifecycle = createLifecycle(harness.store);
  assert.equal((await lifecycle.loadForStartup()).qweatherApiKey, "legacy-weather");
  assert.deepEqual(harness.errors, ["encrypted write failed"]);
  assert.equal(harness.getStored().qweatherApiKey, "");

  const saved = await lifecycle.persist({ qweatherApiKey: "encrypted-weather" });
  assert.equal(saved.qweatherApiKey, "encrypted-weather");
  assert.equal((await harness.store.read()).qweatherApiKey, "encrypted-weather");
});

test("concurrent first reads share one automatic migration write", async () => {
  const harness = await createHarness({
    legacyEnvironment: { QWEATHER_API_KEY: "legacy-weather" }
  });

  const [first, second] = await Promise.all([harness.store.read(), harness.store.read()]);

  assert.equal(first.qweatherApiKey, "legacy-weather");
  assert.deepEqual(second, first);
  assert.equal(harness.writes.length, 1);
});

test("concurrent first reads also share one failed migration attempt", async () => {
  const harness = await createHarness({
    legacyEnvironment: { QWEATHER_API_KEY: "legacy-weather" },
    writeFailures: 2
  });

  const [first, second] = await Promise.all([harness.store.read(), harness.store.read()]);

  assert.equal(first.qweatherApiKey, "legacy-weather");
  assert.deepEqual(second, first);
  assert.equal(harness.writes.length, 1);
  assert.deepEqual(harness.errors, ["encrypted write failed"]);
});

test("a stored read failure propagates without writing migration defaults", async () => {
  const harness = await createHarness({
    legacyEnvironment: { QWEATHER_API_KEY: "legacy-weather" },
    readError: new Error("encrypted read failed")
  });

  await assert.rejects(harness.store.read(), { message: "encrypted read failed" });
  assert.equal(harness.writes.length, 0);
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
  assert.equal(harness.writes.length, 0);
  assert.deepEqual(harness.errors, []);
});

test("an existence probe failure reports only its message and skips migration", async () => {
  const error = new Error("Permission denied reading settings path");
  error.secret = "must-not-be-reported";
  const harness = await createHarness({
    existenceError: error,
    readError: new Error("Permission denied reading settings file"),
    legacyError: new Error("must not query registry")
  });
  const lifecycleErrors = [];
  const lifecycle = createLifecycle(
    harness.store,
    {},
    (message) => lifecycleErrors.push(message)
  );

  assert.equal(typeof harness.store.read, "function");
  assert.equal(typeof harness.store.write, "function");
  assert.deepEqual(await lifecycle.loadForStartup(), DEFAULT_SERVICE_SETTINGS);
  assert.equal(harness.getLegacyReads(), 0);
  assert.deepEqual(harness.errors, ["Permission denied reading settings path"]);
  assert.deepEqual(lifecycleErrors, ["Permission denied reading settings file"]);
  assert.doesNotMatch(harness.errors.join(" "), /must-not-be-reported/);
});
