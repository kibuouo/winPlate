const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const assert = require("node:assert/strict");

function loadPreloadBridge() {
  const preload = fs.readFileSync(
    path.join(__dirname, "..", "preload", "menuBarPreload.js"),
    "utf8"
  );
  const listeners = new Map();
  const calls = { invoked: [], removed: [], sent: [] };
  let exposed;
  const ipcRenderer = {
    invoke(channel, ...args) {
      calls.invoked.push([channel, ...args]);
    },
    on(channel, listener) {
      listeners.set(channel, listener);
    },
    removeListener(channel, listener) {
      calls.removed.push([channel, listener]);
      if (listeners.get(channel) === listener) listeners.delete(channel);
    },
    send(channel, ...args) {
      calls.sent.push([channel, ...args]);
    }
  };

  vm.runInNewContext(preload, {
    require(moduleName) {
      assert.equal(moduleName, "electron");
      return {
        contextBridge: {
          exposeInMainWorld(name, api) {
            assert.equal(name, "winplate");
            exposed = api;
          }
        },
        ipcRenderer
      };
    }
  }, { filename: "menuBarPreload.js" });

  return { api: exposed, calls, listeners, ipcRenderer };
}

function loadMainPreloadBridge(platform) {
  const preload = fs.readFileSync(
    path.join(__dirname, "..", "preload", "preload.js"),
    "utf8"
  );
  const calls = { invoked: [], sent: [] };
  let exposed;
  const ipcRenderer = {
    invoke(channel, ...args) {
      calls.invoked.push([channel, ...args]);
      return Promise.resolve({});
    },
    on() {},
    send(channel, ...args) {
      calls.sent.push([channel, ...args]);
    }
  };

  vm.runInNewContext(preload, {
    process: { platform },
    require(moduleName) {
      assert.equal(moduleName, "electron");
      return {
        contextBridge: {
          exposeInMainWorld(name, api) {
            assert.equal(name, "winplate");
            exposed = api;
          }
        },
        ipcRenderer
      };
    }
  }, { filename: "preload.js" });

  return { api: exposed, calls, ipcRenderer };
}

test("main preload bounds platform and exposes only exact application settings IPC", async () => {
  const darwin = loadMainPreloadBridge("darwin");
  const windows = loadMainPreloadBridge("win32");
  const unsupported = loadMainPreloadBridge("linux");

  assert.equal(darwin.api.platform, "darwin");
  assert.equal(windows.api.platform, "win32");
  assert.equal(unsupported.api.platform, "unsupported");
  assert.equal(typeof darwin.api.getAppSettings, "function");
  assert.equal(typeof darwin.api.saveAppSettings, "function");
  assert.equal(darwin.api.ipcRenderer, undefined);
  assert.equal(darwin.api.require, undefined);
  assert.equal(darwin.api.send, undefined);
  assert.equal(darwin.api.invoke, undefined);
  assert.equal(darwin.api.getPath, undefined);
  assert.equal(darwin.api.showMenuBarPanel, undefined);
  assert.equal(darwin.api.setFloatingPinned, undefined);
  assert.equal(darwin.api.showTooltip, undefined);
  assert.equal(typeof windows.api.setFloatingPinned, "function");
  assert.equal(typeof windows.api.showTooltip, "function");
  assert.notEqual(darwin.api, darwin.ipcRenderer);

  await darwin.api.getAppSettings();
  await darwin.api.saveAppSettings({ menuBarEnabled: false, launchAtLogin: true });
  assert.deepEqual(darwin.calls.invoked, [
    ["app:get-settings"],
    ["app:save-settings", { menuBarEnabled: false, launchAtLogin: true }]
  ]);
});

