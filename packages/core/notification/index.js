const { notificationTaxonomy } = require("@winplate/shared-types");
const SOURCE_ALIASES = {
  ...notificationTaxonomy.sourceAliases
};

const VALID_LEVELS = new Set(notificationTaxonomy.levels);
const VALID_SEVERITIES = new Set(["info", "warning", "danger"]);
const UNKNOWN_SOURCE = notificationTaxonomy.unknownSource;
const WEATHER_LIFECYCLE = notificationTaxonomy.weather.lifecycle;
const WEATHER_RESOLVED_RE = /解除|取消|撤销|终止|结束|失效|expired|cancel(?:led|ed)?|resolved|cleared/i;
const WEATHER_UPGRADED_RE = /升级|提升为|升为|upgrade/i;
const TASK_FAILURE_RE = /失败|错误|异常|崩溃|failed|failure|error|crash/i;
const CORE_FAILURE_RE = /(?:API|接口).*(?:连续|多次|反复).*(?:失败|错误|不可用)|(?:连续|多次|反复).*(?:API|接口).*(?:失败|错误|不可用)|核心模块.*(?:不可用|故障|失败)|core module.*(?:unavailable|failure|failed)|service unavailable/i;
const SEVERE_SYSTEM_RE = /严重错误|致命错误|系统崩溃|critical error|fatal error|system crash/i;
const WEATHER_ALERT_COLOR_MAP = new Map(
  Object.entries(notificationTaxonomy.weather.alertColors)
    .flatMap(([color, aliases]) => aliases.map((alias) => [alias, color]))
);
const WEATHER_RESOLVED_VALUES = new Set(WEATHER_LIFECYCLE.resolvedValues);
const WEATHER_UPGRADED_VALUES = new Set(WEATHER_LIFECYCLE.upgradedValues);
const {
  FOUR_HOURS_MS,
  conversationForNotificationId,
  foldNotificationConversations,
  normalizedConversationTitle
} = require("./conversations");
const { createNotificationManager: createBaseNotificationManager } = require("./manager");

function trimId(value, limit = 180) {
  return String(value || "").trim().slice(0, limit);
}

function text(value, limit = 500) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function normalizeSource(value) {
  return SOURCE_ALIASES[String(value || "").trim().toLowerCase()] || UNKNOWN_SOURCE;
}

function normalizeLevel(value) {
  const level = String(value || "info").toLowerCase();
  return VALID_LEVELS.has(level) ? level : "info";
}

function normalizeSeverity(value) {
  const severity = String(value || "").trim().toLowerCase();
  return VALID_SEVERITIES.has(severity) ? severity : null;
}

function weatherLifecycle(item, combinedText) {
  const metadata = item?.meta && typeof item.meta === "object"
    ? item.meta
    : item?.metadata && typeof item.metadata === "object"
      ? item.metadata
      : {};
  const explicit = text(metadata.lifecycle || metadata.status || item?.status, 40).toLowerCase();
  if (WEATHER_RESOLVED_VALUES.has(explicit) || WEATHER_RESOLVED_RE.test(combinedText)) {
    return "resolved";
  }
  if (WEATHER_UPGRADED_VALUES.has(explicit) || WEATHER_UPGRADED_RE.test(combinedText)) {
    return "upgraded";
  }
  return "issued";
}

function weatherAlertColor(item = {}) {
  if (normalizeSource(item.source) !== "qweather") return null;
  if (item.meta?.lifecycle === "resolved") return "green";
  const content = `${item.title || ""} ${item.body || item.message || ""}`;
  if (/红色预警|red alert/i.test(content)) return "red";
  if (/橙色预警|黄色预警|orange alert|yellow alert/i.test(content)) return "yellow";
  if (/蓝色预警|blue alert/i.test(content)) return "blue";
  if (/绿色预警|green alert/i.test(content)) return "green";
  const configured = String(item.meta?.alertColor || item.meta?.severity || item.meta?.color || "").toLowerCase();
  if (WEATHER_ALERT_COLOR_MAP.has(configured)) return WEATHER_ALERT_COLOR_MAP.get(configured);
  return null;
}

function deriveSourceId(item = {}, source, id, meta = {}) {
  const explicit = trimId(
    meta.sourceId
    || meta.messageId
    || meta.uid
    || meta.alertId
    || meta.threadId
    || item.sourceId
    || item.messageId
    || item.uid
    || item.alertId
    || item.threadId,
    180
  );
  if (explicit) return explicit;
  if (source === "mail" && id.startsWith("mail:")) return trimId(id.slice("mail:".length), 180);
  if (source === "qweather" && id.startsWith("qweather:")) return trimId(id.slice("qweather:".length), 180);
  if (source === "codex" && id.startsWith("codex:")) return trimId(id.slice("codex:".length), 180);
  if (source === "chatgpt" && id.startsWith("chatgpt:")) return trimId(id.slice("chatgpt:".length), 180);
  if (source === "github" && id.startsWith("github:")) return trimId(id.slice("github:".length), 180);
  return trimId(item.externalUrl || meta.externalUrl || id, 180);
}

function notificationRoute(source, sourceId) {
  if (source === "mail" && sourceId) return { moduleId: "mail", section: "Mail", sourceId };
  if (source === "qweather" && sourceId) return { moduleId: "weather", section: "QWeather", sourceId };
  return null;
}

