const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadPreloadBridge(platform) {
  const source = fs.readFileSync(path.join(__dirname, "..", "preload", "preload.js"), "utf8");
  let exposed;
  const ipcRenderer = {
    invoke: () => Promise.resolve({}),
    on() {},
    send() {}
  };
  vm.runInNewContext(source, {
    process: { platform },
    require(name) {
      assert.equal(name, "electron");
      return {
        contextBridge: { exposeInMainWorld: (_name, value) => { exposed = value; } },
        ipcRenderer
      };
    }
  });
  return exposed;
}

test("preload exposes a Windows-only, narrow bridge", () => {
  const windows = loadPreloadBridge("win32");
  const unsupported = loadPreloadBridge("linux");
  assert.equal(windows.platform, "win32");
  assert.equal(unsupported.platform, "unsupported");
  assert.equal(typeof windows.setFloatingPinned, "function");
  assert.equal(typeof windows.restoreFloatingCapsule, "function");
  assert.equal(typeof windows.onFloatingDockState, "function");
  assert.equal(windows.getAppSettings, undefined);
  assert.equal(windows.saveAppSettings, undefined);
  assert.equal(windows.ipcRenderer, undefined);
  assert.equal(windows.require, undefined);
});

test("renderer and main process contain no macOS Electron implementation", () => {
  const files = [
    path.join(__dirname, "app.js"),
    path.join(__dirname, "styles.css"),
    path.join(__dirname, "..", "main", "main.js"),
    path.join(__dirname, "..", "main", "windowPolicy.js")
  ];
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(source, /macos|darwin|electron-menubar|createMacMenuBar|platform-darwin/i);
  }
});

test("renderer always renders the Windows titlebar and Windows platform class", () => {
  const source = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  assert.match(source, /document\.body\.className = "main-body platform-win32"/);
  assert.match(source, /<header class="app-titlebar">/);
  assert.doesNotMatch(source, /applicationSettings|macApplicationSettingsSection|getAppSettings|saveAppSettings/);
  assert.doesNotMatch(source, /bindApplicationSettingsControls/);
});

test("overview cards navigate to their module while preserving nested controls and notification previews", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");

  assert.match(appSource, /function dashboardCardNavigationAttributes\(moduleId\)/);
  assert.match(appSource, /data-dashboard-target/);
  assert.match(appSource, /dashboardCardContainsInteractiveControl/);
  assert.match(appSource, /button, a, input, select, textarea, summary/);
  assert.match(appSource, /card\.hasAttribute\("data-notification-preview-id"\)/);
  assert.match(appSource, /dashboardCardNavigationAttributes\("github"\)/);
  assert.match(appSource, /dashboardCardNavigationAttributes\("codex"\)/);
  assert.match(appSource, /dashboardCardNavigationAttributes\("weather"\)/);
  assert.match(appSource, /dashboardCardNavigationAttributes\("heart"\)/);
  assert.match(appSource, /card\.setAttribute\("aria-label", "打开相关通知"\)/);
  assert.match(styles, /\.dashboard-card\[data-dashboard-target\]\s*\{[^}]*cursor:\s*pointer/);
  assert.match(styles, /\.dashboard-card\[data-dashboard-target\]:focus-visible/);
});

test("SuperGrok renders the remaining quota derived from Grok usage", () => {
  const source = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");

  assert.match(source, /usageRow\("7d", supergrok\)/);
  assert.match(source, /dashboardCodexRow\("SuperGrok · 7 天", supergrok, \{ icon: grokBrandIcon \}\)/);
  assert.match(source, /id: "supergrok"/);
  assert.match(source, /const percentage = normalizePercent\(usage\?\.remainingPct\)/);
});

