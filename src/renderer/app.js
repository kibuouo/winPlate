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
const offlineStatus = {
  github: normalizeGithub(mockStatus.github),
  codex: { remainingPct: null, usedPct: null, resetText: "--:--", windowHours: 5, status: "Offline" },
  heart: { heartRate: null, unit: "bpm", source: "Offline", updatedAt: "unavailable" },
  weather: { ...mockStatus.weather }
};
const appRoot = document.querySelector("#app");
const view = new URLSearchParams(window.location.search).get("view") || "main";
let currentSection = "Dashboard";
let floatingPinned = false;
let systemClockTimer = null;
let tooltipHideTimer = null;
let mainWindowMaximized = false;
let sidebarCollapsed = false;
let selectedContributionMonth = null;
let githubRefreshInFlight = false;
let locationWeatherPromise = null;
let weatherSettings = { hasApiKey: false, apiHost: "devapi.qweather.com" };
let deepseekSettings = { hasApiKey: false, baseUrl: "https://api.deepseek.com" };
let mailSettings = { configured: false, connected: false, windowDays: 30 };
let mailOutline = { source: "loading", availability: "loading", items: [], updatedAt: null };
let mailRefreshInFlight = false;
let notificationSummary = { unreadCount: 0, latest: null, items: [], updatedAt: null };
let notificationActionInFlight = false;
let networkSpeed = {
  downloadBytesPerSecond: 0,
  uploadBytesPerSecond: 0,
  status: "获取中",
  error: "",
  updatedAt: null
};
let qweatherUsage = { used: 0, total: 50000, remaining: 50000, percent: 0, today: 0, month: "" };
let qweatherOfficialStats = null;
let qweatherUsageMessage = "";
let qweatherOfficialStatus = null;
const THEME_STORAGE_KEY = "winplate-theme";
const themeMedia = window.matchMedia("(prefers-color-scheme: dark)");
let themePreference = "system";

function resolvedTheme() {
  return themePreference === "system"
    ? (themeMedia.matches ? "dark" : "light")
    : themePreference;
}

