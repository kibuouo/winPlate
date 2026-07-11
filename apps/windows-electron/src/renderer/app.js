function normalizeGithub(github = {}, fallback = mockStatus.github) {
  const definedEntries = (value) => Object.fromEntries(
    Object.entries(value || {}).filter(([, entry]) => entry !== undefined && entry !== null)
  );
  const merged = {
    ...mockStatus.github,
    ...definedEntries(fallback),
    ...definedEntries(github)
  };
  return {
    ...merged,
    repos: Number.isFinite(Number(merged.repos)) ? Number(merged.repos) : 0,
    followers: Number.isFinite(Number(merged.followers)) ? Number(merged.followers) : 0,
    commitsThisMonth: Number.isFinite(Number(merged.commitsThisMonth)) ? Number(merged.commitsThisMonth) : 0,
    streakDays: Number.isFinite(Number(merged.streakDays)) ? Number(merged.streakDays) : 0,
    stars: Number.isFinite(Number(merged.stars)) ? Number(merged.stars) : 0,
    availability: merged.availability || "live",
    stateMessage: merged.stateMessage || "",
    project: merged.project || "No public repositories",
    language: merged.language || "Unknown",
    contributions30d: Array.isArray(merged.contributions30d)
      ? merged.contributions30d.slice(-30)
      : Array(30).fill(0),
    contributionMonths: Array.isArray(merged.contributionMonths)
      ? merged.contributionMonths
      : []
  };
}

let statusData = { ...mockStatus, github: normalizeGithub(mockStatus.github) };
const appRoot = document.querySelector("#app");
const view = new URLSearchParams(window.location.search).get("view") || "main";
const isMac = window.winplate.platform === "darwin";
const APP_SETTING_KEYS = ["menuBarEnabled", "launchAtLogin"];
let applicationSettings = {
  menuBarEnabled: true,
  launchAtLogin: false
};
let applicationSettingsBusy = false;
const boundApplicationSettingsControls = new WeakSet();
let currentSection = "Dashboard";
let floatingPinned = false;
let systemClockTimer = null;
let tooltipHideTimer = null;
let mainWindowMaximized = false;
let sidebarCollapsed = false;
let selectedContributionMonth = null;
let selectedContributionDate = null;
const githubContributionDetailCache = new Map();
let githubContributionRequestId = 0;
let githubRefreshInFlight = false;
let refreshNoticeTimer = null;
let locationWeatherPromise = null;
let weatherSettings = { hasApiKey: false, apiHost: "devapi.qweather.com" };
let deepseekSettings = { hasApiKey: false, baseUrl: "https://api.deepseek.com" };
let mailSettings = { configured: false, connected: false, windowDays: 30 };
let mailOutline = { source: "loading", availability: "loading", items: [], updatedAt: null };
let mailRefreshInFlight = false;
let mailDetail = { open: false, loading: false, uid: null, message: null, error: "" };
let mailHighlightedUid = null;
const MAIL_DETAIL_READ_TIMEOUT_MS = 8_000;
const RENDERER_REFRESH_TIMEOUT_MS = 15_000;
let notificationSummary = { unreadCount: 0, latest: null, items: [], updatedAt: null };
let weatherAlerts = { source: "qweather", alerts: [], updatedAt: null, error: "" };
let selectedWeatherAlertId = null;
let notificationDigest = {
  headline: "暂无新通知",
  summary: "当前没有需要关注的新通知。",
  priority: "none",
  severity: "info",
  category: "system",
  iconKey: "bell",
  primarySource: "system",
  unreadCount: 0,
  groups: [],
  spokenText: "当前没有需要关注的新通知。",
  sourceIds: [],
  generatedAt: null
};
let notificationActionInFlight = false;
let notificationRawExpanded = false;
let notificationDrawerState = { open: false, mode: "list", returnFocus: null };
let notificationDetail = { open: false, loading: false, id: null, data: null, error: "" };
let notificationActionFeedback = "";
let networkSpeed = {
  downloadBytesPerSecond: 0,
  uploadBytesPerSecond: 0,
  latencyMs: null,
  status: "获取中",
  error: "",
  updatedAt: null
};
let qweatherUsage = { used: 0, total: 50000, remaining: 50000, percent: 0, today: 0, month: "" };
let qweatherOfficialStats = null;
let qweatherUsageMessage = "";
let qweatherOfficialStatus = null;
const moduleDefinitions = window.WinPlateModuleRegistry.MODULES;
const rendererModuleById = new Map(window.WinPlateRendererModules.map((module) => [module.meta.id, module]));
const moduleHealth = Object.fromEntries(moduleDefinitions.map((module) => [module.id, {
  state: "loading",
  lastSuccessAt: null,
  lastAttemptAt: null,
  error: ""
}]));
let appSettings = {
  version: 1,
  appearance: { theme: "system", opacity: 0.94, density: "comfortable" },
  modules: {
    enabled: Object.fromEntries(moduleDefinitions.map((module) => [module.id, module.defaultEnabled])),
    order: [...moduleDefinitions].sort((a, b) => a.defaultOrder - b.defaultOrder).map((module) => module.id),
    refreshSeconds: Object.fromEntries(moduleDefinitions.map((module) => [module.id, module.defaultRefreshSeconds]))
  },
  integrations: { github: { username: "kibuouo", hasToken: false } },
  notificationDigest: { enabled: true }
};
const refreshController = window.WinPlateRefresh.createRefreshController({
  onHealthChange: (taskId, health) => {
    const affected = taskId === "status"
      ? ["weather", "heart"]
      : taskId === "deepseek"
        ? ["codex"]
        : [taskId];
    affected.forEach((id) => {
      if (moduleHealth[id]) moduleHealth[id] = { ...health };
    });
    updateModuleHealthDom(affected);
  }
});
const THEME_STORAGE_KEY = "winplate-theme";
const WEATHER_LOCATION_STORAGE_KEY = "winplate-weather-location";
const DEFAULT_MAIL_AUTO_REFRESH_SECONDS = 30;
const MIN_MAIL_AUTO_REFRESH_SECONDS = 15;
const MAX_MAIL_AUTO_REFRESH_SECONDS = 30 * 60;
const WEATHER_LOCATION_REGIONS = [
  { id: "auto", label: "自动定位", cities: [{ id: "auto", label: "系统定位" }] },
  { id: "beijing", label: "北京市", cities: [{ id: "beijing", label: "北京", latitude: 39.9042, longitude: 116.4074 }] },
  { id: "tianjin", label: "天津市", cities: [{ id: "tianjin", label: "天津", latitude: 39.3434, longitude: 117.3616 }] },
  { id: "hebei", label: "河北省", cities: [{ id: "shijiazhuang", label: "石家庄", latitude: 38.0428, longitude: 114.5149 }, { id: "tangshan", label: "唐山", latitude: 39.6309, longitude: 118.1802 }, { id: "qinhuangdao", label: "秦皇岛", latitude: 39.9354, longitude: 119.6005 }] },
  { id: "shanxi", label: "山西省", cities: [{ id: "taiyuan", label: "太原", latitude: 37.8706, longitude: 112.5489 }, { id: "datong", label: "大同", latitude: 40.0768, longitude: 113.3001 }] },
  { id: "inner-mongolia", label: "内蒙古自治区", cities: [{ id: "hohhot", label: "呼和浩特", latitude: 40.8426, longitude: 111.7492 }, { id: "baotou", label: "包头", latitude: 40.6574, longitude: 109.8403 }] },
  { id: "liaoning", label: "辽宁省", cities: [{ id: "shenyang", label: "沈阳", latitude: 41.8057, longitude: 123.4315 }, { id: "dalian", label: "大连", latitude: 38.914, longitude: 121.6147 }] },
  { id: "jilin", label: "吉林省", cities: [{ id: "changchun", label: "长春", latitude: 43.8171, longitude: 125.3235 }, { id: "jilin-city", label: "吉林", latitude: 43.8378, longitude: 126.5494 }] },
  { id: "heilongjiang", label: "黑龙江省", cities: [{ id: "harbin", label: "哈尔滨", latitude: 45.8038, longitude: 126.5349 }, { id: "qiqihar", label: "齐齐哈尔", latitude: 47.3543, longitude: 123.9182 }] },
  { id: "shanghai", label: "上海市", cities: [{ id: "shanghai", label: "上海", latitude: 31.2304, longitude: 121.4737 }] },
  { id: "jiangsu", label: "江苏省", cities: [{ id: "nanjing", label: "南京", latitude: 32.0603, longitude: 118.7969 }, { id: "suzhou", label: "苏州", latitude: 31.2989, longitude: 120.5853 }, { id: "wuxi", label: "无锡", latitude: 31.4912, longitude: 120.3119 }] },
  { id: "zhejiang", label: "浙江省", cities: [{ id: "hangzhou", label: "杭州", latitude: 30.2741, longitude: 120.1551 }, { id: "ningbo", label: "宁波", latitude: 29.8683, longitude: 121.544 }, { id: "wenzhou", label: "温州", latitude: 27.9938, longitude: 120.6994 }] },
  { id: "anhui", label: "安徽省", cities: [{ id: "hefei", label: "合肥", latitude: 31.8206, longitude: 117.2272 }, { id: "wuhu", label: "芜湖", latitude: 31.3525, longitude: 118.4331 }] },
  { id: "fujian", label: "福建省", cities: [{ id: "fuzhou", label: "福州", latitude: 26.0745, longitude: 119.2965 }, { id: "xiamen", label: "厦门", latitude: 24.4798, longitude: 118.0894 }, { id: "quanzhou", label: "泉州", latitude: 24.8739, longitude: 118.6759 }] },
  { id: "jiangxi", label: "江西省", cities: [{ id: "nanchang", label: "南昌", latitude: 28.682, longitude: 115.8582 }, { id: "jiujiang", label: "九江", latitude: 29.7051, longitude: 116.0019 }] },
  { id: "shandong", label: "山东省", cities: [{ id: "jinan", label: "济南", latitude: 36.6512, longitude: 117.1201 }, { id: "qingdao", label: "青岛", latitude: 36.0671, longitude: 120.3826 }, { id: "yantai", label: "烟台", latitude: 37.4638, longitude: 121.4479 }] },
  { id: "henan", label: "河南省", cities: [{ id: "zhengzhou", label: "郑州", latitude: 34.7466, longitude: 113.6254 }, { id: "luoyang", label: "洛阳", latitude: 34.6197, longitude: 112.454 }] },
  { id: "hubei", label: "湖北省", cities: [{ id: "wuhan", label: "武汉", latitude: 30.5928, longitude: 114.3055 }, { id: "yichang", label: "宜昌", latitude: 30.6919, longitude: 111.2865 }] },
  { id: "hunan", label: "湖南省", cities: [{ id: "changsha", label: "长沙", latitude: 28.2282, longitude: 112.9388 }, { id: "zhangjiajie", label: "张家界", latitude: 29.1171, longitude: 110.4792 }] },
  { id: "guangdong", label: "广东省", cities: [{ id: "guangzhou", label: "广州", latitude: 23.1291, longitude: 113.2644 }, { id: "shenzhen", label: "深圳", latitude: 22.5431, longitude: 114.0579 }, { id: "zhuhai", label: "珠海", latitude: 22.2707, longitude: 113.5767 }] },
  { id: "guangxi", label: "广西壮族自治区", cities: [{ id: "nanning", label: "南宁", latitude: 22.817, longitude: 108.3669 }, { id: "guilin", label: "桂林", latitude: 25.2736, longitude: 110.2902 }] },
  { id: "hainan", label: "海南省", cities: [{ id: "haikou", label: "海口", latitude: 20.044, longitude: 110.1999 }, { id: "sanya", label: "三亚", latitude: 18.2528, longitude: 109.5119 }] },
  { id: "chongqing", label: "重庆市", cities: [{ id: "chongqing", label: "重庆", latitude: 29.563, longitude: 106.5516 }] },
  { id: "sichuan", label: "四川省", cities: [{ id: "chengdu", label: "成都", latitude: 30.5728, longitude: 104.0668 }, { id: "mianyang", label: "绵阳", latitude: 31.4675, longitude: 104.6796 }] },
  { id: "guizhou", label: "贵州省", cities: [{ id: "guiyang", label: "贵阳", latitude: 26.647, longitude: 106.6302 }, { id: "zunyi", label: "遵义", latitude: 27.7257, longitude: 106.9274 }] },
  { id: "yunnan", label: "云南省", cities: [{ id: "kunming", label: "昆明", latitude: 25.0438, longitude: 102.7103 }, { id: "dali", label: "大理", latitude: 25.6065, longitude: 100.2676 }] },
  { id: "tibet", label: "西藏自治区", cities: [{ id: "lhasa", label: "拉萨", latitude: 29.6503, longitude: 91.1322 }] },
  { id: "shaanxi", label: "陕西省", cities: [{ id: "xian", label: "西安", latitude: 34.3416, longitude: 108.9398 }, { id: "yanan", label: "延安", latitude: 36.5853, longitude: 109.4898 }] },
  { id: "gansu", label: "甘肃省", cities: [{ id: "lanzhou", label: "兰州", latitude: 36.0611, longitude: 103.8343 }, { id: "dunhuang", label: "敦煌", latitude: 40.1421, longitude: 94.6618 }] },
  { id: "qinghai", label: "青海省", cities: [{ id: "xining", label: "西宁", latitude: 36.6171, longitude: 101.7782 }] },
  { id: "ningxia", label: "宁夏回族自治区", cities: [{ id: "yinchuan", label: "银川", latitude: 38.4872, longitude: 106.2309 }] },
  { id: "xinjiang", label: "新疆维吾尔自治区", cities: [{ id: "urumqi", label: "乌鲁木齐", latitude: 43.8256, longitude: 87.6168 }, { id: "kashgar", label: "喀什", latitude: 39.4704, longitude: 75.9898 }] },
  { id: "hong-kong", label: "香港特别行政区", cities: [{ id: "hong-kong", label: "香港", latitude: 22.3193, longitude: 114.1694 }] },
  { id: "macau", label: "澳门特别行政区", cities: [{ id: "macau", label: "澳门", latitude: 22.1987, longitude: 113.5439 }] },
  { id: "taiwan", label: "台湾省", cities: [{ id: "taipei", label: "台北", latitude: 25.033, longitude: 121.5654 }, { id: "kaohsiung", label: "高雄", latitude: 22.6273, longitude: 120.3014 }] }
];
let weatherLocationPreference = localStorage.getItem(WEATHER_LOCATION_STORAGE_KEY) || "auto";
let weatherUpdateVersion = 0;
const themeMedia = window.matchMedia("(prefers-color-scheme: dark)");
let themePreference = "system";
let mailAutoRefreshSeconds = DEFAULT_MAIL_AUTO_REFRESH_SECONDS;

function moduleEnabled(id) {
  return appSettings.modules.enabled[id] !== false;
}

function moduleRefreshSeconds(id) {
  const definition = window.WinPlateModuleRegistry.getModuleMeta(id);
  const value = Number(appSettings.modules.refreshSeconds[id]);
  if (!definition || !Number.isFinite(value)) return definition?.defaultRefreshSeconds || 60;
  return Math.max(definition.minRefreshSeconds, Math.min(definition.maxRefreshSeconds, value));
}

function moduleHealthLabel(id) {
  const health = moduleHealth[id] || {};
  if (health.state === "live") return "实时";
  if (health.state === "stale") return "缓存";
  if (health.state === "error") return "不可用";
  return "读取中";
}

function moduleHealthAttributes(id) {
  const health = moduleHealth[id] || {};
  return `data-module-health="${escapeHtml(health.state || "loading")}" data-module-error="${escapeHtml(health.error || "")}"`;
}

function normalizeMailAutoRefreshSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return DEFAULT_MAIL_AUTO_REFRESH_SECONDS;
  return Math.max(
    MIN_MAIL_AUTO_REFRESH_SECONDS,
    Math.min(MAX_MAIL_AUTO_REFRESH_SECONDS, Math.round(seconds))
  );
}

function mailAutoRefreshLabel(seconds = mailAutoRefreshSeconds) {
  const safeSeconds = normalizeMailAutoRefreshSeconds(seconds);
  if (safeSeconds < 60) return `${safeSeconds} 秒`;
  if (safeSeconds % 60 === 0) return `${safeSeconds / 60} 分钟`;
  const minutes = Math.floor(safeSeconds / 60);
  const remainSeconds = safeSeconds % 60;
  return `${minutes} 分 ${remainSeconds} 秒`;
}

function mergeApplicationSettings(settings) {
  const nextSettings = { ...applicationSettings };
  for (const key of APP_SETTING_KEYS) {
    if (typeof settings?.[key] === "boolean") nextSettings[key] = settings[key];
  }
  return nextSettings;
}

function syncApplicationSettingsControls() {
  document.querySelectorAll("[data-app-setting]").forEach((input) => {
    const key = input.dataset.appSetting;
    if (APP_SETTING_KEYS.includes(key)) {
      input.checked = applicationSettings[key];
      input.disabled = applicationSettingsBusy;
    }
  });
}

async function hydrateAppSettings() {
  if (view !== "main" || !isMac || applicationSettingsBusy) return;
  applicationSettingsBusy = true;
  syncApplicationSettingsControls();
  try {
    applicationSettings = mergeApplicationSettings(await window.winplate.getAppSettings());
  } catch (error) {
    console.error("Failed to load application settings:", error?.message || String(error));
  } finally {
    applicationSettingsBusy = false;
    syncApplicationSettingsControls();
  }
}

function bindApplicationSettingsControls() {
  if (!isMac || view !== "main") return;
  syncApplicationSettingsControls();
  document.querySelectorAll("[data-app-setting]").forEach((input) => {
    if (boundApplicationSettingsControls.has(input)) return;
    boundApplicationSettingsControls.add(input);
    input.addEventListener("change", async () => {
      const key = input.dataset.appSetting;
      if (!APP_SETTING_KEYS.includes(key)) return;
      if (applicationSettingsBusy) {
        syncApplicationSettingsControls();
        return;
      }
      const previousSettings = {
        menuBarEnabled: applicationSettings.menuBarEnabled,
        launchAtLogin: applicationSettings.launchAtLogin
      };
      applicationSettingsBusy = true;
      applicationSettings = { ...applicationSettings, [key]: input.checked };
      syncApplicationSettingsControls();
      try {
        const normalized = await window.winplate.saveAppSettings({
          menuBarEnabled: applicationSettings.menuBarEnabled,
          launchAtLogin: applicationSettings.launchAtLogin
        });
        applicationSettings = mergeApplicationSettings(normalized);
      } catch (error) {
        applicationSettings = previousSettings;
        console.error("Failed to save application settings:", error?.message || String(error));
      } finally {
        applicationSettingsBusy = false;
        syncApplicationSettingsControls();
      }
    });
  });
}

function resolvedTheme() {
  return themePreference === "system"
    ? (themeMedia.matches ? "dark" : "light")
    : themePreference;
}

function applyMainTheme() {
  const theme = resolvedTheme();
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.density = appSettings.appearance.density;
  document.documentElement.style.colorScheme = theme;
  document.documentElement.style.setProperty("--window-opacity", String(appSettings.appearance.opacity));
  document.documentElement.style.setProperty("--window-opacity-percent", `${Math.round(appSettings.appearance.opacity * 100)}%`);
  if (view === "main") window.winplate.setWindowTheme(theme);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[character]));
}

async function setThemePreference(theme) {
  if (!["light", "dark", "system"].includes(theme)) return;
  themePreference = theme;
  appSettings.appearance.theme = theme;
  applyMainTheme();
  bindThemeControls();
  try {
    await window.winplate.saveAppearanceSettings({ theme });
    localStorage.removeItem(THEME_STORAGE_KEY);
  } catch (error) {
    console.error("Failed to save appearance settings:", error);
  }
}

async function hydrateAppearanceSettings() {
  const legacyTheme = localStorage.getItem(THEME_STORAGE_KEY);
  try {
    const settings = window.winplate.getSettings
      ? await window.winplate.getSettings()
      : null;
    if (settings) appSettings = settings;
    const appearance = settings?.appearance || await window.winplate.getAppearanceSettings();
    themePreference = ["light", "dark", "system"].includes(appearance?.theme)
      ? appearance.theme
      : "system";
    mailAutoRefreshSeconds = normalizeMailAutoRefreshSeconds(
      settings?.modules?.refreshSeconds?.mail ?? appearance?.mailAutoRefreshSeconds
    );
    appSettings.appearance.theme = themePreference;
    appSettings.modules.refreshSeconds.mail = mailAutoRefreshSeconds;
    if (legacyTheme && ["light", "dark", "system"].includes(legacyTheme)) {
      themePreference = legacyTheme;
      await window.winplate.saveAppearanceSettings({
        theme: legacyTheme,
        mailAutoRefreshSeconds
      });
      localStorage.removeItem(THEME_STORAGE_KEY);
    }
  } catch (error) {
    console.error("Failed to load appearance settings:", error);
    if (legacyTheme && ["light", "dark", "system"].includes(legacyTheme)) {
      themePreference = legacyTheme;
    }
    mailAutoRefreshSeconds = DEFAULT_MAIL_AUTO_REFRESH_SECONDS;
  }
  applyMainTheme();
}

