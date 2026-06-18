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

test("mail outline view action reads the message by uid in-app", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const preload = fs.readFileSync(path.join(__dirname, "..", "preload", "preload.js"), "utf8");
  const mailItemCard = renderer.slice(
    renderer.indexOf("function mailItemCard"),
    renderer.indexOf("function mailContent")
  );
  const mailControls = renderer.slice(
    renderer.indexOf("function bindMailControls"),
    renderer.indexOf("function bindNotificationControls")
  );

  assert.match(preload, /"email:read-message": \(uid\) => ipcRenderer\.invoke\("email:read-message", uid\)/);
  assert.match(mailItemCard, /class="mail-open-button"/);
  assert.match(mailItemCard, /data-mail-uid="\$\{escapeHtml\(uid\)\}"/);
  assert.match(mailControls, /window\.winplate\["email:read-message"\]\(uid\)/);
  assert.doesNotMatch(mailControls, /button\.dataset\.mailSubject/);
});

test("mail detail renders message body inside a sandboxed srcdoc iframe", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const iframeDocument = renderer.slice(
    renderer.indexOf("function mailIframeDocument"),
    renderer.indexOf("function mailDetailBody")
  );
  const mailDetailBody = renderer.slice(
    renderer.indexOf("function mailDetailBody"),
    renderer.indexOf("function mailDetailDrawer")
  );

  assert.match(iframeDocument, /<!doctype html>/);
  assert.match(iframeDocument, /Content-Security-Policy/);
  assert.match(iframeDocument, /script-src 'none'/);
  assert.match(iframeDocument, /object-src 'none'/);
  assert.match(iframeDocument, /connect-src 'none'/);
  assert.match(iframeDocument, /style-src 'unsafe-inline'/);
  assert.match(iframeDocument, /img-src https: http: data: cid:/);
  assert.match(iframeDocument, /img \{ max-width: 100%; height: auto; \}/);
  assert.match(iframeDocument, /table \{ max-width: 100%; \}/);
  assert.match(mailDetailBody, /class="mail-detail-frame" sandbox="" referrerpolicy="no-referrer" srcdoc=/);
  assert.match(mailDetailBody, /mailIframeDocument\(message\.htmlBody, false\)/);
  assert.match(mailDetailBody, /mailIframeDocument\(message\.textBody, true\)/);
  assert.doesNotMatch(mailDetailBody, /sanitizeMailHtml/);
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
