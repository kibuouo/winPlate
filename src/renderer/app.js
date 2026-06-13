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
let selectedContributionMonth = null;
let locationWeatherPromise = null;
let weatherSettings = { hasApiKey: false, apiHost: "devapi.qweather.com" };
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

async function bindWeatherSettings() {
  const form = document.querySelector("#weather-settings-form");
  if (!form) return;
  const keyInput = form.querySelector("#qweather-api-key");
  const hostInput = form.querySelector("#qweather-api-host");
  const status = form.querySelector("#weather-settings-status");
  const saveButton = form.querySelector("button[type='submit']");
  try {
    weatherSettings = await window.winplate.getWeatherSettings();
    hostInput.value = weatherSettings.apiHost;
    keyInput.placeholder = weatherSettings.hasApiKey ? "已配置，留空则保持不变" : "请输入 API Key";
    status.textContent = weatherSettings.hasApiKey ? "API Key 已配置" : "尚未配置 API Key";
    status.classList.toggle("configured", weatherSettings.hasApiKey);
  } catch (error) {
    status.textContent = `读取失败：${error.message}`;
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    saveButton.disabled = true;
    status.textContent = "正在保存...";
    try {
      weatherSettings = await window.winplate.saveWeatherSettings({
        apiKey: keyInput.value,
        apiHost: hostInput.value
      });
      keyInput.value = "";
      keyInput.placeholder = "已配置，留空则保持不变";
      status.textContent = "保存成功，天气将在下次刷新时更新";
      status.classList.add("configured");
      locationWeatherPromise = null;
      refreshStatus();
    } catch (error) {
      status.textContent = `保存失败：${error.message}`;
      status.classList.remove("configured");
    } finally {
      saveButton.disabled = false;
    }
  });
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

function updateProgressBars(root = document) {
  root.querySelectorAll("[data-progress-value]").forEach((fill) => {
    const value = normalizePercent(fill.dataset.progressValue) ?? 0;
    requestAnimationFrame(() => {
      fill.style.width = `${value}%`;
    });
  });
}

