const test = require("node:test");
const assert = require("node:assert/strict");

test("Windows Node module registry re-exports @winplate/core/module-registry", () => {
  assert.equal(require("./moduleRegistry"), require("@winplate/core/module-registry"));
});
