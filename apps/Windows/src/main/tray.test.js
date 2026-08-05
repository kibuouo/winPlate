const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const Module = require("node:module");
const test = require("node:test");

class FakeTray extends EventEmitter {
  static instances = [];
  constructor() {
    super();
    this.destroyed = false;
    FakeTray.instances.push(this);
  }
  isDestroyed() { return this.destroyed; }
  setToolTip() {}
  setContextMenu(menu) { this.menu = menu; }
}

let lastTemplate;
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === "electron") {
    return {
      Tray: FakeTray,
      nativeImage: { createFromPath: () => ({ resize: () => ({}) }) },
      Menu: { buildFromTemplate: (template) => { lastTemplate = template; return template; } }
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
delete require.cache[require.resolve("./tray")];
const { createAppTray } = require("./tray");
Module._load = originalLoad;

function actions(calls) {
  return {
    showMainWindow: (section) => calls.push(section),
    showFloatingWindow() {},
    hideFloatingWindow() {},
    quit() {}
  };
}

test("createAppTray reuses a live tray and replaces a destroyed tray", () => {
  const calls = [];
  const first = createAppTray(actions(calls));
  assert.equal(createAppTray(actions(calls)), first);
  assert.equal(first.listenerCount("double-click"), 1);
  first.destroyed = true;
  assert.notEqual(createAppTray(actions(calls)), first);
});

test("menu and double-click callbacks discard Electron metadata", () => {
  const calls = [];
  const tray = FakeTray.instances.at(-1);
  tray.destroyed = true;
  const current = createAppTray(actions(calls));
  lastTemplate[0].click({ label: "打开 WinPlate" }, { type: "click" });
  assert.equal(lastTemplate[0].label, "打开 WinPlate");
  assert.equal(lastTemplate[2].label, "显示浮窗");
  assert.equal(lastTemplate[3].label, "隐藏浮窗");
  assert.equal(lastTemplate[5].label, "退出");
  current.emit("double-click", { type: "double-click" }, { x: 4, y: 5 });
  assert.deepEqual(calls, ["Dashboard", "Dashboard"]);
});
