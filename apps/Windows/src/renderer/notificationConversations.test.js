const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createNotificationManager,
  foldNotificationConversations: foldCoreConversations,
  conversationForNotificationId: findCoreConversation
} = require("@winplate/core/notification");

function loadRendererAdapter() {
  const source = fs.readFileSync(path.join(__dirname, "notificationConversations.js"), "utf8");
  const context = { window: {} };
  vm.runInNewContext(source, context, { filename: "notificationConversations.js" });
  return context.window.WinPlateNotificationConversations;
}

test("renderer consumes the core-produced conversation contract without a second folding algorithm", async () => {
  const manager = createNotificationManager({
    loadNotifications: async () => ({
      items: [
        {
          id: "codex:new",
          source: "codex",
          title: "同一任务",
          message: "最新进展",
          unread: true,
          createdAt: 2_000
        },
        {
          id: "codex:old",
          source: "codex",
          title: " 同一任务 ",
          message: "早期进展",
          unread: false,
          createdAt: 1_000
        },
        {
          id: "mail:one",
          source: "mail",
          title: "不应折叠",
          unread: true,
          createdAt: 900
        }
      ]
    }),
    mutateNotifications: async () => ({ items: [] })
  });
  const summary = await manager.list();
  const adapter = loadRendererAdapter();

  assert.equal(adapter.foldNotificationConversations, undefined);
  assert.deepEqual(summary.conversations, foldCoreConversations(summary.items));
  assert.deepEqual(adapter.fromSummary(summary, []), summary.conversations);

  for (const id of ["codex:new", "codex:old", "mail:one"]) {
    assert.deepEqual(
      adapter.conversationForNotificationId(summary.conversations, id),
      findCoreConversation(summary.conversations, id)
    );
  }
});

test("renderer adapter falls back to raw items before the first notification summary arrives", () => {
  const adapter = loadRendererAdapter();
  const fallback = [{ id: "mail:one", source: "mail", title: "Mail" }];
  assert.deepEqual(adapter.fromSummary({ items: fallback }, fallback), fallback);
  assert.deepEqual(adapter.fromSummary({ items: fallback }, []), []);
});
