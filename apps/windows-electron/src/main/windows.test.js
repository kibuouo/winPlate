const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const Module = require("node:module");
const test = require("node:test");

class FakeWebContents extends EventEmitter {
  isDestroyed() { return false; }
  isLoading() { return false; }
  send() {}
}

class FakeBrowserWindow extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.webContents = new FakeWebContents();
    this.backgroundColors = [];
  }

  isDestroyed() { return false; }
  loadFile() {}
  setBackgroundColor(color) { this.backgroundColors.push(color); }
  show() {}
  focus() {}
  hide() {}
  setPosition() {}
  setBounds() {}
  setAlwaysOnTop() {}
  setIgnoreMouseEvents() {}
}

function loadWindows() {
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === "electron") {
      return {
        BrowserWindow: FakeBrowserWindow,
        screen: {
          getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
          getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } })
        }
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve("./windows")];
    return require("./windows");
  } finally {
    Module._load = originalLoad;
  }
}

test("Windows main window has the custom titlebar and secure preload", () => {
  const windows = loadWindows();
  const window = windows.createMainWindow("dark");
  assert.equal(window.options.frame, false);
  assert.equal(window.options.autoHideMenuBar, true);
  assert.equal(window.options.webPreferences.contextIsolation, true);
  assert.equal(window.options.webPreferences.sandbox, true);
  assert.equal(window.options.backgroundColor, "#202123");
});

test("Windows theme changes update the main window background", () => {
  const windows = loadWindows();
  windows.createMainWindow("dark");
  windows.setMainWindowTheme("light");
  windows.setMainWindowTheme("dark");
  const window = windows.createMainWindow();
  assert.deepEqual(window.backgroundColors, ["#ffffff", "#202123", "#202123"]);
});