function themeSelector() {
  const options = [
    ["light", `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.25"></circle><path d="M12 2.5v2M12 19.5v2M4.5 12h-2M21.5 12h-2M5.28 5.28l1.42 1.42M17.3 17.3l1.42 1.42M18.72 5.28 17.3 6.7M6.7 17.3l-1.42 1.42"></path></svg>`, "浅色"],
    ["dark", `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.2 15.25A8.6 8.6 0 0 1 8.75 3.8 8.6 8.6 0 1 0 20.2 15.25Z"></path></svg>`, "深色"],
    ["system", `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4.25" y="4.25" width="15.5" height="11.75" rx="1.5"></rect><path d="M2.75 18h18.5l-1 1.75H3.75L2.75 18Z"></path></svg>`, "系统"]
  ];
  return `
    <div class="appearance-setting">
      <span>
        <strong>主题</strong>
        <small>使用浅色、深色，或匹配系统设置</small>
      </span>
      <div class="theme-selector" role="radiogroup" aria-label="主题">
        ${options.map(([value, icon, label]) => `
          <button type="button" class="${themePreference === value ? "active" : ""}" data-theme-choice="${value}" role="radio" aria-checked="${themePreference === value}">
            <i>${icon}</i><span>${label}</span>
          </button>`).join("")}
      </div>
    </div>`;
}

function bindThemeControls() {
  document.querySelectorAll("[data-theme-choice]").forEach((button) => {
    button.classList.toggle("active", button.dataset.themeChoice === themePreference);
    button.setAttribute("aria-checked", String(button.dataset.themeChoice === themePreference));
    button.onclick = () => setThemePreference(button.dataset.themeChoice);
  });
}

function productSettingsPanel() {
  const github = appSettings.integrations.github || {};
  const digest = appSettings.notificationDigest || {};
  const ordered = window.WinPlateModuleRegistry.orderedModules(appSettings.modules.order);
  return `
    <form class="settings-panel product-settings-panel" id="product-settings-form">
      <fieldset>
        <legend><strong>界面密度</strong><small>透明度只影响 WinPlate 表面，不影响文字对比度</small></legend>
        <label>
          <span><strong>透明度</strong><small>允许范围 65%–100%</small></span>
          <input id="window-opacity" type="number" min="0.65" max="1" step="0.01" value="${appSettings.appearance.opacity}">
        </label>
        <label>
          <span><strong>布局密度</strong><small>紧凑模式减少卡片留白</small></span>
          <select id="window-density">
            <option value="comfortable" ${appSettings.appearance.density === "comfortable" ? "selected" : ""}>舒展</option>
            <option value="compact" ${appSettings.appearance.density === "compact" ? "selected" : ""}>紧凑</option>
          </select>
        </label>
      </fieldset>
      <fieldset>
        <legend><strong>GitHub</strong><small>Token 留空时保持现有值，不会回显到页面</small></legend>
        <label>
          <span><strong>用户名</strong><small>保存后立即刷新 GitHub 模块</small></span>
          <input id="github-username" type="text" autocomplete="off" value="${escapeHtml(github.username || "kibuouo")}">
        </label>
        <label>
          <span><strong>Personal access token</strong><small>${github.hasToken ? "已配置" : "未配置"}</small></span>
          <input id="github-token" type="password" autocomplete="off" placeholder="${github.hasToken ? "已配置，留空保持不变" : "可选"}">
        </label>
      </fieldset>
      <fieldset>
        <legend><strong>模块管理</strong><small>禁用模块会隐藏界面并停止自动刷新</small></legend>
        <div class="module-settings-list">
          ${ordered.map((module, index) => `
            <div class="module-settings-row" data-module-setting="${module.id}">
              <label class="module-enabled"><input type="checkbox" data-module-enabled ${moduleEnabled(module.id) ? "checked" : ""}><span><strong>${module.title}</strong><small>${module.views.join(" · ")}</small></span></label>
              <label><span>顺序</span><input type="number" min="1" max="${ordered.length}" value="${index + 1}" data-module-order></label>
              <label><span>刷新（秒）</span><input type="number" min="${module.minRefreshSeconds}" max="${module.maxRefreshSeconds}" value="${moduleRefreshSeconds(module.id)}" data-module-refresh></label>
            </div>`).join("")}
        </div>
      </fieldset>
      <fieldset>
        <legend><strong>智能通知摘要</strong><small>本地规则始终保留，AI 不可用时自动降级</small></legend>
        <label>
          <span><strong>启用 AI 摘要</strong><small>关闭后仅使用本地分级、去重和聚合</small></span>
          <input id="notification-ai-enabled" type="checkbox" ${digest.enabled ? "checked" : ""}>
        </label>
      </fieldset>
      <div class="product-settings-actions">
        <small id="product-settings-status">配置保存在当前 Windows 用户目录</small>
        <button type="submit">保存通用设置</button>
      </div>
    </form>`;
}

function bindProductSettings() {
  const form = document.querySelector("#product-settings-form");
  if (!form) return;
  form.onsubmit = async (event) => {
    event.preventDefault();
    const status = form.querySelector("#product-settings-status");
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    status.textContent = "正在保存...";
    const rows = [...form.querySelectorAll("[data-module-setting]")];
    const order = rows
      .map((row) => ({ id: row.dataset.moduleSetting, order: Number(row.querySelector("[data-module-order]").value) }))
      .sort((left, right) => left.order - right.order)
      .map((item) => item.id);
    const enabled = Object.fromEntries(rows.map((row) => [
      row.dataset.moduleSetting,
      row.querySelector("[data-module-enabled]").checked
    ]));
    const refreshSeconds = Object.fromEntries(rows.map((row) => [
      row.dataset.moduleSetting,
      Number(row.querySelector("[data-module-refresh]").value)
    ]));
    const nextSettings = {
      ...appSettings,
      appearance: {
        ...appSettings.appearance,
        opacity: Number(form.querySelector("#window-opacity").value),
        density: form.querySelector("#window-density").value
      },
      modules: { enabled, order, refreshSeconds },
      integrations: {
        ...appSettings.integrations,
        github: {
          username: form.querySelector("#github-username").value.trim(),
          token: form.querySelector("#github-token").value.trim()
        }
      },
      notificationDigest: {
        enabled: form.querySelector("#notification-ai-enabled").checked
      }
    };
    try {
      appSettings = await window.winplate.saveSettings(nextSettings);
      themePreference = appSettings.appearance.theme;
      mailAutoRefreshSeconds = normalizeMailAutoRefreshSeconds(appSettings.modules.refreshSeconds.mail);
      applyMainTheme();
      configureRefreshTasks();
      status.textContent = "已保存并应用";
      currentSection = moduleEnabled("github") || moduleEnabled("codex") ? currentSection : "Dashboard";
      refreshController.refresh("github", { force: true, reason: "settings" }).catch(() => {});
    } catch (error) {
      status.textContent = error.message || "保存失败";
      status.className = "error";
      button.disabled = false;
    }
  };
}

function hasOfficialWeatherSettings(settings = weatherSettings) {
  return Boolean(settings.projectId && settings.credentialId && settings.hasPrivateKey);
}

function weatherLocationSourceLabel(source) {
  return {
    manual: "手动城市",
    system: "系统定位",
    ip: "IP 猜测（实验性）",
    env: "环境变量"
  }[source] || "未配置";
}

function relativeWeatherLocationTime(updatedAt) {
  const value = Number(updatedAt);
  if (!Number.isFinite(value)) return "未知";
  const minutes = Math.max(0, Math.round((Date.now() - value) / 60_000));
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} 小时前` : `${Math.round(hours / 24)} 天前`;
}

function updateWeatherSettingsStatuses(form, serviceState, officialState) {
  const serviceStatus = form.querySelector("#weather-service-status");
  const officialStatus = form.querySelector("#weather-official-status");
  const states = {
    configured: ["已配置", "configured"],
    unconfigured: ["未配置", ""],
    permission: ["权限不足", "error"],
    failed: ["校验失败", "error"],
    saving: ["正在保存...", ""],
    readFailed: ["读取失败", "error"]
  };
  const applyState = (element, prefix, state) => {
    const [text, className] = states[state];
    element.textContent = `${prefix}：${text}`;
    element.className = className;
  };
  applyState(serviceStatus, "天气服务", serviceState);
  applyState(officialStatus, "官方统计", officialState);
}

async function bindWeatherSettings() {
  const form = document.querySelector("#weather-settings-form");
  if (!form) return;
  const keyInput = form.querySelector("#qweather-api-key");
  const hostInput = form.querySelector("#qweather-api-host");
  const projectInput = form.querySelector("#qweather-project-id");
  const credentialInput = form.querySelector("#qweather-credential-id");
  const privateKeyInput = form.querySelector("#qweather-private-key");
  const saveButton = form.querySelector("button[type='submit']");
  try {
    weatherSettings = await window.winplate.getWeatherSettings();
    hostInput.value = weatherSettings.apiHost;
    projectInput.value = weatherSettings.projectId || "";
    credentialInput.value = weatherSettings.credentialId || "";
    keyInput.placeholder = weatherSettings.hasApiKey ? "已配置，留空则保持不变" : "请输入 API Key";
    privateKeyInput.placeholder = weatherSettings.hasPrivateKey ? "已配置，留空则保持不变" : "粘贴 Ed25519 私钥";
    updateWeatherSettingsStatuses(
      form,
      weatherSettings.hasApiKey && Boolean(weatherSettings.apiHost) ? "configured" : "unconfigured",
      qweatherOfficialStatus || (hasOfficialWeatherSettings() ? "configured" : "unconfigured")
    );
  } catch (error) {
    updateWeatherSettingsStatuses(form, "readFailed", "readFailed");
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    saveButton.disabled = true;
    updateWeatherSettingsStatuses(form, "saving", "saving");
    try {
      weatherSettings = await window.winplate.saveWeatherSettings({
        apiKey: keyInput.value,
        apiHost: hostInput.value,
        projectId: projectInput.value,
        credentialId: credentialInput.value,
        privateKey: privateKeyInput.value
      });
      keyInput.value = "";
      privateKeyInput.value = "";
      keyInput.placeholder = "已配置，留空则保持不变";
      privateKeyInput.placeholder = weatherSettings.hasPrivateKey ? "已配置，留空则保持不变" : "粘贴 Ed25519 私钥";
      qweatherOfficialStatus = null;
      updateWeatherSettingsStatuses(
        form,
        weatherSettings.hasApiKey && Boolean(weatherSettings.apiHost) ? "configured" : "unconfigured",
        hasOfficialWeatherSettings() ? "configured" : "unconfigured"
      );
      locationWeatherPromise = null;
      refreshStatus();
    } catch (error) {
      updateWeatherSettingsStatuses(
        form,
        weatherSettings.hasApiKey && Boolean(weatherSettings.apiHost) ? "configured" : "unconfigured",
        qweatherOfficialStatus || (hasOfficialWeatherSettings() ? "configured" : "unconfigured")
      );
    } finally {
      saveButton.disabled = false;
    }
  });
}

function bindWeatherLocationSettings() {
  const queryInput = document.querySelector("#weather-location-query");
  const resultsBox = document.querySelector("#weather-location-results");
  const status = document.querySelector("#weather-location-status");
  const systemButton = document.querySelector("#weather-system-location");
  if (!queryInput || !resultsBox || !status) return;
  let searchTimer = null;
  const setStatus = (text, className = "") => {
    status.textContent = text;
    status.className = `weather-location-status ${className}`.trim();
  };
  const selectLocation = async (item) => {
    resultsBox.innerHTML = "";
    queryInput.value = item.displayName || item.name || "";
    queryInput.disabled = true;
    setStatus("正在保存城市...");
    try {
      const weather = await window.winplate.setManualWeatherLocation({
        locationId: item.id,
        name: item.name,
        adm1: item.adm1,
        latitude: item.lat == null ? null : Number(item.lat),
        longitude: item.lon == null ? null : Number(item.lon)
      });
      statusData.weather = { ...statusData.weather, ...weather };
      setStatus("已保存手动城市", "configured");
      await refreshStatus();
    } catch (error) {
      setStatus(error.message || "保存城市失败", "error");
    } finally {
      queryInput.disabled = false;
    }
  };
  const renderResults = (locations) => {
    if (!locations.length) {
      resultsBox.innerHTML = '<div class="weather-location-empty">没有找到城市</div>';
      return;
    }
    resultsBox.innerHTML = locations.map((item, index) => `
      <button type="button" data-weather-location-index="${index}">
        <strong>${escapeHtml(item.name || item.displayName || item.id)}</strong>
        <span>${escapeHtml(item.displayName || "")}</span>
      </button>
    `).join("");
    resultsBox.querySelectorAll("[data-weather-location-index]").forEach((button) => {
      button.onclick = () => selectLocation(locations[Number(button.dataset.weatherLocationIndex)]);
    });
  };
  queryInput.oninput = () => {
    clearTimeout(searchTimer);
    const query = queryInput.value.trim();
    if (!query) {
      resultsBox.innerHTML = "";
      setStatus("手动城市、系统定位可用；IP 猜测为实验性，不推荐。");
      return;
    }
    searchTimer = setTimeout(async () => {
      setStatus("正在搜索城市...");
      try {
        const payload = await window.winplate.searchWeatherLocations(query);
        renderResults(Array.isArray(payload.locations) ? payload.locations : []);
        setStatus("点击候选城市即可保存为手动城市。");
      } catch (error) {
        resultsBox.innerHTML = "";
        setStatus(error.message || "城市搜索失败", "error");
      }
    }, 250);
  };
  if (systemButton) {
    systemButton.onclick = async () => {
      systemButton.disabled = true;
      setStatus("正在请求系统定位...");
      try {
        const weather = await refreshSelectedWeatherLocation({ force: true, allowSystem: true });
        if (!weather) throw new Error("系统定位失败，请手动选择城市。");
        setStatus("已保存系统定位", "configured");
        await refreshStatus();
      } catch (error) {
        setStatus(error.message || "系统定位失败，请手动选择城市。", "error");
      } finally {
        systemButton.disabled = false;
      }
    };
  }
}

function renderWeatherLocationSettings() {
  const weather = statusData.weather || {};
  return `
    <fieldset class="weather-location-settings">
      <legend><strong>定位方式</strong><small>推荐使用手动城市；IP 定位可能受代理 / VPN 影响，建议使用手动城市。</small></legend>
      <div class="weather-location-current">
        <span>当前城市：${escapeHtml(weather.location || "未配置")}</span>
        <span>定位方式：${escapeHtml(weatherLocationSourceLabel(weather.locationSource))}</span>
        <span>上次更新：${escapeHtml(relativeWeatherLocationTime(weather.updatedAt))}</span>
      </div>
      <label>
        <span><strong>手动城市</strong><small>搜索 QWeather 城市并保存 LocationID，最稳定</small></span>
        <div class="weather-location-search">
          <input id="weather-location-query" type="search" autocomplete="off" placeholder="输入城市名，例如 广州">
          <div id="weather-location-results" class="weather-location-results" aria-live="polite"></div>
        </div>
      </label>
      <div class="weather-location-actions">
        <span>系统定位需要授权，成功后会本地缓存经纬度和城市名。</span>
        <button type="button" id="weather-system-location">使用系统定位</button>
      </div>
      <small id="weather-location-status" class="weather-location-status">手动城市、系统定位可用；IP 猜测为实验性，不推荐。</small>
    </fieldset>`;
}

async function bindDeepSeekSettings() {
  const form = document.querySelector("#deepseek-settings-form");
  if (!form) return;
  const keyInput = form.querySelector("#deepseek-api-key");
  const baseUrlInput = form.querySelector("#deepseek-base-url");
  const status = form.querySelector("#deepseek-settings-status");
  const chatStatus = form.querySelector("#deepseek-chat-status");
  const button = form.querySelector("button[type='submit']");
  const testButton = form.querySelector("#deepseek-test-chat");
  const setStatus = (text, className = "") => {
    status.textContent = `DeepSeek API：${text}`;
    status.className = className;
  };
  const setChatStatus = (text, className = "") => {
    if (!chatStatus) return;
    chatStatus.textContent = `AI 调用：${text}`;
    chatStatus.className = className;
  };
  try {
    deepseekSettings = await window.winplate.getDeepSeekSettings();
    baseUrlInput.value = deepseekSettings.baseUrl;
    keyInput.placeholder = deepseekSettings.hasApiKey ? "已配置，留空则保持不变" : "请输入 API Key";
    setStatus(deepseekSettings.hasApiKey ? "已配置" : "未配置", deepseekSettings.hasApiKey ? "configured" : "");
    setChatStatus(deepseekSettings.hasApiKey ? "可测试" : "未配置", deepseekSettings.hasApiKey ? "" : "error");
  } catch {
    setStatus("读取失败", "error");
    setChatStatus("读取失败", "error");
  }
  if (testButton) {
    testButton.onclick = async () => {
      testButton.disabled = true;
      setChatStatus("测试中...");
      try {
        const result = await window.winplate.testDeepSeekChat();
        setChatStatus(result?.message || "AI 调用正常", "configured");
      } catch (error) {
        setChatStatus(error.message || "测试失败", "error");
      } finally {
        testButton.disabled = false;
      }
    };
  }
  form.onsubmit = async (event) => {
    event.preventDefault();
    button.disabled = true;
    setStatus("正在保存...");
    try {
      deepseekSettings = await window.winplate.saveDeepSeekSettings({
        apiKey: keyInput.value,
        baseUrl: baseUrlInput.value
      });
      keyInput.value = "";
      keyInput.placeholder = "已配置，留空则保持不变";
      statusData.deepseek = await window.winplate.getDeepSeekUsage({ force: true });
      setStatus(
        statusData.deepseek.status === "Normal" ? "已配置，余额读取正常" : "已保存，余额暂不可用",
        statusData.deepseek.status === "Normal" ? "configured" : "error"
      );
      setChatStatus("可测试");
    } catch (error) {
      setStatus(error.message || "保存失败", "error");
    } finally {
      button.disabled = false;
    }
  };
}

themeMedia.addEventListener("change", () => {
  if (themePreference === "system") applyMainTheme();
});

function systemClockParts(now = new Date()) {
  const date = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
  const time = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(now);
  const weekday = new Intl.DateTimeFormat("zh-CN", {
    weekday: "long"
  }).format(now);
  return { date, time, weekday };
}

function titlebarWeatherContent() {
  const weather = statusData.weather || mockStatus.weather;
  const temperature = weather.temperature ?? "--";
  const condition = weather.condition || "天气未知";
  return `${weatherIconMarkup(weather.icon, "titlebar-weather-icon")}<span class="titlebar-weather-temperature">${escapeHtml(temperature)}°</span><span class="titlebar-weather-condition">${escapeHtml(condition)}</span>`;
}

function updateTitlebarWeather() {
  const container = document.querySelector("#titlebar-weather");
  if (!container) return;
  container.innerHTML = titlebarWeatherContent();
  bindWeatherIconFallbacks(container);
}

function updateSystemClock() {
  const clock = document.querySelector("#system-clock");
  if (!clock) return;
  const { date, time, weekday } = systemClockParts();
  clock.querySelector(".system-date").textContent = date;
  clock.querySelector(".system-time").textContent = `${time} ${weekday}`;
}

function startSystemClock() {
  clearInterval(systemClockTimer);
  updateSystemClock();
  systemClockTimer = setInterval(updateSystemClock, 1000);
}

function normalizePercent(percent) {
  const value = Number(percent);
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
}

function progressBar(percent, className) {
  const value = normalizePercent(percent);
  return `
    <div class="${className}" role="progressbar" aria-valuemin="0" aria-valuemax="100"${value === null ? "" : ` aria-valuenow="${value}"`}>
      <span data-progress-value="${value ?? 0}"></span>
    </div>`;
}

function quotaStatusLamp(percent) {
  const value = normalizePercent(percent);
  const state = value === null
    ? "unavailable"
    : value <= 10
      ? "critical"
      : value <= 40
        ? "warning"
        : value < 95
          ? "healthy"
          : "full";
  const labels = {
    unavailable: "额度状态未知",
    critical: "额度不足",
    warning: "额度警告",
    healthy: "额度充足",
    full: "满额度"
  };
  return `<span class="quota-lamp quota-${state}" title="${labels[state]}" aria-label="${labels[state]}"></span>`;
}

function normalizedNotifications(summary = notificationSummary) {
  const items = Array.isArray(summary.items) ? summary.items : [];
  return {
    items,
    latest: summary.latest || items[0] || null,
    unreadCount: Math.max(0, Number(summary.unreadCount) || 0),
    updatedAt: summary.updatedAt || null
  };
}

function withRendererRefreshTimeout(operation, label, timeoutMs = RENDERER_REFRESH_TIMEOUT_MS) {
  let timer = null;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}超时，请稍后重试`)), timeoutMs);
  });
  return Promise.race([Promise.resolve(operation), timeout]).finally(() => clearTimeout(timer));
}

