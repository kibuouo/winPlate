const {
  buildCopyText,
  getActionsForNotification,
  normalizeRawNotification,
  notificationRoute
} = require("./notificationStore");

function metadataEntries(entries = []) {
  return entries.filter((entry) => entry && entry.value !== undefined && entry.value !== null && entry.value !== "");
}

function sourceLabel(source) {
  return {
    mail: "Mail",
    qweather: "Weather",
    codex: "Codex",
    chatgpt: "ChatGPT",
    github: "GitHub",
    system: "系统"
  }[source] || "WinPlate";
}

function enrichActions(notification, detail) {
  return getActionsForNotification({
    ...notification,
    body: detail?.body || notification.body
  }).map((action) => {
    if (action.type === "copy") {
      return {
        ...action,
        payload: {
          ...(action.payload || {}),
          text: buildCopyText({
            title: detail?.title || notification.title,
            body: detail?.body || notification.body
          })
        }
      };
    }
    return action;
  });
}

function buildFallbackDetail(notification) {
  return {
    kind: notification.type || "notification",
    title: notification.title,
    body: notification.body || notification.title,
    metadata: metadataEntries([
      { label: "来源", value: sourceLabel(notification.source) },
      { label: "状态", value: notification.unread ? "未读" : "已读" },
      { label: "级别", value: notification.level },
      { label: "标识", value: notification.sourceId || notification.id }
    ]),
    sourcePayload: {
      id: notification.id,
      source: notification.source,
      sourceId: notification.sourceId,
      meta: notification.meta
    }
  };
}

function buildMailDetail(notification, message) {
  return {
    kind: "mail",
    title: message?.subject || notification.title,
    body: message?.textBody || message?.summary || notification.body || notification.title,
    metadata: metadataEntries([
      { label: "来源", value: sourceLabel(notification.source) },
      { label: "发件人", value: message?.from || message?.sender },
      { label: "收件人", value: message?.to },
      { label: "时间", value: message?.date },
      { label: "状态", value: message?.unread ? "未读" : "已读" }
    ]),
    sourcePayload: message || {}
  };
}

function weatherLifecycleLabel(lifecycle) {
  if (lifecycle === "resolved") return "已解除";
  if (lifecycle === "upgraded") return "已升级";
  return "生效中";
}

function buildWeatherDetail(notification, alert) {
  return {
    kind: "weather-alert",
    title: alert?.title || notification.title,
    body: alert?.body || alert?.message || notification.body || notification.title,
    metadata: metadataEntries([
      { label: "来源", value: sourceLabel(notification.source) },
      { label: "状态", value: weatherLifecycleLabel(alert?.lifecycle || notification.meta?.lifecycle) },
      { label: "风险", value: alert?.severity || notification.level },
      { label: "发布时间", value: alert?.createdAt || notification.createdAt }
    ]),
    sourcePayload: alert || {}
  };
}

function normalizeAction(action = {}, notification) {
  if (!action || typeof action !== "object") {
    throw new TypeError("Notification action must be an object");
  }
  const type = String(action.type || "").trim();
  if (!["view", "navigate", "copy", "markRead"].includes(type)) {
    throw new Error("Unsupported notification action type");
  }
  const payload = action.payload && typeof action.payload === "object" ? { ...action.payload } : {};
  if (type === "navigate") {
    const route = payload.section
      ? payload
      : notificationRoute(notification.source, notification.sourceId) || {};
    return {
      ...action,
      type,
      payload: {
        moduleId: route.moduleId,
        section: route.section || "Notifications",
        source: notification.source,
        sourceId: notification.sourceId,
        notificationId: notification.id
      }
    };
  }
  if (type === "markRead") {
    return {
      ...action,
      type,
      payload: { notificationId: payload.notificationId || notification.id }
    };
  }
  return { ...action, type, payload };
}

function createNotificationDetailService({
  loadNotifications,
  fetchMailMessage,
  fetchWeatherAlert
}) {
  if (typeof loadNotifications !== "function") {
    throw new TypeError("loadNotifications is required");
  }

  async function listNotifications() {
    const payload = await loadNotifications();
    const items = Array.isArray(payload?.items) ? payload.items : [];
    return items.map((item) => normalizeRawNotification(item));
  }

  async function getNotification(notificationId) {
    const safeId = String(notificationId || "").trim();
    if (!safeId) throw new Error("Notification id is required");
    const items = await listNotifications();
    const notification = items.find((item) => item.id === safeId);
    if (!notification) throw new Error("Notification not found");
    return notification;
  }

  async function getNotificationDetail(notificationId) {
    const notification = await getNotification(notificationId);
    let detail = buildFallbackDetail(notification);
    try {
      if (notification.source === "mail" && notification.sourceId && typeof fetchMailMessage === "function") {
        detail = buildMailDetail(notification, await fetchMailMessage(notification.sourceId));
      } else if (notification.source === "qweather" && notification.sourceId && typeof fetchWeatherAlert === "function") {
        detail = buildWeatherDetail(notification, await fetchWeatherAlert(notification.sourceId));
      }
    } catch (error) {
      detail = {
        ...detail,
        metadata: metadataEntries([
          ...detail.metadata,
          { label: "详情状态", value: "源模块暂不可用，已显示通知正文" }
        ]),
        sourcePayload: {
          ...detail.sourcePayload,
          resolverError: error?.message || "Source detail unavailable"
        }
      };
    }
    const actions = enrichActions(notification, detail);
    return {
      notification: {
        ...notification,
        actions
      },
      detail,
      actions
    };
  }

  async function resolveNavigation(action) {
    const notificationId = action?.payload?.notificationId || action?.payload?.id || action?.notificationId;
    const notification = notificationId ? await getNotification(notificationId) : normalizeRawNotification(action?.notification || {});
    return normalizeAction(action, notification);
  }

  return {
    getNotification,
    getNotificationDetail,
    resolveNavigation
  };
}

module.exports = {
  createNotificationDetailService,
  normalizeAction,
  sourceLabel,
  weatherLifecycleLabel
};
