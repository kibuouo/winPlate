const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const mainPath = path.join(__dirname, "main.js");

function readMain() {
  return fs.readFileSync(mainPath, "utf8");
}

test("loads encrypted service settings and injects the effective environment before Python", () => {
  const main = readMain();
  const capture = main.indexOf("externalServiceEnvironment");
  const lifecycle = main.indexOf("createServiceSettingsLifecycle({");
  const load = main.indexOf("await serviceSettingsLifecycle.loadForStartup()");
  const python = main.indexOf("await startPythonService()");

  assert.notEqual(capture, -1);
  assert.notEqual(lifecycle, -1);
  assert.notEqual(load, -1);
  assert.notEqual(python, -1);
  assert.equal(capture < lifecycle && lifecycle < load && load < python, true);
  assert.match(main, /safeStorage/);
  assert.match(main, /targetEnvironment: process\.env/);
  assert.doesNotMatch(main, /readUserEnvironment|writeUserEnvironment|reg\.exe/);
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
  assert.match(main, /app\.on\("activate", showMainWindow\)/);
  assert.match(main, /showMainWindow,/);
  assert.match(main, /createMenuBar: \(\) => createMacMenuBar\(/);
});