async function refreshLocalJson(path, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RENDERER_REFRESH_TIMEOUT_MS);
  try {
    const response = await fetch(`http://127.0.0.1:8765${path}`, {
      method: "POST",
      signal: controller.signal
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.detail || `${label}失败: HTTP ${response.status}`);
    return payload;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`${label}超时，请稍后重试`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function resetRefreshButton(selector) {
  const button = document.querySelector(selector);
  if (!button) return;
  button.disabled = false;
  button.classList.remove("refreshing");
  const label = button.querySelector("span:last-child");
  if (label) label.textContent = "刷新";
}

function showRefreshNotice(type, title, message) {
  const region = document.querySelector("#refresh-notice-region");
  if (!region) return;
  if (refreshNoticeTimer) clearTimeout(refreshNoticeTimer);

  const notice = document.createElement("div");
  notice.className = `refresh-notice is-${type === "success" ? "success" : "error"}`;

  const copy = document.createElement("div");
  const heading = document.createElement("strong");
  const detail = document.createElement("span");
  heading.textContent = title;
  detail.textContent = message;
  copy.append(heading, detail);
  notice.append(copy);
  region.replaceChildren(notice);

  requestAnimationFrame(() => notice.classList.add("is-visible"));
  refreshNoticeTimer = setTimeout(() => {
    notice.classList.remove("is-visible");
    setTimeout(() => {
      if (notice.parentNode === region) notice.remove();
    }, 180);
  }, 4_000);
}

function normalizeNavigationPayload(value) {
  if (typeof value === "string") {
    return { section: value };
  }
  if (value && typeof value === "object") {
    return {
      section: typeof value.section === "string" && value.section.trim() ? value.section.trim() : "Dashboard",
      moduleId: typeof value.moduleId === "string" ? value.moduleId : null,
      source: typeof value.source === "string" ? value.source : null,
      sourceId: typeof value.sourceId === "string" ? value.sourceId : null,
      notificationId: typeof value.notificationId === "string" ? value.notificationId : null
    };
  }
  return { section: "Dashboard", moduleId: null, source: null, sourceId: null, notificationId: null };
}

function absoluteTimeLabel(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

function notificationItemsForDigest() {
  return normalizedNotifications().items;
}

function notificationSourceLabel(source) {
  return {
    mail: "Mail",
    qweather: "QWeather",
    codex: "Codex",
    chatgpt: "ChatGPT",
    github: "GitHub",
    system: "系统",
    external: "WinPlate"
  }[source] || source || "WinPlate";
}

function notificationLevelLabel(level) {
  return {
    info: "信息",
    success: "完成",
    warning: "提醒",
    critical: "紧急"
  }[level] || "信息";
}

function notificationStrip() {
  const digest = window.WinPlateNotificationDigest.normalizeDigest(notificationDigest);
  const iconKey = "sparkles";
  const unread = digest.unreadCount;
  const syncTime = formatNotificationSyncTime(digest.generatedAt);
  const stripTitle = `${digest.headline} · 已同步${syncTime}`;
  return `
    <button class="notification-strip ${unread ? "has-unread" : ""} severity-${escapeHtml(digest.severity)} no-drag" id="notification-strip" type="button" aria-label="打开${digest.severity === "danger" ? "危险" : digest.severity === "warning" ? "预警" : "信息"}通知摘要">
      ${window.WinPlateSmartNotificationIcons.renderSmartNotificationIcon(iconKey)}
      <span class="notification-title">${escapeHtml(stripTitle)}</span>
      ${unread ? `<span class="notification-badge" aria-label="${unread} 条未读">${unread > 99 ? "99+" : unread}</span>` : ""}
    </button>`;
}

function formatNotificationSyncTime(timestamp) {
  const value = Number(timestamp);
  if (!Number.isFinite(value) || value <= 0) return "--：--";
  const date = new Date(value);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}：${minutes}`;
}

function formatSpeedCompact(bytesPerSecond) {
  const value = Number(bytesPerSecond);
  if (!Number.isFinite(value) || value < 0) return "---";
  const kb = value / 1024;
  if (kb < 1) return "0K";
  if (kb < 1000) return `${Math.round(kb)}K`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb >= 10 ? 0 : 1)}M`;
}

function formatSpeedFull(bytesPerSecond) {
  const value = Number(bytesPerSecond);
  if (!Number.isFinite(value) || value < 0) return "---";
  const kb = value / 1024;
  if (kb < 1) return "0 KB/s";
  if (kb < 1000) return `${Math.round(kb)} KB/s`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB/s`;
}

function formatNetworkSpeed(bytesPerSecond, compact = true) {
  return compact ? formatSpeedCompact(bytesPerSecond) : formatSpeedFull(bytesPerSecond);
}

function formatLatency(latencyMs) {
  const value = Number(latencyMs);
  if (!Number.isFinite(value) || value < 0) return "---";
  return `${Math.round(value)}ms`;
}

function networkSpeedLabel() {
  return `↓ ${formatSpeedCompact(networkSpeed.downloadBytesPerSecond)}`;
}

function networkSpeedMarkup() {
  return `<span class="network-speed-arrow">↓</span><span class="network-speed-value">${formatSpeedCompact(networkSpeed.downloadBytesPerSecond)}</span>`;
}

function networkStatusKind(status, downloadBytesPerSecond = 0, uploadBytesPerSecond = 0) {
  if (status === "获取失败" || status === "无连接") return "error";
  if (status === "网络弱" || status === "延迟高" || status === "API 不稳定") return "warning";
  const download = Number(downloadBytesPerSecond) || 0;
  const upload = Number(uploadBytesPerSecond) || 0;
  if (download < 1024 && upload < 1024) return "idle";
  return "normal";
}

function syncNetworkModuleState(module) {
  if (!module) return;
  const kind = networkStatusKind(
    networkSpeed.status,
    networkSpeed.downloadBytesPerSecond,
    networkSpeed.uploadBytesPerSecond
  );
  module.classList.toggle("is-idle", kind === "idle");
  module.classList.toggle("is-warning", kind === "warning");
  module.classList.toggle("is-error", kind === "error");
  module.classList.toggle("network-error", kind === "error");
}

function updateProgressBars(root = document) {
  root.querySelectorAll("[data-progress-value]").forEach((fill) => {
    const value = normalizePercent(fill.dataset.progressValue) ?? 0;
    requestAnimationFrame(() => {
      fill.style.width = `${value}%`;
    });
  });
}

function shouldPreserveFormState(element) {
  return element instanceof HTMLInputElement
    || element instanceof HTMLTextAreaElement
    || element instanceof HTMLSelectElement;
}

function syncAttributes(current, desired) {
  const preserved = shouldPreserveFormState(current)
    ? new Set(["value", "checked", "selected"])
    : new Set();
  Array.from(current.attributes).forEach(({ name }) => {
    if (!preserved.has(name) && !desired.hasAttribute(name)) {
      current.removeAttribute(name);
    }
  });
  Array.from(desired.attributes).forEach(({ name, value }) => {
    if (!preserved.has(name) && current.getAttribute(name) !== value) {
      current.setAttribute(name, value);
    }
  });
}

function canSyncNode(current, desired) {
  return current?.nodeType === desired?.nodeType
    && (current.nodeType !== Node.ELEMENT_NODE || current.tagName === desired.tagName);
}

function syncDomNode(current, desired) {
  if (current.nodeType === Node.TEXT_NODE) {
    if (current.nodeValue !== desired.nodeValue) current.nodeValue = desired.nodeValue;
    return false;
  }
  if (current.nodeType !== Node.ELEMENT_NODE) return false;

  syncAttributes(current, desired);
  let structureChanged = false;
  const currentChildren = Array.from(current.childNodes);
  const desiredChildren = Array.from(desired.childNodes);
  const sharedLength = Math.min(currentChildren.length, desiredChildren.length);

  for (let index = 0; index < sharedLength; index += 1) {
    const currentChild = currentChildren[index];
    const desiredChild = desiredChildren[index];
    if (canSyncNode(currentChild, desiredChild)) {
      structureChanged = syncDomNode(currentChild, desiredChild) || structureChanged;
    } else {
      current.replaceChild(desiredChild.cloneNode(true), currentChild);
      structureChanged = true;
    }
  }
  for (let index = currentChildren.length - 1; index >= desiredChildren.length; index -= 1) {
    currentChildren[index].remove();
    structureChanged = true;
  }
  for (let index = currentChildren.length; index < desiredChildren.length; index += 1) {
    current.appendChild(desiredChildren[index].cloneNode(true));
    structureChanged = true;
  }
  return structureChanged;
}

const githubIcon = `
  <span class="github-theme-icon" aria-hidden="true">
    <img class="github-icon-dark-mode" src="../../assets/github-mark-light.svg" alt="">
    <img class="github-icon-light-mode" src="../../assets/github-mark-dark.svg" alt="">
  </span>`;
const githubCardIcon = `
  <span class="github-card-theme-icon" aria-hidden="true">
    <img class="github-card-icon-dark-mode" src="../../assets/github-mark-light.svg" alt="">
    <img class="github-card-icon-light-mode" src="../../assets/github-mark-dark.svg" alt="">
  </span>`;
const codexIcon = `
  <svg class="codex-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M7.25 18.25h9.5a4.25 4.25 0 0 0 .64-8.45A5.75 5.75 0 0 0 6.5 7.85a3.75 3.75 0 0 0 .75 7.42"/>
    <path d="m8.25 10.25 2.25 2.25-2.25 2.25M12.75 14.75h3"/>
  </svg>`;
const refreshIcon = `
  <svg class="refresh-button-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M21 12a9 9 0 0 1-15.64 6.12L3 16"/>
    <path d="M3 21v-5h5"/>
    <path d="M3 12a9 9 0 0 1 15.64-6.12L21 8"/>
    <path d="M21 3v5h-5"/>
  </svg>`;
const mailIcon = `
  <svg class="mail-icon" viewBox="0 0 24 24" aria-hidden="true">
    <rect x="3.5" y="5.5" width="17" height="13" rx="2.5"></rect>
    <path d="m4.5 7 7.5 6 7.5-6"></path>
  </svg>`;
const notificationIcon = `
  <svg class="notification-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M18.25 9.75a6.25 6.25 0 0 0-12.5 0c0 5-2 5.75-2 5.75h16.5s-2-.75-2-5.75"></path>
    <path d="M9.75 18.25a2.25 2.25 0 0 0 4.5 0"></path>
  </svg>`;

function avatarMarkup(github, className = "") {
  return `
    <span class="github-avatar ${className}" data-avatar>
      <span class="avatar-fallback" aria-hidden="true">K</span>
      <img src="${github.avatarUrl || ""}" alt="${github.name || "GitHub"} avatar">
    </span>`;
}

function bindAvatarFallbacks(root = document) {
  root.querySelectorAll("[data-avatar] img").forEach((image) => {
    const showFallback = () => image.closest("[data-avatar]")?.classList.add("fallback");
    image.addEventListener("error", showFallback, { once: true });
    if (image.complete && !image.naturalWidth) showFallback();
  });
}

function contributionGrid(values = []) {
  return Array.from({ length: 30 }, (_, index) => {
    const level = Math.max(0, Math.min(4, Number(values[index]) || 0));
    return `<span class="contribution-cell level-${level}"></span>`;
  }).join("");
}

function githubContributionCalendar(month) {
  const values = month.levels || [];
  const counts = month.counts || [];
  const firstDay = new Date(`${month.key}-01T00:00:00`).getDay();
  const mondayOffset = (firstDay + 6) % 7;
  const cellCount = Math.ceil((mondayOffset + values.length) / 7) * 7;
  const cells = Array.from({ length: cellCount }, (_, index) => {
    const sourceIndex = index - mondayOffset;
    const active = sourceIndex >= 0 && sourceIndex < values.length;
    if (!active) {
      const adjacentDate = new Date(`${month.key}-01T00:00:00`);
      adjacentDate.setDate(sourceIndex + 1);
      return `<span class="github-calendar-cell level-0 outside-month" aria-hidden="true"><b>${adjacentDate.getDate()}</b></span>`;
    }
    const level = Math.max(0, Math.min(4, Number(values[sourceIndex]) || 0));
    const count = Math.max(0, Number(counts[sourceIndex]) || 0);
    const date = new Date(`${month.key}-${String(sourceIndex + 1).padStart(2, "0")}T00:00:00`);
    const dateLabel = new Intl.DateTimeFormat("en-US", {
      month: "long",
      day: "numeric"
    }).format(date);
    const contributionLabel = `${count} contribution${count === 1 ? "" : "s"} on ${dateLabel}.`;
    const dateKey = `${month.key}-${String(sourceIndex + 1).padStart(2, "0")}`;
    return `<button class="github-calendar-cell github-calendar-day level-${level}" type="button" data-contribution-date="${dateKey}" aria-pressed="${selectedContributionDate === dateKey}" aria-label="${contributionLabel}" data-tooltip="${contributionLabel}"><b>${sourceIndex + 1}</b></button>`;
  }).join("");
  return `
    <div class="github-calendar-shell">
      <div class="github-calendar-weekdays" aria-hidden="true"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div>
      <div class="github-calendar-grid" aria-label="GitHub contributions for ${month.label}">${cells}</div>
    </div>`;
}

function githubContributionMonths(github) {
  return github.contributionMonths.length
    ? github.contributionMonths
    : [{
        key: new Date().toISOString().slice(0, 7),
        label: github.contributionMonth || "Current month",
        commits: github.commitsThisMonth || 0,
        levels: github.contributions30d
      }];
}

function githubMonthSummary(month) {
  const counts = Array.isArray(month?.counts) ? month.counts : [];
  const normalizedCounts = counts.map((value) => Math.max(0, Number(value) || 0));
  return {
    contributions: Math.max(0, Number(month?.commits) || 0),
    activeDays: normalizedCounts.filter((count) => count > 0).length,
    peakDaily: normalizedCounts.length ? Math.max(...normalizedCounts) : 0
  };
}

function githubContributionFallback(month, dateText = null) {
  const dayIndex = dateText ? Number(dateText.slice(-2)) - 1 : -1;
  const totalCount = dateText
    ? Math.max(0, Number(month.counts?.[dayIndex]) || 0)
    : Math.max(0, Number(month.commits) || 0);
  const label = dateText
    ? new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(new Date(`${dateText}T00:00:00`))
    : month.label;
  return { rangeType: dateText ? "date" : "month", rangeKey: dateText || month.key, label, totalCount, repositories: [], detailsAvailable: false, message: "" };
}

function renderGithubContributionActivity(detail, { loading = false, error = "" } = {}) {
  const total = Math.max(0, Number(detail?.totalCount) || 0);
  const repositories = Array.isArray(detail?.repositories) ? detail.repositories : [];
  const heading = detail?.rangeType === "date" ? detail.label : detail?.label || "Contribution activity";
  const summary = loading
    ? `Created ${total} commits`
    : `Created ${total} commits in ${repositories.length} ${repositories.length === 1 ? "repository" : "repositories"}`;
  const rows = repositories.map((repository) => `
    <div class="github-contribution-repository">
      <a href="${escapeHtml(repository.url)}" data-external-link>${escapeHtml(repository.nameWithOwner)}</a>
      <span>${Math.max(0, Number(repository.count) || 0)} commits</span>
    </div>`).join("");
  const message = error || detail?.message || (loading ? "Loading repository details…" : total === 0 ? "No contributions in this range." : "");
  return `
    <div class="github-contribution-activity-head"><span>Contribution activity</span><small>${escapeHtml(heading)}</small></div>
    <div class="github-contribution-timeline">
      <span class="github-contribution-marker">${previewIcons.commits}</span>
      <div><strong>${summary}</strong>${rows || `<p>${escapeHtml(message)}</p>`}</div>
    </div>`;
}

async function loadGithubContributionActivity(range, fallback) {
  const key = `${range.date ? "date" : "month"}:${range.date || range.month}`;
  const panel = document.querySelector("#github-contribution-activity");
  if (!panel) return;
  if (githubContributionDetailCache.has(key)) {
    panel.innerHTML = renderGithubContributionActivity(githubContributionDetailCache.get(key));
    return;
  }
  const requestId = ++githubContributionRequestId;
  panel.innerHTML = renderGithubContributionActivity(fallback, { loading: true });
  try {
    const detail = await window.winplate.getGithubContributions(range);
    if (requestId !== githubContributionRequestId) return;
    githubContributionDetailCache.set(key, detail);
    panel.innerHTML = renderGithubContributionActivity(detail);
  } catch (error) {
    if (requestId !== githubContributionRequestId) return;
    panel.innerHTML = renderGithubContributionActivity(fallback, { error: error.message || "Contribution details are unavailable." });
  }
}

function githubContent() {
  const github = normalizeGithub(statusData.github);
  const months = githubContributionMonths(github);
  const selectedIndex = months.findIndex((month) => month.key === selectedContributionMonth);
  const monthIndex = selectedIndex >= 0 ? selectedIndex : months.length - 1;
  const selectedMonth = months[monthIndex];
  selectedContributionMonth = selectedMonth.key;
  const activityCount = selectedMonth.commits || 0;
  const monthSummary = githubMonthSummary(selectedMonth);
  const contributionFallback = githubContributionFallback(selectedMonth, selectedContributionDate);
  const calendarDate = new Date(`${selectedMonth.key}-01T00:00:00`);
  const calendarMonth = new Intl.DateTimeFormat("en-US", { month: "short" }).format(calendarDate);
  const calendarYear = calendarDate.getFullYear();
  const stateNotice = github.stateMessage
    ? `<div class="github-state-notice state-${github.availability}" role="status">${github.stateMessage}</div>`
    : "";
  return `
    <section class="github-dashboard" data-module-id="github" ${moduleHealthAttributes("github")}>
      <div class="github-main-column">
        ${stateNotice}
        <div class="github-page-heading">
          <div><p>GITHUB</p><h2>GitHub activity</h2><span>Monthly contribution rhythm and project activity for ${github.username}.</span></div>
          <div class="github-heading-actions">
            <button
              class="refresh-button github-refresh-button ${githubRefreshInFlight ? "refreshing" : ""}"
              id="refresh-github"
              type="button"
              aria-label="刷新 GitHub 数据"
              ${githubRefreshInFlight ? "disabled" : ""}
            >
              ${refreshIcon}
              <span>${githubRefreshInFlight ? "刷新中" : "刷新"}</span>
            </button>
          </div>
        </div>
        <div class="github-profile-bar">
          ${avatarMarkup(github, "github-profile-avatar")}
          <div class="github-profile-copy">
            <h1>${github.name}</h1>
            <p>${github.username}</p>
          </div>
          <dl class="github-profile-metrics">
            <div><dt>${github.repos}</dt><dd>Repositories</dd></div>
            <div><dt>${github.followers}</dt><dd>Followers</dd></div>
            <div><dt>${github.streakDays}</dt><dd>Day streak</dd></div>
          </dl>
          <div class="github-profile-actions">
            <div class="github-profile-status"><div class="github-live-note"><span></span><div><strong>${github.status || "Live"}</strong><small>${relativeUpdatedAt(github.updatedAt)}</small></div></div></div>
            <div class="github-profile-open"><button class="github-profile-button" type="button" data-open-github>Open GitHub profile</button></div>
          </div>
        </div>
        <article class="github-contribution-card"><div class="github-activity-split"><div class="github-calendar-pane">
            <div class="github-card-heading">
              <div><span>Activity calendar</span><small>${monthSummary.contributions} contributions in ${selectedMonth.label}</small></div>
              <div class="github-calendar-title">
                <div class="github-calendar-period"><strong>${calendarMonth}</strong><b>${calendarYear}</b></div>
                <div class="github-month-navigation">
                <button type="button" data-month-direction="-1" aria-label="Previous month" ${monthIndex === 0 ? "disabled" : ""}>‹</button>
                <button type="button" data-month-today>TODAY</button>
                <button type="button" data-month-direction="1" aria-label="Next month" ${monthIndex === months.length - 1 ? "disabled" : ""}>›</button>
                </div>
              </div>
            </div>
            ${githubContributionCalendar(selectedMonth)}
            <div class="github-calendar-stats">
              <div><strong>${monthSummary.contributions}</strong><span>contributions</span></div>
              <div><strong>${monthSummary.activeDays}</strong><span>active days</span></div>
              <div><strong>${monthSummary.peakDaily}</strong><span>best day</span></div>
              <div><strong>${github.streakDays}</strong><span>day streak</span></div>
            </div>
          </div><aside class="github-contribution-activity" id="github-contribution-activity">${renderGithubContributionActivity(contributionFallback, { loading: true })}</aside></div></article>
        <div class="github-detail-grid">
          <article class="github-pinned-card">
            <div class="github-card-heading"><span>Pinned repository</span><small>Public</small></div>
            <button type="button" data-open-github class="github-repo-link">${previewIcons.repository}<strong>${github.project}</strong></button>
            <div class="github-repo-meta"><span><i></i>${github.language}</span><span>${previewIcons.star}${github.stars}</span></div>
          </article>
        </div>
      </div>
    </section>`;
}

const previewIcons = {
  repos: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3.5" width="14" height="17" rx="2"></rect><path d="M8 7h8M8 17h8M9 20.5v2M15 20.5v2"></path></svg>`,
  commits: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"></circle><path d="M12 7.5V12l3 2"></path></svg>`,
  streak: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 3.5c.7 3.1-1.8 4.6-1.8 7.1 0 1.2.7 2 1.7 2.5-.2-2.1 1-3.3 2.4-4.7 1.5 1.6 2.7 3.5 2.7 6A6.5 6.5 0 1 1 8 9.3c.1 2 1 3.2 2.1 3.8-.5-3.8 1.1-6.8 3.4-9.6Z"></path></svg>`,
  repository: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3.5" width="14" height="17" rx="2"></rect><path d="M8 7h8M8 17h8M9 20.5v2M15 20.5v2"></path></svg>`,
  star: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z"></path></svg>`
};

const locationArrowIcon = `
  <svg class="location-arrow-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M20.2 3.8 4.7 9.7c-.9.3-.9 1.6 0 1.9l6.2 2.1 2.1 6.2c.3.9 1.6.9 1.9 0l5.9-15.5c.2-.5-.3-1-.6-.6Z"></path>
  </svg>`;

const dashboardIcon = `
  <svg class="dashboard-icon" viewBox="0 0 24 24" aria-hidden="true">
    <rect x="3.5" y="4.5" width="17" height="12" rx="2"></rect>
    <path d="M8.5 20h7M12 16.5V20"></path>
  </svg>`;

const qweatherNavIcon = `
  <svg class="qweather-nav-icon" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="8" cy="8" r="4.25"></circle>
    <path d="M7.25 18.75h10a4 4 0 0 0 .45-7.97A5.75 5.75 0 0 0 7.08 9.3a4.75 4.75 0 0 0 .17 9.45Z"></path>
  </svg>`;

const settingsNavIcon = `
  <svg class="settings-nav-icon" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="3"></circle>
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 8.6 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 8.6a1.7 1.7 0 0 0 .6 1 1.7 1.7 0 0 0 1.1.4H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1Z"></path>
  </svg>`;

function weatherDateTime(now = new Date()) {
  const time = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(now);
  const date = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long"
  }).format(now);
  return { time, date };
}

