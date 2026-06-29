const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { createMacMenuBar } = require("./macMenuBar");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

async function settlePromises() {
  await Promise.resolve();
  await Promise.resolve();
}

class FakeImage extends EventEmitter {
  constructor(kind, calls) {
    super();
    this.kind = kind;
    this.calls = calls;
    this.template = false;
  }

  resize(size) {
    this.calls.resize.push(size);
    const resized = new FakeImage("resized", this.calls);
    this.calls.resizedImages.push(resized);
    return resized;
  }

  setTemplateImage(value) {
    this.template = value;
    this.calls.setTemplateImage.push(value);
  }
}

class FakeNativeImage extends EventEmitter {
  constructor(calls) {
    super();
    this.calls = calls;
  }

  createFromPath(filePath) {
    this.calls.createFromPath.push(filePath);
    const image = new FakeImage("source", this.calls);
    this.calls.sourceImages.push(image);
    return image;
  }
}

class FakeWebContents extends EventEmitter {
  constructor(isDestroyed) {
    super();
    this.isDestroyed = isDestroyed;
    this.sent = [];
  }

  send(channel, ...args) {
    if (this.isDestroyed()) {
      throw new Error("webContents is destroyed");
    }

    this.sent.push([channel, ...args]);
  }
}

class FakeBrowserWindow extends EventEmitter {
  static instances = [];
  static loadError = null;
  static loadPromise = Promise.resolve();

  constructor(options) {
    super();
    this.options = options;
    this.visible = false;
    this.destroyed = false;
    this.webContents = new FakeWebContents(() => this.destroyed);
    this.destroyCalls = 0;
    this.hideCalls = 0;
    this.showCalls = 0;
    this.focusCalls = 0;
    this.bounds = [];
    this.loadedFiles = [];
    FakeBrowserWindow.instances.push(this);
  }

  loadFile(filePath) {
    this.loadedFiles.push(filePath);
    if (FakeBrowserWindow.loadError) {
      throw FakeBrowserWindow.loadError;
    }

    return FakeBrowserWindow.loadPromise;
  }

  isVisible() {
    return this.visible;
  }

  isDestroyed() {
    return this.destroyed;
  }

  setBounds(bounds) {
    if (this.destroyed) {
      throw new Error("BrowserWindow is destroyed");
    }

    this.bounds.push(bounds);
  }

  show() {
    if (this.destroyed) {
      throw new Error("BrowserWindow is destroyed");
    }

    this.visible = true;
    this.showCalls += 1;
  }

  focus() {
    if (this.destroyed) {
      throw new Error("BrowserWindow is destroyed");
    }

    this.focusCalls += 1;
  }

  hide() {
    if (this.destroyed) {
      throw new Error("BrowserWindow is destroyed");
    }

    this.visible = false;
    this.hideCalls += 1;
  }

  destroy() {
    this.destroyed = true;
    this.destroyCalls += 1;
  }
}

class FakeTray extends EventEmitter {
  static instances = [];

  constructor(image) {
    super();
    this.image = image;
    this.tooltip = null;
    this.title = null;
    this.bounds = { x: 600, y: 0, width: 24, height: 24 };
    this.destroyed = false;
    this.destroyCalls = 0;
    this.ignoreDoubleClickEvents = null;
    this.poppedMenus = [];
    FakeTray.instances.push(this);
  }

  setToolTip(tooltip) {
    this.assertLive();
    this.tooltip = tooltip;
  }

  setTitle(title) {
    this.assertLive();
    this.title = title;
  }

  setIgnoreDoubleClickEvents(value) {
    this.assertLive();
    this.ignoreDoubleClickEvents = value;
  }

  getBounds() {
    this.assertLive();
    return this.bounds;
  }

  popUpContextMenu(menu) {
    this.assertLive();
    this.poppedMenus.push(menu);
  }

  removeListener(eventName, listener) {
    this.assertLive();
    return super.removeListener(eventName, listener);
  }

  assertLive() {
    if (this.destroyed) {
      throw new Error("Tray is destroyed");
    }
  }

  isDestroyed() {
    return this.destroyed;
  }