test("Agent workspace prefers 7d remaining and token trends without DeepSeek chat", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
  const preloadSource = fs.readFileSync(path.join(__dirname, "..", "preload", "preload.js"), "utf8");
  const mainSource = fs.readFileSync(path.join(__dirname, "..", "main", "main.js"), "utf8");

  assert.match(appSource, /function buildAgentUsageItems\(\)/);
  assert.match(appSource, /function agentTokenUsageCharts\(/);
  assert.match(appSource, /function dashboardDeepSeekBalanceColumn\(\)/);
  assert.match(appSource, /windows\.fiveHour \|\| null/);
  assert.match(appSource, /7 天剩余/);
  assert.match(appSource, /ChatGPT、DeepSeek、SuperGrok 的用量与额度/);
  assert.match(appSource, /getCodexTokenUsage|refreshCodexTokenUsageData/);
  assert.match(styles, /\.agent-token-hover-card\[hidden\]\s*\{\s*display:\s*none/);
  assert.match(preloadSource, /getCodexTokenUsage/);
  assert.match(preloadSource, /getSuperGrokTokenUsage/);
  assert.match(mainSource, /codex:token-usage/);
  assert.match(mainSource, /supergrok:token-usage/);
  assert.doesNotMatch(appSource, /今日 Token|应用累计|测试 AI 调用|启用 AI 摘要/);
  assert.doesNotMatch(preloadSource, /testDeepSeekChat|SmartBrief|smart-brief/);
  assert.doesNotMatch(mainSource, /deepseekChatClient|chat\/completions/);
  assert.equal(fs.existsSync(path.join(__dirname, "..", "main", "deepseekChatClient.js")), false);
  assert.equal(fs.existsSync(path.join(__dirname, "..", "main", "deepseekTokenUsage.js")), false);
});

test("GitHub uses the localized service-health label", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");

  assert.match(appSource, /function githubStatusLabel\(status = ""\)/);
  assert.match(appSource, /value\.toLowerCase\(\) === "live" \? "服务正常"/);
  assert.match(appSource, /serviceHealthBadge\(dashboardServiceHealthKind\("github"\)\)/);
  assert.match(appSource, /githubStatusLabel\(github\.status\)/);
  assert.doesNotMatch(appSource, /github\.status \|\| "Live"/);
  assert.doesNotMatch(appSource, /github-profile-status[\s\S]*?relativeUpdatedAt\(github\.updatedAt\)/);
  assert.match(styles, /\.github-profile-status\s*\{[^}]*align-self:\s*start/);
});

test("overview health state uses one shared badge without a duplicate pseudo-element", () => {
  const styles = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");

  assert.doesNotMatch(styles, /\.dashboard-card\[data-module-health="stale"\]::after/);
  assert.doesNotMatch(styles, /\.dashboard-card\[data-module-health="error"\]::after/);
});

test("overview cache stores data only and restores it through the current renderer", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const cacheSource = fs.readFileSync(path.join(__dirname, "dashboardCache.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");

  assert.match(html, /<script src="\.\/dashboardCache\.js"><\/script>/);
  assert.match(cacheSource, /winplate-dashboard-data-v1/);
  assert.match(cacheSource, /CACHE_VERSION = 1/);
  assert.match(appSource, /function restoreDashboardCache()/);
  assert.match(appSource, /WinPlateDashboardCache\?\.read/);
  assert.match(appSource, /function dashboardCachePayload()/);
  assert.match(appSource, /WinPlateDashboardCache\.write\(dashboardCachePayload\(\)\)/);
  assert.match(appSource, /restoreDashboardCache\(\);\s*registerRefreshTasks\(\);/);
  assert.doesNotMatch(cacheSource, /innerHTML|styles\.css|<article/);
});

test("DeepSeek exposes only balance configuration and balance display", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const preloadSource = fs.readFileSync(path.join(__dirname, "..", "preload", "preload.js"), "utf8");
  const mainSource = fs.readFileSync(path.join(__dirname, "..", "main", "main.js"), "utf8");
  const buildStart = appSource.indexOf("function buildAgentUsageItems()");
  const buildEnd = appSource.indexOf("function deepseekCompactSection()", buildStart);
  const buildSource = appSource.slice(buildStart, buildEnd);

  assert.match(buildSource, /id: "deepseek"/);
  assert.match(buildSource, /primaryDeepSeekBalance/);
  assert.match(buildSource, /tokenUsage: null/);
  assert.doesNotMatch(appSource, /今日 Token|应用累计|测试 AI 调用|启用 AI 摘要/);
  assert.doesNotMatch(preloadSource, /testDeepSeekChat|SmartBrief|smart-brief/);
  assert.doesNotMatch(mainSource, /deepseekChatClient|chat\/completions/);
});

