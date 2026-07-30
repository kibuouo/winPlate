const test = require("node:test");
const assert = require("node:assert/strict");
const { createNotificationSummaryService } = require("./notificationSummaryService");

const raw = [{
  id: "codex:1",
  source: "codex",
  type: "task-status",
  title: "Codex 完成",
  body: "测试通过",
  level: "success",
  createdAt: 1,
  unread: true,
  dedupeKey: "codex:1",
  meta: {}
}];

test("generates notification summaries entirely from local rules", async () => {
  const service = createNotificationSummaryService({
    store: { collect: async () => ({ items: raw }) },
    now: () => 10
  });

  const digest = await service.getDigest();

  assert.equal(digest.source, "local");
  assert.equal(digest.generatedAt, 10);
  assert.equal(digest.unreadCount, 1);
  assert.ok(digest.headline);
  assert.ok(digest.summary);
});

test("reuses the local digest while the notification hash is unchanged", async () => {
  let updates = 0;
  const service = createNotificationSummaryService({
    store: { collect: async () => ({ items: raw }) },
    onUpdated: () => { updates += 1; },
    now: () => 10
  });

  const first = await service.refreshNow();
  const second = await service.refreshNow();

  assert.equal(second, first);
  assert.equal(updates, 1);
});

test("debounces multiple source signals into one local digest refresh", async () => {
  let collects = 0;
  const service = createNotificationSummaryService({
    store: {
      collect: async () => {
        collects += 1;
        return { items: raw };
      }
    },
    debounceMs: 10,
    now: () => 10
  });

  await Promise.all([
    service.scheduleRefresh(),
    service.scheduleRefresh(),
    service.scheduleRefresh()
  ]);

  assert.equal(collects, 1);
});

test("generates the local empty state when all notifications are read", async () => {
  const service = createNotificationSummaryService({
    store: {
      collect: async () => ({
        items: [{ ...raw[0], unread: false }]
      })
    }
  });

  const digest = await service.refreshNow();

  assert.equal(digest.source, "local");
  assert.equal(digest.unreadCount, 0);
  assert.equal(digest.headline, "暂无新通知");
});
