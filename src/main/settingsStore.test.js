const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const {
  defaultSettings,
  normalizeSettings,
  readSettings,
  writeSettings
} = require("./settingsStore");

test("normalizes settings ranges and keeps every registered module", () => {
  const value = normalizeSettings({
    appearance: { theme: "dark", opacity: 2, density: "compact" },
    modules: {
      enabled: { github: false },
      order: ["network", "network", "unknown"],
      refreshSeconds: { network: 0, mail: 99999 }
    },
    integrations: { github: { username: "bad username" } },
    notificationDigest: { enabled: false }
  });
  assert.equal(value.appearance.opacity, 1);
  assert.equal(value.appearance.density, "compact");
  assert.equal(value.modules.enabled.github, false);
  assert.equal(value.modules.order[0], "network");
  assert.equal(new Set(value.modules.order).size, defaultSettings().modules.order.length);
  assert.equal(value.modules.refreshSeconds.network, 1);
  assert.equal(value.modules.refreshSeconds.mail, 1800);
  assert.equal(value.integrations.github.username, "kibuouo");
  assert.equal(value.notificationDigest.enabled, false);
});

test("migrates the removed local-only privacy mode to disabled AI summaries", () => {
  const value = normalizeSettings({
    notificationDigest: { enabled: true, privacyMode: "local-only" }
  });
  assert.deepEqual(value.notificationDigest, { enabled: false });
});

test("migrates legacy appearance and mail refresh settings", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "winplate-settings-"));
  await fs.writeFile(
    path.join(directory, "appearance.json"),
    JSON.stringify({ theme: "light", mailAutoRefreshSeconds: 45 }),
    "utf8"
  );
  const settings = await readSettings(directory);
  assert.equal(settings.appearance.theme, "light");
  assert.equal(settings.modules.refreshSeconds.mail, 45);
  assert.equal(JSON.parse(await fs.readFile(path.join(directory, "settings.json"), "utf8")).version, 1);
});

test("persists versioned public settings without secret fields", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "winplate-settings-"));
  const saved = await writeSettings(directory, {
    ...defaultSettings(),
    integrations: { github: { username: "openai", token: "secret" } }
  });
  assert.equal(saved.integrations.github.username, "openai");
  assert.equal(saved.integrations.github.token, undefined);
  const contents = await fs.readFile(path.join(directory, "settings.json"), "utf8");
  assert.doesNotMatch(contents, /secret/);
  assert.equal((await readSettings(directory)).version, 1);
});
