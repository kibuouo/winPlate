const test = require("node:test");
const assert = require("node:assert/strict");
const { createNotificationManager } = require("./index");

test("NotificationManager is the single normalization boundary for reads and mutations", async () => {
  const changes = [];
  const rawSummary = {
    items: [{
      id: "qweather:orange",
      source: "qweather",
      title: "强对流橙色预警",
      message: "注意防范",
      level: "critical",
      unread: true,
      createdAt: 100,
      metadata: { severity: "severe" }
    }],
    latest: { id: "qweather:orange" },
    unreadCount: 1,
    updatedAt: 101
  };
  const manager = createNotificationManager({
    loadNotifications: async () => rawSummary,
    mutateNotifications: async () => rawSummary,
    onChanged: (change) => changes.push(change.operation),
    now: () => 200
  });

  const read = await manager.list();
  const changed = await manager.markRead("qweather:orange");
  for (const summary of [read, changed]) {
    assert.equal(summary.items[0].level, "warning");
    assert.equal(summary.items[0].meta.alertColor, "yellow");
    assert.equal(summary.items[0].body, "注意防范");
    assert.equal(summary.items[0].message, undefined);
    assert.equal(summary.latest, summary.items[0]);
  }
  assert.deepEqual(changes, ["markRead"]);
});

test("NotificationManager exposes one mutation entry for every supported notification action", async () => {
  const operations = [];
  const manager = createNotificationManager({
    loadNotifications: async () => ({ items: [] }),
    mutateNotifications: async (operation, payload) => {
      operations.push([operation, payload]);
      return { items: [], unreadCount: 0 };
    }
  });

  await manager.publish({ source: "mail", title: "Mail" });
  await manager.markRead("one");
  await manager.markManyRead(["one", "two"]);
  await manager.markAllRead();
  await manager.clear();
  await manager.clearRead();

  assert.deepEqual(operations.map(([operation]) => operation), [
    "publish", "markRead", "markManyRead", "markAllRead", "clear", "clearRead"
  ]);
});
