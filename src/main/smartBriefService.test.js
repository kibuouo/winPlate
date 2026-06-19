const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildSmartBriefPrompt,
  createSmartBriefService,
  fallbackBrief,
  normalizeNotificationSummary,
  parseSmartBriefResponse,
  sanitizeNotificationForAI,
  selectCandidateNotifications
} = require("./smartBriefService");

const mockItems = [
  {
    id: "weather-001",
    source: "weather",
    title: "武汉市气象台发布暴雨黄色预警",
    body: "武汉市气象台2026年6月18日21时33分发布暴雨黄色预警，预计今晚局部有强降雨。",
    level: "warning",
    time: 1781793180000
  },
  {
    id: "mail-001",
    source: "mail",
    sender: "Riot Games",
    subject: "Just checking-was this you?",
    snippet: "We noticed a recent account activity...",
    unread: true,
    level: "info",
    time: 1781793300000,
    body: "full body should not be sent",
    meta: { authorization: "secret" }
  },
  {
    id: "codex-001",
    source: "codex",
    title: "Codex 任务完成",
    body: "WinPlate 已收到一条本地测试通知",
    level: "success",
    time: 1781793400000
  }
];

test("normalizes and ranks mock notifications for smart brief generation", () => {
  const normalized = normalizeNotificationSummary({ items: mockItems });
  const candidates = selectCandidateNotifications(normalized, 1781793500000);

  assert.equal(candidates[0].source, "weather");
  assert.equal(candidates[1].source, "codex");
  assert.equal(candidates[2].source, "mail");
});

test("sanitizes mail notifications before AI prompts", () => {
  const sanitized = sanitizeNotificationForAI(normalizeNotificationSummary({ items: mockItems })[1]);

  assert.equal(sanitized.sender, "Riot Games");
  assert.equal(sanitized.subject, "Just checking-was this you?");
  assert.equal(sanitized.snippet, "We noticed a recent account activity...");
  assert.equal(sanitized.body, undefined);
  assert.equal(sanitized.meta, undefined);
});

test("builds a JSON-only prompt without mail body fields", () => {
  const messages = buildSmartBriefPrompt(normalizeNotificationSummary({ items: mockItems }));
  const userPayload = JSON.parse(messages[1].content);

  assert.equal(messages[0].role, "system");
  assert.match(messages[0].content, /你必须只输出 JSON/);
  assert.equal(userPayload.maxTextLength, 28);
  assert.equal(userPayload.notifications[1].body, undefined);
  assert.equal(userPayload.notifications[1].sender, "Riot Games");
});

test("parses and clamps DeepSeek smart brief JSON", () => {
  const items = parseSmartBriefResponse(JSON.stringify({
    items: [{
      id: "brief-mail-001",
      sourceIds: ["mail-001", "unknown"],
      text: "这是一条特别特别特别特别特别特别特别长的通知",
      level: "bad",
      source: "mail",
      actionType: "open_mail"
    }]
  }), normalizeNotificationSummary({ items: mockItems }), 123);

  assert.equal(items.length, 1);
  assert.ok(Array.from(items[0].text).length <= 28);
  assert.deepEqual(items[0].sourceIds, ["mail-001"]);
  assert.equal(items[0].level, "info");
});

test("fallback brief handles the required mock notifications", () => {
  const items = fallbackBrief(normalizeNotificationSummary({ items: mockItems }), 123);

  assert.equal(items[0].text, "暴雨预警：注意出行");
  assert.equal(items[1].text, "新邮件：Riot Games 发来消息");
  assert.equal(items[2].text, "Codex：任务已完成");
});

test("service reuses cache when notification content is unchanged", async () => {
  let calls = 0;
  const service = createSmartBriefService({
    readNotifications: async () => ({ items: mockItems }),
    callChat: async () => {
      calls += 1;
      return JSON.stringify({
        items: [{
          id: "brief-weather-001",
          sourceIds: ["weather-001"],
          text: "暴雨预警：武汉今晚注意积水",
          level: "warning",
          source: "weather",
          actionType: "open_weather"
        }]
      });
    },
    now: () => 1781793500000
  });

  const first = await service.getCurrentBrief();
  const second = await service.getCurrentBrief();

  assert.equal(calls, 1);
  assert.equal(first.items[0].text, "暴雨预警：武汉今晚注意积水");
  assert.equal(second.source, "cache-hit");
});