function weatherIconMarkup(iconCode, className = "weather-icon") {
  const code = /^\d{3,4}$/.test(String(iconCode || "")) ? String(iconCode) : "999";
  return `<img class="${className}" src="../../assets/qweather-icons/icons/${code}.svg" alt="" aria-hidden="true">`;
}

function bindWeatherIconFallbacks(root = document) {
  root.querySelectorAll("img.weather-icon, img.weather-detail-icon, img.titlebar-weather-icon").forEach((image) => {
    const showFallback = () => {
      if (image.dataset.fallbackApplied === "true") return;
      image.dataset.fallbackApplied = "true";
      image.src = "../../assets/qweather-icons/icons/999.svg";
    };
    image.addEventListener("error", showFallback, { once: true });
    if (image.complete && !image.naturalWidth) showFallback();
  });
}

function selectedWeatherLocationOption() {
  const city = WEATHER_LOCATION_REGIONS
    .flatMap((region) => region.cities.map((item) => ({ ...item, regionId: region.id, regionLabel: region.label })))
    .find((item) => item.id === weatherLocationPreference);
  return city || { ...WEATHER_LOCATION_REGIONS[0].cities[0], regionId: "auto", regionLabel: "自动定位" };
}

function selectedWeatherRegion() {
  const selected = selectedWeatherLocationOption();
  return WEATHER_LOCATION_REGIONS.find((region) => region.id === selected.regionId) || WEATHER_LOCATION_REGIONS[0];
}

function weatherLocationSelect() {
  const region = selectedWeatherRegion();
  const selected = selectedWeatherLocationOption();
  return `
    <div class="weather-location-picker no-drag">
      ${locationArrowIcon}
      <select id="weather-province-select" aria-label="选择省份">
        ${WEATHER_LOCATION_REGIONS.map((option) => `
          <option value="${option.id}"${region.id === option.id ? " selected" : ""}>${option.label}</option>
        `).join("")}
      </select>
      <select id="weather-city-select" aria-label="选择城市">
        ${region.cities.map((option) => `
          <option value="${option.id}"${selected.id === option.id ? " selected" : ""}>${option.label}</option>
        `).join("")}
      </select>
    </div>`;
}

function normalizeWeatherAlerts(value = {}) {
  return {
    source: value?.source || "qweather",
    alerts: Array.isArray(value?.alerts) ? value.alerts : [],
    updatedAt: Number.isFinite(Number(value?.updatedAt)) ? Number(value.updatedAt) : null,
    error: typeof value?.error === "string" ? value.error : ""
  };
}

function weatherAlertTone(alert = {}) {
  if (alert.lifecycle === "resolved") return "resolved";
  return alert.level === "critical" ? "critical" : "warning";
}

function weatherAlertStatus(alert = {}) {
  if (alert.lifecycle === "resolved") return "已解除";
  if (alert.lifecycle === "upgraded") return "已升级";
  return alert.level === "critical" ? "高风险" : "生效中";
}

function weatherAlertsPanel() {
  const weather = statusData.weather || mockStatus.weather;
  const allAlerts = Array.isArray(weatherAlerts.alerts) ? weatherAlerts.alerts : [];
  const selectedAlert = selectedWeatherAlertId
    ? allAlerts.find((alert) => String(alert.id || "") === String(selectedWeatherAlertId))
    : null;
  const alerts = selectedAlert
    ? [selectedAlert, ...allAlerts.filter((alert) => alert !== selectedAlert)].slice(0, 3)
    : allAlerts.slice(0, 2);
  if (!alerts.length && weather.source !== "qweather" && !weatherAlerts.error) return "";
  const helperText = alerts.length
    ? `${relativeUpdatedAt(weatherAlerts.updatedAt)}同步`
    : weatherAlerts.error || "当前无天气预警";
  return `
    <section class="weather-alerts-panel">
      <div class="weather-alerts-heading">
        <strong>天气预警</strong>
        <span>${escapeHtml(helperText)}</span>
      </div>
      ${alerts.length ? `<div class="weather-alerts-list">
        ${alerts.map((alert) => `
          <article class="weather-alert-card severity-${weatherAlertTone(alert)} ${String(alert.id || "") === String(selectedWeatherAlertId || "") ? "focused" : ""}">
            <span class="weather-alert-badge">${escapeHtml(weatherAlertStatus(alert))}</span>
            <div class="weather-alert-copy">
              <strong>${escapeHtml(alert.title || "天气预警")}</strong>
              <p>${escapeHtml(alert.message || "请留意最新天气变化。")}</p>
            </div>
          </article>`).join("")}
      </div>` : `<p class="weather-alerts-empty${weatherAlerts.error ? " error" : ""}">${escapeHtml(helperText)}</p>`}
    </section>`;
}

function weatherDashboardCard() {
  const weather = statusData.weather || mockStatus.weather;
  const forecast = Array.isArray(weather.forecast) ? weather.forecast.slice(0, 5) : [];
  const dayLabel = (date, index) => {
    if (index === 0) return "今天";
    if (index === 1) return "明天";
    return new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(new Date(`${date}T12:00:00`));
  };
  const details = [
    ["体感", weather.feelsLike == null ? "--" : `${weather.feelsLike}°`],
    ["湿度", weather.humidity == null ? "--" : `${weather.humidity}%`],
    ["降雨", weather.precipitationProbability == null ? "--" : `${weather.precipitationProbability}%`],
    ["风力", [weather.windDirection, weather.windScale && `${weather.windScale}级`].filter(Boolean).join(" ") || "--"]
  ];
  return `
    <article class="dashboard-card weather-dashboard-card" data-module-id="weather" ${moduleHealthAttributes("weather")}>
      <div class="weather-card-main">
        <div class="weather-card-heading">
          <div class="weather-location-stack">
            ${weatherLocationSelect()}
            <span>${weather.location || (weather.source === "unconfigured" ? "位置未配置" : "当前位置")}</span>
          </div>
          <small>${weather.source === "qweather" ? "QWeather 实时数据" : weather.source === "unconfigured" ? "请允许系统定位或配置回退位置" : "等待天气数据"}</small>
        </div>
        <div class="weather-card-current">
          ${weatherIconMarkup(weather.icon, "weather-dashboard-icon")}
          <strong>${weather.temperature ?? "--"}°</strong>
          <div><b>${weather.condition || "天气未知"}</b><p class="weather-card-summary">${weather.weatherSummary || "天气数据更新后将在这里显示。"}</p></div>
        </div>
        ${weatherAlertsPanel()}
        <div class="weather-card-details">
          ${details.map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join("")}
        </div>
      </div>
      <div class="weather-forecast-list">
        <div class="weather-forecast-title"><strong>未来天气</strong><span>5 天预报</span></div>
        ${forecast.length ? forecast.map((day, index) => `
          <div class="weather-forecast-day">
            <span>${dayLabel(day.date, index)}</span>
            ${weatherIconMarkup(day.icon, "weather-forecast-icon")}
            <b>${day.condition}</b>
            <strong>${day.tempMax}° <i>${day.tempMin}°</i></strong>
          </div>`).join("") : `<p class="weather-forecast-empty">配置 QWeather 后显示未来 5 天预报</p>`}
      </div>
    </article>`;
}

function renderFloating() {
  const weather = statusData.weather || mockStatus.weather;
  document.body.className = "floating-body";
  appRoot.innerHTML = `
    <main class="floating-shell" id="floating-shell" aria-label="WinPlate status">
      <section class="status-capsule">
        <div class="status-layout">
          <div class="status-group app-status">
            <div class="module interactive-module github-module no-drag" id="github-module" data-module-id="github" ${moduleHealthAttributes("github")} ${moduleEnabled("github") ? "" : "hidden"} role="link" tabindex="0" aria-label="Open GitHub section">
              <span class="github-avatar-button" aria-hidden="true">
                ${avatarMarkup(statusData.github, "github-avatar-bar")}
              </span>
              <span class="github-summary">GitHub</span>
            </div>
            <div class="module interactive-module codex-module no-drag" data-module-id="codex" ${moduleHealthAttributes("codex")} ${moduleEnabled("codex") ? "" : "hidden"}>
              ${codexIcon}
              <span class="module-label">Codex</span>
              ${progressBar(statusData.codex.remainingPct, "usage-track")}
              <strong class="metric">${statusData.codex.remainingPct ?? "--"}%</strong>
              ${quotaStatusLamp(statusData.codex.remainingPct)}
              <span class="metric reset">${statusData.codex.resetClock || statusData.codex.resetText || "--:--"}</span>
            </div>
          </div>
          <div class="status-group notification-status" data-module-id="notifications" ${moduleHealthAttributes("notifications")} ${moduleEnabled("notifications") ? "" : "hidden"}>
            ${notificationStrip()}
          </div>
          <div class="status-group auxiliary-status">
            <div class="module interactive-module weather-module no-drag" id="weather-module" data-module-id="weather" ${moduleHealthAttributes("weather")} ${moduleEnabled("weather") ? "" : "hidden"}>
              ${weatherIconMarkup(weather.icon)}
              <strong class="metric">${weather.temperature}°C</strong>
              <span class="weather-condition">${weather.condition}</span>
            </div>
            <div class="system-status">
              <div class="module interactive-module heart-module no-drag" id="heart-module" data-module-id="heart" ${moduleHealthAttributes("heart")} ${moduleEnabled("heart") ? "" : "hidden"}>
                <span class="heart-icon">♥</span>
                <strong class="metric">${statusData.heart.heartRate ?? "--"}</strong>
              </div>
              <div class="module interactive-module network-module no-drag" id="network-module" data-module-id="network" ${moduleHealthAttributes("network")} ${moduleEnabled("network") ? "" : "hidden"}>
                <span class="network-speed">${networkSpeedMarkup()}</span>
              </div>
              <div class="right-controls no-drag">
                <button class="pin-button" id="pin-button" aria-label="Pin floating window" title="Pin / click-through">
                  <svg class="pin-icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M9 3h6v2l-1.4 1.4v4.8L18 15.6V17h-5v4h-2v-4H6v-1.4l4.4-4.4V6.4L9 5V3Z"></path>
                  </svg>
                </button>

                 <button class="settings-button" id="settings-button" aria-label="Open settings">⚙</button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>`;
  updateProgressBars(appRoot);
  bindAvatarFallbacks(appRoot);

  const shell = document.querySelector("#floating-shell");
  shell.addEventListener("dblclick", () => window.winplate.showMainWindow());
  shell.addEventListener("click", (event) => {
    if (event.target === shell || event.target.classList.contains("status-capsule")) {
      window.winplate.showMainWindow();
    }
  });
  document.querySelector("#settings-button").addEventListener("click", () => window.winplate.showMainWindow("Settings"));
  const pinButton = document.querySelector("#pin-button");
  const githubModule = document.querySelector(".github-module");
  const codexModule = document.querySelector(".codex-module");
  const weatherModule = document.querySelector("#weather-module");
  const heartModule = document.querySelector("#heart-module");
  const networkModule = document.querySelector("#network-module");
  bindNotificationStrip();

  function bindSystemTooltip(module, data) {
    module.addEventListener("mouseenter", () => {
      clearTimeout(tooltipHideTimer);
      const rect = module.getBoundingClientRect();
      window.winplate.showTooltip({
        anchor: {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
          relativeToFloatingWindow: true
        },
        data: typeof data === "function" ? data() : data
      });
    });
    module.addEventListener("mouseleave", () => {
      tooltipHideTimer = setTimeout(() => window.winplate.hideTooltip(), 80);
    });
  }

  githubModule.addEventListener("click", () => window.winplate.showMainWindow("GitHub"));
  githubModule.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      window.winplate.showMainWindow("GitHub");
    }
  });

  githubModule.addEventListener("mouseenter", () => {
    clearTimeout(tooltipHideTimer);
    const rect = githubModule.getBoundingClientRect();
    window.winplate.showTooltip({
      anchor: {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
        relativeToFloatingWindow: true
      },
      data: {
        type: "github",
        github: statusData.github
      }
    });
  });
  githubModule.addEventListener("mouseleave", () => {
    tooltipHideTimer = setTimeout(() => window.winplate.hideTooltip(), 80);
  });

  codexModule.addEventListener("mouseenter", () => {
    clearTimeout(tooltipHideTimer);
    const rect = codexModule.getBoundingClientRect();
    window.winplate.showTooltip({
      anchor: {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
        relativeToFloatingWindow: true
      },
      data: {
        type: "codex",
        windowHours: statusData.codex.windowHours,
        remainingPct: statusData.codex.remainingPct,
        usedPct: statusData.codex.usedPct,
        resetText: statusData.codex.resetText,
        status: statusData.codex.status,
        windows: statusData.codex.windows
      }
    });
  });
  codexModule.addEventListener("mouseleave", () => {
    tooltipHideTimer = setTimeout(() => window.winplate.hideTooltip(), 80);
  });

  weatherModule.addEventListener("click", () => window.winplate.showMainWindow("QWeather"));
  bindSystemTooltip(weatherModule, () => {
    const currentWeather = statusData.weather || mockStatus.weather;
    const { time, date: fullDate } = weatherDateTime();
    return {
      type: "weather",
      icon: currentWeather.icon,
      location: currentWeather.location,
      temperature: currentWeather.temperature,
      condition: currentWeather.condition,
      feelsLike: currentWeather.feelsLike,
      humidity: currentWeather.humidity,
      precipitation: currentWeather.precipitation,
      pressure: currentWeather.pressure,
      visibility: currentWeather.visibility,
      precipitationProbability: currentWeather.precipitationProbability,
      wind: currentWeather.windDirection ? `${currentWeather.windDirection} ${currentWeather.windScale}级` : "",
      weatherSummary: currentWeather.weatherSummary,
      time,
      date: fullDate
    };
  });
  bindSystemTooltip(heartModule, {
    type: "heart",
    lines: [
      `Current: ${statusData.heart.heartRate ?? "--"} ${statusData.heart.unit}`,
      `Source: ${statusData.heart.source}`,
      `Updated: ${statusData.heart.updatedAt}`
    ]
  });
  bindSystemTooltip(networkModule, () => ({
    type: "network",
    status: networkSpeed.status || "获取失败",
    statusKind: networkStatusKind(
      networkSpeed.status,
      networkSpeed.downloadBytesPerSecond,
      networkSpeed.uploadBytesPerSecond
    ),
    download: formatNetworkSpeed(networkSpeed.downloadBytesPerSecond, false),
    upload: formatNetworkSpeed(networkSpeed.uploadBytesPerSecond, false),
    latency: formatLatency(networkSpeed.latencyMs)
  }));

  pinButton.addEventListener("click", async (event) => {
    event.stopPropagation();

    floatingPinned = !floatingPinned;
    pinButton.classList.toggle("active", floatingPinned);

    await window.winplate.setFloatingPinned(floatingPinned);

    // 刚点击后，鼠标仍在按钮上，所以保持按钮可点击
    if (floatingPinned) {
      window.winplate.setFloatingPinInteractive(true);
    }
  });

  document.addEventListener("mousemove", (event) => {
    if (!floatingPinned) return;

    const target = document.elementFromPoint(event.clientX, event.clientY);
    const overPin = Boolean(target?.closest?.("#pin-button"));

    window.winplate.setFloatingPinInteractive(overPin);
  });

  document.addEventListener("mouseleave", () => {
    if (floatingPinned) {
      window.winplate.setFloatingPinInteractive(false);
    }
  });
}

function bindNotificationStrip() {
  const strip = document.querySelector("#notification-strip");
  if (!strip || strip.dataset.bound === "true") return;
  strip.dataset.bound = "true";
  strip.addEventListener("mouseenter", () => {
    clearTimeout(tooltipHideTimer);
    const rect = strip.getBoundingClientRect();
    window.winplate.showTooltip({
      anchor: {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
        relativeToFloatingWindow: true
      },
      data: {
        type: "notifications",
        digest: notificationDigest
      }
    });
  });
  strip.addEventListener("mouseleave", () => {
    tooltipHideTimer = setTimeout(() => window.winplate.hideTooltip(), 80);
  });
  strip.addEventListener("click", async (event) => {
    event.stopPropagation();
    window.winplate.showMainWindow("Notifications");
  });
}

function renderTooltip(data = {}) {
  document.body.className = "tooltip-body";
  if (data.type === "github") {
    const github = { ...mockStatus.github, ...data.github };
    const stateNotice = github.stateMessage
      ? `<div class="github-preview-state">${github.stateMessage}</div>`
      : "";
    appRoot.innerHTML = `
      <article class="github-hover-card" role="tooltip" aria-label="GitHub profile preview">
        ${stateNotice}
        <header class="github-preview-head">
          ${avatarMarkup(github, "github-avatar-preview")}
          <div class="github-identity">
            <strong>${github.name}</strong>
            <span>${github.username}</span>
          </div>
          <span class="active-pill">${github.status}</span>
        </header>
        <div class="github-preview-stats">
          <div><span>${previewIcons.repos} Repos</span><strong>${github.repos}</strong></div>
          <div><span>${previewIcons.commits} Contributions</span><strong>${github.commitsThisMonth}</strong><small>This month</small></div>
          <div><span>${previewIcons.streak} Streak</span><strong>${github.streakDays}</strong><small>days</small></div>
        </div>
        <section class="contribution-section">
          <div class="contribution-heading">
            <strong>Last 30 days</strong>
            <span class="contribution-month">${github.contributionMonth || ""}</span>
          </div>
          <div class="contribution-grid" aria-hidden="true">${contributionGrid(github.contributions30d)}</div>
          <div class="contribution-legend">
            <span>Less</span>
            ${[0, 1, 2, 3, 4].map((level) => `<i class="contribution-cell level-${level}"></i>`).join("")}
            <span>More</span>
          </div>
        </section>
        <footer class="github-repository">
          <strong>${previewIcons.repository}${github.project}</strong>
          <span><i></i>${github.language}</span>
          <span class="repository-stars" aria-label="${github.stars} stars">${previewIcons.star}${github.stars}</span>
        </footer>
      </article>`;
    bindAvatarFallbacks(appRoot);
    return;
  }
  if (data.type === "codex") {
    const windows = data.windows || {};
    const fiveHour = windows.fiveHour || data;
    const weekly = windows.sevenDay || {};
    const usageRow = (title, usage) => {
      const percentage = Number.isFinite(usage?.remainingPct)
        ? Math.max(0, Math.min(100, usage.remainingPct))
        : null;
      return `
        <div class="usage-compact-row">
          <span class="compact-title">${title}</span>
          <strong class="compact-percent">${percentage ?? "--"}%</strong>
          ${quotaStatusLamp(percentage)}
          <div class="compact-bar" aria-hidden="true">
            <span data-progress-value="${percentage ?? 0}"></span>
          </div>
          <span class="compact-reset">${usage?.resetText || "--"}</span>
        </div>`;
    };

    appRoot.innerHTML = `
      <article class="codex-tooltip placement-${data.placement || "above"}" role="tooltip" aria-label="Codex usage">
        <header>
          <strong>Codex Usage</strong>
          <span>${data.status || "Unavailable"}</span>
        </header>
        <div class="codex-tooltip-rows">
          ${usageRow(`${data.windowHours ?? 5}h`, fiveHour)}
          ${usageRow("7d", weekly)}
        </div>
      </article>`;
    updateProgressBars(appRoot);
    return;
  }

  if (data.type === "weather") {
    const metric = (label, value) => value === null || value === undefined || value === ""
      ? ""
      : `<div><span>${label}</span><strong>${value}</strong></div>`;
    appRoot.innerHTML = `
      <article class="weather-tooltip" role="tooltip" aria-label="天气详情">
        <header class="weather-tooltip-header">
          <div class="weather-tooltip-location">${locationArrowIcon}<span>${data.location || "当前位置"}</span></div>
          <time>${data.time || ""}</time>
        </header>
        <div class="weather-tooltip-current">
          ${weatherIconMarkup(data.icon, "weather-tooltip-icon")}
          <strong>${data.temperature ?? "--"}°</strong>
          <div><b>${data.condition || "天气未知"}</b><span>${data.date || ""}</span></div>
        </div>
        ${data.weatherSummary ? `<p class="weather-forecast-summary">${data.weatherSummary}</p>` : ""}
        <div class="weather-tooltip-metrics">
          ${metric("体感", data.feelsLike == null ? "" : `${data.feelsLike}°`)}
          ${metric("湿度", data.humidity == null ? "" : `${data.humidity}%`)}
          ${metric("降雨", data.precipitationProbability == null ? "" : `${data.precipitationProbability}%`)}
          ${metric("风力", data.wind)}
          ${metric("降水", data.precipitation == null ? "" : `${data.precipitation} mm`)}
          ${metric("气压", data.pressure == null ? "" : `${data.pressure} hPa`)}
          ${metric("能见度", data.visibility == null ? "" : `${data.visibility} km`)}
        </div>
      </article>`;
    return;
  }

  if (data.type === "notifications") {
    appRoot.innerHTML = `
      <article class="notifications-tooltip" role="tooltip" aria-label="通知预览">
        ${window.WinPlateNotificationDigest.renderDigestCard(data.digest, { compact: true })}
      </article>`;
    return;
  }

  if (data.type === "network") {
    const statusKind = ["normal", "warning", "error", "idle"].includes(data.statusKind)
      ? data.statusKind
      : "error";
    appRoot.innerHTML = `
      <article class="network-tooltip" role="tooltip" aria-label="网络状态">
        <header class="network-tooltip-header">
          <span class="network-label">网络状态</span>
          <span class="network-status ${statusKind}">
            <i class="network-status-dot" aria-hidden="true"></i>
            <strong>${escapeHtml(data.status || "获取失败")}</strong>
          </span>
        </header>
        <div class="network-row">
          <span class="network-icon-download">↓</span>
          <span class="network-label">下载速度</span>
          <strong class="network-value network-value-download">${escapeHtml(data.download || "---")}</strong>
        </div>
        <div class="network-row">
          <span class="network-icon-upload">↑</span>
          <span class="network-label">上传速度</span>
          <strong class="network-value network-value-upload">${escapeHtml(data.upload || "---")}</strong>
        </div>
        <div class="network-row">
          <span class="network-icon-latency">◌</span>
          <span class="network-label">延迟</span>
          <strong class="network-value network-value-latency">${escapeHtml(data.latency || "---")}</strong>
        </div>
      </article>`;
    return;
  }

  const lines = Array.isArray(data.lines) ? data.lines : [];
  appRoot.innerHTML = `
    <div class="system-tooltip" role="tooltip">
      ${lines.map((line) => `<span>${line}</span>`).join("")}
    </div>`;
}

