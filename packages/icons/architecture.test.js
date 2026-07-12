const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  ICON_KEYS,
  SMART_NOTIFICATION_ICON_REGISTRY,
  isSmartNotificationIconKey,
  renderSmartNotificationIcon,
  resolveSmartNotificationIcon
} = require("@winplate/icons/electron/smartNotificationIcons");
const semanticKeys = require("@winplate/icons/smartNotificationIconKeys");

const packageRoot = __dirname;

test("semantic smart notification icon keys are platform-neutral", () => {
  assert.equal(ICON_KEYS, semanticKeys.ICON_KEYS);
  assert.equal(semanticKeys.ICON_KEYS.length, 32);
  assert.equal(semanticKeys.isSmartNotificationIconKey("sparkles"), true);
  assert.equal(semanticKeys.isSmartNotificationIconKey("<svg>"), false);

  const source = fs.readFileSync(path.join(packageRoot, "smartNotificationIconKeys.js"), "utf8");
  assert.doesNotMatch(source, /electron|lucide|svg|document|window/i);
});

test("Electron renderer SVG mapping stays isolated under the electron folder", () => {
  assert.deepEqual(new Set(Object.keys(SMART_NOTIFICATION_ICON_REGISTRY)), new Set(ICON_KEYS));
  assert.equal(isSmartNotificationIconKey("tag"), true);
  assert.match(renderSmartNotificationIcon("sparkles"), /data-icon-key="sparkles"/);
  assert.match(renderSmartNotificationIcon("<script>"), /data-icon-key="bell"/);
  assert.equal(resolveSmartNotificationIcon({ title: "GitHub Pull Request", iconKey: "star" }), "git-pull-request");
  assert.equal(resolveSmartNotificationIcon({ title: "普通动态", iconKey: "tag" }), "tag");

  const coreFiles = fs.readdirSync(path.join(packageRoot, "..", "core", "notification"))
    .filter((file) => file.endsWith(".js") && !file.endsWith(".test.js"));
  for (const file of coreFiles) {
    const source = fs.readFileSync(path.join(packageRoot, "..", "core", "notification", file), "utf8");
    assert.doesNotMatch(source, /ICON_BODIES|renderSmartNotificationIcon|<svg/i, file);
  }
});
