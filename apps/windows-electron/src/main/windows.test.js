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

  isLoading() { return false; }
  send() {}
}

class FakeBrowserWindow extends EventEmitter {
  static instances = [];

  constructor(options) {
    super();
    this.options = options;
    this.destroyed = false;
    this.webContents = new FakeWebContents();
    this.backgroundColors = [];
    this.loadedFiles = [];
    this.shown = 0;
    this.focused = 0;
    this.hidden = 0;
    this.positions = [];
    this.bounds = [];
    FakeBrowserWindow.instances.push(this);
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

  show() { this.shown += 1; }
  showInactive() { this.shown += 1; }
  focus() { this.focused += 1; }
  hide() { this.hidden += 1; }
  setPosition(...position) { this.positions.push(position); }
  setBounds(bounds) { this.bounds.push(bounds); }
  setAlwaysOnTop() {}
  setIgnoreMouseEvents() {}
}

function loadWindowsModule() {
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

    assert.equal(window.options.backgroundColor, "#202123");
    windows.setMainWindowTheme("light");
    windows.setMainWindowTheme("dark");
    assert.deepEqual(window.backgroundColors, ["#ffffff", "#202123"]);

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

test("createMainWindow reuses a live window without loading or binding twice", () => {
  withPlatform("darwin", () => {
    const first = windows.createMainWindow();
    const second = windows.createMainWindow();

    assert.equal(second, first);
    assert.equal(first.loadedFiles.length, 1);
    assert.equal(first.listenerCount("ready-to-show"), 1);
    assert.equal(first.listenerCount("close"), 1);
    closeWindow(first);
  });
});

test("createMainWindow replaces a destroyed window and applies a reused Windows theme", () => {
  withPlatform("win32", () => {
    const first = windows.createMainWindow("dark");
    first.destroyed = true;
    const replacement = windows.createMainWindow("dark");
    const reused = windows.createMainWindow("light");

    assert.notEqual(replacement, first);
    assert.equal(reused, replacement);
    assert.deepEqual(replacement.backgroundColors, ["#ffffff"]);
    closeWindow(replacement);
  });
});

test("floating and tooltip creation reuse live windows and replace destroyed windows", () => {
  withPlatform("win32", () => {
    const floating = windows.createFloatingWindow();
    assert.equal(windows.createFloatingWindow(), floating);
    assert.equal(floating.loadedFiles.length, 1);
    floating.destroyed = true;
    const floatingReplacement = windows.createFloatingWindow();
    assert.notEqual(floatingReplacement, floating);

    const tooltip = windows.createTooltipWindow();
    assert.equal(windows.createTooltipWindow(), tooltip);
    assert.equal(tooltip.loadedFiles.length, 1);
    tooltip.destroyed = true;
    const tooltipReplacement = windows.createTooltipWindow();
    assert.notEqual(tooltipReplacement, tooltip);

    closeWindow(floatingReplacement);
    closeWindow(tooltipReplacement);
  });
});

test("showMainWindow normalizes Electron metadata and preserves allowed sections", () => {
  withPlatform("darwin", () => {
    const window = windows.createMainWindow();
    window.webContents.isLoading = () => false;
    window.webContents.send = (...args) => window.webContents.emit("sent", args);
    const sent = [];
    window.webContents.on("sent", (args) => sent.push(args));

    windows.showMainWindow({ type: "activate" });
    windows.showMainWindow("");
    windows.showMainWindow("Unknown");
    windows.showMainWindow("Settings");

    assert.deepEqual(sent, [
      ["main:navigate", "Dashboard"],
      ["main:navigate", "Dashboard"],
      ["main:navigate", "Dashboard"],
      ["main:navigate", "Settings"]
    ]);
    closeWindow(window);
  });
});

test("stale main-window callbacks cannot act on a replacement", () => {
  withPlatform("darwin", () => {
    const first = windows.createMainWindow();
    first.__showWhenReady = true;
    first.destroyed = true;
    const replacement = windows.createMainWindow();

    first.emit("ready-to-show");
    first.emit("close", { preventDefault() {} });

    assert.equal(replacement.shown, 0);
    assert.equal(replacement.hidden, 0);
    closeWindow(replacement);
  });
});

test("showFloatingWindow replaces a destroyed floating window", () => {
  withPlatform("win32", () => {
    const first = windows.createFloatingWindow();
    first.destroyed = true;
    windows.showFloatingWindow();
    const replacement = windows.createFloatingWindow();

    assert.notEqual(replacement, first);
    closeWindow(replacement);
  });
});

test("showTooltipWindow replaces a destroyed tooltip window", () => {
  withPlatform("win32", () => {
    const first = windows.createTooltipWindow();
    first.destroyed = true;
    const countBeforeShow = FakeBrowserWindow.instances.length;

    windows.showTooltipWindow({
      anchor: { x: 10, y: 10, width: 20, height: 20 },
      data: { type: "system" }
    });

    assert.equal(FakeBrowserWindow.instances.length, countBeforeShow + 1);
    const replacement = windows.createTooltipWindow();
    assert.notEqual(replacement, first);
    closeWindow(replacement);
  });
});
