const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const DEFAULT_APP_SETTINGS = Object.freeze({
  menuBarEnabled: true,
  launchAtLogin: false
});

function normalizeAppSettings(value = {}) {
  const candidate = value && typeof value === "object" ? value : {};
  return {
    menuBarEnabled:
      typeof candidate.menuBarEnabled === "boolean"
        ? candidate.menuBarEnabled
        : DEFAULT_APP_SETTINGS.menuBarEnabled,
    launchAtLogin:
      typeof candidate.launchAtLogin === "boolean"
        ? candidate.launchAtLogin
        : DEFAULT_APP_SETTINGS.launchAtLogin
  };
}

function appSettingsPath(userDataPath) {
  return path.join(userDataPath, "app-settings.json");
}

async function readAppSettings(userDataPath) {
  try {
    const contents = await fs.readFile(appSettingsPath(userDataPath), "utf8");
    return normalizeAppSettings(JSON.parse(contents));
  } catch (error) {
    if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) {
      throw error;
    }
    return { ...DEFAULT_APP_SETTINGS };
  }
}

async function writeAppSettings(userDataPath, value) {
  const settings = normalizeAppSettings(value);
  const target = appSettingsPath(userDataPath);
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;

  await fs.mkdir(userDataPath, { recursive: true });
  try {
    await fs.writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
    await fs.rename(temporary, target);
  } finally {
    await fs.rm(temporary, { force: true });
  }
  return settings;
}

function applyLoginItemSetting(app, enabled) {
  const desired = Boolean(enabled);
  if (app.getLoginItemSettings().openAtLogin === desired) {
    return false;
  }

  app.setLoginItemSettings({ openAtLogin: desired });
  return true;
}

module.exports = {
  DEFAULT_APP_SETTINGS,
  normalizeAppSettings,
  readAppSettings,
  writeAppSettings,
  applyLoginItemSetting
};
