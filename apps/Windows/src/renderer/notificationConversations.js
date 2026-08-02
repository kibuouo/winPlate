(() => {
  function fromSummary(summary, fallbackItems = []) {
    if (Array.isArray(summary?.conversations)) return summary.conversations;
    return Array.isArray(fallbackItems) ? fallbackItems : [];
  }

  function conversationForNotificationId(conversations, notificationId) {
    const id = String(notificationId || "").trim();
    if (!id) return null;
    return (Array.isArray(conversations) ? conversations : []).find((conversation) => (
      String(conversation?.id || "") === id
      || (Array.isArray(conversation?.memberIds) && conversation.memberIds.some((memberId) => String(memberId) === id))
    )) || null;
  }

  window.WinPlateNotificationConversations = Object.freeze({
    conversationForNotificationId,
    fromSummary
  });
})();
