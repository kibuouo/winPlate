const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} should exist`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

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

test("weather location changes update every window without an implicit location rewrite", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const preload = fs.readFileSync(path.join(__dirname, "..", "preload", "preload.js"), "utf8");
  const main = fs.readFileSync(path.join(__dirname, "..", "main", "main.js"), "utf8");
  const refreshStatus = renderer.slice(
    renderer.indexOf("async function refreshStatus()"),
    renderer.indexOf("if (view === \"main\")")
  );

  assert.doesNotMatch(refreshStatus, /refreshSelectedWeatherLocation/);
  assert.match(main, /broadcastStatusRefresh\(weather\)/);
  assert.match(preload, /callback\(payload\)/);
  assert.match(renderer, /payload\?\.weather[\s\S]*updateFloatingStatusDom\(\)/);
  assert.match(renderer, /weatherVersionAtRequest === weatherUpdateVersion/);
  assert.match(renderer, /const currentWeather = statusData\.weather/);
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
  const component = fs.readFileSync(path.join(__dirname, "components", "notificationDigest.js"), "utf8");
  const notificationContent = renderer.slice(
    renderer.indexOf("function notificationContent"),
    renderer.indexOf("function dashboardContent")
  );
  const notificationTooltip = renderer.slice(
    renderer.indexOf("if (data.type === \"notifications\")"),
    renderer.indexOf("const lines = Array.isArray(data.lines)")
  );

  assert.match(notificationContent, /renderRawNotifications/);
  assert.match(notificationTooltip, /renderDigestCard/);
  assert.match(component, /escapeHtml\(item\.title\)/);
  assert.match(component, /escapeHtml\(item\.body \|\| item\.message\)/);
  assert.match(component, /escapeHtml\(value\.headline\)/);
  assert.match(component, /escapeHtml\(value\.summary\)/);
});

test("notification capsule and panel consume the digest instead of a raw title", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const preload = fs.readFileSync(path.join(__dirname, "..", "preload", "preload.js"), "utf8");
  const component = fs.readFileSync(path.join(__dirname, "components", "notificationDigest.js"), "utf8");
  const strip = renderer.slice(renderer.indexOf("function notificationStrip"), renderer.indexOf("function formatSpeedCompact"));

  assert.match(strip, /digest\.headline/);
  assert.match(strip, /severity-\$\{escapeHtml\(digest\.severity\)\}/);
  assert.match(strip, /resolveSmartNotificationIcon\(digest\)/);
  assert.match(strip, /renderSmartNotificationIcon\(iconKey\)/);
  assert.doesNotMatch(strip, /latest\.title/);
  assert.match(preload, /notification:get-digest/);
  assert.match(preload, /notification:digest-updated/);
  assert.match(component, /<details class="notification-raw-section">/);
  assert.match(component, /notification-digest-groups/);
  assert.match(component, /resolveSmartNotificationIcon\(value\)/);
  assert.match(component, /renderSmartNotificationIcon\(iconKey\)/);
});

test("smart notification SVGs load from the local whitelist before renderer components", () => {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const keysIndex = html.indexOf("smartNotificationIconKeys.js");
  const iconsIndex = html.indexOf("smartNotificationIcons.js");
  const componentIndex = html.indexOf("notificationDigest.js");
  assert.ok(keysIndex > 0 && keysIndex < iconsIndex);
  assert.ok(iconsIndex < componentIndex);
});

test("notification severity styles cover capsule, badge, and compact popup", () => {
  const css = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
  for (const severity of ["danger", "warning", "info"]) {
    assert.match(css, new RegExp(`notification-strip\\.severity-${severity}`));
    assert.match(css, new RegExp(`notification-strip\\.severity-${severity} \\.notification-badge`));
    assert.match(css, new RegExp(`notification-digest-card\\.compact\\.severity-${severity}`));
  }
});

test("notifications expose a clear action through preload and renderer controls", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const preload = fs.readFileSync(path.join(__dirname, "..", "preload", "preload.js"), "utf8");
  assert.match(preload, /clearNotifications: \(\) => ipcRenderer\.invoke\("notifications:clear"\)/);
  assert.match(renderer, /id="clear-notifications"/);
  assert.match(renderer, /window\.winplate\.clearNotifications\(\)/);
});

test("DeepSeek balance card renders local token usage instead of unavailable placeholder", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const codexContent = renderer.slice(
    renderer.indexOf("function codexContent()"),
    renderer.indexOf("function renderMain()")
  );

  assert.match(codexContent, /Token 用量/);
  assert.match(codexContent, /tokenUsage\.today/);
  assert.match(codexContent, /tokenUsage\.total/);
  assert.match(codexContent, /应用累计/);
});

test("floating network speed uses compact labels for the main capsule", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const formatSpeedCompact = Function(`"use strict"; ${extractFunction(renderer, "formatSpeedCompact")}; return formatSpeedCompact;`)();
  const formatSpeedFull = Function(`"use strict"; ${extractFunction(renderer, "formatSpeedFull")}; return formatSpeedFull;`)();

  assert.equal(formatSpeedCompact(0), "0K");
  assert.equal(formatSpeedCompact(9 * 1024), "9K");
  assert.equal(formatSpeedCompact(76 * 1024), "76K");
  assert.equal(formatSpeedCompact(1.0 * 1024 * 1024), "1.0M");
  assert.equal(formatSpeedCompact(12 * 1024 * 1024), "12M");
  assert.equal(formatSpeedCompact(128 * 1024 * 1024), "128M");
  assert.equal(formatSpeedFull(9 * 1024), "9 KB/s");
  assert.equal(formatSpeedFull(3 * 1024), "3 KB/s");
  assert.equal(formatSpeedFull(12 * 1024 * 1024), "12 MB/s");
  assert.match(renderer, /function formatLatency\(latencyMs\)[\s\S]*return `\$\{Math\.round\(value\)\}ms`;/);
  assert.match(renderer, /networkSpeedMarkup\(\)[\s\S]*formatSpeedCompact\(networkSpeed\.downloadBytesPerSecond\)/);
  assert.match(renderer, /download:\s*formatNetworkSpeed\(networkSpeed\.downloadBytesPerSecond,\s*false\)/);
  assert.match(renderer, /upload:\s*formatNetworkSpeed\(networkSpeed\.uploadBytesPerSecond,\s*false\)/);
  assert.match(renderer, /latency:\s*formatLatency\(networkSpeed\.latencyMs\)/);
});

test("floating network capsule is wider than heart while sharing the icon grid", () => {
  const css = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
  const floatingStatusCss = css.slice(
    css.indexOf(".status-layout"),
    css.indexOf(".main-body")
  );

  assert.match(floatingStatusCss, /\.status-layout\s*\{[\s\S]*grid-template-columns:\s*96px minmax\(0, 1fr\) 105px;/);
  assert.match(floatingStatusCss, /\.system-status\s*\{[\s\S]*grid-template-columns:\s*76px 24px;/);
  assert.match(floatingStatusCss, /\.heart-module\s*\{[\s\S]*width:\s*62px;/);
  assert.match(floatingStatusCss, /\.network-module\s*\{[\s\S]*width:\s*76px;/);
  assert.match(floatingStatusCss, /\.heart-module\s*\{[\s\S]*grid-template-columns:\s*16px max-content;/);
  assert.match(floatingStatusCss, /\.network-speed\s*\{[\s\S]*grid-template-columns:\s*16px max-content;/);
  assert.match(floatingStatusCss, /\.network-speed\s*\{[\s\S]*gap:\s*3px;/);
  assert.doesNotMatch(floatingStatusCss, /transform:\s*translateX/);
});