  destroy() {
    this.destroyed = true;
    this.destroyCalls += 1;
  }
}

class FakeMenu extends EventEmitter {
  constructor(template) {
    super();
    this.template = template;
  }
}

class FakeMenuApi extends EventEmitter {
  constructor(calls) {
    super();
    this.calls = calls;
  }

  buildFromTemplate(template) {
    this.calls.menuTemplates.push(template);
    const menu = new FakeMenu(template);
    this.calls.menus.push(menu);
    return menu;
  }
}

class FakeScreen extends EventEmitter {
  constructor(calls) {
    super();
    this.calls = calls;
  }

  getDisplayNearestPoint(point) {
    this.calls.displayPoints.push(point);
    return {
      workArea: { x: 0, y: 24, width: 1440, height: 876 }
    };
  }
}

function createDependencies({ loadError = null, loadPromise = Promise.resolve() } = {}) {
  FakeBrowserWindow.instances = [];
  FakeBrowserWindow.loadError = loadError;
  FakeBrowserWindow.loadPromise = loadPromise;
  FakeTray.instances = [];
  const calls = {
    createFromPath: [],
    resize: [],
    resizedImages: [],
    setTemplateImage: [],
    sourceImages: [],
    menuTemplates: [],
    menus: [],
    displayPoints: [],
    shownSections: [],
    quit: 0
  };
  const dependencies = {
    BrowserWindow: FakeBrowserWindow,
    Menu: new FakeMenuApi(calls),
    Tray: FakeTray,
    nativeImage: new FakeNativeImage(calls),
    screen: new FakeScreen(calls),
    preloadPath: "/app/preload.js",
    rendererPath: "/app/menu-bar.html",
    iconPath: "/app/menu-bar.png",
    actions: {
      showMainWindow(section) {
        calls.shownSections.push(section);
      },
      quit() {
        calls.quit += 1;
      }
    }
  };

  return { calls, dependencies };
}

function createFixture(options) {
  const { calls, dependencies } = createDependencies(options);

  const controller = createMacMenuBar(dependencies);

  return {
    calls,
    controller,
    panel: FakeBrowserWindow.instances[0],
    tray: FakeTray.instances[0]
  };
}

function constructorWithoutMethod(Base, method) {
  class MissingMethod extends Base {}
  Object.defineProperty(MissingMethod.prototype, method, {
    configurable: true,
    value: undefined
  });
  return MissingMethod;
}

test("rejects malformed dependencies before allocating native resources", () => {
  const invalidDependencies = [
    ["BrowserWindow", (dependencies) => { dependencies.BrowserWindow = null; }],
    ["Menu.buildFromTemplate", (dependencies) => { dependencies.Menu = {}; }],
    ["Tray", (dependencies) => { dependencies.Tray = null; }],
    ["nativeImage.createFromPath", (dependencies) => { dependencies.nativeImage = {}; }],
    ["screen.getDisplayNearestPoint", (dependencies) => { dependencies.screen = {}; }],
    ["actions.showMainWindow", (dependencies) => {
      dependencies.actions = { quit() {} };
    }],
    ["actions.quit", (dependencies) => {
      dependencies.actions = { showMainWindow() {} };
    }],
    ["preloadPath", (dependencies) => { dependencies.preloadPath = ""; }],
    ["rendererPath", (dependencies) => { dependencies.rendererPath = "   "; }],
    ["iconPath", (dependencies) => { dependencies.iconPath = null; }]
  ];

  for (const [name, makeInvalid] of invalidDependencies) {
    const { calls, dependencies } = createDependencies();
    makeInvalid(dependencies);

    assert.throws(() => createMacMenuBar(dependencies), TypeError, name);
    assert.equal(calls.createFromPath.length, 0, name);
    assert.equal(FakeTray.instances.length, 0, name);
    assert.equal(FakeBrowserWindow.instances.length, 0, name);
  }
});

test("rejects a missing dependency object before allocating native resources", () => {
  FakeTray.instances = [];
  FakeBrowserWindow.instances = [];

  assert.throws(() => createMacMenuBar(), TypeError);
  assert.equal(FakeTray.instances.length, 0);
  assert.equal(FakeBrowserWindow.instances.length, 0);
});

