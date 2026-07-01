# WinPlate Dual-Platform Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Complete one Windows and macOS development application that preserves the Windows capsule product, retains the approved macOS menu bar product, adds the native macOS main window and durable settings, and proves both platform paths.

**Architecture:** Use codex/macos-menu-bar as the implementation baseline. Keep shared data and renderer code, select native surfaces once at startup, isolate pure window and preference policies, keep the existing macOS menu controller, and add encrypted main-process service configuration without exposing secrets to renderers.

**Tech Stack:** Electron 40, CommonJS Node.js, browser JavaScript/CSS, Node test runner, FastAPI/Python unittest, Electron safeStorage, GitHub Actions.

---

## File responsibilities

- src/main/windowPolicy.js: pure Windows/macOS main-window options.
- src/main/windowPolicy.test.js: platform dimensions, chrome, and unsupported-platform tests.
- src/main/windows.js: shared main/floating/tooltip lifecycle consuming the policy.
- src/main/appSettings.js: validated atomic macOS application preferences.
- src/main/appSettings.test.js: defaults, corruption, persistence, and login-item tests.
- src/main/appPreferencesController.js: idempotent live menu-bar preference application.
- src/main/appPreferencesController.test.js: lifecycle, failure, sender, and teardown tests.
- src/main/serviceSettings.js: encrypted service settings and environment precedence.
- src/main/serviceSettings.test.js: encryption, redaction, precedence, and corruption tests.
- src/main/main.js: startup ordering, IPC, settings, and controller integration.
- src/preload/preload.js: bounded platform and application-preference bridge.
- src/renderer/app.js: native macOS main-window layout and preference controls.
- src/renderer/styles.css: traffic-light safe area and native material layout.
- src/renderer/security.test.js: platform branch and preload security coverage.
- .github/workflows/test.yml: macOS/Windows Node and Python test matrix.
- README.md: dual-platform setup, persistence, and verification.
- docs/verification/dual-platform-smoke.md: direct runtime evidence.

### Task 1: Pure main-window policy and native macOS main window

**Files:**
- Create: src/main/windowPolicy.test.js
- Create: src/main/windowPolicy.js
- Modify: src/main/windows.js
- Modify: package.json

- [ ] **Step 1: Write the failing platform-policy tests**

Create src/main/windowPolicy.test.js:

~~~js
const test = require("node:test");
const assert = require("node:assert/strict");
const { getMainWindowOptions } = require("./windowPolicy");

const webPreferences = Object.freeze({
  preload: "/repo/src/preload/preload.js",
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true
});

test("Windows preserves the current frameless main window", () => {
  assert.deepEqual(getMainWindowOptions("win32", {
    icon: "/repo/assets/icon.ico",
    dark: true,
    webPreferences
  }), {
    width: 1080,
    height: 720,
    minWidth: 860,
    minHeight: 560,
    show: false,
    backgroundColor: "#181818",
    title: "WinPlate",
    icon: "/repo/assets/icon.ico",
    autoHideMenuBar: true,
    frame: false,
    webPreferences
  });
});

test("macOS uses native chrome and approved dimensions", () => {
  assert.deepEqual(getMainWindowOptions("darwin", {
    icon: "/repo/assets/icon.ico",
    dark: false,
    webPreferences
  }), {
    width: 1040,
    height: 720,
    minWidth: 880,
    minHeight: 580,
    show: false,
    title: "WinPlate",
    frame: true,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    transparent: true,
    backgroundColor: "#00000000",
    vibrancy: "window",
    visualEffectState: "followWindow",
    webPreferences
  });
});

test("window policy rejects unsupported platforms", () => {
  assert.throws(
    () => getMainWindowOptions("linux", { webPreferences }),
    /Unsupported platform: linux/
  );
});
~~~

- [ ] **Step 2: Run the test and confirm the missing module**

Run:

~~~bash
node --test src/main/windowPolicy.test.js
~~~

Expected: FAIL with Cannot find module './windowPolicy'.

- [ ] **Step 3: Implement the pure policy**

Create src/main/windowPolicy.js:

~~~js
function getMainWindowOptions(platform, { icon, dark, webPreferences }) {
  if (platform === "win32") {
    return {
      width: 1080,
      height: 720,
      minWidth: 860,
      minHeight: 560,
      show: false,
      backgroundColor: dark ? "#181818" : "#f7f7f8",
      title: "WinPlate",
      icon,
      autoHideMenuBar: true,
      frame: false,
      webPreferences
    };
  }
  if (platform === "darwin") {
    return {
      width: 1040,
      height: 720,
      minWidth: 880,
      minHeight: 580,
      show: false,
      title: "WinPlate",
      frame: true,
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 16, y: 16 },
      transparent: true,
      backgroundColor: "#00000000",
      vibrancy: "window",
      visualEffectState: "followWindow",
      webPreferences
    };
  }
  throw new Error("Unsupported platform: " + platform);
}

module.exports = { getMainWindowOptions };
~~~

- [ ] **Step 4: Consume the policy in windows.js**

Add:

~~~js
const { getMainWindowOptions } = require("./windowPolicy");
~~~

Replace the main BrowserWindow options with:

~~~js
mainWindow = new BrowserWindow(getMainWindowOptions(process.platform, {
  icon: iconPath,
  dark,
  webPreferences: secureWebPreferences()
}));
~~~

Replace theme application with:

~~~js
function setMainWindowTheme(theme) {
  if (!mainWindow || mainWindow.isDestroyed() || process.platform === "darwin") return;
  mainWindow.setBackgroundColor(theme === "light" ? "#f7f7f8" : "#181818");
}
~~~

Add and export:

