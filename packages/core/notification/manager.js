const { foldNotificationConversations } = require("./conversations");

function createNotificationManager({
  loadNotifications,
  mutateNotifications,
  normalizeNotification,
  syncSources = async () => {},
  onChanged = () => {},
  now = () => Date.now()
} = {}) {
  if (typeof loadNotifications !== "function") throw new TypeError("loadNotifications is required");
  if (typeof mutateNotifications !== "function") throw new TypeError("mutateNotifications is required");
  if (typeof normalizeNotification !== "function") throw new TypeError("normalizeNotification is required");

  function normalizeSummary(payload = {}) {
    const rawItems = Array.isArray(payload?.items) ? payload.items : [];
    const items = rawItems
      .map((item) => normalizeNotification(item, now()))
      .filter((item) => item.id && (item.title || item.body));
    const conversations = foldNotificationConversations(items);
    const byId = new Map(items.map((item) => [String(item.id), item]));
    const requestedLatestId = payload?.latest?.id;
    const latest = requestedLatestId !== undefined && requestedLatestId !== null
      ? byId.get(String(requestedLatestId)) || null
      : items.find((item) => item.unread) || items[0] || null;
    const suppliedUnreadCount = Number(payload?.unreadCount);
    return {
      conversations,
      items,
      latest,
      unreadCount: Number.isFinite(suppliedUnreadCount) && suppliedUnreadCount >= 0
        ? suppliedUnreadCount
        : items.filter((item) => item.unread).length,
      updatedAt: Number(payload?.updatedAt) || now()
    };
  }

  async function list(options = {}) {
    await Promise.resolve(syncSources(options));
    return normalizeSummary(await loadNotifications(options));
  }

  async function mutate(operation, payload) {
    const result = await mutateNotifications(operation, payload);
    const summary = result && Array.isArray(result.items)
      ? normalizeSummary(result)
      : await list({ force: true, skipSourceSync: true });
    await Promise.resolve(onChanged({ operation, payload, summary }));
    return summary;
  }

  return Object.freeze({
    list,
    collect: () => list(),
    normalizeSummary,
    publish: (notification) => mutate("publish", notification),
    markRead: (id) => mutate("markRead", { id }),
    markManyRead: (ids) => mutate("markManyRead", { ids }),
    markAllRead: () => mutate("markAllRead"),
    clear: () => mutate("clear"),
    clearRead: () => mutate("clearRead"),
    sourceChanged: async (source, options = {}) => {
      await Promise.resolve(onChanged({ operation: "sourceChanged", payload: { source }, summary: null }));
      return options.reload ? list({ force: true, skipSourceSync: true }) : null;
    }
  });
}

module.exports = {
  createNotificationManager
};
