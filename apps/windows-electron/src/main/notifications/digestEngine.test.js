const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeRawNotification } = require("./notificationStore");
const {
  createLocalDigest,
  dedupeNotifications,
  highestSeverity,
  severityForNotification
} = require("./digestEngine");

test("normalizes supported sources into the RawNotification contract", () => {
  const item = normalizeRawNotification({
    id: "mail:1",
    source: "email",
    subject: "Launch",
    message: "Please review",
    unread: true,
    createdAt: 123
  });
  assert.deepEqual(Object.keys(item), [
    "id", "source", "sourceId", "type", "title", "body", "level", "createdAt", "unread", "dedupeKey", "meta", "actions"
  ]);
  assert.equal(item.source, "mail");
  assert.equal(item.sourceId, "1");
  assert.equal(item.type, "mail");
  assert.deepEqual(item.actions.map((action) => action.type), ["view", "navigate", "copy", "markRead"]);
  assert.equal(normalizeRawNotification({ source: "chatgpt", title: "Done" }).source, "chatgpt");
});

test("weather resolution is represented as decreased risk, never a high-risk alert", () => {
  const resolved = normalizeRawNotification({
    id: "qweather:a1",
    source: "qweather",
    title: "暴雨红色预警解除",
    message: "本轮强降雨过程结束",
    level: "critical",
    unread: true,
    createdAt: 200
  });
  const digest = createLocalDigest([resolved], 300);
  assert.equal(resolved.type, "weather-alert-resolved");
  assert.equal(resolved.level, "success");
  assert.equal(resolved.meta.riskDelta, "decreased");
  assert.equal(digest.priority, "low");
  assert.equal(digest.severity, "info");
  assert.match(digest.headline, /解除|风险降低/);
  assert.doesNotMatch(digest.headline, /高危|紧急/);
});

test("maps source semantics to danger, warning, and info", () => {
  const item = (source, title, level = "info", meta = {}) => ({ source, title, body: "", level, meta });
  assert.equal(severityForNotification(item("qweather", "暴雨红色预警")), "danger");
  assert.equal(severityForNotification(item("qweather", "暴雨橙色预警")), "danger");
  assert.equal(severityForNotification(item("qweather", "高温黄色预警")), "warning");
  assert.equal(severityForNotification(item("qweather", "大风蓝色预警")), "warning");
  assert.equal(severityForNotification(item("qweather", "天气转多云")), "info");
  assert.equal(severityForNotification(item("mail", "新邮件：Launch")), "info");
  assert.equal(severityForNotification(item("codex", "Codex 任务完成")), "info");
  assert.equal(severityForNotification(item("codex", "ChatGPT 任务完成")), "info");
  assert.equal(severityForNotification(item("codex", "Codex 任务失败")), "warning");
  assert.equal(severityForNotification(item("chatgpt", "ChatGPT 任务失败")), "warning");
  assert.equal(severityForNotification(item("system", "系统发生严重错误")), "danger");
  assert.equal(severityForNotification(item("system", "API 连续失败")), "danger");
  assert.equal(severityForNotification(item("system", "核心模块不可用")), "danger");
});

test("aggregates the highest semantic severity", () => {
  assert.equal(highestSeverity(["info", "warning"]), "warning");
  assert.equal(highestSeverity(["warning", "danger", "info"]), "danger");
  const digest = createLocalDigest([
    { id: "mail:1", source: "mail", title: "新邮件", body: "", createdAt: 2, unread: true, dedupeKey: "mail:1", level: "info", meta: {} },
    { id: "weather:1", source: "qweather", title: "暴雨红色预警", body: "", createdAt: 1, unread: true, dedupeKey: "weather:1", level: "critical", meta: { lifecycle: "issued" } }
  ], 3);
  assert.equal(digest.severity, "danger");
  assert.equal(digest.unreadCount, 2);
});

test("a newly issued orange alert is published, not misclassified as upgraded", () => {
  const issued = normalizeRawNotification({
    id: "qweather:a2",
    source: "qweather",
    title: "发布暴雨橙色预警",
    level: "critical",
    unread: true,
    createdAt: 200
  });
  assert.equal(issued.meta.lifecycle, "issued");
  assert.equal(createLocalDigest([issued], 300).headline, "有新的天气预警需要关注");
});

test("deduplicates by source and dedupeKey and builds the requested groups", () => {
  const values = [
    { id: "1", source: "codex", title: "old", createdAt: 1, unread: true, dedupeKey: "task", level: "info", meta: {} },
    { id: "2", source: "codex", title: "done", createdAt: 2, unread: true, dedupeKey: "task", level: "success", meta: {} },
    { id: "3", source: "github", title: "PR review", createdAt: 3, unread: true, dedupeKey: "pr", level: "info", meta: {} }
  ];
  assert.deepEqual(dedupeNotifications(values).map((item) => item.id), ["2", "3"]);
  const digest = createLocalDigest(values, 10);
  assert.deepEqual(new Set(digest.groups.map((group) => group.label)), new Set(["开发", "GitHub"]));
  assert.deepEqual(new Set(digest.sourceIds), new Set(["2", "3"]));
});

test("returns an empty actionable digest when all notifications are already read", () => {
  const digest = createLocalDigest([
    { id: "mail:1", source: "mail", title: "新邮件", body: "", createdAt: 2, unread: false, dedupeKey: "mail:1", level: "info", meta: {} }
  ], 3);
  assert.equal(digest.unreadCount, 0);
  assert.equal(digest.headline, "暂无新通知");
  assert.equal(digest.summary, "当前没有需要关注的新通知。");
  assert.deepEqual(digest.groups, []);
  assert.deepEqual(digest.sourceIds, []);
});