function qweatherServiceCard(official, failures) {
  return `
    <article class="dashboard-card qweather-card" data-module-id="weather" ${moduleHealthAttributes("weather")}>
      <div class="qweather-card-heading">
        <div class="card-icon">${weatherIconMarkup("100", "qweather-service-icon")}</div>
        <div class="card-actions">
          <span class="service-health"><i></i>服务正常</span>
          <button type="button" class="refresh-button qweather-verify-button" id="qweather-verify" aria-label="刷新 QWeather 官方用量">
            ${refreshIcon}
            <span>刷新</span>
          </button>
        </div>
      </div>
      <span>QWeather API</span>
      <strong>${qweatherUsage.used} <em>/ ${qweatherUsage.total}</em></strong>
      <small>本月配额已使用 ${qweatherUsage.percent}%</small>
      ${progressBar(qweatherUsage.percent, "large-track")}
      <div class="qweather-summary">
        <div><span>剩余</span><strong>${qweatherUsage.remaining}</strong></div>
        <div><span>今日</span><strong>${qweatherUsage.today ?? 0}</strong></div>
        <div><span>失败</span><strong>${failures}</strong></div>
      </div>
      ${official}
    </article>`;
}

function macApplicationSettingsSection() {
  return `<section class="settings-section application-settings-section">
    <h2>Application</h2>
    <div class="settings-panel application-settings-panel">
      <label>
        <span><strong>Menu bar status</strong><small>Show WinPlate in the macOS menu bar.</small></span>
        <input type="checkbox" data-app-setting="menuBarEnabled" ${applicationSettings.menuBarEnabled ? "checked" : ""}>
      </label>
      <label>
        <span><strong>Launch at login</strong><small>Start WinPlate when you sign in.</small></span>
        <input type="checkbox" data-app-setting="launchAtLogin" ${applicationSettings.launchAtLogin ? "checked" : ""}>
      </label>
    </div>
  </section>`;
}

function windowsGeneralSettingsSection() {
  return `<section class="settings-section">
    <h2>通用</h2>
    <div class="settings-panel">
      <div><span><strong>Floating window</strong><small>Show the status capsule on your desktop.</small></span><b class="enabled">Enabled</b></div>
      <div><span><strong>Always on top</strong><small>Keep WinPlate above other windows.</small></span><b class="enabled">Enabled</b></div>
      <div><span><strong>Codex source</strong><small>Hidden local CLI session using /status.</small></span><b>${statusData.codex.source || "Unavailable"}</b></div>
    </div>
  </section>`;
}

function heartCard() {
  return `
    <article class="dashboard-card heart-card" data-module-id="heart" ${moduleHealthAttributes("heart")}>
      <div class="card-icon">♥</div><span>Heart Rate</span>
      <strong>${statusData.heart.heartRate} <em>${statusData.heart.unit}</em></strong><small>${statusData.heart.source} · ${statusData.heart.updatedAt}</small>
    </article>`;
}

function dashboardContributionMonth(github) {
  const lastMonth = github.contributionMonths?.[github.contributionMonths.length - 1];
  const label = lastMonth?.label || github.contributionMonth;
  if (label) return String(label).split(" ")[0];
  return new Intl.DateTimeFormat("en-US", { month: "long" }).format(new Date());
}

function dashboardGithubCard() {
  const github = normalizeGithub(statusData.github);
  const stats = [
    { icon: previewIcons.repos, label: "Repos", value: github.repos, meta: "" },
    { icon: previewIcons.commits, label: "Contributions", value: github.commitsThisMonth, meta: "This month" },
    { icon: previewIcons.streak, label: "Streak", value: github.streakDays, meta: "days" }
  ];
  return `
    <article class="dashboard-card github-card github-dashboard-card" data-module-id="github" ${moduleHealthAttributes("github")}>
      <div class="github-dashboard-top">
        <div class="github-dashboard-profile">
          <span class="github-dashboard-mark" aria-hidden="true">${githubCardIcon}</span>
          <div class="github-dashboard-identity">
            <strong>${github.name}</strong>
            <span>${github.username}</span>
          </div>
        </div>
        <span class="github-dashboard-live">${github.status || "Live"}</span>
      </div>
      <div class="github-dashboard-stats">
        ${stats.map((item) => `
          <div>
            <span>${item.icon}${item.label}</span>
            <strong>${item.value}</strong>
            <small>${item.meta}</small>
          </div>`).join("")}
      </div>
      <section class="github-dashboard-contributions">
        <div class="contribution-heading">
          <strong>Last 30 days</strong>
          <span class="contribution-month">${dashboardContributionMonth(github)}</span>
        </div>
        <div class="contribution-grid" aria-hidden="true">${contributionGrid(github.contributions30d)}</div>
        <div class="contribution-legend">
          <span>Less</span>
          ${[0, 1, 2, 3, 4].map((level) => `<i class="contribution-cell level-${level}"></i>`).join("")}
          <span>More</span>
        </div>
      </section>
      <footer class="github-repository dashboard-github-repository">
        <strong>${previewIcons.repository}${github.project}</strong>
        <span><i></i>${github.language}</span>
        <span class="repository-stars" aria-label="${github.stars} stars">${previewIcons.star}${github.stars}</span>
      </footer>
    </article>`;
}

function dashboardCodexRow(title, data) {
  const percentage = normalizePercent(data?.remainingPct);
  const resetText = data?.resetText ? `Resets in ${String(data.resetText).replace(/^in\s+/i, "")}` : "Reset unavailable";
  return `
    <div class="dashboard-codex-window">
      <div class="dashboard-codex-window-head">
        <span>${title}</span>
        <strong>${percentage ?? "--"}%</strong>
      </div>
      <small>${resetText}</small>
      ${progressBar(percentage, "dashboard-codex-track")}
    </div>`;
}

function deepseekCurrencySymbol(currency) {
  return currency === "CNY" ? "¥" : currency === "USD" ? "$" : "";
}

