const test = require("node:test");
const assert = require("node:assert/strict");

test("Windows digest engine re-exports @winplate/core/digest", () => {
  assert.equal(require("./digestEngine"), require("@winplate/core/digest"));
});

test("Windows notification store re-exports @winplate/core/notification", () => {
  assert.equal(require("./notificationStore"), require("@winplate/core/notification"));
});
