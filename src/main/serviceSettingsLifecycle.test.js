const assert = require("node:assert/strict");
const test = require("node:test");

const { createServiceSettingsLifecycle } = require("./serviceSettingsLifecycle");

const defaults = Object.freeze({
  qweatherApiKey: "",
  qweatherApiHost: "devapi.qweather.com",
  qweatherProjectId: "",
  qweatherCredentialId: "",
  qweatherPrivateKey: "",
  deepseekApiKey: "",
  deepseekBaseUrl: "https://api.deepseek.com"
});

function deferred() {
  let resolvePromise;
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function resolve(stored, environment) {
  return {
    ...stored,
    qweatherApiKey: environment.QWEATHER_API_KEY || stored.qweatherApiKey,
    deepseekApiKey: environment.DEEPSEEK_API_KEY || stored.deepseekApiKey
  };
}

function publicProjection(settings) {
  return {
    hasQWeatherApiKey: Boolean(settings.qweatherApiKey),
    hasDeepSeekApiKey: Boolean(settings.deepseekApiKey)
  };
}

function toEnvironment(settings) {
  return {
    QWEATHER_API_KEY: settings.qweatherApiKey,
    DEEPSEEK_API_KEY: settings.deepseekApiKey
  };
}

function createHarness(overrides = {}) {
  const writes = [];
  const errors = [];
  const targetEnvironment = {};
  const lifecycle = createServiceSettingsLifecycle({
    defaults,
    externalEnvironment: { QWEATHER_API_KEY: "external-weather" },
    targetEnvironment,
    read: async () => ({ ...defaults, deepseekApiKey: "stored-deepseek" }),
    write: async (settings) => {
      writes.push({ ...settings });
      return { ...settings };
    },
    resolve,
    publicProjection,
    toEnvironment,
    reportError: (message) => errors.push(message),
    ...overrides
  });
  return { errors, lifecycle, targetEnvironment, writes };
}

test("startup load failure reports only the message and still injects external/default settings", async () => {
  const secret = "secret-value-that-must-not-be-reported";
  const { errors, lifecycle, targetEnvironment } = createHarness({
    read: async () => {
      const error = new Error("Secure credential storage is unavailable");
      error.secret = secret;
      throw error;
    }
  });

  const effective = await lifecycle.loadForStartup();

  assert.equal(effective.qweatherApiKey, "external-weather");
  assert.equal(effective.deepseekBaseUrl, defaults.deepseekBaseUrl);
  assert.deepEqual(targetEnvironment, {
    QWEATHER_API_KEY: "external-weather",
    DEEPSEEK_API_KEY: ""
  });
  assert.deepEqual(errors, ["Secure credential storage is unavailable"]);
  assert.doesNotMatch(errors.join(" "), new RegExp(secret));
});

test("save after startup load failure rejects without writing until reload succeeds", async () => {
  let reads = 0;
  const readError = new Error("secure storage unavailable");
  const { lifecycle, writes } = createHarness({
    read: async () => {
      reads += 1;
      if (reads < 3) throw readError;
      return { ...defaults, deepseekApiKey: "preserved-key" };
    }
  });

  await lifecycle.loadForStartup();
  await assert.rejects(
    lifecycle.persist({ deepseekBaseUrl: "https://first.example" }),
    readError
  );
  assert.equal(writes.length, 0);

  const result = await lifecycle.persist({ deepseekBaseUrl: "https://second.example" });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].deepseekApiKey, "preserved-key");
  assert.equal(writes[0].deepseekBaseUrl, "https://second.example");
  assert.deepEqual(result, {
    hasQWeatherApiKey: true,
    hasDeepSeekApiKey: true
  });
});

test("persist merges object patches, injects effective settings, and returns no secrets", async () => {
  const { lifecycle, targetEnvironment, writes } = createHarness();
  await lifecycle.loadForStartup();

  const result = await lifecycle.persist({
    qweatherApiHost: "weather.example",
    deepseekApiKey: "replacement-key"
  });

  assert.equal(writes[0].qweatherApiHost, "weather.example");
  assert.equal(targetEnvironment.QWEATHER_API_KEY, "external-weather");
  assert.equal(targetEnvironment.DEEPSEEK_API_KEY, "replacement-key");
  assert.deepEqual(result, {
    hasQWeatherApiKey: true,
    hasDeepSeekApiKey: true
  });
  assert.equal(Object.hasOwn(result, "deepseekApiKey"), false);
});

test("concurrent persists serialize and merge each patch from the latest successful write", async () => {
  const firstWriteEntered = deferred();
  const releaseFirstWrite = deferred();
  const writes = [];
  const { lifecycle } = createHarness({
    write: async (settings) => {
      writes.push({ ...settings });
      if (writes.length === 1) {
        firstWriteEntered.resolve();
        await releaseFirstWrite.promise;
      }
      return { ...settings };
    },
    publicProjection: (settings) => ({ ...settings })
  });
  await lifecycle.loadForStartup();

  const weatherSave = lifecycle.persist({ qweatherApiHost: "weather.concurrent.example" });
  await firstWriteEntered.promise;
  const deepSeekSave = lifecycle.persist({ deepseekBaseUrl: "https://deepseek.concurrent.example" });
  await Promise.resolve();
  assert.equal(writes.length, 1);

  releaseFirstWrite.resolve();
  await weatherSave;
  const finalResult = await deepSeekSave;

  assert.equal(writes.length, 2);
  assert.equal(writes[1].qweatherApiHost, "weather.concurrent.example");
  assert.equal(writes[1].deepseekBaseUrl, "https://deepseek.concurrent.example");
  assert.equal(finalResult.qweatherApiHost, "weather.concurrent.example");
  assert.equal(finalResult.deepseekBaseUrl, "https://deepseek.concurrent.example");
});

test("a failed persist does not poison the queue for the next operation", async () => {
  const writes = [];
  const firstError = new Error("first write failed");
  const { lifecycle } = createHarness({
    write: async (settings) => {
      writes.push({ ...settings });
      if (writes.length === 1) throw firstError;
      return { ...settings };
    },
    publicProjection: (settings) => ({ ...settings })
  });
  await lifecycle.loadForStartup();

  const failed = lifecycle.persist({ qweatherApiHost: "failed.example" });
  const succeeding = lifecycle.persist({ deepseekBaseUrl: "https://succeeding.example" });
  await assert.rejects(failed, firstError);
  const result = await succeeding;

  assert.equal(writes.length, 2);
  assert.equal(writes[1].qweatherApiHost, defaults.qweatherApiHost);
  assert.equal(writes[1].deepseekBaseUrl, "https://succeeding.example");
  assert.equal(result.deepseekBaseUrl, "https://succeeding.example");
});
