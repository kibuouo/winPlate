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
    const options = getMainWindowOptions({
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
