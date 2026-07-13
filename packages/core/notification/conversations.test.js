const test = require("node:test");
const assert = require("node:assert/strict");
const {
  FOUR_HOURS_MS,
  conversationForNotificationId,
  foldNotificationConversations
} = require("./conversations");
const { createLocalDigest } = require("../digest");

test("folds adjacent Codex replies with one normalized title into the latest conversation", () => {
  const conversations = foldNotificationConversations([
    { id: "codex:old", source: "codex", title: "  精简测试  ", body: "first", unread: true, createdAt: 1_000, level: "info" },
    { id: "codex:new", source: "codex", title: "精简测试", body: "latest", unread: true, createdAt: 2_000, level: "success" }
  ]);

  assert.equal(conversations.length, 1);
  assert.equal(conversations[0].id, "codex:new");
  assert.deepEqual(conversations[0].memberIds, ["codex:new", "codex:old"]);
  assert.equal(conversations[0].updateCount, 2);
  assert.equal(conversationForNotificationId(conversations, "codex:old").id, "codex:new");
});

test("keeps unmatched sources, blank titles, and gaps beyond four hours separate", () => {
  const conversations = foldNotificationConversations([
    { id: "codex:1", source: "codex", title: "same", createdAt: 1_000 },
    { id: "codex:2", source: "codex", title: "same", createdAt: 1_000 + FOUR_HOURS_MS + 1 },
    { id: "chatgpt:1", source: "chatgpt", title: "same", createdAt: 2_000 },
    { id: "mail:1", source: "mail", title: "same", createdAt: 2_100 },
    { id: "codex:blank", source: "codex", title: " ", createdAt: 2_200 }
  ]);

  assert.equal(conversations.length, 5);
});

test("keeps a conversation unread while any older reply remains unread", () => {
  const [conversation] = foldNotificationConversations([
    { id: "codex:new", source: "codex", title: "精简测试", unread: false, createdAt: 2_000 },
    { id: "codex:old", source: "codex", title: "精简测试", unread: true, createdAt: 1_000 }
  ]);

  assert.equal(conversation.unread, true);
});

test("digest counts one unread conversation for multiple Codex replies", () => {
  const digest = createLocalDigest([
    { id: "codex:1", source: "codex", title: "精简测试", body: "first", level: "info", unread: true, createdAt: 1_000, meta: {} },
    { id: "codex:2", source: "codex", title: "精简测试", body: "latest", level: "success", unread: true, createdAt: 2_000, meta: {} }
  ], 3_000);

  assert.equal(digest.unreadCount, 1);
  assert.deepEqual(digest.sourceIds, ["codex:2"]);
});
