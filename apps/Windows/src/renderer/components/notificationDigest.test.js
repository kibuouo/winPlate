const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadNotificationDigest() {
  const source = fs.readFileSync(path.join(__dirname, "notificationDigest.js"), "utf8");
  const context = vm.createContext({ window: {} });
  vm.runInContext(source, context);
  return context.window.WinPlateNotificationDigest;
}

test("renderer consumes the NotificationManager classification without reclassifying source payloads", () => {
  const digest = loadNotificationDigest();
  assert.equal(digest.notificationAlertColor({
    source: "qweather",
    title: "强对流橙色预警",
    level: "warning",
    meta: { alertColor: "yellow", severity: "severe" }
  }), "yellow");
  assert.equal(digest.notificationAlertColor({
    source: "qweather",
    title: "暴雨黄色预警",
    level: "warning",
    meta: { alertColor: "yellow" }
  }), "yellow");
  assert.equal(digest.notificationAlertColor({
    source: "qweather",
    title: "暴雨红色预警",
    level: "critical",
    meta: { alertColor: "red" }
  }), "red");
  assert.equal(digest.notificationAlertColor({
    source: "qweather",
    title: "强对流橙色预警",
    level: "critical",
    metadata: { severity: "severe" }
  }), null);
});

test("renderer consumes blue, green, and mail tiers only from manager metadata", () => {
  const digest = loadNotificationDigest();
  assert.equal(digest.notificationAlertColor({ source: "qweather", level: "info", meta: { alertColor: "blue" } }), "blue");
  assert.equal(digest.notificationAlertColor({
    source: "qweather",
    level: "success",
    meta: { alertColor: "green" }
  }), "green");
  assert.equal(digest.notificationAlertColor({ source: "mail", level: "info", meta: { alertColor: "blue" } }), "blue");
  assert.equal(digest.notificationAlertColor({ source: "codex", level: "success", meta: { alertColor: "green" } }), "green");
  assert.equal(digest.notificationAlertColor({ source: "codex", level: "success" }), null);
  assert.deepEqual(
    ["red", "yellow", "blue", "green"].map((alertColor) =>
      digest.notificationTierLabel({ meta: { alertColor } })
    ),
    ["危急", "预警", "提示", "普通"]
  );
});

test("red-alert acknowledgement consumes the manager contract", () => {
  const digest = loadNotificationDigest();
  assert.equal(digest.isAcknowledgementRequired({
    source: "qweather",
    unread: true,
    meta: { alertColor: "red", lifecycle: "issued" }
  }), true);
  assert.equal(digest.isAcknowledgementRequired({
    source: "qweather",
    unread: true,
    metadata: { severity: "red", lifecycle: "issued" }
  }), false);
  assert.equal(digest.isAcknowledgementRequired({
    source: "qweather",
    unread: true,
    meta: { alertColor: "red", lifecycle: "resolved" }
  }), false);
});

test("long notification titles truncate before fixed status badges", () => {
  const styles = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
  const titleRule = styles.match(/\.notification-timeline-title strong \{([^}]*)\}/)?.[1] || "";
  const unreadRule = styles.match(/\.notification-timeline-title \.unread-badge \{([^}]*)\}/)?.[1] || "";
  const updateRule = styles.match(/\.notification-timeline-title \.notification-update-count \{([^}]*)\}/)?.[1] || "";

  assert.match(titleRule, /min-width:\s*0/);
  assert.match(titleRule, /flex:\s*1 1 auto/);
  assert.match(titleRule, /text-overflow:\s*ellipsis/);
  assert.match(unreadRule, /flex:\s*0 0 auto/);
  assert.match(unreadRule, /white-space:\s*nowrap/);
  assert.match(updateRule, /flex:\s*0 0 auto/);
});
