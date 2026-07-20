const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createActivationCoordinator,
  normalizeMainSection
} = require("./activationCoordinator");

test("normalizes only exact renderer sections", () => {
  for (const section of ["Dashboard", "GitHub", "Codex", "Heart", "Mail", "QWeather", "Notifications", "Settings"]) {
    assert.equal(normalizeMainSection(section), section);
  }
  for (const value of [undefined, null, "", "dashboard", "Unknown", {}, 12]) {
    assert.equal(normalizeMainSection(value), "Dashboard");
  }
});

test("queues early Electron activation without showing until surfaces are ready", () => {
  const calls = [];
  const coordinator = createActivationCoordinator((section) => calls.push(section));

  coordinator.onSecondInstance({ type: "second-instance" }, ["--flag"], "/tmp", {});
  coordinator.onActivate({ type: "activate" }, true);
  assert.deepEqual(calls, []);

  coordinator.markReady();
  assert.deepEqual(calls, ["Dashboard"]);
  coordinator.markReady();
  assert.deepEqual(calls, ["Dashboard"]);
});

test("post-ready callbacks discard Electron arguments and explicit requests keep known sections", () => {
  const calls = [];
  const coordinator = createActivationCoordinator((section) => calls.push(section));
  coordinator.markReady();

  coordinator.onSecondInstance({ type: "second-instance" }, ["Settings"]);
  coordinator.onActivate({ type: "activate" });
  coordinator.request("Settings");

  assert.deepEqual(calls, ["Dashboard", "Dashboard", "Settings"]);
});
