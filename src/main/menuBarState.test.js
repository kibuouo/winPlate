const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_PANEL_SIZE,
  formatTemperatureTitle,
  getMenuBarPanelBounds
} = require("./menuBarState");

test("formats a rounded Celsius menu bar title", () => {
  assert.equal(formatTemperatureTitle(25.6), "26°C");
  assert.equal(formatTemperatureTitle("-4.6"), "-5°C");
});

test("clamps temperature titles to two digits", () => {
  assert.equal(formatTemperatureTitle(140), "99°C");
  assert.equal(formatTemperatureTitle(-140), "-99°C");
});

test("uses a placeholder title for missing or malformed temperatures", () => {
  assert.equal(formatTemperatureTitle("not-a-temperature"), "--°");
  assert.equal(formatTemperatureTitle(null), "--°");
});

test("uses the default menu bar panel size", () => {
  assert.deepEqual(DEFAULT_PANEL_SIZE, { width: 320, height: 420 });
});

test("centers the panel beneath the tray", () => {
  const bounds = getMenuBarPanelBounds(
    { x: 600, y: 0, width: 24, height: 24 },
    { x: 0, y: 24, width: 1440, height: 876 }
  );

  assert.deepEqual(bounds, { x: 452, y: 32, width: 320, height: 420 });
});

test("keeps the panel inside the left work-area edge", () => {
  const bounds = getMenuBarPanelBounds(
    { x: 4, y: 0, width: 20, height: 24 },
    { x: 0, y: 24, width: 1024, height: 744 }
  );

  assert.deepEqual(bounds, { x: 8, y: 32, width: 320, height: 420 });
});

test("supports a display with negative coordinates", () => {
  const bounds = getMenuBarPanelBounds(
    { x: -40, y: -900, width: 24, height: 24 },
    { x: -1280, y: -876, width: 1280, height: 876 }
  );

  assert.deepEqual(bounds, { x: -328, y: -868, width: 320, height: 420 });
});

test("shrinks the panel to fit a short work area", () => {
  const bounds = getMenuBarPanelBounds(
    { x: 400, y: 0, width: 24, height: 24 },
    { x: 0, y: 24, width: 800, height: 300 }
  );

  assert.deepEqual(bounds, { x: 252, y: 32, width: 320, height: 284 });
});

test("moves a full-height panel above a low tray", () => {
  const bounds = getMenuBarPanelBounds(
    { x: 500, y: 300, width: 24, height: 24 },
    { x: 0, y: 0, width: 1000, height: 500 }
  );

  assert.deepEqual(bounds, { x: 352, y: 72, width: 320, height: 420 });
});

test("contains a zero-size panel within a zero-size work area", () => {
  const bounds = getMenuBarPanelBounds(
    { x: 0, y: 0, width: 0, height: 0 },
    { x: 0, y: 0, width: 0, height: 0 }
  );

  assert.deepEqual(bounds, { x: 0, y: 0, width: 0, height: 0 });
});

test("contains a zero-size panel within a 16px work area", () => {
  const bounds = getMenuBarPanelBounds(
    { x: 0, y: 0, width: 0, height: 0 },
    { x: 0, y: 0, width: 16, height: 16 }
  );

  assert.deepEqual(bounds, { x: 8, y: 8, width: 0, height: 0 });
});

test("contains a 1px panel within a 17px work area", () => {
  const bounds = getMenuBarPanelBounds(
    { x: 0, y: 0, width: 0, height: 0 },
    { x: 0, y: 0, width: 17, height: 17 }
  );

  assert.deepEqual(bounds, { x: 8, y: 8, width: 1, height: 1 });
});

test("keeps the panel inside the right work-area edge", () => {
  const bounds = getMenuBarPanelBounds(
    { x: 1000, y: 0, width: 24, height: 24 },
    { x: 0, y: 24, width: 1024, height: 744 }
  );

  assert.deepEqual(bounds, { x: 696, y: 32, width: 320, height: 420 });
});

test("shrinks the panel to fit a narrow work area", () => {
  const bounds = getMenuBarPanelBounds(
    { x: 140, y: 0, width: 20, height: 24 },
    { x: 0, y: 24, width: 300, height: 744 }
  );

  assert.deepEqual(bounds, { x: 8, y: 32, width: 284, height: 420 });
});

test("rejects malformed or non-finite rectangle fields", () => {
  const trayBounds = { x: 0, y: 0, width: 24, height: 24 };
  const workArea = { x: 0, y: 24, width: 1024, height: 744 };

  assert.throws(
    () => getMenuBarPanelBounds({ ...trayBounds, x: Number.NaN }, workArea),
    { name: "TypeError", message: "trayBounds.x must be a finite number" }
  );
  assert.throws(
    () => getMenuBarPanelBounds({ x: 0, width: 24, height: 24 }, workArea),
    { name: "TypeError", message: "trayBounds.y must be a finite number" }
  );
  assert.throws(
    () => getMenuBarPanelBounds(trayBounds, { ...workArea, x: "0" }),
    { name: "TypeError", message: "workArea.x must be a finite number" }
  );
  assert.throws(
    () => getMenuBarPanelBounds(trayBounds, { ...workArea, height: Infinity }),
    { name: "TypeError", message: "workArea.height must be a finite number" }
  );
});

test("rejects negative rectangle dimensions", () => {
  const trayBounds = { x: 0, y: 0, width: 24, height: 24 };
  const workArea = { x: 0, y: 24, width: 1024, height: 744 };

  assert.throws(
    () => getMenuBarPanelBounds({ ...trayBounds, width: -1 }, workArea),
    { name: "TypeError", message: "trayBounds.width must be non-negative" }
  );
  assert.throws(
    () => getMenuBarPanelBounds(trayBounds, { ...workArea, height: -1 }),
    { name: "TypeError", message: "workArea.height must be non-negative" }
  );
});
