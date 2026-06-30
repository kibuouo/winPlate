const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_SERVICE_SETTINGS,
  normalizeServiceSettings,
  readServiceSettings,
  writeServiceSettings,
  resolveServiceSettings,
  publicServiceSettings,
  toServiceEnvironment
} = require("./serviceSettings");

const SETTINGS_FILE = "service-settings.json";

function createSafeStorage(available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value) => Buffer.from(`sealed:${value}`, "utf8"),
    decryptString: (value) => {
      const contents = value.toString("utf8");
      if (!contents.startsWith("sealed:")) {
        throw new Error("invalid ciphertext");
      }
      return contents.slice("sealed:".length);
    }
  };
}

async function createTemporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "winplate-service-settings-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

function completeSettings(suffix = "one") {
  return {
    qweatherApiKey: `weather-secret-${suffix}`,
    qweatherApiHost: `weather-${suffix}.example.com`,
    qweatherProjectId: `project-${suffix}`,
    qweatherCredentialId: `credential-${suffix}`,
    qweatherPrivateKey: `private-secret-${suffix}`,
    deepseekApiKey: `deepseek-secret-${suffix}`,
    deepseekBaseUrl: `https://deepseek-${suffix}.example.com`
  };
}

test("default service settings have the exact frozen schema", () => {
  assert.deepEqual(DEFAULT_SERVICE_SETTINGS, {
    qweatherApiKey: "",
    qweatherApiHost: "devapi.qweather.com",
    qweatherProjectId: "",
    qweatherCredentialId: "",
    qweatherPrivateKey: "",
    deepseekApiKey: "",
    deepseekBaseUrl: "https://api.deepseek.com"
  });
  assert.equal(Object.isFrozen(DEFAULT_SERVICE_SETTINGS), true);
});

test("normalization trims strings, discards unknown keys, and does not alias input", () => {
  const input = {
    qweatherApiKey: "  weather-key  ",
    qweatherApiHost: "  api.weather.example  ",
    qweatherProjectId: "  project  ",
    qweatherCredentialId: "  credential  ",
    qweatherPrivateKey: "  private-key  ",
    deepseekApiKey: "  deepseek-key  ",
    deepseekBaseUrl: "  https://deepseek.example  ",
    unknown: "discard me"
  };

  const normalized = normalizeServiceSettings(input);

  assert.deepEqual(normalized, {
    qweatherApiKey: "weather-key",
    qweatherApiHost: "api.weather.example",
    qweatherProjectId: "project",
    qweatherCredentialId: "credential",
    qweatherPrivateKey: "private-key",
    deepseekApiKey: "deepseek-key",
    deepseekBaseUrl: "https://deepseek.example"
  });
  assert.notStrictEqual(normalized, input);
  input.qweatherApiKey = "changed";
  assert.equal(normalized.qweatherApiKey, "weather-key");
});

test("normalization uses URL defaults and empty values for invalid fields", () => {
  assert.deepEqual(
    normalizeServiceSettings({
      qweatherApiKey: 1,
      qweatherApiHost: "   ",
      qweatherProjectId: null,
      qweatherCredentialId: false,
      qweatherPrivateKey: {},
      deepseekApiKey: [],
      deepseekBaseUrl: 42
    }),
    DEFAULT_SERVICE_SETTINGS
  );
  assert.deepEqual(normalizeServiceSettings(null), DEFAULT_SERVICE_SETTINGS);
  assert.notStrictEqual(normalizeServiceSettings(), normalizeServiceSettings());
});

test("settings round-trip while the exact persisted schema contains no plaintext secrets", async (t) => {
  const directory = await createTemporaryDirectory(t);
  const requested = completeSettings();

  assert.deepEqual(await writeServiceSettings(directory, requested, createSafeStorage()), requested);
  assert.deepEqual(await readServiceSettings(directory, createSafeStorage()), requested);

  const raw = await fs.readFile(path.join(directory, SETTINGS_FILE), "utf8");
  for (const secret of [
    requested.qweatherApiKey,
    requested.qweatherPrivateKey,
    requested.deepseekApiKey
  ]) {
    assert.equal(raw.includes(secret), false);
  }
  assert.deepEqual(JSON.parse(raw), {
    version: 1,
    qweatherApiHost: requested.qweatherApiHost,
    qweatherProjectId: requested.qweatherProjectId,
    qweatherCredentialId: requested.qweatherCredentialId,
    deepseekBaseUrl: requested.deepseekBaseUrl,
    encrypted: {
      qweatherApiKey: Buffer.from(`sealed:${requested.qweatherApiKey}`).toString("base64"),
      qweatherPrivateKey: Buffer.from(`sealed:${requested.qweatherPrivateKey}`).toString("base64"),
      deepseekApiKey: Buffer.from(`sealed:${requested.deepseekApiKey}`).toString("base64")
    }
  });
  assert.deepEqual(await fs.readdir(directory), [SETTINGS_FILE]);
});

