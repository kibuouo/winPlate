const test = require("node:test");
const assert = require("node:assert/strict");
const { MODULES, getModuleMeta, modulesForView, orderedModules } = require("./moduleRegistry");

test("registers each current module with a complete scheduling contract", () => {
  assert.deepEqual(MODULES.map((module) => module.id), [
    "github", "codex", "notifications", "mail", "weather", "heart", "network"
  ]);
  MODULES.forEach((module) => {
    assert.equal(module.schemaVersion, 1);
    assert.equal(typeof module.title, "string");
    assert.ok(Array.isArray(module.views));
    assert.ok(module.defaultRefreshSeconds >= module.minRefreshSeconds);
    assert.ok(module.defaultRefreshSeconds <= module.maxRefreshSeconds);
    assert.equal(getModuleMeta(module.id), module);
  });
});

test("filters disabled modules and respects configured order per view", () => {
  const settings = {
    order: ["weather", "codex", "github"],
    enabled: { codex: false }
  };
  assert.deepEqual(
    modulesForView("dashboard", settings).map((module) => module.id),
    ["weather", "github", "heart"]
  );
  assert.equal(orderedModules(settings.order)[0].id, "weather");
});

test("presents the heart module as 健康 without changing its navigation section", () => {
  assert.equal(getModuleMeta("heart").title, "健康");
  assert.equal(getModuleMeta("heart").section, "Heart");
});

test("uses the requested localized labels for the main navigation modules", () => {
  assert.deepEqual(
    ["notifications", "mail", "weather", "heart"].map((id) => getModuleMeta(id).title),
    ["通知", "邮件", "天气", "健康"]
  );
});
