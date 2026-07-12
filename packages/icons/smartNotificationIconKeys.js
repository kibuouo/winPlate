const ICON_KEYS = Object.freeze([
  "bell", "cloud-rain-alert", "cloud-lightning", "wind", "thermometer-sun",
  "thermometer-snowflake", "mail", "mail-unread", "mail-warning", "paperclip",
  "check-circle", "x-circle", "loader", "terminal", "codex", "message-bot", "code", "bug",
  "monitor", "cpu", "memory-stick", "wifi", "download", "upload", "wallet", "plug",
  "github", "git-pull-request", "git-commit", "star", "tag", "sparkles"
]);
const ICON_KEY_SET = new Set(ICON_KEYS);

function isSmartNotificationIconKey(value) {
  return typeof value === "string" && ICON_KEY_SET.has(value);
}

function normalizeSmartNotificationIconKey(value, fallback = "bell") {
  return isSmartNotificationIconKey(value) ? value : fallback;
}

module.exports = { ICON_KEYS, isSmartNotificationIconKey, normalizeSmartNotificationIconKey };
