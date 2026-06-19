(function exposeSmartNotificationIconKeys(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.WinPlateSmartNotificationIconKeys = api;
})(typeof window !== "undefined" ? window : null, function createSmartNotificationIconKeys() {
  const ICON_KEYS = Object.freeze([
    "bell", "cloud-rain-alert", "cloud-lightning", "wind", "thermometer-sun",
    "thermometer-snowflake", "mail", "mail-unread", "mail-warning", "paperclip",
    "check-circle", "x-circle", "loader", "terminal", "message-bot", "code", "bug",
    "monitor", "cpu", "memory-stick", "wifi", "download", "upload", "wallet", "plug",
    "github", "git-pull-request", "git-commit", "star", "tag"
  ]);
  const ICON_KEY_SET = new Set(ICON_KEYS);

  function isSmartNotificationIconKey(value) {
    return typeof value === "string" && ICON_KEY_SET.has(value);
  }

  function normalizeSmartNotificationIconKey(value, fallback = "bell") {
    return isSmartNotificationIconKey(value) ? value : fallback;
  }

  return { ICON_KEYS, isSmartNotificationIconKey, normalizeSmartNotificationIconKey };
});