test("main renderer gates native application preferences to macOS", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");

  assert.match(renderer, /const isMac = window\.winplate\.platform === "darwin"/);
  assert.match(renderer, /let applicationSettings = \{\s*menuBarEnabled: true,\s*launchAtLogin: false\s*\}/);
  assert.match(renderer, /const APP_SETTING_KEYS = \["menuBarEnabled", "launchAtLogin"\]/);
  assert.match(renderer, /async function hydrateAppSettings\(\)[\s\S]*?if \(view !== "main" \|\| !isMac \|\| applicationSettingsBusy\) return/);
  assert.match(renderer, /getAppSettings\(\)/);
  assert.match(renderer, /saveAppSettings\(\{\s*menuBarEnabled: applicationSettings\.menuBarEnabled,\s*launchAtLogin: applicationSettings\.launchAtLogin\s*\}\)/);
  assert.match(renderer, /APP_SETTING_KEYS\.includes\(key\)/);
  assert.match(renderer, /input\.disabled = applicationSettingsBusy/);
  assert.match(renderer, /if \(applicationSettingsBusy\) \{\s*syncApplicationSettingsControls\(\);\s*return/);
  assert.match(renderer, /catch \(error\) \{\s*applicationSettings = previousSettings;[\s\S]*?error\?\.message[\s\S]*?finally \{\s*applicationSettingsBusy = false;\s*syncApplicationSettingsControls\(\)/);
  assert.doesNotMatch(renderer, /console\.error\([^\n]*Failed to (?:load|save) application settings[^\n]*,\s*error\s*\)/);
  assert.match(renderer, /Promise\.all\(\[hydrateAppearanceSettings\(\), hydrateQWeatherUsage\(\), hydrateAppSettings\(\)\]\)\.then\(refreshStatus\)/);
});

test("main renderer provides exactly two semantic macOS application toggles", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const settingsStart = renderer.indexOf("function macApplicationSettingsSection(");
  const settingsEnd = renderer.indexOf("\n}", settingsStart);

  assert.notEqual(settingsStart, -1);
  const macSettings = renderer.slice(settingsStart, settingsEnd + 2);
  assert.equal((macSettings.match(/<label\b/g) || []).length, 2);
  assert.equal((macSettings.match(/type="checkbox"/g) || []).length, 2);
  assert.match(macSettings, /<strong>Menu bar status<\/strong><small>Show WinPlate in the macOS menu bar\.<\/small>/);
  assert.match(macSettings, /<strong>Launch at login<\/strong><small>Start WinPlate when you sign in\.<\/small>/);
  assert.match(macSettings, /data-app-setting="menuBarEnabled"/);
  assert.match(macSettings, /data-app-setting="launchAtLogin"/);
  assert.doesNotMatch(macSettings, /desktop capsule|pin|compact title|menuBarDisplay|quota warning|floating/i);

  assert.match(renderer, /\$\{isMac \? macApplicationSettingsSection\(\) : ""\}/);
  assert.match(renderer, /\$\{isMac \? "" : windowsGeneralSettingsSection\(\)\}/);
  assert.doesNotMatch(renderer, /Windows user environment/);
});

test("main renderer omits the custom titlebar only on macOS and tolerates absent controls", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const renderStart = renderer.indexOf("function renderMain()");
  const renderEnd = renderer.indexOf("\nfunction updateMainStatusDom", renderStart);
  const renderMain = renderer.slice(renderStart, renderEnd);

  assert.match(renderMain, /document\.body\.className = `main-body platform-\$\{isMac \? "darwin" : "win32"\}`/);
  assert.match(renderMain, /\$\{isMac \? "" : `[\s\S]*?<header class="app-titlebar">[\s\S]*?<\/header>`\}/);
  assert.match(renderMain, /querySelector\("#window-minimize"\)\?\.addEventListener/);
  assert.match(renderMain, /querySelector\("#window-maximize"\)\?\.addEventListener/);
  assert.match(renderMain, /querySelector\("#window-close"\)\?\.addEventListener/);
  assert.match(renderer, /button\.querySelector\("span"\)\?\.classList\.toggle/);
  assert.match(renderMain, /aria-label="\$\{mainWindowMaximized \? "还原" : "最大化"\}"/);
  assert.match(renderMain, /restore-icon/);
});

