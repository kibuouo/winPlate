const test = require("node:test");
const assert = require("node:assert/strict");

const { startupPolicy } = require("./startupPolicy");

test("Windows starts the Tray and floating window without a macOS menu bar", () => {
  assert.deepEqual(startupPolicy("win32"), {
    createWindowsTray: true,
    createMacMenuBar: false,
    createFloatingWindow: true
  });
});

test("macOS starts only the native menu bar controller", () => {
  assert.deepEqual(startupPolicy("darwin"), {
    createWindowsTray: false,
    createMacMenuBar: true,
    createFloatingWindow: false
  });
});
