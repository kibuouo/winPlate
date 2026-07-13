const crypto = require("crypto");
const { foldNotificationConversations } = require("../notification/conversations");

const GROUPS = [
  { key: "weather", label: "天气", sources: new Set(["qweather"]) },
  { key: "development", label: "开发", sources: new Set(["codex", "chatgpt"]) },
  { key: "mail", label: "邮件", sources: new Set(["mail"]) },
  { key: "github", label: "GitHub", sources: new Set(["github"]) },
  { key: "system", label: "系统", sources: new Set(["system"]) }
];

const LEVEL_SCORE = { critical: 400, warning: 300, info: 200, success: 100 };
const PRIORITY_BY_SCORE = [
  [400, "critical"],
  [300, "high"],
  [200, "normal"],
  [0, "low"]
];
const SEVERITY_RANK = { info: 0, warning: 1, danger: 2 };
const DANGER_WEATHER_RE = /红色预警|橙色预警|red alert|orange alert/i;
const WARNING_WEATHER_RE = /黄色预警|蓝色预警|yellow alert|blue alert/i;
const TASK_FAILURE_RE = /失败|错误|异常|崩溃|failed|failure|error|crash/i;
const CORE_FAILURE_RE = /(?:API|接口).*(?:连续|多次|反复).*(?:失败|错误|不可用)|(?:连续|多次|反复).*(?:API|接口).*(?:失败|错误|不可用)|核心模块.*(?:不可用|故障|失败)|core module.*(?:unavailable|failure|failed)|service unavailable/i;
const SEVERE_SYSTEM_RE = /严重错误|致命错误|系统崩溃|critical error|fatal error|system crash/i;

function severityForNotification(item = {}) {
  const source = String(item.source || "system");
  const content = `${item.title || ""} ${item.body || ""}`;
  if (source === "qweather") {
    if (item.meta?.lifecycle === "resolved") return "info";
    if (DANGER_WEATHER_RE.test(content)) return "danger";
    if (WARNING_WEATHER_RE.test(content)) return "warning";
    if (item.level === "critical") return "danger";
    if (item.level === "warning") return "warning";
    return "info";
  }
  if (CORE_FAILURE_RE.test(content)) return "danger";
  if (source === "mail") return "info";
  if (source === "codex" || source === "chatgpt") return TASK_FAILURE_RE.test(content) ? "warning" : "info";
  if (source === "system") {
    if (item.level === "critical" || SEVERE_SYSTEM_RE.test(content)) return "danger";
    if (item.level === "warning" || TASK_FAILURE_RE.test(content)) return "warning";
    return "info";
  }
  if (item.level === "critical") return "danger";
  if (item.level === "warning") return "warning";
  return "info";
}

function highestSeverity(items = []) {
  return items.reduce((highest, item) => {
    const severity = typeof item === "string" ? item : severityForNotification(item);
    return (SEVERITY_RANK[severity] || 0) > (SEVERITY_RANK[highest] || 0) ? severity : highest;
  }, "info");
}

function scoreNotification(item, now = Date.now()) {
  let score = LEVEL_SCORE[item.level] || LEVEL_SCORE.info;
  const lifecycle = item.meta?.lifecycle;
  if (item.source === "qweather" && lifecycle === "resolved") score = 80;
  else if (item.source === "qweather" && lifecycle === "upgraded") score += 160;
  else if (item.source === "qweather") score += 80;
  if (["codex", "chatgpt"].includes(item.source) && /失败|错误|异常|failed|error/i.test(`${item.title} ${item.body}`)) score += 90;
  if (item.source === "mail" && item.unread) score += 30;
  if (now - item.createdAt < 10 * 60_000) score += 20;
  return score;
}

function dedupeNotifications(items) {
  const byKey = new Map();
  for (const item of items) {
    const key = `${item.source}:${item.dedupeKey || item.id}`;
    const previous = byKey.get(key);
    if (!previous || item.createdAt >= previous.createdAt) byKey.set(key, item);
  }
  return [...byKey.values()];
}

function groupForSource(source) {
  return GROUPS.find((group) => group.sources.has(source)) || GROUPS[GROUPS.length - 1];
}

function groupSummary(group, items) {
  const resolvedWeather = group.key === "weather" && items.every((item) => item.meta?.lifecycle === "resolved");
  if (resolvedWeather) return `${items.length} 条预警已解除，风险降低`;
  const unread = items.filter((item) => item.unread).length;
  const top = items[0];
  if (items.length === 1) return top.body || top.title;
  return `${items.length} 条动态${unread ? `，${unread} 条未读` : ""}；重点：${top.title}`;
}

