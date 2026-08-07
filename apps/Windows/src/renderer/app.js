function healthTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value < 10_000_000_000 ? value * 1000 : value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function healthMetric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number).toLocaleString() : "--";
}

function healthStateLabel(state) {
  return {
    live: "Connected",
    stale: "Stale",
    waiting: "Waiting for iPhone",
    error: "Unavailable"
  }[state] || "Reading";
}

function applyHealthSyncStatus(payload) {
  healthSyncStatus = payload && typeof payload === "object"
    ? payload
    : { state: "waiting", snapshot: null, connectionUrls: [] };
  const snapshot = healthSyncStatus.snapshot;
  const updatedAt = healthTimestamp(
    snapshot?.healthUpdatedAt || snapshot?.sentAt || healthSyncStatus.lastReceivedAt
  );
  statusData.heart = {
    ...mockStatus.heart,
    heartRate: snapshot?.heartRate ?? null,
    stepCount: snapshot?.stepCount ?? null,
    activeEnergy: snapshot?.activeEnergy ?? null,
    source: snapshot ? `iPhone · ${snapshot.sender || "HealthKit"}` : mockStatus.heart.source,
    updatedAt,
    syncState: healthSyncStatus.state || "waiting"
  };
}

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
      : [],
    repositories: Array.isArray(merged.repositories)
      ? merged.repositories.map((repository) => ({
          name: String(repository?.name || repository?.fullName || "Unnamed repository"),
          fullName: String(repository?.fullName || repository?.name || "Unnamed repository"),
          description: String(repository?.description || ""),
          language: String(repository?.language || "Unknown"),
          stars: Math.max(0, Number(repository?.stars) || 0),
          forks: Math.max(0, Number(repository?.forks) || 0),
          url: String(repository?.url || ""),
          pushedAt: String(repository?.pushedAt || ""),
          isPrivate: Boolean(repository?.isPrivate),
          isFork: Boolean(repository?.isFork)
        }))
      : []
  };
}

let healthSyncStatus = { state: "waiting", snapshot: null, connectionUrls: [] };
let statusData = { ...mockStatus, github: normalizeGithub(mockStatus.github) };
const appRoot = document.querySelector("#app");
const view = new URLSearchParams(window.location.search).get("view") || "main";
let activeSettingsSection = "settings-appearance";
let activeSettingsService = "settings-github";
let currentSection = "Dashboard";
let floatingPinned = false;
let floatingDocked = false;
let systemClockTimer = null;
let tooltipHideTimer = null;
let mainWindowMaximized = false;
let sidebarCollapsed = false;
let selectedContributionMonth = null;
let selectedContributionDate = null;
let selectedContributionRepository = null;
const githubContributionDetailCache = new Map();
let githubContributionRequestId = 0;
let githubRefreshInFlight = false;
let dashboardRefreshInFlight = false;
let agentRefreshInFlight = false;
let refreshNoticeTimer = null;
const emptyTokenUsage = () => ({
  available: false,
  isAvailable: false,
  hourly: [],
  daily: [],
  totalTokens: 0,
  updatedAt: null
});
let codexTokenUsage = emptyTokenUsage();
let superGrokTokenUsage = emptyTokenUsage();
const agentChartGranularity = { chatgpt: "hour", supergrok: "hour" };
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
let notificationFilters = { source: "all", state: "all" };
let notificationSelection = { id: null, loading: false, data: null, error: "" };
let notificationAcknowledgement = { id: null, returnFocus: null };
const dismissedNotificationAcknowledgements = new Set();
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
  appearance: { theme: "system", accent: "green", opacity: 0.94, density: "comfortable" },
  modules: {
    enabled: Object.fromEntries(moduleDefinitions.map((module) => [module.id, module.defaultEnabled])),
    order: [...moduleDefinitions].sort((a, b) => a.defaultOrder - b.defaultOrder).map((module) => module.id),
    refreshSeconds: Object.fromEntries(moduleDefinitions.map((module) => [module.id, module.defaultRefreshSeconds]))
  },
  integrations: { github: { username: "kibuouo", hasToken: false } }
};
const refreshController = window.WinPlateRefresh.createRefreshController({
  onHealthChange: (taskId, health) => {
    const affected = taskId === "status"
      ? ["weather", "heart"]
      : (taskId === "deepseek" || taskId === "supergrok")
        ? ["codex"]
        : [taskId];
    affected.forEach((id) => {
      if (moduleHealth[id]) moduleHealth[id] = { ...health };
    });
    updateModuleHealthDom(affected);
  }
});
const THEME_STORAGE_KEY = "winplate-theme";
const ACCENT_COLORS = {
  green: "#10a37f",
  blue: "#2563eb",
  purple: "#7c3aed",
  rose: "#db2777",
  orange: "#c2410c"
};
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
let accentPreference = "green";
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

/**
 * Overview service-health kind for the shared pill used by GitHub / Agent / Heart / QWeather.
 * live -> green「服务正常」; cached/stale -> yellow「缓存」.
 */
function dashboardServiceHealthKind(moduleId) {
  const health = moduleHealth[moduleId] || {};
  if (health.state === "error") return "error";
  if (health.state === "stale") return "cached";
  if (health.state === "loading") return "loading";

  if (moduleId === "github") {
    const github = statusData.github || {};
    const status = String(github.status || "");
    const source = String(github.source || "");
    if (
      github.availability === "cached"
      || /cache/i.test(status)
      || source.includes("cache")
    ) {
      return "cached";
    }
    if (
      github.availability
      && !["live", "loading", ""].includes(github.availability)
    ) {
      return "error";
    }
  }

  if (moduleId === "codex") {
    const statuses = [
      statusData.codex?.status,
      statusData.supergrok?.status,
      statusData.deepseek?.status
    ].filter(Boolean);
    if (statuses.some((status) => status === "Cached")) return "cached";
    const available = statuses.filter((status) => status === "Normal" || status === "Cached");
    if (statuses.length && available.length === 0) return "error";
  }

  if (moduleId === "weather") {
    const weather = statusData.weather || {};
    if (weather.source === "unconfigured") return "error";
    if (String(weather.source || "").includes("cache") || weather.availability === "cached") {
      return "cached";
    }
  }

  if (moduleId === "heart") {
    const heart = statusData.heart || {};
    if (String(heart.source || "").includes("cache") || heart.availability === "cached") {
      return "cached";
    }
  }

  return "live";
}

function serviceHealthBadge(kind = "live") {
  if (kind === "cached") {
    return `<span class="service-health cached"><i></i>缓存</span>`;
  }
  if (kind === "error") {
    return `<span class="service-health error"><i></i>不可用</span>`;
  }
  if (kind === "loading") {
    return `<span class="service-health loading"><i></i>读取中</span>`;
  }
  return `<span class="service-health"><i></i>服务正常</span>`;
}