function formatDeepSeekBalance(balance) {
  const value = Number(balance?.totalBalance);
  if (!Number.isFinite(value)) return balance?.totalBalance || "--";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function primaryDeepSeekBalance(deepseek = statusData.deepseek) {
  const balances = Array.isArray(deepseek?.balances) ? deepseek.balances : [];
  return balances[0] || null;
}

function dashboardDeepSeekBalanceColumn() {
  const deepseek = statusData.deepseek || {};
  const balance = primaryDeepSeekBalance(deepseek);
  const amount = balance
    ? `${deepseekCurrencySymbol(balance.currency)}${formatDeepSeekBalance(balance)}`
    : "¥--";
  const meta = balance
    ? "Available balance"
    : deepseek.configured
      ? "Balance unavailable"
      : "Configure API key";
  return `
    <div class="dashboard-codex-window dashboard-deepseek-window">
      <div class="dashboard-codex-window-head">
        <span>DeepSeek API</span>
        <strong>${amount}</strong>
      </div>
      <small>${meta}</small>
    </div>`;
}

function dashboardCodexCard() {
  const windows = statusData.codex.windows || {};
  const fiveHour = windows.fiveHour || statusData.codex;
  const sevenDay = windows.sevenDay || {};
  return `
    <article class="dashboard-card codex-card dashboard-codex-card" data-module-id="codex" ${moduleHealthAttributes("codex")}>
      <div class="dashboard-codex-header">
        <div class="card-icon codex-card-icon"><img src="../../assets/codex-icon.png" alt="" aria-hidden="true"></div>
        <div class="dashboard-codex-copy">
          <strong>Codex Usage</strong>
          <small>${relativeUpdatedAt(statusData.codex.updatedAt)}</small>
        </div>
      </div>
      <div class="dashboard-codex-windows">
        ${dashboardCodexRow("5 hours", fiveHour)}
        ${dashboardCodexRow("1 week", sevenDay)}
        ${dashboardDeepSeekBalanceColumn()}
      </div>
    </article>`;
}

function mailStatusLabel(outline = mailOutline) {
  if (mailRefreshInFlight) return "刷新中";
  if (outline.availability === "live") return "Live";
  if (outline.availability === "cached") return "缓存";
  if (outline.availability === "unconnected") return "未连接";
  if (outline.availability === "unconfigured") return "未配置";
  if (outline.availability === "unavailable") return "不可用";
  return "读取中";
}

function mailTimeLabel(sentAt) {
  const value = Number(sentAt);
  if (!Number.isFinite(value) || value <= 0) return "未知时间";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}

function mailLabelPills(labels = []) {
  const visibleLabels = labels
    .filter((label) => ["UNREAD", "IMPORTANT", "STARRED"].includes(label) || label.startsWith("CATEGORY_"))
    .slice(0, 3);
  return visibleLabels.map((label) => {
    const text = label
      .replace("CATEGORY_", "")
      .replace("UNREAD", "未读")
      .replace("IMPORTANT", "重要")
      .replace("STARRED", "星标")
      .toLowerCase();
    return `<span>${escapeHtml(text)}</span>`;
  }).join("");
}

function twitchLogoDataUri() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 42"><text x="0" y="32" fill="#9146ff" font-family="Arial Black, Arial, sans-serif" font-size="32" font-weight="900">Twitch</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function prepareMailHtml(body = "") {
  const value = String(body || "");
  if (typeof DOMParser === "undefined") return value;
  try {
    const document = new DOMParser().parseFromString(value, "text/html");
    document.querySelectorAll("img").forEach((image) => {
      const src = image.getAttribute("src") || "";
      const width = Number(image.getAttribute("width") || image.style.width?.replace("px", ""));
      const height = Number(image.getAttribute("height") || image.style.height?.replace("px", ""));
      if (/^https:\/\/spade\.twitch\.tv\/track/i.test(src) || (width === 1 && height === 1)) {
        image.remove();
        return;
      }
      if (/^https:\/\/static-cdn\.jtvnw\.net\/growth-assets\/email_twitch_logo_uv/i.test(src)) {
        image.src = twitchLogoDataUri();
        image.alt = image.alt || "Twitch";
      }
      image.referrerPolicy = "no-referrer";
      image.loading = "lazy";
    });
    return document.body.innerHTML || value;
  } catch (error) {
    return value;
  }
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutId = null;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

async function readMailMessageWithFallback(uid) {
  if (typeof window.winplate.getMailMessage === "function") {
    try {
      return await withTimeout(
        window.winplate.getMailMessage(uid),
        MAIL_DETAIL_READ_TIMEOUT_MS,
        "邮件正文读取超时"
      );
    } catch (error) {
      console.error("Mail readonly fetch failed; falling back to read-sync:", error);
    }
  }
  try {
    return await withTimeout(
      window.winplate["email:read-message"](uid),
      MAIL_DETAIL_READ_TIMEOUT_MS,
      "邮件已读同步超时"
    );
  } catch (error) {
    throw error;
  }
}

async function syncMailReadStateInBackground(uid, requestId) {
  try {
    await withTimeout(
      window.winplate["email:read-message"](uid),
      MAIL_DETAIL_READ_TIMEOUT_MS,
      "邮件已读同步超时"
    );
    if (mailDetail.requestId !== requestId) return;
    notificationSummary = await window.winplate.getNotifications();
    await hydrateNotificationDigest();
    updateMainStatusDom();
  } catch (error) {
    console.error("Failed to sync mail read state:", error);
  }
}

function mailIframeDocument(body = "", isPlainText = false) {
  const content = isPlainText
    ? `<pre class="mail-plain-text">${escapeHtml(body)}</pre>`
    : prepareMailHtml(body);
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; object-src 'none'; connect-src 'none'; style-src 'unsafe-inline'; img-src https: http: data: cid:;">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    html, body { margin: 0; min-width: 0; }
    html, body { background: #fff; color: #111827; color-scheme: light; }
    body { overflow-wrap: anywhere; }
    img { max-width: 100%; height: auto; }
    table { max-width: 100%; }
    .mail-plain-text {
      margin: 0;
      padding: 18px 20px;
      color: inherit;
      font: 13px/1.65 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
  </style>
</head>
<body>${content}</body>
</html>`;
}

function mailDetailBody(message = {}) {
  if (message.htmlBody) {
    return `<iframe class="mail-detail-frame" sandbox="" referrerpolicy="no-referrer" srcdoc="${escapeHtml(mailIframeDocument(message.htmlBody, false))}"></iframe>`;
  }
  if (message.textBody) {
    return `<iframe class="mail-detail-frame" sandbox="" referrerpolicy="no-referrer" srcdoc="${escapeHtml(mailIframeDocument(message.textBody, true))}"></iframe>`;
  }
  return `<div class="mail-detail-empty">这封邮件没有可展示的正文。</div>`;
}

function mailDetailDrawer() {
  if (!mailDetail.open) return "";
  const message = mailDetail.message || {};
  const title = mailDetail.loading ? "正在读取邮件..." : mailDetail.error ? "邮件读取失败" : message.subject || "邮件详情";
  const body = mailDetail.loading
    ? `<div class="mail-detail-state">正在加载正文...</div>`
    : mailDetail.error
      ? `<div class="mail-detail-state error">${escapeHtml(mailDetail.error)}</div>`
      : mailDetailBody(message);
  const attachments = Array.isArray(message.attachments) && message.attachments.length
    ? `<div class="mail-attachments">
        <strong>附件</strong>
        ${message.attachments.map((item) => `
          <span>${escapeHtml(item.filename || "attachment")} · ${escapeHtml(item.contentType || "file")} · ${Math.ceil((Number(item.size) || 0) / 1024)} KB</span>
        `).join("")}
      </div>`
    : "";
  return `
    <aside class="mail-detail-drawer" aria-label="邮件详情">
      <header>
        <div>
          <span>邮件详情</span>
          <h2>${escapeHtml(title)}</h2>
        </div>
        <button class="mail-detail-close" type="button" aria-label="关闭邮件详情">×</button>
      </header>
      ${mailDetail.error || mailDetail.loading ? "" : `
        <dl class="mail-detail-meta">
          <div><dt>发件人</dt><dd>${escapeHtml(message.from || message.sender || "")}</dd></div>
          <div><dt>收件人</dt><dd>${escapeHtml(message.to || "")}</dd></div>
          <div><dt>时间</dt><dd>${escapeHtml(message.date || mailTimeLabel(message.sentAt))}</dd></div>
          <div><dt>状态</dt><dd>${message.unread ? "未读" : "已读"}</dd></div>
        </dl>
      `}
      <section class="mail-detail-body">${body}</section>
      ${attachments}
      <footer>
        <button class="mail-mark-read-button" type="button" disabled>${message.unread ? "标记已读" : "已读"}</button>
        <button class="mail-open-external-button" type="button">在 QQ 邮箱中打开</button>
      </footer>
    </aside>`;
}

function notificationDetailValue(value) {
  if (Number.isFinite(Number(value)) && Number(value) > 10_000) {
    return absoluteTimeLabel(Number(value));
  }
  return String(value ?? "");
}

function notificationActionButton(action = {}) {
  const label = action.label || "执行";
  const disabled = action.type === "markRead" && label === "已读";
  return `<button class="notification-detail-action type-${escapeHtml(action.type || "view")}" type="button" data-notification-action-id="${escapeHtml(action.id || "")}" ${disabled ? "disabled" : ""}>${escapeHtml(label)}</button>`;
}

function notificationDrawer() {
  if (!notificationDrawerState.open) return "";
  if (notificationDrawerState.mode === "list") {
    const digest = window.WinPlateNotificationDigest.normalizeDigest(notificationDigest);
    const list = window.WinPlateNotificationDigest.renderDigestDrawerList(
      digest,
      notificationItemsForDigest(),
      { sourceLabel: notificationSourceLabel, relativeTime: relativeUpdatedAt }
    );
    return `
      <aside id="notification-digest-drawer" class="notification-detail-drawer" role="dialog" aria-modal="true" aria-label="通知摘要">
        <header>
          <div><span>智能摘要</span><h2>${escapeHtml(digest.headline)}</h2></div>
          <button class="notification-detail-close" type="button" aria-label="关闭通知摘要">×</button>
        </header>
        <section class="notification-detail-content">${list}</section>
        ${notificationActionFeedback ? `<p class="notification-detail-feedback" role="status">${escapeHtml(notificationActionFeedback)}</p>` : ""}
      </aside>`;
  }
  const payload = notificationDetail.data || {};
  const detail = payload.detail || {};
  const notification = payload.notification || {};
  const title = notificationDetail.loading
    ? "正在读取通知..."
    : notificationDetail.error
      ? "通知读取失败"
      : detail.title || notification.title || "通知详情";
  const body = notificationDetail.loading
    ? `<div class="notification-detail-state">正在加载通知详情...</div>`
    : notificationDetail.error
      ? `<div class="notification-detail-state error">${escapeHtml(notificationDetail.error)}</div>
         <button type="button" data-notification-detail-retry="${escapeHtml(notificationDetail.id || "")}">重试</button>`
      : `<div class="notification-detail-body"><p>${escapeHtml(detail.body || notification.body || notification.title || "暂无详细内容。").replaceAll("\n", "<br>")}</p></div>`;
  const metadata = Array.isArray(detail.metadata) ? detail.metadata : [];
  const actions = Array.isArray(payload.actions) ? payload.actions.filter((action) => action.type !== "view") : [];
  return `
    <aside id="notification-digest-drawer" class="notification-detail-drawer" role="dialog" aria-modal="true" aria-label="通知详情">
      <header>
        <button class="notification-detail-back" type="button" aria-label="返回通知摘要">←</button>
        <div>
          <span>${escapeHtml(notificationSourceLabel(notification.source || "system"))}</span>
          <h2>${escapeHtml(title)}</h2>
        </div>
        <button class="notification-detail-close" type="button" aria-label="关闭通知详情">×</button>
      </header>
      ${notificationDetail.loading || notificationDetail.error ? "" : `
        <dl class="notification-detail-meta">
          ${metadata.map((entry) => `
            <div>
              <dt>${escapeHtml(entry.label || "")}</dt>
              <dd>${escapeHtml(notificationDetailValue(entry.value))}</dd>
            </div>`).join("")}
        </dl>
      `}
      <section class="notification-detail-content">${body}</section>
      ${notificationActionFeedback ? `<p class="notification-detail-feedback" role="status">${escapeHtml(notificationActionFeedback)}</p>` : ""}
      <footer>
        ${actions.map(notificationActionButton).join("")}
      </footer>
    </aside>`;
}

function mailItemCard(item) {
  const uid = item.uid || item.messageId || item.threadId || "";
  const labels = Array.isArray(item.labels) ? item.labels : [];
  const unread = item.unread || labels.includes("UNREAD");
  return `
    <article class="mail-outline-item ${unread ? "unread" : ""} ${String(uid) === String(mailHighlightedUid || "") ? "focused" : ""}">
      <div class="mail-outline-meta">
        <strong>${escapeHtml(item.sender)}</strong>
        <time>${mailTimeLabel(item.sentAt)}</time>
      </div>
      <h2>${escapeHtml(item.subject)}</h2>
      <p>${escapeHtml(item.summary || item.snippet || "暂无可用摘要")}</p>
      <footer>
        <button class="mail-open-button" type="button" data-mail-uid="${escapeHtml(uid)}" ${uid ? "" : "disabled"}>${escapeHtml(item.action || "查看")}</button>
        <div class="mail-labels">${mailLabelPills(labels)}</div>
      </footer>
    </article>`;
}

function mailContent() {
  const items = Array.isArray(mailOutline.items) ? mailOutline.items.slice(0, 20) : [];
  const stateNotice = mailOutline.error
    ? `<div class="mail-state-notice state-${escapeHtml(mailOutline.availability)}">${escapeHtml(mailOutline.error)}</div>`
    : "";
  const emptyMessage = mailOutline.availability === "unconnected"
    ? "请先连接 QQ 邮箱，连接后会读取最近 30 天收件箱邮件大纲。"
    : mailOutline.availability === "unconfigured"
      ? "请先配置 QQ 邮箱地址和授权码。"
      : "最近 30 天收件箱暂无可展示邮件。";
  const list = items.length
    ? `<div class="mail-outline-list">${items.map(mailItemCard).join("")}</div>`
    : `<div class="mail-empty-state">${mailIcon}<strong>${emptyMessage}</strong></div>`;
  return `
    <section class="mail-page" data-module-id="mail" ${moduleHealthAttributes("mail")}>
      <div class="mail-page-heading">
        <div><p>MAIL</p><h1>邮件大纲</h1><span>最近 ${mailOutline.windowDays || mailSettings.windowDays || 30} 天收件箱摘要。</span></div>
        <div class="mail-actions">
          <button class="mail-connect-button" id="connect-mail" type="button">${mailSettings.connected ? "重新连接" : "连接 QQ 邮箱"}</button>
          <button
            class="refresh-button mail-refresh-button ${mailRefreshInFlight ? "refreshing" : ""}"
            id="refresh-mail"
            type="button"
            aria-label="刷新邮件大纲"
            ${mailRefreshInFlight ? "disabled" : ""}
          >
            ${refreshIcon}
            <span>${mailRefreshInFlight ? "刷新中" : "刷新"}</span>
          </button>
        </div>
      </div>
      <div class="mail-status-bar">
        <span class="mail-status-pill state-${escapeHtml(mailOutline.availability)}">${mailStatusLabel()}</span>
        <span>${escapeHtml(mailOutline.query || "IMAP INBOX SINCE 30 days")}</span>
        <time>${relativeUpdatedAt(mailOutline.updatedAt)}</time>
      </div>
      ${stateNotice}
      ${list}
      ${mailDetailDrawer()}
    </section>`;
}

function notificationContent() {
  const summary = normalizedNotifications();
  const items = notificationItemsForDigest();
  const digestCard = window.WinPlateNotificationDigest.renderDigestCard(notificationDigest);
  const rows = window.WinPlateNotificationDigest.renderRawNotifications(items, {
    expanded: notificationRawExpanded,
    sourceLabel: notificationSourceLabel,
    levelLabel: notificationLevelLabel,
    relativeTime: relativeUpdatedAt
  });
  return `
    <section class="notifications-page" data-module-id="notifications" ${moduleHealthAttributes("notifications")}>
      <div class="notifications-page-heading">
        <div><p>NOTIFICATIONS</p><h1>通知中心</h1><span>统一收纳邮件、天气预警和本地任务提示。</span></div>
        <div class="notification-actions">
          <button class="notification-test-button" id="push-test-notification" type="button">测试通知</button>
          <button class="notification-clear-button" id="mark-all-notifications-read" type="button" ${summary.unreadCount ? "" : "disabled"}>全部已读</button>
          <button class="notification-clear-button" id="clear-notifications" type="button" ${items.length ? "" : "disabled"}>清空</button>
        </div>
      </div>
      ${digestCard}
      ${rows}
      ${notificationDrawer()}
    </section>`;
}

function dashboardContent(section) {
  const failures = qweatherOfficialStats?.errors ?? 0;
  const official = qweatherOfficialStats
    ? `<div class="qweather-official"><span>过去24小时：${qweatherOfficialStats.total}次</span><span>成功：${qweatherOfficialStats.success}</span><span>错误：${qweatherOfficialStats.errors}</span><small>截至 ${qweatherOfficialStats.asOf}</small></div>`
    : `<small class="qweather-message">${qweatherUsageMessage || "官方数据可能延迟 1 小时或更久"}</small>`;
  const dashboardRenderers = {
    github: () => dashboardGithubCard(),
    codex: () => dashboardCodexCard(),
    heart: () => heartCard(),
    weather: () => qweatherServiceCard(official, failures)
  };
  const dashboardModuleContext = {
    render: (id) => dashboardRenderers[id]?.() || "",
    load: async () => null,
    bind: () => {}
  };
  const cards = `<div class="dashboard-grid">${window.WinPlateModuleRegistry
    .modulesForView("dashboard", appSettings.modules)
    .map((module) => rendererModuleById.get(module.id)?.renderDashboard(dashboardModuleContext) || "")
    .join("")}</div>`;
  const qweatherCards = `
    <div class="dashboard-grid qweather-page-grid">
      ${weatherDashboardCard()}
      ${qweatherServiceCard(official, failures)}
    </div>`;

  const content = {
    Dashboard: `<div class="page-heading"><p>OVERVIEW</p><h1>Good afternoon, ${statusData.github.name}</h1><span>Your live workspace status at a glance.</span></div>${cards}`,
    GitHub: githubContent(),
    Codex: codexContent(),
    Mail: mailContent(),
    Notifications: notificationContent(),
    Heart: `<div class="page-heading"><p>HEART</p><h1>Health snapshot</h1><span>Recent reading from ${statusData.heart.source}.</span></div>${heartCard()}`,
    QWeather: `<div class="page-heading"><p>QWEATHER</p><h1>天气与服务状态</h1><span>实时天气、未来预报与 API 配额使用情况。</span></div>${qweatherCards}`,
    Settings: `<div class="settings-page"><div class="page-heading"><p>PREFERENCES</p><h1>Settings</h1><span>Configure your WinPlate experience.</span></div>
      ${isMac ? macApplicationSettingsSection() : ""}
      <section class="settings-section">
        <h2>外观</h2>
        <div class="settings-panel appearance-panel">${themeSelector()}</div>
      </section>
      <section class="settings-section">
        <h2>通用与模块</h2>
        ${productSettingsPanel()}
      </section>
      <section class="settings-section">
        <h2>天气</h2>
        <form class="settings-panel weather-settings-panel" id="weather-settings-form">
          <fieldset>
            <legend><strong>天气服务</strong><small>必填，用于实时天气与天气预报</small></legend>
            <label>
              <span><strong>API Key</strong><small>来自 QWeather 控制台，仅保存在本地设备中</small></span>
              <input id="qweather-api-key" type="password" autocomplete="off">
            </label>
            <label>
              <span><strong>API Host</strong><small>填写项目分配的 API Host，不包含 https://</small></span>
              <input id="qweather-api-host" type="text" autocomplete="off" spellcheck="false">
            </label>
          </fieldset>
          ${renderWeatherLocationSettings()}
          <fieldset>
            <legend><strong>官方用量统计</strong><small>可选，用于读取 QWeather 官方调用统计</small></legend>
            <label>
              <span><strong>JWT Project ID</strong><small>QWeather 控制台中的 Project ID</small></span>
              <input id="qweather-project-id" type="text" autocomplete="off">
            </label>
            <label>
              <span><strong>JWT Credential ID</strong><small>官方统计接口使用的 Credential ID</small></span>
              <input id="qweather-credential-id" type="text" autocomplete="off">
            </label>
            <label>
              <span><strong>Ed25519 私钥</strong><small>仅保存在本地设备中，留空保持原值</small></span>
              <textarea id="qweather-private-key" rows="4" autocomplete="off" spellcheck="false"></textarea>
            </label>
          </fieldset>
          <div class="weather-settings-actions">
            <div class="weather-settings-statuses">
              <small id="weather-service-status">天气服务：正在读取...</small>
              <small id="weather-official-status">官方统计：正在读取...</small>
            </div>
            <button type="submit">保存配置</button>
          </div>
        </form>
      </section>
      <section class="settings-section">
        <h2>DeepSeek</h2>
        <form class="settings-panel weather-settings-panel" id="deepseek-settings-form">
          <fieldset>
            <legend><strong>DeepSeek API</strong><small>用于在 Codex 模块中读取账户余额</small></legend>
            <label>
              <span><strong>API Key</strong><small>仅保存在本地设备中，留空保持原值</small></span>
              <input id="deepseek-api-key" type="password" autocomplete="off">
            </label>
            <label>
              <span><strong>Base URL</strong><small>默认使用 DeepSeek 官方 API 地址</small></span>
              <input id="deepseek-base-url" type="url" autocomplete="off" spellcheck="false">
            </label>
          </fieldset>
          <div class="weather-settings-actions">
            <div class="weather-settings-statuses">
              <small id="deepseek-settings-status">DeepSeek API：正在读取...</small>
              <small id="deepseek-chat-status">AI 调用：正在读取...</small>
              <small class="configured">智能通知：开启</small>
            </div>
            <button type="button" id="deepseek-test-chat">测试 AI 调用</button>
            <button type="submit">保存配置</button>
          </div>
        </form>
      </section>
      <section class="settings-section">
        <h2>QQ 邮箱</h2>
        <form class="settings-panel weather-settings-panel mail-settings-panel" id="mail-settings-form">
          <fieldset>
            <legend><strong>QQ 邮箱 IMAP</strong><small>邮箱地址保存在本地配置中，授权码使用系统加密存储</small></legend>
            <label>
              <span><strong>邮箱地址</strong><small>例如 123456@qq.com</small></span>
              <input id="qq-mail-address" type="email" autocomplete="off" spellcheck="false" value="${escapeHtml(mailSettings.address || "")}" placeholder="请输入 QQ 邮箱地址">
            </label>
            <label>
              <span><strong>授权码</strong><small>开启 POP3/IMAP/SMTP 服务后生成，账号密码变更后需重新获取</small></span>
              <input id="qq-mail-auth-code" type="password" autocomplete="off" placeholder="${mailSettings.configured ? "已配置，重新填写可覆盖" : "请输入 QQ 邮箱授权码"}">
            </label>
            <label>
              <span><strong>协议</strong><small>读取邮件使用 IMAP，发送邮件预留 SMTP 配置</small></span>
              <input id="qq-mail-protocol" type="text" value="${escapeHtml(mailSettings.protocol || "IMAP")}" disabled>
            </label>
            <label>
              <span><strong>自动同步间隔</strong><small>后台自动检查新邮件的频率，最短 15 秒</small></span>
              <input id="qq-mail-auto-refresh-seconds" type="number" min="${MIN_MAIL_AUTO_REFRESH_SECONDS}" max="${MAX_MAIL_AUTO_REFRESH_SECONDS}" step="15" value="${mailAutoRefreshSeconds}">
            </label>
          </fieldset>
          <div class="weather-settings-actions">
            <div class="weather-settings-statuses">
              <small id="mail-settings-status" class="${mailSettings.configured ? "configured" : ""}">QQ 邮箱配置：${mailSettings.configured ? "已配置" : "未配置"}</small>
              <small id="mail-connection-status" class="${mailSettings.connected ? "configured" : ""}">IMAP：${mailSettings.connected ? "已连接" : "未连接"}</small>
              <small id="mail-auto-refresh-status">自动同步：每 ${mailAutoRefreshLabel()}</small>
            </div>
            <div class="mail-settings-actions">
              <button type="submit">保存配置</button>
              <button type="button" id="settings-connect-mail">${mailSettings.connected ? "重新连接" : "连接 QQ 邮箱"}</button>
            </div>
          </div>
        </form>
      </section>
      ${isMac ? "" : windowsGeneralSettingsSection()}</div>`
  };
  return content[section];
}

function relativeUpdatedAt(timestamp) {
  if (!timestamp) return "尚未更新";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}小时前` : `${Math.floor(hours / 24)}天前`;
}

function usageWindowCard(title, data) {
  const percentage = data?.remainingPct;
  const displayPercentage = percentage ?? "--";
  return `
    <article class="usage-window-card">
      <span>${title}</span>
      <strong>${displayPercentage}%</strong>
      <small>${data?.resetText ? `Resets in ${data.resetText.replace(/^in\s+/i, "")}` : "Reset unavailable"}</small>
      ${progressBar(percentage, "codex-progress")}
    </article>`;
}

function codexContent() {
  const windows = statusData.codex.windows || {};
  const fiveHour = windows.fiveHour || statusData.codex;
  const sevenDay = windows.sevenDay;
  const deepseek = statusData.deepseek || {};
  const balances = Array.isArray(deepseek.balances) ? deepseek.balances : [];
  const tokenUsage = deepseek.tokenUsage || {};
  const tokenNumber = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  };
  const tokenValue = (value, unit = true) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return "--";
    return `${number.toLocaleString("en-US")}${unit ? " tokens" : ""}`;
  };
  const tokenPercent = (value, total) => total > 0 ? Math.max(0, Math.min(100, (value / total) * 100)) : 0;
  const tokenBreakdown = (usage = {}) => {
    const rows = [
      { key: "cache-hit", label: "缓存输入", value: tokenNumber(usage.cacheHitTokens) },
      { key: "cache-miss", label: "未缓存输入", value: tokenNumber(usage.cacheMissTokens) },
      { key: "output", label: "输出", value: tokenNumber(usage.outputTokens) }
    ];
    const total = tokenNumber(usage.totalTokens) || rows.reduce((sum, row) => sum + row.value, 0);
    return { rows, total };
  };
  const todayBreakdown = tokenBreakdown(tokenUsage.today);
  const totalBreakdown = tokenBreakdown(tokenUsage.total);
  const estimateLevel = todayBreakdown.total > 2_000_000 ? "高" : todayBreakdown.total > 1_000_000 ? "中" : "低";
  const tokenRows = todayBreakdown.rows.map((row) => `
        <div class="deepseek-token-row">
          <div class="deepseek-token-row-head">
            <span>${row.label}</span>
            <strong>${tokenValue(row.value)}</strong>
            <em>${tokenPercent(row.value, todayBreakdown.total).toFixed(1)}%</em>
          </div>
          <div class="deepseek-row-track ${row.key}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${tokenPercent(row.value, todayBreakdown.total).toFixed(1)}">
            <span data-progress-value="${tokenPercent(row.value, todayBreakdown.total).toFixed(1)}"></span>
          </div>
        </div>`).join("");
  const tokenPanel = `
    <div class="deepseek-token-panel">
      <header>
        <span>Token 用量</span>
        <small>今日</small>
      </header>
      <div class="deepseek-token-stats">
        <div><span>今日总量</span><strong>${tokenValue(todayBreakdown.total, false)}</strong><small>tokens</small></div>
        <div><span>应用累计</span><strong>${tokenValue(totalBreakdown.total, false)}</strong><small>tokens</small></div>
        <div><span>预计消耗</span><strong>${estimateLevel}</strong></div>
      </div>
      <div class="deepseek-token-rows">${tokenRows}</div>
    </div>`;
  const deepseekActive = deepseek.status === "Normal";
  const deepseekStatusText = deepseekActive ? "DeepSeek API 正常" : `DeepSeek API ${deepseek.status || "未配置"}`;
  const walletIcon = `
    <svg class="deepseek-wallet-icon" viewBox="0 0 48 48" aria-hidden="true">
      <path d="M8 17.5h30.5A5.5 5.5 0 0 1 44 23v14a5.5 5.5 0 0 1-5.5 5.5h-25A7.5 7.5 0 0 1 6 35V13a7.5 7.5 0 0 1 7.5-7.5H34a4 4 0 0 1 4 4v8" />
      <path d="M8 17.5a7.5 7.5 0 0 1 7.5-7.5H38" />
      <path d="M31 28.5h13" />
    </svg>`;
  const balanceCards = balances.length
    ? balances.map((balance) => `
        <article class="deepseek-balance-card">
          <div class="deepseek-balance-metric deepseek-wallet-metric">
            <div class="deepseek-wallet-heading">
              <span>可用余额</span>
              <small>Available balance</small>
            </div>
            <div class="deepseek-wallet-balance">
              <strong><span>${deepseekCurrencySymbol(balance.currency)}</span>${formatDeepSeekBalance(balance)}</strong>
            </div>
            <div class="deepseek-wallet-art">${walletIcon}</div>
            <div class="deepseek-health-pill ${deepseekActive ? "" : "inactive"}"><i></i>${deepseekStatusText}</div>
            <div class="deepseek-auto-refresh">自动刷新 · 60s</div>
          </div>
          ${tokenPanel}
        </article>`).join("")
    : `<article class="deepseek-balance-card">
        <div class="deepseek-balance-metric deepseek-wallet-metric">
          <div class="deepseek-wallet-heading">
            <span>可用余额</span>
            <small>Available balance</small>
          </div>
          <div class="deepseek-wallet-balance">
            <strong><span>¥</span>--</strong>
          </div>
          <div class="deepseek-wallet-art">${walletIcon}</div>
          <div class="deepseek-health-pill inactive"><i></i>${deepseekStatusText}</div>
          <div class="deepseek-auto-refresh">
            ${deepseek.configured ? "余额暂不可用，请检查 API 配置" : "请先在设置中配置 DeepSeek API Key"}
          </div>
        </div>
        ${tokenPanel}
      </article>`;
  const deepseekFooter = `
    <div class="deepseek-panel-footer ${deepseekActive ? "" : "inactive"}">
      <span></span>Status: API ${deepseekActive ? "active" : "inactive"} · Last sync ${relativeUpdatedAt(deepseek.updatedAt)}
    </div>`;
  return `
    <div data-module-id="codex" ${moduleHealthAttributes("codex")}>
    <div class="codex-page-header">
      <h1>剩余用量</h1>
    </div>
    <section class="codex-usage-panel">
      <div class="codex-panel-title">
        <div>${codexIcon}<h2>Codex Usage</h2></div>
        <span class="codex-update">${relativeUpdatedAt(statusData.codex.updatedAt)}</span>
      </div>
      <div class="usage-window-grid">
        ${usageWindowCard("5-hour window", fiveHour)}
        ${usageWindowCard("7-day window", sevenDay)}
      </div>
      <div class="codex-cli-status"><span></span>Status: Codex CLI ${statusData.codex.status === "Unavailable" ? "unavailable" : "active"}</div>
    </section>
    <section class="codex-usage-panel deepseek-usage-panel">
      <div class="codex-panel-title">
        <div><span class="deepseek-mark" aria-hidden="true"></span><h2>DeepSeek Balance</h2></div>
        <span class="codex-update">${relativeUpdatedAt(deepseek.updatedAt)}</span>
      </div>
      <div class="usage-window-grid deepseek-balance-grid">${balanceCards}</div>
      ${deepseekFooter}
    </section></div>`;
}

function renderMain() {
  const previousMainContent = document.querySelector(".main-content");
  const previousScrollPosition = previousMainContent
    ? { top: previousMainContent.scrollTop, left: previousMainContent.scrollLeft }
    : null;
  document.body.className = `main-body platform-${isMac ? "darwin" : "win32"}`;
  applyMainTheme();
  const sections = [
    "Dashboard",
    ...window.WinPlateModuleRegistry.modulesForView("detail", appSettings.modules)
      .map((module) => module.section)
      .filter(Boolean)
  ];
  if (currentSection !== "Dashboard" && currentSection !== "Settings" && !sections.includes(currentSection)) {
    currentSection = "Dashboard";
  }
  appRoot.innerHTML = `
    <div class="main-window-shell">
      ${isMac ? "" : `<header class="app-titlebar">
        <div class="titlebar-brand"><img src="../../assets/icon.png" alt=""></div>
        <div class="titlebar-drag-region" aria-hidden="true"></div>
        <div class="titlebar-weather" id="titlebar-weather">${titlebarWeatherContent()}</div>
        <div class="titlebar-clock">
          <time class="system-clock" id="system-clock">
            <span class="system-date"></span>
            <span class="system-time"></span>
          </time>
        </div>
        <div class="window-controls">
          <button id="window-minimize" aria-label="最小化"><span></span></button>
          <button id="window-maximize" aria-label="${mainWindowMaximized ? "还原" : "最大化"}"><span class="${mainWindowMaximized ? "restore-icon" : ""}"></span></button>
          <button id="window-close" class="close" aria-label="关闭"><span></span></button>
        </div>
      </header>`}
      <div class="workspace ${sidebarCollapsed ? "sidebar-collapsed" : ""}">
        <aside class="sidebar">
          <div class="sidebar-top">
            <div class="sidebar-brand-row">
              <div class="sidebar-brand"><span>WinPlate</span></div>
              <button class="sidebar-toggle" id="sidebar-toggle" type="button" aria-label="${sidebarCollapsed ? "展开侧栏" : "关闭边栏"}" aria-expanded="${!sidebarCollapsed}" data-tooltip="${sidebarCollapsed ? "展开边栏" : "关闭边栏"}">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="4.5" y="4.5" width="15" height="15" rx="4"></rect>
                  <path d="M10 5v14"></path>
                </svg>
              </button>
            </div>
          </div>
          <nav>${sections.map((item) => `<button class="${item === currentSection ? "active" : ""}" data-section="${item}" title="${item}"><i>${item === "Dashboard" ? dashboardIcon : item === "GitHub" ? githubIcon : item === "Codex" ? codexIcon : item === "Mail" ? mailIcon : item === "Notifications" ? notificationIcon : item === "Heart" ? "♥" : item === "QWeather" ? qweatherNavIcon : "⚙"}</i><span class="nav-label">${item}</span></button>`).join("")}</nav>
          <div class="sidebar-footer">
            <button class="sidebar-settings ${currentSection === "Settings" ? "active" : ""}" data-section="Settings" title="Settings" aria-label="设置">
              <i>${settingsNavIcon}</i>
              <span class="nav-label">设置</span>
            </button>
          </div>
        </aside>
        <main class="main-content">
          <section id="page-content">${dashboardContent(currentSection)}</section>
        </main>
      </div>
      <div class="refresh-notice-region" id="refresh-notice-region" aria-live="polite" aria-atomic="true"></div>`;
  updateProgressBars(appRoot);
  bindWeatherIconFallbacks(appRoot);
  if (previousScrollPosition) {
    document.querySelector(".main-content").scrollTo(previousScrollPosition);
  }

  document.querySelectorAll("[data-section]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-section].active").forEach((activeButton) => activeButton.classList.remove("active"));
      button.classList.add("active");
      currentSection = button.dataset.section;
      document.querySelector("#page-content").innerHTML = dashboardContent(button.dataset.section);
      updateProgressBars(document.querySelector("#page-content"));
      bindThemeControls();
      bindApplicationSettingsControls();
      bindProductSettings();
      bindWeatherSettings();
      bindWeatherLocationSettings();
      bindDeepSeekSettings();
      bindGithubControls();
      bindQWeatherUsageControls();
      bindMailControls();
      bindNotificationControls();
    });
  });
  const pageContent = document.querySelector("#page-content");
  pageContent.onclick = (event) => {
    const contributionButton = event.target.closest("[data-contribution-date]");
    if (contributionButton && pageContent.contains(contributionButton)) {
      const contributionDate = contributionButton.dataset.contributionDate;
      selectedContributionDate = selectedContributionDate === contributionDate ? null : contributionDate;
      updateMainStatusDom("github");
      return;
    }
    const todayButton = event.target.closest("[data-month-today]");
    if (todayButton && pageContent.contains(todayButton)) {
      const months = githubContributionMonths(normalizeGithub(statusData.github));
      selectedContributionMonth = months.at(-1)?.key || null;
      selectedContributionDate = null;
      pageContent.innerHTML = dashboardContent(currentSection);
      bindGithubControls();
      return;
    }
    const monthButton = event.target.closest("[data-month-direction]");
    if (!monthButton || !pageContent.contains(monthButton) || monthButton.disabled) return;
    changeGithubContributionMonth(Number(monthButton.dataset.monthDirection));
  };
  bindThemeControls();
  bindApplicationSettingsControls();
  bindProductSettings();
  bindWeatherSettings();
  bindWeatherLocationSettings();
  bindDeepSeekSettings();
  bindGithubControls();
  bindQWeatherUsageControls();
  bindMailControls();
  bindNotificationControls();
  document.querySelector("#window-minimize")?.addEventListener("click", () => window.winplate.minimizeWindow());
  document.querySelector("#sidebar-toggle")?.addEventListener("click", () => {
    sidebarCollapsed = !sidebarCollapsed;
    const workspace = document.querySelector(".workspace");
    workspace.classList.toggle("sidebar-collapsed", sidebarCollapsed);
    const toggle = document.querySelector("#sidebar-toggle");
    toggle.setAttribute("aria-label", sidebarCollapsed ? "展开侧栏" : "关闭边栏");
    toggle.setAttribute("aria-expanded", String(!sidebarCollapsed));
    toggle.dataset.tooltip = sidebarCollapsed ? "展开边栏" : "关闭边栏";
  });
  document.querySelector("#window-maximize")?.addEventListener("click", async () => {
    mainWindowMaximized = await window.winplate.toggleMaximizeWindow();
    updateMaximizeButton();
  });
  document.querySelector("#window-close")?.addEventListener("click", () => window.winplate.closeWindow());
  startSystemClock();
}

