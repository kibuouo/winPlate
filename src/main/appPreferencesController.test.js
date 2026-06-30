const assert = require("node:assert/strict");
const test = require("node:test");

const { createAppPreferencesController } = require("./appPreferencesController");

function createHarness(overrides = {}) {
  const menuBars = [];
  const loginValues = [];
  const shownPages = [];
  const errors = [];

  const controller = createAppPreferencesController({
    platform: "darwin",
    initialSettings: { menuBarEnabled: true, launchAtLogin: false },
    createMenuBar() {
      const menuBar = {
        destroyed: 0,
        hidden: 0,
        refreshed: 0,
        temperatures: [],
        sender: {},
        destroy() {
          this.destroyed += 1;
        },
        hide() {
          this.hidden += 1;
          return "hidden";
        },
        refresh() {
          this.refreshed += 1;
          return "refreshed";
        },
        setTemperature(value) {
          this.temperatures.push(value);
          return "temperature-set";
        },
        ownsSender(sender) {
          return sender === this.sender;
        }
      };
      menuBars.push(menuBar);
      return menuBar;
    },
    applyLoginItem(value) {
      loginValues.push(value);
    },
    showMainWindow(page) {
      shownPages.push(page);
    },
    reportError(error) {
      errors.push(error);
    },
    ...overrides
  });

  return { controller, errors, loginValues, menuBars, shownPages };
}

test("darwin creates one menu controller across repeated enabled applies", () => {
  const { controller, menuBars } = createHarness();

  controller.apply({ menuBarEnabled: true, launchAtLogin: false });
  controller.apply({ menuBarEnabled: true, launchAtLogin: true });

  assert.equal(menuBars.length, 1);
});

test("darwin applies only normalized boolean login preferences", () => {
  const { controller, loginValues } = createHarness();

  controller.apply({ menuBarEnabled: false, launchAtLogin: true });
  controller.apply({ menuBarEnabled: "no", launchAtLogin: "yes" });

  assert.deepEqual(loginValues, [true, false]);
  assert.equal(loginValues.every((value) => typeof value === "boolean"), true);
});

test("login failures are reported without blocking menu creation or disable", () => {
  const createFailure = new Error("login create failure");
  const disableFailure = new Error("login disable failure");
  let loginAttempts = 0;
  const { controller, errors, menuBars } = createHarness({
    applyLoginItem() {
      loginAttempts += 1;
      throw loginAttempts === 1 ? createFailure : disableFailure;
    }
  });

  controller.apply({ menuBarEnabled: true, launchAtLogin: true });
  assert.equal(menuBars.length, 1);

  controller.apply({ menuBarEnabled: false, launchAtLogin: false });

  assert.equal(menuBars[0].destroyed, 1);
  assert.deepEqual(errors, [createFailure, disableFailure]);
});

test("disabling destroys once and re-enabling creates a new menu controller", () => {
  const { controller, menuBars } = createHarness();

  controller.apply({ menuBarEnabled: true, launchAtLogin: false });
  const first = menuBars[0];
  controller.apply({ menuBarEnabled: false, launchAtLogin: false });
  controller.apply({ menuBarEnabled: false, launchAtLogin: false });

  assert.equal(first.destroyed, 1);
  assert.equal(menuBars.length, 1);

  controller.apply({ menuBarEnabled: true, launchAtLogin: false });

  assert.equal(menuBars.length, 2);
  assert.notStrictEqual(menuBars[1], first);
});

test("failed disable teardown is quarantined without duplication and retried", () => {
  const failure = new Error("disable teardown failure");
  let destroyAttempts = 0;
  const { controller, errors, menuBars } = createHarness();
  controller.apply({ menuBarEnabled: true, launchAtLogin: false });
  const first = menuBars[0];
  first.destroy = () => {
    destroyAttempts += 1;
    if (destroyAttempts <= 2) {
      throw failure;
    }
  };

  controller.apply({ menuBarEnabled: false, launchAtLogin: false });
  assert.deepEqual(errors, [failure]);
  assert.equal(controller.ownsSender(first.sender), false);
  assert.equal(controller.setTemperature(24), undefined);
  assert.equal(controller.hide(), undefined);
  assert.equal(controller.refresh(), undefined);
  assert.deepEqual(first.temperatures, []);
  assert.equal(first.hidden, 0);
  assert.equal(first.refreshed, 0);

  controller.apply({ menuBarEnabled: true, launchAtLogin: false });
  assert.equal(menuBars.length, 1);
  assert.equal(destroyAttempts, 2);
  assert.deepEqual(errors, [failure, failure]);

  controller.apply({ menuBarEnabled: true, launchAtLogin: false });
  assert.equal(destroyAttempts, 3);
  assert.equal(menuBars.length, 2);
  assert.notStrictEqual(menuBars[1], first);
  assert.deepEqual(errors, [failure, failure]);
});

