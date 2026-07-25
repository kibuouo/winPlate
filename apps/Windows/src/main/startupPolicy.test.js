const test = require("node:test");
const assert = require("node:assert/strict");

const { startupPolicy } = require("./startupPolicy");

test("Windows starts the tray and floating window", () => {
  assert.deepEqual(startupPolicy("win32"), {
    createWindowsTray: true,
    createFloatingWindow: true
  });
});

test("Windows Electron rejects unsupported platforms", () => {
  assert.throws(
    () => startupPolicy("linux"),
    new Error("Windows Electron only supports win32; received: linux")
  );
});