const githubIcon = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" d="M12 .8a11.4 11.4 0 0 0-3.6 22.2c.6.1.8-.2.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.5-1.4-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.4 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.7 1.7.3 2.9.1 3.2.8.9 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.2c0 .4.2.7.8.6A11.4 11.4 0 0 0 12 .8Z"/>
  </svg>`;
const codexIcon = `
  <svg class="codex-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M7.25 18.25h9.5a4.25 4.25 0 0 0 .64-8.45A5.75 5.75 0 0 0 6.5 7.85a3.75 3.75 0 0 0 .75 7.42"/>
    <path d="m8.25 10.25 2.25 2.25-2.25 2.25M12.75 14.75h3"/>
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
  const firstDay = new Date(`${month.key}-01T00:00:00`).getDay();
  const mondayOffset = (firstDay + 6) % 7;
  const cellCount = Math.ceil((mondayOffset + values.length) / 7) * 7;
  const cells = Array.from({ length: cellCount }, (_, index) => {
    const sourceIndex = index - mondayOffset;
    const active = sourceIndex >= 0 && sourceIndex < values.length;
    const level = active ? Math.max(0, Math.min(4, Number(values[sourceIndex]) || 0)) : 0;
    return `<span class="github-calendar-cell level-${level}${active ? "" : " outside-month"}" title="${active ? `${month.label} ${sourceIndex + 1}` : ""}"></span>`;
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
          <button class="github-refresh-button" id="refresh-github" type="button" aria-label="Refresh GitHub data">
            <span>Refresh</span>
          </button>
        </div>
        <article class="github-pinned-card">
          <div class="github-card-heading"><span>Pinned repository</span><small>Public</small></div>
          <button type="button" data-open-github class="github-repo-link">${previewIcons.repository}<strong>${github.project}</strong></button>
          <div class="github-repo-meta"><span><i></i>${github.language}</span><span>${previewIcons.star}${github.stars}</span></div>
        </article>
        <article class="github-contribution-card">
          <div class="github-card-heading">
            <span>${activityCount} commits in ${selectedMonth.label}</span>
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
            <div><strong>Created ${activityCount} commits</strong><small>Recent public push activity</small></div>
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
  return `<img class="${className}" src="../../node_modules/qweather-icons/icons/${code}.svg" alt="" aria-hidden="true">`;
}

function renderFloating() {
  const weather = statusData.weather || mockStatus.weather;
  document.body.className = "floating-body";
  appRoot.innerHTML = `
    <main class="floating-shell" id="floating-shell" aria-label="WinPlate status">
      <section class="status-capsule">
        <div class="drag-handle" aria-hidden="true"></div>
        <div class="status-layout">
          <div class="status-group app-status">
            <div class="module github-module no-drag" id="github-module" role="link" tabindex="0" aria-label="Open GitHub profile">
              <span class="github-avatar-button" aria-hidden="true">
                ${avatarMarkup(statusData.github, "github-avatar-bar")}
              </span>
              <span class="github-summary">GitHub</span>
            </div>
            <div class="module codex-module no-drag">
              ${codexIcon}
              <span class="module-label">Codex</span>
              ${progressBar(statusData.codex.remainingPct, "usage-track")}
              <strong class="metric">${statusData.codex.remainingPct ?? "--"}%</strong>
              <span class="metric reset">${statusData.codex.resetClock || statusData.codex.resetText || "--:--"}</span>
            </div>
          </div>
          <div class="status-group auxiliary-status">
            <div class="module weather-module no-drag" id="weather-module">
              ${weatherIconMarkup(weather.icon)}
              <strong class="metric">${weather.temperature}°C</strong>
              <span class="weather-condition">${weather.condition}</span>
            </div>
            <div class="system-status">
              <div class="module heart-module no-drag" id="heart-module">
                <span class="heart-icon">♥</span>
                <strong class="metric">${statusData.heart.heartRate ?? "--"}</strong>
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
          <div><span>${previewIcons.commits} Commits</span><strong>${github.commitsThisMonth}</strong><small>This month</small></div>
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
          ${usageRow("Weekly", weekly)}
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

  const lines = Array.isArray(data.lines) ? data.lines : [];
  appRoot.innerHTML = `
    <div class="system-tooltip" role="tooltip">
      ${lines.map((line) => `<span>${line}</span>`).join("")}
    </div>`;
}

function dashboardContent(section) {
  const cards = `
    <div class="dashboard-grid">
      <article class="dashboard-card github-card">
        <div class="card-icon">${githubIcon}</div><span>GitHub Profile</span>
        <strong>${statusData.github.username}</strong><small>${statusData.github.repos} repositories · ${statusData.github.followers} followers</small>
      </article>
      <article class="dashboard-card codex-card">
        <div class="card-icon codex-card-icon">${codexIcon}</div><span>Codex Usage</span>
        <strong>${statusData.codex.remainingPct ?? "--"}%</strong><small>${statusData.codex.resetText ? `Resets ${statusData.codex.resetText}` : "Reset unavailable"}</small>
        ${progressBar(statusData.codex.remainingPct, "large-track")}
      </article>
      <article class="dashboard-card heart-card">
        <div class="card-icon">♥</div><span>Heart Rate</span>
        <strong>${statusData.heart.heartRate} <em>${statusData.heart.unit}</em></strong><small>${statusData.heart.source} · ${statusData.heart.updatedAt}</small>
      </article>
    </div>`;

  const content = {
    Dashboard: `<div class="page-heading"><p>OVERVIEW</p><h1>Good afternoon, ${statusData.github.name}</h1><span>Your live workspace status at a glance.</span></div>${cards}`,
    GitHub: githubContent(),
    Codex: codexContent(),
    Heart: `<div class="page-heading"><p>HEART</p><h1>Health snapshot</h1><span>Recent reading from ${statusData.heart.source}.</span></div>${cards.split("</article>")[2]}</article>`,
    Settings: `<div class="page-heading"><p>PREFERENCES</p><h1>Settings</h1><span>Configure your WinPlate experience.</span></div>
      <section class="settings-section">
        <h2>外观</h2>
        <div class="settings-panel appearance-panel">${themeSelector()}</div>
      </section>
      <section class="settings-section">
        <h2>天气</h2>
        <form class="settings-panel weather-settings-panel" id="weather-settings-form">
          <label>
            <span><strong>API Key</strong><small>来自 QWeather 控制台，仅保存在 Windows 用户环境变量中</small></span>
            <input id="qweather-api-key" type="password" autocomplete="off">
          </label>
          <label>
            <span><strong>API Host</strong><small>填写项目分配的 API Host，不包含 https://</small></span>
            <input id="qweather-api-host" type="text" autocomplete="off" spellcheck="false">
          </label>
          <div class="weather-settings-actions">
            <small id="weather-settings-status">正在读取配置...</small>
            <button type="submit">保存配置</button>
          </div>
        </form>
      </section>
      <section class="settings-section">
        <h2>通用</h2>
      <div class="settings-panel">
        <div><span><strong>Floating window</strong><small>Show the status capsule on your desktop.</small></span><b class="enabled">Enabled</b></div>
        <div><span><strong>Always on top</strong><small>Keep WinPlate above other windows.</small></span><b class="enabled">Enabled</b></div>
        <div><span><strong>Codex source</strong><small>Hidden local CLI session using /status.</small></span><b>${statusData.codex.source || "Unavailable"}</b></div>
      </div></section>`
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
    </section>`;
}

function renderMain() {
  document.body.className = "main-body";
  applyMainTheme();
  const sections = ["Dashboard", "GitHub", "Codex", "Heart", "Settings"];
  appRoot.innerHTML = `
    <div class="main-window-shell">
      <header class="app-titlebar">
        <div class="titlebar-brand"><img src="../../assets/icon.png" alt=""><span>WinPlate</span></div>
        <div class="window-controls">
          <button id="window-minimize" aria-label="最小化"><span></span></button>
          <button id="window-maximize" aria-label="${mainWindowMaximized ? "还原" : "最大化"}"><span class="${mainWindowMaximized ? "restore-icon" : ""}"></span></button>
          <button id="window-close" class="close" aria-label="关闭"><span></span></button>
        </div>
      </header>
      <div class="workspace">
      <aside class="sidebar">
        <div class="brand"><img src="../../assets/icon.png" alt=""><strong>WinPlate</strong></div>
        <nav>${sections.map((item) => `<button class="${item === currentSection ? "active" : ""}" data-section="${item}"><i>${item === "Dashboard" ? "⌂" : item === "GitHub" ? githubIcon : item === "Codex" ? codexIcon : item === "Heart" ? "♥" : "⚙"}</i>${item}</button>`).join("")}</nav>
        <div class="sidebar-status"><span></span><div><strong>All systems normal</strong><small>Codex CLI status active</small></div></div>
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
      </div>
    </div>`;
  updateProgressBars(appRoot);

  document.querySelectorAll("nav button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelector("nav button.active").classList.remove("active");
      button.classList.add("active");
      currentSection = button.dataset.section;
      document.querySelector("#page-content").innerHTML = dashboardContent(button.dataset.section);
      updateProgressBars(document.querySelector("#page-content"));
      bindThemeControls();
      bindWeatherSettings();
      bindGithubControls();
    });
  });
  bindThemeControls();
  bindWeatherSettings();
  bindGithubControls();
  document.querySelector("#window-minimize").addEventListener("click", () => window.winplate.minimizeWindow());
  document.querySelector("#window-maximize").addEventListener("click", async () => {
    mainWindowMaximized = await window.winplate.toggleMaximizeWindow();
    updateMaximizeButton();
  });
  document.querySelector("#window-close").addEventListener("click", () => window.winplate.closeWindow());
  startSystemClock();
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
      document.querySelector("#page-content").innerHTML = githubContent();
      bindAvatarFallbacks(document.querySelector("#page-content"));
      bindGithubControls();
    });
  });
  const refreshButton = document.querySelector("#refresh-github");
  if (!refreshButton) return;
  refreshButton.addEventListener("click", async () => {
    refreshButton.disabled = true;
    refreshButton.classList.add("refreshing");
    refreshButton.querySelector("span").textContent = "Refreshing";
    try {
      statusData.github = normalizeGithub(await window.winplate.refreshGithub(), statusData.github);
      document.querySelector("#page-content").innerHTML = githubContent();
      bindAvatarFallbacks(document.querySelector("#page-content"));
      bindGithubControls();
    } catch (error) {
      console.error("GitHub refresh failed:", error);
      statusData.github = normalizeGithub({
        ...statusData.github,
        status: "Cached",
        availability: "unavailable",
        stateMessage: "Refresh failed; showing last known data."
      }, statusData.github);
      document.querySelector("#page-content").innerHTML = githubContent();
      bindAvatarFallbacks(document.querySelector("#page-content"));
      bindGithubControls();
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
    const response = await fetch("http://127.0.0.1:8765/api/status", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const incomingStatus = await response.json();
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
    }
  } catch (error) {
    console.error("FastAPI unavailable, showing offline status:", error);
    statusData = {
      ...offlineStatus,
      github: normalizeGithub(statusData.github, offlineStatus.github)
    };
  }

  view === "floating" ? renderFloating() : renderMain();
}

if (view === "main") {
  hydrateAppearanceSettings().then(refreshStatus);
} else {
  refreshStatus();
}
if (view !== "tooltip") {
  setInterval(refreshStatus, 30_000);
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
