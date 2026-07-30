const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadPreloadBridge(platform) {
  const source = fs.readFileSync(path.join(__dirname, "..", "preload", "preload.js"), "utf8");
  let exposed;
  const ipcRenderer = {
    invoke: () => Promise.resolve({}),
    on() {},
    send() {}
  };
  vm.runInNewContext(source, {
    process: { platform },
    require(name) {
      assert.equal(name, "electron");
      return {
        contextBridge: { exposeInMainWorld: (_name, value) => { exposed = value; } },
        ipcRenderer
      };
    }
  });
  return exposed;
}

test("preload exposes a Windows-only, narrow bridge", () => {
  const windows = loadPreloadBridge("win32");
  const unsupported = loadPreloadBridge("linux");
  assert.equal(windows.platform, "win32");
  assert.equal(unsupported.platform, "unsupported");
  assert.equal(typeof windows.setFloatingPinned, "function");
  assert.equal(typeof windows.restoreFloatingCapsule, "function");
  assert.equal(typeof windows.onFloatingDockState, "function");
  assert.equal(windows.getAppSettings, undefined);
  assert.equal(windows.saveAppSettings, undefined);
  assert.equal(windows.ipcRenderer, undefined);
  assert.equal(windows.require, undefined);
});

test("renderer and main process contain no macOS Electron implementation", () => {
  const files = [
    path.join(__dirname, "app.js"),
    path.join(__dirname, "styles.css"),
    path.join(__dirname, "..", "main", "main.js"),
    path.join(__dirname, "..", "main", "windowPolicy.js")
  ];
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(source, /macos|darwin|electron-menubar|createMacMenuBar|platform-darwin/i);
  }
});

test("renderer always renders the Windows titlebar and Windows platform class", () => {
  const source = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  assert.match(source, /document\.body\.className = "main-body platform-win32"/);
  assert.match(source, /<header class="app-titlebar">/);
  assert.doesNotMatch(source, /applicationSettings|macApplicationSettingsSection|getAppSettings|saveAppSettings/);
  assert.doesNotMatch(source, /bindApplicationSettingsControls/);
});

test("SuperGrok renders the remaining quota derived from Grok usage", () => {
  const source = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");

  assert.match(source, /usageRow\("7d", supergrok\)/);
  assert.match(source, /dashboardCodexRow\("SuperGrok · 7d", supergrok, \{ icon: grokBrandIcon \}\)/);
  assert.match(source, /usageWindowCard\("7d", supergrok\)/);
  assert.match(source, /const percentage = normalizePercent\(usage\?\.remainingPct\)/);
});