test("delegates sender checks and menu actions only while live", () => {
  const { controller, menuBars } = createHarness();
  controller.apply({ menuBarEnabled: true, launchAtLogin: false });
  const menuBar = menuBars[0];

  assert.equal(controller.ownsSender(menuBar.sender), true);
  assert.equal(controller.ownsSender({}), false);
  assert.equal(controller.setTemperature(24), "temperature-set");
  assert.equal(controller.hide(), "hidden");
  assert.equal(controller.refresh(), "refreshed");
  assert.deepEqual(menuBar.temperatures, [24]);
  assert.equal(menuBar.hidden, 1);
  assert.equal(menuBar.refreshed, 1);

  controller.destroy();

  assert.equal(controller.ownsSender(menuBar.sender), false);
  assert.equal(controller.setTemperature(25), undefined);
  assert.equal(controller.hide(), undefined);
  assert.equal(controller.refresh(), undefined);
  assert.deepEqual(menuBar.temperatures, [24]);
  assert.equal(menuBar.hidden, 1);
  assert.equal(menuBar.refreshed, 1);
});

test("destroy is idempotent and later apply cannot recreate native state", () => {
  const { controller, loginValues, menuBars } = createHarness();
  controller.apply({ menuBarEnabled: true, launchAtLogin: false });
  const menuBar = menuBars[0];

  controller.destroy();
  controller.destroy();
  const result = controller.apply({ menuBarEnabled: false, launchAtLogin: true });

  assert.equal(menuBar.destroyed, 1);
  assert.equal(menuBars.length, 1);
  assert.deepEqual(loginValues, [false]);
  assert.deepEqual(result, { menuBarEnabled: true, launchAtLogin: false });
  assert.deepEqual(controller.getSettings(), result);
});

test("failed final teardown retries while the outer controller remains blocked", () => {
  const failure = new Error("final teardown failure");
  let destroyAttempts = 0;
  const { controller, errors, loginValues, menuBars } = createHarness();
  controller.apply({ menuBarEnabled: true, launchAtLogin: false });
  const menuBar = menuBars[0];
  menuBar.destroy = () => {
    destroyAttempts += 1;
    if (destroyAttempts === 1) {
      throw failure;
    }
  };

  controller.destroy();

  assert.deepEqual(errors, [failure]);
  assert.equal(controller.ownsSender(menuBar.sender), false);
  assert.equal(controller.setTemperature(25), undefined);
  assert.equal(controller.hide(), undefined);
  assert.equal(controller.refresh(), undefined);
  assert.deepEqual(
    controller.apply({ menuBarEnabled: false, launchAtLogin: true }),
    { menuBarEnabled: true, launchAtLogin: false }
  );
  assert.deepEqual(loginValues, [false]);

  controller.destroy();
  controller.destroy();

  assert.equal(destroyAttempts, 2);
  assert.deepEqual(errors, [failure]);
});

test("menu creation failure is reported, reveals Dashboard, and permits retry", () => {
  const failure = new Error("menu unavailable");
  let attempts = 0;
  const workingMenuBar = {
    destroy() {},
    ownsSender(sender) {
      return sender === "owned";
    }
  };
  const { controller, errors, shownPages } = createHarness({
    createMenuBar() {
      attempts += 1;
      if (attempts === 1) {
        throw failure;
      }
      return workingMenuBar;
    }
  });

  controller.apply({ menuBarEnabled: true, launchAtLogin: false });

  assert.deepEqual(errors, [failure]);
  assert.deepEqual(shownPages, ["Dashboard"]);
  assert.equal(controller.ownsSender("owned"), false);

  controller.apply({ menuBarEnabled: true, launchAtLogin: false });

  assert.equal(attempts, 2);
  assert.equal(controller.ownsSender("owned"), true);
  assert.deepEqual(errors, [failure]);
  assert.deepEqual(shownPages, ["Dashboard"]);
});

test("win32 normalizes settings without invoking native dependencies", () => {
  const calls = [];
  const controller = createAppPreferencesController({
    platform: "win32",
    initialSettings: null,
    createMenuBar() {
      calls.push("menu");
    },
    applyLoginItem() {
      calls.push("login");
    },
    showMainWindow() {
      calls.push("show");
    },
    reportError() {
      calls.push("error");
    }
  });

  const result = controller.apply({ menuBarEnabled: false, launchAtLogin: true });

  assert.deepEqual(result, { menuBarEnabled: false, launchAtLogin: true });
  assert.deepEqual(controller.getSettings(), result);
  assert.deepEqual(calls, []);
});

test("settings inputs and returned values are defensive objects", () => {
  const initialSettings = { menuBarEnabled: false, launchAtLogin: true };
  const { controller } = createHarness({ initialSettings });
  initialSettings.menuBarEnabled = true;

  const first = controller.getSettings();
  first.launchAtLogin = false;
  assert.deepEqual(controller.getSettings(), {
    menuBarEnabled: false,
    launchAtLogin: true
  });

  const applied = { menuBarEnabled: true, launchAtLogin: false };
  const result = controller.apply(applied);
  applied.menuBarEnabled = false;
  result.launchAtLogin = true;

  const stored = controller.getSettings();
  assert.deepEqual(stored, { menuBarEnabled: true, launchAtLogin: false });
  assert.notStrictEqual(result, stored);
});
