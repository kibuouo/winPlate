const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

class FakeWebContents extends EventEmitter {
  constructor() {
    super();
    this.destroyed = false;
  }

  isDestroyed() {
    return this.destroyed;
  }
}

class FakeBrowserWindow extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.destroyed = false;
    this.webContents = new FakeWebContents();
    this.backgroundColors = [];
    this.loadedFiles = [];
  }

  isDestroyed() {
    return this.destroyed;
  }

  loadFile(filePath, options) {
    this.loadedFiles.push([filePath, options]);
  }

  setBackgroundColor(color) {
    this.backgroundColors.push(color);
  }
}

function loadWindowsModule() {
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === "electron") {
      return {
        BrowserWindow: FakeBrowserWindow,
        screen: {}
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

const windows = loadWindowsModule();
const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");

function withPlatform(platform, callback) {
  Object.defineProperty(process, "platform", {
    ...platformDescriptor,
    value: platform
  });

  try {
    callback();
  } finally {
    Object.defineProperty(process, "platform", platformDescriptor);
  }
}

function closeWindow(window) {
  window.emit("closed");
}

test("owns only the exact live main-window sender", () => {
  withPlatform("darwin", () => {
    const window = windows.createMainWindow();
    const sender = window.webContents;

    assert.equal(windows.ownsMainWindowSender(sender), true);
    assert.equal(windows.ownsMainWindowSender(new FakeWebContents()), false);

    sender.destroyed = true;
    assert.equal(windows.ownsMainWindowSender(sender), false);

    sender.destroyed = false;
    window.destroyed = true;
    assert.equal(windows.ownsMainWindowSender(sender), false);

    closeWindow(window);
  });
});

test("updates Windows main-window background colors with the theme", () => {
  withPlatform("win32", () => {
    const window = windows.createMainWindow("dark");

    assert.equal(window.options.backgroundColor, "#181818");
    windows.setMainWindowTheme("light");
    windows.setMainWindowTheme("dark");
    assert.deepEqual(window.backgroundColors, ["#f7f7f8", "#181818"]);

    closeWindow(window);
  });
});

test("preserves the transparent macOS main-window background across theme changes", () => {
  withPlatform("darwin", () => {
    const window = windows.createMainWindow("dark");

    assert.equal(window.options.backgroundColor, "#00000000");
    windows.setMainWindowTheme("light");
    windows.setMainWindowTheme("dark");
    assert.deepEqual(window.backgroundColors, []);

    closeWindow(window);
  });
});

test("createMainWindow consumes the native macOS policy with secure preferences", () => {
  withPlatform("darwin", () => {
    const window = windows.createMainWindow();

    assert.equal(window.options.frame, true);
    assert.equal(window.options.titleBarStyle, "hiddenInset");
    assert.deepEqual(window.options.trafficLightPosition, { x: 16, y: 16 });
    assert.equal(window.options.transparent, true);
    assert.deepEqual(window.options.webPreferences, {
      preload: path.join(__dirname, "..", "preload", "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    });
    assert.deepEqual(window.loadedFiles[0][1], { query: { view: "main" } });

    closeWindow(window);
  });
});
