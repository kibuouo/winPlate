const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { serializeFileWrite } = require("./fileWriteQueue");

const DEFAULT_SERVICE_SETTINGS = Object.freeze({
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

const SECRET_FIELDS = ["qweatherApiKey", "qweatherPrivateKey", "deepseekApiKey", "githubToken", "qqMailAuthCode"];
const ENVIRONMENT_FIELDS = {
  QWEATHER_API_KEY: "qweatherApiKey",
  QWEATHER_API_HOST: "qweatherApiHost",
  QWEATHER_PROJECT_ID: "qweatherProjectId",
  QWEATHER_CREDENTIAL_ID: "qweatherCredentialId",
  QWEATHER_PRIVATE_KEY: "qweatherPrivateKey",
  DEEPSEEK_API_KEY: "deepseekApiKey",
  DEEPSEEK_BASE_URL: "deepseekBaseUrl",
  GITHUB_TOKEN: "githubToken",
  QQ_MAIL_ADDRESS: "qqMailAddress",
  QQ_MAIL_AUTH_CODE: "qqMailAuthCode",
  QQ_MAIL_IMAP_HOST: "qqMailImapHost",
  QQ_MAIL_IMAP_PORT: "qqMailImapPort",
  QQ_MAIL_SMTP_HOST: "qqMailSmtpHost",
  QQ_MAIL_SMTP_PORT: "qqMailSmtpPort"
};

function normalizedString(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }
  return value.trim() || fallback;
}

function normalizeServiceSettings(value = {}) {
  const candidate = value && typeof value === "object" ? value : {};
  return {
    qweatherApiKey: normalizedString(candidate.qweatherApiKey),
    qweatherApiHost: normalizedString(
      candidate.qweatherApiHost,
      DEFAULT_SERVICE_SETTINGS.qweatherApiHost
    ),
    qweatherProjectId: normalizedString(candidate.qweatherProjectId),
    qweatherCredentialId: normalizedString(candidate.qweatherCredentialId),
    qweatherPrivateKey: normalizedString(candidate.qweatherPrivateKey),
    deepseekApiKey: normalizedString(candidate.deepseekApiKey),
    deepseekBaseUrl: normalizedString(
      candidate.deepseekBaseUrl,
      DEFAULT_SERVICE_SETTINGS.deepseekBaseUrl
    ),
    githubToken: normalizedString(candidate.githubToken),
    qqMailAddress: normalizedString(candidate.qqMailAddress),
    qqMailAuthCode: normalizedString(candidate.qqMailAuthCode),
    qqMailImapHost: normalizedString(
      candidate.qqMailImapHost,
      DEFAULT_SERVICE_SETTINGS.qqMailImapHost
    ),
    qqMailImapPort: normalizedString(
      candidate.qqMailImapPort,
      DEFAULT_SERVICE_SETTINGS.qqMailImapPort
    ),
    qqMailSmtpHost: normalizedString(
      candidate.qqMailSmtpHost,
      DEFAULT_SERVICE_SETTINGS.qqMailSmtpHost
    ),
    qqMailSmtpPort: normalizedString(
      candidate.qqMailSmtpPort,
      DEFAULT_SERVICE_SETTINGS.qqMailSmtpPort
    )
  };
}

function serviceSettingsPath(userDataPath) {
  return path.join(userDataPath, "service-settings.json");
}

async function serviceSettingsFileExists(userDataPath) {
  try {
    await fs.access(serviceSettingsPath(userDataPath));
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function decodeBase64(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw new Error("Invalid encrypted service setting");
  }
  return Buffer.from(value, "base64");
}

function decryptSecret(encrypted, field, safeStorage) {
  try {
    return safeStorage.decryptString(decodeBase64(encrypted?.[field]));
  } catch {
    return "";
  }
}

function requireSafeStorageMethod(safeStorage, method) {
  if (!safeStorage || typeof safeStorage[method] !== "function") {
    throw new TypeError(`safeStorage.${method} must be a function`);
  }
}

function requireStorageAvailability(safeStorage) {
  requireSafeStorageMethod(safeStorage, "isEncryptionAvailable");
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Secure credential storage is unavailable");
  }
}

function requireDecryptionStorage(safeStorage) {
  requireStorageAvailability(safeStorage);
  requireSafeStorageMethod(safeStorage, "decryptString");
}

function requireEncryptionStorage(safeStorage) {
  requireStorageAvailability(safeStorage);
  requireSafeStorageMethod(safeStorage, "encryptString");
}

async function readServiceSettings(userDataPath, safeStorage) {
  let contents;
  try {
    contents = await fs.readFile(serviceSettingsPath(userDataPath), "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    return { ...DEFAULT_SERVICE_SETTINGS };
  }

  let persisted;
  try {
    persisted = JSON.parse(contents);
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
    return { ...DEFAULT_SERVICE_SETTINGS };
  }

  const candidate = persisted && typeof persisted === "object" ? persisted : {};
  if (
    Object.prototype.hasOwnProperty.call(candidate, "version") &&
    candidate.version !== 1
  ) {
    throw new Error(`Unsupported service settings version: ${candidate.version}`);
  }

  const encrypted =
    candidate.encrypted && typeof candidate.encrypted === "object"
      ? candidate.encrypted
      : {};
  const hasEncryptedSecrets = SECRET_FIELDS.some(
    (field) => typeof encrypted[field] === "string" && encrypted[field].length > 0
  );
  if (hasEncryptedSecrets) {
    requireDecryptionStorage(safeStorage);
  }

  return normalizeServiceSettings({
    ...candidate,
    qweatherApiKey: decryptSecret(encrypted, "qweatherApiKey", safeStorage),
    qweatherPrivateKey: decryptSecret(encrypted, "qweatherPrivateKey", safeStorage),
    deepseekApiKey: decryptSecret(encrypted, "deepseekApiKey", safeStorage),
    githubToken: decryptSecret(encrypted, "githubToken", safeStorage),
    qqMailAuthCode: decryptSecret(encrypted, "qqMailAuthCode", safeStorage)
  });
}

async function encryptedSecretsToPreserve(userDataPath) {
  let contents;
  try {
    contents = await fs.readFile(serviceSettingsPath(userDataPath), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }

  const persisted = JSON.parse(contents);
  if (!persisted || typeof persisted !== "object" || Array.isArray(persisted)) {
    throw new Error("Invalid service settings document");
  }
  if (
    Object.prototype.hasOwnProperty.call(persisted, "version")
    && persisted.version !== 1
  ) {
    throw new Error(`Unsupported service settings version: ${persisted.version}`);
  }
  const encrypted = persisted.encrypted && typeof persisted.encrypted === "object"
    ? persisted.encrypted
    : {};
  return Object.fromEntries(SECRET_FIELDS.flatMap((field) => (
    typeof encrypted[field] === "string" && encrypted[field].length > 0
      ? [[field, encrypted[field]]]
      : []
  )));
}

function existingCiphertextMatches(ciphertext, plaintext, safeStorage) {
  if (!ciphertext || typeof safeStorage?.decryptString !== "function") return false;
  try {
    return safeStorage.decryptString(decodeBase64(ciphertext)) === plaintext;
  } catch {
    return false;
  }
}

function encryptedSecrets(settings, safeStorage, preservedEncrypted) {
  const encrypted = {};
  for (const field of SECRET_FIELDS) {
    if (settings[field]) {
      encrypted[field] = existingCiphertextMatches(
        preservedEncrypted[field],
        settings[field],
        safeStorage
      )
        ? preservedEncrypted[field]
        : Buffer.from(safeStorage.encryptString(settings[field])).toString("base64");
    } else if (preservedEncrypted[field]) {
      encrypted[field] = preservedEncrypted[field];
    }
  }
  return encrypted;
}

async function writeServiceSettings(userDataPath, value, safeStorage) {
  const target = serviceSettingsPath(userDataPath);
  return serializeFileWrite(target, async () => {
    const preservedEncrypted = await encryptedSecretsToPreserve(userDataPath);
    const settings = normalizeServiceSettings(value);
    const hasSecrets = SECRET_FIELDS.some((field) => settings[field]);
    if (hasSecrets) {
      requireEncryptionStorage(safeStorage);
    }

    const persisted = {
      version: 1,
      qweatherApiHost: settings.qweatherApiHost,
      qweatherProjectId: settings.qweatherProjectId,
      qweatherCredentialId: settings.qweatherCredentialId,
      deepseekBaseUrl: settings.deepseekBaseUrl,
      qqMailAddress: settings.qqMailAddress,
      qqMailImapHost: settings.qqMailImapHost,
      qqMailImapPort: settings.qqMailImapPort,
      qqMailSmtpHost: settings.qqMailSmtpHost,
      qqMailSmtpPort: settings.qqMailSmtpPort,
      encrypted: encryptedSecrets(settings, safeStorage, preservedEncrypted)
    };
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;

    await fs.mkdir(userDataPath, { recursive: true });
    try {
      await fs.writeFile(temporary, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");
      await fs.rename(temporary, target);
    } finally {
      await fs.rm(temporary, { force: true });
    }
    return settings;
  });
}

function resolveServiceSettings(stored, environment = process.env) {
  const resolved = normalizeServiceSettings(stored);
  const source = environment && typeof environment === "object" ? environment : {};
  for (const [environmentField, settingsField] of Object.entries(ENVIRONMENT_FIELDS)) {
    if (typeof source[environmentField] === "string" && source[environmentField].trim()) {
      resolved[settingsField] = source[environmentField].trim();
    }
  }
  return resolved;
}

function publicServiceSettings(value) {
  const settings = normalizeServiceSettings(value);
  return {
    hasQWeatherApiKey: Boolean(settings.qweatherApiKey),
    qweatherApiHost: settings.qweatherApiHost,
    qweatherProjectId: settings.qweatherProjectId,
    qweatherCredentialId: settings.qweatherCredentialId,
    hasQWeatherPrivateKey: Boolean(settings.qweatherPrivateKey),
    hasDeepSeekApiKey: Boolean(settings.deepseekApiKey),
    deepseekBaseUrl: settings.deepseekBaseUrl,
    hasGitHubToken: Boolean(settings.githubToken),
    qqMailAddress: settings.qqMailAddress,
    hasQqMailAuthCode: Boolean(settings.qqMailAuthCode),
    qqMailImapHost: settings.qqMailImapHost,
    qqMailImapPort: settings.qqMailImapPort,
    qqMailSmtpHost: settings.qqMailSmtpHost,
    qqMailSmtpPort: settings.qqMailSmtpPort
  };
}

function toServiceEnvironment(value) {
  const settings = normalizeServiceSettings(value);
  return {
    QWEATHER_API_KEY: settings.qweatherApiKey,
    QWEATHER_API_HOST: settings.qweatherApiHost,
    QWEATHER_PROJECT_ID: settings.qweatherProjectId,
    QWEATHER_CREDENTIAL_ID: settings.qweatherCredentialId,
    QWEATHER_PRIVATE_KEY: settings.qweatherPrivateKey,
    DEEPSEEK_API_KEY: settings.deepseekApiKey,
    DEEPSEEK_BASE_URL: settings.deepseekBaseUrl,
    GITHUB_TOKEN: settings.githubToken,
    QQ_MAIL_ADDRESS: settings.qqMailAddress,
    QQ_MAIL_AUTH_CODE: settings.qqMailAuthCode,
    QQ_MAIL_IMAP_HOST: settings.qqMailImapHost,
    QQ_MAIL_IMAP_PORT: settings.qqMailImapPort,
    QQ_MAIL_SMTP_HOST: settings.qqMailSmtpHost,
    QQ_MAIL_SMTP_PORT: settings.qqMailSmtpPort
  };
}

module.exports = {
  DEFAULT_SERVICE_SETTINGS,
  normalizeServiceSettings,
  serviceSettingsFileExists,
  readServiceSettings,
  writeServiceSettings,
  resolveServiceSettings,
  publicServiceSettings,
  toServiceEnvironment
};