~~~js
function ownsMainWindowSender(sender) {
  return Boolean(
    mainWindow &&
    !mainWindow.isDestroyed() &&
    sender === mainWindow.webContents
  );
}
~~~

- [ ] **Step 5: Register, verify, and commit**

Add the source syntax check and test to package.json. Run:

~~~bash
node --test src/main/windowPolicy.test.js
npm run check
git add package.json src/main/windowPolicy.js src/main/windowPolicy.test.js src/main/windows.js
git commit -m "feat: add native main window policies"
~~~

Expected: 3 focused tests and the full suite pass.

### Task 2: Validated application preferences

**Files:**
- Create: src/main/appSettings.test.js
- Create: src/main/appSettings.js
- Modify: package.json

- [ ] **Step 1: Write failing preference tests**

Create src/main/appSettings.test.js:

~~~js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  DEFAULT_APP_SETTINGS,
  normalizeAppSettings,
  readAppSettings,
  writeAppSettings,
  applyLoginItemSetting
} = require("./appSettings");

test("only approved application preferences survive normalization", () => {
  assert.deepEqual(normalizeAppSettings({}), DEFAULT_APP_SETTINGS);
  assert.deepEqual(normalizeAppSettings({
    menuBarEnabled: false,
    launchAtLogin: true,
    desktopCapsuleEnabled: true,
    menuBarDisplay: "compact"
  }), { menuBarEnabled: false, launchAtLogin: true });
  assert.deepEqual(normalizeAppSettings({
    menuBarEnabled: "yes",
    launchAtLogin: 1
  }), DEFAULT_APP_SETTINGS);
});

test("preferences persist atomically and corrupt files recover", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "winplate-app-settings-"));
  assert.deepEqual(await readAppSettings(directory), DEFAULT_APP_SETTINGS);
  const saved = await writeAppSettings(directory, {
    menuBarEnabled: false,
    launchAtLogin: true
  });
  assert.deepEqual(await readAppSettings(directory), saved);
  await fs.writeFile(path.join(directory, "app-settings.json"), "not json", "utf8");
  assert.deepEqual(await readAppSettings(directory), DEFAULT_APP_SETTINGS);
  assert.equal((await fs.readdir(directory)).some((name) => name.endsWith(".tmp")), false);
});

test("login item writes only when the value changes", () => {
  const writes = [];
  const app = {
    getLoginItemSettings: () => ({ openAtLogin: false }),
    setLoginItemSettings: (value) => writes.push(value)
  };
  assert.equal(applyLoginItemSetting(app, false), false);
  assert.equal(applyLoginItemSetting(app, true), true);
  assert.deepEqual(writes, [{ openAtLogin: true }]);
});
~~~

- [ ] **Step 2: Confirm the test fails**

Run node --test src/main/appSettings.test.js.

Expected: FAIL with Cannot find module './appSettings'.

- [ ] **Step 3: Implement atomic persistence**

Create src/main/appSettings.js:

~~~js
const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_APP_SETTINGS = Object.freeze({
  menuBarEnabled: true,
  launchAtLogin: false
});

function normalizeAppSettings(value = {}) {
  return {
    menuBarEnabled: typeof value.menuBarEnabled === "boolean"
      ? value.menuBarEnabled
      : true,
    launchAtLogin: typeof value.launchAtLogin === "boolean"
      ? value.launchAtLogin
      : false
  };
}

const settingsPath = (userDataPath) => path.join(userDataPath, "app-settings.json");

async function readAppSettings(userDataPath) {
  try {
    return normalizeAppSettings(JSON.parse(
      await fs.readFile(settingsPath(userDataPath), "utf8")
    ));
  } catch (error) {
    if (error.code !== "ENOENT" && error.name !== "SyntaxError") throw error;
    return { ...DEFAULT_APP_SETTINGS };
  }
}

async function writeAppSettings(userDataPath, value) {
  const settings = normalizeAppSettings(value);
  const target = settingsPath(userDataPath);
  const temporary = target + ".tmp";
  await fs.mkdir(userDataPath, { recursive: true });
  await fs.writeFile(temporary, JSON.stringify(settings, null, 2) + "\n", "utf8");
  await fs.rename(temporary, target);
  return settings;
}

function applyLoginItemSetting(app, enabled) {
  const desired = Boolean(enabled);
  if (app.getLoginItemSettings().openAtLogin === desired) return false;
  app.setLoginItemSettings({ openAtLogin: desired });
  return true;
}

module.exports = {
  DEFAULT_APP_SETTINGS,
  normalizeAppSettings,
  readAppSettings,
  writeAppSettings,
  applyLoginItemSetting
};
~~~

- [ ] **Step 4: Register, verify, and commit**

~~~bash
node --test src/main/appSettings.test.js
npm run check
git add package.json src/main/appSettings.js src/main/appSettings.test.js
git commit -m "feat: persist macOS application preferences"
~~~

Expected: 3 focused tests pass.

### Task 3: Idempotent live preference controller

**Files:**
- Create: src/main/appPreferencesController.test.js
- Create: src/main/appPreferencesController.js
- Modify: package.json

- [ ] **Step 1: Write failing lifecycle tests**

Create src/main/appPreferencesController.test.js:

~~~js
const test = require("node:test");
const assert = require("node:assert/strict");
const { createAppPreferencesController } = require("./appPreferencesController");

