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

function normalizeRawNotification(item = {}, now = Date.now()) {
  const source = normalizeSource(item.source);
  const title = text(item.title || item.subject, 180);
  const body = text(item.body || item.message || item.summary || item.snippet, 500);
  const createdAt = Number(item.createdAt || item.sentAt || item.updatedAt || now);
  const combinedText = `${title} ${body}`;
  const lifecycle = source === "qweather" ? weatherLifecycle(item, combinedText) : null;
  const meta = item.meta && typeof item.meta === "object" ? { ...item.meta } : {};
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
  const dedupeKey = text(item.dedupeKey || meta.alertId || meta.threadId || id, 180);
  let level = normalizeLevel(item.level);
  if (lifecycle === "resolved") level = "success";
  return {
    id,
    source,
    type,
    title: title || "WinPlate 通知",
    body,
    level,
    createdAt: Number.isFinite(createdAt) ? createdAt : now,
    unread: Boolean(item.unread),
    dedupeKey,
    meta
  };
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
  normalizeLevel,
  normalizeRawNotification,
  normalizeSource,
  weatherLifecycle
};
