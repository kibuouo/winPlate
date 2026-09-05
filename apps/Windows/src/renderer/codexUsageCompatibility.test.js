const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");
const fixtures = require("../../test/fixtures/codex-usage.json");
const source = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
function section(start, end) {
  const offset = source.indexOf(start);
  const limit = source.indexOf(end, offset + start.length);
  assert.ok(offset >= 0 && limit > offset, `Renderer entry points must exist: ${start}`);
  return source.slice(offset, limit);
}

function renderer(input) {
  const dom = new JSDOM('<body><div id="app"></div></body>');
  const { window } = dom;
  window.WinPlateSmartNotificationIcons = { renderSmartNotificationIcon: () => "" };
  const context = {
    window, document: window.document, appRoot: window.document.querySelector("#app"),
    statusData: { codex: structuredClone(input), weather: {}, heart: {}, github: {}, supergrok: {} },
    mockStatus: { weather: {}, heart: {}, supergrok: {} }, floatingDocked: false, floatingPinned: false,
    networkSpeed: {}, sidebarCodexIcon: "", openaiBrandIcon: "", grokBrandIcon: "",
    healthMetric: () => "--", weatherIconMarkup: () => "", avatarMarkup: () => "",
    dockedWeatherAlertState: () => null, dockedUnreadMailCount: () => 0,
    notificationStrip: () => "", networkSpeedMarkup: () => "",
    moduleHealthAttributes: () => "", moduleEnabled: () => true,
    dashboardCardNavigationAttributes: () => "", dashboardServiceHealthKind: () => "live",
    serviceHealthBadge: () => "", dashboardDeepSeekBalanceColumn: () => "",
    escapeHtml: (value) => String(value),
    updateProgressBars() {}, bindAvatarFallbacks() {}, bindWeatherIconFallbacks() {},
    bindNotificationStrip() {}, bindFloatingPinControls() {}, heartCapsulePreviewPayload() {},
    isRecord: (value) => value !== null && typeof value === "object" && !Array.isArray(value),
    refreshCodexTokenUsageData: async () => {}, updateCurrentViewDom() {}, scheduleDesktopStatusPublish() {}
  };
  vm.createContext(context);
  vm.runInContext([
    section("function normalizePercent(", "function progressBar("),
    section("function progressBar(", "function quotaStatusLamp("),
    section("function quotaStatusLamp(", "function "),
    section("function renderDockedFloating()", "function bindNotificationStrip("),
    section("function dashboardCodexRow(", "function deepseekCurrencySymbol("),
    section("function dashboardCodexCard()", "function mailStatusLabel("),
    section("async function refreshCodexData(", "async function refreshDeepSeekData(")
  ].join("\n"), context);
  return { context, close: () => window.close() };
}

for (const fixture of fixtures.cases) {
  test(`Codex usage fixture: ${fixture.name} renders the same quota across capsule and Dashboard`, async (t) => {
    const { context: ctx, close } = renderer(fixture.input);
    t.after(close);
    // A real refresh must not fill missing provider fields with demo quota.
    ctx.mockStatus.codex = { source: "mock", remainingPct: 99, windows: { sevenDay: { remainingPct: 99 } } };
    ctx.statusData.codex = structuredClone(ctx.mockStatus.codex);
    ctx.window.winplate = { getCodexUsage: async () => structuredClone(fixture.input) };
    if (fixture.expected.status === "Unavailable") await assert.rejects(ctx.refreshCodexData());
    else await ctx.refreshCodexData();
    assert.equal(ctx.statusData.codex.status, fixture.expected.status);
    const assertQuota = (selector) => {
      const module = ctx.document.querySelector(selector);
      assert.equal(module.querySelector("strong.metric").textContent, fixture.expected.headline);
      assert.equal(module.querySelector('[role="progressbar"]').getAttribute("aria-valuenow"),
        fixture.expected.headline === "--%" ? null : fixture.expected.headline.replace("%", ""));
    };
    ctx.renderDockedFloating();
    assertQuota(".docked-usage");
    ctx.renderFloating();
    assertQuota(".codex-module");
    assert.equal(ctx.document.querySelector(".codex-module .reset").textContent, fixture.expected.reset);
    ctx.appRoot.innerHTML = ctx.dashboardCodexCard();
    const rows = [...ctx.document.querySelectorAll(".dashboard-codex-chatgpt-service .dashboard-codex-window")];
    const expectedRows = [
      ...(fixture.expected.fiveHour === null ? [] : [["5 小时", `${fixture.expected.fiveHour}%`]]),
      ["7 天", fixture.expected.sevenDay === null ? "--%" : `${fixture.expected.sevenDay}%`]
    ];
    assert.deepEqual(rows.map((row) => [row.querySelector(".dashboard-codex-window-title").textContent, row.querySelector("strong").textContent]), expectedRows);
    for (const row of rows) {
      const text = row.querySelector("strong").textContent;
      assert.equal(row.querySelector('[role="progressbar"]').getAttribute("aria-valuenow"), text === "--%" ? null : text.replace("%", ""));
    }
  });
}

test("a missing-window response preserves a real prior snapshot as Cached, then recovers to the new schema", async (t) => {
  const find = (name) => structuredClone(fixtures.cases.find((entry) => entry.name === name).input);
  const { context: ctx, close } = renderer(find("both-windows-override-legacy"));
  t.after(close);
  ctx.window.winplate = { getCodexUsage: async () => find("null-windows-and-null-quota") };
  await ctx.refreshCodexData();
  assert.equal(ctx.statusData.codex.status, "Cached");
  ctx.renderFloating();
  assert.equal(ctx.document.querySelector(".codex-module strong.metric").textContent, "64%");
  ctx.window.winplate.getCodexUsage = async () => find("fiveHour");
  await ctx.refreshCodexData();
  assert.equal(ctx.statusData.codex.status, "Normal");
  ctx.appRoot.innerHTML = ctx.dashboardCodexCard();
  assert.deepEqual([...ctx.document.querySelectorAll(".dashboard-codex-chatgpt-service strong")].map((item) => item.textContent), ["ChatGPT", "82%", "--%"]);
});