test("missing files and corrupt JSON return fresh defaults", async (t) => {
  const directory = await createTemporaryDirectory(t);
  const first = await readServiceSettings(directory, createSafeStorage());
  first.qweatherApiHost = "changed";
  const second = await readServiceSettings(directory, createSafeStorage());
  assert.deepEqual(second, DEFAULT_SERVICE_SETTINGS);
  assert.notStrictEqual(first, second);

  await fs.writeFile(path.join(directory, SETTINGS_FILE), "{invalid", "utf8");
  assert.deepEqual(await readServiceSettings(directory, createSafeStorage()), DEFAULT_SERVICE_SETTINGS);
});

test("one malformed ciphertext clears only that secret", async (t) => {
  const directory = await createTemporaryDirectory(t);
  const requested = completeSettings();
  await writeServiceSettings(directory, requested, createSafeStorage());
  const target = path.join(directory, SETTINGS_FILE);
  const persisted = JSON.parse(await fs.readFile(target, "utf8"));
  persisted.encrypted.qweatherPrivateKey = "not base64!?";
  await fs.writeFile(target, JSON.stringify(persisted), "utf8");

  assert.deepEqual(await readServiceSettings(directory, createSafeStorage()), {
    ...requested,
    qweatherPrivateKey: ""
  });
});

test("decrypt errors and missing ciphertext affect only their own secrets", async (t) => {
  const directory = await createTemporaryDirectory(t);
  const requested = completeSettings();
  await writeServiceSettings(directory, requested, createSafeStorage());
  const target = path.join(directory, SETTINGS_FILE);
  const persisted = JSON.parse(await fs.readFile(target, "utf8"));
  delete persisted.encrypted.qweatherApiKey;
  persisted.encrypted.deepseekApiKey = Buffer.from("bad payload").toString("base64");
  await fs.writeFile(target, JSON.stringify(persisted), "utf8");

  assert.deepEqual(await readServiceSettings(directory, createSafeStorage()), {
    ...requested,
    qweatherApiKey: "",
    deepseekApiKey: ""
  });
});

test("non-missing-file read errors propagate", async (t) => {
  const filePath = path.join(await createTemporaryDirectory(t), "not-a-directory");
  await fs.writeFile(filePath, "file", "utf8");

  await assert.rejects(readServiceSettings(filePath, createSafeStorage()), { code: "ENOTDIR" });
});

test("unavailable encryption rejects before creating files when a secret is present", async (t) => {
  const directory = path.join(await createTemporaryDirectory(t), "not-created");
  await assert.rejects(
    writeServiceSettings(directory, { qweatherApiKey: "secret" }, createSafeStorage(false)),
    { message: "Secure credential storage is unavailable" }
  );
  await assert.rejects(fs.access(directory), { code: "ENOENT" });
});

test("unavailable encryption can persist public settings when all secrets are empty", async (t) => {
  const directory = await createTemporaryDirectory(t);
  const requested = {
    qweatherApiHost: "public.weather.example",
    qweatherProjectId: "public-project",
    qweatherCredentialId: "public-credential",
    deepseekBaseUrl: "https://public.deepseek.example"
  };

  const written = await writeServiceSettings(directory, requested, createSafeStorage(false));
  assert.deepEqual(written, normalizeServiceSettings(requested));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, SETTINGS_FILE), "utf8")), {
    version: 1,
    qweatherApiHost: requested.qweatherApiHost,
    qweatherProjectId: requested.qweatherProjectId,
    qweatherCredentialId: requested.qweatherCredentialId,
    deepseekBaseUrl: requested.deepseekBaseUrl,
    encrypted: {}
  });
});

