const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ICON_KEYS,
  renderSmartNotificationIcon,
  resolveSmartNotificationIcon
} = require("@winplate/icons/electron/smartNotificationIcons");

test("renders every published smart notification icon and falls back safely", () => {
  for (const key of ICON_KEYS) {
    assert.match(renderSmartNotificationIcon(key), new RegExp(`data-icon-key="${key}"`));
  }
  assert.match(renderSmartNotificationIcon("<script>"), /data-icon-key="bell"/);
});

test("uses the pull-request icon for GitHub pull-request notifications", () => {
  assert.equal(resolveSmartNotificationIcon({ title: "GitHub Pull Request", iconKey: "star" }), "git-pull-request");
});
