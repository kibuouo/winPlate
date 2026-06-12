let statusData = mockStatus;
const offlineStatus = {
  github: { ...mockStatus.github },
  codex: { remainingPct: null, usedPct: null, resetText: "--:--", windowHours: 5, status: "Offline" },
  heart: { heartRate: null, unit: "bpm", source: "Offline", updatedAt: "unavailable" },
  weather: { ...mockStatus.weather }
};
const appRoot = document.querySelector("#app");
const view = new URLSearchParams(window.location.search).get("view") || "main";
let currentSection = "Dashboard";
let codexRefreshing = false;
let floatingPinned = false;
let systemClockTimer = null;
let tooltipHideTimer = null;

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
const codexIcon = `<img class="codex-icon" src="../../assets/codex-icon.png" alt="">`;

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

const previewIcons = {
  repos: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3.5" width="14" height="17" rx="2"></rect><path d="M8 7h8M8 17h8M9 20.5v2M15 20.5v2"></path></svg>`,
  commits: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"></circle><path d="M12 7.5V12l3 2"></path></svg>`,
  streak: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 3.5c.7 3.1-1.8 4.6-1.8 7.1 0 1.2.7 2 1.7 2.5-.2-2.1 1-3.3 2.4-4.7 1.5 1.6 2.7 3.5 2.7 6A6.5 6.5 0 1 1 8 9.3c.1 2 1 3.2 2.1 3.8-.5-3.8 1.1-6.8 3.4-9.6Z"></path></svg>`,
  repository: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3.5" width="14" height="17" rx="2"></rect><path d="M8 7h8M8 17h8M9 20.5v2M15 20.5v2"></path></svg>`,
  star: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z"></path></svg>`
};