test("environment resolution overrides each field only with nonblank strings without mutation", () => {
  const stored = completeSettings("stored");
  const storedSnapshot = { ...stored };
  const environment = {
    QWEATHER_API_KEY: " weather-env ",
    QWEATHER_API_HOST: "host-env.example",
    QWEATHER_PROJECT_ID: " project-env ",
    QWEATHER_CREDENTIAL_ID: "credential-env",
    QWEATHER_PRIVATE_KEY: " private-env ",
    DEEPSEEK_API_KEY: "deepseek-env",
    DEEPSEEK_BASE_URL: "https://deepseek-env.example",
    UNRELATED: "ignored"
  };
  const environmentSnapshot = { ...environment };

  assert.deepEqual(resolveServiceSettings(stored, environment), {
    qweatherApiKey: "weather-env",
    qweatherApiHost: "host-env.example",
    qweatherProjectId: "project-env",
    qweatherCredentialId: "credential-env",
    qweatherPrivateKey: "private-env",
    deepseekApiKey: "deepseek-env",
    deepseekBaseUrl: "https://deepseek-env.example"
  });
  assert.deepEqual(stored, storedSnapshot);
  assert.deepEqual(environment, environmentSnapshot);

  assert.deepEqual(
    resolveServiceSettings(stored, {
      QWEATHER_API_KEY: "   ",
      QWEATHER_API_HOST: 123,
      DEEPSEEK_BASE_URL: "\t"
    }),
    stored
  );
});

test("public settings have the exact redacted renderer-safe shape", () => {
  const requested = completeSettings();
  const result = publicServiceSettings(requested);

  assert.deepEqual(result, {
    hasQWeatherApiKey: true,
    qweatherApiHost: requested.qweatherApiHost,
    qweatherProjectId: requested.qweatherProjectId,
    qweatherCredentialId: requested.qweatherCredentialId,
    hasQWeatherPrivateKey: true,
    hasDeepSeekApiKey: true,
    deepseekBaseUrl: requested.deepseekBaseUrl
  });
  assert.deepEqual(Object.keys(result), [
    "hasQWeatherApiKey",
    "qweatherApiHost",
    "qweatherProjectId",
    "qweatherCredentialId",
    "hasQWeatherPrivateKey",
    "hasDeepSeekApiKey",
    "deepseekBaseUrl"
  ]);
  assert.equal(JSON.stringify(result).includes("weather-secret-one"), false);
});

test("service environment mapping is exact, string-valued, and non-mutating", () => {
  const requested = completeSettings();
  const snapshot = { ...requested };

  assert.deepEqual(toServiceEnvironment(requested), {
    QWEATHER_API_KEY: requested.qweatherApiKey,
    QWEATHER_API_HOST: requested.qweatherApiHost,
    QWEATHER_PROJECT_ID: requested.qweatherProjectId,
    QWEATHER_CREDENTIAL_ID: requested.qweatherCredentialId,
    QWEATHER_PRIVATE_KEY: requested.qweatherPrivateKey,
    DEEPSEEK_API_KEY: requested.deepseekApiKey,
    DEEPSEEK_BASE_URL: requested.deepseekBaseUrl
  });
  assert.deepEqual(requested, snapshot);
  for (const value of Object.values(toServiceEnvironment({}))) {
    assert.equal(typeof value, "string");
  }
});

test("concurrent writes never reject and leave one complete requested payload", async (t) => {
  const directory = await createTemporaryDirectory(t);
  const requested = [completeSettings("one"), completeSettings("two")];

  await Promise.all(
    Array.from({ length: 32 }, (_, index) =>
      writeServiceSettings(directory, requested[index % requested.length], createSafeStorage())
    )
  );

  const result = await readServiceSettings(directory, createSafeStorage());
  assert.equal(requested.some((candidate) => JSON.stringify(candidate) === JSON.stringify(result)), true);
  assert.deepEqual(await fs.readdir(directory), [SETTINGS_FILE]);
});

test("failed writes clean up unique temporary files", async (t) => {
  const directory = await createTemporaryDirectory(t);
  await fs.mkdir(path.join(directory, SETTINGS_FILE));

  await assert.rejects(writeServiceSettings(directory, completeSettings(), createSafeStorage()));

  assert.deepEqual(await fs.readdir(directory), [SETTINGS_FILE]);
});