function applyMainTheme() {
  if (view !== "main") return;
  const theme = resolvedTheme();
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  window.winplate.setWindowTheme(theme);
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
  if (view !== "main") return;
  const legacyTheme = localStorage.getItem(THEME_STORAGE_KEY);
  try {
    const settings = await window.winplate.getAppearanceSettings();
    themePreference = ["light", "dark", "system"].includes(settings?.theme)
      ? settings.theme
      : "system";
    if (legacyTheme && ["light", "dark", "system"].includes(legacyTheme)) {
      themePreference = legacyTheme;
      await window.winplate.saveAppearanceSettings({ theme: legacyTheme });
      localStorage.removeItem(THEME_STORAGE_KEY);
    }
  } catch (error) {
    console.error("Failed to load appearance settings:", error);
    if (legacyTheme && ["light", "dark", "system"].includes(legacyTheme)) {
      themePreference = legacyTheme;
    }
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

function hasOfficialWeatherSettings(settings = weatherSettings) {
  return Boolean(settings.projectId && settings.credentialId && settings.hasPrivateKey);
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

async function bindDeepSeekSettings() {
  const form = document.querySelector("#deepseek-settings-form");
  if (!form) return;
  const keyInput = form.querySelector("#deepseek-api-key");
  const baseUrlInput = form.querySelector("#deepseek-base-url");
  const status = form.querySelector("#deepseek-settings-status");
  const button = form.querySelector("button[type='submit']");
  const setStatus = (text, className = "") => {
    status.textContent = `DeepSeek API：${text}`;
    status.className = className;
  };
  try {
    deepseekSettings = await window.winplate.getDeepSeekSettings();
    baseUrlInput.value = deepseekSettings.baseUrl;
    keyInput.placeholder = deepseekSettings.hasApiKey ? "已配置，留空则保持不变" : "请输入 API Key";
    setStatus(deepseekSettings.hasApiKey ? "已配置" : "未配置", deepseekSettings.hasApiKey ? "configured" : "");
  } catch {
    setStatus("读取失败", "error");
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

function notificationSourceLabel(source) {
  return {
    mail: "Mail",
    qweather: "QWeather",
    codex: "Codex",
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
  const summary = normalizedNotifications();
  const latest = summary.latest;
  const unread = summary.unreadCount;
  const title = latest ? latest.title : "暂无新通知";
  return `
    <button class="notification-strip ${unread ? "has-unread" : ""} no-drag" id="notification-strip" type="button" aria-label="打开通知中心">
      ${notificationIcon}
      <span class="notification-title">${escapeHtml(title)}</span>
      ${unread ? `<span class="notification-badge" aria-label="${unread} 条未读">${unread > 99 ? "99+" : unread}</span>` : ""}
    </button>`;
}

function formatNetworkSpeed(bytesPerSecond, compact = true) {
  const value = Number(bytesPerSecond);
  if (!Number.isFinite(value) || value < 0) return compact ? "---" : "---";
  const kb = value / 1024;
  if (kb < 1) return compact ? "0K" : "0 KB/s";
  if (kb < 1000) return compact ? `${Math.round(kb)}K` : `${Math.round(kb)} KB/s`;
  const mb = kb / 1024;
  return compact ? `${mb.toFixed(mb >= 10 ? 0 : 1)}M` : `${mb.toFixed(mb >= 10 ? 0 : 1)} MB/s`;
}

function networkSpeedLabel() {
  return `↓ ${formatNetworkSpeed(networkSpeed.downloadBytesPerSecond, true)}`;
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
    const level = active ? Math.max(0, Math.min(4, Number(values[sourceIndex]) || 0)) : 0;
    if (!active) return `<span class="github-calendar-cell level-0 outside-month"></span>`;
    const count = Math.max(0, Number(counts[sourceIndex]) || 0);
    const date = new Date(`${month.key}-${String(sourceIndex + 1).padStart(2, "0")}T00:00:00`);
    const dateLabel = new Intl.DateTimeFormat("en-US", {
      month: "long",
      day: "numeric"
    }).format(date);
    const contributionLabel = `${count} contribution${count === 1 ? "" : "s"} on ${dateLabel}.`;
    return `<span class="github-calendar-cell level-${level}" tabindex="0" aria-label="${contributionLabel}" data-tooltip="${contributionLabel}"></span>`;
  }).join("");
  return `
    <div class="github-calendar-shell">
      <div class="github-calendar-labels" aria-hidden="true"><span>Mon</span><span>Wed</span><span>Fri</span></div>
      <div class="github-calendar">
        <div class="github-calendar-months"><span>Monthly activity</span><span>${month.label}</span></div>
        <div class="github-calendar-grid" aria-label="GitHub contributions for ${month.label}">${cells}</div>
      </div>
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

function githubContent() {
  const github = normalizeGithub(statusData.github);
  const months = githubContributionMonths(github);
  const selectedIndex = months.findIndex((month) => month.key === selectedContributionMonth);
  const monthIndex = selectedIndex >= 0 ? selectedIndex : months.length - 1;
  const selectedMonth = months[monthIndex];
  selectedContributionMonth = selectedMonth.key;
  const activityCount = selectedMonth.commits || 0;
  const stateNotice = github.stateMessage
    ? `<div class="github-state-notice state-${github.availability}" role="status">${github.stateMessage}</div>`
    : "";
  return `
    <section class="github-dashboard">
      <div class="github-profile-column">
        ${avatarMarkup(github, "github-profile-avatar")}
        <div class="github-profile-copy">
          <h1>${github.name}</h1>
          <p>${github.username}</p>
        </div>
        <button class="github-profile-button" type="button" data-open-github>Open GitHub profile</button>
        <dl class="github-profile-metrics">
          <div><dt>${github.repos}</dt><dd>Repositories</dd></div>
          <div><dt>${github.followers}</dt><dd>Followers</dd></div>
          <div><dt>${github.streakDays}</dt><dd>Day streak</dd></div>
        </dl>
        <div class="github-live-note"><span></span><div><strong>${github.status || "Live"}</strong><small>${relativeUpdatedAt(github.updatedAt)}</small></div></div>
      </div>
      <div class="github-main-column">
        ${stateNotice}
        <div class="github-page-heading">
          <div><p>GITHUB</p><h2>Contribution overview</h2><span>Live profile and repository activity for ${github.username}.</span></div>
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
        <article class="github-pinned-card">
          <div class="github-card-heading"><span>Pinned repository</span><small>Public</small></div>
          <button type="button" data-open-github class="github-repo-link">${previewIcons.repository}<strong>${github.project}</strong></button>
          <div class="github-repo-meta"><span><i></i>${github.language}</span><span>${previewIcons.star}${github.stars}</span></div>
        </article>
        <article class="github-contribution-card">
          <div class="github-card-heading">
            <span>${activityCount} contributions in ${selectedMonth.label}</span>
            <div class="github-month-navigation">
              <button type="button" data-month-direction="-1" aria-label="Previous month" ${monthIndex === 0 ? "disabled" : ""}>‹</button>
              <strong>${selectedMonth.label}</strong>
              <button type="button" data-month-direction="1" aria-label="Next month" ${monthIndex === months.length - 1 ? "disabled" : ""}>›</button>
            </div>
          </div>
          ${githubContributionCalendar(selectedMonth)}
          <div class="github-calendar-legend"><span>Less</span>${[0, 1, 2, 3, 4].map((level) => `<i class="github-calendar-cell level-${level}"></i>`).join("")}<span>More</span></div>
        </article>
        <article class="github-activity-card">
          <div class="github-card-heading"><span>Contribution activity</span><small>${selectedMonth.label}</small></div>
          <div class="github-activity-row">
            <span class="github-activity-icon">${previewIcons.commits}</span>
            <div><strong>Made ${activityCount} contributions</strong><small>GitHub contribution calendar activity</small></div>
            <b>${activityCount}</b>
          </div>
          <div class="github-activity-row">
            <span class="github-activity-icon">${previewIcons.repository}</span>
            <div><strong>Recently updated ${github.project}</strong><small>${github.language} · ${github.stars} stars</small></div>
            <span class="github-activity-status">Active</span>
          </div>
        </article>
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
  return `<img class="themed-weather-icon ${className}" src="../../node_modules/qweather-icons/icons/${code}.svg" alt="" aria-hidden="true">`;
}

function weatherDashboardCard() {
  const weather = statusData.weather || mockStatus.weather;
  const forecast = Array.isArray(weather.forecast) ? weather.forecast.slice(0, 3) : [];
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
    <article class="dashboard-card weather-dashboard-card">
      <div class="weather-card-main">
        <div class="weather-card-heading">
          <span>${locationArrowIcon}<b>${weather.location || (weather.source === "unconfigured" ? "位置未配置" : "当前位置")}</b></span>
          <small>${weather.source === "qweather" ? "QWeather 实时数据" : weather.source === "unconfigured" ? "请允许系统定位或配置回退位置" : "等待天气数据"}</small>
        </div>
        <div class="weather-card-current">
          ${weatherIconMarkup(weather.icon, "weather-dashboard-icon")}
          <strong>${weather.temperature ?? "--"}°</strong>
          <div><b>${weather.condition || "天气未知"}</b><span>${weather.weatherSummary || "天气数据更新后将在这里显示。"}</span></div>
        </div>
        <div class="weather-card-details">
          ${details.map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join("")}
        </div>
      </div>
      <div class="weather-forecast-list">
        <div class="weather-forecast-title"><strong>未来天气</strong><span>3 天预报</span></div>
        ${forecast.length ? forecast.map((day, index) => `
          <div class="weather-forecast-day">
            <span>${dayLabel(day.date, index)}</span>
            ${weatherIconMarkup(day.icon, "weather-forecast-icon")}
            <b>${day.condition}</b>
            <strong>${day.tempMax}° <i>${day.tempMin}°</i></strong>
          </div>`).join("") : `<p class="weather-forecast-empty">配置 QWeather 后显示未来 3 天预报</p>`}
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
            <div class="module interactive-module github-module no-drag" id="github-module" role="link" tabindex="0" aria-label="Open GitHub profile">
              <span class="github-avatar-button" aria-hidden="true">
                ${avatarMarkup(statusData.github, "github-avatar-bar")}
              </span>
              <span class="github-summary">GitHub</span>
            </div>
            <div class="module interactive-module codex-module no-drag">
              ${codexIcon}
              <span class="module-label">Codex</span>
              ${progressBar(statusData.codex.remainingPct, "usage-track")}
              <strong class="metric">${statusData.codex.remainingPct ?? "--"}%</strong>
              ${quotaStatusLamp(statusData.codex.remainingPct)}
              <span class="metric reset">${statusData.codex.resetClock || statusData.codex.resetText || "--:--"}</span>
            </div>
          </div>
          <div class="status-group notification-status">
            ${notificationStrip()}
          </div>
          <div class="status-group auxiliary-status">
            <div class="module interactive-module weather-module no-drag" id="weather-module">
              ${weatherIconMarkup(weather.icon)}
              <strong class="metric">${weather.temperature}°C</strong>
              <span class="weather-condition">${weather.condition}</span>
            </div>
            <div class="system-status">
              <div class="module interactive-module heart-module no-drag" id="heart-module">
                <span class="heart-icon">♥</span>
                <strong class="metric">${statusData.heart.heartRate ?? "--"}</strong>
              </div>
              <div class="module interactive-module network-module no-drag" id="network-module">
                <span class="network-speed">${networkSpeedLabel()}</span>
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

  githubModule.addEventListener("click", () => window.winplate.openGithubProfile(statusData.github.profileUrl));
  githubModule.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      window.winplate.openGithubProfile(statusData.github.profileUrl);
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

  bindSystemTooltip(weatherModule, () => {
    const { time, date: fullDate } = weatherDateTime();
    return {
      type: "weather",
      icon: weather.icon,
      location: weather.location,
      temperature: weather.temperature,
      condition: weather.condition,
      feelsLike: weather.feelsLike,
      humidity: weather.humidity,
      precipitation: weather.precipitation,
      pressure: weather.pressure,
      visibility: weather.visibility,
      precipitationProbability: weather.precipitationProbability,
      wind: weather.windDirection ? `${weather.windDirection} ${weather.windScale}级` : "",
      weatherSummary: weather.weatherSummary,
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
    lines: networkSpeed.status === "获取失败"
      ? ["网速获取失败"]
      : [
          `下载速度：${formatNetworkSpeed(networkSpeed.downloadBytesPerSecond, false)}`,
          `上传速度：${formatNetworkSpeed(networkSpeed.uploadBytesPerSecond, false)}`,
          `当前网络状态：${networkSpeed.status || "获取失败"}`
        ]
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
        items: normalizedNotifications().items.slice(0, 5),
        unreadCount: normalizedNotifications().unreadCount
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
    const items = Array.isArray(data.items) ? data.items.slice(0, 5) : [];
    appRoot.innerHTML = `
      <article class="notifications-tooltip" role="tooltip" aria-label="通知预览">
        <header>
          <strong>通知</strong>
          <span>${Number(data.unreadCount) || 0} 未读</span>
        </header>
        <div class="notifications-tooltip-list">
          ${items.length ? items.map((item) => `
            <div class="notification-tooltip-row source-${escapeHtml(item.source)} level-${escapeHtml(item.level)}">
              <div>
                <b>${escapeHtml(item.title)}</b>
                <small>${escapeHtml(notificationSourceLabel(item.source))} · ${escapeHtml(notificationLevelLabel(item.level))}</small>
              </div>
              ${item.message ? `<p>${escapeHtml(item.message)}</p>` : ""}
            </div>`).join("") : `
            <div class="notification-tooltip-empty">
              ${notificationIcon}
              <strong>暂无新通知</strong>
            </div>`}
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
    <article class="dashboard-card qweather-card">
      <div class="qweather-card-heading">
        <div class="card-icon qweather-service-icon">${qweatherNavIcon}</div>
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

function heartCard() {
  return `
    <article class="dashboard-card heart-card">
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
    <article class="dashboard-card github-card github-dashboard-card">
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
    <article class="dashboard-card codex-card dashboard-codex-card">
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

function mailItemCard(item) {
  return `
    <article class="mail-outline-item">
      <div class="mail-outline-meta">
        <strong>${escapeHtml(item.sender)}</strong>
        <time>${mailTimeLabel(item.sentAt)}</time>
      </div>
      <h2>${escapeHtml(item.subject)}</h2>
      <p>${escapeHtml(item.summary || item.snippet || "暂无可用摘要")}</p>
      <footer>
        <b>${escapeHtml(item.action || "查看")}</b>
        <div class="mail-labels">${mailLabelPills(item.labels || [])}</div>
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
    <section class="mail-page">
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
    </section>`;
}

function notificationContent() {
  const summary = normalizedNotifications();
  const items = summary.items;
  const rows = items.length
    ? `<div class="notification-page-list">${items.map((item) => `
        <article class="notification-page-item source-${escapeHtml(item.source)} level-${escapeHtml(item.level)} ${item.unread ? "unread" : ""}">
          <div class="notification-page-main">
            <span class="notification-source">${escapeHtml(notificationSourceLabel(item.source))}</span>
            <h2>${escapeHtml(item.title)}</h2>
            ${item.message ? `<p>${escapeHtml(item.message)}</p>` : ""}
            <footer>
              <span>${escapeHtml(notificationLevelLabel(item.level))}</span>
              <time>${relativeUpdatedAt(item.createdAt)}</time>
            </footer>
          </div>
          <button class="notification-read-button" type="button" data-notification-read="${escapeHtml(item.id)}" ${item.unread ? "" : "disabled"}>
            ${item.unread ? "标记已读" : "已读"}
          </button>
        </article>`).join("")}</div>`
    : `<div class="notification-empty-state">${notificationIcon}<strong>暂无通知</strong><span>邮件、天气预警和 Codex 完成提示会出现在这里。</span></div>`;
  return `
    <section class="notifications-page">
      <div class="notifications-page-heading">
        <div><p>NOTIFICATIONS</p><h1>通知中心</h1><span>统一收纳邮件、天气预警和本地任务提示。</span></div>
        <div class="notification-actions">
          <button class="notification-test-button" id="push-test-notification" type="button">测试通知</button>
          <button class="notification-clear-button" id="mark-all-notifications-read" type="button" ${summary.unreadCount ? "" : "disabled"}>全部已读</button>
        </div>
      </div>
      <div class="notification-status-bar">
        <span>${summary.unreadCount} 未读</span>
        <time>${relativeUpdatedAt(summary.updatedAt)}</time>
      </div>
      ${rows}
    </section>`;
}

function dashboardContent(section) {
  const failures = qweatherOfficialStats?.errors ?? 0;
  const official = qweatherOfficialStats
    ? `<div class="qweather-official"><span>过去24小时：${qweatherOfficialStats.total}次</span><span>成功：${qweatherOfficialStats.success}</span><span>错误：${qweatherOfficialStats.errors}</span><small>截至 ${qweatherOfficialStats.asOf}</small></div>`
    : `<small class="qweather-message">${qweatherUsageMessage || "官方数据可能延迟 1 小时或更久"}</small>`;
  const cards = `
    <div class="dashboard-grid">
      ${dashboardGithubCard()}
      ${dashboardCodexCard()}
      ${heartCard()}
      ${qweatherServiceCard(official, failures)}
    </div>`;
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
      <section class="settings-section">
        <h2>外观</h2>
        <div class="settings-panel appearance-panel">${themeSelector()}</div>
      </section>
      <section class="settings-section">
        <h2>天气</h2>
        <form class="settings-panel weather-settings-panel" id="weather-settings-form">
          <fieldset>
            <legend><strong>天气服务</strong><small>必填，用于实时天气与天气预报</small></legend>
            <label>
              <span><strong>API Key</strong><small>来自 QWeather 控制台，仅保存在 Windows 用户环境变量中</small></span>
              <input id="qweather-api-key" type="password" autocomplete="off">
            </label>
            <label>
              <span><strong>API Host</strong><small>填写项目分配的 API Host，不包含 https://</small></span>
              <input id="qweather-api-host" type="text" autocomplete="off" spellcheck="false">
            </label>
          </fieldset>
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
              <span><strong>Ed25519 私钥</strong><small>仅保存在 Windows 用户环境变量中，留空保持原值</small></span>
              <textarea id="qweather-private-key" rows="3" autocomplete="off" spellcheck="false"></textarea>
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
              <span><strong>API Key</strong><small>仅保存在 Windows 用户环境变量中，留空保持原值</small></span>
              <input id="deepseek-api-key" type="password" autocomplete="off">
            </label>
            <label>
              <span><strong>Base URL</strong><small>默认使用 DeepSeek 官方 API 地址</small></span>
              <input id="deepseek-base-url" type="url" autocomplete="off" spellcheck="false">
            </label>
          </fieldset>
          <div class="weather-settings-actions">
            <div class="weather-settings-statuses"><small id="deepseek-settings-status">DeepSeek API：正在读取...</small></div>
            <button type="submit">保存配置</button>
          </div>
        </form>
      </section>
      <section class="settings-section">
        <h2>QQ 邮箱</h2>
        <form class="settings-panel weather-settings-panel mail-settings-panel" id="mail-settings-form">
          <fieldset>
            <legend><strong>QQ 邮箱 IMAP</strong><small>邮箱地址和授权码仅保存在 Windows 用户环境变量中</small></legend>
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
      </section>
      <section class="settings-section">
        <h2>通用</h2>
      <div class="settings-panel">
        <div><span><strong>Floating window</strong><small>Show the status capsule on your desktop.</small></span><b class="enabled">Enabled</b></div>
        <div><span><strong>Always on top</strong><small>Keep WinPlate above other windows.</small></span><b class="enabled">Enabled</b></div>
        <div><span><strong>Codex source</strong><small>Hidden local CLI session using /status.</small></span><b>${statusData.codex.source || "Unavailable"}</b></div>
      </div></section></div>`
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
  const tokenUsage = deepseek.tokenUsage?.model === "deepseek-v4-pro"
    ? deepseek.tokenUsage
    : null;
  const tokenValue = (value) => Number.isFinite(Number(value))
    ? `${Number(value).toLocaleString("en-US")} tokens`
    : "--";
  const tokenPanel = `
    <div class="deepseek-token-panel">
      <header><strong>缓存命中率</strong></header>
      <span class="deepseek-api-notice">暂未提供接口<i aria-hidden="true"></i></span>
      <div><i class="cache-hit"></i><span>输入（命中缓存）</span><strong>${tokenValue(tokenUsage?.cacheHitTokens)}</strong></div>
      <div><i class="cache-miss"></i><span>输入（未命中缓存）</span><strong>${tokenValue(tokenUsage?.cacheMissTokens)}</strong></div>
      <div><i class="output"></i><span>输出</span><strong>${tokenValue(tokenUsage?.outputTokens)}</strong></div>
    </div>`;
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
            ${walletIcon}
            <div class="deepseek-wallet-balance">
              <strong><span>${deepseekCurrencySymbol(balance.currency)}</span>${formatDeepSeekBalance(balance)}</strong>
              <small>Available balance</small>
            </div>
          </div>
          ${tokenPanel}
        </article>`).join("")
    : `<article class="deepseek-balance-card deepseek-empty">
        <div class="deepseek-balance-metric deepseek-wallet-metric">
          ${walletIcon}
          <div class="deepseek-wallet-balance">
            <strong><span>¥</span>--</strong>
            <small>Available balance</small>
          </div>
        </div>
        ${tokenPanel}
        <small>${deepseek.configured ? "余额暂不可用，请检查 API 配置" : "请先在设置中配置 DeepSeek API Key"}</small>
      </article>`;
  return `
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
      <div class="codex-cli-status ${deepseek.status === "Normal" ? "" : "inactive"}"><span></span>Status: DeepSeek API ${deepseek.status === "Normal" ? "active" : deepseek.status || "unconfigured"}</div>
    </section>`;
}

function renderMain() {
  const previousMainContent = document.querySelector(".main-content");
  const previousScrollPosition = previousMainContent
    ? { top: previousMainContent.scrollTop, left: previousMainContent.scrollLeft }
    : null;
  document.body.className = "main-body";
  applyMainTheme();
  const sections = ["Dashboard", "GitHub", "Codex", "Mail", "Notifications", "Heart", "QWeather"];
  appRoot.innerHTML = `
    <div class="main-window-shell">
      <header class="app-titlebar">
        <div class="titlebar-brand"><img src="../../assets/icon.png" alt=""></div>
        <div class="titlebar-drag-region" aria-hidden="true"></div>
        <div class="window-controls">
          <button id="window-minimize" aria-label="最小化"><span></span></button>
          <button id="window-maximize" aria-label="${mainWindowMaximized ? "还原" : "最大化"}"><span class="${mainWindowMaximized ? "restore-icon" : ""}"></span></button>
          <button id="window-close" class="close" aria-label="关闭"><span></span></button>
        </div>
      </header>
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
              <i>⚙</i>
              <span class="nav-label">设置</span>
            </button>
          </div>
        </aside>
        <main class="main-content">
          <header>
            <div><span class="live-dot"></span> LIVE STATUS</div>
            <time class="system-clock" id="system-clock">
              <span class="system-date"></span>
              <span class="system-time"></span>
            </time>
          </header>
          <section id="page-content">${dashboardContent(currentSection)}</section>
        </main>
      </div>`;
  updateProgressBars(appRoot);
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
      bindWeatherSettings();
      bindDeepSeekSettings();
      bindGithubControls();
      bindQWeatherUsageControls();
      bindMailControls();
      bindNotificationControls();
    });
  });
  bindThemeControls();
  bindWeatherSettings();
  bindDeepSeekSettings();
  bindGithubControls();
  bindQWeatherUsageControls();
  bindMailControls();
  bindNotificationControls();
  document.querySelector("#window-minimize").addEventListener("click", () => window.winplate.minimizeWindow());
  document.querySelector("#sidebar-toggle").addEventListener("click", () => {
    sidebarCollapsed = !sidebarCollapsed;
    const workspace = document.querySelector(".workspace");
    workspace.classList.toggle("sidebar-collapsed", sidebarCollapsed);
    const toggle = document.querySelector("#sidebar-toggle");
    toggle.setAttribute("aria-label", sidebarCollapsed ? "展开侧栏" : "关闭边栏");
    toggle.setAttribute("aria-expanded", String(!sidebarCollapsed));
    toggle.dataset.tooltip = sidebarCollapsed ? "展开边栏" : "关闭边栏";
  });
  document.querySelector("#window-maximize").addEventListener("click", async () => {
    mainWindowMaximized = await window.winplate.toggleMaximizeWindow();
    updateMaximizeButton();
  });
  document.querySelector("#window-close").addEventListener("click", () => window.winplate.closeWindow());
  startSystemClock();
}

function updateMainStatusDom() {
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

  if (currentChildren.length !== desiredChildren.length) {
    const mainContent = document.querySelector(".main-content");
    const scrollPosition = mainContent
      ? { top: mainContent.scrollTop, left: mainContent.scrollLeft }
      : null;
    pageContent.replaceChildren(...desiredChildren.map((node) => node.cloneNode(true)));
    if (scrollPosition) mainContent.scrollTo(scrollPosition);
    bindAvatarFallbacks(pageContent);
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
    bindGithubControls();
    bindQWeatherUsageControls();
    bindMailControls();
    bindNotificationControls();
  }
  updateProgressBars(pageContent);
}

function updateFloatingStatusDom() {
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
            <div class="module interactive-module github-module no-drag" id="github-module" role="link" tabindex="0" aria-label="Open GitHub profile">
              <span class="github-avatar-button" aria-hidden="true">${avatarMarkup(statusData.github, "github-avatar-bar")}</span>
              <span class="github-summary">GitHub</span>
            </div>
            <div class="module interactive-module codex-module no-drag">
              ${codexIcon}<span class="module-label">Codex</span>
              ${progressBar(statusData.codex.remainingPct, "usage-track")}
              <strong class="metric">${statusData.codex.remainingPct ?? "--"}%</strong>
              ${quotaStatusLamp(statusData.codex.remainingPct)}
              <span class="metric reset">${statusData.codex.resetClock || statusData.codex.resetText || "--:--"}</span>
            </div>
          </div>
          <div class="status-group notification-status">
            ${notificationStrip()}
          </div>
          <div class="status-group auxiliary-status">
            <div class="module interactive-module weather-module no-drag" id="weather-module">
              ${weatherIconMarkup(weather.icon)}
              <strong class="metric">${weather.temperature}°C</strong>
              <span class="weather-condition">${weather.condition}</span>
            </div>
            <div class="system-status">
              <div class="module interactive-module heart-module no-drag" id="heart-module">
                <span class="heart-icon">♥</span><strong class="metric">${statusData.heart.heartRate ?? "--"}</strong>
              </div>
              <div class="module interactive-module network-module no-drag" id="network-module">
                <span class="network-speed">${networkSpeedLabel()}</span>
              </div>
              <div class="right-controls no-drag">${shell.querySelector(".right-controls")?.innerHTML || ""}</div>
            </div>
          </div>
        </div>
      </section>
    </main>`;
  syncDomNode(shell, template.content.firstElementChild);
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
      status: "获取失败",
      error: error.message,
      updatedAt: Date.now()
    };
  }
  if (view === "floating") {
    const label = document.querySelector("#network-module .network-speed");
    if (label) {
      label.textContent = networkSpeedLabel();
    }
    const module = document.querySelector("#network-module");
    if (module) {
      module.classList.toggle("network-error", networkSpeed.status && networkSpeed.status !== "正常" && networkSpeed.status !== "获取中");
    }
  }
}

function bindQWeatherUsageControls() {
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

function bindMailControls() {
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
    updateMainStatusDom();
    try {
      mailOutline = await window.winplate.refreshMailOutline();
      mailSettings = await window.winplate.getMailSettings();
    } catch (error) {
      mailOutline = {
        ...mailOutline,
        availability: "unavailable",
        error: error.message || "邮件刷新失败"
      };
    } finally {
      mailRefreshInFlight = false;
      updateMainStatusDom();
    }
  };
}

function bindNotificationControls() {
  const markAllButton = document.querySelector("#mark-all-notifications-read");
  if (markAllButton) {
    markAllButton.onclick = async () => {
      if (notificationActionInFlight) return;
      notificationActionInFlight = true;
      markAllButton.disabled = true;
      try {
        notificationSummary = await window.winplate.markAllNotificationsRead();
      } catch (error) {
        console.error("Failed to mark notifications read:", error);
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
      } catch (error) {
        console.error("Failed to push test notification:", error);
      } finally {
        notificationActionInFlight = false;
        updateMainStatusDom();
      }
    };
  }
  document.querySelectorAll("[data-notification-read]").forEach((button) => {
    button.onclick = async () => {
      if (notificationActionInFlight || button.disabled) return;
      notificationActionInFlight = true;
      button.disabled = true;
      try {
        notificationSummary = await window.winplate.markNotificationRead(button.dataset.notificationRead);
      } catch (error) {
        console.error("Failed to mark notification read:", error);
      } finally {
        notificationActionInFlight = false;
        updateMainStatusDom();
      }
    };
  });
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

async function refreshQWeatherAlerts() {
  try {
    await window.winplate.refreshQWeatherAlerts();
  } catch (error) {
    console.warn("QWeather alerts unavailable:", error.message);
  }
}

async function hydrateMail() {
  if (view !== "main") return;
  try {
    mailSettings = await window.winplate.getMailSettings();
    mailOutline = await window.winplate.getMailOutline();
  } catch (error) {
    mailOutline = {
      ...mailOutline,
      availability: "unavailable",
      error: error.message || "邮件大纲读取失败"
    };
  }
}

function bindGithubControls() {
  document.querySelectorAll("[data-open-github]").forEach((button) => {
    button.addEventListener("click", () => window.winplate.openGithubProfile(statusData.github.profileUrl));
  });
  document.querySelectorAll("[data-month-direction]").forEach((button) => {
    button.addEventListener("click", () => {
      const months = githubContributionMonths(normalizeGithub(statusData.github));
      const currentIndex = months.findIndex((month) => month.key === selectedContributionMonth);
      const safeIndex = currentIndex >= 0 ? currentIndex : months.length - 1;
      const nextIndex = Math.max(0, Math.min(months.length - 1, safeIndex + Number(button.dataset.monthDirection)));
      selectedContributionMonth = months[nextIndex].key;
      updateMainStatusDom();
    });
  });
  const refreshButton = document.querySelector("#refresh-github");
  if (!refreshButton) return;
  refreshButton.addEventListener("click", async () => {
    if (githubRefreshInFlight) return;
    githubRefreshInFlight = true;
    updateMainStatusDom();
    try {
      statusData.github = normalizeGithub(await window.winplate.refreshGithub(), statusData.github);
    } catch (error) {
      console.error("GitHub refresh failed:", error);
      statusData.github = normalizeGithub({
        ...statusData.github,
        status: "Cached",
        availability: "unavailable",
        stateMessage: "Refresh failed; showing last known data."
      }, statusData.github);
    } finally {
      githubRefreshInFlight = false;
      updateMainStatusDom();
    }
  });
}

function updateMaximizeButton() {
  const button = document.querySelector("#window-maximize");
  if (!button) return;
  button.setAttribute("aria-label", mainWindowMaximized ? "还原" : "最大化");
  button.querySelector("span").classList.toggle("restore-icon", mainWindowMaximized);
}

async function refreshStatus() {
  if (view === "tooltip") {
    return;
  }
  try {
    const incomingStatus = await window.winplate.getStatus();
    statusData = {
      ...mockStatus,
      ...statusData,
      ...incomingStatus,
      github: normalizeGithub(incomingStatus.github, statusData.github),
      codex: { ...mockStatus.codex, ...statusData.codex, ...incomingStatus.codex },
      heart: { ...mockStatus.heart, ...statusData.heart, ...incomingStatus.heart },
      weather: { ...mockStatus.weather, ...statusData.weather, ...incomingStatus.weather }
    };
    statusData.codex = {
      ...statusData.codex,
      ...await window.winplate.getCodexUsage()
    };
    statusData.deepseek = {
      ...mockStatus.deepseek,
      ...statusData.deepseek,
      ...await window.winplate.getDeepSeekUsage()
    };
    await hydrateQWeatherUsage();
    await hydrateMail();
    await hydrateNotifications();
    if (!locationWeatherPromise && navigator.geolocation) {
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
        console.warn("Automatic weather location unavailable:", error.message);
        return null;
      });
    }
    const locatedWeather = await locationWeatherPromise;
    if (locatedWeather) {
      statusData.weather = { ...statusData.weather, ...locatedWeather };
      await refreshQWeatherAlerts();
      await hydrateNotifications();
    }
  } catch (error) {
    console.error("FastAPI unavailable, showing offline status:", error);
    statusData = {
      ...offlineStatus,
      github: normalizeGithub(statusData.github, offlineStatus.github)
    };
  }

  if (view === "floating") {
    updateFloatingStatusDom();
  } else {
    updateMainStatusDom();
  }
}

if (view === "main") {
  renderMain();
  Promise.all([hydrateAppearanceSettings(), hydrateQWeatherUsage(), hydrateMail(), hydrateNotifications()]).then(refreshStatus);
} else {
  refreshStatus();
}
if (view !== "tooltip") {
  setInterval(refreshStatus, 30_000);
  if (view === "floating") {
    refreshNetworkSpeed();
    setInterval(refreshNetworkSpeed, 2_000);
  }
} else {
  renderTooltip();
  window.winplate.onTooltipUpdate(renderTooltip);
}

window.winplate.onNavigate((section) => {
  currentSection = section;
  if (view === "main") {
    renderMain();
  }
});

window.winplate.onMaximizedChange((value) => {
  mainWindowMaximized = value;
  updateMaximizeButton();
});
