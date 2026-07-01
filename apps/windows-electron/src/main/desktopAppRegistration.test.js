const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  WINPLATE_APP_USER_MODEL_ID,
  WINPLATE_SHORTCUT_NAME,
  registerWindowsDesktopApp,
  resolveShortcutDetails,
  resolveStartMenuProgramsDir,
  shouldUseAppPathArgument
} = require("./desktopAppRegistration");

function createAppDouble(overrides = {}) {
  const calls = [];
  const app = {
    isPackaged: true,
    getPath(name) {
      if (name === "appData") return "C:\\Users\\kiko\\AppData\\Roaming";
      if (name === "exe") return "C:\\Apps\\WinPlate\\WinPlate.exe";
      return "";
    },
    getAppPath() {
      return "C:\\Apps\\WinPlate\\resources\\app.asar";
    },
    setAppUserModelId(value) {
      calls.push(value);
    },
    ...overrides
  };
  return { app, calls };
}

test("resolveShortcutDetails uses packaged executable without dev args", () => {
  const { app } = createAppDouble();
  const details = resolveShortcutDetails(app, { iconPath: "C:\\icons\\winplate.ico" });
  assert.equal(details.target, "C:\\Apps\\WinPlate\\WinPlate.exe");
  assert.equal(details.args, "");
  assert.equal(details.cwd, "C:\\Apps\\WinPlate");
  assert.equal(details.icon, "C:\\icons\\winplate.ico");
  assert.equal(details.appUserModelId, WINPLATE_APP_USER_MODEL_ID);
});

test("resolveShortcutDetails adds app path while running through Electron in development", () => {
  const { app } = createAppDouble({
    isPackaged: false,
    getPath(name) {
      if (name === "appData") return "C:\\Users\\kiko\\AppData\\Roaming";
      if (name === "exe") return "C:\\Program Files\\Electron\\electron.exe";
      return "";
    },
    getAppPath() {
      return "C:\\Users\\kiko\\Documents\\winPlate";
    }
  });
  const details = resolveShortcutDetails(app, {
    iconPath: "C:\\icons\\winplate.ico",
    processObject: { defaultApp: true, execPath: "C:\\Program Files\\Electron\\electron.exe" }
  });
  assert.equal(details.target, "C:\\Program Files\\Electron\\electron.exe");
  assert.equal(details.args, "\"C:\\Users\\kiko\\Documents\\winPlate\"");
  assert.equal(details.cwd, "C:\\Users\\kiko\\Documents\\winPlate");
});

test("registerWindowsDesktopApp skips non-Windows platforms", async () => {
  const { app, calls } = createAppDouble();
  const result = await registerWindowsDesktopApp({
    app,
    shell: { writeShortcutLink() { throw new Error("should not be called"); } },
    platform: "linux"
  });
  assert.deepEqual(result, { registered: false, reason: "unsupported-platform" });
  assert.equal(calls.length, 0);
});

test("registerWindowsDesktopApp creates or updates the WinPlate Start menu shortcut", async () => {
  const { app, calls } = createAppDouble();
  const mkdirCalls = [];
  const accessCalls = [];
  let shortcutCall = null;
  const result = await registerWindowsDesktopApp({
    app,
    shell: {
      writeShortcutLink(shortcutPath, operation, details) {
        shortcutCall = { shortcutPath, operation, details };
        return true;
      }
    },
    iconPath: "C:\\icons\\winplate.ico",
    fsModule: {
      async mkdir(target, options) {
        mkdirCalls.push({ target, options });
      },
      async access(target) {
        accessCalls.push(target);
      }
    },
    platform: "win32"
  });

  const expectedStartMenuDir = resolveStartMenuProgramsDir("C:\\Users\\kiko\\AppData\\Roaming");
  const expectedShortcutPath = path.join(expectedStartMenuDir, WINPLATE_SHORTCUT_NAME);

  assert.deepEqual(calls, [WINPLATE_APP_USER_MODEL_ID]);
  assert.deepEqual(mkdirCalls, [{ target: expectedStartMenuDir, options: { recursive: true } }]);
  assert.deepEqual(accessCalls, [expectedShortcutPath]);
  assert.equal(shortcutCall.shortcutPath, expectedShortcutPath);
  assert.equal(shortcutCall.operation, "update");
  assert.equal(shortcutCall.details.icon, "C:\\icons\\winplate.ico");
  assert.equal(result.shortcutPath, expectedShortcutPath);
  assert.equal(result.registered, true);
});

test("shouldUseAppPathArgument only stays enabled for development launches", () => {
  assert.equal(shouldUseAppPathArgument({ isPackaged: true }, { defaultApp: false }), false);
  assert.equal(shouldUseAppPathArgument({ isPackaged: false }, { defaultApp: false }), true);
  assert.equal(shouldUseAppPathArgument({ isPackaged: true }, { defaultApp: true }), true);
});
