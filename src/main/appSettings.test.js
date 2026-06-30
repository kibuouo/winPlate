const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_APP_SETTINGS,
  normalizeAppSettings,
  readAppSettings,
  writeAppSettings,
  applyLoginItemSetting
} = require("./appSettings");

async function createTemporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "winplate-app-settings-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test("default application settings have the exact frozen schema", () => {
  assert.deepEqual(DEFAULT_APP_SETTINGS, {
    menuBarEnabled: true,
    launchAtLogin: false
  });
  assert.equal(Object.isFrozen(DEFAULT_APP_SETTINGS), true);
});

test("normalization retains only valid boolean application settings", () => {
  assert.deepEqual(
    normalizeAppSettings({
      menuBarEnabled: false,
      launchAtLogin: true,
      desktopCapsuleEnabled: true,
      menuBarDisplay: "always"
    }),
    {
      menuBarEnabled: false,
      launchAtLogin: true
    }
  );
});

test("normalization falls back independently for missing and invalid values", () => {
  assert.deepEqual(normalizeAppSettings({ menuBarEnabled: false, launchAtLogin: "yes" }), {
    menuBarEnabled: false,
    launchAtLogin: false
  });
  assert.deepEqual(normalizeAppSettings({ menuBarEnabled: 0, launchAtLogin: true }), {
    menuBarEnabled: true,
    launchAtLogin: true
  });
  assert.deepEqual(normalizeAppSettings(null), {
    menuBarEnabled: true,
    launchAtLogin: false
  });
});

test("missing settings return fresh default objects", async (t) => {
  const directory = await createTemporaryDirectory(t);

  const first = await readAppSettings(directory);
  first.menuBarEnabled = false;
  const second = await readAppSettings(directory);

  assert.notStrictEqual(first, second);
  assert.deepEqual(second, {
    menuBarEnabled: true,
    launchAtLogin: false
  });
});

test("settings write and read back through the exact persisted schema", async (t) => {
  const directory = await createTemporaryDirectory(t);

  const written = await writeAppSettings(directory, {
    menuBarEnabled: false,
    launchAtLogin: true,
    desktopCapsuleEnabled: true
  });

  assert.deepEqual(written, {
    menuBarEnabled: false,
    launchAtLogin: true
  });
  assert.deepEqual(await readAppSettings(directory), written);
  assert.equal(
    await fs.readFile(path.join(directory, "app-settings.json"), "utf8"),
    '{\n  "menuBarEnabled": false,\n  "launchAtLogin": true\n}\n'
  );
  await assert.rejects(fs.access(path.join(directory, "app-settings.json.tmp")), {
    code: "ENOENT"
  });
});

test("corrupt JSON returns a fresh default object", async (t) => {
  const directory = await createTemporaryDirectory(t);
  await fs.writeFile(path.join(directory, "app-settings.json"), "{not-json", "utf8");

  const first = await readAppSettings(directory);
  const second = await readAppSettings(directory);

  assert.notStrictEqual(first, second);
  assert.deepEqual(first, {
    menuBarEnabled: true,
    launchAtLogin: false
  });
  assert.deepEqual(second, first);
});

test("non-missing-file read errors propagate", async (t) => {
  const filePath = path.join(await createTemporaryDirectory(t), "not-a-directory");
  await fs.writeFile(filePath, "file", "utf8");

  await assert.rejects(readAppSettings(filePath), { code: "ENOTDIR" });
});

test("login item application is a no-op when the setting already matches", () => {
  let writeCount = 0;
  const app = {
    getLoginItemSettings: () => ({ openAtLogin: true }),
    setLoginItemSettings: () => {
      writeCount += 1;
    }
  };

  assert.equal(applyLoginItemSetting(app, 1), false);
  assert.equal(writeCount, 0);
});

test("login item application writes a coerced changed setting", () => {
  const writes = [];
  const app = {
    getLoginItemSettings: () => ({ openAtLogin: false }),
    setLoginItemSettings: (settings) => writes.push(settings)
  };

  assert.equal(applyLoginItemSetting(app, "enabled"), true);
  assert.deepEqual(writes, [{ openAtLogin: true }]);
});
