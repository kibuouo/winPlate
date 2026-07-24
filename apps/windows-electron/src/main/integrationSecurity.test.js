const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const mainPath = path.join(__dirname, "main.js");

function readMain() {
  return fs.readFileSync(mainPath, "utf8");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("captures process overrides and builds the migration store before lifecycle injection", () => {
  const main = readMain();
  const capture = main.indexOf("processServiceEnvironment");
  const migration = main.indexOf("await createServiceSettingsMigration({");
  const lifecycle = main.indexOf("createServiceSettingsLifecycle({");
  const load = main.indexOf("await serviceSettingsLifecycle.loadForStartup()");
  const python = main.indexOf("await startPythonService({");

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
  assert.match(main, /isPackaged: app\.isPackaged/);
  assert.match(main, /userDataPath: app\.getPath\("userData"\)/);
  assert.equal((main.match(/ipcMain\.handle\("deepseek:(?:get-settings|save-settings|usage)"/g) || []).length, 0);
});

test("main process contains no macOS Electron bridge", () => {
  const main = readMain();

  assert.doesNotMatch(main, /macos-electron-menubar|createMacMenuBar|menubar:update-temperature|menubar:hide|appPreferences/);
  assert.match(main, /const policy = startupPolicy\(\);/);
});

test("registers the Windows settings IPC boundary once", () => {
  const main = readMain();
  const registration = main.indexOf("registerSettingsIpc({");

  assert.notEqual(registration, -1);
  assert.equal((main.match(/registerSettingsIpc\(\{/g) || []).length, 1);
  assert.match(main, /ownsMainWindowSender/);
  assert.match(main, /serviceSettingsLifecycle/);
});

test("notification AI summaries read effective DeepSeek settings instead of user environment", () => {
  const main = readMain();
  const summaryServiceStart = main.indexOf("notificationSummaryService = createNotificationSummaryService({");
  const summaryServiceEnd = main.indexOf('ipcMain.handle("notification:get-digest"', summaryServiceStart);
  const summaryServiceBlock = main.slice(summaryServiceStart, summaryServiceEnd);

  assert.notEqual(summaryServiceStart, -1);
  assert.notEqual(summaryServiceEnd, -1);
  assert.match(summaryServiceBlock, /const settings = serviceSettingsLifecycle\.effectiveSettings\(\);/);
  assert.match(summaryServiceBlock, /apiKey: settings\.deepseekApiKey/);
  assert.match(summaryServiceBlock, /baseUrl: settings\.deepseekBaseUrl \|\| DEEPSEEK_DEFAULT_BASE_URL/);
  assert.doesNotMatch(summaryServiceBlock, /readUserEnvironment\("DEEPSEEK_API_KEY"\)/);
  assert.doesNotMatch(summaryServiceBlock, /readUserEnvironment\("DEEPSEEK_BASE_URL"\)/);
});

test("sensitive business IPC handlers require the live main-window sender", () => {
  const main = readMain();
  const guardedChannels = [
    "settings:save",
    "appearance:save-settings",
    "weather:set-location",
    "github:get-contributions",
    "weather:set-manual-location",
    "weather:refresh-official-usage",
    "mail:save-settings",
    "email:read-message",
    "notifications:refresh-smart-brief",
    "notifications:mark-read",
    "notifications:mark-read-many",
    "notifications:mark-all-read",
    "notifications:clear",
    "notifications:clear-read",
    "notifications:push-test",
    "deepseek:test-chat"
  ];

  for (const channel of guardedChannels) {
    assert.match(
      main,
      new RegExp(
        `ipcMain\\.handle\\("${escapeRegExp(channel)}",\\s*async\\s*\\(event(?:, [^)]*)?\\) => \\{\\s*requireMainWindowSender\\(event\\);`
      ),
      `${channel} must reject non-main senders`
    );
  }
});

test("notification batch-read bridge accepts only the narrow array contract", () => {
  const main = readMain();
  const preload = fs.readFileSync(path.join(__dirname, "..", "preload", "preload.js"), "utf8");

  assert.match(main, /ipcMain\.handle\("notifications:mark-read-many", async \(event, ids\) => \{\s*requireMainWindowSender\(event\);/);
  assert.match(main, /Array\.isArray\(ids\)/);
  assert.match(preload, /markNotificationsRead: \(ids\) => ipcRenderer\.invoke\("notifications:mark-read-many", ids\)/);
});

test("sandboxed preload does not load workspace packages", () => {
  const preload = fs.readFileSync(path.join(__dirname, "..", "preload", "preload.js"), "utf8");

  assert.doesNotMatch(preload, /require\(["']@winplate\//);
});

test("floating shell IPC handlers require the live floating-window sender", () => {
  const main = readMain();

  assert.match(
    main,
    /ipcMain\.handle\("floating:set-pinned",\s*\(event,\s*value\)\s*=>\s*\{\s*requireFloatingWindowSender\(event\);[\s\S]*?setFloatingPinned\(value\);[\s\S]*?\}\);/
  );
  assert.match(
    main,
    /ipcMain\.on\("floating:pin-interactive",\s*\(event,\s*value\)\s*=>\s*\{\s*requireFloatingWindowSender\(event\);[\s\S]*?setFloatingPinInteractive\(value\);[\s\S]*?\}\);/
  );
  assert.match(
    main,
    /ipcMain\.on\("tooltip:show",\s*\(event,\s*payload\)\s*=>\s*\{\s*requireFloatingWindowSender\(event\);[\s\S]*?showTooltipWindow\(payload\);[\s\S]*?\}\);/
  );
  assert.match(
    main,
    /ipcMain\.on\("tooltip:hide",\s*\(event\)\s*=>\s*\{\s*requireFloatingWindowSender\(event\);[\s\S]*?hideTooltipWindow\(\);[\s\S]*?\}\);/
  );
});

test("GitHub and QQ secrets no longer persist through user environment writes", () => {
  const main = readMain();

  assert.doesNotMatch(main, /writeUserEnvironment\("GITHUB_TOKEN"/);
  assert.doesNotMatch(main, /writeUserEnvironment\("QQ_MAIL_AUTH_CODE"/);
});

test("settings save derives GitHub token state from service settings and refreshes digest when the AI toggle changes", () => {
  const main = readMain();
  const publicSettingsStart = main.indexOf("async function publicSettingsPayload");
  const publicSettingsEnd = main.indexOf("async function recordDeepSeekTokenUsageSafely", publicSettingsStart);
  const publicSettings = main.slice(publicSettingsStart, publicSettingsEnd);
  const settingsSaveStart = main.indexOf('ipcMain.handle("settings:save"');
  const settingsSaveEnd = main.indexOf('ipcMain.handle("appearance:get-settings"', settingsSaveStart);
  const settingsSaveHandler = main.slice(settingsSaveStart, settingsSaveEnd);

  assert.match(publicSettings, /const servicePublicSettings = serviceSettingsLifecycle\.publicSettings\(\);/);
  assert.match(publicSettings, /hasToken: Boolean\(servicePublicSettings\.hasGitHubToken\)/);
  assert.match(settingsSaveHandler, /const previousDigestEnabled = currentSettings\.notificationDigest\.enabled;/);
  assert.match(settingsSaveHandler, /if \(previousDigestEnabled !== currentSettings\.notificationDigest\.enabled\) \{/);
  assert.match(settingsSaveHandler, /await notificationSummaryService\?\.refreshNow\(\{ force: true \}\);/);
});

test("selects the Windows startup policy once and creates Windows-only surfaces", () => {
  const main = readMain();

  assert.equal((main.match(/startupPolicy\(\)/g) || []).length, 1);
  assert.match(main, /if \(policy\.createFloatingWindow\)/);
  assert.match(main, /if \(policy\.createWindowsTray\)/);
  assert.match(main, /app\.on\("activate", activationCoordinator\.onActivate\)/);
  assert.doesNotMatch(main, /darwin|macOS|macos|MenuBar/);
});
