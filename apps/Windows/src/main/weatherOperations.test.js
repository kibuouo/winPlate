const test = require("node:test");
const assert = require("node:assert/strict");
const { createWeatherOperations } = require("./weatherOperations");

test("location writes finish in selection order and only the latest result is broadcast", async () => {
  let release;
  const started = [];
  const published = [];
  let persisted;
  const operations = createWeatherOperations({ invalidate() {}, publish: (value) => published.push(value) });
  const a = operations.run(async () => {
    started.push("A");
    await new Promise((resolve) => { release = resolve; });
    persisted = "A";
    return "A";
  });
  await Promise.resolve();
  const b = operations.run(async () => { started.push("B"); persisted = "B"; return "B"; });
  assert.deepEqual(started, ["A"]);
  release();
  assert.equal(await a, null);
  assert.equal(await b, "B");
  assert.equal(persisted, "B");
  assert.deepEqual(published, ["B"]);
});

test("a queued refresh cannot skip a location write and failures do not block later operations", async () => {
  const calls = [];
  const operations = createWeatherOperations({ invalidate() {}, publish() {} });
  const location = operations.run(async () => { calls.push("location"); return "saved"; });
  const refresh = operations.run(async () => { calls.push("refresh"); throw new Error("offline"); });
  assert.equal(await location, null);
  await assert.rejects(refresh, /offline/);
  assert.equal(await operations.run(async () => "recovered"), "recovered");
  assert.deepEqual(calls, ["location", "refresh"]);
});

test("credential changes invalidate in-flight results and cache generations", async () => {
  let release;
  const published = [];
  let invalidations = 0;
  const operations = createWeatherOperations({ invalidate() { invalidations++; }, publish: (value) => published.push(value) });
  const pending = operations.run(() => new Promise((resolve) => { release = resolve; }));
  await Promise.resolve();
  operations.invalidate();
  release("old credentials");
  assert.equal(await pending, null);
  assert.deepEqual(published, []);
  assert.equal(invalidations, 3);
});
