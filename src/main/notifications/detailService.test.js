const test = require("node:test");
const assert = require("node:assert/strict");

const { createNotificationDetailService } = require("./detailService");

test("notification detail service resolves mail details and navigation actions", async () => {
  const service = createNotificationDetailService({
    loadNotifications: async () => ({
      items: [{
        id: "mail:m1",
        source: "mail",
        title: "新邮件：Launch",
        message: "Kiko <kiko@qq.com>",
        unread: true,
        createdAt: 100
      }]
    }),
    fetchMailMessage: async () => ({
      uid: "m1",
      subject: "Launch",
      from: "Kiko <kiko@qq.com>",
      to: "team@example.com",
      date: "2026-06-22 09:00",
      textBody: "Full launch checklist",
      unread: true
    }),
    fetchWeatherAlert: async () => null
  });

  const payload = await service.getNotificationDetail("mail:m1");
  assert.equal(payload.detail.kind, "mail");
  assert.equal(payload.detail.body, "Full launch checklist");
  assert.deepEqual(payload.actions.map((action) => action.type), ["view", "navigate", "copy", "markRead"]);

  const navigate = await service.resolveNavigation(payload.actions.find((action) => action.type === "navigate"));
  assert.deepEqual(navigate.payload, {
    moduleId: "mail",
    section: "Mail",
    source: "mail",
    sourceId: "m1",
    notificationId: "mail:m1"
  });
});

test("notification detail service resolves qweather alerts and fallback notifications", async () => {
  const service = createNotificationDetailService({
    loadNotifications: async () => ({
      items: [
        {
          id: "qweather:a1",
          source: "qweather",
          title: "暴雨预警",
          message: "请减少外出",
          unread: true,
          createdAt: 200
        },
        {
          id: "codex:done",
          source: "codex",
          title: "Codex 任务完成",
          message: "已生成报告",
          unread: false,
          createdAt: 300
        }
      ]
    }),
    fetchMailMessage: async () => null,
    fetchWeatherAlert: async () => ({
      id: "a1",
      title: "暴雨预警",
      body: "未来两小时有强降雨",
      lifecycle: "issued",
      severity: "red",
      createdAt: 200
    })
  });

  const weather = await service.getNotificationDetail("qweather:a1");
  assert.equal(weather.detail.kind, "weather-alert");
  assert.equal(weather.detail.body, "未来两小时有强降雨");
  assert.equal(weather.actions.find((action) => action.type === "navigate").payload.section, "QWeather");

  const fallback = await service.getNotificationDetail("codex:done");
  assert.equal(fallback.detail.kind, "task-status");
  assert.deepEqual(fallback.actions.map((action) => action.type), ["view", "copy", "markRead"]);
});

test("notification detail service falls back when a source resolver is unavailable", async () => {
  const service = createNotificationDetailService({
    loadNotifications: async () => ({
      items: [{
        id: "mail:m2",
        source: "mail",
        title: "新邮件：Fallback",
        message: "通知正文仍然可用",
        unread: true,
        createdAt: 400
      }]
    }),
    fetchMailMessage: async () => {
      throw new Error("IMAP offline");
    },
    fetchWeatherAlert: async () => null
  });

  const payload = await service.getNotificationDetail("mail:m2");
  assert.equal(payload.detail.kind, "mail");
  assert.equal(payload.detail.body, "通知正文仍然可用");
  assert.equal(payload.detail.sourcePayload.resolverError, "IMAP offline");
  assert.deepEqual(payload.actions.map((action) => action.type), ["view", "navigate", "copy", "markRead"]);
});