test("validates required native prototype methods before allocation", () => {
  const requiredMethods = [
    ["Tray", FakeTray, [
      "setToolTip",
      "setTitle",
      "setIgnoreDoubleClickEvents",
      "on",
      "removeListener",
      "getBounds",
      "popUpContextMenu",
      "destroy",
      "isDestroyed"
    ]],
    ["BrowserWindow", FakeBrowserWindow, [
      "loadFile",
      "on",
      "removeListener",
      "isVisible",
      "isDestroyed",
      "setBounds",
      "show",
      "focus",
      "hide",
      "destroy"
    ]]
  ];

  for (const [name, Constructor, methods] of requiredMethods) {
    for (const method of methods) {
      const { calls, dependencies } = createDependencies();
      dependencies[name] = constructorWithoutMethod(Constructor, method);

      assert.throws(
        () => createMacMenuBar(dependencies),
        { name: "TypeError", message: `${name}.prototype.${method} must be a function` }
      );
      assert.equal(calls.createFromPath.length, 0, `${name}.${method}`);
      assert.equal(FakeTray.instances.length, 0, `${name}.${method}`);
      assert.equal(FakeBrowserWindow.instances.length, 0, `${name}.${method}`);
    }
  }
});

test("validates returned native image methods before Tray allocation", () => {
  const invalidImages = [
    [
      {},
      "nativeImage.createFromPath result.resize must be a function"
    ],
    [
      { resize() { return {}; } },
      "nativeImage.resize result.setTemplateImage must be a function"
    ]
  ];

  for (const [image, message] of invalidImages) {
    const { dependencies } = createDependencies();
    dependencies.nativeImage.createFromPath = () => image;

    assert.throws(
      () => createMacMenuBar(dependencies),
      { name: "TypeError", message }
    );
    assert.equal(FakeTray.instances.length, 0, message);
    assert.equal(FakeBrowserWindow.instances.length, 0, message);
  }
});

test("rolls back the Tray when BrowserWindow construction throws", () => {
  const failure = new Error("BrowserWindow construction failed");
  class ThrowingBrowserWindow extends FakeBrowserWindow {
    constructor() {
      throw failure;
    }
  }
  const { dependencies } = createDependencies();
  dependencies.BrowserWindow = ThrowingBrowserWindow;

  assert.throws(
    () => createMacMenuBar(dependencies),
    (error) => error === failure
  );

  assert.equal(FakeTray.instances.length, 1);
  assert.equal(FakeTray.instances[0].destroyCalls, 1);
  assert.equal(FakeBrowserWindow.instances.length, 0);
});

test("rolls back the panel and Tray when webContents validation fails", () => {
  class InvalidWebContentsWindow extends FakeBrowserWindow {
    constructor(options) {
      super(options);
      this.webContents = {};
    }
  }
  const { dependencies } = createDependencies();
  dependencies.BrowserWindow = InvalidWebContentsWindow;

  assert.throws(
    () => createMacMenuBar(dependencies),
    {
      name: "TypeError",
      message: "BrowserWindow.webContents.send must be a function"
    }
  );

  assert.equal(FakeTray.instances.length, 1);
  assert.equal(FakeTray.instances[0].destroyCalls, 1);
  assert.equal(FakeBrowserWindow.instances.length, 1);
  assert.equal(FakeBrowserWindow.instances[0].destroyCalls, 1);
});

