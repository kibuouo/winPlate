(() => {
  const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
  const DEVELOPMENT_SOURCES = new Set(["codex", "chatgpt"]);

  function normalizedConversationTitle(value) {
    return String(value || "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
  }

  function foldNotificationConversations(items, { continuityMs = FOUR_HOURS_MS } = {}) {
    const sorted = [...(Array.isArray(items) ? items : [])]
      .sort((left, right) => Number(right?.createdAt || 0) - Number(left?.createdAt || 0));
    const groups = [];

    for (const item of sorted) {
      const source = String(item?.source || "").trim().toLowerCase();
      const title = normalizedConversationTitle(item?.title);
      const createdAt = Number(item?.createdAt);
      const canFold = DEVELOPMENT_SOURCES.has(source) && title && Number.isFinite(createdAt) && createdAt > 0;
      const existing = canFold && groups.find((group) => (
        group.source === source
        && group.title === title
        && group.latestCreatedAt - createdAt <= continuityMs
      ));

      if (existing) {
        existing.updates.push(item);
        continue;
      }

      groups.push({
        source,
        title,
        latestCreatedAt: createdAt,
        updates: [item],
        canFold
      });
    }

    return groups.flatMap((group) => {
      const latest = group.updates[0];
      if (!group.canFold || group.updates.length === 1) return [latest];
      return [{
        ...latest,
        conversationKey: `${group.source}:${group.title}:${group.latestCreatedAt}`,
        memberIds: group.updates.map((item) => String(item.id)),
        updateCount: group.updates.length,
        unread: group.updates.some((item) => item?.unread),
        updates: group.updates
      }];
    });
  }

  function conversationForNotificationId(conversations, notificationId) {
    const id = String(notificationId || "").trim();
    if (!id) return null;
    return (Array.isArray(conversations) ? conversations : []).find((conversation) => (
      String(conversation?.id) === id || conversation?.memberIds?.includes(id)
    )) || null;
  }

  window.WinPlateNotificationConversations = Object.freeze({
    conversationForNotificationId,
    foldNotificationConversations
  });
})();
