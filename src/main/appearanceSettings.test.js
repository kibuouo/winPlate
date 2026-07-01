const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  readAppearanceSettings,
  writeAppearanceSettings
} = require("./appearanceSettings");

test("appearance settings persist a valid theme", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "winplate-appearance-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  await writeAppearanceSettings(directory, { theme: "light", mailAutoRefreshSeconds: 45 });

  assert.deepEqual(await readAppearanceSettings(directory), { theme: "light", mailAutoRefreshSeconds: 45 });
});

test("appearance settings fall back safely for missing or invalid values", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "winplate-appearance-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  assert.deepEqual(await readAppearanceSettings(directory), { theme: "system", mailAutoRefreshSeconds: 30 });
  await writeAppearanceSettings(directory, { theme: "sepia", mailAutoRefreshSeconds: 3 });
  assert.deepEqual(await readAppearanceSettings(directory), { theme: "system", mailAutoRefreshSeconds: 15 });
});
