const test = require("node:test");
const assert = require("node:assert/strict");
const { mainModules, validateMainModules } = require("./index");

test("main-process registry covers every product module and its IPC boundary", () => {
  assert.equal(validateMainModules(), mainModules);
  assert.equal(mainModules.length, 7);
  mainModules.forEach((module) => assert.ok(module.ipcChannels.length));
});
