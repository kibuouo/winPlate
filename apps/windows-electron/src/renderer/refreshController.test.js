const test = require("node:test");
const assert = require("node:assert/strict");
const { createRefreshController } = require("./refreshController");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test("deduplicates timer refreshes while a task is in flight", async () => {
  const pending = deferred();
  let calls = 0;
  const controller = createRefreshController();
  controller.register({
    id: "codex",
    refresh: () => {
      calls += 1;
      return pending.promise;
    }
  });
  const first = controller.refresh("codex", { reason: "timer" });
  const second = controller.refresh("codex", { reason: "timer" });
  assert.equal(calls, 0);
  await Promise.resolve();
  assert.equal(calls, 1);
  pending.resolve("ok");
  assert.equal(await first, "ok");
  assert.equal(await second, "ok");
  assert.equal(calls, 1);
});

test("queues exactly one forced refresh behind the active request", async () => {
  const firstPending = deferred();
  let calls = 0;
  const controller = createRefreshController();
  controller.register({
    id: "mail",
    refresh: ({ force }) => {
      calls += 1;
      return calls === 1 ? firstPending.promise : Promise.resolve(force ? "forced" : "normal");
    }
  });
  const first = controller.refresh("mail", { reason: "timer" });
  await Promise.resolve();
  const forcedA = controller.refresh("mail", { force: true, reason: "button" });
  const forcedB = controller.refresh("mail", { force: true, reason: "button" });
  firstPending.resolve("first");
  assert.equal(await first, "first");
  assert.equal(await forcedA, "forced");
  assert.equal(await forcedB, "forced");
  assert.equal(calls, 2);
});

test("keeps the last successful timestamp and marks later failures stale", async () => {
  let fail = false;
  let clock = 100;
  const changes = [];
  const controller = createRefreshController({
    now: () => ++clock,
    onHealthChange: (id, health) => changes.push({ id, health })
  });
  controller.register({
    id: "weather",
    refresh: () => fail ? Promise.reject(new Error("offline")) : Promise.resolve("sunny")
  });
  await controller.refresh("weather");
  const successAt = controller.getHealth("weather").lastSuccessAt;
  fail = true;
  await assert.rejects(controller.refresh("weather"), /offline/);
  assert.deepEqual(controller.getHealth("weather"), {
    state: "stale",
    lastSuccessAt: successAt,
    lastAttemptAt: 103,
    error: "offline"
  });
  assert.equal(changes.at(-1).id, "weather");
});

test("reconfigures and stops timers without duplicating them", async () => {
  const active = new Set();
  let nextId = 0;
  const controller = createRefreshController({
    setIntervalFn: () => {
      const id = ++nextId;
      active.add(id);
      return id;
    },
    clearIntervalFn: (id) => active.delete(id)
  });
  controller.register({ id: "network", intervalMs: 2_000, refresh: async () => {} });
  await controller.start();
  assert.equal(active.size, 1);
  controller.configure("network", { intervalMs: 5_000 });
  assert.equal(active.size, 1);
  controller.stop();
  assert.equal(active.size, 0);
});

test("times out a hung task and allows a later refresh", async () => {
  const never = deferred();
  let calls = 0;
  const controller = createRefreshController();
  controller.register({
    id: "github",
    timeoutMs: 10,
    refresh: () => {
      calls += 1;
      return calls === 1 ? never.promise : Promise.resolve("recovered");
    }
  });

  await assert.rejects(controller.refresh("github"), /github 刷新超时/);
  assert.equal(controller.getHealth("github").state, "error");
  assert.equal(await controller.refresh("github"), "recovered");
  assert.equal(controller.getHealth("github").state, "live");
});

test("forced refresh queued behind a hung task runs after the timeout", async () => {
  const never = deferred();
  let calls = 0;
  const controller = createRefreshController();
  controller.register({
    id: "mail",
    timeoutMs: 10,
    refresh: ({ force }) => {
      calls += 1;
      return calls === 1 ? never.promise : Promise.resolve(force ? "forced" : "normal");
    }
  });

  const initial = controller.refresh("mail", { reason: "timer" });
  await Promise.resolve();
  const forced = controller.refresh("mail", { force: true, reason: "button" });
  await assert.rejects(initial, /mail 刷新超时/);
  assert.equal(await forced, "forced");
  assert.equal(calls, 2);
});
