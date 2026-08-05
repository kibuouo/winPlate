const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeRawNotification } = require("@winplate/core/notification");
const {
  createLocalDigest,
  dedupeNotifications,
  highestSeverity,
  severityForNotification
} = require("@winplate/core/digest");

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
    "schemaVersion", "id", "source", "sourceId", "type", "title", "body", "level", "createdAt", "unread", "dedupeKey", "meta", "actions"
  ]);
  assert.equal(item.severity, undefined);
  assert.equal(item.schemaVersion, 1);
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

test("maps source semantics to the requested notification tiers", () => {
  const item = (source, title, level = "info", metadata = {}) =>
    normalizeRawNotification({ source, title, level, metadata });
  assert.equal(severityForNotification(item("qweather", "暴雨红色预警")), "danger");
  // Orange matches yellow/blue band (warning), not red danger — same as Windows weather cards.
  assert.equal(severityForNotification(item("qweather", "暴雨橙色预警")), "warning");
  assert.equal(severityForNotification(item("qweather", "高温黄色预警")), "warning");
  assert.equal(severityForNotification(item("qweather", "大风蓝色预警")), "info");
  assert.equal(severityForNotification(item("qweather", "天气转多云")), "info");
  assert.equal(severityForNotification(item("qweather", "暴雨橙色预警", "warning", { severity: "orange", lifecycle: "issued" })), "warning");
  // QWeather maps orange → "severe"; must stay warning, not red danger.
  assert.equal(severityForNotification(item("qweather", "高温橙色预警", "critical", { severity: "severe", lifecycle: "issued" })), "warning");
  assert.equal(severityForNotification(item("qweather", "暴雨红色预警", "critical", { severity: "red", lifecycle: "issued" })), "danger");
  assert.equal(severityForNotification(item("qweather", "暴雨红色预警", "critical", { severity: "extreme", lifecycle: "issued" })), "danger");
  assert.equal(severityForNotification(item("mail", "新邮件：Launch")), "info");
  assert.equal(severityForNotification(item("codex", "Codex 任务完成")), "info");
  assert.equal(severityForNotification(item("chatgpt", "ChatGPT 任务完成")), "info");
  assert.equal(severityForNotification(item("codex", "Codex 任务失败")), "warning");
  assert.equal(severityForNotification(item("chatgpt", "ChatGPT 任务失败")), "warning");
  assert.equal(severityForNotification(item("system", "系统发生严重错误")), "danger");
  assert.equal(severityForNotification(item("system", "API 连续失败")), "danger");
  assert.equal(severityForNotification(item("system", "核心模块不可用")), "danger");
});

test("prefers API-authored severity over local heuristics", () => {
  assert.equal(severityForNotification({
    source: "qweather",
    title: "暴雨红色预警",
    body: "",
    level: "critical",
    severity: "warning",
    meta: {}
  }), "warning");
  const normalized = normalizeRawNotification({
    id: "qweather:a1",
    source: "qweather",
    title: "暴雨红色预警解除",
    message: "本轮强降雨过程结束",
    level: "success",
    severity: "info",
    metadata: { lifecycle: "resolved", severity: "red" },
    unread: true,
    createdAt: 200
  });
  assert.equal(normalized.severity, "info");
  assert.equal(normalized.meta.lifecycle, "resolved");
  assert.equal(severityForNotification(normalized), "info");
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

test("preserves the QWeather alert color for the renderer", () => {
  const weather = normalizeRawNotification({
    id: "qweather:yellow",
    source: "qweather",
    title: "暴雨预警",
    level: "warning",
    unread: true,
    createdAt: 200,
    metadata: { severity: "yellow" }
  });
  assert.equal(weather.meta.severity, "yellow");
  assert.equal(createLocalDigest([weather], 300).alertColor, "yellow");
  assert.equal(createLocalDigest([{
    ...weather,
    level: "success",
    meta: { ...weather.meta, lifecycle: "resolved", alertColor: "green" }
  }], 300).alertColor, "green");
});

test("normalizes QWeather alert colors into the requested notification tiers", () => {
  const sample = (severity) => normalizeRawNotification({
    id: `qweather:${severity}`,
    source: "qweather",
    title: `${severity} alert`,
    level: "critical",
    unread: true,
    metadata: { severity }
  });
  assert.deepEqual(
    ["red", "orange", "yellow", "blue", "green"].map((severity) => {
      const item = sample(severity);
      return [item.meta.alertColor, item.level];
    }),
    [["red", "critical"], ["yellow", "warning"], ["yellow", "warning"], ["blue", "info"], ["green", "success"]]
  );
  const mail = normalizeRawNotification({ source: "mail", title: "New mail", level: "critical" });
  assert.deepEqual([mail.meta.alertColor, mail.level], ["blue", "info"]);
  assert.deepEqual(
    [
      normalizeRawNotification({ source: "codex", title: "Done", level: "success" }).meta.alertColor,
      normalizeRawNotification({ source: "chatgpt", title: "Reply", level: "info" }).meta.alertColor,
      normalizeRawNotification({ source: "system", title: "Failure", level: "warning" }).meta.alertColor
    ],
    ["green", "green", "yellow"]
  );
  const orangeWithGenericSeverity = normalizeRawNotification({
    source: "qweather",
    title: "强对流橙色预警",
    level: "critical",
    metadata: { severity: "severe" }
  });
  assert.deepEqual([orangeWithGenericSeverity.meta.alertColor, orangeWithGenericSeverity.level], ["yellow", "warning"]);
});

test("deduplicates by source and dedupeKey and builds the requested groups", () => {
  const values = [
    { id: "1", source: "codex", title: "old", createdAt: 1, unread: true, dedupeKey: "task", level: "info", meta: {} },
    { id: "2", source: "codex", title: "done", createdAt: 2, unread: true, dedupeKey: "task", level: "success", meta: {} },
    { id: "3", source: "chatgpt", title: "chat reply", createdAt: 3, unread: true, dedupeKey: "chat", level: "info", meta: {} },
    { id: "4", source: "github", title: "PR review", createdAt: 4, unread: true, dedupeKey: "pr", level: "info", meta: {} }
  ];
  assert.deepEqual(dedupeNotifications(values).map((item) => item.id), ["2", "3", "4"]);
  const digest = createLocalDigest(values, 10);
  assert.deepEqual(new Set(digest.groups.map((group) => group.label)), new Set(["Codex", "ChatGPT", "GitHub"]));
  assert.deepEqual(new Set(digest.sourceIds), new Set(["2", "3", "4"]));
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