function syncRequestedModuleNodes(currentRoot, desiredRoot, moduleIds) {
  return window.WinPlateModuleDom.syncRequestedModuleNodes(
    currentRoot,
    desiredRoot,
    moduleIds,
    syncDomNode
  );
}

function updateModuleHealthDom(moduleIds) {
  (Array.isArray(moduleIds) ? moduleIds : [moduleIds]).forEach((id) => {
    const health = moduleHealth[id];
    if (!health) return;
    document.querySelectorAll(`[data-module-id="${id}"]`).forEach((node) => {
      node.dataset.moduleHealth = health.state;
      node.dataset.moduleError = health.error || "";
      node.setAttribute("aria-busy", String(health.state === "loading"));
    });
  });
}

function updateMainStatusDom(moduleIds = null) {
  const requested = moduleIds ? (Array.isArray(moduleIds) ? moduleIds : [moduleIds]) : [];
  if (requested.includes("weather")) updateTitlebarWeather();
  const pageContent = document.querySelector("#page-content");
  if (!pageContent) {
    renderMain();
    return;
  }
  if (currentSection === "Settings") return;
  const template = document.createElement("template");
  template.innerHTML = dashboardContent(currentSection).trim();
  const desiredChildren = Array.from(template.content.childNodes);
  const currentChildren = Array.from(pageContent.childNodes);

  if (moduleIds) {
    const structureChanged = syncRequestedModuleNodes(pageContent, template.content, requested);
    if (structureChanged) {
      bindAvatarFallbacks(pageContent);
      bindWeatherIconFallbacks(pageContent);
      if (requested.includes("github")) bindGithubControls();
      if (requested.includes("weather")) bindQWeatherUsageControls();
      if (requested.includes("mail")) bindMailControls();
      if (requested.includes("notifications")) bindNotificationControls();
    }
    updateProgressBars(pageContent);
    updateModuleHealthDom(requested);
    return;
  }

  if (currentChildren.length !== desiredChildren.length) {
    const mainContent = document.querySelector(".main-content");
    const scrollPosition = mainContent
      ? { top: mainContent.scrollTop, left: mainContent.scrollLeft }
      : null;
    pageContent.replaceChildren(...desiredChildren.map((node) => node.cloneNode(true)));
    if (scrollPosition) mainContent.scrollTo(scrollPosition);
    bindAvatarFallbacks(pageContent);
    bindWeatherIconFallbacks(pageContent);
    bindGithubControls();
    bindQWeatherUsageControls();
    bindMailControls();
    bindNotificationControls();
    updateProgressBars(pageContent);
    return;
  }

  let structureChanged = false;
  for (let index = 0; index < currentChildren.length; index += 1) {
    const currentChild = currentChildren[index];
    const desiredChild = desiredChildren[index];
    if (canSyncNode(currentChild, desiredChild)) {
      structureChanged = syncDomNode(currentChild, desiredChild) || structureChanged;
    } else {
      currentChild.replaceWith(desiredChild.cloneNode(true));
      structureChanged = true;
    }
  }
  if (structureChanged) {
    bindAvatarFallbacks(pageContent);
    bindWeatherIconFallbacks(pageContent);
    bindGithubControls();
    bindQWeatherUsageControls();
    bindMailControls();
    bindNotificationControls();
  }
  updateProgressBars(pageContent);
}

function updateFloatingStatusDom(moduleIds = null) {
  const shell = document.querySelector("#floating-shell");
  if (!shell) {
    renderFloating();
    return;
  }
  const template = document.createElement("template");
  const weather = statusData.weather || mockStatus.weather;
  template.innerHTML = `
    <main class="floating-shell" id="floating-shell" aria-label="WinPlate status">
      <section class="status-capsule">
        <div class="status-layout">
          <div class="status-group app-status">
            <div class="module interactive-module github-module no-drag" id="github-module" data-module-id="github" ${moduleHealthAttributes("github")} ${moduleEnabled("github") ? "" : "hidden"} role="link" tabindex="0" aria-label="Open GitHub section">
              <span class="github-avatar-button" aria-hidden="true">${avatarMarkup(statusData.github, "github-avatar-bar")}</span>
              <span class="github-summary">GitHub</span>
            </div>
            <div class="module interactive-module codex-module no-drag" data-module-id="codex" ${moduleHealthAttributes("codex")} ${moduleEnabled("codex") ? "" : "hidden"}>
              ${codexIcon}<span class="module-label">Codex</span>
              ${progressBar(statusData.codex.remainingPct, "usage-track")}
              <strong class="metric">${statusData.codex.remainingPct ?? "--"}%</strong>
              ${quotaStatusLamp(statusData.codex.remainingPct)}
              <span class="metric reset">${statusData.codex.resetClock || statusData.codex.resetText || "--:--"}</span>
            </div>
          </div>
          <div class="status-group notification-status" data-module-id="notifications" ${moduleHealthAttributes("notifications")} ${moduleEnabled("notifications") ? "" : "hidden"}>
            ${notificationStrip()}
          </div>
          <div class="status-group auxiliary-status">
            <div class="module interactive-module weather-module no-drag" id="weather-module" data-module-id="weather" ${moduleHealthAttributes("weather")} ${moduleEnabled("weather") ? "" : "hidden"}>
              ${weatherIconMarkup(weather.icon)}
              <strong class="metric">${weather.temperature}°C</strong>
              <span class="weather-condition">${weather.condition}</span>
            </div>
            <div class="system-status">
              <div class="module interactive-module heart-module no-drag" id="heart-module" data-module-id="heart" ${moduleHealthAttributes("heart")} ${moduleEnabled("heart") ? "" : "hidden"}>
                <span class="heart-icon">♥</span><strong class="metric">${statusData.heart.heartRate ?? "--"}</strong>
              </div>
              <div class="module interactive-module network-module no-drag" id="network-module" data-module-id="network" ${moduleHealthAttributes("network")} ${moduleEnabled("network") ? "" : "hidden"}>
                <span class="network-speed">${networkSpeedMarkup()}</span>
              </div>
              <div class="right-controls no-drag">${shell.querySelector(".right-controls")?.innerHTML || ""}</div>
            </div>
          </div>
        </div>
      </section>
    </main>`;
  const desiredShell = template.content.firstElementChild;
  if (moduleIds) {
    const requested = Array.isArray(moduleIds) ? moduleIds : [moduleIds];
    syncRequestedModuleNodes(shell, desiredShell, requested);
    updateModuleHealthDom(requested);
  } else {
    syncDomNode(shell, desiredShell);
  }
  updateProgressBars(shell);
  bindAvatarFallbacks(shell);
  bindNotificationStrip();
}

async function refreshNetworkSpeed() {
  if (view === "tooltip" || !window.winplate?.getNetworkSpeed) {
    return;
  }
  try {
    networkSpeed = {
      ...networkSpeed,
      ...await window.winplate.getNetworkSpeed()
    };
  } catch (error) {
    networkSpeed = {
      downloadBytesPerSecond: null,
      uploadBytesPerSecond: null,
      latencyMs: null,
      status: "获取失败",
      error: error.message,
      updatedAt: Date.now()
    };
  }
  if (view === "floating") {
    const label = document.querySelector("#network-module .network-speed");
    if (label) {
      label.innerHTML = networkSpeedMarkup();
    }
    const module = document.querySelector("#network-module");
    syncNetworkModuleState(module);
  }
}

function bindQWeatherUsageControls() {
  bindWeatherLocationControls();
  const button = document.querySelector("#qweather-verify");
  if (!button) return;
  button.onclick = async () => {
    button.disabled = true;
    button.classList.add("refreshing");
    button.querySelector("span:last-child").textContent = "刷新中";
    qweatherUsageMessage = "";
    try {
      qweatherOfficialStats = await window.winplate.refreshQWeatherOfficialStats();
      qweatherOfficialStatus = "configured";
    } catch (error) {
      qweatherOfficialStats = null;
      qweatherUsageMessage = `校验失败：${error.message}`;
      qweatherOfficialStatus = /权限|401|403|凭据无效/.test(error.message) ? "permission" : "failed";
    }
    updateMainStatusDom();
  };
}

function bindWeatherLocationControls() {
  const provinceSelect = document.querySelector("#weather-province-select");
  const citySelect = document.querySelector("#weather-city-select");
  if (!provinceSelect || !citySelect) return;
  const applySelection = async (cityId) => {
    const option = WEATHER_LOCATION_REGIONS.flatMap((region) => region.cities).find((item) => item.id === cityId)
      || WEATHER_LOCATION_REGIONS[0].cities[0];
    weatherLocationPreference = option.id;
    if (option.id === "auto") {
      localStorage.removeItem(WEATHER_LOCATION_STORAGE_KEY);
    } else {
      localStorage.setItem(WEATHER_LOCATION_STORAGE_KEY, option.id);
    }
    provinceSelect.disabled = true;
    citySelect.disabled = true;
    locationWeatherPromise = null;
    try {
      await refreshSelectedWeatherLocation({ force: true });
      await refreshQWeatherAlerts();
      await hydrateNotifications();
    } catch (error) {
      console.warn("Selected weather location unavailable:", error.message);
    } finally {
      provinceSelect.disabled = false;
      citySelect.disabled = false;
      updateMainStatusDom();
    }
  };
  provinceSelect.onchange = async () => {
    const region = WEATHER_LOCATION_REGIONS.find((item) => item.id === provinceSelect.value) || WEATHER_LOCATION_REGIONS[0];
    await applySelection(region.cities[0]?.id || "auto");
  };
  citySelect.onchange = async () => {
    await applySelection(citySelect.value);
  };
}

async function refreshSelectedWeatherLocation({ force = false, allowSystem = false } = {}) {
  const option = selectedWeatherLocationOption();
  if (!force && locationWeatherPromise) {
    return locationWeatherPromise;
  }
  if (allowSystem) {
    if (!navigator.geolocation) return null;
    locationWeatherPromise = new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: false,
        timeout: 10_000,
        maximumAge: 30 * 60_000
      });
    }).then(({ coords }) => window.winplate.setWeatherLocation({
      latitude: coords.latitude,
      longitude: coords.longitude
    })).catch((error) => {
      console.warn("System weather location unavailable:", error.message);
      return null;
    });
    const locatedWeather = await locationWeatherPromise;
    if (locatedWeather) {
      statusData.weather = { ...statusData.weather, ...locatedWeather };
    }
    return locatedWeather;
  }
  if (option.id !== "auto") {
    locationWeatherPromise = window.winplate.setWeatherLocation({
      latitude: option.latitude,
      longitude: option.longitude
    });
    const locatedWeather = await locationWeatherPromise;
    if (locatedWeather) {
      statusData.weather = { ...statusData.weather, ...locatedWeather };
    }
    return locatedWeather;
  }
  return null;
}

function bindMailControls() {
  const pageContent = document.querySelector("#page-content");
  if (pageContent && !pageContent.dataset.mailDelegationBound) {
    pageContent.dataset.mailDelegationBound = "true";
    pageContent.addEventListener("click", handleMailPageClick);
  }
  const form = document.querySelector("#mail-settings-form");
  if (form) {
    const addressInput = form.querySelector("#qq-mail-address");
    const authCodeInput = form.querySelector("#qq-mail-auth-code");
    const autoRefreshInput = form.querySelector("#qq-mail-auto-refresh-seconds");
    const mailStatus = form.querySelector("#mail-settings-status");
    const connectionStatus = form.querySelector("#mail-connection-status");
    const autoRefreshStatus = form.querySelector("#mail-auto-refresh-status");
    const saveButton = form.querySelector("button[type='submit']");
    const setMailSettingsStatus = (message, className = "") => {
      mailStatus.textContent = `QQ 邮箱配置：${message}`;
      mailStatus.className = className;
      connectionStatus.textContent = `IMAP：${mailSettings.connected ? "已连接" : "未连接"}`;
      connectionStatus.className = mailSettings.connected ? "configured" : "";
      autoRefreshStatus.textContent = `自动同步：每 ${mailAutoRefreshLabel()}`;
    };
    form.onsubmit = async (event) => {
      event.preventDefault();
      saveButton.disabled = true;
      setMailSettingsStatus("正在保存...");
      try {
        const nextMailAutoRefreshSeconds = normalizeMailAutoRefreshSeconds(autoRefreshInput.value);
        mailSettings = await window.winplate.saveMailSettings({
          address: addressInput.value,
          authCode: authCodeInput.value
        });
        mailAutoRefreshSeconds = nextMailAutoRefreshSeconds;
        appSettings.modules.refreshSeconds.mail = mailAutoRefreshSeconds;
        await window.winplate.saveAppearanceSettings({
          theme: themePreference,
          mailAutoRefreshSeconds
        });
        startMailAutoRefreshTimer();
        addressInput.value = mailSettings.address || "";
        authCodeInput.value = "";
        authCodeInput.placeholder = "已配置，重新填写可覆盖";
        autoRefreshInput.value = String(mailAutoRefreshSeconds);
        mailOutline = await window.winplate.getMailOutline();
        setMailSettingsStatus("已配置", "configured");
      } catch (error) {
        setMailSettingsStatus(error.message || "保存失败", "error");
      } finally {
        saveButton.disabled = false;
        updateMainStatusDom();
      }
    };
  }
  const connectButtons = document.querySelectorAll("#connect-mail, #settings-connect-mail");
  connectButtons.forEach((button) => {
    button.onclick = async () => {
      button.disabled = true;
      try {
        await window.winplate.connectMail();
        mailSettings = await window.winplate.getMailSettings();
      } catch (error) {
        mailOutline = {
          ...mailOutline,
          availability: "unavailable",
          error: error.message || "QQ 邮箱连接失败"
        };
      } finally {
        button.disabled = false;
        updateMainStatusDom();
      }
    };
  });
  const refreshButton = document.querySelector("#refresh-mail");
  if (!refreshButton) return;
  refreshButton.onclick = async () => {
    if (mailRefreshInFlight) return;
    mailRefreshInFlight = true;
    try {
      updateMainStatusDom();
      const refreshed = await withRendererRefreshTimeout((async () => {
        const outline = await refreshLocalJson("/api/mail/refresh", "邮件刷新");
        return { outline };
      })(), "邮件刷新");
      mailOutline = refreshed.outline;
      showRefreshNotice("success", "邮件刷新成功", "邮件大纲已更新。");
      hydrateNotifications().then(() => {
        updateCurrentViewDom("notifications");
      });
    } catch (error) {
      const message = error.message || "邮件刷新失败";
      mailOutline = {
        ...mailOutline,
        availability: "unavailable",
        error: message
      };
      showRefreshNotice("error", "邮件刷新失败", message);
    } finally {
      mailRefreshInFlight = false;
      resetRefreshButton("#refresh-mail");
      updateMainStatusDom();
    }
  };
}

async function openMailDetail(uid, triggerButton = null) {
  if (!uid || mailDetail.loading) return;
  if (triggerButton) triggerButton.disabled = true;
  const requestId = `${uid}:${Date.now()}`;
  mailHighlightedUid = uid;
  mailDetail = { open: true, loading: true, uid, requestId, message: null, error: "" };
  updateMainStatusDom();
  try {
    const message = await readMailMessageWithFallback(uid);
    if (mailDetail.requestId !== requestId) return;
    mailDetail = { open: true, loading: false, uid, requestId, message, error: "" };
    mailOutline = {
      ...mailOutline,
      items: (mailOutline.items || []).map((item) => {
        const itemUid = item.uid || item.messageId || item.threadId;
        if (String(itemUid) !== String(uid)) return item;
        const labels = Array.isArray(item.labels) ? item.labels.filter((label) => label !== "UNREAD") : [];
        return {
          ...item,
          labels,
          unread: false,
          action: message.action || "归档参考"
        };
      })
    };
    updateMainStatusDom();
    syncMailReadStateInBackground(uid, requestId);
  } catch (error) {
    if (mailDetail.requestId !== requestId) return;
    mailDetail = {
      open: true,
      loading: false,
      uid,
      requestId,
      message: null,
      error: error.message || "邮件正文加载失败"
    };
  } finally {
    if (triggerButton) triggerButton.disabled = false;
    updateMainStatusDom();
  }
}

async function handleMailPageClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target || !target.closest(".mail-page")) return;

  if (target.closest(".mail-detail-close")) {
    mailDetail = { open: false, loading: false, uid: null, message: null, error: "" };
    updateMainStatusDom();
    return;
  }

  const externalButton = target.closest(".mail-open-external-button");
  if (externalButton) {
    externalButton.disabled = true;
    try {
      await window.winplate.openMail();
    } catch (error) {
      console.error("Failed to open QQ mail:", error);
    } finally {
      externalButton.disabled = false;
    }
    return;
  }

  const openButton = target.closest(".mail-open-button");
  if (openButton) {
    await openMailDetail(openButton.dataset.mailUid || "", openButton);
  }
}