test("macOS main-window CSS is scoped to a native material layout", () => {
  const css = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");

  assert.match(css, /\.main-body\.platform-darwin \.main-window-shell\s*\{[\s\S]*?grid-template-rows:\s*minmax\(0,\s*1fr\)[\s\S]*?background:\s*transparent/);
  assert.match(css, /\.main-body\.platform-darwin \.workspace\s*\{[\s\S]*?padding-top:\s*52px[\s\S]*?background:\s*transparent/);
  assert.match(css, /\.main-body\.platform-darwin \.sidebar\s*\{[\s\S]*?(?:backdrop-filter|-webkit-backdrop-filter):\s*blur\(/);
  assert.match(css, /\.main-body\.platform-darwin \.workspace\s*\{[\s\S]*?-webkit-app-region:\s*drag/);
  assert.match(css, /\.main-body\.platform-darwin \.sidebar,\s*\n\.main-body\.platform-darwin \.main-content\s*\{[\s\S]*?-webkit-app-region:\s*no-drag/);
  assert.match(css, /\.main-body\.platform-darwin\s*\{[\s\S]*?background:\s*transparent/);
  assert.doesNotMatch(css, /\.platform-darwin[^\n{]*(?:floating|capsule)|(?:floating|capsule)[^\n{]*\.platform-darwin/i);
});

function extractNamedFunction(source, name) {
  const signature = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const match = signature.exec(source);
  assert.ok(match, `missing function ${name}`);
  const start = match.index;
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

function createAppSettingsHarness({ isMac = true, get, save } = {}) {
  const renderer = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const createInputs = () => ["menuBarEnabled", "launchAtLogin"].map((key) => {
    const listeners = [];
    return {
      checked: key === "menuBarEnabled",
      dataset: { appSetting: key },
      disabled: false,
      listeners,
      addEventListener(type, listener) {
        if (type === "change") listeners.push(listener);
      }
    };
  });
  let currentInputs = createInputs();
  const calls = { get: 0, save: [] };
  const errors = [];
  const context = {
    console: { error: (...args) => errors.push(args) },
    document: { querySelectorAll: () => currentInputs },
    window: {
      winplate: {
        async getAppSettings() {
          calls.get += 1;
          return get ? get() : { menuBarEnabled: false, launchAtLogin: true };
        },
        async saveAppSettings(settings) {
          calls.save.push(JSON.parse(JSON.stringify(settings)));
          return save ? save(settings) : settings;
        }
      }
    }
  };
  const source = `
    const view = "main";
    const isMac = ${JSON.stringify(isMac)};
    const APP_SETTING_KEYS = ["menuBarEnabled", "launchAtLogin"];
    let applicationSettings = { menuBarEnabled: true, launchAtLogin: false };
    let applicationSettingsBusy = false;
    const boundApplicationSettingsControls = new WeakSet();
    ${extractNamedFunction(renderer, "mergeApplicationSettings")}
    ${extractNamedFunction(renderer, "syncApplicationSettingsControls")}
    ${extractNamedFunction(renderer, "hydrateAppSettings")}
    ${extractNamedFunction(renderer, "bindApplicationSettingsControls")}
    this.settingsHarness = {
      hydrateAppSettings,
      bindApplicationSettingsControls,
      settings: () => ({ ...applicationSettings })
    };
  `;
  vm.runInNewContext(source, context, { filename: "app-settings-harness.js" });
  return {
    ...context.settingsHarness,
    calls,
    errors,
    get inputs() {
      return currentInputs;
    },
    replaceInputs() {
      currentInputs = createInputs();
      context.settingsHarness.bindApplicationSettingsControls();
      return currentInputs;
    }
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

test("application settings hydration is mac-only and keeps defaults after rejection", async () => {
  const mac = createAppSettingsHarness();
  await mac.hydrateAppSettings();
  assert.equal(mac.calls.get, 1);
  assert.deepEqual({ ...mac.settings() }, { menuBarEnabled: false, launchAtLogin: true });

  const windows = createAppSettingsHarness({ isMac: false });
  await windows.hydrateAppSettings();
  assert.equal(windows.calls.get, 0);

  const failed = createAppSettingsHarness({ get: () => Promise.reject(new Error("read failed")) });
  await assert.doesNotReject(failed.hydrateAppSettings());
  assert.deepEqual({ ...failed.settings() }, { menuBarEnabled: true, launchAtLogin: false });
  assert.deepEqual(failed.errors, [["Failed to load application settings:", "read failed"]]);
});

test("application settings save adopts normalization, rolls back failures, and rejects mutated keys", async () => {
  const normalized = createAppSettingsHarness({
    save: () => ({ menuBarEnabled: false, launchAtLogin: true })
  });
  normalized.bindApplicationSettingsControls();
  normalized.bindApplicationSettingsControls();
  assert.deepEqual(normalized.inputs.map((input) => input.listeners.length), [1, 1]);
  normalized.inputs[0].checked = false;
  await normalized.inputs[0].listeners[0]();
  assert.deepEqual(normalized.calls.save, [{ menuBarEnabled: false, launchAtLogin: false }]);
  assert.deepEqual({ ...normalized.settings() }, { menuBarEnabled: false, launchAtLogin: true });
  assert.deepEqual(normalized.inputs.map((input) => input.checked), [false, true]);

  const failed = createAppSettingsHarness({ save: () => Promise.reject(new Error("save failed")) });
  failed.bindApplicationSettingsControls();
  failed.inputs[0].checked = false;
  const saving = failed.inputs[0].listeners[0]();
  assert.equal(failed.inputs[0].disabled, true);
  await saving;
  assert.equal(failed.inputs[0].checked, true);
  assert.equal(failed.inputs[0].disabled, false);
  assert.deepEqual({ ...failed.settings() }, { menuBarEnabled: true, launchAtLogin: false });
  assert.deepEqual(failed.errors, [["Failed to save application settings:", "save failed"]]);

  failed.inputs[0].dataset.appSetting = "unexpectedProperty";
  failed.inputs[0].checked = false;
  await failed.inputs[0].listeners[0]();
  assert.equal(failed.calls.save.length, 1);
});

test("pending application settings save serializes changes and synchronizes recreated controls", async () => {
  const pendingSave = deferred();
  const harness = createAppSettingsHarness({ save: () => pendingSave.promise });
  harness.bindApplicationSettingsControls();

  harness.inputs[0].checked = false;
  const firstChange = harness.inputs[0].listeners[0]();
  assert.deepEqual(harness.inputs.map((input) => input.disabled), [true, true]);
  assert.deepEqual(harness.calls.save, [{ menuBarEnabled: false, launchAtLogin: false }]);

  harness.inputs[1].checked = true;
  await harness.inputs[1].listeners[0]();
  await harness.hydrateAppSettings();
  assert.equal(harness.calls.save.length, 1);
  assert.equal(harness.calls.get, 0);
  assert.equal(harness.inputs[1].checked, false);

  const recreated = harness.replaceInputs();
  assert.deepEqual(recreated.map((input) => input.disabled), [true, true]);
  pendingSave.resolve({ menuBarEnabled: false, launchAtLogin: true });
  await firstChange;
  assert.deepEqual(recreated.map((input) => input.checked), [false, true]);
  assert.deepEqual(recreated.map((input) => input.disabled), [false, false]);
});

test("rejected application settings save restores the full prior snapshot", async () => {
  const pendingSave = deferred();
  const harness = createAppSettingsHarness({
    get: () => ({ menuBarEnabled: false, launchAtLogin: true }),
    save: () => pendingSave.promise
  });
  await harness.hydrateAppSettings();
  harness.bindApplicationSettingsControls();

  harness.inputs[0].checked = true;
  const change = harness.inputs[0].listeners[0]();
  const recreated = harness.replaceInputs();
  pendingSave.reject(new Error("save failed"));
  await change;

  assert.deepEqual({ ...harness.settings() }, { menuBarEnabled: false, launchAtLogin: true });
  assert.deepEqual(recreated.map((input) => input.checked), [false, true]);
  assert.deepEqual(recreated.map((input) => input.disabled), [false, false]);
  assert.deepEqual(harness.errors, [["Failed to save application settings:", "save failed"]]);
});

test("pending hydration blocks saves and settles recreated controls", async () => {
  const pendingHydration = deferred();
  const harness = createAppSettingsHarness({ get: () => pendingHydration.promise });
  harness.bindApplicationSettingsControls();

  const hydration = harness.hydrateAppSettings();
  assert.deepEqual(harness.inputs.map((input) => input.disabled), [true, true]);
  harness.inputs[0].checked = false;
  await harness.inputs[0].listeners[0]();
  assert.equal(harness.calls.save.length, 0);
  assert.equal(harness.inputs[0].checked, true);

  const recreated = harness.replaceInputs();
  assert.deepEqual(recreated.map((input) => input.disabled), [true, true]);
  pendingHydration.resolve({ menuBarEnabled: false, launchAtLogin: true });
  await hydration;
  assert.deepEqual(recreated.map((input) => input.checked), [false, true]);
  assert.deepEqual(recreated.map((input) => input.disabled), [false, false]);
});

test("preload exposes narrow menu bar APIs without raw Electron capabilities", () => {
  const { api, calls, ipcRenderer } = loadPreloadBridge();

  assert.deepEqual(Object.keys(api).sort(), [
    "getCodexUsage",
    "getDeepSeekUsage",
    "getStatus",
    "hideMenuBarPanel",
    "onMenuBarRefresh",
    "showMainWindow",
    "updateMenuBarTemperature"
  ]);

  assert.equal(typeof api.updateMenuBarTemperature, "function");
  assert.equal(typeof api.hideMenuBarPanel, "function");
  assert.equal(typeof api.onMenuBarRefresh, "function");
  assert.equal(api.ipcRenderer, undefined);
  assert.equal(api.require, undefined);
  assert.equal(api.send, undefined);
  assert.equal(api.invoke, undefined);
  assert.notEqual(api, ipcRenderer);

  api.updateMenuBarTemperature(19.6);
  api.hideMenuBarPanel();
  assert.deepEqual(calls.sent, [
    ["menubar:update-temperature", 19.6],
    ["menubar:hide"]
  ]);
});

test("menu bar refresh subscription uses one exact channel and returns cleanup", () => {
  const { api, calls, listeners } = loadPreloadBridge();
  const refreshes = [];
  const callback = (payload) => refreshes.push(payload);

  assert.throws(() => api.onMenuBarRefresh(null), {
    name: "TypeError",
    message: "callback must be a function"
  });
  const cleanup = api.onMenuBarRefresh(callback);
  assert.equal(typeof cleanup, "function");
  assert.deepEqual([...listeners.keys()], ["menubar:refresh"]);

  listeners.get("menubar:refresh")({ sender: "private" }, "refresh-now");
  assert.deepEqual(refreshes, ["refresh-now"]);

  const registeredListener = listeners.get("menubar:refresh");
  cleanup();
  assert.deepEqual(calls.removed, [["menubar:refresh", registeredListener]]);
  assert.equal(listeners.has("menubar:refresh"), false);
});

test("menu bar classic scripts do not redeclare shared global lexical bindings", () => {
  const model = fs.readFileSync(
    path.join(__dirname, "..", "shared", "menuBarModel.js"),
    "utf8"
  );
  const renderer = fs.readFileSync(path.join(__dirname, "menubar.js"), "utf8");

  assert.doesNotThrow(() => new vm.Script(`${model}\n${renderer}`));
});

test("main startup imports native menu bar dependencies and gates platform UI", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "main", "main.js"), "utf8");
  const electronImport = main.match(/const\s*\{([^}]+)\}\s*=\s*require\("electron"\)/)?.[1] || "";

  for (const dependency of ["BrowserWindow", "Menu", "Tray", "nativeImage", "screen"]) {
    assert.match(electronImport, new RegExp(`\\b${dependency}\\b`));
  }
  assert.match(main, /const path = require\("path"\)/);
  assert.match(main, /require\("\.\/macMenuBar"\)/);
  assert.match(main, /require\("\.\/startupPolicy"\)/);
  assert.equal((main.match(/startupPolicy\(\)/g) || []).length, 1);
  assert.match(main, /"preload",\s*"menuBarPreload\.js"/);
  assert.match(
    main,
    /"assets",\s*"icon-transparent\.png"/,
    "the native menu bar should use the supplied transparent status artwork"
  );

  assert.match(
    main,
    /if \(policy\.createFloatingWindow\)\s*\{[\s\S]*?createFloatingWindow\(\);[\s\S]*?floating:set-pinned[\s\S]*?tooltip:hide[\s\S]*?\}/
  );
  assert.match(
    main,
    /if \(policy\.createWindowsTray\)\s*\{[\s\S]*?createAppTray\(/
  );
  assert.match(
    main,
    /platform: policy\.createMacMenuBar \? "darwin" : process\.platform/
  );
  assert.match(main, /createMenuBar: \(\) => createMacMenuBar\(/);

  const afterPolicySelection = main.slice(main.indexOf("const policy = startupPolicy();"));
  const floatingCalls = [...afterPolicySelection.matchAll(/createFloatingWindow\(\)/g)];
  assert.equal(floatingCalls.length, 1);
});

test("macOS uses the supplied status artwork and rounded application icon while Windows stays platform native", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "main", "main.js"), "utf8");
  const tray = fs.readFileSync(path.join(__dirname, "..", "main", "tray.js"), "utf8");
  const windows = fs.readFileSync(path.join(__dirname, "..", "main", "windows.js"), "utf8");
  const renderer = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const transparentIcon = fs.readFileSync(
    path.join(__dirname, "..", "..", "assets", "icon-transparent.png")
  );
  const appIcon = fs.readFileSync(
    path.join(__dirname, "..", "..", "assets", "icon.png")
  );

  assert.equal(appIcon.readUInt32BE(16), 1024);
  assert.equal(appIcon.readUInt32BE(20), 1024);

  assert.match(main, /"assets",\s*"icon-transparent\.png"/);
  assert.match(main, /app\.dock\.setIcon\(nativeImage\.createFromPath\(appIconPath\)\)/);
  assert.match(tray, /"assets",\s*"icon\.png"/);
  assert.match(windows, /"assets",\s*"icon\.ico"/);
  assert.equal((renderer.match(/\.\.\/\.\.\/assets\/icon\.png/g) || []).length, 2);
  assert.equal(
    crypto.createHash("sha256").update(transparentIcon).digest("hex"),
    "05428f9ccfd8fd5453a9bd02c9050ecba79a5a1d40847ddaee9905884b3ab150"
  );
  assert.equal(
    crypto.createHash("sha256").update(appIcon).digest("hex"),
    "332d86ee4577e3d93589a2bc75f8519754d68ee64e52119e988e46503e3819e3"
  );
});

test("main accepts menu bar IPC only from the controller panel sender", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "main", "main.js"), "utf8");

  assert.match(
    main,
    /ipcMain\.on\("menubar:update-temperature", \(event, payload\) => \{\s*if \(appPreferences\?\.ownsSender\(event\.sender\)\) \{\s*appPreferences\.setTemperature\(payload\);\s*\}\s*\}\);/
  );
  assert.match(
    main,
    /ipcMain\.on\("menubar:hide", \(event\) => \{\s*if \(appPreferences\?\.ownsSender\(event\.sender\)\) \{\s*appPreferences\.hide\(\);\s*\}\s*\}\);/
  );
  assert.equal((main.match(/menubar:update-temperature/g) || []).length, 1);
  assert.equal((main.match(/menubar:hide/g) || []).length, 1);

  const menuBarHandlers = main.slice(
    main.indexOf('ipcMain.on("menubar:update-temperature"'),
    main.indexOf('ipcMain.on("github:open-profile"')
  );
  assert.doesNotMatch(menuBarHandlers, /getURL|\.url\b/);
});

test("main keeps activation reachable and falls back if menu bar construction fails", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "main", "main.js"), "utf8");
  const activation = 'app.on("activate", activationCoordinator.onActivate);';
  const activationIndex = main.indexOf(activation);
  const controllerIndex = main.indexOf("appPreferences = createAppPreferencesController(");

  assert.equal((main.match(/app\.on\("activate", activationCoordinator\.onActivate\)/g) || []).length, 1);
  assert.notEqual(activationIndex, -1);
  assert.equal(activationIndex < controllerIndex, true);
  assert.match(main, /showMainWindow,\s*reportError: \(error\) => console\.error\(error\.message\)/);
});

test("content security policy permits GitHub avatar images", () => {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");

  assert.match(
    html,
    /img-src[^;]*https:\/\/avatars\.githubusercontent\.com/,
    "GitHub avatar CDN must be allowed by the renderer CSP"
  );
});

test("floating status omits the date beside the Codex reset time", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");

  assert.doesNotMatch(renderer, /class="date-label"/);
});

test("compact Codex progress avoids CSP-blocked inline styles", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");

  assert.match(renderer, /compact-bar[\s\S]{0,120}data-progress-value=/);
  assert.doesNotMatch(renderer, /compact-bar[\s\S]{0,120}style=/);
});

