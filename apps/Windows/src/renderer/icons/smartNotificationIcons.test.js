const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ICON_KEYS,
  SMART_NOTIFICATION_ICON_REGISTRY,
  renderSmartNotificationIcon,
  resolveSmartNotificationIcon
} = require("./smartNotificationIcons");

test("registers the complete local smart notification icon whitelist", () => {
  assert.deepEqual(new Set(Object.keys(SMART_NOTIFICATION_ICON_REGISTRY)), new Set(ICON_KEYS));
  for (const key of ICON_KEYS) {
    assert.match(renderSmartNotificationIcon(key), new RegExp(`data-icon-key="${key}"`));
  }
  assert.match(renderSmartNotificationIcon("<script>"), /data-icon-key="bell"/);
});

test("resolves content rules before AI iconKey", () => {
  const cases = [
    ["暴雨红色预警", "cloud-rain-alert"], ["雷暴警告", "cloud-lightning"], ["台风大风", "wind"],
    ["高温酷暑", "thermometer-sun"], ["低温冰冻", "thermometer-snowflake"],
    ["新邮件进入收件箱", "mail-unread"], ["重要邮件", "mail-warning"], ["含附件", "paperclip"],
    ["Codex 任务完成", "check-circle"], ["ChatGPT 任务失败", "x-circle"],
    ["GitHub Pull Request", "git-pull-request"], ["GitHub Issue", "github"],
    ["API 不可用", "plug"], ["余额不足", "wallet"], ["网络断开", "wifi"],
    ["CPU 过高", "cpu"], ["内存不足", "memory-stick"]
  ];
  for (const [title, expected] of cases) {
    assert.equal(resolveSmartNotificationIcon({ title, iconKey: "star" }), expected, title);
  }
});

test("uses whitelisted AI keys, then source defaults, then bell", () => {
  assert.equal(resolveSmartNotificationIcon({ title: "普通动态", iconKey: "tag" }), "tag");
  assert.equal(resolveSmartNotificationIcon({ title: "普通动态", source: "chatgpt" }), "chatgpt");
  assert.equal(resolveSmartNotificationIcon({ title: "普通动态", source: "codex" }), "codex");
  assert.equal(resolveSmartNotificationIcon({ title: "普通危险动态", severity: "danger", iconKey: "tag" }), "x-circle");
  assert.equal(resolveSmartNotificationIcon({ title: "普通预警动态", severity: "warning", iconKey: "tag" }), "bell");
  assert.equal(resolveSmartNotificationIcon({ title: "普通动态", iconKey: "<svg>", source: "mail" }), "mail");
  assert.equal(resolveSmartNotificationIcon({ title: "普通动态", iconKey: "<svg>" }), "bell");
  assert.equal(renderSmartNotificationIcon("<script>"), renderSmartNotificationIcon("bell"));
});
