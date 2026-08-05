const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const Module = require("node:module");
const test = require("node:test");

let fakeCursorPoint = { x: -1, y: -1 };

class FakeWebContents extends EventEmitter {
  constructor() {
    super();
    this.sent = [];
  }

  isDestroyed() { return false; }
  isLoading() { return false; }
  send(channel, payload) { this.sent.push({ channel, payload }); }
}

class FakeBrowserWindow extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.webContents = new FakeWebContents();
    this.backgroundColors = [];
    this.moveTopCalls = 0;
    this.ignoreMouseEvents = [];
    this.bounds = { x: 0, y: 0, width: options.width, height: options.height };
  }

  isDestroyed() { return false; }
  loadFile() {}
  setBackgroundColor(color) { this.backgroundColors.push(color); }
  show() {}
  focus() {}
  hide() {}
  setPosition(x, y) { this.bounds = { ...this.bounds, x, y }; }
  setBounds(bounds) { this.bounds = { ...this.bounds, ...bounds }; }
  getBounds() { return { ...this.bounds }; }
  setAlwaysOnTop() {}
  moveTop() { this.moveTopCalls += 1; }
  setIgnoreMouseEvents(ignore, options) { this.ignoreMouseEvents.push({ ignore, options }); }
}

function loadWindows() {
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === "electron") {
      return {
        BrowserWindow: FakeBrowserWindow,
        screen: {
          getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
          getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
          getCursorScreenPoint: () => ({ ...fakeCursorPoint })
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

test("showing the main window requests a full renderer refresh", () => {
  const windows = loadWindows();
  const window = windows.createMainWindow("dark");

  windows.showMainWindow("GitHub");

  assert.deepEqual(window.webContents.sent, [
    { channel: "main:navigate", payload: "GitHub" },
    { channel: "status:refresh", payload: null }
  ]);
});

test("floating window is keyboard-inert, resists accidental close, docks, and restores its capsule bounds", async () => {
  const windows = loadWindows();
  const window = windows.createFloatingWindow();
  assert.equal(window.options.focusable, false);
  let closePrevented = false;
  window.emit("close", { preventDefault() { closePrevented = true; } });
  assert.equal(closePrevented, true);

  window.setBounds({ x: 640, y: 4, width: 460, height: 104 });
  window.emit("move");
  await new Promise((resolve) => setTimeout(resolve, 120));

  assert.deepEqual(window.getBounds(), {
    x: 764,
    y: 0,
    width: 392,
    height: 44
  });
  assert.deepEqual(window.webContents.sent.at(-1), {
    channel: "floating:dock-state",
    payload: { docked: true }
  });
  assert.ok(window.moveTopCalls > 0);
  assert.deepEqual(window.ignoreMouseEvents.at(-1), {
    ignore: true,
    options: { forward: true }
  });

  fakeCursorPoint = { x: 1130, y: 29 };
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.deepEqual(window.ignoreMouseEvents.at(-1), {
    ignore: false,
    options: { forward: true }
  });

  fakeCursorPoint = { x: 800, y: 29 };
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.deepEqual(window.ignoreMouseEvents.at(-1), {
    ignore: true,
    options: { forward: true }
  });

  assert.equal(windows.restoreFloatingCapsule(), false);
  assert.deepEqual(window.getBounds(), {
    x: 1428,
    y: 80,
    width: 460,
    height: 104
  });
  assert.deepEqual(window.webContents.sent.at(-1), {
    channel: "floating:dock-state",
    payload: { docked: false }
  });
  assert.deepEqual(window.ignoreMouseEvents.at(-1), {
    ignore: false,
    options: { forward: true }
  });
});