test("main renderer preserves content scroll position across status refreshes", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");

  assert.match(renderer, /previousMainContent\.scrollTop/);
  assert.match(renderer, /\.main-content"\)\.scrollTo\(previousScrollPosition\)/);
});

test("automatic status refresh updates the existing main content DOM", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const refreshStatus = renderer.slice(
    renderer.indexOf("async function refreshStatus()"),
    renderer.indexOf("if (view === \"main\")")
  );

  assert.match(refreshStatus, /updateMainStatusDom\(\)/);
  assert.doesNotMatch(refreshStatus, /renderMain\(\)/);
  assert.match(renderer, /function syncDomNode\(/);
  assert.match(renderer, /currentSection === "Settings"/);
});

function readMenuBarRenderer() {
  return {
    html: fs.readFileSync(path.join(__dirname, "menubar.html"), "utf8"),
    css: fs.readFileSync(path.join(__dirname, "menubar.css"), "utf8"),
    js: fs.readFileSync(path.join(__dirname, "menubar.js"), "utf8")
  };
}

function createFakeElement(onRootReplacement) {
  const attributes = new Map();
  const classes = new Set(["inactive"]);
  const listeners = new Map();
  let innerHTML = "";

  return {
    alt: "",
    disabled: false,
    hidden: false,
    src: "",
    textContent: "",
    value: 0,
    classList: {
      contains: (name) => classes.has(name),
      toggle(name, force) {
        if (force) classes.add(name);
        else classes.delete(name);
      }
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    dispatch(type, event = {}) {
      return listeners.get(type)?.(event);
    },
    getAttribute(name) {
      return attributes.get(name) ?? null;
    },
    removeAttribute(name) {
      attributes.delete(name);
      if (name === "src") this.src = "";
    },
    replaceChildren() {
      onRootReplacement();
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    get innerHTML() {
      return innerHTML;
    },
    set innerHTML(value) {
      innerHTML = value;
      onRootReplacement();
    }
  };
}

function createMenuBarHarness(options = {}) {
  const renderer = fs.readFileSync(path.join(__dirname, "menubar.js"), "utf8");
  const realModel = require("../shared/menuBarModel.js");
  const elements = new Map();
  const documentListeners = new Map();
  const intervals = [];
  const errors = [];
  const calls = {
    codex: 0,
    codexOptions: [],
    deepseek: 0,
    deepseekOptions: [],
    destinations: [],
    hidden: 0,
    status: 0,
    temperatures: []
  };
  let rootReplacements = 0;
  let refreshListener = null;

  const getElement = (selector) => {
    if (!elements.has(selector)) {
      elements.set(selector, createFakeElement(() => {
        rootReplacements += 1;
      }));
    }
    return elements.get(selector);
  };

  const bridge = {
    getStatus() {
      calls.status += 1;
      return {
        weather: {
          source: "qweather",
          temperature: 23.6,
          condition: "晴",
          location: "上海",
          icon: "100",
          updatedAt: "2026-06-29T09:00:00.000Z"
        }
      };
    },
    getCodexUsage(options) {
      calls.codex += 1;
      calls.codexOptions.push(options.force);
      return {
        status: "Normal",
        windows: {
          fiveHour: { remainingPct: 73, resetText: "18:00" },
          sevenDay: { remainingPct: 42, resetText: "周一" }
        },
        updatedAt: "2026-06-29T09:00:00.000Z"
      };
    },
    getDeepSeekUsage(options) {
      calls.deepseek += 1;
      calls.deepseekOptions.push(options.force);
      return {
        status: "Normal",
        balances: [{ currency: "CNY", total_balance: "88.50" }],
        updatedAt: "2026-06-29T09:00:00.000Z"
      };
    },
    hideMenuBarPanel() {
      calls.hidden += 1;
    },
    onMenuBarRefresh(listener) {
      refreshListener = listener;
    },
    showMainWindow(destination) {
      calls.destinations.push(destination);
    },
    updateMenuBarTemperature(temperature) {
      calls.temperatures.push(temperature);
    },
    ...options.bridge
  };

  const model = options.reducePanelState
    ? { ...realModel, reducePanelState: options.reducePanelState }
    : realModel;
  const document = {
    addEventListener(type, listener) {
      documentListeners.set(type, listener);
    },
    querySelector: getElement
  };

  vm.runInNewContext(renderer, {
    console: { error: (...args) => errors.push(args) },
    document,
    setInterval(callback, delay) {
      intervals.push({ callback, delay });
      return intervals.length;
    },
    window: {
      WinPlateMenuBarModel: model,
      winplate: bridge
    }
  }, { filename: "menubar.js" });

  return {
    bridge,
    calls,
    dispatchDocument(type, event) {
      return documentListeners.get(type)?.(event);
    },
    element: getElement,
    errors,
    intervals,
    refresh: () => refreshListener(),
    rootReplacements: () => rootReplacements,
    settle: () => new Promise((resolve) => setImmediate(resolve))
  };
}

test("menu bar panel has a strict CSP and fixed accessible section order", () => {
  const { html } = readMenuBarRenderer();
  const csp = html.match(/<meta[^>]+http-equiv="Content-Security-Policy"[^>]+content="([^"]+)"/i)?.[1];

  assert.equal(/<html[^>]+lang="zh-CN"/i.test(html), true);
  assert.match(html, /<meta[^>]+name="viewport"/i);
  assert.match(csp || "", /default-src 'self'/);
  assert.match(csp || "", /style-src 'self'/);
  assert.match(csp || "", /script-src 'self'/);
  assert.match(csp || "", /img-src 'self' data:/);
  assert.match(csp || "", /connect-src 'self'[^;]*http:\/\/localhost:8765/);

  const sectionIds = [...html.matchAll(/<(?:section|footer)\b[^>]+id="([^"]+)"/g)]
    .map((match) => match[1]);
  assert.deepEqual(sectionIds, [
    "codex-section",
    "deepseek-section",
    "weather-section",
    "panel-actions"
  ]);
  assert.match(html, /<main\b[^>]+role="region"[^>]+aria-label=/);
});

test("menu bar markup avoids inline behavior and loads its model before renderer", () => {
  const { html } = readMenuBarRenderer();

  assert.doesNotMatch(html, /\sstyle\s*=/i);
  assert.doesNotMatch(html, /\sonclick\s*=/i);
  assert.doesNotMatch(html, /<svg\b/i);
  assert.match(html, /<link[^>]+href="menubar\.css"/);

  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)]
    .map((match) => match[1]);
  assert.deepEqual(scripts, ["../shared/menuBarModel.js", "menubar.js"]);
});