function harness({ platform = "darwin", failure = null } = {}) {
  const calls = { create: 0, destroy: 0, login: [], show: 0, errors: [] };
  const sender = {};
  const menu = {
    ownsSender: (value) => value === sender,
    setTemperature: (value) => value,
    hide: () => "hidden",
    refresh: () => "refreshed",
    destroy: () => { calls.destroy += 1; }
  };
  const controller = createAppPreferencesController({
    platform,
    initialSettings: { menuBarEnabled: true, launchAtLogin: false },
    createMenuBar: () => {
      calls.create += 1;
      if (failure) throw failure;
      return menu;
    },
    applyLoginItem: (enabled) => calls.login.push(enabled),
    showMainWindow: () => { calls.show += 1; },
    reportError: (error) => calls.errors.push(error.message)
  });
  return { calls, controller, sender };
}

test("macOS applies settings without duplicate controllers", () => {
  const { calls, controller } = harness();
  controller.apply({ menuBarEnabled: true, launchAtLogin: false });
  controller.apply({ menuBarEnabled: true, launchAtLogin: true });
  assert.equal(calls.create, 1);
  assert.deepEqual(calls.login, [false, true]);
  controller.apply({ menuBarEnabled: false, launchAtLogin: true });
  controller.apply({ menuBarEnabled: false, launchAtLogin: true });
  assert.equal(calls.destroy, 1);
});

test("only the live menu sender is delegated", () => {
  const { controller, sender } = harness();
  controller.apply({ menuBarEnabled: true, launchAtLogin: false });
  assert.equal(controller.ownsSender(sender), true);
  assert.equal(controller.ownsSender({}), false);
  assert.equal(controller.setTemperature(24), 24);
  assert.equal(controller.hide(), "hidden");
  controller.destroy();
  assert.equal(controller.ownsSender(sender), false);
  assert.equal(controller.hide(), undefined);
});

test("creation failure opens the main window", () => {
  const { calls, controller } = harness({ failure: new Error("native failure") });
  controller.apply({ menuBarEnabled: true, launchAtLogin: false });
  assert.deepEqual(calls.errors, ["native failure"]);
  assert.equal(calls.show, 1);
});

test("Windows ignores macOS-only preferences", () => {
  const { calls, controller } = harness({ platform: "win32" });
  controller.apply({ menuBarEnabled: true, launchAtLogin: true });
  assert.deepEqual(calls, {
    create: 0,
    destroy: 0,
    login: [],
    show: 0,
    errors: []
  });
});
~~~

- [ ] **Step 2: Confirm the missing controller failure**

Run node --test src/main/appPreferencesController.test.js.

Expected: FAIL with Cannot find module './appPreferencesController'.

- [ ] **Step 3: Implement the controller**

Create src/main/appPreferencesController.js:

~~~js
const { normalizeAppSettings } = require("./appSettings");

function createAppPreferencesController({
  platform,
  initialSettings,
  createMenuBar,
  applyLoginItem,
  showMainWindow,
  reportError
}) {
  let settings = normalizeAppSettings(initialSettings);
  let menuBar = null;
  let destroyed = false;

  function apply(value) {
    if (destroyed) return { ...settings };
    settings = normalizeAppSettings(value);
    if (platform !== "darwin") return { ...settings };
    applyLoginItem(settings.launchAtLogin);
    if (!settings.menuBarEnabled) {
      menuBar?.destroy();
      menuBar = null;
      return { ...settings };
    }
    if (!menuBar) {
      try {
        menuBar = createMenuBar();
      } catch (error) {
        reportError(error);
        showMainWindow("Dashboard");
      }
    }
    return { ...settings };
  }

  function ownsSender(sender) {
    return !destroyed && Boolean(menuBar?.ownsSender(sender));
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    menuBar?.destroy();
    menuBar = null;
  }

  return {
    apply,
    getSettings: () => ({ ...settings }),
    ownsSender,
    setTemperature: (value) => menuBar?.setTemperature(value),
    hide: () => menuBar?.hide(),
    refresh: () => menuBar?.refresh(),
    destroy
  };
}

module.exports = { createAppPreferencesController };
~~~

- [ ] **Step 4: Register, verify, and commit**

~~~bash
node --test src/main/appPreferencesController.test.js
npm run check
git add package.json src/main/appPreferencesController.js src/main/appPreferencesController.test.js
git commit -m "feat: apply macOS preferences live"
~~~

Expected: 4 focused tests pass.

### Task 4: Encrypted durable service settings

**Files:**
- Create: src/main/serviceSettings.test.js
- Create: src/main/serviceSettings.js
- Modify: package.json

- [ ] **Step 1: Write failing encryption and precedence tests**

Create src/main/serviceSettings.test.js:

~~~js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  DEFAULT_SERVICE_SETTINGS,
  readServiceSettings,
  writeServiceSettings,
  resolveServiceSettings,
  publicServiceSettings,
  toServiceEnvironment
} = require("./serviceSettings");

function fakeSafeStorage(available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value) => Buffer.from("encrypted:" + value, "utf8"),
    decryptString: (value) => {
      const text = value.toString("utf8");
      if (!text.startsWith("encrypted:")) throw new Error("corrupt");
      return text.slice("encrypted:".length);
    }
  };
}

const configured = {
  qweatherApiKey: "weather-secret",
  qweatherApiHost: "api.example.com",
  qweatherProjectId: "project",
  qweatherCredentialId: "credential",
  qweatherPrivateKey: "private-secret",
  deepseekApiKey: "deepseek-secret",
  deepseekBaseUrl: "https://api.deepseek.com"
};

test("settings round-trip without plaintext secrets", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "winplate-services-"));
  await writeServiceSettings(directory, configured, fakeSafeStorage());
  const raw = await fs.readFile(path.join(directory, "service-settings.json"), "utf8");
  assert.doesNotMatch(raw, /weather-secret|private-secret|deepseek-secret/);
  assert.deepEqual(await readServiceSettings(directory, fakeSafeStorage()), configured);
});