test("top-docked floating view is a single frosted row with only requested controls", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
  const start = appSource.indexOf("function renderDockedFloating()");
  const end = appSource.indexOf("function renderFloating()", start);
  const dockedRenderer = appSource.slice(start, end);

  assert.match(dockedRenderer, /docked-status-line/);
  assert.match(dockedRenderer, /docked-weather/);
  assert.match(dockedRenderer, /docked-alert-slot/);
  assert.match(dockedRenderer, /renderSmartNotificationIcon\("alert-triangle"\)/);
  assert.match(dockedRenderer, /docked-usage/);
  assert.match(dockedRenderer, /docked-mail-status/);
  assert.match(dockedRenderer, /docked-mail-unread-badge/);
  assert.match(dockedRenderer, /unreadMailCount > 99 \? "99\+"/);
  assert.match(dockedRenderer, /renderSmartNotificationIcon\("mail"\)/);
  assert.match(dockedRenderer, /id="restore-capsule-button"/);
  assert.match(dockedRenderer, /restore-capsule-icon-back/);
  assert.match(dockedRenderer, /restore-capsule-icon-front/);
  assert.match(dockedRenderer, /document\.onmousemove = null/);
  assert.doesNotMatch(dockedRenderer, /id="pin-button"|github-module|notification-strip|heart-module|network-module|settings-button/);
  assert.doesNotMatch(dockedRenderer, /<button class="docked-module/);
  assert.equal((dockedRenderer.match(/<button\b/g) || []).length, 1);
  assert.ok(dockedRenderer.indexOf("docked-weather") < dockedRenderer.indexOf("docked-alert-slot"));
  assert.ok(dockedRenderer.indexOf("docked-alert-slot") < dockedRenderer.indexOf("docked-usage"));
  assert.ok(dockedRenderer.indexOf("docked-usage") < dockedRenderer.indexOf("docked-mail-status"));
  assert.ok(dockedRenderer.indexOf("docked-mail-status") < dockedRenderer.indexOf("restore-capsule-button"));
  assert.match(appSource, /function dockedWeatherAlertState[\s\S]*?notificationAlertColor\(item\)/);
  assert.match(appSource, /function dockedUnreadMailCount[\s\S]*?labels\.includes\("UNREAD"\)/);
  assert.match(styles, /\.docked-status-line\s*\{[\s\S]*?display:\s*flex/);
  assert.match(styles, /\.docked-alert-slot\.is-empty\s*\{[\s\S]*?visibility:\s*hidden/);
  assert.match(styles, /\.docked-mail-status\s*\{[\s\S]*?background:\s*transparent/);
  assert.match(styles, /\.docked-capsule\s*\{[\s\S]*?height:\s*44px/);
  assert.match(styles, /\.docked-capsule\s*\{[\s\S]*?background:\s*rgba\(20,\s*27,\s*36,\s*\.34\)/);
  assert.match(styles, /\.docked-capsule\s*\{[\s\S]*?backdrop-filter:\s*blur\(26px\)\s+saturate\(135%\)/);
  assert.match(styles, /\.restore-capsule-icon-back\s*\{[\s\S]*?fill:\s*none/);
  assert.match(styles, /\.restore-capsule-icon-front\s*\{[\s\S]*?fill:\s*none/);
});

test("top-docked status derives alert color and unread mail from source-owned state", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const start = appSource.indexOf("const DOCKED_ALERT_COLOR_RANK");
  const end = appSource.indexOf("function renderDockedFloating()", start);
  const context = {
    window: {
      WinPlateNotificationDigest: {
        notificationAlertColor: (item) => item.meta?.alertColor || null
      }
    }
  };
  vm.runInNewContext(`${appSource.slice(start, end)}
    this.dockedWeatherAlertState = dockedWeatherAlertState;
    this.dockedUnreadMailCount = dockedUnreadMailCount;`, context);

  const staleSummary = {
    items: [
      { id: "qweather:yellow", sourceId: "yellow", source: "qweather", createdAt: 300, meta: { lifecycle: "issued", alertColor: "yellow" } },
      { id: "qweather:red", sourceId: "red", source: "qweather", createdAt: 200, meta: { lifecycle: "issued", alertColor: "red" } },
      { source: "mail", createdAt: 500, meta: { alertColor: "blue" } }
    ]
  };
  assert.equal(context.dockedWeatherAlertState({ alerts: [] }, staleSummary), null);
  const alert = context.dockedWeatherAlertState({
    alerts: [
      { id: "yellow", createdAt: 300, lifecycle: "issued" },
      { id: "red", createdAt: 200, lifecycle: "issued" },
      { id: "resolved", createdAt: 400, lifecycle: "resolved" }
    ]
  }, staleSummary);
  assert.equal(alert.color, "red");
  assert.equal(context.dockedUnreadMailCount({
    items: [
      { unread: true, labels: [] },
      { unread: false, labels: ["UNREAD"] },
      { unread: false, labels: ["STARRED"] }
    ]
  }), 2);
});

test("scheduled mail refreshes force an IMAP pull instead of rereading the outline cache", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const start = appSource.indexOf("async function refreshMailData(");
  const end = appSource.indexOf("function moduleHealthMessage", start);
  const refreshMailData = appSource.slice(start, end);

  assert.match(refreshMailData, /hydrateMail\(\{\s*force:\s*true\s*\}\)/);
  assert.doesNotMatch(refreshMailData, /hydrateMail\(\{\s*force\s*\}\)/);
});

test("renderer CSP allows only the intended external image capability", () => {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  assert.match(html, /img-src[^;]*https:/);
});