function renderFloating() {
  const weather = statusData.weather || mockStatus.weather;
  const date = new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric"
  }).format(new Date());
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
              <span class="metric reset">${statusData.codex.resetText || "--:--"}</span>
              <time class="date-label">${date}</time>
            </div>
          </div>
          <div class="status-group auxiliary-status">
            <div class="module weather-module no-drag">
              <span class="weather-icon">${weather.icon}</span>
              <strong class="metric">${weather.temperature}°C</strong>
              <span class="weather-condition">${weather.condition}</span>
              <div class="tooltip weather-tooltip">
                <span>${weather.location}</span>
                <span>${weather.temperature}°C · ${weather.condition}</span>
              </div>
            </div>
            <div class="system-status">
              <div class="module heart-module no-drag">
                <span class="heart-icon">♥</span>
                <strong class="metric">${statusData.heart.heartRate ?? "--"}</strong>
                <div class="tooltip heart-tooltip">
                  <span>Current: ${statusData.heart.heartRate ?? "--"} ${statusData.heart.unit}</span>
                  <span>Source: ${statusData.heart.source}</span>
                  <span>Updated: ${statusData.heart.updatedAt}</span>
                </div>
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
        x: window.screenX + rect.left,
        y: window.screenY + rect.top,
        width: rect.width,
        height: rect.height
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
        x: window.screenX + rect.left,
        y: window.screenY + rect.top,
        width: rect.width,
        height: rect.height
      },
      data: {
        type: "codex",
        windowHours: statusData.codex.windowHours,
        remainingPct: statusData.codex.remainingPct,
        usedPct: statusData.codex.usedPct,
        resetText: statusData.codex.resetText,
        status: statusData.codex.status
      }
    });
  });
  codexModule.addEventListener("mouseleave", () => {
    tooltipHideTimer = setTimeout(() => window.winplate.hideTooltip(), 80);
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
    appRoot.innerHTML = `
      <article class="github-hover-card" role="tooltip" aria-label="GitHub profile preview">
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
  appRoot.innerHTML = `
    <div class="system-tooltip" role="tooltip">
      <span>Codex usage window: ${data.windowHours ?? "--"}h</span>
      <span>Remaining: ${data.remainingPct ?? "--"}%</span>
      <span>Used: ${data.usedPct ?? "--"}%</span>
      <span>Reset: ${data.resetText || "--:--"}</span>
      <span>Status: ${data.status || "Unavailable"}</span>
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
    GitHub: `<div class="page-heading"><p>GITHUB</p><h1>${statusData.github.username}</h1><span>Live profile and repository status from GitHub.</span></div>${cards.split("</article>")[0]}</article>`,
    Codex: codexContent(),
    Heart: `<div class="page-heading"><p>HEART</p><h1>Health snapshot</h1><span>Recent reading from ${statusData.heart.source}.</span></div>${cards.split("</article>")[2]}</article>`,
    Settings: `<div class="page-heading"><p>PREFERENCES</p><h1>Settings</h1><span>Configure your WinPlate experience.</span></div>
      <div class="settings-panel">
        <div><span><strong>Floating window</strong><small>Show the status capsule on your desktop.</small></span><b class="enabled">Enabled</b></div>
        <div><span><strong>Always on top</strong><small>Keep WinPlate above other windows.</small></span><b class="enabled">Enabled</b></div>
        <div><span><strong>Codex source</strong><small>Hidden local CLI session using /status.</small></span><b>${statusData.codex.source || "Unavailable"}</b></div>
      </div>`
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
      <div class="codex-update">
        <span>${relativeUpdatedAt(statusData.codex.updatedAt)}</span>
        <button id="refresh-codex" aria-label="刷新 Codex 用量" title="刷新 Codex 用量" ${codexRefreshing ? "disabled" : ""}>
          <span class="${codexRefreshing ? "spinning" : ""}">⟳</span>
        </button>
      </div>
    </div>
    <section class="codex-usage-panel">
      <div class="codex-panel-title">${codexIcon}<h2>Codex Usage</h2></div>
      <div class="usage-window-grid">
        ${usageWindowCard("5-hour window", fiveHour)}
        ${usageWindowCard("7-day window", sevenDay)}
      </div>
      <div class="codex-cli-status"><span></span>Status: Codex CLI ${statusData.codex.status === "Unavailable" ? "unavailable" : "active"}</div>
    </section>`;
}

function bindCodexRefresh() {
  const button = document.querySelector("#refresh-codex");
  if (!button) return;
  button.addEventListener("click", async () => {
    codexRefreshing = true;
    document.querySelector("#page-content").innerHTML = codexContent();
    updateProgressBars(document.querySelector("#page-content"));
    bindCodexRefresh();
    try {
      statusData.codex = { ...statusData.codex, ...await window.winplate.getCodexUsage({ force: true }) };
    } finally {
      codexRefreshing = false;
      document.querySelector("#page-content").innerHTML = codexContent();
      updateProgressBars(document.querySelector("#page-content"));
      bindCodexRefresh();
    }
  });
}

function renderMain() {
  document.body.className = "main-body";
  const sections = ["Dashboard", "GitHub", "Codex", "Heart", "Settings"];
  appRoot.innerHTML = `
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
    </div>`;
  updateProgressBars(appRoot);

  document.querySelectorAll("nav button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelector("nav button.active").classList.remove("active");
      button.classList.add("active");
      currentSection = button.dataset.section;
      document.querySelector("#page-content").innerHTML = dashboardContent(button.dataset.section);
      updateProgressBars(document.querySelector("#page-content"));
      bindCodexRefresh();
    });
  });
  bindCodexRefresh();
  startSystemClock();
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
    statusData = {
      ...mockStatus,
      ...await response.json(),
      weather: statusData.weather || mockStatus.weather
    };
    statusData.codex = {
      ...statusData.codex,
      ...await window.winplate.getCodexUsage()
    };
  } catch (error) {
    console.error("FastAPI unavailable, showing offline status:", error);
    statusData = offlineStatus;
  }

  view === "floating" ? renderFloating() : renderMain();
}

refreshStatus();
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
