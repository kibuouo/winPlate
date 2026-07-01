const assert = require("node:assert/strict");
const test = require("node:test");

const { getMainWindowOptions } = require("./windowPolicy");

const webPreferences = Object.freeze({
  preload: "/tmp/preload.js",
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true
});

for (const [dark, backgroundColor] of [
  [true, "#202123"],
  [false, "#ffffff"]
]) {
  test(`returns the Windows main-window policy for ${dark ? "dark" : "light"} mode`, () => {
    const options = getMainWindowOptions("win32", {
      icon: "/tmp/icon.ico",
      dark,
      webPreferences
    });

    assert.deepEqual(options, {
      width: 1080,
      height: 720,
      minWidth: 860,
      minHeight: 560,
      show: false,
      backgroundColor,
      title: "WinPlate",
      icon: "/tmp/icon.ico",
      autoHideMenuBar: true,
      frame: false,
      webPreferences
    });
    assert.equal(options.webPreferences, webPreferences);
  });
}

test("returns the native macOS main-window policy", () => {
  const options = getMainWindowOptions("darwin", {
    icon: "/tmp/icon.ico",
    dark: true,
    webPreferences
  });

  assert.deepEqual(options, {
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
  assert.equal(options.webPreferences, webPreferences);
});

test("rejects unsupported main-window platforms", () => {
  assert.throws(
    () => getMainWindowOptions("linux", {
      icon: "/tmp/icon.ico",
      dark: true,
      webPreferences
    }),
    new Error("Unsupported platform: linux")
  );
});
