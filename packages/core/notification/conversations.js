const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
const DEVELOPMENT_SOURCES = new Set(["codex", "chatgpt"]);

function normalizedConversationTitle(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function validCreatedAt(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}

function foldNotificationConversations(items, { continuityMs = FOUR_HOURS_MS } = {}) {
  const sorted = [...(Array.isArray(items) ? items : [])]
    .sort((left, right) => Number(right?.createdAt || 0) - Number(left?.createdAt || 0));
  const groups = [];

  for (const item of sorted) {
    const title = normalizedConversationTitle(item?.title);
    const createdAt = validCreatedAt(item?.createdAt);
    const key = DEVELOPMENT_SOURCES.has(item?.source) && title && createdAt
      ? `${item.source}\u001f${title}`
      : "";
    const group = key && groups.find((candidate) => (
      candidate.key === key
      && candidate.createdAt - createdAt <= continuityMs
    ));

    if (group) {
      group.updates.push(item);
    } else {
      groups.push({ key, createdAt, updates: [item] });
    }
  }

  return groups.map(({ key, updates }) => {
    const newest = updates[0];
    return {
      ...newest,
      conversationKey: key || null,
      memberIds: updates.map((item) => item.id),
      updateCount: updates.length,
      updates
    };
  });
}

function conversationForNotificationId(conversations, notificationId) {
  const id = String(notificationId || "").trim();
  if (!id) return null;
  return (Array.isArray(conversations) ? conversations : []).find((conversation) => (
    Array.isArray(conversation?.memberIds) && conversation.memberIds.some((memberId) => String(memberId) === id)
  )) || null;
}

module.exports = {
  FOUR_HOURS_MS,
  conversationForNotificationId,
  foldNotificationConversations,
  normalizedConversationTitle
};
