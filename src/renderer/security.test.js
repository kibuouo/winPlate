const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

test("content security policy permits GitHub avatar images", () => {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");

  assert.match(
    html,
    /img-src[^;]*https:\/\/avatars\.githubusercontent\.com/,
    "GitHub avatar CDN must be allowed by the renderer CSP"
  );
});

test("floating status omits the date beside the Codex reset time", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");

  assert.doesNotMatch(renderer, /class="date-label"/);
});

test("floating status keeps the Codex reset time immediately after the quota lamp", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const floatingTemplate = renderer.slice(
    renderer.indexOf("function renderFloating()"),
    renderer.indexOf("function bindNotificationStrip()")
  );

  assert.doesNotMatch(floatingTemplate, /drag-handle/);
  assert.match(
    floatingTemplate,
    /quotaStatusLamp\(statusData\.codex\.remainingPct\)\}\s*<span class="metric reset">/
  );
});

test("compact Codex progress avoids CSP-blocked inline styles", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");

  assert.match(renderer, /compact-bar[\s\S]{0,120}data-progress-value=/);
  assert.doesNotMatch(renderer, /compact-bar[\s\S]{0,120}style=/);
});

test("main renderer preserves content scroll position across status refreshes", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");

  assert.match(renderer, /previousMainContent\.scrollTop/);
  assert.match(renderer, /\.main-content"\)\.scrollTo\(previousScrollPosition\)/);
});

test("automatic status refresh updates the existing main content DOM", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const refreshStatus = renderer.slice(
    renderer.indexOf("async function refreshStatus()"),
    renderer.indexOf("if (view === \"main\")")
  );

  assert.match(refreshStatus, /updateMainStatusDom\(\)/);
  assert.doesNotMatch(refreshStatus, /renderMain\(\)/);
  assert.match(renderer, /function syncDomNode\(/);
  assert.match(renderer, /currentSection === "Settings"/);
});

test("mail outline escapes external email fields before rendering", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const mailItemCard = renderer.slice(
    renderer.indexOf("function mailItemCard"),
    renderer.indexOf("function mailContent")
  );

  assert.match(renderer, /function escapeHtml\(/);
  assert.match(mailItemCard, /escapeHtml\(item\.sender\)/);
  assert.match(mailItemCard, /escapeHtml\(item\.subject\)/);
  assert.match(mailItemCard, /escapeHtml\(item\.summary/);
});

test("notifications escape pushed titles and messages before rendering", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const notificationContent = renderer.slice(
    renderer.indexOf("function notificationContent"),
    renderer.indexOf("function dashboardContent")
  );
  const notificationTooltip = renderer.slice(
    renderer.indexOf("if (data.type === \"notifications\")"),
    renderer.indexOf("const lines = Array.isArray(data.lines)")
  );

  assert.match(notificationContent, /escapeHtml\(item\.title\)/);
  assert.match(notificationContent, /escapeHtml\(item\.message\)/);
  assert.match(notificationTooltip, /escapeHtml\(item\.title\)/);
  assert.match(notificationTooltip, /escapeHtml\(item\.message\)/);
});