test("notification summaries are generated automatically by local rules", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const summarySource = fs.readFileSync(
    path.join(__dirname, "..", "main", "notifications", "summaryService.js"),
    "utf8"
  );

  assert.match(appSource, /通知摘要/);
  assert.match(appSource, /Local rules automatically classify, deduplicate, and group updates/);
  assert.match(summarySource, /createLocalDigest/);
  assert.doesNotMatch(summarySource, /callChat|DeepSeek|responseFormat|persistDigest/);
});

test("workspace settings use registry labels and card controls without changing the settings payload", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
  const panelStart = appSource.indexOf("const WORKSPACE_MODULE_COPY");
  const panelEnd = appSource.indexOf("function githubSettingsPanel()", panelStart);
  const panelSource = appSource.slice(panelStart, panelEnd);
  const bindingStart = appSource.indexOf("function bindProductSettings()");
  const bindingEnd = appSource.indexOf("function bindGithubSettings()", bindingStart);
  const bindingSource = appSource.slice(bindingStart, bindingEnd);

  assert.match(panelSource, /workspace-settings-summary/);
  assert.match(panelSource, /workspace-module-card/);
  assert.match(panelSource, /const title = module\.title/);
  assert.match(panelSource, /概览/);
  assert.match(panelSource, /Floating/);
  assert.match(panelSource, /Notification digest/);
  assert.doesNotMatch(panelSource, /WORKSPACE_MODULE_TITLES|WORKSPACE_VIEW_LABELS/);
  assert.doesNotMatch(panelSource, /module\.views\.join/);
  assert.match(bindingSource, /modules:\s*\{\s*\.\.\.appSettings\.modules,\s*enabled\s*\}/);
  assert.match(bindingSource, /configureRefreshTasks\(\)/);
  assert.match(styles, /\.workspace-module-card:has\(input:checked\)/);
  assert.match(styles, /\.workspace-module-switch input:focus-visible \+ span/);
});

