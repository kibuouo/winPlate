const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_SERVICE_SETTINGS,
  normalizeServiceSettings,
  serviceSettingsFileExists,
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

function createRotatingSafeStorage() {
  let encryptions = 0;
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => {
      encryptions += 1;
      return Buffer.from(`sealed:${encryptions}:${value}`, "utf8");
    },
    decryptString: (value) => {
      const match = value.toString("utf8").match(/^sealed:\d+:(.*)$/s);
      if (!match) throw new Error("invalid ciphertext");
      return match[1];
    },
    encryptionCount: () => encryptions
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
    deepseekBaseUrl: `https://deepseek-${suffix}.example.com`,
    githubToken: `github-secret-${suffix}`,
    qqMailAddress: `user-${suffix}@qq.com`,
    qqMailAuthCode: `mail-auth-${suffix}`,
    qqMailImapHost: `imap-${suffix}.qq.com`,
    qqMailImapPort: `${900 + suffix.length}`,
    qqMailSmtpHost: `smtp-${suffix}.qq.com`,
    qqMailSmtpPort: `${400 + suffix.length}`
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
    deepseekBaseUrl: "https://api.deepseek.com",
    githubToken: "",
    qqMailAddress: "",
    qqMailAuthCode: "",
    qqMailImapHost: "imap.qq.com",
    qqMailImapPort: "993",
    qqMailSmtpHost: "smtp.qq.com",
    qqMailSmtpPort: "465"
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
    githubToken: "  github-token  ",
    qqMailAddress: "  user@qq.com  ",
    qqMailAuthCode: "  mail-auth  ",
    qqMailImapHost: "  imap.qq.com  ",
    qqMailImapPort: "  993  ",
    qqMailSmtpHost: "  smtp.qq.com  ",
    qqMailSmtpPort: "  465  ",
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
    deepseekBaseUrl: "https://deepseek.example",
    githubToken: "github-token",
    qqMailAddress: "user@qq.com",
    qqMailAuthCode: "mail-auth",
    qqMailImapHost: "imap.qq.com",
    qqMailImapPort: "993",
    qqMailSmtpHost: "smtp.qq.com",
    qqMailSmtpPort: "465"
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
      deepseekBaseUrl: 42,
      githubToken: 7,
      qqMailAddress: {},
      qqMailAuthCode: false,
      qqMailImapHost: 8,
      qqMailImapPort: {},
      qqMailSmtpHost: [],
      qqMailSmtpPort: null
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
    requested.deepseekApiKey,
    requested.githubToken,
    requested.qqMailAuthCode
  ]) {
    assert.equal(raw.includes(secret), false);
  }
  assert.deepEqual(JSON.parse(raw), {
    version: 1,
    qweatherApiHost: requested.qweatherApiHost,
    qweatherProjectId: requested.qweatherProjectId,
    qweatherCredentialId: requested.qweatherCredentialId,
    deepseekBaseUrl: requested.deepseekBaseUrl,
    qqMailAddress: requested.qqMailAddress,
    qqMailImapHost: requested.qqMailImapHost,
    qqMailImapPort: requested.qqMailImapPort,
    qqMailSmtpHost: requested.qqMailSmtpHost,
    qqMailSmtpPort: requested.qqMailSmtpPort,
    encrypted: {
      qweatherApiKey: Buffer.from(`sealed:${requested.qweatherApiKey}`).toString("base64"),
      qweatherPrivateKey: Buffer.from(`sealed:${requested.qweatherPrivateKey}`).toString("base64"),
      deepseekApiKey: Buffer.from(`sealed:${requested.deepseekApiKey}`).toString("base64"),
      githubToken: Buffer.from(`sealed:${requested.githubToken}`).toString("base64"),
      qqMailAuthCode: Buffer.from(`sealed:${requested.qqMailAuthCode}`).toString("base64")
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

test("reports whether the persisted service settings file exists", async (t) => {
  const directory = await createTemporaryDirectory(t);
  assert.equal(await serviceSettingsFileExists(directory), false);

  await writeServiceSettings(directory, {}, createSafeStorage());
  assert.equal(await serviceSettingsFileExists(directory), true);
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

test("public-only writes preserve recoverable ciphertext after an isolated decrypt failure", async (t) => {
  const directory = await createTemporaryDirectory(t);
  const requested = completeSettings();
  const availableStorage = createRotatingSafeStorage();
  await writeServiceSettings(directory, requested, availableStorage);
  const target = path.join(directory, SETTINGS_FILE);
  const before = JSON.parse(await fs.readFile(target, "utf8"));
  const transientFailureStorage = availableStorage;
  const decryptString = transientFailureStorage.decryptString;
  transientFailureStorage.decryptString = (value) => {
    const plaintext = decryptString(value);
    if (plaintext === requested.qweatherApiKey) {
      throw new Error("transient decrypt failure");
    }
    return plaintext;
  };

  const partiallyRead = await readServiceSettings(directory, transientFailureStorage);
  assert.equal(partiallyRead.qweatherApiKey, "");
  assert.equal(partiallyRead.qweatherPrivateKey, requested.qweatherPrivateKey);
  assert.equal(partiallyRead.deepseekApiKey, requested.deepseekApiKey);

  await writeServiceSettings(directory, {
    ...partiallyRead,
    qweatherApiHost: "updated.weather.example"
  }, transientFailureStorage);

  const after = JSON.parse(await fs.readFile(target, "utf8"));
  assert.deepEqual(after.encrypted, before.encrypted);

  await writeServiceSettings(directory, {
    ...partiallyRead,
    qweatherApiHost: "updated-again.weather.example"
  }, transientFailureStorage);
  const afterSecondSave = JSON.parse(await fs.readFile(target, "utf8"));
  assert.deepEqual(afterSecondSave.encrypted, before.encrypted);
  assert.equal(availableStorage.encryptionCount(), 5);
  transientFailureStorage.decryptString = decryptString;
  assert.deepEqual(await readServiceSettings(directory, transientFailureStorage), {
    ...requested,
    qweatherApiHost: "updated-again.weather.example"
  });
});

test("changing one secret rotates only that ciphertext", async (t) => {
  const directory = await createTemporaryDirectory(t);
  const storage = createRotatingSafeStorage();
  const requested = completeSettings();
  await writeServiceSettings(directory, requested, storage);
  const target = path.join(directory, SETTINGS_FILE);
  const before = JSON.parse(await fs.readFile(target, "utf8"));
  const loaded = await readServiceSettings(directory, storage);

  await writeServiceSettings(directory, {
    ...loaded,
    deepseekApiKey: "changed-deepseek-secret"
  }, storage);

  const after = JSON.parse(await fs.readFile(target, "utf8"));
  assert.equal(after.encrypted.qweatherApiKey, before.encrypted.qweatherApiKey);
  assert.equal(after.encrypted.qweatherPrivateKey, before.encrypted.qweatherPrivateKey);
  assert.notEqual(after.encrypted.deepseekApiKey, before.encrypted.deepseekApiKey);
  assert.equal(storage.encryptionCount(), 6);
  assert.equal((await readServiceSettings(directory, storage)).deepseekApiKey, "changed-deepseek-secret");
});

test("writes reject corrupt or unsupported existing documents without replacing them", async (t) => {
  for (const [contents, expected] of [
    ["{invalid", { name: "SyntaxError" }],
    [JSON.stringify({ version: 2, encrypted: { qweatherApiKey: "opaque" } }), {
      message: "Unsupported service settings version: 2"
    }]
  ]) {
    const directory = await createTemporaryDirectory(t);
    const target = path.join(directory, SETTINGS_FILE);
    await fs.writeFile(target, contents, "utf8");

    await assert.rejects(
      writeServiceSettings(directory, { qweatherApiHost: "replacement.example" }, createSafeStorage()),
      expected
    );
    assert.equal(await fs.readFile(target, "utf8"), contents);
  }
});

test("encrypted settings reject when secure storage is unavailable without changing the file", async (t) => {
  const directory = await createTemporaryDirectory(t);
  await writeServiceSettings(directory, completeSettings(), createSafeStorage());
  const target = path.join(directory, SETTINGS_FILE);
  const original = await fs.readFile(target);

  await assert.rejects(readServiceSettings(directory, createSafeStorage(false)), {
    message: "Secure credential storage is unavailable"
  });

  assert.deepEqual(await fs.readFile(target), original);
});

test("public-only settings load when secure storage is unavailable", async (t) => {
  const directory = await createTemporaryDirectory(t);
  const requested = {
    qweatherApiHost: "public.weather.example",
    qweatherProjectId: "public-project",
    qweatherCredentialId: "public-credential",
    deepseekBaseUrl: "https://public.deepseek.example",
    qqMailAddress: "public@qq.com",
    qqMailImapHost: "imap.public.qq.com",
    qqMailImapPort: "2993",
    qqMailSmtpHost: "smtp.public.qq.com",
    qqMailSmtpPort: "2465"
  };
  await writeServiceSettings(directory, requested, createSafeStorage(false));

  assert.deepEqual(
    await readServiceSettings(directory, createSafeStorage(false)),
    normalizeServiceSettings(requested)
  );
});

test("encrypted settings require a complete safeStorage decryption dependency", async (t) => {
  const directory = await createTemporaryDirectory(t);
  await writeServiceSettings(directory, completeSettings(), createSafeStorage());

  await assert.rejects(readServiceSettings(directory, {}), {
    name: "TypeError",
    message: "safeStorage.isEncryptionAvailable must be a function"
  });
  await assert.rejects(
    readServiceSettings(directory, { isEncryptionAvailable: () => true }),
    {
      name: "TypeError",
      message: "safeStorage.decryptString must be a function"
    }
  );
});

test("missing persisted version is accepted as legacy version 1", async (t) => {
  const directory = await createTemporaryDirectory(t);
  const requested = completeSettings();
  await writeServiceSettings(directory, requested, createSafeStorage());
  const target = path.join(directory, SETTINGS_FILE);
  const persisted = JSON.parse(await fs.readFile(target, "utf8"));
  delete persisted.version;
  await fs.writeFile(target, JSON.stringify(persisted), "utf8");

  assert.deepEqual(await readServiceSettings(directory, createSafeStorage()), requested);
});

test("unsupported persisted versions reject before decryption without changing the file", async (t) => {
  const directory = await createTemporaryDirectory(t);
  await writeServiceSettings(directory, completeSettings(), createSafeStorage());
  const target = path.join(directory, SETTINGS_FILE);
  const persisted = JSON.parse(await fs.readFile(target, "utf8"));
  persisted.version = 2;
  const original = Buffer.from(JSON.stringify(persisted), "utf8");
  await fs.writeFile(target, original);
  let decryptions = 0;
  const safeStorage = createSafeStorage();
  safeStorage.decryptString = () => {
    decryptions += 1;
    throw new Error("must not decrypt");
  };

  await assert.rejects(readServiceSettings(directory, safeStorage), {
    message: "Unsupported service settings version: 2"
  });

  assert.equal(decryptions, 0);
  assert.deepEqual(await fs.readFile(target), original);
});

test("non-missing-file read errors propagate", async (t) => {
  const directory = await createTemporaryDirectory(t);
  const target = path.join(directory, SETTINGS_FILE);
  await fs.mkdir(target);
  let platformError;
  try {
    await fs.readFile(target, "utf8");
  } catch (error) {
    platformError = error;
  }

  assert.notEqual(platformError?.code, "ENOENT");
  await assert.rejects(readServiceSettings(directory, createSafeStorage()), {
    code: platformError.code
  });
});

test("unavailable encryption rejects before creating files when a secret is present", async (t) => {
  const directory = path.join(await createTemporaryDirectory(t), "not-created");
  await assert.rejects(
    writeServiceSettings(directory, { qweatherApiKey: "secret" }, createSafeStorage(false)),
    { message: "Secure credential storage is unavailable" }
  );
  await assert.rejects(fs.access(directory), { code: "ENOENT" });
});

test("encrypted writes require a complete safeStorage encryption dependency", async (t) => {
  const directory = path.join(await createTemporaryDirectory(t), "not-created");

  await assert.rejects(writeServiceSettings(directory, { qweatherApiKey: "secret" }, {}), {
    name: "TypeError",
    message: "safeStorage.isEncryptionAvailable must be a function"
  });
  await assert.rejects(
    writeServiceSettings(
      directory,
      { qweatherApiKey: "secret" },
      { isEncryptionAvailable: () => true }
    ),
    {
      name: "TypeError",
      message: "safeStorage.encryptString must be a function"
    }
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
    qqMailAddress: "",
    qqMailImapHost: DEFAULT_SERVICE_SETTINGS.qqMailImapHost,
    qqMailImapPort: DEFAULT_SERVICE_SETTINGS.qqMailImapPort,
    qqMailSmtpHost: DEFAULT_SERVICE_SETTINGS.qqMailSmtpHost,
    qqMailSmtpPort: DEFAULT_SERVICE_SETTINGS.qqMailSmtpPort,
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
    GITHUB_TOKEN: " github-env ",
    QQ_MAIL_ADDRESS: " env@qq.com ",
    QQ_MAIL_AUTH_CODE: " env-auth ",
    QQ_MAIL_IMAP_HOST: "imap.env.qq.com",
    QQ_MAIL_IMAP_PORT: "3993",
    QQ_MAIL_SMTP_HOST: "smtp.env.qq.com",
    QQ_MAIL_SMTP_PORT: "3465",
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
    deepseekBaseUrl: "https://deepseek-env.example",
    githubToken: "github-env",
    qqMailAddress: "env@qq.com",
    qqMailAuthCode: "env-auth",
    qqMailImapHost: "imap.env.qq.com",
    qqMailImapPort: "3993",
    qqMailSmtpHost: "smtp.env.qq.com",
    qqMailSmtpPort: "3465"
  });
  assert.deepEqual(stored, storedSnapshot);
  assert.deepEqual(environment, environmentSnapshot);

  assert.deepEqual(
    resolveServiceSettings(stored, {
      QWEATHER_API_KEY: "   ",
      QWEATHER_API_HOST: 123,
      DEEPSEEK_BASE_URL: "\t",
      GITHUB_TOKEN: {},
      QQ_MAIL_AUTH_CODE: "   "
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
    deepseekBaseUrl: requested.deepseekBaseUrl,
    hasGitHubToken: true,
    qqMailAddress: requested.qqMailAddress,
    hasQqMailAuthCode: true,
    qqMailImapHost: requested.qqMailImapHost,
    qqMailImapPort: requested.qqMailImapPort,
    qqMailSmtpHost: requested.qqMailSmtpHost,
    qqMailSmtpPort: requested.qqMailSmtpPort
  });
  assert.deepEqual(Object.keys(result), [
    "hasQWeatherApiKey",
    "qweatherApiHost",
    "qweatherProjectId",
    "qweatherCredentialId",
    "hasQWeatherPrivateKey",
    "hasDeepSeekApiKey",
    "deepseekBaseUrl",
    "hasGitHubToken",
    "qqMailAddress",
    "hasQqMailAuthCode",
    "qqMailImapHost",
    "qqMailImapPort",
    "qqMailSmtpHost",
    "qqMailSmtpPort"
  ]);
  assert.equal(JSON.stringify(result).includes("weather-secret-one"), false);
  assert.equal(JSON.stringify(result).includes("github-secret-one"), false);
  assert.equal(JSON.stringify(result).includes("mail-auth-one"), false);
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
    DEEPSEEK_BASE_URL: requested.deepseekBaseUrl,
    GITHUB_TOKEN: requested.githubToken,
    QQ_MAIL_ADDRESS: requested.qqMailAddress,
    QQ_MAIL_AUTH_CODE: requested.qqMailAuthCode,
    QQ_MAIL_IMAP_HOST: requested.qqMailImapHost,
    QQ_MAIL_IMAP_PORT: requested.qqMailImapPort,
    QQ_MAIL_SMTP_HOST: requested.qqMailSmtpHost,
    QQ_MAIL_SMTP_PORT: requested.qqMailSmtpPort
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

test("serializes encrypted replacements when overlapping renames are rejected", async (t) => {
  const directory = await createTemporaryDirectory(t);
  const originalRename = fs.rename;
  let replacementInProgress = false;

  fs.rename = async (...args) => {
    if (replacementInProgress) {
      const error = new Error("overlapping replacement");
      error.code = "EPERM";
      throw error;
    }
    replacementInProgress = true;
    try {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return await originalRename(...args);
    } finally {
      replacementInProgress = false;
    }
  };
  t.after(() => {
    fs.rename = originalRename;
  });

  await Promise.all([
    writeServiceSettings(directory, completeSettings("one"), createSafeStorage()),
    writeServiceSettings(directory, completeSettings("two"), createSafeStorage())
  ]);
});

test("failed writes clean up unique temporary files", async (t) => {
  const directory = await createTemporaryDirectory(t);
  await fs.mkdir(path.join(directory, SETTINGS_FILE));

  await assert.rejects(writeServiceSettings(directory, completeSettings(), createSafeStorage()));

  assert.deepEqual(await fs.readdir(directory), [SETTINGS_FILE]);
});
