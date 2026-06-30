const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const mainPath = path.join(__dirname, "main.js");

function readMain() {
  return fs.readFileSync(mainPath, "utf8");
}

test("main preload exposes the narrow app preferences boundary", () => {
  const preload = fs.readFileSync(path.join(__dirname, "..", "preload", "preload.js"), "utf8");

  assert.match(preload, /getAppSettings: \(\) => ipcRenderer\.invoke\("app:get-settings"\)/);
  assert.match(
    preload,
    /saveAppSettings: \(settings\) => ipcRenderer\.invoke\("app:save-settings", settings\)/
  );
});

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

test("app settings IPC validates the exact main renderer and merges write then apply", () => {
  const main = readMain();

  assert.match(
    main,
    /ipcMain\.handle\("app:get-settings", \(event\) => \{\s*requireMainWindowSender\(event\);\s*return appPreferences\.getSettings\(\);\s*\}\);/
  );
  assert.match(
    main,
    /ipcMain\.handle\("app:save-settings", async \(event, payload\) => \{\s*requireMainWindowSender\(event\);\s*const merged = \{ \.\.\.appPreferences\.getSettings\(\), \.\.\.safeObject\(payload\) \};\s*const written = await writeAppSettings\(userDataPath, merged\);\s*return appPreferences\.apply\(written\);\s*\}\);/
  );
  assert.match(main, /throw new Error\("Unauthorized settings sender"\)/);
  assert.match(main, /ownsMainWindowSender\(event\.sender\)/);
});

test("menu IPC delegates exclusively through app preferences and teardown destroys it", () => {
  const main = readMain();

  assert.doesNotMatch(main, /let macMenuBar/);
  assert.match(
    main,
    /if \(appPreferences\?\.ownsSender\(event\.sender\)\) \{\s*appPreferences\.setTemperature\(payload\);/
  );
  assert.match(
    main,
    /if \(appPreferences\?\.ownsSender\(event\.sender\)\) \{\s*appPreferences\.hide\(\);/
  );
  assert.match(
    main,
    /app\.on\("before-quit", \(\) => \{\s*setQuitting\(true\);\s*appPreferences\?\.destroy\(\);\s*appPreferences = null;\s*stopPythonService\(\);/
  );
});

test("service settings IPC exposes only public shapes and preserves blank secrets", () => {
  const main = readMain();

  assert.match(main, /function weatherSettingsResponse\(settings\)/);
  assert.match(main, /hasApiKey: publicSettings\.hasQWeatherApiKey/);
  assert.match(main, /hasPrivateKey: publicSettings\.hasQWeatherPrivateKey/);
  assert.match(main, /function deepSeekSettingsResponse\(settings\)/);
  assert.match(main, /hasApiKey: publicSettings\.hasDeepSeekApiKey/);
  assert.match(main, /if \(apiKey\) patch\.qweatherApiKey = apiKey/);
  assert.match(main, /if \(privateKey\) patch\.qweatherPrivateKey = privateKey/);
  assert.match(main, /if \(apiKey\) patch\.deepseekApiKey = apiKey/);
  assert.doesNotMatch(main, /return\s+storedServiceSettings/);
  assert.doesNotMatch(main, /console\.(?:log|error)\([^\n]*(?:apiKey|privateKey|settings)/i);
});

test("weather and DeepSeek settings validate sender and public input boundaries", () => {
  const main = readMain();

  for (const channel of [
    "weather:get-settings",
    "weather:save-settings",
    "deepseek:get-settings",
    "deepseek:save-settings"
  ]) {
    const start = main.indexOf(`ipcMain.handle("${channel}"`);
    const end = main.indexOf("ipcMain.handle(", start + 20);
    const handler = main.slice(start, end === -1 ? undefined : end);
    assert.notEqual(start, -1, `${channel} exists`);
    assert.match(handler, /requireMainWindowSender\(event\)/, `${channel} checks sender`);
  }

  assert.match(main, /!apiHost \|\| !\/\^\[a-z0-9\.\-\]\+\$\/i\.test\(apiHost\)/);
  assert.match(main, /new URL\(baseUrl\)/);
  assert.match(main, /parsed\.protocol !== "https:" \|\| parsed\.username \|\| parsed\.password/);
  assert.match(main, /externalEnvironment: externalServiceEnvironment/);
  assert.match(main, /serviceSettingsLifecycle\.effectiveSettings\(\)/);
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