test("creates one template tray icon and one secure hidden panel", () => {
  const { calls, panel, tray } = createFixture();

  assert.equal(FakeTray.instances.length, 1);
  assert.equal(FakeBrowserWindow.instances.length, 1);
  assert.deepEqual(calls.createFromPath, ["/app/menu-bar.png"]);
  assert.deepEqual(calls.resize, [{ width: 16, height: 16 }]);
  assert.deepEqual(calls.setTemplateImage, [true]);
  assert.equal(calls.resizedImages[0].template, true);
  assert.equal(tray.image, calls.resizedImages[0]);
  assert.equal(tray.tooltip, "WinPlate");
  assert.equal(tray.title, "--°");
  assert.equal(tray.ignoreDoubleClickEvents, true);
  assert.deepEqual(panel.options, {
    width: 320,
    height: 420,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    hasShadow: true,
    vibrancy: "popover",
    visualEffectState: "active",
    webPreferences: {
      preload: "/app/preload.js",
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });
  assert.deepEqual(panel.loadedFiles, ["/app/menu-bar.html"]);
});

test("left click positions and toggles the panel on the nearest display", async () => {
  const { calls, panel, tray } = createFixture();
  await settlePromises();

  tray.emit("click");

  assert.deepEqual(calls.displayPoints, [{ x: 612, y: 24 }]);
  assert.deepEqual(panel.bounds, [
    { x: 452, y: 32, width: 320, height: 420 }
  ]);
  assert.equal(panel.showCalls, 1);
  assert.equal(panel.focusCalls, 1);

  tray.emit("click");

  assert.equal(panel.hideCalls, 1);
  assert.equal(panel.showCalls, 1);
});

test("exposes panel toggling on the controller", async () => {
  const { controller, panel } = createFixture();
  await settlePromises();

  controller.toggle();

  assert.deepEqual(panel.bounds, [
    { x: 452, y: 32, width: 320, height: 420 }
  ]);
  assert.equal(panel.showCalls, 1);
  assert.equal(panel.focusCalls, 1);

  controller.toggle();

  assert.equal(panel.hideCalls, 1);
  assert.equal(panel.showCalls, 1);
});

test("owns only the live panel webContents sender", () => {
  const { controller, panel } = createFixture();

  assert.equal(controller.ownsSender(panel.webContents), true);
  assert.equal(controller.ownsSender({}), false);
  assert.equal(controller.ownsSender(null), false);
});

test("does not own any sender after destroy", () => {
  const { controller, panel } = createFixture();
  const sender = panel.webContents;

  controller.destroy();

  assert.equal(controller.ownsSender(sender), false);
  assert.equal(controller.ownsSender(panel.webContents), false);
});

test("panel blur hides the live panel", () => {
  const { panel } = createFixture();

  panel.visible = true;
  panel.emit("blur");

  assert.equal(panel.hideCalls, 1);
  assert.equal(panel.visible, false);
});

test("right click builds and pops up the exact native menu", async () => {
  const { calls, panel, tray } = createFixture();
  await settlePromises();

  tray.emit("right-click");

  assert.equal(calls.menuTemplates.length, 1);
  const template = calls.menuTemplates[0];
  assert.deepEqual(
    template.map((item) => item.type === "separator" ? "separator" : item.label),
    ["Open WinPlate", "Settings", "Refresh", "separator", "Quit"]
  );
  assert.deepEqual(tray.poppedMenus, [calls.menus[0]]);

  template[0].click();
  template[1].click();
  template[2].click();
  template[4].click();

  assert.deepEqual(calls.shownSections, ["Dashboard", "Settings"]);
  assert.deepEqual(panel.webContents.sent, [["menubar:refresh"]]);
  assert.equal(calls.quit, 1);
});

test("normalizes temperature titles and refreshes the panel", async () => {
  const { controller, panel, tray } = createFixture();
  await settlePromises();

  assert.equal(controller.setTemperature(25.6), "26°C");
  assert.equal(tray.title, "26°C");
  assert.equal(controller.setTemperature("invalid"), "--°");
  assert.equal(tray.title, "--°");

  controller.refresh();

  assert.deepEqual(panel.webContents.sent, [["menubar:refresh"]]);
});

test("defers a pending toggle until the panel file loads", async () => {
  const load = deferred();
  const { controller, panel } = createFixture({ loadPromise: load.promise });

  controller.toggle();

  assert.equal(panel.showCalls, 0);
  assert.equal(panel.focusCalls, 0);

  load.resolve();
  await settlePromises();

  assert.equal(panel.showCalls, 1);
  assert.equal(panel.focusCalls, 1);
  assert.deepEqual(panel.bounds, [
    { x: 452, y: 32, width: 320, height: 420 }
  ]);
});

test("queues one refresh until the panel file loads", async () => {
  const load = deferred();
  const { controller, panel } = createFixture({ loadPromise: load.promise });

  controller.refresh();

  assert.deepEqual(panel.webContents.sent, []);

  load.resolve();
  await settlePromises();

  assert.deepEqual(panel.webContents.sent, [["menubar:refresh"]]);
});

test("a second pre-load toggle cancels the pending show", async () => {
  const load = deferred();
  const { controller, panel } = createFixture({ loadPromise: load.promise });

  controller.toggle();
  controller.toggle();

  assert.equal(panel.showCalls, 0);

  load.resolve();
  await settlePromises();

  assert.equal(panel.showCalls, 0);
  assert.equal(panel.hideCalls, 0);
});

test("a rejected panel load is handled without showing incomplete content", async () => {
  const load = deferred();
  const { controller, panel } = createFixture({ loadPromise: load.promise });

  controller.toggle();
  controller.refresh();
  load.reject(new Error("load failed"));
  await settlePromises();

  assert.equal(panel.showCalls, 0);
  assert.deepEqual(panel.webContents.sent, []);
});

test("a synchronous panel load failure is handled", () => {
  assert.doesNotThrow(() => createFixture({
    loadError: new Error("load failed synchronously")
  }));

  assert.equal(FakeBrowserWindow.instances[0].showCalls, 0);
  assert.deepEqual(FakeBrowserWindow.instances[0].webContents.sent, []);
});

test("destroy during load prevents deferred native actions", async () => {
  const load = deferred();
  const { controller, panel } = createFixture({ loadPromise: load.promise });

  controller.toggle();
  controller.refresh();
  controller.destroy();
  load.resolve();
  await settlePromises();

  assert.equal(panel.showCalls, 0);
  assert.deepEqual(panel.webContents.sent, []);
  assert.equal(panel.destroyCalls, 1);
});

test("hide and refresh ignore a destroyed panel", () => {
  const { controller, panel } = createFixture();

  panel.destroyed = true;
  controller.hide();
  controller.refresh();

  assert.equal(panel.hideCalls, 0);
  assert.deepEqual(panel.webContents.sent, []);
});

test("public operations do not touch native objects after destroy", async () => {
  const { controller, panel, tray } = createFixture();
  await settlePromises();
  controller.destroy();

  assert.doesNotThrow(() => controller.toggle());
  assert.doesNotThrow(() => controller.refresh());
  assert.doesNotThrow(() => controller.hide());
  assert.equal(controller.setTemperature(24.4), "24°C");

  assert.equal(tray.title, "--°");
  assert.deepEqual(panel.webContents.sent, []);
});

test("controller paths tolerate an independently destroyed Tray", async () => {
  const { calls, controller, panel, tray } = createFixture();
  await settlePromises();
  const handleRightClick = tray.listeners("right-click")[0];
  tray.destroy();

  assert.doesNotThrow(() => controller.toggle());
  assert.equal(controller.setTemperature(24.4), "24°C");
  assert.doesNotThrow(() => handleRightClick());
  assert.doesNotThrow(() => controller.refresh());
  assert.doesNotThrow(() => controller.hide());
  assert.doesNotThrow(() => controller.destroy());

  assert.equal(panel.showCalls, 0);
  assert.equal(panel.hideCalls, 1);
  assert.deepEqual(panel.webContents.sent, [["menubar:refresh"]]);
  assert.equal(calls.menuTemplates.length, 0);
  assert.equal(tray.title, "--°");
  assert.equal(tray.destroyCalls, 1);
  assert.equal(panel.destroyCalls, 1);
});

test("destroy tears down each live native object exactly once", () => {
  const { calls, controller, panel, tray } = createFixture();

  controller.destroy();
  controller.destroy();

  assert.equal(panel.destroyCalls, 1);
  assert.equal(tray.destroyCalls, 1);
  assert.equal(panel.listenerCount("blur"), 0);
  assert.equal(tray.listenerCount("click"), 0);
  assert.equal(tray.listenerCount("right-click"), 0);

  tray.emit("click");
  tray.emit("right-click");
  panel.emit("blur");

  assert.equal(panel.showCalls, 0);
  assert.equal(panel.hideCalls, 0);
  assert.equal(calls.menuTemplates.length, 0);
});