test("connected services use one status-led card system while preserving service handlers", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");

  assert.match(appSource, /const SETTINGS_SERVICE_PRESENTATION/);
  assert.match(appSource, /settings-services-summary/);
  assert.match(appSource, /settingsServiceNavButton\("github"/);
  assert.match(appSource, /settingsServiceNavButton\("weather"/);
  assert.match(appSource, /settingsServiceNavButton\("deepseek"/);
  assert.match(appSource, /settingsServiceNavButton\("mail"/);
  assert.match(appSource, /settingsServiceNavButton\("health"/);
  assert.match(appSource, /id="settings-health" data-settings-service data-settings-service-label="健康"/);
  assert.match(appSource, /Object\.keys\(SETTINGS_SERVICE_PRESENTATION\)\.length/);
  assert.match(appSource, /Sensitive values stay blank and are stored encrypted for the current Windows user/);
  assert.match(appSource, /window\.winplate\.saveWeatherSettings/);
  assert.match(appSource, /window\.winplate\.saveDeepSeekSettings/);
  assert.match(appSource, /window\.winplate\.saveMailSettings/);
  assert.match(appSource, /window\.winplate\.connectMail/);
  assert.match(styles, /\.settings-service-nav\s*\{[^}]*grid-template-columns:\s*repeat\(2,/);
  assert.match(styles, /\.settings-service-nav b\[data-state="ready"\]/);
});

test("GitHub workspace exposes annual navigation, Git commit history, and maintained repositories", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
  const githubStart = appSource.indexOf("function formattedGithubMonthLabel");
  const githubEnd = appSource.indexOf("const previewIcons", githubStart);
  const githubSource = appSource.slice(githubStart, githubEnd);

  assert.match(githubSource, /function githubYearHeatmap/);
  assert.match(githubSource, /data-contribution-month/);
  assert.match(githubSource, /function renderGithubContributionActivity/);
  assert.match(githubSource, /Git 提交历史/);
  assert.match(githubSource, /贡献热力图/);
  assert.match(githubSource, /维护中的仓库/);
  assert.match(githubSource, /data-github-contribution-repository/);
  assert.match(githubSource, /commit\?\.message/);
  assert.match(githubSource, /commit\?\.author/);
  assert.match(githubSource, /commit\?\.committedAt/);
  assert.match(githubSource, /function githubRepositoryCards/);
  assert.match(githubSource, /github\.repositories/);
  assert.doesNotMatch(githubSource, /Pinned repository/);
  assert.match(appSource, /function revealSelectedGithubMonth\(\)/);
  assert.match(appSource, /strip\.scrollLeft = Math\.min\(maximumScroll, Math\.max\(0, selectedEnd - strip\.clientWidth \+ 2\)\)/);
  assert.match(appSource, /function bindGithubControls\(\) \{\s*revealSelectedGithubMonth\(\);/);
  assert.match(appSource, /pageContent\.onchange = \(event\) =>/);
  assert.match(styles, /\.github-year-heatmap-scroll\s*\{[^}]*overflow-x:\s*auto/);
  assert.match(styles, /\.github-year-month\s*\{[^}]*width:\s*89px[^}]*flex:\s*0 0 89px/);
  assert.match(styles, /\.github-year-month-grid\s*\{[^}]*grid-template-columns:\s*repeat\(7, 9px\)[^}]*grid-auto-flow:\s*row[^}]*grid-auto-rows:\s*9px[^}]*gap:\s*2px/);
  assert.match(styles, /\.github-commit-records ol\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(styles, /\.github-maintained-grid\s*\{[^}]*repeat\(auto-fit,/);
});

test("top-docked floating view is a single frosted row with only requested controls", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
  const start = appSource.indexOf("function renderDockedFloating()");
  const end = appSource.indexOf("function renderFloating()", start);
  const dockedRenderer = appSource.slice(start, end);

  assert.match(dockedRenderer, /docked-status-line/);
  assert.match(dockedRenderer, /docked-weather/);
  assert.match(dockedRenderer, /docked-alert-slot/);
  assert.match(dockedRenderer, /renderSmartNotificationIcon\("alert-triangle"\)/);
  assert.match(dockedRenderer, /docked-usage/);
  assert.match(dockedRenderer, /docked-heart-rate/);
  assert.match(dockedRenderer, /healthMetric\(heart\.heartRate\)/);
  assert.match(dockedRenderer, /docked-heart-rate-unit/);
  assert.match(dockedRenderer, /docked-mail-status/);
  assert.match(dockedRenderer, /docked-mail-unread-badge/);
  assert.match(dockedRenderer, /unreadMailCount > 99 \? "99\+"/);
  assert.match(dockedRenderer, /renderSmartNotificationIcon\("mail"\)/);
  assert.match(dockedRenderer, /id="restore-capsule-button"/);
  assert.match(dockedRenderer, /restore-capsule-icon-back/);
  assert.match(dockedRenderer, /restore-capsule-icon-front/);
  assert.match(dockedRenderer, /document\.onmousemove = null/);
  assert.doesNotMatch(dockedRenderer, /id="pin-button"|github-module|notification-strip|heart-module|network-module|settings-button/);
  assert.doesNotMatch(dockedRenderer, /<button class="docked-module/);
  assert.equal((dockedRenderer.match(/<button\b/g) || []).length, 1);
  assert.ok(dockedRenderer.indexOf("docked-weather") < dockedRenderer.indexOf("docked-alert-slot"));
  assert.ok(dockedRenderer.indexOf("docked-alert-slot") < dockedRenderer.indexOf("docked-usage"));
  assert.ok(dockedRenderer.indexOf("docked-usage") < dockedRenderer.indexOf("docked-heart-rate"));
  assert.ok(dockedRenderer.indexOf("docked-heart-rate") < dockedRenderer.indexOf("docked-mail-status"));
  assert.ok(dockedRenderer.indexOf("docked-mail-status") < dockedRenderer.indexOf("restore-capsule-button"));
  assert.match(appSource, /function dockedWeatherAlertState[\s\S]*?notificationAlertColor\(item\)/);
  assert.match(appSource, /function dockedUnreadMailCount[\s\S]*?labels\.includes\("UNREAD"\)/);
  assert.match(styles, /\.docked-status-line\s*\{[\s\S]*?display:\s*flex/);
  assert.match(styles, /\.docked-alert-slot\.is-empty\s*\{[\s\S]*?visibility:\s*hidden/);
  assert.match(styles, /\.docked-mail-status\s*\{[\s\S]*?background:\s*transparent/);
  assert.match(styles, /\.docked-heart-rate\s*\{[\s\S]*?flex:\s*0 0 64px/);
  assert.match(styles, /\.docked-weather\s*\{[\s\S]*?flex:\s*0 1 84px/);
  assert.match(styles, /\.docked-usage\s*\{[\s\S]*?flex:\s*0 1 108px/);
  assert.match(styles, /\.docked-capsule\s*\{[\s\S]*?height:\s*44px/);
  assert.match(styles, /\.docked-capsule\s*\{[\s\S]*?background:\s*rgba\(20,\s*27,\s*36,\s*\.34\)/);
  assert.match(styles, /\.docked-capsule\s*\{[\s\S]*?backdrop-filter:\s*blur\(26px\)\s+saturate\(135%\)/);
  assert.match(styles, /\.restore-capsule-icon-back\s*\{[\s\S]*?fill:\s*none/);
  assert.match(styles, /\.restore-capsule-icon-front\s*\{[\s\S]*?fill:\s*none/);
});

test("floating health module shows whole BPM values and opens the Health section", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const renderStart = appSource.indexOf("function renderFloating()");
  const renderEnd = appSource.indexOf("function bindNotificationStrip", renderStart);
  const renderSource = appSource.slice(renderStart, renderEnd);
  const updateStart = appSource.indexOf("function updateFloatingStatusDom");
  const updateEnd = appSource.indexOf("async function refreshNetworkSpeed", updateStart);
  const updateSource = appSource.slice(updateStart, updateEnd);

  assert.match(renderSource, /<strong class="metric">\$\{healthMetric\(statusData\.heart\.heartRate\)\}<\/strong>/);
  assert.match(updateSource, /<strong class="metric">\$\{healthMetric\(statusData\.heart\.heartRate\)\}<\/strong>/);
  assert.match(renderSource, /heartModule\.addEventListener\("click", \(\) => window\.winplate\.showMainWindow\("Heart"\)\)/);
  assert.match(renderSource, /heartModule\.addEventListener\("keydown", \(event\) =>/);
  assert.match(renderSource, /heartModule\.setAttribute\("aria-label", "Open Health section"\)/);
});

test("top-docked status derives alert color and unread mail from source-owned state", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const start = appSource.indexOf("const DOCKED_ALERT_COLOR_RANK");
  const end = appSource.indexOf("function renderDockedFloating()", start);
  const context = {
    window: {
      WinPlateNotificationDigest: {
        notificationAlertColor: (item) => item.meta?.alertColor || null
      }
    }
  };
  vm.runInNewContext(`${appSource.slice(start, end)}
    this.dockedWeatherAlertState = dockedWeatherAlertState;
    this.dockedUnreadMailCount = dockedUnreadMailCount;`, context);

  const staleSummary = {
    items: [
      { id: "qweather:yellow", sourceId: "yellow", source: "qweather", createdAt: 300, meta: { lifecycle: "issued", alertColor: "yellow" } },
      { id: "qweather:red", sourceId: "red", source: "qweather", createdAt: 200, meta: { lifecycle: "issued", alertColor: "red" } },
      { source: "mail", createdAt: 500, meta: { alertColor: "blue" } }
    ]
  };
  assert.equal(context.dockedWeatherAlertState({ alerts: [] }, staleSummary), null);
  const alert = context.dockedWeatherAlertState({
    alerts: [
      { id: "yellow", createdAt: 300, lifecycle: "issued" },
      { id: "red", createdAt: 200, lifecycle: "issued" },
      { id: "resolved", createdAt: 400, lifecycle: "resolved" }
    ]
  }, staleSummary);
  assert.equal(alert.color, "red");
  assert.equal(context.dockedUnreadMailCount({
    items: [
      { unread: true, labels: [] },
      { unread: false, labels: ["UNREAD"] },
      { unread: false, labels: ["STARRED"] }
    ]
  }), 2);
});

test("scheduled mail refreshes force an IMAP pull instead of rereading the outline cache", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const start = appSource.indexOf("async function refreshMailData(");
  const end = appSource.indexOf("function moduleHealthMessage", start);
  const refreshMailData = appSource.slice(start, end);

  assert.match(refreshMailData, /hydrateMail\(\{\s*force:\s*true\s*\}\)/);
  assert.doesNotMatch(refreshMailData, /hydrateMail\(\{\s*force\s*\}\)/);
});

test("Windows health configuration lives in settings while the health workspace keeps snapshot and diagnostics", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
  const connectionStart = appSource.indexOf("function healthConnectionCard()");
  const connectionEnd = appSource.indexOf("function healthSnapshotCard()", connectionStart);
  const connectionSource = appSource.slice(connectionStart, connectionEnd);
  const detailStart = appSource.indexOf("function healthDetailContent()");
  const detailEnd = appSource.indexOf("function dashboardContributionMonth", detailStart);
  const detailSource = appSource.slice(detailStart, detailEnd);
  const snapshotStart = appSource.indexOf("function healthSnapshotCard()");
  const snapshotEnd = appSource.indexOf("function healthDiagnosticsCard()", snapshotStart);
  const snapshotSource = appSource.slice(snapshotStart, snapshotEnd);
  const diagnosticsStart = appSource.indexOf("function healthDiagnosticsCard()");
  const diagnosticsEnd = appSource.indexOf("function healthDetailContent()", diagnosticsStart);
  const diagnosticsSource = appSource.slice(diagnosticsStart, diagnosticsEnd);

  assert.match(connectionSource, /iPhone 通信/);
  assert.match(connectionSource, /Windows 接收地址/);
  assert.match(connectionSource, /data-copy-health-url/);
  assert.match(appSource, /id="settings-health" data-settings-service data-settings-service-label="健康"\s*>\s*\$\{healthConnectionCard\(\)\}/);
  assert.match(detailSource, /healthSnapshotCard\(\)/);
  assert.match(detailSource, /healthDiagnosticsCard\(\)/);
  assert.match(snapshotSource, /健康快照/);
  assert.match(diagnosticsSource, /通信诊断/);
  assert.match(diagnosticsSource, /健康权限/);
  assert.doesNotMatch(detailSource, /iPhone 通信|Windows 接收地址|data-copy-health-url/);
  assert.match(appSource, /Heart: healthDetailContent\(\)/);
  assert.match(appSource, /if \(value === null \|\| value === undefined \|\| value === ""\) return "--"/);
  assert.match(appSource, /function healthStatusBadge\(status = healthSyncStatus\)/);
  assert.match(styles, /\.health-metrics-grid\s*\{/);
  assert.match(styles, /\.health-empty-state\s*\{/);
  assert.match(styles, /\.health-diagnostic-row\s*\{/);
});

test("health display helpers preserve empty values and use Chinese sync labels", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const helperStart = appSource.indexOf("function healthTimestamp");
  const helperEnd = appSource.indexOf("function normalizeGithub", helperStart);
  const context = {};
  vm.runInNewContext(`${appSource.slice(helperStart, helperEnd)}
    this.healthMetric = healthMetric;
    this.healthStateLabel = healthStateLabel;`, context);

  assert.equal(context.healthMetric(null), "--");
  assert.equal(context.healthMetric(undefined), "--");
  assert.equal(context.healthMetric(76.5), "77");
  assert.equal(context.healthMetric(4321), "4,321");
  assert.equal(context.healthStateLabel("waiting"), "等待 iPhone");
  assert.equal(context.healthStateLabel("live"), "已同步");
  assert.equal(context.healthStateLabel("stale"), "数据过期");
});

test("renderer CSP allows only the intended external image capability", () => {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  assert.match(html, /img-src[^;]*https:/);
});