function buildCopyText(item = {}) {
  return [item.title, item.body].filter(Boolean).join("\n\n").trim();
}

function getActionsForNotification(item = {}) {
  const notificationId = trimId(item.id, 180);
  const source = normalizeSource(item.source);
  const sourceId = trimId(item.sourceId, 180);
  const actions = [{
    id: `${notificationId}:view`,
    type: "view",
    label: "查看详情",
    payload: { notificationId }
  }];
  const route = notificationRoute(source, sourceId);
  if (route) {
    actions.push({
      id: `${notificationId}:navigate`,
      type: "navigate",
      label: "查看源模块",
      payload: {
        ...route,
        notificationId
      }
    });
  }
  const copyText = buildCopyText(item);
  if (copyText) {
    actions.push({
      id: `${notificationId}:copy`,
      type: "copy",
      label: "复制内容",
      payload: { text: copyText }
    });
  }
  actions.push({
    id: `${notificationId}:markRead`,
    type: "markRead",
    label: item.unread ? "标记已读" : "已读",
    payload: { notificationId }
  });
  return actions;
}

function normalizeRawNotification(item = {}, now = Date.now()) {
  const source = normalizeSource(item.source);
  const title = text(item.title || item.subject, 180);
  const body = text(item.body || item.message || item.summary || item.snippet, 500);
  const createdAt = Number(item.createdAt || item.sentAt || item.updatedAt || now);
  const combinedText = `${title} ${body}`;
  const rawMeta = item.meta && typeof item.meta === "object"
    ? item.meta
    : item.metadata && typeof item.metadata === "object"
      ? item.metadata
      : {};
  const meta = { ...rawMeta };
  const lifecycle = source === "qweather" ? weatherLifecycle({ ...item, meta }, combinedText) : null;
  const externalUrl = text(item.externalUrl || item.externalURL || meta.externalUrl, 500);
  if (externalUrl) meta.externalUrl = externalUrl;
  if (lifecycle) {
    meta.lifecycle = lifecycle;
    meta.riskDelta = lifecycle === "resolved" ? "decreased" : lifecycle === "upgraded" ? "increased" : "active";
  }
  const fallbackType = {
    qweather: "weather-alert",
    codex: "task-status",
    chatgpt: "task-status",
    github: "github-activity",
    mail: "mail",
    system: "system-status",
    external: "external"
  }[source];
  const type = lifecycle === "resolved" ? "weather-alert-resolved" : text(item.type || fallbackType, 80);
  const id = text(item.id || item.uid || `${source}:${createdAt}:${title}`, 180);
  const sourceId = deriveSourceId(item, source, id, meta);
  const dedupeKey = text(item.dedupeKey || meta.alertId || meta.threadId || sourceId || id, 180);
  let level = normalizeLevel(item.level);
  if (lifecycle === "resolved") level = "success";
  // Prefer local-api severity when present; otherwise leave unset for digest fallback.
  let severity = normalizeSeverity(item.severity ?? item.displaySeverity ?? meta.severity);
  if (lifecycle === "resolved") severity = "info";
  let alertColor = weatherAlertColor({ source, title, body, meta });
  if (alertColor) meta.alertColor = alertColor;
  if (source === "qweather") {
    if (alertColor === "red") level = "critical";
    else if (alertColor === "yellow") level = "warning";
    else if (alertColor === "blue") level = "info";
    else if (alertColor === "green" || lifecycle === "resolved") level = "success";
    if (!alertColor) {
      alertColor = level === "critical" ? "red" : level === "warning" ? "yellow" : level === "success" ? "green" : "blue";
      meta.alertColor = alertColor;
    }
  } else if (source === "mail") {
    level = "info";
    alertColor = "blue";
    meta.alertColor = alertColor;
  } else {
    if (["codex", "chatgpt"].includes(source) && TASK_FAILURE_RE.test(combinedText) && level !== "critical") {
      level = "warning";
    }
    if (source === "system") {
      if (CORE_FAILURE_RE.test(combinedText) || SEVERE_SYSTEM_RE.test(combinedText)) level = "critical";
      else if (TASK_FAILURE_RE.test(combinedText) && level === "info") level = "warning";
    }
    alertColor = level === "critical" ? "red" : level === "warning" ? "yellow" : "green";
    meta.alertColor = alertColor;
  }
  const notification = {
    schemaVersion: 1,
    id,
    source,
    sourceId,
    type,
    title: title || "WinPlate 通知",
    body,
    level,
    createdAt: Number.isFinite(createdAt) ? createdAt : now,
    unread: Boolean(item.unread),
    dedupeKey,
    meta
  };
  if (severity) notification.severity = severity;
  notification.actions = getActionsForNotification(notification);
  return notification;
}

function createNotificationManager(options = {}) {
  return createBaseNotificationManager({
    ...options,
    normalizeNotification: normalizeRawNotification
  });
}

module.exports = {
  FOUR_HOURS_MS,
  createNotificationManager,
  buildCopyText,
  conversationForNotificationId,
  foldNotificationConversations,
  getActionsForNotification,
  normalizedConversationTitle,
  normalizeLevel,
  normalizeSeverity,
  normalizeRawNotification,
  normalizeSource,
  notificationRoute,
  weatherAlertColor,
  weatherLifecycle
};
