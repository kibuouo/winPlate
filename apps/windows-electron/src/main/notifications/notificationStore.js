const SOURCE_ALIASES = {
  weather: "qweather",
  qweather: "qweather",
  codex: "codex",
  chatgpt: "chatgpt",
  openai: "chatgpt",
  github: "github",
  mail: "mail",
  email: "mail",
  system: "system",
  local: "system",
  external: "system"
};

const VALID_LEVELS = new Set(["info", "success", "warning", "critical"]);
const WEATHER_RESOLVED_RE = /解除|取消|撤销|终止|结束|失效|expired|cancel(?:led|ed)?|resolved|cleared/i;
const WEATHER_UPGRADED_RE = /升级|提升为|升为|upgrade/i;

function trimId(value, limit = 180) {
  return String(value || "").trim().slice(0, limit);
}

function text(value, limit = 500) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function normalizeSource(value) {
  return SOURCE_ALIASES[String(value || "").trim().toLowerCase()] || "system";
}

function normalizeLevel(value) {
  const level = String(value || "info").toLowerCase();
  return VALID_LEVELS.has(level) ? level : "info";
}

function weatherLifecycle(item, combinedText) {
  const explicit = text(item?.meta?.lifecycle || item?.meta?.status || item?.status, 40).toLowerCase();
  if (["resolved", "cancelled", "canceled", "expired", "cleared"].includes(explicit) || WEATHER_RESOLVED_RE.test(combinedText)) {
    return "resolved";
  }
  if (["upgraded", "upgrade"].includes(explicit) || WEATHER_UPGRADED_RE.test(combinedText)) {
    return "upgraded";
  }
  return "issued";
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
  const lifecycle = source === "qweather" ? weatherLifecycle(item, combinedText) : null;
  const meta = item.meta && typeof item.meta === "object" ? { ...item.meta } : {};
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
    system: "system-status"
  }[source];
  const type = lifecycle === "resolved" ? "weather-alert-resolved" : text(item.type || fallbackType, 80);
  const id = text(item.id || item.uid || `${source}:${createdAt}:${title}`, 180);
  const sourceId = deriveSourceId(item, source, id, meta);
  const dedupeKey = text(item.dedupeKey || meta.alertId || meta.threadId || sourceId || id, 180);
  let level = normalizeLevel(item.level);
  if (lifecycle === "resolved") level = "success";
  const notification = {
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
  notification.actions = getActionsForNotification(notification);
  return notification;
}

function createNotificationStore({ loadNotifications, now = () => Date.now() }) {
  if (typeof loadNotifications !== "function") throw new TypeError("loadNotifications is required");
  return {
    async collect() {
      const payload = await loadNotifications();
      const rawItems = Array.isArray(payload?.items) ? payload.items : [];
      const items = rawItems
        .map((item) => normalizeRawNotification(item, now()))
        .filter((item) => item.id && (item.title || item.body));
      return {
        items,
        unreadCount: items.filter((item) => item.unread).length,
        updatedAt: Number(payload?.updatedAt) || now()
      };
    }
  };
}

module.exports = {
  createNotificationStore,
  buildCopyText,
  getActionsForNotification,
  normalizeLevel,
  normalizeRawNotification,
  normalizeSource,
  notificationRoute,
  weatherLifecycle
};
