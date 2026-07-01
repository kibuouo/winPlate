const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const mainPath = path.join(__dirname, "main.js");

function readMain() {
  return fs.readFileSync(mainPath, "utf8");
}

test("captures process overrides and builds the migration store before lifecycle injection", () => {
  const main = readMain();
  const capture = main.indexOf("processServiceEnvironment");
  const migration = main.indexOf("await createServiceSettingsMigration({");
  const lifecycle = main.indexOf("createServiceSettingsLifecycle({");
  const load = main.indexOf("await serviceSettingsLifecycle.loadForStartup()");
  const python = main.indexOf("await startPythonService()");

  assert.notEqual(capture, -1);
  assert.notEqual(migration, -1);
  assert.notEqual(lifecycle, -1);
  assert.notEqual(load, -1);
  assert.notEqual(python, -1);
  assert.equal(capture < migration && migration < lifecycle && lifecycle < load && load < python, true);
  assert.match(main, /safeStorage/);
  assert.match(main, /targetEnvironment: process\.env/);
  assert.match(main, /externalEnvironment: processServiceEnvironment/);
  assert.match(main, /platform: process\.platform/);
  assert.match(main, /serviceSettingsFileExists/);
  assert.match(main, /readWindowsServiceEnvironment/);
  assert.match(main, /serviceSettingsLifecycle/);
  assert.equal((main.match(/ipcMain\.handle\("deepseek:(?:get-settings|save-settings|usage)"/g) || []).length, 0);
});

test("app settings startup fallback runs after the main window and before preferences", () => {
  const main = readMain();
  const window = main.indexOf("createMainWindow(initialTheme)");
  const initialSettings = main.indexOf("await readInitialAppSettings({");
  const preferences = main.indexOf("createAppPreferencesController({");

  assert.notEqual(window, -1);
  assert.notEqual(initialSettings, -1);
  assert.notEqual(preferences, -1);
  assert.equal(window < initialSettings && initialSettings < preferences, true);
  assert.match(main, /defaults: DEFAULT_APP_SETTINGS/);
  assert.match(main, /reportError: \(message\) => console\.error\(message\)/);
});

test("menu IPC delegates exclusively through app preferences and teardown destroys it", () => {
  const main = readMain();
  const menuHandlers = main.slice(
    main.indexOf('ipcMain.on("menubar:update-temperature"'),
    main.indexOf('ipcMain.on("github:open-profile"')
  );
  const beforeQuit = main.slice(main.indexOf('app.on("before-quit"'));

  assert.doesNotMatch(main, /let macMenuBar/);
  assert.match(menuHandlers, /ownsSender\(event\.sender\)/);
  assert.match(menuHandlers, /setTemperature\(payload\)/);
  assert.match(menuHandlers, /\.hide\(\)/);
  assert.doesNotMatch(menuHandlers, /createMacMenuBar|macMenuBar/);
  assert.equal(beforeQuit.indexOf(".destroy()") < beforeQuit.indexOf("stopPythonService()"), true);
  assert.match(beforeQuit, /appPreferences = null/);
});

test("registers the tested settings IPC boundary once after preferences exist", () => {
  const main = readMain();
  const preferences = main.indexOf("createAppPreferencesController({");
  const registration = main.indexOf("registerSettingsIpc({");

  assert.notEqual(preferences, -1);
  assert.notEqual(registration, -1);
  assert.equal(preferences < registration, true);
  assert.equal((main.match(/registerSettingsIpc\(\{/g) || []).length, 1);
  assert.match(main, /getAppPreferences: \(\) => appPreferences/);
  assert.match(main, /ownsMainWindowSender/);
  assert.match(main, /serviceSettingsLifecycle/);
});

test("selects startup policy once while retaining platform-specific window gates", () => {
  const main = readMain();

  assert.equal((main.match(/startupPolicy\(\)/g) || []).length, 1);
  assert.match(main, /if \(policy\.createFloatingWindow\)/);
  assert.match(main, /if \(policy\.createWindowsTray\)/);
  assert.match(main, /platform: policy\.createMacMenuBar \? "darwin" : process\.platform/);
  assert.match(main, /app\.on\("activate", activationCoordinator\.onActivate\)/);
  assert.match(main, /showMainWindow,/);
  assert.match(main, /createMenuBar: \(\) => createMacMenuBar\(/);
});
