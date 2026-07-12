const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ICON_KEYS,
  isSmartNotificationIconKey,
  normalizeSmartNotificationIconKey
} = require("@winplate/core/notification/smart-icon-keys");

test("exposes the complete smart notification icon-key whitelist", () => {
  assert.equal(ICON_KEYS.length, 32);
  assert.equal(isSmartNotificationIconKey("sparkles"), true);
  assert.equal(isSmartNotificationIconKey("<svg>"), false);
  assert.equal(normalizeSmartNotificationIconKey("tag"), "tag");
  assert.equal(normalizeSmartNotificationIconKey("<script>"), "bell");
});
