const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_APPEARANCE = Object.freeze({ theme: "system" });
const VALID_THEMES = new Set(["light", "dark", "system"]);

function normalizeAppearance(value = {}) {
  return {
    theme: VALID_THEMES.has(value.theme) ? value.theme : DEFAULT_APPEARANCE.theme
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
  normalizeAppearance,
  readAppearanceSettings,
  writeAppearanceSettings
};
