const assert = require("node:assert/strict");
const test = require("node:test");

const { readInitialAppSettings } = require("./appSettingsStartup");

const defaults = Object.freeze({ menuBarEnabled: true, launchAtLogin: false });

test("startup app settings failure reports only its message and returns fresh defaults", async () => {
  assert.equal(typeof readInitialAppSettings, "function", "startup app settings helper must exist");
  const errors = [];
  const error = new Error("Unable to read app settings");
  error.payload = "must-not-be-logged";

  const result = await readInitialAppSettings({
    read: async () => { throw error; },
    defaults,
    reportError: (message) => errors.push(message)
  });

  assert.deepEqual(result, defaults);
  assert.notStrictEqual(result, defaults);
  assert.deepEqual(errors, ["Unable to read app settings"]);
  assert.doesNotMatch(errors.join(" "), /must-not-be-logged/);
});

test("startup app settings success returns the loaded settings without reporting", async () => {
  assert.equal(typeof readInitialAppSettings, "function", "startup app settings helper must exist");
  const errors = [];
  const loaded = { menuBarEnabled: false, launchAtLogin: true };

  assert.deepEqual(await readInitialAppSettings({
    read: async () => loaded,
    defaults,
    reportError: (message) => errors.push(message)
  }), loaded);
  assert.deepEqual(errors, []);
});