function githubStatusLabel(status = "") {
  const value = String(status || "").trim();
  return value.toLowerCase() === "live" ? "服务正常" : (value || "读取中");
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

function resolvedTheme() {
  return themePreference === "system"
    ? (themeMedia.matches ? "dark" : "light")
    : themePreference;
}

function applyMainTheme() {
  const theme = resolvedTheme();
  const accent = ACCENT_COLORS[accentPreference] || ACCENT_COLORS.green;
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.accent = accentPreference;
  document.documentElement.dataset.density = appSettings.appearance.density;
  document.documentElement.style.colorScheme = theme;
  document.documentElement.style.setProperty("--user-accent", accent);
  document.documentElement.style.setProperty("--window-opacity", String(appSettings.appearance.opacity));
  document.documentElement.style.setProperty("--window-opacity-percent", `${Math.round(appSettings.appearance.opacity * 100)}%`);
  if (view === "main") window.winplate.setWindowTheme(theme);
  // Rebuild open mail preview so dark/light srcdoc chrome stays in sync.
  if (view === "main" && mailDetail.open) {
    updateMainStatusDom();
  }
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

async function setAccentPreference(accent) {
  if (!ACCENT_COLORS[accent] || accent === accentPreference) return;
  const previousAccent = accentPreference;
  accentPreference = accent;
  appSettings.appearance.accent = accent;
  applyMainTheme();
  bindThemeControls();
  try {
    const appearance = await window.winplate.saveAppearanceSettings({ accent });
    accentPreference = ACCENT_COLORS[appearance?.accent] ? appearance.accent : accent;
    appSettings.appearance.accent = accentPreference;
  } catch (error) {
    accentPreference = previousAccent;
    appSettings.appearance.accent = previousAccent;
    applyMainTheme();
    bindThemeControls();
    console.error("Failed to save accent setting:", error);
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
    accentPreference = ACCENT_COLORS[appearance?.accent] ? appearance.accent : "green";
    mailAutoRefreshSeconds = normalizeMailAutoRefreshSeconds(
      settings?.modules?.refreshSeconds?.mail ?? appearance?.mailAutoRefreshSeconds
    );
    appSettings.appearance.theme = themePreference;
    appSettings.appearance.accent = accentPreference;
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

function modulePageHeader({ title, description, actions = "", className = "" }) {
  const headingClass = ["module-page-heading", className].filter(Boolean).join(" ");
  return `
    <div class="${headingClass}">
      <div class="module-heading-copy">
        <h1>${escapeHtml(title)}</h1>
        <span>${escapeHtml(description)}</span>
      </div>
      ${actions}
    </div>`;
}

function accentSelector() {
  const options = [
    ["green", "绿色"],
    ["blue", "蓝色"],
    ["purple", "紫色"],
    ["rose", "玫红"],
    ["orange", "橙色"]
  ];
  return `
    <div class="appearance-setting">
      <span>
        <strong>强调色</strong>
        <small>用于标题、按钮和选中状态</small>
      </span>
      <div class="accent-selector" role="radiogroup" aria-label="强调色">
        ${options.map(([value, label]) => `
          <button type="button" class="${accentPreference === value ? "active" : ""}" data-accent-choice="${value}" role="radio" aria-checked="${accentPreference === value}" aria-label="${label}" title="${label}">
            <span aria-hidden="true"></span>
          </button>`).join("")}
      </div>
    </div>`;
}

function settingsSidebarContent() {
  const items = [
    ["settings-appearance", "外观"],
    ["settings-general", "工作区"],
    ["settings-services", "连接服务"]
  ];
  return `
    <div class="settings-sidebar-heading">
      <button class="settings-back" data-section="Dashboard" type="button">← 返回应用</button>
      <label class="settings-search">
        <span aria-hidden="true">⌕</span>
        <input id="settings-search" type="search" placeholder="搜索并定位设置..." autocomplete="off">
      </label>
      <small class="settings-search-feedback" id="settings-search-feedback" aria-live="polite"></small>
    </div>
    <nav class="settings-nav" aria-label="设置分类">
      <p>设置</p>
      ${items.map(([id, label]) => `<button class="${activeSettingsSection === id ? "active" : ""}" data-settings-target="${id}" type="button">${label}</button>`).join("")}
    </nav>`;
}

function bindSettingsNavigation() {
  const search = document.querySelector("#settings-search");
  const sections = [...document.querySelectorAll(".settings-page [data-settings-section]")];
  const buttons = [...document.querySelectorAll("[data-settings-target]")];
  const serviceSections = [...document.querySelectorAll("[data-settings-service]")];
  const serviceButtons = [...document.querySelectorAll("[data-settings-service-target]")];
  const feedback = document.querySelector("#settings-search-feedback");
  if (!search || !sections.length) return;

  const showService = (target) => {
    if (!serviceSections.some((section) => section.id === target)) return;
    activeSettingsService = target;
    serviceSections.forEach((section) => { section.hidden = section.id !== target; });
    serviceButtons.forEach((button) => {
      const active = button.dataset.settingsServiceTarget === target;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
  };
  const showSection = (target, { scroll = true } = {}) => {
    if (!sections.some((section) => section.id === target)) return;
    activeSettingsSection = target;
    sections.forEach((section) => { section.hidden = section.id !== target; });
    buttons.forEach((button) => button.classList.toggle("active", button.dataset.settingsTarget === target));
    if (target === "settings-services") showService(activeSettingsService);
    if (scroll) document.querySelector(".main-content")?.scrollTo({ top: 0, behavior: "smooth" });
  };
  buttons.forEach((button) => {
    button.onclick = () => {
      search.value = "";
      if (feedback) feedback.textContent = "";
      showSection(button.dataset.settingsTarget);
    };
  });
  serviceButtons.forEach((button) => {
    button.onclick = () => {
      search.value = "";
      if (feedback) feedback.textContent = "";
      showService(button.dataset.settingsServiceTarget);
      document.querySelector(".main-content")?.scrollTo({ top: 0, behavior: "smooth" });
    };
  });
  search.oninput = () => {
    const query = search.value.trim().toLocaleLowerCase();
    if (!query) {
      if (feedback) feedback.textContent = "";
      showSection(activeSettingsSection, { scroll: false });
      return;
    }
    const serviceMatch = serviceSections.find((section) => section.textContent.toLocaleLowerCase().includes(query));
    if (serviceMatch) {
      showSection("settings-services");
      showService(serviceMatch.id);
      if (feedback) feedback.textContent = `已定位到${serviceMatch.dataset.settingsServiceLabel || "连接服务"}`;
      return;
    }
    const sectionMatch = sections.find((section) => section.textContent.toLocaleLowerCase().includes(query));
    if (sectionMatch) {
      showSection(sectionMatch.id);
      if (feedback) feedback.textContent = `已定位到${sectionMatch.dataset.settingsLabel || "相关设置"}`;
      return;
    }
    if (feedback) feedback.textContent = "没有找到相关设置";
  };
  showSection(activeSettingsSection, { scroll: false });
  showService(activeSettingsService);
  updateSettingsServicesSummary();
}

function bindThemeControls() {
  document.querySelectorAll("[data-theme-choice]").forEach((button) => {
    button.classList.toggle("active", button.dataset.themeChoice === themePreference);
    button.setAttribute("aria-checked", String(button.dataset.themeChoice === themePreference));
    button.onclick = () => setThemePreference(button.dataset.themeChoice);
  });
  document.querySelectorAll("[data-accent-choice]").forEach((button) => {
    button.classList.toggle("active", button.dataset.accentChoice === accentPreference);
    button.setAttribute("aria-checked", String(button.dataset.accentChoice === accentPreference));
    button.onclick = () => setAccentPreference(button.dataset.accentChoice);
  });
}

const SETTINGS_SERVICE_PRESENTATION = Object.freeze({
  github: { target: "settings-github", title: "GitHub", description: "Profile, contributions, and repositories", icon: "github" },
  weather: { target: "settings-weather", title: "QWeather", description: "Weather service and location", icon: "cloud-rain-alert" },
  deepseek: { target: "settings-deepseek", title: "DeepSeek", description: "Account balance service", icon: "sparkles" },
  mail: { target: "settings-mail", title: "QQ Mail", description: "IMAP inbox", icon: "mail" }
});

function settingsServiceStatusKind(text) {
  if (/读取失败|保存失败|连接失败|不可用|failed|unavailable/i.test(text)) return "error";
  if (/正在|loading|saving|connecting/i.test(text)) return "pending";
  if (/已配置|已连接|公开数据|正常|configured|connected|public data|normal/i.test(text)) return "ready";
  return "empty";
}

function updateSettingsServicesSummary() {
  const statuses = [...document.querySelectorAll("[data-settings-service-status]")];
  const readyCount = statuses.filter((status) => settingsServiceStatusKind(status.textContent) === "ready").length;
  const count = document.querySelector("[data-settings-services-ready-count]");
  if (count) count.textContent = String(readyCount);
}

function updateSettingsServiceStatus(service, text) {
  const status = document.querySelector(`[data-settings-service-status="${service}"]`);
  if (status) {
    status.textContent = text;
    status.dataset.state = settingsServiceStatusKind(text);
  }
  updateSettingsServicesSummary();
}

function settingsServiceNavButton(service, statusText) {
  const item = SETTINGS_SERVICE_PRESENTATION[service];
  const active = activeSettingsService === item.target;
  return `
    <button class="${active ? "active" : ""}" data-settings-service-target="${item.target}" type="button" role="tab" aria-selected="${active}">
      <span class="settings-service-icon">${window.WinPlateSmartNotificationIcons.renderSmartNotificationIcon(item.icon)}</span>
      <span class="settings-service-copy"><strong>${item.title}</strong><small>${item.description}</small></span>
      <b data-settings-service-status="${service}" data-state="${settingsServiceStatusKind(statusText)}">${statusText}</b>
    </button>`;
}

const WORKSPACE_MODULE_COPY = Object.freeze({
  github: "Contribution heatmap, recent activity, and repositories",
  codex: "Codex, DeepSeek, and SuperGrok usage status",
  notifications: "Cross-module alerts and local notification digest",
  mail: "QQ Mail inbox and unread alerts",
  weather: "Live weather, forecasts, and severe weather alerts",
  heart: "Health data and recent measurements",
  network: "Live network speed in the floating window"
});

const WORKSPACE_MODULE_ICONS = Object.freeze({
  github: "github",
  codex: "codex",
  notifications: "bell",
  mail: "mail",
  weather: "cloud-rain-alert",
  heart: "monitor",
  network: "wifi"
});

function workspaceModuleIcon(moduleId) {
  return window.WinPlateSmartNotificationIcons.renderSmartNotificationIcon(
    WORKSPACE_MODULE_ICONS[moduleId] || "monitor"
  );
}

function workspaceModuleCard(module) {
  const title = module.title;
  const viewLabels = module.views.map((view) => view.charAt(0).toUpperCase() + view.slice(1));
  return `
    <article class="workspace-module-card" data-module-setting="${module.id}">
      <label class="workspace-module-toggle">
        <span class="workspace-module-icon">${workspaceModuleIcon(module.id)}</span>
        <span class="workspace-module-copy">
          <strong>${escapeHtml(title)}</strong>
          <small>${escapeHtml(WORKSPACE_MODULE_COPY[module.id] || "WinPlate workspace module")}</small>
        </span>
        <span class="workspace-module-switch">
          <input
            type="checkbox"
            data-module-enabled
            aria-label="Show ${escapeHtml(title)} module"
            ${moduleEnabled(module.id) ? "checked" : ""}
          >
          <span aria-hidden="true"></span>
        </span>
      </label>
      <div class="workspace-module-views" aria-label="Available views">
        ${viewLabels.map((label) => `<span>${label}</span>`).join("")}
      </div>
    </article>`;
}

function productSettingsPanel() {
  const ordered = window.WinPlateModuleRegistry.orderedModules(appSettings.modules.order);
  const enabledCount = ordered.filter((module) => moduleEnabled(module.id)).length;
  const dashboardCount = ordered.filter((module) => module.views.includes("dashboard")).length;
  const floatingCount = ordered.filter((module) => module.views.includes("floating")).length;
  return `
    <form class="product-settings-panel" id="product-settings-form">
      <section class="workspace-settings-summary" aria-labelledby="workspace-summary-title">
        <div class="workspace-summary-copy">
          <span class="workspace-summary-icon">${window.WinPlateSmartNotificationIcons.renderSmartNotificationIcon("monitor")}</span>
          <span>
            <strong id="workspace-summary-title">Workspace modules</strong>
            <small>Control what appears in the app and which modules refresh automatically</small>
          </span>
        </div>
        <dl class="workspace-summary-metrics">
          <div><dt data-workspace-enabled-count>${enabledCount}</dt><dd>Enabled</dd></div>
          <div><dt>${ordered.length}</dt><dd>All modules</dd></div>
          <div><dt>${dashboardCount}</dt><dd>概览</dd></div>
          <div><dt>${floatingCount}</dt><dd>Floating</dd></div>
        </dl>
      </section>
      <section class="workspace-module-section" aria-labelledby="workspace-module-title">
        <div class="workspace-module-heading">
          <span>
            <strong id="workspace-module-title">Visible modules</strong>
            <small>Disabled modules are hidden and no longer refresh automatically</small>
          </span>
          <small>Use the switch on each card</small>
        </div>
        <div class="workspace-module-grid">
          ${ordered.map(workspaceModuleCard).join("")}
        </div>
      </section>
      <aside class="workspace-notification-policy">
        <span class="workspace-policy-icon">${window.WinPlateSmartNotificationIcons.renderSmartNotificationIcon("bell")}</span>
        <span><strong>Notification digest</strong><small>Local rules automatically classify, deduplicate, and group updates</small></span>
        <b>Automatic</b>
      </aside>
      <div class="product-settings-actions">
        <small id="product-settings-status" aria-live="polite">Saved for the current Windows user</small>
        <button type="submit" disabled>Save workspace settings</button>
      </div>
    </form>`;
}

function githubSettingsPanel() {
  const github = appSettings.integrations.github || {};
  return `<form class="settings-panel weather-settings-panel" id="github-settings-form">
    <fieldset>
      <legend><strong>GitHub</strong><small>用于读取个人资料和贡献数据</small></legend>
      <label>
        <span><strong>用户名</strong><small>保存后立即刷新 GitHub 模块</small></span>
        <input id="github-username" type="text" autocomplete="off" value="${escapeHtml(github.username || "kibuouo")}">
      </label>
      <label>
        <span><strong>Personal access token</strong><small>${github.hasToken ? "已配置，留空保持不变" : "可选"}</small></span>
        <input id="github-token" type="password" autocomplete="off" placeholder="${github.hasToken ? "已配置，留空保持不变" : "可选"}">
      </label>
    </fieldset>
    <div class="weather-settings-actions">
      <small id="github-settings-status" class="${github.hasToken ? "configured" : ""}">GitHub：${github.hasToken ? "已配置" : "使用公开数据"}</small>
      <button type="submit">保存连接</button>
    </div>
  </form>`;
}

function bindProductSettings() {
  const form = document.querySelector("#product-settings-form");
  if (!form) return;
  const rows = [...form.querySelectorAll("[data-module-setting]")];
  const status = form.querySelector("#product-settings-status");
  const button = form.querySelector("button[type=submit]");
  const enabledCount = form.querySelector("[data-workspace-enabled-count]");
  const updateState = ({ saved = false } = {}) => {
    const activeCount = rows.filter((row) => row.querySelector("[data-module-enabled]").checked).length;
    const dirty = rows.some((row) => (
      row.querySelector("[data-module-enabled]").checked !== moduleEnabled(row.dataset.moduleSetting)
    ));
    enabledCount.textContent = String(activeCount);
    form.classList.toggle("is-dirty", dirty);
    status.className = dirty ? "pending" : "";
    status.textContent = dirty
      ? `Unsaved changes · ${activeCount} modules will be enabled`
      : saved
        ? `Saved and applied · ${activeCount} modules active`
        : "Saved for the current Windows user";
    button.disabled = !dirty;
  };
  rows.forEach((row) => {
    row.querySelector("[data-module-enabled]").onchange = () => updateState();
  });
  form.onsubmit = async (event) => {
    event.preventDefault();
    button.disabled = true;
    status.textContent = "Saving…";
    const enabled = Object.fromEntries(rows.map((row) => [
      row.dataset.moduleSetting,
      row.querySelector("[data-module-enabled]").checked
    ]));
    const nextSettings = {
      ...appSettings,
      modules: { ...appSettings.modules, enabled }
    };
    try {
      appSettings = await window.winplate.saveSettings(nextSettings);
      themePreference = appSettings.appearance.theme;
      mailAutoRefreshSeconds = normalizeMailAutoRefreshSeconds(appSettings.modules.refreshSeconds.mail);
      applyMainTheme();
      configureRefreshTasks();
      currentSection = moduleEnabled("github") || moduleEnabled("codex") ? currentSection : "Dashboard";
      updateState({ saved: true });
    } catch (error) {
      status.textContent = error.message || "保存失败";
      status.className = "error";
      button.disabled = false;
    }
  };
  updateState();
}

function bindGithubSettings() {
  const form = document.querySelector("#github-settings-form");
  if (!form) return;
  form.onsubmit = async (event) => {
    event.preventDefault();
    const status = form.querySelector("#github-settings-status");
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    status.textContent = "GitHub：正在保存...";
    try {
      appSettings = await window.winplate.saveSettings({
        ...appSettings,
        integrations: {
          ...appSettings.integrations,
          github: {
            username: form.querySelector("#github-username").value.trim(),
            token: form.querySelector("#github-token").value.trim()
          }
        }
      });
      form.querySelector("#github-token").value = "";
      updateSettingsServiceStatus("github", appSettings.integrations.github?.hasToken ? "已配置" : "公开数据");
      status.textContent = "GitHub：已保存";
      status.className = "configured";
      refreshController.refresh("github", { force: true, reason: "settings" }).catch(() => {});
    } catch (error) {
      status.textContent = `GitHub：${error.message || "保存失败"}`;
      status.className = "error";
    } finally {
      button.disabled = false;
    }
  };
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

function updateWeatherSettingsStatus(form, serviceState) {
  const serviceStatus = form.querySelector("#weather-service-status");
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
}

async function bindWeatherSettings() {
  const form = document.querySelector("#weather-settings-form");
  if (!form) return;
  const keyInput = form.querySelector("#qweather-api-key");
  const hostInput = form.querySelector("#qweather-api-host");
  const saveButton = form.querySelector("button[type='submit']");
  try {
    weatherSettings = await window.winplate.getWeatherSettings();
    hostInput.value = weatherSettings.apiHost;
    keyInput.placeholder = weatherSettings.hasApiKey ? "已配置，留空则保持不变" : "请输入 API Key";
    updateSettingsServiceStatus("weather", weatherSettings.hasApiKey ? "已配置" : "未配置");
    updateWeatherSettingsStatus(form, weatherSettings.hasApiKey && Boolean(weatherSettings.apiHost) ? "configured" : "unconfigured");
  } catch (error) {
    updateSettingsServiceStatus("weather", "读取失败");
    updateWeatherSettingsStatus(form, "readFailed");
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    saveButton.disabled = true;
    updateWeatherSettingsStatus(form, "saving");
    try {
      weatherSettings = await window.winplate.saveWeatherSettings({
        apiKey: keyInput.value,
        apiHost: hostInput.value,
        projectId: weatherSettings.projectId || "",
        credentialId: weatherSettings.credentialId || ""
      });
      keyInput.value = "";
      keyInput.placeholder = "已配置，留空则保持不变";
      updateSettingsServiceStatus("weather", weatherSettings.hasApiKey ? "已配置" : "未配置");
      qweatherOfficialStatus = null;
      updateWeatherSettingsStatus(form, weatherSettings.hasApiKey && Boolean(weatherSettings.apiHost) ? "configured" : "unconfigured");
      locationWeatherPromise = null;
      refreshStatus();
    } catch (error) {
      updateWeatherSettingsStatus(form, weatherSettings.hasApiKey && Boolean(weatherSettings.apiHost) ? "configured" : "unconfigured");
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
  const status = form.querySelector("#deepseek-settings-status");
  const button = form.querySelector("button[type='submit']");
  const setStatus = (text, className = "") => {
    status.textContent = `DeepSeek API：${text}`;
    status.className = className;
  };
  try {
    deepseekSettings = await window.winplate.getDeepSeekSettings();
    keyInput.placeholder = deepseekSettings.hasApiKey ? "已配置，重新填写可覆盖" : "请输入 API Key";
    updateSettingsServiceStatus("deepseek", deepseekSettings.hasApiKey ? "已配置" : "未配置");
    setStatus(deepseekSettings.hasApiKey ? "已配置" : "未配置", deepseekSettings.hasApiKey ? "configured" : "");
  } catch {
    updateSettingsServiceStatus("deepseek", "读取失败");
    setStatus("读取失败", "error");
  }
  form.onsubmit = async (event) => {
    event.preventDefault();
    button.disabled = true;
    setStatus("正在保存...");
    try {
      deepseekSettings = await window.winplate.saveDeepSeekSettings({
        apiKey: keyInput.value,
        baseUrl: deepseekSettings.baseUrl
      });
      keyInput.value = "";
      keyInput.placeholder = "已配置，重新填写可覆盖";
      updateSettingsServiceStatus("deepseek", deepseekSettings.hasApiKey ? "已配置" : "未配置");
      statusData.deepseek = await window.winplate.getDeepSeekUsage({ force: true });
      setStatus(
        statusData.deepseek.status === "Normal" ? "已配置，余额读取正常" : "已保存，余额暂不可用",
        statusData.deepseek.status === "Normal" ? "configured" : "error"
      );
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
  const items = Array.isArray(summary?.items) ? summary.items : [];
  return {
    conversations: Array.isArray(summary?.conversations) ? summary.conversations : null,
    items,
    latest: summary?.latest || items[0] || null,
    unreadCount: Math.max(0, Number(summary?.unreadCount) || 0),
    updatedAt: summary?.updatedAt || null
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

function normalizeSectionName(section) {
  const value = typeof section === "string" ? section.trim() : "";
  if (!value) return "Dashboard";
  // Module rename: keep old deep links working without renaming internal codex ids.
  if (value === "Codex") return "Agent";
  return value;
}

function normalizeNavigationPayload(value) {
  if (typeof value === "string") {
    return { section: normalizeSectionName(value) };
  }
  if (value && typeof value === "object") {
    return {
      section: normalizeSectionName(
        typeof value.section === "string" && value.section.trim() ? value.section.trim() : "Dashboard"
      ),
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

function notificationClockLabel(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(timestamp));
}

function notificationItemsForDigest() {
  return normalizedNotifications().items;
}

function notificationConversations() {
  const normalized = normalizedNotifications();
  return typeof window.WinPlateNotificationConversations?.fromSummary === "function"
    ? window.WinPlateNotificationConversations.fromSummary(normalized, normalized.items)
    : normalized.items;
}

function notificationConversationForId(id) {
  const conversations = notificationConversations();
  const resolved = window.WinPlateNotificationConversations?.conversationForNotificationId?.(conversations, id);
  return resolved || conversations.find((item) => String(item.id) === String(id)) || null;
}

function unreadConversationMemberIds(conversation) {
  const rawById = new Map(notificationItemsForDigest().map((item) => [String(item.id), item]));
  return (Array.isArray(conversation?.memberIds) ? conversation.memberIds : [conversation?.id])
    .map(String)
    .filter((id) => rawById.get(id)?.unread);
}

function notificationSourceLabel(source) {
  return {
    mail: "Mail",
    qweather: "Weather",
    codex: "Codex",
    chatgpt: "ChatGPT",
    github: "GitHub",
    system: "系统",
    external: "WinPlate"
  }[source] || source || "WinPlate";
}

function notificationSourceIconKey(source) {
  return { codex: "codex", chatgpt: "chatgpt", github: "github", mail: "mail", qweather: "cloud-rain-alert" }[source] || "bell";
}

/** Prefer API/core display severity (info | warning | danger) for emphasis labels. */
function notificationDisplaySeverity(item = {}) {
  const metadata = item?.meta && typeof item.meta === "object"
    ? item.meta
    : item?.metadata && typeof item.metadata === "object"
      ? item.metadata
      : {};
  const severity = String(item?.severity || item?.displaySeverity || metadata.severity || "").toLowerCase();
  if (severity === "info" || severity === "warning" || severity === "danger") return severity;
  const alertColor = String(metadata.alertColor || "").toLowerCase();
  if (alertColor === "red") return "danger";
  if (alertColor === "yellow") return "warning";
  const level = String(item?.level || "info").toLowerCase();
  if (level === "critical" || level === "danger") return "danger";
  if (level === "warning") return "warning";
  return "info";
}

function notificationSeverityLabel(severityOrItem) {
  const severity = typeof severityOrItem === "string"
    ? severityOrItem
    : notificationDisplaySeverity(severityOrItem);
  return {
    info: "信息",
    warning: "预警",
    danger: "危险"
  }[severity] || "信息";
}

/** Map display severity onto existing timeline level-* CSS classes. */
function notificationSeverityClass(item = {}) {
  const severity = notificationDisplaySeverity(item);
  if (severity === "danger") return "critical";
  if (severity === "warning") return "warning";
  return "info";
}

function notificationLevelLabel(levelOrItem, item = {}) {
  return notificationSeverityLabel(
    typeof levelOrItem === "object" && levelOrItem
      ? levelOrItem
      : { ...item, level: levelOrItem }
  );
}

function notificationStrip() {
  const digest = window.WinPlateNotificationDigest.normalizeDigest(notificationDigest);
  const iconKey = "sparkles";
  const alertColorClass = digest.alertColor ? ` alert-color-${digest.alertColor}` : "";
  const unread = digest.unreadCount;
  const syncTime = formatNotificationSyncTime(digest.generatedAt);
  const stripTitle = `${digest.headline} · 已同步${syncTime}`;
  return `
    <button class="notification-strip ${unread ? "has-unread" : ""} severity-${escapeHtml(digest.severity)}${alertColorClass} no-drag" id="notification-strip" type="button" aria-label="打开${notificationSeverityLabel(digest.severity)}通知摘要">
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
function brandIconMarkup(name, className = "") {
  if (!["openai", "deepseek", "grok"].includes(name)) return "";
  // DeepSeek keeps its official blue whale as a full-color image.
  // OpenAI / Grok use monochrome masks that follow the current theme color.
  if (name === "deepseek") {
    const classes = ["agent-brand-icon", "agent-brand-icon-deepseek", "agent-brand-icon-img", className]
      .filter(Boolean)
      .join(" ");
    return `<img class="${classes}" src="../../assets/deepseek-icon.svg" alt="" aria-hidden="true">`;
  }
  const classes = ["agent-brand-icon", `agent-brand-icon-${name}`, className].filter(Boolean).join(" ");
  return `<span class="${classes}" aria-hidden="true"></span>`;
}
const openaiBrandIcon = brandIconMarkup("openai");
const deepseekBrandIcon = brandIconMarkup("deepseek");
const grokBrandIcon = brandIconMarkup("grok");
// Original sidebar / capsule glyph (unchanged by the Agent rename).
const sidebarCodexIcon = `
  <svg class="codex-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M7.25 18.25h9.5a4.25 4.25 0 0 0 .64-8.45A5.75 5.75 0 0 0 6.5 7.85a3.75 3.75 0 0 0 .75 7.42"/>
    <path d="m8.25 10.25 2.25 2.25-2.25 2.25M12.75 14.75h3"/>
  </svg>`;
const codexIcon = openaiBrandIcon;
function renderNotificationSourceIcon(source) {
  if (source === "codex") return sidebarCodexIcon;
  if (source === "qweather") return qweatherIconMarkup("notification-weather-icon");
  return window.WinPlateSmartNotificationIcons.renderSmartNotificationIcon(notificationSourceIconKey(source));
}
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

function formattedGithubMonthLabel(key, fallback = "") {
  const date = new Date(`${key}-01T00:00:00`);
  if (Number.isNaN(date.getTime())) return fallback || key;
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" }).format(date);
}

function githubShortMonthLabel(date, fallback = "") {
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat("zh-CN", { month: "short" }).format(date);
}

function githubContributionCountLabel(count) {
  return `${Math.max(0, Number(count) || 0)} 次贡献`;
}

function githubYearHeatmap(months = []) {
  const items = months.map((month) => {
    const cells = (Array.isArray(month.levels) ? month.levels : []).map((value) => {
      const level = Math.max(0, Math.min(4, Number(value) || 0));
      return `<i class="github-year-cell level-${level}"></i>`;
    }).join("");
    const date = new Date(`${month.key}-01T00:00:00`);
    const shortLabel = githubShortMonthLabel(date, month.label);
    const label = `${formattedGithubMonthLabel(month.key, month.label)}：${githubContributionCountLabel(month.commits)}`;
    return `
      <button
        class="github-year-month"
        type="button"
        data-contribution-month="${escapeHtml(month.key)}"
        aria-pressed="${selectedContributionMonth === month.key}"
        aria-label="${escapeHtml(label)}"
        title="${escapeHtml(label)}"
      >
        <span class="github-year-month-grid" aria-hidden="true">${cells}</span>
        <b>${escapeHtml(shortLabel)}</b>
      </button>`;
  }).join("");
  return `
    <section class="github-year-heatmap" aria-labelledby="github-year-heatmap-title">
      <strong id="github-year-heatmap-title">最近 12 个月</strong>
      <div class="github-year-heatmap-scroll">${items}</div>
    </section>`;
}

function revealSelectedGithubMonth() {
  const strip = document.querySelector(".github-year-heatmap-scroll");
  const selected = strip?.querySelector('[data-contribution-month][aria-pressed="true"]');
  if (!strip || !selected) return;
  requestAnimationFrame(() => {
    const selectedEnd = selected.offsetLeft + selected.offsetWidth;
    const maximumScroll = Math.max(0, strip.scrollWidth - strip.clientWidth);
    strip.scrollLeft = Math.min(maximumScroll, Math.max(0, selectedEnd - strip.clientWidth + 2));
  });
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
    const dateLabel = new Intl.DateTimeFormat("zh-CN", {
      month: "long",
      day: "numeric"
    }).format(date);
    const contributionLabel = `${dateLabel}：${githubContributionCountLabel(count)}。`;
    const dateKey = `${month.key}-${String(sourceIndex + 1).padStart(2, "0")}`;
    return `<button class="github-calendar-cell github-calendar-day level-${level}" type="button" data-contribution-date="${dateKey}" aria-pressed="${selectedContributionDate === dateKey}" aria-label="${contributionLabel}" data-tooltip="${contributionLabel}"><b>${sourceIndex + 1}</b></button>`;
  }).join("");
  return `
    <div class="github-calendar-shell">
      <div class="github-calendar-weekdays" aria-hidden="true"><span>周一</span><span>周二</span><span>周三</span><span>周四</span><span>周五</span><span>周六</span><span>周日</span></div>
      <div class="github-calendar-grid" aria-label="GitHub ${escapeHtml(formattedGithubMonthLabel(month.key, month.label))}贡献记录">${cells}</div>
    </div>`;
}

function githubContributionMonths(github) {
  return github.contributionMonths.length
    ? github.contributionMonths
    : [{
        key: new Date().toISOString().slice(0, 7),
        label: github.contributionMonth || "本月",
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
    ? new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", year: "numeric" }).format(new Date(`${dateText}T00:00:00`))
    : formattedGithubMonthLabel(month.key, month.label);
  return {
    rangeType: dateText ? "date" : "month",
    rangeKey: dateText || month.key,
    label,
    totalCount,
    repositories: [],
    commitRecordsAvailable: false,
    commitRecordsTruncated: false,
    detailsAvailable: false,
    message: ""
  };
}

function githubCommitTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function renderGithubContributionActivity(detail, { loading = false, error = "" } = {}) {
  const total = Math.max(0, Number(detail?.totalCount) || 0);
  const repositories = Array.isArray(detail?.repositories) ? detail.repositories : [];
  const heading = detail?.rangeType === "date" ? detail.label : detail?.label || "提交详情";
  const summary = loading
    ? `已创建 ${total} 次提交`
    : `已在 ${repositories.length} 个仓库中创建 ${total} 次提交`;
  const selectedRepository = repositories.find((repository) => repository.nameWithOwner === selectedContributionRepository)
    || repositories[0]
    || null;
  selectedContributionRepository = selectedRepository?.nameWithOwner || null;
  const commits = Array.isArray(selectedRepository?.commits) ? selectedRepository.commits : [];
  const repositoryOptions = repositories.map((repository) => `
    <option value="${escapeHtml(repository.nameWithOwner)}" ${repository.nameWithOwner === selectedContributionRepository ? "selected" : ""}>
      ${escapeHtml(String(repository.nameWithOwner || "Repository").split("/").at(-1))}
    </option>`).join("");
  const commitRows = commits.map((commit) => {
    const sha = String(commit?.sha || "");
    return `
      <li class="github-commit-row">
        <span class="github-commit-icon" aria-hidden="true">${previewIcons.commits}</span>
        <div>
          <button type="button" data-open-github-url="${escapeHtml(commit?.url || "")}">${escapeHtml(commit?.message || "Untitled commit")}</button>
          <p><code>${escapeHtml(sha.slice(0, 7))}</code><span>${escapeHtml(commit?.author || "Unknown")}</span><time>${escapeHtml(githubCommitTimestamp(commit?.committedAt))}</time></p>
        </div>
      </li>`;
  }).join("");
  const message = error || detail?.message || (loading
    ? "正在加载 Git 提交记录…"
    : total === 0
      ? "No commits in this range."
      : !detail?.commitRecordsAvailable
        ? "Git commit records are unavailable. Check the configured GitHub token and try again."
        : commits.length === 0
          ? "No commit records were returned for this repository."
          : "");
  const recordsNote = detail?.commitRecordsTruncated && commits.length
    ? `<small>显示最近 ${commits.length} 条记录</small>`
    : "";
  return `
    <div class="github-contribution-activity-head"><span>提交详情</span><small>${escapeHtml(heading)}</small></div>
    <div class="github-contribution-summary">
      <span class="github-contribution-marker">${previewIcons.commits}</span>
      <div><strong>${summary}</strong><p>${loading ? "正在加载仓库 Git 历史…" : repositories.length ? "浏览每个仓库的 Git 提交历史。" : escapeHtml(message)}</p></div>
    </div>
    <section class="github-commit-records" aria-labelledby="github-commit-records-title">
      <header>
        <div><strong id="github-commit-records-title">Git 提交历史</strong>${recordsNote}</div>
        ${repositoryOptions ? `<select data-github-contribution-repository aria-label="仓库提交历史">${repositoryOptions}</select>` : ""}
      </header>
      ${commitRows ? `<ol>${commitRows}</ol>` : `<p class="github-commit-empty">${escapeHtml(message)}</p>`}
    </section>`;
}

function relativeGithubPush(value) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "刚刚推送";
  if (minutes < 60) return `${minutes} 分钟前推送`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前推送`;
  return `${Math.floor(hours / 24)} 天前推送`;
}

function githubRepositoryCards(github) {
  const repositories = github.repositories.length
    ? github.repositories
    : github.project && github.project !== "No public repositories"
      ? [{
          name: github.project,
          fullName: github.project,
          description: "",
          language: github.language,
          stars: github.stars,
          forks: 0,
          url: github.profileUrl,
          pushedAt: "",
          isPrivate: false,
          isFork: false
        }]
      : [];
  const cards = repositories.map((repository) => `
    <article class="github-maintained-repo">
      <div class="github-maintained-repo-heading">
        <button type="button" data-open-github-url="${escapeHtml(repository.url)}">
          ${previewIcons.repository}<strong>${escapeHtml(repository.name)}</strong>
        </button>
        <span class="github-repo-badges">
          ${repository.isPrivate ? "<b>Private</b>" : ""}
          ${repository.isFork ? "<b>Fork</b>" : ""}
        </span>
      </div>
      <p>${escapeHtml(repository.description || "暂无描述")}</p>
      <footer>
        <span><i></i>${escapeHtml(repository.language)}</span>
        <span>${previewIcons.star}${repository.stars}</span>
        <span>${previewIcons.commits}${repository.forks}</span>
        <small>${escapeHtml(relativeGithubPush(repository.pushedAt))}</small>
      </footer>
    </article>`).join("");
  return `
    <section class="github-maintained-section" aria-labelledby="github-maintained-title">
      <div class="github-maintained-heading">
        <div><strong id="github-maintained-title">维护中的仓库</strong><small>${repositories.length ? "最近推送，非复刻仓库优先" : "最近推送的公开仓库"}</small></div>
        <b>${repositories.length}</b>
      </div>
      ${cards ? `<div class="github-maintained-grid">${cards}</div>` : `<p class="github-maintained-empty">同步 GitHub 以列出维护中的公开仓库。</p>`}
    </section>`;
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
  const monthSummary = githubMonthSummary(selectedMonth);
  const contributionFallback = githubContributionFallback(selectedMonth, selectedContributionDate);
  const calendarDate = new Date(`${selectedMonth.key}-01T00:00:00`);
  const calendarMonth = githubShortMonthLabel(calendarDate);
  const calendarYear = calendarDate.getFullYear();
  const stateNotice = github.stateMessage
    ? `<div class="github-state-notice state-${github.availability}" role="status">${github.stateMessage}</div>`
    : "";
  return `
    <section class="github-dashboard" data-module-id="github" ${moduleHealthAttributes("github")}>
      <div class="github-main-column">
        ${modulePageHeader({
          title: "GitHub",
          description: "贡献热力图与近期维护的仓库。",
          className: "github-page-heading",
          actions: `<div class="github-heading-actions">
            <button
              class="refresh-button module-refresh-button github-refresh-button ${githubRefreshInFlight ? "refreshing" : ""}"
              id="refresh-github"
              type="button"
              aria-label="刷新 GitHub 数据"
              ${githubRefreshInFlight ? "disabled" : ""}
            >
              ${refreshIcon}
              <span>${githubRefreshInFlight ? "刷新中" : "刷新"}</span>
            </button>
          </div>`
        })}
        ${stateNotice}
        <div class="github-profile-bar">
          ${avatarMarkup(github, "github-profile-avatar")}
          <div class="github-profile-copy">
            <h1>${github.name}</h1>
            <p>${github.username}</p>
          </div>
          <dl class="github-profile-metrics">
            <div><dt>${github.repos}</dt><dd>仓库</dd></div>
            <div><dt>${github.followers}</dt><dd>关注者</dd></div>
            <div><dt>${github.streakDays}</dt><dd>连续天数</dd></div>
            <div><dt>${github.commitsThisMonth}</dt><dd>本月</dd></div>
          </dl>
          <div class="github-profile-actions">
            <div class="github-profile-status">
              ${serviceHealthBadge(dashboardServiceHealthKind("github"))}
            </div>
            <div class="github-profile-open"><button class="github-profile-button" type="button" data-open-github>打开 GitHub 主页</button></div>
          </div>
        </div>
        <article class="github-contribution-card">
          <div class="github-card-heading github-contribution-heading">
            <div><span>贡献热力图</span><small>${formattedGithubMonthLabel(selectedMonth.key, selectedMonth.label)}有 ${githubContributionCountLabel(monthSummary.contributions)}</small></div>
            <div class="github-month-navigation">
              <button type="button" data-month-direction="-1" aria-label="上个月" ${monthIndex === 0 ? "disabled" : ""}>‹</button>
              <button type="button" data-month-today>本月</button>
              <button type="button" data-month-direction="1" aria-label="下个月" ${monthIndex === months.length - 1 ? "disabled" : ""}>›</button>
            </div>
          </div>
          ${githubYearHeatmap(months)}
          <div class="github-activity-split"><div class="github-calendar-pane">
            <div class="github-card-heading github-month-calendar-heading">
              <div><span>${calendarYear}年${calendarMonth}</span><small>${selectedContributionDate ? "再次选择高亮日期以返回整月" : "选择日期查看提交详情"}</small></div>
              <div class="github-calendar-title"><div class="github-calendar-period"><strong>${calendarMonth}</strong><b>${calendarYear}年</b></div></div>
            </div>
            ${githubContributionCalendar(selectedMonth)}
            <div class="github-calendar-stats">
              <div><strong>${monthSummary.contributions}</strong><span>贡献</span></div>
              <div><strong>${monthSummary.activeDays}</strong><span>活跃天数</span></div>
              <div><strong>${monthSummary.peakDaily}</strong><span>单日最佳</span></div>
              <div><strong>${github.streakDays}</strong><span>连续天数</span></div>
            </div>
          </div><aside class="github-contribution-activity" id="github-contribution-activity">${renderGithubContributionActivity(contributionFallback, { loading: true })}</aside></div>
        </article>
        ${githubRepositoryCards(github)}
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

function qweatherIconMarkup(className = "qweather-nav-icon") {
  return `
    <svg class="${className}" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="8" cy="8" r="4.25"></circle>
      <path d="M7.25 18.75h10a4 4 0 0 0 .45-7.97A5.75 5.75 0 0 0 7.08 9.3a4.75 4.75 0 0 0 .17 9.45Z"></path>
    </svg>`;
}

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

function weatherSceneMarkup(weather = {}, options = {}) {
  const compact = options.compact === true;
  const profile = window.WinPlateWeatherScenes?.effectProfile(weather) || {
    scene: "unknown",
    intensity: 0,
    cloudCover: 50,
    windSpeed: 0,
    windDegrees: 0,
    humidity: 50,
    visibility: 20,
    haze: 0
  };
  return `
    <div class="weather-scene weather-scene-rich${compact ? " weather-scene-compact" : ""} weather-scene-${profile.scene}" aria-hidden="true">
      <span class="weather-scene-photo"></span>
      <canvas class="weather-scene-canvas"
        data-scene="${profile.scene}"
        data-intensity="${profile.intensity.toFixed(3)}"
        data-cloud-cover="${profile.cloudCover.toFixed(1)}"
        data-wind-speed="${profile.windSpeed.toFixed(1)}"
        data-wind-degrees="${profile.windDegrees.toFixed(1)}"
        data-humidity="${profile.humidity.toFixed(1)}"
        data-visibility="${profile.visibility.toFixed(1)}"
        data-haze="${profile.haze.toFixed(3)}"
        data-density="${compact ? "0.45" : "1"}"></canvas>
      <span class="weather-scene-orb"></span>
    </div>`;
}

function mountWeatherEffects(root = document) {
  window.WinPlateWeatherEffects?.mountWeatherEffects(root);
}

function weatherLiveInsights(weather = {}) {
  const summary = String(weather.minutelySummary || "").trim();
  const airQuality = weather.airQuality && typeof weather.airQuality === "object" ? weather.airQuality : null;
  const aqi = airQuality?.display || (Number.isFinite(Number(airQuality?.aqi)) ? String(Math.round(Number(airQuality.aqi))) : "");
  if (!summary && !aqi) return "";
  return `
    <div class="weather-live-insights">
      ${summary ? `<div><span>临近降水</span><strong>${escapeHtml(summary)}</strong></div>` : ""}
      ${aqi ? `<div><span>空气质量</span><strong>${escapeHtml(aqi)}${airQuality?.category ? ` · ${escapeHtml(airQuality.category)}` : ""}</strong></div>` : ""}
    </div>`;
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

function findPreviewableNotification(source, items = notificationSummary.items) {
  if (source === "qweather") return null;
  return (Array.isArray(items) ? items : [])
    .filter((item) => item.source === source && item.unread && ["warning", "critical"].includes(item.level))
    .sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0))[0] || null;
}

function notificationPreviewCardAttributes(source) {
  const item = findPreviewableNotification(source);
  return item ? `data-notification-preview-id="${escapeHtml(item.id)}"` : "";
}

function notificationPreviewMarkup(source) {
  const item = findPreviewableNotification(source);
  if (!item) return "";
  return `<div class="module-notification-preview" role="tooltip">
    <span>${escapeHtml(notificationSourceLabel(item.source))} · ${escapeHtml(notificationSeverityLabel(item))}</span>
    <strong>${escapeHtml(item.title)}</strong>
    <p>${escapeHtml(item.body || "暂无详细内容。")}</p>
    <small>${escapeHtml(relativeUpdatedAt(item.createdAt))}</small>
  </div>`;
}

function dashboardCardNavigationAttributes(moduleId) {
  const module = window.WinPlateModuleRegistry.getModuleMeta(moduleId);
  if (!module?.section) return "";
  return `data-dashboard-target="${escapeHtml(module.section)}" role="link" tabindex="0" aria-label="打开${escapeHtml(module.title)}模块"`;
}

function dashboardCardContainsInteractiveControl(card, target) {
  const element = target?.nodeType === 1 ? target : target?.parentElement;
  const control = element?.closest("button, a, input, select, textarea, summary, option, details, [contenteditable='true']");
  return Boolean(control && card.contains(control));
}

function openDashboardCard(card) {
  const targetSection = card?.dataset.dashboardTarget;
  if (!targetSection) return;
  const navigationButton = [...document.querySelectorAll("[data-section]")]
    .find((button) => button.dataset.section === targetSection);
  navigationButton?.click();
}

function bindDashboardCardNavigation(pageContent) {
  if (!pageContent || pageContent.dataset.dashboardNavigationBound) return;
  pageContent.dataset.dashboardNavigationBound = "true";
  pageContent.addEventListener("click", (event) => {
    const card = event.target.closest("[data-dashboard-target]");
    if (!card || !pageContent.contains(card) || card.hasAttribute("data-notification-preview-id")) return;
    if (dashboardCardContainsInteractiveControl(card, event.target)) return;
    openDashboardCard(card);
  });
  pageContent.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const card = event.target.closest("[data-dashboard-target]");
    if (!card || !pageContent.contains(card) || card.hasAttribute("data-notification-preview-id")) return;
    if (dashboardCardContainsInteractiveControl(card, event.target)) return;
    event.preventDefault();
    openDashboardCard(card);
  });
}

function weatherDashboardCard({ interactive = false } = {}) {
  const weather = statusData.weather || mockStatus.weather;
  const weatherScene = window.WinPlateWeatherScenes?.sceneForWeather(weather) || "unknown";
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
    <article class="dashboard-card weather-dashboard-card" data-weather-scene="${weatherScene}" data-module-id="weather" ${interactive ? dashboardCardNavigationAttributes("weather") : ""} ${notificationPreviewCardAttributes("qweather")} ${moduleHealthAttributes("weather")}>
      ${notificationPreviewMarkup("qweather")}
      ${weatherSceneMarkup(weather)}
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
        ${weatherLiveInsights(weather)}
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

function bindFloatingPinControls(pinButton) {
  if (pinButton) {
    pinButton.addEventListener("click", async (event) => {
      event.stopPropagation();
      floatingPinned = !floatingPinned;
      pinButton.classList.toggle("active", floatingPinned);
      await window.winplate.setFloatingPinned(floatingPinned);

      if (floatingPinned) {
        window.winplate.setFloatingPinInteractive(true);
      }
    });
  }

  document.onmousemove = (event) => {
    if (!floatingPinned) return;
    const target = document.elementFromPoint(event.clientX, event.clientY);
    const overFloatingControl = Boolean(target?.closest?.("#pin-button"));
    window.winplate.setFloatingPinInteractive(overFloatingControl);
  };

  document.onmouseleave = () => {
    if (floatingPinned) {
      window.winplate.setFloatingPinInteractive(false);
    }
  };
}

const DOCKED_ALERT_COLOR_RANK = Object.freeze({
  red: 4,
  yellow: 3,
  blue: 2,
  green: 1
});

function dockedWeatherAlertState(current = weatherAlerts, summary = notificationSummary) {
  const alerts = Array.isArray(current?.alerts) ? current.alerts : [];
  const items = Array.isArray(summary?.items) ? summary.items : [];
  const inactiveLifecycles = new Set(["resolved", "cancelled", "ended"]);
  return alerts
    .filter((alert) => !inactiveLifecycles.has(String(alert?.lifecycle || "").toLowerCase()))
    .map((alert) => {
      const alertId = String(alert?.id || "");
      const item = items.find((candidate) =>
        candidate?.source === "qweather"
        && (
          String(candidate.sourceId || "") === alertId
          || String(candidate.id || "") === `qweather:${alertId}`
        )
      );
      return {
        alert,
        color: item ? window.WinPlateNotificationDigest.notificationAlertColor(item) : null
      };
    })
    .sort((left, right) =>
      (DOCKED_ALERT_COLOR_RANK[right.color] || 0) - (DOCKED_ALERT_COLOR_RANK[left.color] || 0)
        || Number(right.alert.createdAt || 0) - Number(left.alert.createdAt || 0)
    )[0] || null;
}

function dockedUnreadMailCount(outline = mailOutline) {
  const items = Array.isArray(outline?.items) ? outline.items : [];
  return items.filter((item) => {
    const labels = Array.isArray(item?.labels) ? item.labels : [];
    return Boolean(item?.unread) || labels.includes("UNREAD");
  }).length;
}

function renderDockedFloating() {
  const weather = statusData.weather || mockStatus.weather;
  const weatherAlert = dockedWeatherAlertState();
  const weatherAlertColorClass = weatherAlert?.color ? ` alert-color-${weatherAlert.color}` : "";
  const unreadMailCount = dockedUnreadMailCount();
  const unreadMailLabel = unreadMailCount > 99 ? "99+" : String(unreadMailCount);
  document.body.className = "floating-body floating-body-docked";
  document.onmousemove = null;
  document.onmouseleave = null;
  appRoot.innerHTML = `
    <main class="floating-shell floating-shell-docked" id="floating-shell" aria-label="WinPlate 顶部吸附栏">
      <section class="status-capsule docked-capsule">
        <div class="docked-status-line">
          <div class="docked-module docked-weather" aria-label="天气">
            ${weatherIconMarkup(weather.icon)}
            <strong class="metric">${weather.temperature}°C</strong>
            <span class="weather-condition">${weather.condition}</span>
          </div>
          <span class="docked-alert-slot${weatherAlert ? weatherAlertColorClass : " is-empty"}"
            ${weatherAlert ? `aria-label="${escapeHtml(weatherAlert.alert.title || "天气预警")}"` : 'aria-hidden="true"'}>
            ${weatherAlert ? window.WinPlateSmartNotificationIcons.renderSmartNotificationIcon("alert-triangle") : ""}
          </span>
          <span class="docked-divider" aria-hidden="true"></span>
          <div class="docked-module docked-usage" aria-label="Usage">
            <span class="docked-usage-label">Usage</span>
            ${progressBar(statusData.codex.remainingPct, "usage-track")}
            <strong class="metric">${statusData.codex.remainingPct ?? "--"}%</strong>
          </div>
          <span class="docked-divider" aria-hidden="true"></span>
          <span class="docked-mail-status" aria-label="${unreadMailCount ? `${unreadMailCount} 封未读邮件` : "无未读邮件"}">
            ${window.WinPlateSmartNotificationIcons.renderSmartNotificationIcon("mail")}
            ${unreadMailCount ? `<span class="docked-mail-unread-badge">${unreadMailLabel}</span>` : ""}
          </span>
          <div class="docked-controls no-drag">
            <button class="restore-capsule-button" id="restore-capsule-button" type="button" aria-label="恢复浮动胶囊" title="恢复胶囊">
              <svg class="restore-capsule-icon" viewBox="0 0 24 24" aria-hidden="true">
                <rect class="restore-capsule-icon-back" x="8" y="4" width="12" height="12" rx="1.8"></rect>
                <rect class="restore-capsule-icon-front" x="4" y="8" width="12" height="12" rx="1.8"></rect>
              </svg>
            </button>
          </div>
        </div>
      </section>
    </main>`;
  updateProgressBars(appRoot);
  bindWeatherIconFallbacks(appRoot);

  const restoreButton = document.querySelector("#restore-capsule-button");

  restoreButton.addEventListener("click", async (event) => {
    event.stopPropagation();
    await window.winplate.restoreFloatingCapsule();
  });
}

function renderFloating() {
  if (floatingDocked) {
    renderDockedFloating();
    return;
  }
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
              ${sidebarCodexIcon}
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
                <button class="pin-button${floatingPinned ? " active" : ""}" id="pin-button" aria-label="Pin floating window" title="Pin / click-through">
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

  codexModule.addEventListener("click", () => window.winplate.showMainWindow("Agent"));
  codexModule.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      window.winplate.showMainWindow("Agent");
    }
  });
  codexModule.setAttribute("role", "link");
  codexModule.setAttribute("tabindex", "0");
  codexModule.setAttribute("aria-label", "Open Agent section");
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
        windows: statusData.codex.windows,
        supergrok: statusData.supergrok,
        deepseek: statusData.deepseek
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
      weather: { ...currentWeather },
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

  bindFloatingPinControls(pinButton);
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
          <span class="active-pill">${githubStatusLabel(github.status)}</span>
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
    const fiveHour = windows.fiveHour || null;
    const weekly = windows.sevenDay || (Number.isFinite(data?.remainingPct) ? data : null);
    const supergrok = data.supergrok || {};
    const deepseek = data.deepseek || {};
    const usageStatusLabel = (status) => {
      if (status === "Normal") return "正常";
      if (status === "Cached") return "缓存";
      if (status === "Unconfigured") return "未配置";
      if (status === "Unavailable") return "不可用";
      return status || "不可用";
    };
    const usageRow = (title, usage) => {
      const percentage = normalizePercent(usage?.remainingPct);
      if (percentage === null) return "";
      return `
        <div class="usage-compact-row">
          <span class="compact-title">${title}</span>
          <strong class="compact-percent">${percentage}%</strong>
          ${quotaStatusLamp(percentage)}
          <div class="compact-bar" aria-hidden="true">
            <span data-progress-value="${percentage}"></span>
          </div>
          <span class="compact-reset">${usage?.resetText || "--"}</span>
        </div>`;
    };
    const balances = Array.isArray(deepseek.balances) ? deepseek.balances : [];
    const balance = balances[0] || null;
    const deepseekAmount = balance
      ? `${balance.currency === "CNY" ? "¥" : balance.currency === "USD" ? "$" : ""}${
        Number.isFinite(Number(balance.totalBalance))
          ? Number(balance.totalBalance).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          : (balance.totalBalance || "--")
      }`
      : "¥--";
    // Keep DeepSeek in the same two-block height: balance sits left of status text.
    const deepseekStatus = usageStatusLabel(deepseek.status);

    appRoot.innerHTML = `
      <article class="codex-tooltip placement-${data.placement || "above"}" role="tooltip" aria-label="Agent 用量预览">
        <section class="codex-tooltip-block">
          <header>
            <strong>Codex</strong>
            <span>${usageStatusLabel(data.status)}</span>
          </header>
          <div class="codex-tooltip-rows">
            ${usageRow("5h", fiveHour)}
            ${usageRow("7d", weekly)}
          </div>
        </section>
        <section class="codex-tooltip-block">
          <header>
            <strong>SuperGrok</strong>
            <span>${usageStatusLabel(supergrok.status)}</span>
          </header>
          <div class="codex-tooltip-rows">
            ${usageRow("7d", supergrok)}
          </div>
        </section>
        <section class="codex-tooltip-block codex-tooltip-deepseek">
          <header>
            <strong>DeepSeek</strong>
            <span class="codex-tooltip-status-inline">
              <b>${escapeHtml(deepseekAmount)}</b>
              <i>${escapeHtml(deepseekStatus)}</i>
            </span>
          </header>
        </section>
      </article>`;
    updateProgressBars(appRoot);
    return;
  }

  if (data.type === "weather") {
    const previewWeather = data.weather && typeof data.weather === "object" ? data.weather : data;
    const metric = (label, value) => value === null || value === undefined || value === ""
      ? ""
      : `<div><span>${label}</span><strong>${value}</strong></div>`;
    appRoot.innerHTML = `
      <article class="weather-tooltip" role="tooltip" aria-label="天气详情">
        ${weatherSceneMarkup(previewWeather, { compact: true })}
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
    mountWeatherEffects(appRoot);
    return;
  }

  if (data.type === "notifications") {
    appRoot.innerHTML = window.WinPlateNotificationDigest.renderCapsuleTooltip(data.digest);
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

function qweatherServiceCard(official, failures, { interactive = false } = {}) {
  return `
    <article class="dashboard-card qweather-card" data-module-id="weather" ${interactive ? dashboardCardNavigationAttributes("weather") : ""} ${notificationPreviewCardAttributes("qweather")} ${moduleHealthAttributes("weather")}>
      ${notificationPreviewMarkup("qweather")}
      <div class="qweather-card-heading">
        <div class="card-icon">${qweatherIconMarkup("qweather-service-icon")}</div>
        <div class="card-actions">
          ${serviceHealthBadge(dashboardServiceHealthKind("weather"))}
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

function heartCard({ interactive = false } = {}) {
  const heart = statusData.heart || mockStatus.heart;
  const syncState = healthSyncStatus.state || "waiting";
  const connectionUrl = healthSyncStatus.connectionUrls?.[0] || "";
  return `
    <article class="dashboard-card heart-card" data-module-id="heart" ${interactive ? dashboardCardNavigationAttributes("heart") : ""} ${moduleHealthAttributes("heart")}>
      <div class="dashboard-card-heading">
        <div class="card-icon">♥</div>
        ${serviceHealthBadge(dashboardServiceHealthKind("heart"))}
      </div>
      <span>Health snapshot</span>
      <strong>${healthMetric(heart.heartRate)} <em>${heart.unit}</em></strong>
      <div class="health-metric-row"><span>Steps <strong>${healthMetric(heart.stepCount)}</strong></span><span>Active energy <strong>${healthMetric(heart.activeEnergy)} kcal</strong></span></div>
      <small>${escapeHtml(heart.source)} · ${escapeHtml(relativeUpdatedAt(heart.updatedAt))}</small>
      <div class="health-sync-status"><span class="status-dot state-${escapeHtml(syncState)}"></span>${escapeHtml(healthStateLabel(syncState))}</div>
      ${connectionUrl ? `<div class="health-pairing"><span>iPhone setup URL</span><code>${escapeHtml(connectionUrl)}</code></div>` : `<div class="health-pairing"><span>Open Health on iPhone</span><small>Copy the setup URL from this card after Windows starts the receiver.</small></div>`}
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
    <article class="dashboard-card github-card github-dashboard-card" data-module-id="github" ${dashboardCardNavigationAttributes("github")} ${notificationPreviewCardAttributes("github")} ${moduleHealthAttributes("github")}>
      ${notificationPreviewMarkup("github")}
      <div class="github-dashboard-top">
        <div class="github-dashboard-profile">
          <span class="github-dashboard-mark" aria-hidden="true">${githubCardIcon}</span>
          <div class="github-dashboard-identity">
            <strong>${github.name}</strong>
            <span>${github.username}</span>
          </div>
        </div>
        ${serviceHealthBadge(dashboardServiceHealthKind("github"))}
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

function dashboardCodexRow(title, data, { icon = "" } = {}) {
  const percentage = normalizePercent(data?.remainingPct);
  const resetText = data?.resetText ? `Resets in ${String(data.resetText).replace(/^in\s+/i, "")}` : "Reset unavailable";
  return `
    <div class="dashboard-codex-window">
      <div class="dashboard-codex-window-head">
        <span class="dashboard-codex-window-title">${icon}<span>${title}</span></span>
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
    ? (deepseek.status === "Normal" ? "余额可用" : `状态 ${deepseek.status || "未知"}`)
    : (deepseek.configured ? "余额暂不可用" : "未配置");
  return `
    <div class="dashboard-codex-window dashboard-deepseek-window">
      <div class="dashboard-codex-window-head">
        <span class="dashboard-codex-window-title">${deepseekBrandIcon}<span>DeepSeek</span></span>
        <strong class="deepseek-balance-value">${escapeHtml(amount)}</strong>
      </div>
      <small>${escapeHtml(meta)}</small>
    </div>`;
}

function dashboardCodexCard() {
  const windows = statusData.codex.windows || {};
  const fiveHour = windows.fiveHour || null;
  const sevenDay = windows.sevenDay
    || (Number.isFinite(statusData.codex?.remainingPct) ? statusData.codex : null);
  const supergrok = statusData.supergrok || mockStatus.supergrok;
  // Overview only: icon + service-health pill (no Agent title).
  return `
    <article class="dashboard-card codex-card dashboard-codex-card" data-module-id="codex" ${dashboardCardNavigationAttributes("codex")} ${moduleHealthAttributes("codex")}>
      <div class="dashboard-card-heading">
        <div class="card-icon codex-card-icon">${openaiBrandIcon}</div>
        ${serviceHealthBadge(dashboardServiceHealthKind("codex"))}
      </div>
      <div class="dashboard-codex-windows">
        ${fiveHour ? dashboardCodexRow("ChatGPT · 5 小时", fiveHour, { icon: openaiBrandIcon }) : ""}
        ${sevenDay ? dashboardCodexRow("ChatGPT · 7 天", sevenDay, { icon: openaiBrandIcon }) : dashboardCodexRow("ChatGPT · 7 天", {}, { icon: openaiBrandIcon })}
        ${dashboardCodexRow("SuperGrok · 7 天", supergrok, { icon: grokBrandIcon })}
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

const MAIL_PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "object-src 'none'",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "style-src 'unsafe-inline' https: http: data:",
  "img-src https: http: data: cid: blob:",
  "font-src https: http: data:",
  "media-src https: http: data: blob:"
].join("; ");

/**
 * Inject CSP only. HTML mail is always rendered in its designed light palette
 * (no invert) so text contrast and images stay correct in any app theme.
 */
function withMailPreviewCsp(html = "") {
  const headBits = [
    `<meta charset="utf-8">`,
    `<meta http-equiv="Content-Security-Policy" content="${MAIL_PREVIEW_CSP}">`,
    `<meta name="color-scheme" content="light">`
  ].join("");
  const value = String(html || "");
  if (!value.trim()) {
    return `<!doctype html><html><head>${headBits}</head><body></body></html>`;
  }
  if (/<head\b[^>]*>/i.test(value)) {
    return value.replace(/<head\b[^>]*>/i, (match) => `${match}${headBits}`);
  }
  if (/<html\b[^>]*>/i.test(value)) {
    return value.replace(
      /<html\b[^>]*>/i,
      (match) => `${match}<head>${headBits}</head>`
    );
  }
  return `<!doctype html>
<html>
<head>
  ${headBits}
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body>${value}</body>
</html>`;
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
  const isDark = resolvedTheme() === "dark";
  if (isPlainText) {
    // Plain text has no designer palette — adapt colors to the app theme.
    const plainColor = isDark ? "#e4e4e7" : "#111827";
    const plainBg = isDark ? "#18181b" : "#ffffff";
    return withMailPreviewCsp(`
<pre style="margin:0;padding:18px 20px;background:${plainBg};color:${plainColor};font:13px/1.65 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;white-space:pre-wrap;overflow-wrap:anywhere;">${escapeHtml(body)}</pre>
`);
  }
  // HTML mail: original markup/CSS only (never invert — keeps text and photos readable).
  return withMailPreviewCsp(body);
}

function mailDetailBody(message = {}) {
  if (message.htmlBody) {
    return `<iframe class="mail-detail-frame theme-html" sandbox="" referrerpolicy="no-referrer" srcdoc="${escapeHtml(mailIframeDocument(message.htmlBody, false))}"></iframe>`;
  }
  if (message.textBody) {
    const themeClass = resolvedTheme() === "dark" ? "theme-plain-dark" : "theme-plain-light";
    return `<iframe class="mail-detail-frame ${themeClass}" sandbox="" referrerpolicy="no-referrer" srcdoc="${escapeHtml(mailIframeDocument(message.textBody, true))}"></iframe>`;
  }
  return `<div class="mail-detail-empty">这封邮件没有可展示的正文。</div>`;
}

function closeMailDetail() {
  mailDetail = { open: false, loading: false, uid: null, requestId: null, message: null, error: "" };
}

function mailDetailSheet() {
  if (!mailDetail.open) return "";
  const message = mailDetail.message || {};
  const subject = mailDetail.loading
    ? "正在读取邮件..."
    : mailDetail.error
      ? "邮件读取失败"
      : message.subject || "(无主题)";
  const sender = message.from || message.sender || "";
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
  const meta = mailDetail.error || mailDetail.loading
    ? ""
    : `<div class="mail-detail-meta-inline">
        ${sender ? `<div><span>发件人</span><strong>${escapeHtml(sender)}</strong></div>` : ""}
        ${message.to ? `<div><span>收件人</span><strong>${escapeHtml(message.to)}</strong></div>` : ""}
        <div><span>时间</span><strong>${escapeHtml(message.date || mailTimeLabel(message.sentAt))}</strong></div>
        <div><span>状态</span><strong>${message.unread ? "未读" : "已读"}</strong></div>
      </div>`;
  return `
    <div class="mail-detail-backdrop" data-mail-detail-backdrop>
      <section
        class="mail-detail-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mail-detail-title"
        aria-label="邮件详情"
      >
        <header class="mail-detail-sheet-header">
          <div class="mail-detail-sheet-heading">
            <span>邮件详情</span>
            <h2 id="mail-detail-title">${escapeHtml(subject)}</h2>
            ${sender && !mailDetail.loading && !mailDetail.error
              ? `<p class="mail-detail-sender">${escapeHtml(sender)}</p>`
              : ""}
          </div>
          <button class="mail-detail-close" type="button" aria-label="关闭邮件详情">关闭</button>
        </header>
        ${meta}
        <section class="mail-detail-body">${body}</section>
        ${attachments}
        <footer class="mail-detail-sheet-footer">
          <button class="mail-mark-read-button" type="button" disabled>${message.unread ? "标记已读" : "已读"}</button>
          <button class="mail-open-external-button" type="button">在 QQ 邮箱中打开</button>
        </footer>
      </section>
    </div>`;
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
      {
        sourceLabel: notificationSourceLabel,
        relativeTime: relativeUpdatedAt,
        severityClass: notificationSeverityClass
      }
    );
    return `
      <aside id="notification-digest-drawer" class="notification-detail-drawer" role="dialog" aria-modal="true" aria-label="通知摘要">
        <header>
          <div><span>通知摘要</span><h2>${escapeHtml(digest.headline)}</h2></div>
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
  const sender = item.sender || "未知发件人";
  const subject = item.subject || "(无主题)";
  const summary = item.summary || item.snippet || "暂无可用摘要";
  const labelPills = mailLabelPills(labels);
  return `
    <article
      class="mail-outline-item ${unread ? "unread" : ""} ${String(uid) === String(mailHighlightedUid || "") ? "focused" : ""} ${uid ? "clickable" : ""}"
      data-mail-uid="${escapeHtml(uid)}"
      ${uid ? `role="button" tabindex="0" aria-label="预览邮件：${escapeHtml(subject)}"` : ""}
    >
      <div class="mail-outline-row">
        <strong class="mail-outline-sender">${escapeHtml(sender)}</strong>
        <h2 class="mail-outline-title">${escapeHtml(subject)}</h2>
      </div>
      <div class="mail-outline-summary-row">
        <p class="mail-outline-summary">${escapeHtml(summary)}</p>
        <time>${mailTimeLabel(item.sentAt)}</time>
      </div>
      ${labelPills ? `<footer><div class="mail-labels">${labelPills}</div></footer>` : ""}
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
      ${modulePageHeader({
        title: "邮件大纲",
        description: `最近 ${mailOutline.windowDays || mailSettings.windowDays || 30} 天收件箱摘要。`,
        className: "mail-page-heading",
        actions: `<div class="mail-heading-actions">
          <div class="mail-actions">
            <button
              class="refresh-button module-refresh-button mail-refresh-button ${mailRefreshInFlight ? "refreshing" : ""}"
              id="refresh-mail"
              type="button"
              aria-label="刷新邮件大纲"
              ${mailRefreshInFlight ? "disabled" : ""}
            >
              ${refreshIcon}
              <span>${mailRefreshInFlight ? "刷新中" : "刷新"}</span>
            </button>
            <button class="mail-connect-button" id="connect-mail" type="button">${mailSettings.connected ? "重新连接" : "连接 QQ 邮箱"}</button>
          </div>
        </div>`
      })}
      <div class="mail-status-bar">
        <span class="mail-status-pill state-${escapeHtml(mailOutline.availability)}">${mailStatusLabel()}</span>
        <span>${escapeHtml(mailOutline.query || "IMAP INBOX SINCE 30 days")}</span>
        <time>${relativeUpdatedAt(mailOutline.updatedAt)}</time>
      </div>
      ${stateNotice}
      ${list}
      ${mailDetailSheet()}
    </section>`;
}

function notificationContent() {
  const summary = normalizedNotifications();
  const items = notificationConversations();
  const unreadCount = items.filter((item) => item.unread).length;
  const filteredItems = window.WinPlateNotificationDigest.filterNotificationItems(items, notificationFilters);
  const sourceCounts = window.WinPlateNotificationDigest.notificationSourceCounts(items);
  const sourceChips = [{ source: "all", count: items.length }, ...sourceCounts].map(({ source, count }) => `
    <button class="notification-source-chip ${notificationFilters.source === source ? "active" : ""}"
      type="button" data-notification-source="${escapeHtml(source)}"
      aria-pressed="${notificationFilters.source === source}">
      <span>${source === "all" ? "" : renderNotificationSourceIcon(source)}${escapeHtml(source === "all" ? "全部" : notificationSourceLabel(source))}</span><small>${count}</small>
    </button>`).join("");
  const markReadIcon = window.WinPlateSmartNotificationIcons.renderSmartNotificationIcon("check-circle");
  const clearReadIcon = window.WinPlateSmartNotificationIcons.renderSmartNotificationIcon("x-circle");
  const testNotificationIcon = window.WinPlateSmartNotificationIcons.renderSmartNotificationIcon("bell");
  const notificationStateLabels = { all: "全部", unread: "未读", read: "已读" };
  const timeline = window.WinPlateNotificationDigest.renderNotificationTimeline(filteredItems, {
    selectedId: notificationSelection.id,
    sourceLabel: notificationSourceLabel,
    sourceIcon: renderNotificationSourceIcon,
    levelLabel: (levelOrItem) => (
      typeof levelOrItem === "object" && levelOrItem
        ? notificationSeverityLabel(levelOrItem)
        : notificationSeverityLabel({ level: levelOrItem })
    ),
    severityClass: notificationSeverityClass,
    absoluteTime: notificationClockLabel,
    relativeTime: relativeUpdatedAt,
    inlineDetail: (conversation) => notificationInlineDetail(conversation)
  });
  return `
    <section class="notifications-page" data-module-id="notifications" ${moduleHealthAttributes("notifications")}>
      ${modulePageHeader({
        title: "通知中心",
        description: "统一收纳邮件、天气预警和本地任务提示，帮助你快速理解变化并采取行动。",
        className: "notifications-page-heading",
        actions: `<div class="notification-actions">
          <strong class="notification-unread-count"><i aria-hidden="true"></i>${unreadCount} 未读</strong>
          <button class="notification-clear-button notification-header-action" id="mark-all-notifications-read" type="button" ${unreadCount ? "" : "disabled"}>${markReadIcon}<span>全部标记已读</span></button>
          <button class="notification-clear-button notification-header-action" id="clear-read-notifications" type="button" ${items.some((item) => !item.unread) ? "" : "disabled"}>${clearReadIcon}<span>清空已读</span></button>
        </div>`
      })}
      <div class="notification-source-filters">
        <div class="notification-source-chip-list">${sourceChips}</div>
        <div class="notification-filter-tools">
          <span class="notification-sort-label">最新优先</span>
          <div class="notification-state-filter"><span>显示</span><details class="notification-state-menu">
            <summary>${notificationStateLabels[notificationFilters.state] || notificationStateLabels.all}</summary>
            <div role="menu" aria-label="通知状态筛选">
              ${Object.entries(notificationStateLabels).map(([value, label]) => `<button type="button" role="menuitemradio" aria-checked="${notificationFilters.state === value}" class="${notificationFilters.state === value ? "active" : ""}" data-notification-state-choice="${value}">${label}</button>`).join("")}
            </div>
          </details></div>
          <button class="notification-test-button" id="push-test-notification" type="button">${testNotificationIcon}<span>测试</span></button>
        </div>
      </div>
      ${timeline}
    </section>`;
}

function notificationInlineDetail(conversation = notificationConversationForId(notificationSelection.id)) {
  const payload = notificationSelection.data || {};
  const detail = payload.detail || {};
  const notification = payload.notification || {};
  const body = notificationSelection.loading
    ? '<div class="notification-detail-state">正在加载通知详情...</div>'
    : notificationSelection.error
      ? `<div class="notification-detail-state error">${escapeHtml(notificationSelection.error)}</div><button type="button" data-notification-detail-retry="${escapeHtml(notificationSelection.id)}">重试</button>`
      : `<div class="notification-detail-body"><p>${escapeHtml(detail.body || notification.body || notification.message || notification.title || "暂无详细内容。").replaceAll("\n", "<br>")}</p></div>`;
  const actions = Array.isArray(payload.actions)
    ? payload.actions
      .filter((action) => action.type === "navigate" || action.type === "markRead")
      .map((action) => ({
        ...action,
        label: action.type === "navigate"
          ? "打开来源"
          : notification.unread ? "标记已读" : "已读"
      }))
    : [];
  const updates = Number(conversation?.updateCount) > 1 && Array.isArray(conversation?.updates)
    ? `<section class="notification-conversation-updates" aria-label="本轮更新"><strong>本轮更新</strong><ol>${conversation.updates.map((item) => `<li><time>${escapeHtml(absoluteTimeLabel(item.createdAt))}</time><p>${escapeHtml(item.body || item.message || item.title || "暂无详细内容。").replaceAll("\n", "<br>")}</p></li>`).join("")}</ol></section>`
    : "";
  const resolvedNotification = { ...(conversation || {}), ...(notification || {}) };
  const detailMetadata = `<dl class="notification-inline-summary-meta">
    <div><dt>来源</dt><dd>${escapeHtml(notificationSourceLabel(resolvedNotification.source))}</dd></div>
    <div><dt>状态</dt><dd>${resolvedNotification.unread ? "未读" : "已读"}</dd></div>
    <div><dt>级别</dt><dd>${escapeHtml(notificationSeverityLabel(resolvedNotification))}</dd></div>
    <div><dt>标识</dt><dd title="${escapeHtml(resolvedNotification.id || "")}">${escapeHtml(resolvedNotification.id || "-")}</dd></div>
  </dl>`;
  return `<section class="notification-inline-summary" aria-label="通知摘要">
    <div class="notification-inline-summary-grid">
      ${detailMetadata}
      <div class="notification-inline-summary-content">
        <div class="notification-inline-summary-body">${body}</div>
        ${updates}
        ${notificationActionFeedback ? `<p class="notification-detail-feedback" role="status">${escapeHtml(notificationActionFeedback)}</p>` : ""}
        ${actions.length ? `<footer class="notification-inline-summary-actions">${actions.map(notificationActionButton).join("")}</footer>` : ""}
      </div>
    </div>
  </section>`;
}

function updateNotificationAcknowledgement() {
  const current = notificationItemsForDigest().find((item) => String(item.id) === String(notificationAcknowledgement.id));
  if (current && window.WinPlateNotificationDigest.isAcknowledgementRequired(current)) return;
  const candidate = notificationItemsForDigest()
    .filter((item) => window.WinPlateNotificationDigest.isAcknowledgementRequired(item))
    .filter((item) => !dismissedNotificationAcknowledgements.has(String(item.id)))
    .sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0))[0];
  notificationAcknowledgement = candidate
    ? { id: String(candidate.id), returnFocus: document.activeElement instanceof HTMLElement ? document.activeElement : null }
    : { id: null, returnFocus: null };
}

function notificationAcknowledgementModal() {
  const item = notificationItemsForDigest().find((entry) => String(entry.id) === String(notificationAcknowledgement.id));
  if (!item) return "";
  return `<div class="notification-acknowledgement-backdrop" data-notification-ack-backdrop>
    <section class="notification-acknowledgement-modal" role="dialog" aria-modal="true" aria-labelledby="notification-ack-title" aria-describedby="notification-ack-body">
      <button class="notification-acknowledgement-close" type="button" data-notification-ack-dismiss aria-label="暂不确认">×</button>
      <p>QWEATHER · 红色预警</p>
      <h2 id="notification-ack-title">${escapeHtml(item.title)}</h2>
      <p id="notification-ack-body">${escapeHtml(item.body || "请关注最新天气预警信息。")}</p>
      <button class="notification-acknowledgement-confirm" type="button" data-notification-acknowledge="${escapeHtml(item.id)}">我已知悉</button>
    </section>
  </div>`;
}

function dashboardContent(section) {
  const failures = qweatherOfficialStats?.errors ?? 0;
  const official = qweatherOfficialStats
    ? `<div class="qweather-official"><span>过去24小时：${qweatherOfficialStats.total}次</span><span>成功：${qweatherOfficialStats.success}</span><span>错误：${qweatherOfficialStats.errors}</span><small>截至 ${qweatherOfficialStats.asOf}</small></div>`
    : `<small class="qweather-message">${qweatherUsageMessage || "官方数据可能延迟 1 小时或更久"}</small>`;
  const dashboardRenderers = {
    github: () => dashboardGithubCard(),
    codex: () => dashboardCodexCard(),
    heart: () => heartCard({ interactive: true }),
    weather: () => qweatherServiceCard(official, failures, { interactive: true })
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
    Dashboard: `${modulePageHeader({
      title: `下午好，${statusData.github.name}`,
      description: "实时查看工作区状态。",
      className: "dashboard-page-heading",
      actions: `<div class="dashboard-heading-actions">
        <button
          class="refresh-button module-refresh-button dashboard-refresh-button ${dashboardRefreshInFlight ? "refreshing" : ""}"
          id="refresh-dashboard"
          type="button"
          aria-label="刷新仪表盘数据"
          ${dashboardRefreshInFlight ? "disabled" : ""}
        >
          ${refreshIcon}
          <span>${dashboardRefreshInFlight ? "刷新中" : "刷新"}</span>
        </button>
      </div>`
    })}${cards}`,
    GitHub: githubContent(),
    Agent: codexContent(),
    // Backward-compat for any stale section value before the Agent rename.
    Codex: codexContent(),
    Mail: mailContent(),
    Notifications: notificationContent(),
    Heart: `<section class="health-page">${modulePageHeader({ title: "Health snapshot", description: `${healthStateLabel(healthSyncStatus.state)} · ${statusData.heart.source}.` })}${heartCard()}</section>`,
    QWeather: `${modulePageHeader({ title: "天气与服务状态", description: "实时天气、未来预报与 API 配额使用情况。" })}${qweatherCards}`,
    Settings: `<div class="settings-page"><div class="settings-content"><div class="page-heading"><h1>设置</h1><span>管理外观、工作区模块与本地服务连接。</span></div>
      <section class="settings-section" id="settings-appearance" data-settings-section data-settings-label="外观">
        <div class="settings-section-heading"><div><p>外观</p><h2>主题</h2></div></div>
        <div class="settings-panel appearance-panel">${themeSelector()}${accentSelector()}</div>
      </section>
      <section class="settings-section" id="settings-general" data-settings-section data-settings-label="工作区">
        <div class="settings-section-heading"><div><p>工作区</p><h2>模块与显示</h2><small>按使用场景决定主界面与浮动窗口保留哪些信息。</small></div></div>
        ${productSettingsPanel()}
      </section>
      <section class="settings-section settings-services-section" id="settings-services" data-settings-section data-settings-label="连接服务">
        <div class="settings-section-heading"><div><p>连接</p><h2>连接服务</h2><small>集中管理模块使用的本地凭据与连接状态。</small></div></div>
        <section class="settings-services-summary" aria-labelledby="settings-services-summary-title">
          <div class="settings-services-summary-copy">
            <span class="settings-services-summary-icon">${window.WinPlateSmartNotificationIcons.renderSmartNotificationIcon("plug")}</span>
            <span>
              <strong id="settings-services-summary-title">Local service connections</strong>
              <small>Sensitive values stay blank and are stored encrypted for the current Windows user</small>
            </span>
          </div>
          <dl class="settings-services-summary-metrics">
            <div><dt data-settings-services-ready-count>0</dt><dd>Available</dd></div>
            <div><dt>4</dt><dd>All services</dd></div>
            <div><dt>Local</dt><dd>Storage</dd></div>
            <div><dt>Encrypted</dt><dd>Credentials</dd></div>
          </dl>
        </section>
        <div class="settings-service-nav" role="tablist" aria-label="Connected services">
          ${settingsServiceNavButton("github", appSettings.integrations.github?.hasToken ? "Configured" : "Public data")}
          ${settingsServiceNavButton("weather", weatherSettings.hasApiKey ? "Configured" : "Not configured")}
          ${settingsServiceNavButton("deepseek", deepseekSettings.hasApiKey ? "Configured" : "Not configured")}
          ${settingsServiceNavButton("mail", mailSettings.connected ? "Connected" : mailSettings.configured ? "Configured" : "Not configured")}
        </div>
      <div class="settings-service-panel" id="settings-github" data-settings-service data-settings-service-label="GitHub">
        ${githubSettingsPanel()}
      </div>
      <div class="settings-service-panel" id="settings-weather" data-settings-service data-settings-service-label="QWeather">
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
          <div class="weather-settings-actions">
            <div class="weather-settings-statuses">
              <small id="weather-service-status">天气服务：正在读取...</small>
            </div>
            <button type="submit">保存配置</button>
          </div>
        </form>
      </div>
      <div class="settings-service-panel" id="settings-deepseek" data-settings-service data-settings-service-label="DeepSeek">
        <form class="settings-panel weather-settings-panel" id="deepseek-settings-form">
          <fieldset>
            <legend><strong>DeepSeek API</strong><small>用于在 Agent 模块中读取账户余额</small></legend>
            <label>
              <span><strong>API Key</strong><small>仅保存在本地设备中，留空保持原值</small></span>
              <input id="deepseek-api-key" type="password" autocomplete="off">
            </label>
          </fieldset>
          <div class="weather-settings-actions">
            <div class="weather-settings-statuses">
              <small id="deepseek-settings-status">DeepSeek API：正在读取...</small>
            </div>
            <button type="submit">保存配置</button>
          </div>
        </form>
      </div>
      <div class="settings-service-panel" id="settings-mail" data-settings-service data-settings-service-label="QQ 邮箱">
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
          </fieldset>
          <div class="weather-settings-actions">
            <div class="weather-settings-statuses">
              <small id="mail-settings-status" class="${mailSettings.configured ? "configured" : ""}">QQ 邮箱配置：${mailSettings.configured ? "已配置" : "未配置"}</small>
              <small id="mail-connection-status" class="${mailSettings.connected ? "configured" : ""}">IMAP：${mailSettings.connected ? "已连接" : "未连接"}</small>
            </div>
            <div class="mail-settings-actions">
              <button type="submit">保存配置</button>
              <button type="button" id="settings-connect-mail">${mailSettings.connected ? "重新连接" : "连接 QQ 邮箱"}</button>
            </div>
          </div>
        </form>
      </div>
      </section></div></div>`
  };
  return content[section];
}

function relativeUpdatedAt(timestamp) {
  if (!timestamp) return "尚未更新";
  const normalizedTimestamp = healthTimestamp(timestamp);
  if (!normalizedTimestamp) return "尚未更新";
  const minutes = Math.max(0, Math.floor((Date.now() - normalizedTimestamp) / 60_000));
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}小时前` : `${Math.floor(hours / 24)}天前`;
}

function usageWindowCard(title, data) {
  const percentage = data?.remainingPct;
  const displayPercentage = percentage ?? "--";
  const resetLabel = data?.resetText
    ? `重置 ${String(data.resetText).replace(/^in\s+/i, "")}`
    : "重置时间不可用";
  return `
    <article class="usage-window-card">
      <span>${title}</span>
      <strong>${displayPercentage}%</strong>
      <small>${resetLabel}</small>
      ${progressBar(percentage, "codex-progress")}
    </article>`;
}

function agentStatusMeta(usage = {}) {
  // Align with overview service-health: 服务正常 (green) / 缓存 (yellow).
  switch (usage.status) {
    case "Normal":
      return { kind: "live", text: "服务正常" };
    case "Cached":
      return { kind: "cached", text: "缓存" };
    case "Unconfigured":
      return { kind: "loading", text: "未配置" };
    case "Unavailable":
      return { kind: "error", text: "不可用" };
    default:
      return { kind: "loading", text: usage.status || "读取中" };
  }
}

function formatTokenCount(value) {
  const tokens = Math.max(0, Math.round(Number(value) || 0));
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}

/** Axis labels: hour mode shows HH:mm when density allows, else M/D. */
function formatAgentAxisLabel(value, { showHourLabels = false } = {}) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const month = date.getMonth() + 1;
  const day = date.getDate();
  if (!showHourLabels) return `${month}/${day}`;
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${hour}:${minute}`;
}

function formatAgentTooltipDate(value, { showHourLabels = false } = {}) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const month = date.getMonth() + 1;
  const day = date.getDate();
  if (!showHourLabels) return `${month}/${day}`;
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")} ${hour}:${minute}`;
}

function agentChartLabelIndexes(count) {
  if (count <= 0) return [];
  const labelCount = Math.min(6, count);
  if (labelCount <= 1) return [0];
  return Array.from({ length: labelCount }, (_, index) => (
    Math.round((index * (count - 1)) / (labelCount - 1))
  ));
}

function agentTokenChartSvg(buckets = [], tint = "#4f8cff", granularity = "hour") {
  // Left Y axis + bottom sparse X labels (shared product layout).
  const width = 560;
  const chartHeight = 88;
  const verticalAxisWidth = 32;
  const horizontalInset = 4;
  const bottomLabelSpace = 28;
  const height = chartHeight + bottomLabelSpace;
  const plotOriginX = verticalAxisWidth + horizontalInset;
  const plotWidth = Math.max(1, width - plotOriginX - horizontalInset);
  const plotHeight = chartHeight;
  const showHourLabels = granularity === "hour" && buckets.length <= 48;
  const values = buckets.map((bucket) => Math.max(0, Number(bucket.tokens) || 0));
  const maxTokens = Math.max(1, ...values);
  if (!values.length) {
    return `<div class="agent-token-chart-empty">暂无 Token 用量数据</div>`;
  }

  const xPosition = (index) => (
    values.length === 1 ? plotWidth / 2 : (plotWidth * index) / (values.length - 1)
  );
  const yPosition = (tokens) => {
    const ratio = Math.min(1, Math.max(0, tokens / maxTokens));
    return plotHeight * (1 - ratio);
  };

  const points = values.map((tokens, index) => {
    const x = plotOriginX + xPosition(index);
    const y = yPosition(tokens);
    return {
      x,
      y,
      tokens,
      label: formatAgentTooltipDate(buckets[index]?.start, { showHourLabels })
    };
  });
  const polyline = points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const area = `M ${plotOriginX} ${plotHeight} L ${polyline} L ${plotOriginX + plotWidth} ${plotHeight} Z`;
  // fraction 0 at top = maxTokens, fraction 1 at bottom = 0
  const yTicks = [0, 0.5, 1].map((fraction) => {
    const tokens = Math.round(maxTokens * (1 - fraction));
    const y = plotHeight * fraction;
    return { y, label: formatTokenCount(tokens), solid: fraction === 1 };
  });
  const xLabels = agentChartLabelIndexes(buckets.length).map((index) => ({
    x: plotOriginX + xPosition(index),
    label: formatAgentAxisLabel(buckets[index]?.start, { showHourLabels })
  }));
  const lastPoint = points.at(-1);
  const payload = encodeURIComponent(JSON.stringify(points.map((point) => ({
    x: point.x,
    y: point.y,
    tokens: point.tokens,
    label: point.label
  }))));

  return `
    <div class="agent-token-chart" data-agent-chart-root data-agent-chart-points="${payload}" data-agent-chart-width="${width}" data-agent-chart-plot-origin-x="${plotOriginX}" data-agent-chart-plot-width="${plotWidth}">
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Token 使用趋势" preserveAspectRatio="xMidYMid meet">
        ${yTicks.map((tick) => `
          <line
            x1="${plotOriginX}"
            y1="${tick.y.toFixed(1)}"
            x2="${plotOriginX + plotWidth}"
            y2="${tick.y.toFixed(1)}"
            class="agent-token-grid ${tick.solid ? "solid" : ""}"
          ></line>
          <text x="${(verticalAxisWidth / 2).toFixed(1)}" y="${(tick.y + 3).toFixed(1)}" class="agent-token-y-label" text-anchor="middle">${escapeHtml(tick.label)}</text>
        `).join("")}
        <path d="${area}" fill="${tint}" fill-opacity="0.09"></path>
        <polyline fill="none" stroke="${tint}" stroke-opacity="0.92" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="${polyline}"></polyline>
        ${lastPoint ? `<circle cx="${lastPoint.x.toFixed(1)}" cy="${lastPoint.y.toFixed(1)}" r="3.5" fill="${tint}"></circle>` : ""}
        ${xLabels.map((item) => `
          <text x="${item.x.toFixed(1)}" y="${(plotHeight + 18).toFixed(1)}" class="agent-token-x-label" text-anchor="middle">${escapeHtml(item.label)}</text>
        `).join("")}
        <line class="agent-token-hover-guide" x1="${plotOriginX}" y1="0" x2="${plotOriginX}" y2="${plotHeight}" visibility="hidden"></line>
        <circle class="agent-token-hover-dot" cx="${plotOriginX}" cy="0" r="4" fill="${tint}" visibility="hidden"></circle>
      </svg>
      <div class="agent-token-hover-card" hidden>
        <span data-agent-hover-time></span>
        <strong data-agent-hover-tokens>--</strong>
      </div>
    </div>`;
}

function agentTokenUsageCharts(cardId, usage, tint) {
  const granularity = agentChartGranularity[cardId] || "hour";
  const buckets = granularity === "day" ? (usage?.daily || []) : (usage?.hourly || []);
  const available = Boolean(usage?.available || usage?.isAvailable);
  const total = granularity === "hour"
    ? (Number(usage?.hourlyTotalTokens) || buckets.reduce((sum, bucket) => sum + (Number(bucket.tokens) || 0), 0))
    : (Number(usage?.totalTokens) || 0);
  const unit = granularity === "hour" ? "小时" : "天";
  const grainTitle = granularity === "hour" ? "每小时" : "每日";
  const summary = available
    ? `共 ${buckets.length} ${unit} · ${formatTokenCount(total)}`
    : "暂无数据";
  return `
    <div class="agent-token-usage" data-agent-chart="${escapeHtml(cardId)}">
      <div class="agent-token-usage-head">
        <strong>使用趋势</strong>
        <div class="agent-token-granularity" role="group" aria-label="趋势粒度">
          <button type="button" data-agent-granularity="hour" class="${granularity === "hour" ? "active" : ""}" aria-pressed="${granularity === "hour"}">每小时</button>
          <button type="button" data-agent-granularity="day" class="${granularity === "day" ? "active" : ""}" aria-pressed="${granularity === "day"}">每日</button>
        </div>
        <span class="agent-token-summary">${escapeHtml(summary)}</span>
      </div>
      ${available && buckets.length
        ? `<div class="agent-token-chart-block"><span class="agent-token-grain-title">${grainTitle}</span>${agentTokenChartSvg(buckets, tint, granularity)}</div>`
        : `<div class="agent-token-chart-empty">${available ? "暂无 Token 用量数据" : "未读取到本地日志（检查 ~/.codex/logs*.sqlite）"}</div>`}
    </div>`;
}

function agentQuotaCard({
  id,
  name,
  via,
  icon,
  primary,
  secondary,
  status,
  progress = null,
  tokenUsage = null,
  tint = "#4f8cff",
  featured = false,
  updatedAt = null
}) {
  const meta = agentStatusMeta(status);
  return `
    <article class="agent-quota-card ${featured ? "agent-quota-card-featured" : ""}" data-agent-card="${escapeHtml(id)}">
      <header class="agent-quota-card-head">
        <div class="agent-quota-identity">
          <span class="agent-quota-icon">${icon}</span>
          <div>
            <strong>${escapeHtml(name)}</strong>
            ${via ? `<small>${escapeHtml(via)}</small>` : ""}
          </div>
        </div>
        <div class="agent-quota-head-meta">
          <span class="agent-quota-update">${escapeHtml(relativeUpdatedAt(updatedAt))}</span>
          ${serviceHealthBadge(meta.kind)}
        </div>
      </header>
      <div class="agent-quota-primary ${meta.kind === "loading" || meta.kind === "error" ? "muted" : ""}">${escapeHtml(primary)}</div>
      <p class="agent-quota-secondary">${escapeHtml(secondary)}</p>
      ${progress == null ? "" : progressBar(progress, "agent-quota-progress")}
      ${tokenUsage ? agentTokenUsageCharts(id, tokenUsage, tint) : ""}
    </article>`;
}

function buildAgentUsageItems() {
  const windows = statusData.codex.windows || {};
  const sevenDay = windows.sevenDay
    || (Number.isFinite(statusData.codex?.remainingPct) ? statusData.codex : null);
  const fiveHour = windows.fiveHour || null;
  const codexStatus = statusData.codex || {};
  const deepseek = statusData.deepseek || {};
  const supergrok = statusData.supergrok || mockStatus.supergrok;
  const balance = primaryDeepSeekBalance(deepseek);
  const amount = balance
    ? `${deepseekCurrencySymbol(balance.currency)}${formatDeepSeekBalance(balance)}`
    : "¥--";

  const chatSecondary = [
    "7 天剩余",
    sevenDay?.resetText ? `重置 ${String(sevenDay.resetText).replace(/^in\s+/i, "")}` : null,
    fiveHour && Number.isFinite(fiveHour.remainingPct)
      ? `5 小时 ${Math.round(fiveHour.remainingPct)}%`
      : null
  ].filter(Boolean).join(" · ");

  const grokSecondary = [
    "剩余",
    supergrok.resetText ? `重置 ${String(supergrok.resetText).replace(/^in\s+/i, "")}` : null,
    supergrok.subscriptionTier || null
  ].filter(Boolean).join(" · ");

  const deepSecondary = deepseek.status === "Normal"
    ? `正常 · ${relativeUpdatedAt(deepseek.updatedAt)}`
    : deepseek.configured
      ? (deepseek.status === "Unconfigured" ? "未配置" : "余额暂不可用")
      : "请先在设置中配置 API Key";

  return [
    {
      id: "chatgpt",
      name: "ChatGPT",
      via: "via Codex",
      icon: openaiBrandIcon,
      primary: Number.isFinite(sevenDay?.remainingPct) ? `${Math.round(sevenDay.remainingPct)}%` : "--%",
      secondary: chatSecondary || "7 天剩余",
      status: codexStatus,
      progress: sevenDay?.remainingPct ?? null,
      tokenUsage: codexTokenUsage,
      tint: "#4f8cff",
      featured: true,
      updatedAt: codexStatus.updatedAt
    },
    {
      id: "supergrok",
      name: "SuperGrok",
      via: "via Grok CLI",
      icon: grokBrandIcon,
      primary: Number.isFinite(supergrok?.remainingPct) ? `${Math.round(supergrok.remainingPct)}%` : "--%",
      secondary: grokSecondary || "剩余",
      status: supergrok,
      progress: supergrok?.remainingPct ?? null,
      tokenUsage: superGrokTokenUsage,
      tint: "#f59e0b",
      featured: true,
      updatedAt: supergrok.updatedAt
    },
    {
      id: "deepseek",
      name: "DeepSeek",
      via: null,
      icon: deepseekBrandIcon,
      primary: amount,
      secondary: deepSecondary,
      status: deepseek,
      progress: null,
      tokenUsage: null,
      tint: "#8b5cf6",
      featured: false,
      updatedAt: deepseek.updatedAt
    }
  ];
}

function deepseekCompactSection() {
  const item = buildAgentUsageItems().find((entry) => entry.id === "deepseek");
  return agentQuotaCard(item);
}

function superGrokUsageSection() {
  const item = buildAgentUsageItems().find((entry) => entry.id === "supergrok");
  return agentQuotaCard(item);
}

function codexContent() {
  const items = buildAgentUsageItems();
  const featured = items.filter((item) => item.featured);
  const compact = items.filter((item) => !item.featured);
  return `
    <div class="agent-workspace" data-module-id="codex" ${moduleHealthAttributes("codex")}>
      ${modulePageHeader({
        title: "Agent",
        description: "ChatGPT、DeepSeek、SuperGrok 的用量与额度（统一展示剩余）",
        className: "codex-page-header agent-page-header",
        actions: `<button
          class="refresh-button module-refresh-button agent-refresh-button ${agentRefreshInFlight ? "refreshing" : ""}"
          id="refresh-agent"
          type="button"
          aria-label="刷新 Agent 用量"
          ${agentRefreshInFlight ? "disabled" : ""}
        >${refreshIcon}<span>${agentRefreshInFlight ? "刷新中" : "刷新用量"}</span></button>`
      })}
      <div class="agent-quota-stack">
        ${featured.map((item) => agentQuotaCard(item)).join("")}
      </div>
      <div class="agent-quota-grid">
        ${compact.map((item) => agentQuotaCard(item)).join("")}
      </div>
    </div>`;
}

function renderMain() {
  if (currentSection === "Codex") currentSection = "Agent";
  const previousMainContent = document.querySelector(".main-content");
  const previousScrollPosition = previousMainContent
    ? { top: previousMainContent.scrollTop, left: previousMainContent.scrollLeft }
    : null;
  document.body.className = "main-body platform-win32";
  applyMainTheme();
  const detailModules = window.WinPlateModuleRegistry.modulesForView("detail", appSettings.modules);
  const sectionLabels = new Map([["Dashboard", "概览"], ...detailModules.map((module) => [module.section, module.title])]);
  const sections = [
    "Dashboard",
    ...detailModules
      .map((module) => module.section)
      .filter(Boolean)
  ];
  if (currentSection !== "Dashboard" && currentSection !== "Settings" && !sections.includes(currentSection)) {
    currentSection = "Dashboard";
  }
  const shellSidebarState = currentSection === "Settings" ? "settings" : sidebarCollapsed ? "collapsed" : "expanded";
  appRoot.innerHTML = `
    <div class="main-window-shell shell-sidebar-${shellSidebarState}">
      <header class="app-titlebar">
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
      </header>
      <div class="workspace ${currentSection === "Settings" ? "settings-workspace" : ""} ${currentSection !== "Settings" && sidebarCollapsed ? "sidebar-collapsed" : ""}">
        <aside class="sidebar">
          ${currentSection === "Settings" ? settingsSidebarContent() : `<div class="sidebar-top">
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
          <nav>${sections.map((item) => {
            const label = sectionLabels.get(item) || item;
            return `<button class="${item === currentSection ? "active" : ""}" data-section="${item}" title="${escapeHtml(label)}"><i>${item === "Dashboard" ? dashboardIcon : item === "GitHub" ? githubIcon : item === "Agent" ? sidebarCodexIcon : item === "Mail" ? mailIcon : item === "Notifications" ? notificationIcon : item === "Heart" ? "♥" : item === "QWeather" ? qweatherIconMarkup() : "⚙"}</i><span class="nav-label">${escapeHtml(label)}</span></button>`;
          }).join("")}</nav>
          <div class="sidebar-footer">
            <button class="sidebar-settings ${currentSection === "Settings" ? "active" : ""}" data-section="Settings" title="Settings" aria-label="设置">
              <i>${settingsNavIcon}</i>
              <span class="nav-label">设置</span>
            </button>
          </div>`}
        </aside>
        <main class="main-content ${currentSection === "Notifications" ? "notifications-main-content" : ""}">
          <section id="page-content">${dashboardContent(currentSection)}</section>
        </main>
      </div>
      <div class="refresh-notice-region" id="refresh-notice-region" aria-live="polite" aria-atomic="true"></div>
      ${notificationAcknowledgementModal()}`;
  updateProgressBars(appRoot);
  bindWeatherIconFallbacks(appRoot);
  if (notificationAcknowledgement.id) {
    queueMicrotask(() => document.querySelector("[data-notification-acknowledge]")?.focus?.());
  }
  if (previousScrollPosition) {
    document.querySelector(".main-content").scrollTo(previousScrollPosition);
  }

  document.querySelectorAll("[data-section]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextSection = button.dataset.section;
      if (mailDetail.open && nextSection !== "Mail") {
        closeMailDetail();
      }
      const crossesSettingsWorkspace = (currentSection === "Settings") !== (nextSection === "Settings");
      if (crossesSettingsWorkspace) {
        currentSection = nextSection;
        renderMain();
        return;
      }
      document.querySelectorAll("[data-section].active").forEach((activeButton) => activeButton.classList.remove("active"));
      button.classList.add("active");
      currentSection = nextSection;
      document.querySelector("#page-content").innerHTML = dashboardContent(nextSection);
      updateProgressBars(document.querySelector("#page-content"));
      bindThemeControls();
      bindSettingsNavigation();
      bindProductSettings();
      bindGithubSettings();
      bindWeatherSettings();
      bindWeatherLocationSettings();
      bindDeepSeekSettings();
      bindDashboardControls();
      bindGithubControls();
      bindQWeatherUsageControls();
      bindMailControls();
      bindNotificationControls();
      bindNotificationPreviewCards();
      mountWeatherEffects(document.querySelector("#page-content"));
    });
  });
  const pageContent = document.querySelector("#page-content");
  bindDashboardCardNavigation(pageContent);
  pageContent.onclick = (event) => {
    const githubUrlButton = event.target.closest("[data-open-github-url]");
    if (githubUrlButton && pageContent.contains(githubUrlButton)) {
      const url = githubUrlButton.dataset.openGithubUrl;
      if (url) window.winplate.openGithubProfile(url);
      return;
    }
    const contributionMonthButton = event.target.closest("[data-contribution-month]");
    if (contributionMonthButton && pageContent.contains(contributionMonthButton)) {
      selectedContributionMonth = contributionMonthButton.dataset.contributionMonth;
      selectedContributionDate = null;
      selectedContributionRepository = null;
      githubContributionRequestId += 1;
      updateMainStatusDom("github");
      return;
    }
    const contributionButton = event.target.closest("[data-contribution-date]");
    if (contributionButton && pageContent.contains(contributionButton)) {
      const contributionDate = contributionButton.dataset.contributionDate;
      selectedContributionDate = selectedContributionDate === contributionDate ? null : contributionDate;
      selectedContributionRepository = null;
      updateMainStatusDom("github");
      return;
    }
    const todayButton = event.target.closest("[data-month-today]");
    if (todayButton && pageContent.contains(todayButton)) {
      const months = githubContributionMonths(normalizeGithub(statusData.github));
      selectedContributionMonth = months.at(-1)?.key || null;
      selectedContributionDate = null;
      selectedContributionRepository = null;
      pageContent.innerHTML = dashboardContent(currentSection);
      bindGithubControls();
      return;
    }
    const monthButton = event.target.closest("[data-month-direction]");
    if (!monthButton || !pageContent.contains(monthButton) || monthButton.disabled) return;
    changeGithubContributionMonth(Number(monthButton.dataset.monthDirection));
  };
  pageContent.onchange = (event) => {
    const repositorySelect = event.target.closest("[data-github-contribution-repository]");
    if (!repositorySelect || !pageContent.contains(repositorySelect)) return;
    selectedContributionRepository = repositorySelect.value;
    const key = selectedContributionDate
      ? `date:${selectedContributionDate}`
      : selectedContributionMonth
        ? `month:${selectedContributionMonth}`
        : "";
    const detail = githubContributionDetailCache.get(key);
    const panel = document.querySelector("#github-contribution-activity");
    if (detail && panel) panel.innerHTML = renderGithubContributionActivity(detail);
  };
  bindThemeControls();
  bindSettingsNavigation();
  bindProductSettings();
  bindGithubSettings();
  bindWeatherSettings();
  bindWeatherLocationSettings();
  bindDeepSeekSettings();
  bindDashboardControls();
  bindGithubControls();
  bindQWeatherUsageControls();
  bindMailControls();
  bindNotificationControls();
  bindNotificationPreviewCards();
  mountWeatherEffects(appRoot);
  document.querySelector("#window-minimize")?.addEventListener("click", () => window.winplate.minimizeWindow());
  document.querySelector("#sidebar-toggle")?.addEventListener("click", () => {
    sidebarCollapsed = !sidebarCollapsed;
    const workspace = document.querySelector(".workspace");
    const shell = document.querySelector(".main-window-shell");
    workspace.classList.toggle("sidebar-collapsed", sidebarCollapsed);
    shell.classList.toggle("shell-sidebar-collapsed", sidebarCollapsed);
    shell.classList.toggle("shell-sidebar-expanded", !sidebarCollapsed);
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
      bindDashboardControls();
      if (requested.includes("github")) bindGithubControls();
      if (requested.includes("weather")) bindQWeatherUsageControls();
      if (requested.includes("mail")) bindMailControls();
      if (requested.includes("notifications")) bindNotificationControls();
    }
    updateProgressBars(pageContent);
    updateModuleHealthDom(requested);
    if (requested.includes("weather")) mountWeatherEffects(pageContent);
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
    bindDashboardControls();
    bindGithubControls();
    bindQWeatherUsageControls();
    bindMailControls();
    bindNotificationControls();
    updateProgressBars(pageContent);
    mountWeatherEffects(pageContent);
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
    bindDashboardControls();
    bindGithubControls();
    bindQWeatherUsageControls();
    bindMailControls();
    bindNotificationControls();
  }
  updateProgressBars(pageContent);
  mountWeatherEffects(pageContent);
}

function updateFloatingStatusDom(moduleIds = null) {
  if (floatingDocked) {
    renderFloating();
    return;
  }
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
              ${sidebarCodexIcon}<span class="module-label">Codex</span>
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
    pageContent.addEventListener("keydown", handleMailPageKeydown);
  }
  const form = document.querySelector("#mail-settings-form");
  if (form) {
    const addressInput = form.querySelector("#qq-mail-address");
    const authCodeInput = form.querySelector("#qq-mail-auth-code");
    const mailStatus = form.querySelector("#mail-settings-status");
    const connectionStatus = form.querySelector("#mail-connection-status");
    const saveButton = form.querySelector("button[type='submit']");
    const setMailSettingsStatus = (message, className = "") => {
      mailStatus.textContent = `QQ 邮箱配置：${message}`;
      mailStatus.className = className;
      connectionStatus.textContent = `IMAP：${mailSettings.connected ? "已连接" : "未连接"}`;
      connectionStatus.className = mailSettings.connected ? "configured" : "";
    };
    form.onsubmit = async (event) => {
      event.preventDefault();
      saveButton.disabled = true;
      setMailSettingsStatus("正在保存...");
      try {
        mailSettings = await window.winplate.saveMailSettings({
          address: addressInput.value,
          authCode: authCodeInput.value
        });
        addressInput.value = mailSettings.address || "";
        authCodeInput.value = "";
        authCodeInput.placeholder = "已配置，重新填写可覆盖";
        updateSettingsServiceStatus("mail", mailSettings.connected ? "已连接" : "已配置");
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

async function openMailDetail(uid) {
  if (!uid || (mailDetail.loading && String(mailDetail.uid) === String(uid))) return;
  const requestId = `${uid}:${Date.now()}`;
  mailHighlightedUid = uid;
  mailDetail = { open: true, loading: true, uid, requestId, message: null, error: "" };
  updateMainStatusDom();
  queueMicrotask(() => document.querySelector(".mail-detail-close")?.focus?.());
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
    updateMainStatusDom();
  }
}

async function handleMailPageClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target || !target.closest(".mail-page")) return;

  if (target.closest(".mail-detail-close") || target.matches("[data-mail-detail-backdrop]")) {
    closeMailDetail();
    updateMainStatusDom();
    return;
  }

  // Clicks inside the open sheet (footer actions etc.) should not re-open list items.
  if (target.closest(".mail-detail-sheet")) {
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
    }
    return;
  }

  const mailItem = target.closest(".mail-outline-item[data-mail-uid]");
  if (mailItem?.dataset.mailUid) {
    await openMailDetail(mailItem.dataset.mailUid);
  }
}

function handleMailPageKeydown(event) {
  if (event.key !== "Enter" && event.key !== " ") return;
  const target = event.target instanceof Element ? event.target : null;
  const mailItem = target?.closest?.(".mail-outline-item[data-mail-uid]");
  if (!mailItem || !mailItem.dataset.mailUid) return;
  if (target !== mailItem && !mailItem.contains(target)) return;
  // Only when focus is on the card itself (role=button).
  if (document.activeElement !== mailItem) return;
  event.preventDefault();
  openMailDetail(mailItem.dataset.mailUid);
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
  const conversation = notificationConversationForId(notificationId);
  const id = String(conversation?.id || notificationId || "").trim();
  if (!id) return;
  notificationDrawerState = { ...notificationDrawerState, open: true, mode: "detail" };
  notificationDetail = { open: true, loading: true, id, data: null, error: "" };
  notificationActionFeedback = "";
  updateMainStatusDom();
  focusNotificationDrawerControl(".notification-detail-back");
  try {
    const payload = await window.winplate.getNotificationDetail(id);
    notificationDetail = { open: true, loading: false, id, data: payload, error: "" };
    if (conversation?.unread || payload?.notification?.unread) {
      try {
        await markConversationRead(conversation || payload?.notification, { feedback: "已标记为已读" });
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

async function selectNotification(id) {
  const conversation = notificationConversationForId(id);
  const safeId = String(conversation?.id || id || "").trim();
  if (!safeId) return;
  if (notificationSelection.id === safeId && !notificationSelection.loading) {
    notificationSelection = { id: null, loading: false, data: null, error: "" };
    notificationActionFeedback = "";
    updateMainStatusDom();
    return;
  }
  notificationSelection = { id: safeId, loading: true, data: null, error: "" };
  notificationActionFeedback = "";
  updateMainStatusDom();
  try {
    const payload = await window.winplate.getNotificationDetail(safeId);
    notificationSelection = { id: safeId, loading: false, data: payload, error: "" };
    if (conversation?.unread || payload?.notification?.unread) await markConversationRead(conversation || payload?.notification, { feedback: "" });
  } catch (error) {
    notificationSelection = { id: safeId, loading: false, data: null, error: error.message || "通知详情加载失败" };
  }
  updateMainStatusDom();
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
  if (typeof updateNotificationAcknowledgement === "function") updateNotificationAcknowledgement();
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
  if (typeof notificationSelection !== "undefined" && notificationSelection.data?.notification?.id === id) {
    notificationSelection = {
      ...notificationSelection,
      data: {
        ...notificationSelection.data,
        notification: { ...notificationSelection.data.notification, unread: false },
        actions: (notificationSelection.data.actions || []).map((entry) => (
          entry.type === "markRead" ? { ...entry, label: "已读" } : entry
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

function markDetailRead(payload, ids) {
  if (!payload?.notification || !ids.includes(String(payload.notification.id))) return payload;
  return {
    ...payload,
    notification: { ...payload.notification, unread: false },
    actions: (payload.actions || []).map((entry) => (
      entry.type === "markRead" ? { ...entry, label: "已读" } : entry
    ))
  };
}

async function markConversationRead(conversation, options = null) {
  const { returnToList = false, feedback = "已标记为已读" } = options || {};
  const unreadIds = unreadConversationMemberIds(conversation);
  if (!unreadIds.length) {
    notificationActionFeedback = feedback;
    const representedItems = window.WinPlateNotificationDigest.selectDigestItems(
      notificationDigest,
      notificationItemsForDigest()
    );
    if (returnToList && representedItems.length) showNotificationDrawerList();
    updateMainStatusDom();
    if (notificationDrawerState.mode === "list") focusNotificationDrawerControl(".notification-detail-close");
    return;
  }
  if (unreadIds.length <= 1 || typeof window.winplate?.markNotificationsRead !== "function") {
    return markNotificationRead(conversation?.id || unreadIds[0], options);
  }
  notificationSummary = await window.winplate.markNotificationsRead(unreadIds);
  notificationDetail = { ...notificationDetail, data: markDetailRead(notificationDetail.data, unreadIds) };
  notificationSelection = { ...notificationSelection, data: markDetailRead(notificationSelection.data, unreadIds) };
  if (typeof updateNotificationAcknowledgement === "function") updateNotificationAcknowledgement();
  await hydrateNotificationDigest();
  notificationActionFeedback = feedback;
  if (returnToList) showNotificationDrawerList();
  updateMainStatusDom();
  if (notificationDrawerState.mode === "list") focusNotificationDrawerControl(".notification-detail-close");
}

async function handleNotificationAction(actionId) {
  const activeDetail = (typeof notificationSelection !== "undefined" && notificationSelection.data) || notificationDetail.data;
  const actions = Array.isArray(activeDetail?.actions) ? activeDetail.actions : [];
  const action = actions.find((entry) => entry.id === actionId);
  if (!action) return;
  if (action.type === "copy") {
    await copyTextToClipboard(action.payload?.text || "");
    notificationActionFeedback = "内容已复制到剪贴板";
    return;
  }
  if (action.type === "markRead") {
    await markConversationRead(
      notificationConversationForId(action.payload?.notificationId || (typeof notificationSelection !== "undefined" ? notificationSelection.id : null) || notificationDetail.id),
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
  document.querySelectorAll("[data-notification-state-choice]").forEach((button) => {
    button.onclick = () => {
      notificationFilters = { ...notificationFilters, state: button.dataset.notificationStateChoice };
      updateMainStatusDom();
    };
  });
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
  const clearButton = document.querySelector("#clear-read-notifications");
  if (clearButton) {
    clearButton.onclick = async () => {
      if (notificationActionInFlight || clearButton.disabled) return;
      notificationActionInFlight = true;
      clearButton.disabled = true;
      try {
        notificationSummary = await window.winplate.clearReadNotifications();
        if (!notificationSummary.items.some((item) => String(item.id) === String(notificationSelection.id))) {
          notificationSelection = { id: null, loading: false, data: null, error: "" };
        }
        await hydrateNotificationDigest();
      } catch (error) {
        console.error("Failed to clear read notifications:", error);
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
    if (!notificationActionInFlight) {
      if (notificationDrawerState.open) await openNotificationDetail(retryButton.dataset.notificationDetailRetry);
      else await selectNotification(retryButton.dataset.notificationDetailRetry);
    }
    return;
  }

  const selectedNotification = target.closest("[data-notification-select]");
  if (selectedNotification) {
    if (!notificationActionInFlight) await selectNotification(selectedNotification.dataset.notificationSelect);
    return;
  }

  const sourceChip = target.closest("[data-notification-source]");
  if (sourceChip) {
    notificationFilters = { ...notificationFilters, source: sourceChip.dataset.notificationSource || "all" };
    updateMainStatusDom();
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
  if (event.key === "Escape" && typeof notificationAcknowledgement !== "undefined" && notificationAcknowledgement.id) {
    event.preventDefault();
    const returnFocus = notificationAcknowledgement.returnFocus;
    dismissedNotificationAcknowledgements.add(String(notificationAcknowledgement.id));
    notificationAcknowledgement = { id: null, returnFocus: null };
    updateNotificationAcknowledgement();
    updateMainStatusDom();
    queueMicrotask(() => returnFocus?.focus?.());
    return;
  }
  if (event.key === "Escape" && mailDetail.open) {
    event.preventDefault();
    closeMailDetail();
    updateMainStatusDom();
    return;
  }
  if (event.key === "Escape" && notificationDrawerState.open) {
    event.preventDefault();
    closeNotificationDrawer();
    updateMainStatusDom();
  }
}

async function handleNotificationAcknowledgementClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target || !notificationAcknowledgement.id) return;
  const acknowledge = target.closest("[data-notification-acknowledge]");
  if (acknowledge) {
    if (notificationActionInFlight) return;
    notificationActionInFlight = true;
    try {
      await markNotificationRead(acknowledge.dataset.notificationAcknowledge, { feedback: "" });
    } catch (error) {
      console.error("Failed to acknowledge red weather alert:", error);
    } finally {
      notificationActionInFlight = false;
      updateMainStatusDom();
    }
    return;
  }
  const dismissButton = target.closest("[data-notification-ack-dismiss]");
  const backdrop = target.matches?.("[data-notification-ack-backdrop]") ? target : null;
  if (!dismissButton && !backdrop) return;
  const returnFocus = notificationAcknowledgement.returnFocus;
  dismissedNotificationAcknowledgements.add(String(notificationAcknowledgement.id));
  notificationAcknowledgement = { id: null, returnFocus: null };
  updateNotificationAcknowledgement();
  updateMainStatusDom();
  queueMicrotask(() => returnFocus?.focus?.());
}

async function hydrateQWeatherUsage() {
  if (view !== "main") return;
  try {
    qweatherUsage = await window.winplate.getQWeatherUsage();
  } catch (error) {
    qweatherUsageMessage = `本地用量读取失败：${error.message}`;
  }
}

async function hydrateNotifications(options = {}) {
  const force = Boolean(options?.force);
  try {
    notificationSummary = await window.winplate.getNotifications({ force });
    updateNotificationAcknowledgement();
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
  selectedContributionRepository = null;
  githubContributionRequestId += 1;
  updateMainStatusDom();
}

function bindGithubControls() {
  revealSelectedGithubMonth();
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
    selectedContributionRepository = null;
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

function bindNotificationPreviewCards() {
  document.querySelectorAll("[data-notification-preview-id]").forEach((card) => {
    card.setAttribute("aria-label", "打开相关通知");
    card.onclick = async (event) => {
      if (event.target.closest("button, select, input, a")) return;
      const previewId = card.dataset.notificationPreviewId;
      if (!previewId) return;
      currentSection = "Notifications";
      renderMain();
      await selectNotification(previewId);
    };
    card.tabIndex = 0;
    card.onkeydown = async (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      const previewId = card.dataset.notificationPreviewId;
      if (!previewId) return;
      currentSection = "Notifications";
      renderMain();
      await selectNotification(previewId);
    };
  });
}

function updateMaximizeButton() {
  const button = document.querySelector("#window-maximize");
  if (!button) return;
  button.setAttribute("aria-label", mainWindowMaximized ? "还原" : "最大化");
  button.querySelector("span")?.classList.toggle("restore-icon", mainWindowMaximized);
}

async function refreshBackendStatus({ force = false } = {}) {
  const weatherVersionAtRequest = weatherUpdateVersion;
  let forcedWeather = null;
  if (force && moduleEnabled("weather")) {
    try {
      forcedWeather = window.winplate.refreshWeather
        ? await window.winplate.refreshWeather()
        : await refreshLocalJson("/api/weather/refresh", "天气刷新");
    } catch (error) {
      console.warn("Forced weather refresh failed; falling back to status:", error.message);
    }
  }
  const [incomingStatus, incomingHealth] = await Promise.all([
    window.winplate.getStatus({ force }),
    window.winplate.getHealthSyncStatus
      ? window.winplate.getHealthSyncStatus().catch(() => null)
      : Promise.resolve(null)
  ]);
  if (incomingHealth) applyHealthSyncStatus(incomingHealth);
  const incomingWeather = forcedWeather
    || (weatherVersionAtRequest === weatherUpdateVersion
      ? incomingStatus.weather
      : statusData.weather);
  statusData = {
    ...statusData,
    heart: { ...mockStatus.heart, ...incomingStatus.heart, ...statusData.heart },
    weather: { ...mockStatus.weather, ...statusData.weather, ...incomingWeather }
  };
  if (force && moduleEnabled("weather")) {
    await refreshQWeatherAlerts();
  } else {
    await hydrateWeatherAlerts();
  }
  await hydrateQWeatherUsage();
  updateCurrentViewDom(["weather", "heart"]);
  if (moduleEnabled("weather") && statusData.weather?.source === "unavailable") {
    throw new Error(statusData.weather.error || "天气服务不可用");
  }
  return incomingStatus;
}

async function refreshGithubData({ force = false } = {}) {
  if (force) {
    githubContributionDetailCache.clear();
    selectedContributionDate = null;
    selectedContributionRepository = null;
  }
  const github = force
    ? (window.winplate.refreshGithub
      ? await window.winplate.refreshGithub()
      : await refreshLocalJson("/api/github/refresh", "GitHub 刷新"))
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

async function refreshCodexTokenUsageData({ force = false } = {}) {
  if (!window.winplate?.getCodexTokenUsage) {
    codexTokenUsage = emptyTokenUsage();
    return codexTokenUsage;
  }
  try {
    codexTokenUsage = {
      ...emptyTokenUsage(),
      ...await window.winplate.getCodexTokenUsage({ force })
    };
  } catch {
    codexTokenUsage = emptyTokenUsage();
  }
  return codexTokenUsage;
}

async function refreshSuperGrokTokenUsageData({ force = false } = {}) {
  if (!window.winplate?.getSuperGrokTokenUsage) {
    superGrokTokenUsage = emptyTokenUsage();
    return superGrokTokenUsage;
  }
  try {
    superGrokTokenUsage = {
      ...emptyTokenUsage(),
      ...await window.winplate.getSuperGrokTokenUsage({ force })
    };
  } catch {
    superGrokTokenUsage = emptyTokenUsage();
  }
  return superGrokTokenUsage;
}

async function refreshCodexData({ force = false } = {}) {
  statusData.codex = {
    ...mockStatus.codex,
    ...statusData.codex,
    ...await window.winplate.getCodexUsage({ force })
  };
  await refreshCodexTokenUsageData({ force });
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

async function refreshSuperGrokData({ force = false } = {}) {
  if (!window.winplate?.getSuperGrokUsage) {
    statusData.supergrok = {
      ...mockStatus.supergrok,
      ...statusData.supergrok,
      updatedAt: Date.now()
    };
    await refreshSuperGrokTokenUsageData({ force });
    updateCurrentViewDom("codex");
    return statusData.supergrok;
  }
  statusData.supergrok = {
    ...mockStatus.supergrok,
    ...statusData.supergrok,
    ...await window.winplate.getSuperGrokUsage({ force })
  };
  await refreshSuperGrokTokenUsageData({ force });
  updateCurrentViewDom("codex");
  if (statusData.supergrok.status === "Unavailable") {
    throw new Error(statusData.supergrok.raw || "Grok Build 用量不可用");
  }
  return statusData.supergrok;
}

async function refreshMailData({ force = false } = {}) {
  // Unlike the other status modules, the non-forced mail endpoint intentionally
  // returns its SQLite outline cache. A scheduled mail refresh must therefore
  // use the IMAP refresh endpoint too; otherwise new messages appear only
  // after the user presses the manual refresh button.
  await hydrateMail({ force: true });
  updateCurrentViewDom("mail");
  hydrateNotifications({ force }).then(() => {
    updateCurrentViewDom("notifications");
  });
  if (mailOutline.availability === "unavailable") {
    throw new Error(mailOutline.error || "邮件服务不可用");
  }
  return mailOutline;
}

async function refreshNotificationData({ force = false } = {}) {
  await hydrateNotifications({ force });
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
  refreshController.register({ id: "supergrok", refresh: refreshSuperGrokData });
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
  refreshController.configure("supergrok", { intervalMs: moduleEnabled("codex") ? 60_000 : 0 });
  refreshController.configure("mail", { intervalMs: moduleEnabled("mail") ? moduleRefreshSeconds("mail") * 1000 : 0 });
  refreshController.configure("notifications", { intervalMs: moduleEnabled("notifications") ? moduleRefreshSeconds("notifications") * 1000 : 0 });
  refreshController.configure("network", { intervalMs: view === "floating" && moduleEnabled("network") ? moduleRefreshSeconds("network") * 1000 : 0 });
}

async function refreshStatus(options = {}) {
  if (view === "tooltip") return [];
  const ids = [];
  if (moduleEnabled("weather") || moduleEnabled("heart")) ids.push("status");
  if (moduleEnabled("github")) ids.push("github");
  if (moduleEnabled("codex")) ids.push("codex", "deepseek", "supergrok");
  if (moduleEnabled("mail")) ids.push("mail");
  if (moduleEnabled("notifications")) ids.push("notifications");
  const results = await refreshController.refreshAll({
    ids,
    force: Boolean(options.force),
    reason: options.reason || "status"
  });

  if (view === "floating") {
    updateFloatingStatusDom();
  } else {
    updateMainStatusDom();
  }
  return results;
}

function bindAgentTokenChartHover(chartRoot) {
  if (!chartRoot || chartRoot.dataset.hoverBound === "true") return;
  const payloadRaw = chartRoot.dataset.agentChartPoints;
  if (!payloadRaw) return;
  let points = [];
  try {
    points = JSON.parse(decodeURIComponent(payloadRaw));
  } catch {
    return;
  }
  if (!Array.isArray(points) || !points.length) return;

  const svg = chartRoot.querySelector("svg");
  const guide = chartRoot.querySelector(".agent-token-hover-guide");
  const dot = chartRoot.querySelector(".agent-token-hover-dot");
  const card = chartRoot.querySelector(".agent-token-hover-card");
  const tokensEl = chartRoot.querySelector("[data-agent-hover-tokens]");
  const timeEl = chartRoot.querySelector("[data-agent-hover-time]");
  if (!svg || !guide || !dot || !card || !tokensEl || !timeEl) return;

  const chartWidth = Number(chartRoot.dataset.agentChartWidth) || 560;
  const nearestPoint = (clientX) => {
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return points[0];
    const x = ((clientX - rect.left) / rect.width) * chartWidth;
    let best = points[0];
    let bestDistance = Math.abs(best.x - x);
    for (const point of points) {
      const distance = Math.abs(point.x - x);
      if (distance < bestDistance) {
        best = point;
        bestDistance = distance;
      }
    }
    return best;
  };

  const showPoint = (point) => {
    if (!point) return;
    guide.setAttribute("x1", String(point.x));
    guide.setAttribute("x2", String(point.x));
    guide.setAttribute("visibility", "visible");
    dot.setAttribute("cx", String(point.x));
    dot.setAttribute("cy", String(point.y));
    dot.setAttribute("visibility", "visible");
    // Hover card: date first, then absolute token count.
    timeEl.textContent = point.label || "";
    tokensEl.textContent = `${Number(point.tokens || 0).toLocaleString("zh-CN")} tokens`;
    card.hidden = false;
    const rect = chartRoot.getBoundingClientRect();
    const svgRect = svg.getBoundingClientRect();
    const scaleX = svgRect.width / chartWidth;
    const localX = (point.x * scaleX);
    const halfWidth = 62;
    card.style.left = `${Math.min(Math.max(localX, halfWidth + 4), rect.width - halfWidth - 4)}px`;
  };

  const hidePoint = () => {
    guide.setAttribute("visibility", "hidden");
    dot.setAttribute("visibility", "hidden");
    card.hidden = true;
  };

  chartRoot.dataset.hoverBound = "true";
  chartRoot.addEventListener("pointermove", (event) => {
    showPoint(nearestPoint(event.clientX));
  });
  chartRoot.addEventListener("pointerleave", hidePoint);
  chartRoot.addEventListener("pointercancel", hidePoint);
}

function bindAgentControls() {
  const pageContent = document.querySelector("#page-content");
  if (!pageContent) return;

  pageContent.querySelectorAll("[data-agent-chart]").forEach((chartRoot) => {
    const cardId = chartRoot.dataset.agentChart;
    chartRoot.querySelectorAll("[data-agent-granularity]").forEach((button) => {
      button.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        const next = button.dataset.agentGranularity;
        if (!["hour", "day"].includes(next)) return;
        agentChartGranularity[cardId] = next;
        updateMainStatusDom("codex");
      };
    });
    chartRoot.querySelectorAll("[data-agent-chart-root]").forEach((root) => {
      bindAgentTokenChartHover(root);
    });
  });

  const refreshButton = document.querySelector("#refresh-agent");
  if (!refreshButton) return;
  refreshButton.onclick = async () => {
    if (agentRefreshInFlight) return;
    agentRefreshInFlight = true;
    updateMainStatusDom("codex");
    try {
      await Promise.allSettled([
        refreshCodexData({ force: true }),
        refreshDeepSeekData({ force: true }),
        refreshSuperGrokData({ force: true })
      ]);
    } finally {
      agentRefreshInFlight = false;
      updateMainStatusDom("codex");
    }
  };
}

function bindDashboardControls() {
  bindAgentControls();
  const refreshButton = document.querySelector("#refresh-dashboard");
  if (!refreshButton) return;
  refreshButton.onclick = async () => {
    if (dashboardRefreshInFlight) return;
    dashboardRefreshInFlight = true;
    try {
      updateMainStatusDom();
      // Force-repull every enabled module: GitHub user data, Codex/DeepSeek usage,
      // weather/heart status, mail outline, and notifications.
      const results = await refreshStatus({ force: true, reason: "button" });
      const failures = (results || []).filter((result) => result.status === "rejected");
      if (failures.length) {
        const firstError = failures[0]?.reason;
        const message = firstError?.message || String(firstError || "部分模块刷新失败");
        showRefreshNotice("error", "仪表盘刷新未完全成功", message);
      } else {
        showRefreshNotice("success", "仪表盘刷新成功", "已重新拉取 GitHub、Codex、天气等各板块最新数据。");
      }
    } catch (error) {
      console.error("Dashboard refresh failed:", error);
      showRefreshNotice("error", "仪表盘刷新失败", error.message || "请稍后重试。");
    } finally {
      dashboardRefreshInFlight = false;
      resetRefreshButton("#refresh-dashboard");
      updateMainStatusDom();
    }
  };
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
document.addEventListener("click", handleNotificationAcknowledgementClick);
if (view === "main") renderMain();
Promise.all([hydrateAppearanceSettings(), hydrateQWeatherUsage()]).then(async () => {
  if (view === "tooltip") return [];
  configureRefreshTasks();
  if (view === "main") renderMain();
  await refreshController.start();
  return refreshStatus();
});
if (view !== "tooltip") {
  if (view === "floating") {
    window.winplate?.onFloatingDockState?.((state) => {
      const nextDocked = Boolean(state?.docked);
      if (nextDocked === floatingDocked) return;
      floatingDocked = nextDocked;
      renderFloating();
    });
  }
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
    refreshStatus().catch(() => {});
  });
  window.winplate?.onHealthSyncUpdated?.((payload) => {
    applyHealthSyncStatus(payload);
    updateCurrentViewDom("heart");
  });
  window.winplate?.onSettingsUpdated?.((settings) => {
    const nextAccent = ACCENT_COLORS[settings.appearance?.accent]
      ? settings.appearance.accent
      : accentPreference;
    appSettings = {
      ...settings,
      appearance: { ...settings.appearance, accent: nextAccent }
    };
    themePreference = settings.appearance.theme;
    accentPreference = nextAccent;
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
    if (navigation.section === "Mail" && navigation.moduleId === "mail" && navigation.sourceId) {
      await openMailDetail(navigation.sourceId);
      return;
    }
    if (navigation.section === "Notifications") {
      if (navigation.notificationId) {
        await selectNotification(navigation.notificationId);
      } else {
        notificationSelection = { id: null, loading: false, data: null, error: "" };
        updateMainStatusDom();
      }
    }
  }
});

window.winplate.onMaximizedChange((value) => {
  mainWindowMaximized = value;
  updateMaximizeButton();
});