test("missing and corrupt ciphertext recover safely", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "winplate-corrupt-"));
  assert.deepEqual(await readServiceSettings(directory, fakeSafeStorage()), DEFAULT_SERVICE_SETTINGS);
  await fs.writeFile(path.join(directory, "service-settings.json"), JSON.stringify({
    qweatherApiHost: "api.example.com",
    encrypted: { qweatherApiKey: Buffer.from("invalid").toString("base64") }
  }));
  assert.deepEqual(await readServiceSettings(directory, fakeSafeStorage()), {
    ...DEFAULT_SERVICE_SETTINGS,
    qweatherApiHost: "api.example.com"
  });
});

test("environment values override stored values", () => {
  const resolved = resolveServiceSettings(configured, {
    QWEATHER_API_KEY: "environment-weather",
    DEEPSEEK_BASE_URL: "https://proxy.example.com"
  });
  assert.equal(resolved.qweatherApiKey, "environment-weather");
  assert.equal(resolved.deepseekBaseUrl, "https://proxy.example.com");
  assert.equal(resolved.qweatherProjectId, "project");
});

test("renderer projection redacts secrets and environment mapping is exact", () => {
  assert.deepEqual(publicServiceSettings(configured), {
    hasQWeatherApiKey: true,
    qweatherApiHost: "api.example.com",
    qweatherProjectId: "project",
    qweatherCredentialId: "credential",
    hasQWeatherPrivateKey: true,
    hasDeepSeekApiKey: true,
    deepseekBaseUrl: "https://api.deepseek.com"
  });
  assert.equal(toServiceEnvironment(configured).QWEATHER_API_KEY, "weather-secret");
  assert.equal(toServiceEnvironment(configured).DEEPSEEK_API_KEY, "deepseek-secret");
});

test("saving secrets rejects unavailable secure storage", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "winplate-unavailable-"));
  await assert.rejects(
    writeServiceSettings(directory, configured, fakeSafeStorage(false)),
    /Secure credential storage is unavailable/
  );
  await assert.rejects(fs.access(path.join(directory, "service-settings.json")));
});
~~~

- [ ] **Step 2: Confirm the missing module**

Run node --test src/main/serviceSettings.test.js.

Expected: FAIL with Cannot find module './serviceSettings'.

- [ ] **Step 3: Implement the encrypted store**

Create src/main/serviceSettings.js:

~~~js
const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_SERVICE_SETTINGS = Object.freeze({
  qweatherApiKey: "",
  qweatherApiHost: "devapi.qweather.com",
  qweatherProjectId: "",
  qweatherCredentialId: "",
  qweatherPrivateKey: "",
  deepseekApiKey: "",
  deepseekBaseUrl: "https://api.deepseek.com"
});

const SECRET_FIELDS = Object.freeze([
  "qweatherApiKey",
  "qweatherPrivateKey",
  "deepseekApiKey"
]);

const ENVIRONMENT_FIELDS = Object.freeze({
  qweatherApiKey: "QWEATHER_API_KEY",
  qweatherApiHost: "QWEATHER_API_HOST",
  qweatherProjectId: "QWEATHER_PROJECT_ID",
  qweatherCredentialId: "QWEATHER_CREDENTIAL_ID",
  qweatherPrivateKey: "QWEATHER_PRIVATE_KEY",
  deepseekApiKey: "DEEPSEEK_API_KEY",
  deepseekBaseUrl: "DEEPSEEK_BASE_URL"
});