async function copyTextToClipboard(text) {
  const value = String(text || "");
  if (!value) return;
  if (window.winplate?.copyNotificationText) {
    await window.winplate.copyNotificationText(value);
    return;
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

async function openNotificationDetail(notificationId) {
  const id = String(notificationId || "").trim();
  if (!id) return;
  notificationDrawerState = { ...notificationDrawerState, open: true, mode: "detail" };
  notificationDetail = { open: true, loading: true, id, data: null, error: "" };
  notificationActionFeedback = "";
  updateMainStatusDom();
  focusNotificationDrawerControl(".notification-detail-back");
  try {
    const payload = await window.winplate.getNotificationDetail(id);
    notificationDetail = { open: true, loading: false, id, data: payload, error: "" };
    if (payload?.notification?.unread) {
      try {
        await markNotificationRead(id, { feedback: "已标记为已读" });
      } catch (error) {
        console.warn("Failed to mark opened notification read:", error);
        notificationActionFeedback = "已查看，但标记已读失败";
      }
    }
  } catch (error) {
    notificationDetail = {
      open: true,
      loading: false,
      id,
      data: null,
      error: error.message || "通知详情加载失败"
    };
  }
  updateMainStatusDom();
  focusNotificationDrawerControl(".notification-detail-back");
}

function openNotificationDigestDrawer(trigger = null) {
  notificationDrawerState = { open: true, mode: "list", returnFocus: trigger };
  notificationDetail = { open: false, loading: false, id: null, data: null, error: "" };
}

function focusNotificationDrawerControl(selector) {
  queueMicrotask(() => document.querySelector(selector)?.focus?.());
}

function showNotificationDrawerList() {
  notificationDrawerState = { ...notificationDrawerState, open: true, mode: "list" };
}

function closeNotificationDrawer(options = null) {
  const { restoreFocus = true } = options || {};
  const returnFocus = notificationDrawerState.returnFocus;
  notificationDrawerState = { open: false, mode: "list", returnFocus: null };
  notificationDetail = { open: false, loading: false, id: null, data: null, error: "" };
  notificationActionFeedback = "";
  if (restoreFocus) queueMicrotask(() => returnFocus?.focus?.());
}

function closeNotificationDetail() {
  closeNotificationDrawer();
}

async function markNotificationRead(notificationId, options = null) {
  const { returnToList = false, feedback = "已标记为已读" } = options || {};
  const id = String(notificationId || "").trim();
  if (!id) return;
  notificationSummary = await window.winplate.markNotificationRead(id);
  if (notificationDetail.data?.notification?.id === id) {
    notificationDetail = {
      ...notificationDetail,
      data: {
        ...notificationDetail.data,
        notification: {
          ...notificationDetail.data.notification,
          unread: false
        },
        actions: notificationDetail.data.actions.map((entry) => (
          entry.type === "markRead"
            ? { ...entry, label: "已读" }
            : entry
        ))
      }
    };
  }
  await hydrateNotificationDigest();
  notificationActionFeedback = feedback;
  const representedItems = window.WinPlateNotificationDigest.selectDigestItems(
    notificationDigest,
    notificationItemsForDigest()
  );
  if (returnToList && representedItems.length) {
    showNotificationDrawerList();
  }
  updateMainStatusDom();
  if (notificationDrawerState.mode === "list") focusNotificationDrawerControl(".notification-detail-close");
}

async function handleNotificationAction(actionId) {
  const actions = Array.isArray(notificationDetail.data?.actions) ? notificationDetail.data.actions : [];
  const action = actions.find((entry) => entry.id === actionId);
  if (!action) return;
  if (action.type === "copy") {
    await copyTextToClipboard(action.payload?.text || "");
    notificationActionFeedback = "内容已复制到剪贴板";
    return;
  }
  if (action.type === "markRead") {
    await markNotificationRead(
      action.payload?.notificationId || notificationDetail.id,
      { returnToList: true }
    );
    return;
  }
  if (action.type === "navigate") {
    await window.winplate.navigateNotification(action);
  }
}

function bindNotificationControls() {
  const pageContent = document.querySelector("#page-content");
  if (pageContent && !pageContent.dataset.notificationDelegationBound) {
    pageContent.dataset.notificationDelegationBound = "true";
    pageContent.addEventListener("click", handleNotificationPageClick);
    pageContent.addEventListener("keydown", handleNotificationPageKeydown);
  }
  const rawSection = document.querySelector(".notification-raw-section");
  if (rawSection) {
    notificationRawExpanded = rawSection.open;
    rawSection.ontoggle = () => {
      notificationRawExpanded = rawSection.open;
    };
  }
  const markAllButton = document.querySelector("#mark-all-notifications-read");
  if (markAllButton) {
    markAllButton.onclick = async () => {
      if (notificationActionInFlight) return;
      notificationActionInFlight = true;
      markAllButton.disabled = true;
      try {
        notificationSummary = await window.winplate.markAllNotificationsRead();
        await hydrateNotificationDigest();
      } catch (error) {
        console.error("Failed to mark notifications read:", error);
      } finally {
        notificationActionInFlight = false;
        updateMainStatusDom();
      }
    };
  }
  const clearButton = document.querySelector("#clear-notifications");
  if (clearButton) {
    clearButton.onclick = async () => {
      if (notificationActionInFlight || clearButton.disabled) return;
      notificationActionInFlight = true;
      clearButton.disabled = true;
      try {
        notificationSummary = await window.winplate.clearNotifications();
        await hydrateNotificationDigest();
      } catch (error) {
        console.error("Failed to clear notifications:", error);
      } finally {
        notificationActionInFlight = false;
        updateMainStatusDom();
      }
    };
  }
  const testButton = document.querySelector("#push-test-notification");
  if (testButton) {
    testButton.onclick = async () => {
      if (notificationActionInFlight) return;
      notificationActionInFlight = true;
      testButton.disabled = true;
      try {
        notificationSummary = await window.winplate.pushTestNotification();
        await hydrateNotificationDigest();
      } catch (error) {
        console.error("Failed to push test notification:", error);
      } finally {
        notificationActionInFlight = false;
        updateMainStatusDom();
      }
    };
  }
}

function handleNotificationPageKeydown(event) {
  if (event.key !== "Enter" && event.key !== " ") return;
  const target = event.target instanceof Element ? event.target : null;
  const trigger = target?.closest("[data-notification-digest-open]");
  if (!trigger) return;
  event.preventDefault();
  openNotificationDigestDrawer(trigger);
  updateMainStatusDom();
  focusNotificationDrawerControl(".notification-detail-close");
}

async function handleNotificationPageClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target || !target.closest(".notifications-page")) return;

  const readButton = target.closest("[data-notification-read]");
  if (readButton) {
    event.stopPropagation();
    if (notificationActionInFlight || readButton.disabled) return;
    notificationActionInFlight = true;
    readButton.disabled = true;
    try {
      notificationSummary = await window.winplate.markNotificationRead(readButton.dataset.notificationRead);
      await hydrateNotificationDigest();
    } catch (error) {
      console.error("Failed to mark notification read:", error);
    } finally {
      notificationActionInFlight = false;
      updateMainStatusDom();
    }
    return;
  }

  const actionButton = target.closest("[data-notification-action-id]");
  if (actionButton) {
    if (notificationActionInFlight || actionButton.disabled) return;
    notificationActionInFlight = true;
    actionButton.disabled = true;
    try {
      await handleNotificationAction(actionButton.dataset.notificationActionId);
    } catch (error) {
      console.error("Failed to execute notification action:", error);
    } finally {
      notificationActionInFlight = false;
      updateMainStatusDom();
    }
    return;
  }

  if (target.closest(".notification-detail-close")) {
    closeNotificationDetail();
    updateMainStatusDom();
    return;
  }

  const retryButton = target.closest("[data-notification-detail-retry]");
  if (retryButton) {
    if (!notificationActionInFlight) await openNotificationDetail(retryButton.dataset.notificationDetailRetry);
    return;
  }

  if (target.closest(".notification-detail-back")) {
    showNotificationDrawerList();
    updateMainStatusDom();
    focusNotificationDrawerControl(".notification-detail-close");
    return;
  }

  const drawerItem = target.closest("[data-notification-drawer-item]");
  if (drawerItem) {
    if (!notificationActionInFlight) await openNotificationDetail(drawerItem.dataset.notificationDrawerItem);
    return;
  }

  const notificationCard = target.closest("[data-notification-open]");
  if (notificationCard) {
    if (!notificationActionInFlight) await openNotificationDetail(notificationCard.dataset.notificationOpen);
    return;
  }

  const digestTrigger = target.closest("[data-notification-digest-open]");
  if (digestTrigger) {
    openNotificationDigestDrawer(digestTrigger);
    updateMainStatusDom();
    focusNotificationDrawerControl(".notification-detail-close");
  }
}

function handleNotificationDocumentKeydown(event) {
  if (event.key !== "Escape" || !notificationDrawerState.open) return;
  event.preventDefault();
  closeNotificationDrawer();
  updateMainStatusDom();
}

async function hydrateQWeatherUsage() {
  if (view !== "main") return;
  try {
    qweatherUsage = await window.winplate.getQWeatherUsage();
  } catch (error) {
    qweatherUsageMessage = `本地用量读取失败：${error.message}`;
  }
}

async function hydrateNotifications() {
  try {
    notificationSummary = await window.winplate.getNotifications();
    await hydrateNotificationDigest();
  } catch (error) {
    notificationSummary = {
      ...notificationSummary,
      latest: null,
      unreadCount: 0,
      items: [],
      error: error.message || "通知读取失败"
    };
  }
}

async function hydrateNotificationDigest() {
  if (!window.winplate?.getNotificationDigest) return;
  try {
    notificationDigest = await window.winplate.getNotificationDigest();
  } catch (error) {
    console.warn("Notification digest unavailable; keeping local state:", error.message);
  }
}

function updateCurrentViewDom(moduleIds = null) {
  if (view === "floating") updateFloatingStatusDom(moduleIds);
  else updateMainStatusDom(moduleIds);
}

function startMailAutoRefreshTimer() {
  if (view === "tooltip") return;
  if (refreshController.has("mail")) {
    refreshController.configure("mail", {
      intervalMs: moduleEnabled("mail") ? normalizeMailAutoRefreshSeconds(mailAutoRefreshSeconds) * 1000 : 0
    });
  }
}

async function refreshQWeatherAlerts() {
  try {
    weatherAlerts = normalizeWeatherAlerts(await window.winplate.refreshQWeatherAlerts());
  } catch (error) {
    weatherAlerts = {
      ...weatherAlerts,
      error: error.message || "天气预警读取失败"
    };
    console.warn("QWeather alerts unavailable:", error.message);
  }
}

async function hydrateWeatherAlerts() {
  if (!window.winplate?.getQWeatherAlerts) return weatherAlerts;
  try {
    weatherAlerts = normalizeWeatherAlerts(await window.winplate.getQWeatherAlerts());
  } catch (error) {
    weatherAlerts = {
      ...weatherAlerts,
      error: error.message || "天气预警读取失败"
    };
  }
  return weatherAlerts;
}

async function hydrateMail(options = {}) {
  if (view === "tooltip") return;
  const force = Boolean(options?.force);
  try {
    mailSettings = await window.winplate.getMailSettings();
    mailOutline = force && mailSettings.configured
      ? await window.winplate.refreshMailOutline()
      : await window.winplate.getMailOutline();
  } catch (error) {
    mailOutline = {
      ...mailOutline,
      availability: "unavailable",
      error: error.message || "邮件大纲读取失败"
    };
  }
}

function changeGithubContributionMonth(direction) {
  const months = githubContributionMonths(normalizeGithub(statusData.github));
  const currentIndex = months.findIndex((month) => month.key === selectedContributionMonth);
  const safeIndex = currentIndex >= 0 ? currentIndex : months.length - 1;
  const nextIndex = Math.max(0, Math.min(months.length - 1, safeIndex + direction));
  if (nextIndex === safeIndex) return;
  selectedContributionMonth = months[nextIndex].key;
  selectedContributionDate = null;
  githubContributionRequestId += 1;
  updateMainStatusDom();
}

function bindGithubControls() {
  document.querySelectorAll("[data-open-github]").forEach((button) => {
    button.onclick = () => window.winplate.openGithubProfile(statusData.github.profileUrl);
  });
  const months = githubContributionMonths(normalizeGithub(statusData.github));
  const selectedMonth = months.find((month) => month.key === selectedContributionMonth) || months.at(-1);
  if (selectedMonth) {
    const fallback = githubContributionFallback(selectedMonth, selectedContributionDate);
    const range = selectedContributionDate ? { date: selectedContributionDate } : { month: selectedMonth.key };
    loadGithubContributionActivity(range, fallback);
  }
  const refreshButton = document.querySelector("#refresh-github");
  if (!refreshButton) return;
  refreshButton.onclick = async () => {
    if (githubRefreshInFlight) return;
    selectedContributionDate = null;
    githubContributionRequestId += 1;
    githubContributionDetailCache.clear();
    githubRefreshInFlight = true;
    try {
      updateMainStatusDom();
      await refreshController.refresh("github", { force: true, reason: "button" });
      showRefreshNotice("success", "GitHub 刷新成功", "贡献数据已更新。");
    } catch (error) {
      console.error("GitHub refresh failed:", error);
      statusData.github = normalizeGithub({
        ...statusData.github,
        status: "Cached",
        availability: "unavailable",
        stateMessage: "Refresh failed; showing last known data."
      }, statusData.github);
      showRefreshNotice("error", "GitHub 刷新失败", error.message || "请稍后重试。");
    } finally {
      githubRefreshInFlight = false;
      resetRefreshButton("#refresh-github");
      updateMainStatusDom("github");
    }
  };
}

function updateMaximizeButton() {
  const button = document.querySelector("#window-maximize");
  if (!button) return;
  button.setAttribute("aria-label", mainWindowMaximized ? "还原" : "最大化");
  button.querySelector("span")?.classList.toggle("restore-icon", mainWindowMaximized);
}

async function refreshBackendStatus() {
  const weatherVersionAtRequest = weatherUpdateVersion;
  const incomingStatus = await window.winplate.getStatus();
  const incomingWeather = weatherVersionAtRequest === weatherUpdateVersion
    ? incomingStatus.weather
    : statusData.weather;
  statusData = {
    ...statusData,
    heart: { ...mockStatus.heart, ...statusData.heart, ...incomingStatus.heart },
    weather: { ...mockStatus.weather, ...statusData.weather, ...incomingWeather }
  };
  await hydrateWeatherAlerts();
  await hydrateQWeatherUsage();
  updateCurrentViewDom(["weather", "heart"]);
  if (statusData.weather?.source === "unavailable") {
    throw new Error(statusData.weather.error || "天气服务不可用");
  }
  return incomingStatus;
}

async function refreshGithubData({ force = false } = {}) {
  const github = force
    ? await refreshLocalJson("/api/github/refresh", "GitHub 刷新")
    : (await window.winplate.getStatus()).github;
  statusData.github = normalizeGithub({
    ...github,
    availability: github?.availability || (github?.source === "github" ? "live" : undefined),
    stateMessage: github?.source === "github" ? "" : github?.stateMessage
  }, statusData.github);
  updateCurrentViewDom("github");
  if (statusData.github.availability && statusData.github.availability !== "live") {
    throw new Error(statusData.github.stateMessage || "GitHub 数据不可用");
  }
  return statusData.github;
}

async function refreshCodexData({ force = false } = {}) {
  statusData.codex = {
    ...mockStatus.codex,
    ...statusData.codex,
    ...await window.winplate.getCodexUsage({ force })
  };
  updateCurrentViewDom("codex");
  if (statusData.codex.status === "Unavailable") {
    throw new Error(statusData.codex.error || "Codex 用量不可用");
  }
  return statusData.codex;
}

async function refreshDeepSeekData({ force = false } = {}) {
  statusData.deepseek = {
    ...mockStatus.deepseek,
    ...statusData.deepseek,
    ...await window.winplate.getDeepSeekUsage({ force })
  };
  updateCurrentViewDom("codex");
  return statusData.deepseek;
}

async function refreshMailData({ force = false } = {}) {
  await hydrateMail({ force });
  updateCurrentViewDom("mail");
  hydrateNotifications().then(() => {
    updateCurrentViewDom("notifications");
  });
  if (mailOutline.availability === "unavailable") {
    throw new Error(mailOutline.error || "邮件服务不可用");
  }
  return mailOutline;
}

async function refreshNotificationData() {
  await hydrateNotifications();
  updateCurrentViewDom("notifications");
  return notificationSummary;
}

async function refreshNetworkData() {
  await refreshNetworkSpeed();
  updateModuleHealthDom("network");
  if (["获取失败", "无连接"].includes(networkSpeed.status)) {
    throw new Error(networkSpeed.error || networkSpeed.status);
  }
  return networkSpeed;
}

function registerRefreshTasks() {
  if (refreshController.has("github")) return;
  const loaders = {
    github: refreshGithubData,
    codex: refreshCodexData,
    notifications: refreshNotificationData,
    mail: refreshMailData,
    network: refreshNetworkData
  };
  const moduleLoadContext = {
    load: (id, options) => loaders[id](options),
    render: () => "",
    bind: () => {}
  };
  Object.keys(loaders).forEach((id) => {
    const module = rendererModuleById.get(id);
    refreshController.register({
      id,
      refresh: (options) => module.load(moduleLoadContext, options)
    });
  });
  refreshController.register({ id: "status", refresh: refreshBackendStatus });
  refreshController.register({ id: "deepseek", refresh: refreshDeepSeekData });
}

function configureRefreshTasks() {
  if (!refreshController.has("github")) return;
  refreshController.configure("github", { intervalMs: moduleEnabled("github") ? moduleRefreshSeconds("github") * 1000 : 0 });
  const statusIntervals = ["weather", "heart"]
    .filter(moduleEnabled)
    .map(moduleRefreshSeconds);
  refreshController.configure("status", { intervalMs: statusIntervals.length ? Math.min(...statusIntervals) * 1000 : 0 });
  refreshController.configure("codex", { intervalMs: moduleEnabled("codex") ? moduleRefreshSeconds("codex") * 1000 : 0 });
  refreshController.configure("deepseek", { intervalMs: moduleEnabled("codex") ? 60_000 : 0 });
  refreshController.configure("mail", { intervalMs: moduleEnabled("mail") ? moduleRefreshSeconds("mail") * 1000 : 0 });
  refreshController.configure("notifications", { intervalMs: moduleEnabled("notifications") ? moduleRefreshSeconds("notifications") * 1000 : 0 });
  refreshController.configure("network", { intervalMs: view === "floating" && moduleEnabled("network") ? moduleRefreshSeconds("network") * 1000 : 0 });
}

async function refreshStatus() {
  if (view === "tooltip") return [];
  const ids = [];
  if (moduleEnabled("weather") || moduleEnabled("heart")) ids.push("status");
  if (moduleEnabled("github")) ids.push("github");
  if (moduleEnabled("codex")) ids.push("codex", "deepseek");
  if (moduleEnabled("mail")) ids.push("mail");
  if (moduleEnabled("notifications")) ids.push("notifications");
  const results = await refreshController.refreshAll({ ids, reason: "status" });

  if (view === "floating") {
    updateFloatingStatusDom();
  } else {
    updateMainStatusDom();
  }
}

function applyNavigationPayload(value) {
  const payload = normalizeNavigationPayload(value);
  currentSection = payload.section;
  if (payload.moduleId === "mail" && payload.sourceId) {
    mailHighlightedUid = payload.sourceId;
  }
  if (payload.moduleId === "weather" && payload.sourceId) {
    selectedWeatherAlertId = payload.sourceId;
  }
  return payload;
}

registerRefreshTasks();
document.addEventListener("keydown", handleNotificationDocumentKeydown);
if (view === "main") renderMain();
Promise.all([hydrateAppearanceSettings(), hydrateQWeatherUsage(), hydrateAppSettings()]).then(async () => {
  if (view === "tooltip") return [];
  configureRefreshTasks();
  if (view === "main") renderMain();
  await refreshController.start();
  return refreshStatus();
});
if (view !== "tooltip") {
  window.winplate?.onNotificationDigestUpdated?.((digest) => {
    notificationDigest = digest || notificationDigest;
    updateCurrentViewDom("notifications");
  });
  window.winplate?.onStatusRefresh?.((payload) => {
    if (payload?.weather) {
      weatherUpdateVersion += 1;
      statusData.weather = { ...mockStatus.weather, ...statusData.weather, ...payload.weather };
      updateCurrentViewDom("weather");
      return;
    }
    refreshController.refresh("status", { force: true, reason: "broadcast" }).catch(() => {});
  });
  window.winplate?.onSettingsUpdated?.((settings) => {
    appSettings = settings;
    themePreference = settings.appearance.theme;
    mailAutoRefreshSeconds = normalizeMailAutoRefreshSeconds(settings.modules.refreshSeconds.mail);
    applyMainTheme();
    configureRefreshTasks();
    if (view === "main") renderMain();
    else updateFloatingStatusDom();
  });
} else {
  renderTooltip();
  window.winplate.onTooltipUpdate(renderTooltip);
}

window.winplate.onNavigate(async (payload) => {
  const navigation = applyNavigationPayload(payload);
  if (view === "main") {
    renderMain();
    if (navigation.section === "Notifications") {
      if (navigation.notificationId) {
        await openNotificationDetail(navigation.notificationId);
      } else {
        openNotificationDigestDrawer();
        updateMainStatusDom();
      }
    }
  }
});

window.winplate.onMaximizedChange((value) => {
  mainWindowMaximized = value;
  updateMaximizeButton();
});