function buildGroups(items, now = Date.now()) {
  const grouped = new Map();
  for (const item of items) {
    const group = groupForSource(item.source);
    if (!grouped.has(group.key)) grouped.set(group.key, { definition: group, items: [] });
    grouped.get(group.key).items.push(item);
  }
  return GROUPS.filter((definition) => grouped.has(definition.key)).map((definition) => {
    const groupItems = grouped.get(definition.key).items
      .sort((a, b) => scoreNotification(b, now) - scoreNotification(a, now) || b.createdAt - a.createdAt);
    const topScore = scoreNotification(groupItems[0], now);
    return {
      key: definition.key,
      label: definition.label,
      count: groupItems.length,
      unreadCount: groupItems.filter((item) => item.unread).length,
      priority: PRIORITY_BY_SCORE.find(([threshold]) => topScore >= threshold)?.[1] || "low",
      severity: highestSeverity(groupItems),
      summary: groupSummary(definition, groupItems),
      sourceIds: groupItems.map((item) => item.id)
    };
  }).sort((a, b) => {
    const aTop = Math.max(...a.sourceIds.map((id) => scoreNotification(items.find((item) => item.id === id), now)));
    const bTop = Math.max(...b.sourceIds.map((id) => scoreNotification(items.find((item) => item.id === id), now)));
    return bTop - aTop;
  });
}

function localHeadline(items) {
  if (!items.length) return "暂无新通知";
  const top = items[0];
  if (top.source === "qweather" && top.meta?.lifecycle === "resolved") return "天气预警已解除，风险降低";
  if (top.source === "qweather" && top.meta?.lifecycle === "upgraded") return "天气预警升级，请注意防范";
  if (top.source === "qweather") return "有新的天气预警需要关注";
  if (top.source === "codex" && /失败|错误|异常|failed|error/i.test(`${top.title} ${top.body}`)) return "开发任务出现异常，需要检查";
  if (top.source === "chatgpt" && /失败|错误|异常|failed|error/i.test(`${top.title} ${top.body}`)) return "ChatGPT 任务出现异常，需要检查";
  if (top.source === "codex") return "开发任务有新进展";
  if (top.source === "chatgpt") return "ChatGPT 任务有新进展";
  if (top.source === "mail") return "有新邮件需要查看";
  if (top.source === "github") return "GitHub 有新的动态";
  return "系统状态有新的变化";
}

function categoryForSource(source) {
  return groupForSource(source).key;
}

function createLocalDigest(rawItems, now = Date.now()) {
  const items = dedupeNotifications(foldNotificationConversations(rawItems))
    .sort((a, b) => scoreNotification(b, now) - scoreNotification(a, now) || b.createdAt - a.createdAt);
  const unreadItems = items.filter((item) => item.unread);
  if (!unreadItems.length) {
    return {
      title: "暂无新通知",
      headline: "暂无新通知",
      summary: "当前没有需要关注的新通知。",
      priority: "none",
      severity: "info",
      category: "system",
      iconKey: "bell",
      primarySource: "system",
      unreadCount: 0,
      groups: [],
      spokenText: "当前没有需要关注的新通知。",
      sourceIds: []
    };
  }
  const groups = buildGroups(unreadItems, now);
  const headline = localHeadline(unreadItems);
  const summary = groups.map((group) => `${group.label}：${group.summary}`).join("；");
  const topScore = scoreNotification(unreadItems[0], now);
  return {
    title: headline,
    headline,
    summary,
    priority: PRIORITY_BY_SCORE.find(([threshold]) => topScore >= threshold)?.[1] || "low",
    severity: highestSeverity(unreadItems),
    category: categoryForSource(unreadItems[0].source),
    iconKey: "bell",
    primarySource: unreadItems[0].source,
    unreadCount: unreadItems.length,
    groups,
    spokenText: `${headline}。${summary}`,
    sourceIds: unreadItems.map((item) => item.id)
  };
}

function digestHash(items) {
  const value = (Array.isArray(items) ? items : []).map((item) => [
    item.id, item.source, item.type, item.title, item.body, item.level,
    item.createdAt, item.unread, item.dedupeKey, item.meta?.lifecycle
  ].join("\u001f")).join("\u001e");
  return crypto.createHash("sha256").update(value).digest("hex");
}

module.exports = {
  GROUPS,
  buildGroups,
  categoryForSource,
  createLocalDigest,
  dedupeNotifications,
  digestHash,
  highestSeverity,
  severityForNotification,
  scoreNotification
};