function clean(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeServiceSettings(value = {}) {
  return {
    qweatherApiKey: clean(value.qweatherApiKey),
    qweatherApiHost: clean(value.qweatherApiHost, DEFAULT_SERVICE_SETTINGS.qweatherApiHost),
    qweatherProjectId: clean(value.qweatherProjectId),
    qweatherCredentialId: clean(value.qweatherCredentialId),
    qweatherPrivateKey: clean(value.qweatherPrivateKey),
    deepseekApiKey: clean(value.deepseekApiKey),
    deepseekBaseUrl: clean(value.deepseekBaseUrl, DEFAULT_SERVICE_SETTINGS.deepseekBaseUrl)
  };
}

const filePath = (userDataPath) => path.join(userDataPath, "service-settings.json");

function decryptSecret(safeStorage, encoded) {
  if (typeof encoded !== "string" || !encoded) return "";
  try {
    return safeStorage.decryptString(Buffer.from(encoded, "base64"));
  } catch {
    return "";
  }
}

async function readServiceSettings(userDataPath, safeStorage) {
  try {
    const payload = JSON.parse(await fs.readFile(filePath(userDataPath), "utf8"));
    const decrypted = {};
    for (const field of SECRET_FIELDS) {
      decrypted[field] = decryptSecret(safeStorage, payload.encrypted?.[field]);
    }
    return normalizeServiceSettings({ ...payload, ...decrypted });
  } catch (error) {
    if (error.code !== "ENOENT" && error.name !== "SyntaxError") throw error;
    return { ...DEFAULT_SERVICE_SETTINGS };
  }
}

async function writeServiceSettings(userDataPath, value, safeStorage) {
  const settings = normalizeServiceSettings(value);
  if (SECRET_FIELDS.some((field) => settings[field]) && !safeStorage.isEncryptionAvailable()) {
    throw new Error("Secure credential storage is unavailable");
  }
  const encrypted = {};
  for (const field of SECRET_FIELDS) {
    if (settings[field]) {
      encrypted[field] = safeStorage.encryptString(settings[field]).toString("base64");
    }
  }
  const payload = {
    version: 1,
    qweatherApiHost: settings.qweatherApiHost,
    qweatherProjectId: settings.qweatherProjectId,
    qweatherCredentialId: settings.qweatherCredentialId,
    deepseekBaseUrl: settings.deepseekBaseUrl,
    encrypted
  };
  const target = filePath(userDataPath);
  const temporary = target + ".tmp";
  await fs.mkdir(userDataPath, { recursive: true });
  await fs.writeFile(temporary, JSON.stringify(payload, null, 2) + "\n", "utf8");
  await fs.rename(temporary, target);
  return settings;
}

function resolveServiceSettings(stored, environment = process.env) {
  const resolved = normalizeServiceSettings(stored);
  for (const [field, name] of Object.entries(ENVIRONMENT_FIELDS)) {
    if (typeof environment[name] === "string" && environment[name].trim()) {
      resolved[field] = environment[name].trim();
    }
  }
  return resolved;
}

function publicServiceSettings(value) {
  const settings = normalizeServiceSettings(value);
  return {
    hasQWeatherApiKey: Boolean(settings.qweatherApiKey),
    qweatherApiHost: settings.qweatherApiHost,
    qweatherProjectId: settings.qweatherProjectId,
    qweatherCredentialId: settings.qweatherCredentialId,
    hasQWeatherPrivateKey: Boolean(settings.qweatherPrivateKey),
    hasDeepSeekApiKey: Boolean(settings.deepseekApiKey),
    deepseekBaseUrl: settings.deepseekBaseUrl
  };
}

function toServiceEnvironment(value) {
  const settings = normalizeServiceSettings(value);
  return Object.fromEntries(
    Object.entries(ENVIRONMENT_FIELDS).map(([field, name]) => [name, settings[field]])
  );
}

module.exports = {
  DEFAULT_SERVICE_SETTINGS,
  normalizeServiceSettings,
  readServiceSettings,
  writeServiceSettings,
  resolveServiceSettings,
  publicServiceSettings,
  toServiceEnvironment
};
~~~

- [ ] **Step 4: Register, verify, and commit**

~~~bash
node --test src/main/serviceSettings.test.js
npm run check
git add package.json src/main/serviceSettings.js src/main/serviceSettings.test.js
git commit -m "feat: encrypt persistent service settings"
~~~

Expected: 5 focused tests pass and no output contains a configured secret.

### Task 5: Main-process startup and IPC integration

**Files:**
- Create: src/main/integrationSecurity.test.js
- Modify: src/main/main.js
- Modify: src/main/windows.js
- Modify: package.json

- [ ] **Step 1: Write failing integration-boundary tests**

Create src/main/integrationSecurity.test.js:

~~~js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const main = fs.readFileSync(path.join(__dirname, "main.js"), "utf8");
const windows = fs.readFileSync(path.join(__dirname, "windows.js"), "utf8");

test("service settings load before Python starts", () => {
  const readIndex = main.indexOf("await readServiceSettings(");
  const environmentIndex = main.indexOf("Object.assign(process.env, toServiceEnvironment(");
  const startIndex = main.indexOf("await startPythonService()");
  assert.ok(readIndex > 0);
  assert.ok(environmentIndex > readIndex);
  assert.ok(startIndex > environmentIndex);
});

test("application settings IPC validates the live main renderer", () => {
  assert.match(main, /ownsMainWindowSender\(event\.sender\)/);
  assert.match(main, /ipcMain\.handle\("app:get-settings"/);
  assert.match(main, /ipcMain\.handle\("app:save-settings"/);
  assert.match(windows, /function ownsMainWindowSender\(sender\)/);
});

test("menu IPC remains owned by the preference controller", () => {
  assert.match(main, /appPreferences\?\.ownsSender\(event\.sender\)/);
  assert.doesNotMatch(main, /let macMenuBar;/);
  assert.match(main, /appPreferences\?\.destroy\(\)/);
});

test("service secrets are projected before returning", () => {
  assert.match(main, /publicServiceSettings\(/);
  assert.doesNotMatch(main, /return\s+storedServiceSettings\s*;/);
});
~~~

- [ ] **Step 2: Confirm integration tests fail**

Run node --test src/main/integrationSecurity.test.js.

Expected: FAIL because settings and controller wiring are absent.

- [ ] **Step 3: Import and initialize settings before the backend**

Add safeStorage to the Electron import. Import appSettings, appPreferencesController, serviceSettings, and ownsMainWindowSender. Replace let macMenuBar with:

~~~js
let appPreferences;
let storedServiceSettings;
const externalServiceEnvironment = { ...process.env };
~~~

At the start of the ready callback, before startPythonService, add:

~~~js
const userDataPath = app.getPath("userData");
storedServiceSettings = await readServiceSettings(userDataPath, safeStorage);
const effectiveAtStartup = resolveServiceSettings(
  storedServiceSettings,
  externalServiceEnvironment
);
Object.assign(process.env, toServiceEnvironment(effectiveAtStartup));
~~~

- [ ] **Step 4: Construct the preference controller**

Keep const policy = startupPolicy() immediately after createMainWindow(initialTheme), then add:

~~~js
const initialAppSettings = await readAppSettings(userDataPath);
appPreferences = createAppPreferencesController({
  platform: policy.createMacMenuBar ? "darwin" : process.platform,
  initialSettings: initialAppSettings,
  createMenuBar: () => createMacMenuBar({
    BrowserWindow,
    Menu,
    Tray,
    nativeImage,
    screen,
    preloadPath: path.join(__dirname, "..", "preload", "menuBarPreload.js"),
    rendererPath: path.join(__dirname, "..", "renderer", "menubar.html"),
    iconPath: path.join(__dirname, "..", "..", "assets", "icon-transparent.png"),
    actions: { showMainWindow, quit: quitApplication }
  }),
  applyLoginItem: (enabled) => applyLoginItemSetting(app, enabled),
  showMainWindow,
  reportError: (error) => console.error(
    "Failed to create macOS menu bar:",
    error.message
  )
});
appPreferences.apply(initialAppSettings);
~~~

Delete the old direct macMenuBar construction block.

- [ ] **Step 5: Register sender-validated application IPC**

Add:

~~~js
ipcMain.handle("app:get-settings", (event) => {
  if (!ownsMainWindowSender(event.sender)) {
    throw new Error("Unauthorized settings sender");
  }
  return appPreferences.getSettings();
});

ipcMain.handle("app:save-settings", async (event, payload) => {
  if (!ownsMainWindowSender(event.sender)) {
    throw new Error("Unauthorized settings sender");
  }
  const settings = await writeAppSettings(userDataPath, {
    ...appPreferences.getSettings(),
    ...payload
  });
  return appPreferences.apply(settings);
});
~~~

Route both menubar IPC handlers through appPreferences.ownsSender, setTemperature, and hide.

- [ ] **Step 6: Replace service setting reads and writes**

Inside the ready callback add:

~~~js
function effectiveSettings() {
  return resolveServiceSettings(
    storedServiceSettings,
    externalServiceEnvironment
  );
}

async function persistServicePatch(patch) {
  storedServiceSettings = await writeServiceSettings(
    userDataPath,
    { ...storedServiceSettings, ...patch },
    safeStorage
  );
  Object.assign(process.env, toServiceEnvironment(effectiveSettings()));
  return publicServiceSettings(effectiveSettings());
}
~~~

Replace the weather settings handlers with:

~~~js
ipcMain.handle("weather:get-settings", () => {
  const settings = publicServiceSettings(effectiveSettings());
  return {
    hasApiKey: settings.hasQWeatherApiKey,
    apiHost: settings.qweatherApiHost,
    projectId: settings.qweatherProjectId,
    credentialId: settings.qweatherCredentialId,
    hasPrivateKey: settings.hasQWeatherPrivateKey
  };
});

ipcMain.handle("weather:save-settings", async (_event, settings) => {
  const apiHost = typeof settings?.apiHost === "string"
    ? settings.apiHost.trim()
    : "";
  if (!apiHost || !/^[a-z0-9.-]+$/i.test(apiHost)) {
    throw new Error("API Host 格式无效");
  }
  const patch = {
    qweatherApiHost: apiHost,
    qweatherProjectId: typeof settings?.projectId === "string"
      ? settings.projectId.trim()
      : "",
    qweatherCredentialId: typeof settings?.credentialId === "string"
      ? settings.credentialId.trim()
      : ""
  };
  if (typeof settings?.apiKey === "string" && settings.apiKey.trim()) {
    patch.qweatherApiKey = settings.apiKey.trim();
  }
  if (typeof settings?.privateKey === "string" && settings.privateKey.trim()) {
    patch.qweatherPrivateKey = settings.privateKey.trim();
  }
  const saved = await persistServicePatch(patch);
  return {
    hasApiKey: saved.hasQWeatherApiKey,
    apiHost: saved.qweatherApiHost,
    projectId: saved.qweatherProjectId,
    credentialId: saved.qweatherCredentialId,
    hasPrivateKey: saved.hasQWeatherPrivateKey
  };
});
~~~

Replace the DeepSeek settings and usage handlers with:

~~~js
ipcMain.handle("deepseek:get-settings", () => {
  const settings = publicServiceSettings(effectiveSettings());
  return {
    hasApiKey: settings.hasDeepSeekApiKey,
    baseUrl: settings.deepseekBaseUrl
  };
});

ipcMain.handle("deepseek:save-settings", async (_event, settings) => {
  const baseUrl = normalizeDeepSeekBaseUrl(
    settings?.baseUrl || DEEPSEEK_DEFAULT_BASE_URL
  );
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("DeepSeek Base URL 格式无效");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error("DeepSeek Base URL 必须是 HTTPS 地址");
  }
  const patch = { deepseekBaseUrl: baseUrl };
  if (typeof settings?.apiKey === "string" && settings.apiKey.trim()) {
    patch.deepseekApiKey = settings.apiKey.trim();
  }
  const saved = await persistServicePatch(patch);
  return {
    hasApiKey: saved.hasDeepSeekApiKey,
    baseUrl: saved.deepseekBaseUrl
  };
});

ipcMain.handle("deepseek:usage", (_event, options) => {
  const settings = effectiveSettings();
  return readDeepSeekUsage({
    ...options,
    apiKey: settings.deepseekApiKey,
    baseUrl: settings.deepseekBaseUrl
  });
});
~~~

- [ ] **Step 7: Use controller teardown and verify**

Replace old menu teardown with:

~~~js
appPreferences?.destroy();
appPreferences = null;
~~~

Register the integration test, then run:

~~~bash
node --test src/main/integrationSecurity.test.js
npm run check
npm run backend:test
git diff --check
~~~

Expected: all pass.

- [ ] **Step 8: Commit main integration**

~~~bash
git add package.json src/main/main.js src/main/windows.js src/main/integrationSecurity.test.js
git commit -m "feat: integrate dual-platform settings lifecycle"
~~~

### Task 6: Native macOS renderer and preferences

**Files:**
- Modify: src/preload/preload.js
- Modify: src/renderer/app.js
- Modify: src/renderer/styles.css
- Modify: src/renderer/security.test.js

- [ ] **Step 1: Add failing static renderer assertions**

Append:

~~~js
test("main preload exposes bounded platform preferences", () => {
  const preload = fs.readFileSync(path.join(__dirname, "..", "preload", "preload.js"), "utf8");
  assert.match(preload, /platform:\s*\["darwin",\s*"win32"\]\.includes\(process\.platform\)/);
  assert.match(preload, /getAppSettings/);
  assert.match(preload, /saveAppSettings/);
  assert.doesNotMatch(preload, /desktopCapsule|menuBarDisplay/);
});

test("main renderer branches native chrome without a macOS capsule", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  assert.match(renderer, /const isMac = window\.winplate\.platform === "darwin"/);
  assert.match(renderer, /menuBarEnabled/);
  assert.match(renderer, /launchAtLogin/);
  assert.doesNotMatch(
    renderer,
    /desktopCapsuleEnabled|desktopCapsulePinned|menuBarDisplay|renderMacFloating/
  );
  assert.match(renderer, /querySelector\("#window-minimize"\)\?\./);
  assert.match(renderer, /querySelector\("#window-close"\)\?\./);
});

test("macOS layout reserves traffic-light space", () => {
  const css = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
  assert.match(css, /\.main-body\.platform-darwin \.workspace/);
  assert.match(css, /padding-top:\s*52px/);
  assert.doesNotMatch(css, /mac-floating-shell|mac-floating-metric/);
});
~~~

- [ ] **Step 2: Confirm the new assertions fail**

Run node --test src/renderer/security.test.js.

Expected: the three new tests fail.

- [ ] **Step 3: Expose the bounded preload surface**

Add:

~~~js
platform: ["darwin", "win32"].includes(process.platform)
  ? process.platform
  : "unsupported",
getAppSettings: () => ipcRenderer.invoke("app:get-settings"),
saveAppSettings: (settings) => ipcRenderer.invoke("app:save-settings", settings),
~~~

- [ ] **Step 4: Add application settings state and controls**

Add to app.js:

~~~js
const isMac = window.winplate.platform === "darwin";
let applicationSettings = {
  menuBarEnabled: true,
  launchAtLogin: false
};

async function hydrateAppSettings() {
  if (!isMac) return;
  try {
    applicationSettings = {
      ...applicationSettings,
      ...await window.winplate.getAppSettings()
    };
  } catch (error) {
    console.error("Failed to load application settings:", error.message);
  }
}

function macPlatformSettings() {
  if (!isMac) return "";
  return [
    '<section class="settings-section"><h2>macOS</h2>',
    '<div class="settings-panel mac-platform-panel">',
    '<label class="mac-platform-setting"><span><strong>Menu bar status</strong>',
    '<small>Show WinPlate in the macOS menu bar.</small></span>',
    '<input type="checkbox" data-app-setting="menuBarEnabled" ' +
      (applicationSettings.menuBarEnabled ? "checked" : "") + '></label>',
    '<label class="mac-platform-setting"><span><strong>Launch at login</strong>',
    '<small>Start WinPlate when you sign in.</small></span>',
    '<input type="checkbox" data-app-setting="launchAtLogin" ' +
      (applicationSettings.launchAtLogin ? "checked" : "") + '></label>',
    "</div></section>"
  ].join("");
}

function bindAppSettings() {
  document.querySelectorAll("[data-app-setting]").forEach((input) => {
    input.addEventListener("change", async () => {
      const previous = applicationSettings[input.dataset.appSetting];
      input.disabled = true;
      try {
        applicationSettings = await window.winplate.saveAppSettings({
          ...applicationSettings,
          [input.dataset.appSetting]: input.checked
        });
      } catch (error) {
        input.checked = previous;
        console.error("Failed to save application settings:", error.message);
      } finally {
        input.disabled = false;
      }
    });
  });
}
~~~

Insert macPlatformSettings() in Settings, bind after every Settings render, and hydrate it in the initial Promise.all.

- [ ] **Step 5: Branch native chrome and controls**

Set the body class and define the title bar in renderMain:

~~~js
document.body.className = "main-body platform-" + (isMac ? "darwin" : "win32");
const titlebar = isMac ? "" : [
  '<header class="app-titlebar">',
  '<div class="titlebar-brand"><img src="../../assets/icon.png" alt="">',
  '<span>WinPlate</span></div>',
  '<div class="window-controls">',
  '<button id="window-minimize" aria-label="最小化"><span></span></button>',
  '<button id="window-maximize" aria-label="最大化"><span></span></button>',
  '<button id="window-close" class="close" aria-label="关闭"><span></span></button>',
  "</div></header>"
].join("");
~~~

Interpolate titlebar immediately inside main-window-shell. Bind controls with:

~~~js
document.querySelector("#window-minimize")?.addEventListener(
  "click",
  () => window.winplate.minimizeWindow()
);
document.querySelector("#window-maximize")?.addEventListener("click", async () => {
  mainWindowMaximized = await window.winplate.toggleMaximizeWindow();
  updateMaximizeButton();
});
document.querySelector("#window-close")?.addEventListener(
  "click",
  () => window.winplate.closeWindow()
);
~~~

- [ ] **Step 6: Add native macOS styles**

Append:

~~~css
.main-body.platform-darwin .main-window-shell {
  grid-template-rows: minmax(0, 1fr);
  background: transparent;
}

.main-body.platform-darwin .workspace {
  padding-top: 52px;
  background-color: color-mix(in srgb, var(--main-bg) 82%, transparent);
}

.main-body.platform-darwin .sidebar {
  padding-top: 12px;
  backdrop-filter: blur(28px);
}

.mac-platform-panel > label { display: flex; }

.mac-platform-setting {
  min-height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
}

.mac-platform-setting:last-child { border-bottom: 0; }
.mac-platform-setting > span { display: grid; gap: 4px; }
.mac-platform-setting input { accent-color: #8b5cf6; }
~~~

- [ ] **Step 7: Verify and commit**

~~~bash
node --check src/preload/preload.js
node --check src/renderer/app.js
node --test src/renderer/security.test.js
npm run check
git diff --check
git add src/preload/preload.js src/renderer/app.js src/renderer/styles.css src/renderer/security.test.js
git commit -m "feat: adapt the main window for macOS"
~~~

Expected: all pass and prohibited macOS capsule identifiers are absent.

### Task 7: Dual-platform CI and documentation

**Files:**
- Create: .github/workflows/test.yml
- Modify: README.md

- [ ] **Step 1: Verify the existing virtualenv resolver**

Run node --test scripts/venvPython.test.js.

Expected: Windows and POSIX virtualenv tests pass.

- [ ] **Step 2: Create CI**

Create .github/workflows/test.yml:

~~~yaml
name: test

on:
  push:
  pull_request:

permissions:
  contents: read

jobs:
  test:
    strategy:
      fail-fast: false
      matrix:
        os: [macos-latest, windows-latest]
    runs-on: \${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: npm ci
      - run: npm run venv:create
      - run: npm run backend:install
      - run: npm run check
      - run: npm run backend:test
~~~

- [ ] **Step 3: Document behavior and verification**

Add:

~~~~markdown
## Platform behavior

- Windows starts with the 460 × 104 capsule and Windows Tray.
- macOS starts from one menu bar item and never creates a desktop capsule.
- macOS Settings can disable the menu item or enable launch at login.
- QWeather and DeepSeek secrets are encrypted by Electron safeStorage.
- Process environment values override stored values on both platforms.
- Restart after changing QWeather credentials because FastAPI receives them at startup.

## Verification

~~~sh
npm run check
npm run backend:test
git diff --check
~~~

GitHub Actions runs both suites on macOS and Windows.
~~~~

- [ ] **Step 4: Run repository checks and commit**

~~~bash
npm run check
npm run backend:test
git diff --check
git add .github/workflows/test.yml README.md
git commit -m "ci: verify WinPlate on Windows and macOS"
~~~

Expected: every command exits 0.

### Task 8: Runtime evidence and completion audit

**Files:**
- Create: docs/verification/dual-platform-smoke.md
- Modify: design-qa.md
- Add: docs/qa runtime screenshots

- [ ] **Step 1: Run the automated baseline**

~~~bash
npm run check
npm run backend:test
git diff --check
git status --short
~~~

Expected: suites pass and status is clean before evidence.

- [ ] **Step 2: Verify macOS directly**

Start npm run dev. Record every result:

~~~markdown
- [ ] One icon plus temperature appears in the menu bar.
- [ ] Left click toggles the 320 × 420 panel.
- [ ] Right click exposes Open, Settings, Refresh, and Quit.
- [ ] Blur and Escape hide the panel.
- [ ] Refresh updates in place; partial/offline states retain actions.
- [ ] Main window is 1040 × 720 with native traffic lights.
- [ ] Close hides it and Dock activation reopens it.
- [ ] Menu enable/disable is immediate and idempotent.
- [ ] Launch at login persists after restart.
- [ ] Service settings persist and secrets return only flags.
- [ ] Light/dark themes remain legible and keyboard focus is visible.
- [ ] No desktop capsule or capsule setting exists.
~~~

Capture the menu item, panel, native main window, and Settings screen under docs/qa. Add filenames, macOS version, date, and observations to dual-platform-smoke.md.

- [ ] **Step 3: Verify Windows directly**

On Windows follow README setup and record:

~~~markdown
- [ ] Startup shows the 460 × 104 capsule and Windows Tray.
- [ ] Tray menu shows Open, Show Floating, Hide Floating, and Quit.
- [ ] Tray double click opens the main window.
- [ ] Main window is 1080 × 720 with frameless controls.
- [ ] Close hides the main window without ending the process.
- [ ] Pin and click-through work.
- [ ] Tooltips stay inside the active work area.
- [ ] Settings persist without exposing secret text.
- [ ] Restart retains settings and capsule startup.
- [ ] Partial/offline states retain navigation and Quit.
~~~

Add Windows version, machine identifier, date, tester, results, and screenshots to dual-platform-smoke.md. Do not mark an unobserved item passed.

- [ ] **Step 4: Inspect CI evidence**

After push, record the Actions run URL and separate macos-latest and windows-latest job results. Local policy tests do not replace CI jobs.

- [ ] **Step 5: Audit every completion criterion**

In dual-platform-smoke.md create a table with Requirement, Evidence, and Result. Compare every bullet from docs/superpowers/specs/2026-06-30-dual-platform-completion-design.md. Use only pass or incomplete, and attach direct evidence to each pass.

- [ ] **Step 6: Update visual QA and run final verification**

~~~bash
npm run check
npm run backend:test
git diff --check
rg -n "desktopCapsule|menuBarDisplay|renderMacFloating|mac-floating" src docs/verification README.md
git status --short
~~~

Expected: tests pass; prohibited identifiers have no matches; only intended QA files remain.

- [ ] **Step 7: Commit evidence**

~~~bash
git add design-qa.md docs/qa docs/verification/dual-platform-smoke.md
git commit -m "docs: verify the dual-platform application"
~~~

- [ ] **Step 8: Apply the completion gate**

Run:

~~~bash
git status --short
git log -8 --oneline
~~~

Expected: clean worktree and one task-aligned commit per implementation boundary. Mark the goal complete only when every completion row is pass; otherwise report the exact incomplete evidence and keep the goal active.
