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

test("top-docked floating view is a single frosted row with only requested controls", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
  const start = appSource.indexOf("function renderDockedFloating()");
  const end = appSource.indexOf("function renderFloating()", start);
  const dockedRenderer = appSource.slice(start, end);

  assert.match(dockedRenderer, /docked-status-line/);
  assert.match(dockedRenderer, /docked-weather/);
  assert.match(dockedRenderer, /docked-usage/);
  assert.match(dockedRenderer, /id="restore-capsule-button"/);
  assert.match(dockedRenderer, /restore-capsule-icon-back/);
  assert.match(dockedRenderer, /restore-capsule-icon-front/);
  assert.match(dockedRenderer, /document\.onmousemove = null/);
  assert.doesNotMatch(dockedRenderer, /id="pin-button"|github-module|notification-strip|heart-module|network-module|settings-button/);
  assert.doesNotMatch(dockedRenderer, /<button class="docked-module/);
  assert.match(styles, /\.docked-status-line\s*\{[\s\S]*?display:\s*flex/);
  assert.match(styles, /\.docked-capsule\s*\{[\s\S]*?backdrop-filter:\s*blur\(38px\)\s+saturate\(160%\)/);
  assert.match(styles, /\.restore-capsule-icon-back\s*\{[\s\S]*?fill:\s*none/);
  assert.match(styles, /\.restore-capsule-icon-front\s*\{[\s\S]*?fill:\s*none/);
});

test("renderer CSP allows only the intended external image capability", () => {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  assert.match(html, /img-src[^;]*https:/);
});
