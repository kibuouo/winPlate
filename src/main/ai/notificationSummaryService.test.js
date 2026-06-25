const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildSummaryPrompt,
  createNotificationSummaryService,
  parseStructuredDigest,
  validateSummaryResult
} = require("./notificationSummaryService");
const { createLocalDigest } = require("../notifications/digestEngine");

const raw = [{
  id: "codex:1", source: "codex", type: "task-status", title: "Codex 完成", body: "测试通过",
  level: "success", createdAt: 1, unread: true, dedupeKey: "codex:1", meta: {}
}];

test("requests strict JSON and validates the digest shape", () => {
  const local = createLocalDigest(raw, 2);
  const prompt = buildSummaryPrompt(raw, local);
  assert.match(prompt[0].content, /只返回一个 JSON 对象/);
  assert.match(prompt[0].content, /禁止返回 SVG、HTML/);
  const parsed = parseStructuredDigest(JSON.stringify({
    title: "开发任务已完成",
    summary: "Codex 测试已通过。",
    severity: "info",
    category: "development",
    iconKey: "check-circle",
    unreadCount: 1
  }), local);
  assert.equal(parsed.headline, "开发任务已完成");
  assert.equal(parsed.title, "开发任务已完成");
  assert.equal(parsed.iconKey, "check-circle");
  assert.deepEqual(parsed.groups, local.groups);
  assert.throws(() => parseStructuredDigest("free text", local));
});

test("validateSummaryResult rejects invalid severity and whitelists iconKey", () => {
  const local = createLocalDigest(raw, 2);
  const invalidIcon = validateSummaryResult({
    title: "开发摘要",
    summary: "内容安全。",
    severity: "info",
    category: "development",
    iconKey: '<svg onload="alert(1)">',
    unreadCount: 1,
    svg: "<svg>not allowed</svg>",
    html: "<img src=x>"
  }, local);
  assert.equal(invalidIcon.iconKey, "bell");
  assert.equal(invalidIcon.svg, undefined);
  assert.equal(invalidIcon.html, undefined);
  assert.throws(() => validateSummaryResult({
    title: "bad", summary: "bad", severity: "urgent", category: "system", iconKey: "bell", unreadCount: 1
  }, local), /字段无效/);
});

test("AI failure returns a complete local digest", async () => {
  const service = createNotificationSummaryService({
    store: { collect: async () => ({ items: raw }) },
    callChat: async () => { throw new Error("offline"); },
    now: () => 10
  });
  const digest = await service.getDigest();
  assert.equal(digest.source, "local");
  assert.ok(digest.headline);
  assert.ok(digest.summary);
  assert.equal(digest.unreadCount, 1);
});

test("debounces multiple refresh signals into one AI request", async () => {
  let calls = 0;
  const service = createNotificationSummaryService({
    store: { collect: async () => ({ items: raw }) },
    callChat: async () => {
      calls += 1;
      return JSON.stringify({ title: "完成", summary: "任务完成。", severity: "info", category: "development", iconKey: "check-circle", unreadCount: 1 });
    },
    debounceMs: 10,
    now: () => 10
  });
  await Promise.all([service.scheduleRefresh(), service.scheduleRefresh(), service.scheduleRefresh()]);
  assert.equal(calls, 1);
});

test("uses the complete local digest when AI summaries are disabled", async () => {
  let calls = 0;
  const service = createNotificationSummaryService({
    store: {
      collect: async () => ({
        items: [{
          id: "mail:1",
          source: "mail",
          type: "mail",
          title: "课程通知",
          body: "明天上课",
          level: "info",
          createdAt: Date.now(),
          unread: true,
          dedupeKey: "mail:1",
          meta: {}
        }]
      })
    },
    shouldUseAi: () => false,
    callChat: async () => {
      calls += 1;
      return {};
    }
  });
  const digest = await service.refreshNow({ force: true });
  assert.equal(calls, 0);
  assert.equal(digest.source, "local");
  assert.equal(digest.unreadCount, 1);
});

test("skips AI summaries when there are no unread notifications", async () => {
  let calls = 0;
  const service = createNotificationSummaryService({
    store: {
      collect: async () => ({
        items: [{
          id: "mail:1",
          source: "mail",
          type: "mail",
          title: "课程通知",
          body: "明天上课",
          level: "info",
          createdAt: Date.now(),
          unread: false,
          dedupeKey: "mail:1",
          meta: {}
        }]
      })
    },
    callChat: async () => {
      calls += 1;
      return {};
    }
  });
  const digest = await service.refreshNow({ force: true });
  assert.equal(calls, 0);
  assert.equal(digest.source, "local");
  assert.equal(digest.unreadCount, 0);
  assert.equal(digest.headline, "暂无新通知");
});

test("persists DeepSeek-generated digests with timestamped content", async () => {
  const persisted = [];
  const service = createNotificationSummaryService({
    store: { collect: async () => ({ items: raw }) },
    callChat: async () => JSON.stringify({
      title: "开发任务已完成",
      summary: "Codex 测试已通过。",
      severity: "info",
      category: "development",
      iconKey: "check-circle",
      unreadCount: 1
    }),
    persistDigest: async (payload) => {
      persisted.push(payload);
    },
    aiModel: "deepseek-v4-flash",
    now: () => 123456
  });

  const digest = await service.refreshNow({ force: true });
  assert.equal(digest.source, "ai");
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].digest.generatedAt, 123456);
  assert.equal(persisted[0].digest.summary, "Codex 测试已通过。");
  assert.equal(persisted[0].model, "deepseek-v4-flash");
});
