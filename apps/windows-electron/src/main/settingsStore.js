const fs = require("fs/promises");
const path = require("path");
const { MODULES } = require("../shared/moduleRegistry");

const SETTINGS_VERSION = 1;
const VALID_THEMES = new Set(["system", "dark", "light"]);
const VALID_DENSITIES = new Set(["comfortable", "compact"]);

function defaultSettings() {
  return {
    version: SETTINGS_VERSION,
    appearance: {
      theme: "system",
      opacity: 0.94,
      density: "comfortable"
    },
    modules: {
      enabled: Object.fromEntries(MODULES.map((module) => [module.id, module.defaultEnabled])),
      order: [...MODULES].sort((a, b) => a.defaultOrder - b.defaultOrder).map((module) => module.id),
      refreshSeconds: Object.fromEntries(MODULES.map((module) => [module.id, module.defaultRefreshSeconds]))
    },
    integrations: {
      github: { username: "kibuouo" }
    },
    notificationDigest: {
      enabled: true
    }
  };
}

function clampNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, number));
}

function normalizeOrder(order) {
  const known = new Set(MODULES.map((module) => module.id));
  const unique = [];
  for (const id of Array.isArray(order) ? order : []) {
    if (known.has(id) && !unique.includes(id)) unique.push(id);
  }
  for (const module of MODULES) {
    if (!unique.includes(module.id)) unique.push(module.id);
  }
  return unique;
}

function normalizeSettings(value = {}, fallback = defaultSettings()) {
  const source = value && typeof value === "object" ? value : {};
  const appearance = source.appearance && typeof source.appearance === "object" ? source.appearance : {};
  const moduleSettings = source.modules && typeof source.modules === "object" ? source.modules : {};
  const enabledInput = moduleSettings.enabled && typeof moduleSettings.enabled === "object" ? moduleSettings.enabled : {};
  const intervals = moduleSettings.refreshSeconds && typeof moduleSettings.refreshSeconds === "object"
    ? moduleSettings.refreshSeconds
    : {};
  const github = source.integrations?.github && typeof source.integrations.github === "object"
    ? source.integrations.github
    : {};
  const digest = source.notificationDigest && typeof source.notificationDigest === "object"
    ? source.notificationDigest
    : {};
  const username = String(github.username || fallback.integrations.github.username || "kibuouo").trim();

  return {
    version: SETTINGS_VERSION,
    appearance: {
      theme: VALID_THEMES.has(appearance.theme) ? appearance.theme : fallback.appearance.theme,
      opacity: clampNumber(appearance.opacity, fallback.appearance.opacity, 0.65, 1),
      density: VALID_DENSITIES.has(appearance.density) ? appearance.density : fallback.appearance.density
    },
    modules: {
      enabled: Object.fromEntries(MODULES.map((module) => [
        module.id,
        typeof enabledInput[module.id] === "boolean" ? enabledInput[module.id] : fallback.modules.enabled[module.id]
      ])),
      order: normalizeOrder(moduleSettings.order || fallback.modules.order),
      refreshSeconds: Object.fromEntries(MODULES.map((module) => [
        module.id,
        Math.round(clampNumber(
          intervals[module.id],
          fallback.modules.refreshSeconds[module.id],
          module.minRefreshSeconds,
          module.maxRefreshSeconds
        ))
      ]))
    },
    integrations: {
      github: {
        username: /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(username)
          ? username
          : fallback.integrations.github.username
      }
    },
    notificationDigest: {
      enabled: digest.privacyMode === "local-only"
        ? false
        : typeof digest.enabled === "boolean"
          ? digest.enabled
          : fallback.notificationDigest.enabled
    }
  };
}

function settingsPath(userDataPath) {
  return path.join(userDataPath, "settings.json");
}

async function readLegacyAppearance(userDataPath) {
  try {
    const value = JSON.parse(await fs.readFile(path.join(userDataPath, "appearance.json"), "utf8"));
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

async function persistNormalizedSettings(userDataPath, normalized) {
  await fs.mkdir(userDataPath, { recursive: true });
  const target = settingsPath(userDataPath);
  const temporary = `${target}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  await fs.rename(temporary, target);
  return normalized;
}

async function readSettings(userDataPath) {
  const defaults = defaultSettings();
  try {
    const value = JSON.parse(await fs.readFile(settingsPath(userDataPath), "utf8"));
    return normalizeSettings(value, defaults);
  } catch {
    const legacy = await readLegacyAppearance(userDataPath);
    if (!legacy) return defaults;
    const migrated = normalizeSettings({
      appearance: { theme: legacy.theme },
      modules: {
        refreshSeconds: { mail: legacy.mailAutoRefreshSeconds }
      }
    }, defaults);
    await persistNormalizedSettings(userDataPath, migrated);
    return migrated;
  }
}

async function writeSettings(userDataPath, value) {
  const current = await readSettings(userDataPath);
  const normalized = normalizeSettings(value, current);
  return persistNormalizedSettings(userDataPath, normalized);
}

module.exports = {
  SETTINGS_VERSION,
  defaultSettings,
  normalizeSettings,
  readSettings,
  settingsPath,
  writeSettings
};
