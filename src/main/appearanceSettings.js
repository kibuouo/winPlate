const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_MAIL_AUTO_REFRESH_SECONDS = 30;
const DEFAULT_APPEARANCE = Object.freeze({
  theme: "system",
  mailAutoRefreshSeconds: DEFAULT_MAIL_AUTO_REFRESH_SECONDS
});
const VALID_THEMES = new Set(["light", "dark", "system"]);
const MIN_MAIL_AUTO_REFRESH_SECONDS = 15;
const MAX_MAIL_AUTO_REFRESH_SECONDS = 30 * 60;

function normalizeMailAutoRefreshSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return DEFAULT_MAIL_AUTO_REFRESH_SECONDS;
  return Math.max(
    MIN_MAIL_AUTO_REFRESH_SECONDS,
    Math.min(MAX_MAIL_AUTO_REFRESH_SECONDS, Math.round(seconds))
  );
}

function normalizeAppearance(value = {}) {
  return {
    theme: VALID_THEMES.has(value.theme) ? value.theme : DEFAULT_APPEARANCE.theme,
    mailAutoRefreshSeconds: normalizeMailAutoRefreshSeconds(value.mailAutoRefreshSeconds)
  };
}

function appearanceSettingsPath(userDataPath) {
  return path.join(userDataPath, "appearance.json");
}

async function readAppearanceSettings(userDataPath) {
  try {
    const contents = await fs.readFile(appearanceSettingsPath(userDataPath), "utf8");
    return normalizeAppearance(JSON.parse(contents));
  } catch (error) {
    if (error.code !== "ENOENT" && error.name !== "SyntaxError") {
      throw error;
    }
    return { ...DEFAULT_APPEARANCE };
  }
}

async function writeAppearanceSettings(userDataPath, value) {
  const settings = normalizeAppearance(value);
  const target = appearanceSettingsPath(userDataPath);
  const temporary = `${target}.tmp`;
  await fs.mkdir(userDataPath, { recursive: true });
  await fs.writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  await fs.rename(temporary, target);
  return settings;
}

module.exports = {
  DEFAULT_APPEARANCE,
  DEFAULT_MAIL_AUTO_REFRESH_SECONDS,
  MAX_MAIL_AUTO_REFRESH_SECONDS,
  MIN_MAIL_AUTO_REFRESH_SECONDS,
  normalizeMailAutoRefreshSeconds,
  normalizeAppearance,
  readAppearanceSettings,
  writeAppearanceSettings
};