test("menu bar uses semantic controls and real QWeather artwork", () => {
  const { html, js } = readMenuBarRenderer();

  assert.match(html, /<label[^>]+for="codex-five-hour-progress"/);
  assert.match(html, /<progress[^>]+id="codex-five-hour-progress"[^>]+max="100"/);
  assert.match(html, /<label[^>]+for="codex-seven-day-progress"/);
  assert.match(html, /<progress[^>]+id="codex-seven-day-progress"[^>]+max="100"/);
  assert.equal((html.match(/<button\b/g) || []).length, 4);
  assert.match(html, /<img[^>]+id="weather-icon"/);
  assert.match(js, /\.\.\/\.\.\/node_modules\/qweather-icons\/icons\/\$\{icon\}\.svg/);
  assert.match(js, /\^\\d\{3\}\$/);
});

test("menu bar status and quota styling follows WinPlate neutral tokens", () => {
  const { css, js } = readMenuBarRenderer();

  assert.match(css, /\.status-point\s*\{[\s\S]*?width:\s*7px[\s\S]*?height:\s*7px[\s\S]*?background:\s*#34d399[\s\S]*?box-shadow:/);
  assert.match(css, /\.status-point\.inactive\s*\{[\s\S]*?background:\s*#71717a[\s\S]*?box-shadow:\s*none/);
  assert.match(css, /progress[\s\S]*?accent-color:\s*(?:#d4d4d8|var\(--progress-neutral\))/);
  assert.doesNotMatch(`${css}\n${js}`, /warning|critical|danger|quota-low/i);
  assert.doesNotMatch(css, /progress[\s\S]{0,180}(?:#facc15|#f59e0b|#ef4444|#dc2626)/i);
});

test("menu bar renderer updates fields in place and refreshes every 30 seconds", () => {
  const { js } = readMenuBarRenderer();
  const updateStart = js.indexOf("function updatePanelDom(");
  const updateEnd = js.indexOf("\n}", updateStart);
  const updatePanelDom = js.slice(updateStart, updateEnd + 2);

  assert.notEqual(updateStart, -1);
  assert.doesNotMatch(js, /replaceChildren|innerHTML/);
  assert.doesNotMatch(updatePanelDom, /createElement|appendChild/);
  assert.match(js, /Promise\.allSettled\(/);
  assert.match(js, /async function refresh\(\{\s*force\s*=\s*false\s*\}\s*=\s*\{\}\)/);
  assert.match(js, /getCodexUsage\(\{\s*force\s*\}\)/);
  assert.match(js, /getDeepSeekUsage\(\{\s*force\s*\}\)/);
  assert.match(js, /setInterval\(refresh,\s*30_000\)/);
  assert.match(js, /onMenuBarRefresh\(\(\)\s*=>\s*refresh\(\{\s*force:\s*true\s*\}\)\)/);
  assert.match(js, /refreshButton\.addEventListener\("click",\s*\(\)\s*=>\s*refresh\(\{\s*force:\s*true\s*\}\)\)/);
  assert.match(js, /updateMenuBarTemperature\(/);
  assert.match(js, /hideMenuBarPanel\(\)/);
});

test("menu bar actions use the existing main-window bridge with a destination", () => {
  const { js } = readMenuBarRenderer();

  assert.match(js, /showMainWindow\("Dashboard"\)/);
  assert.equal((js.match(/showMainWindow\("Settings"\)/g) || []).length, 2);
  assert.doesNotMatch(js, /openDashboard|openSettings/);
});

test("menu bar scroll container follows shortened BrowserWindow viewports", () => {
  const { css } = readMenuBarRenderer();
  const documentRule = css.match(/html,\s*\nbody\s*\{([\s\S]*?)\n\}/)?.[1] || "";
  const panelRule = css.match(/\.panel\s*\{([\s\S]*?)\n\}/)?.[1] || "";

  assert.match(css, /\*\s*\{[\s\S]*?box-sizing:\s*border-box/);
  assert.match(documentRule, /height:\s*100%/);
  assert.match(panelRule, /height:\s*(?:100%|100vh)/);
  assert.match(panelRule, /max-height:\s*none/);
  assert.match(panelRule, /overflow-y:\s*auto/);
  assert.doesNotMatch(panelRule, /max-height:\s*420px/);
});

test("menu bar weather icon and focus ring remain legible in both themes", () => {
  const { css } = readMenuBarRenderer();

  assert.match(css, /--focus-ring:\s*#005fcc/);
  assert.match(css, /button:focus-visible\s*\{[\s\S]*?outline:\s*2px solid var\(--focus-ring\)/);
  assert.doesNotMatch(css, /outline:[^;]*color-mix/);
  assert.match(css, /\.weather-icon\s*\{[\s\S]*?filter:\s*brightness\(0\)/);
  assert.match(css, /@media \(prefers-color-scheme: dark\)[\s\S]*?--focus-ring:\s*#60a5fa/);
  assert.match(css, /@media \(prefers-color-scheme: dark\)[\s\S]*?\.weather-icon\s*\{[\s\S]*?filter:\s*brightness\(0\) invert\(1\)/);
});

test("menu bar refresh adopts synchronous bridge failures and handles unexpected errors", () => {
  const { js } = readMenuBarRenderer();

  assert.equal((js.match(/Promise\.resolve\(\)\.then\(\(\) => window\.winplate\.get/g) || []).length, 3);
  assert.match(js, /catch \(error\)\s*\{[\s\S]*?console\.error\(/);
});

test("menu bar labels Codex percentages as remaining quota", () => {
  const { html } = readMenuBarRenderer();

  assert.match(html, />5 小时剩余</);
  assert.match(html, />7 天剩余</);
  assert.doesNotMatch(html, />[57] (?:小时|天)用量</);
});

test("menu bar renderer performs its initial refresh and updates named DOM fields", async () => {
  const harness = createMenuBarHarness();
  await harness.settle();

  assert.equal(harness.calls.status, 1);
  assert.equal(harness.calls.codex, 1);
  assert.equal(harness.calls.deepseek, 1);
  assert.equal(harness.element("#codex-five-hour-progress").value, 73);
  assert.equal(harness.element("#codex-five-hour-percent").textContent, "73%");
  assert.equal(harness.element("#deepseek-balance").textContent, "¥88.50");
  assert.equal(harness.element("#weather-temperature").textContent, "24°");
  assert.match(harness.element("#weather-icon").src, /qweather-icons\/icons\/100\.svg$/);
  assert.deepEqual(harness.calls.temperatures, [24]);
  assert.equal(harness.element("#refresh-panel").disabled, false);
  assert.equal(harness.element("#menu-bar-panel").getAttribute("aria-busy"), null);
  assert.equal(harness.rootReplacements(), 0);
  assert.equal(typeof harness.refresh, "function");
  assert.equal(harness.intervals.length, 1);
  assert.equal(harness.intervals[0].delay, 30_000);
  assert.deepEqual(harness.calls.codexOptions, [false]);
  assert.deepEqual(harness.calls.deepseekOptions, [false]);
});

test("automatic refresh uses caches while explicit refresh bypasses them", async () => {
  const harness = createMenuBarHarness();
  await harness.settle();

  await harness.intervals[0].callback();
  await harness.refresh();
  await harness.element("#refresh-panel").dispatch("click");

  assert.deepEqual(harness.calls.codexOptions, [false, false, true, true]);
  assert.deepEqual(harness.calls.deepseekOptions, harness.calls.codexOptions);
});

test("menu bar refresh isolates synchronous source failures and restores controls", async () => {
  const harness = createMenuBarHarness();
  await harness.settle();
  const calls = { codex: 0, deepseek: 0, status: 0 };

  harness.bridge.getStatus = () => {
    calls.status += 1;
    throw new Error("status unavailable");
  };
  harness.bridge.getCodexUsage = () => {
    calls.codex += 1;
    return { status: "Normal", remainingPct: 61, resetText: "稍后" };
  };
  harness.bridge.getDeepSeekUsage = () => {
    calls.deepseek += 1;
    return { status: "Unavailable" };
  };

  await assert.doesNotReject(harness.refresh());
  assert.deepEqual(calls, { codex: 1, deepseek: 1, status: 1 });
  assert.equal(harness.element("#codex-five-hour-percent").textContent, "61%");
  assert.equal(harness.element("#weather-temperature").textContent, "--°");
  assert.equal(harness.element("#refresh-panel").disabled, false);
  assert.equal(harness.element("#menu-bar-panel").getAttribute("aria-busy"), null);
});

test("menu bar refresh logs unexpected reducer errors without rejecting", async () => {
  const realModel = require("../shared/menuBarModel.js");
  let reductions = 0;
  const harness = createMenuBarHarness({
    reducePanelState(...args) {
      reductions += 1;
      if (reductions === 2) throw new Error("render failed");
      return realModel.reducePanelState(...args);
    }
  });
  await harness.settle();

  await assert.doesNotReject(harness.intervals[0].callback());
  assert.equal(harness.errors.length, 1);
  assert.match(String(harness.errors[0][0]), /menu bar panel/i);
  assert.equal(harness.element("#refresh-panel").disabled, false);
  assert.equal(harness.element("#menu-bar-panel").getAttribute("aria-busy"), null);
});

test("menu bar actions and Escape invoke their bridge handlers", async () => {
  const harness = createMenuBarHarness();
  await harness.settle();

  harness.element("#open-dashboard").dispatch("click");
  harness.element("#open-settings").dispatch("click");
  harness.element("#deepseek-configure").dispatch("click");
  harness.dispatchDocument("keydown", { key: "Escape" });
  harness.dispatchDocument("keydown", { key: "Enter" });

  assert.deepEqual(harness.calls.destinations, ["Dashboard", "Settings", "Settings"]);
  assert.equal(harness.calls.hidden, 1);
});
