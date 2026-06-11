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
            <div class="module github-module no-drag">
              <button class="icon-button" id="github-button" aria-label="GitHub profile">${githubIcon}</button>
              <span class="module-label">GitHub</span>
              <div class="popover github-popover">
                <div class="profile-head">
                  <div class="avatar">K</div>
                  <div><strong>${statusData.github.name}</strong><span>${statusData.github.username}</span></div>
                </div>
                <div class="profile-stats">
                  <span><b>${statusData.github.repos}</b> Repos</span>
                  <span><b>${statusData.github.followers}</b> Followers</span>
                </div>
                <div class="project-row"><span>Current project</span><strong>${statusData.github.project}</strong></div>
                <div class="popover-actions">
                  <button id="open-profile">Open Profile</button>
                  <button class="secondary" id="refresh-profile">Refresh</button>
                </div>
              </div>
            </div>
            <div class="module codex-module no-drag">
              ${codexIcon}
              <span class="module-label">Codex</span>
              ${progressBar(statusData.codex.remainingPct, "usage-track")}
              <strong class="metric">${statusData.codex.remainingPct ?? "--"}%</strong>
              <span class="metric reset">${statusData.codex.resetText || "--:--"}</span>
              <time class="date-label">${date}</time>
              <div class="tooltip codex-tooltip">
                <span>Codex usage window: ${statusData.codex.windowHours}h</span>
                <span>Remaining: ${statusData.codex.remainingPct ?? "--"}%</span>
                <span>Used: ${statusData.codex.usedPct ?? "--"}%</span>
                <span>Reset: ${statusData.codex.resetText || "--:--"}</span>
                <span>Status: ${statusData.codex.status}</span>
              </div>
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

  const shell = document.querySelector("#floating-shell");
  shell.addEventListener("dblclick", () => window.winplate.showMainWindow());
  shell.addEventListener("click", (event) => {
    if (event.target === shell || event.target.classList.contains("status-capsule")) {
      window.winplate.showMainWindow();
    }
  });
  document.querySelector("#github-button").addEventListener("click", () => window.winplate.openGithubProfile());
  document.querySelector("#open-profile").addEventListener("click", () => window.winplate.openGithubProfile());
  document.querySelector("#refresh-profile").addEventListener("click", () => window.winplate.refreshGithub());
  document.querySelector("#settings-button").addEventListener("click", () => window.winplate.showMainWindow("Settings"));
  const pinButton = document.querySelector("#pin-button");

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
    GitHub: `<div class="page-heading"><p>GITHUB</p><h1>${statusData.github.username}</h1><span>Profile and repository status from mock data.</span></div>${cards.split("</article>")[0]}</article>`,
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
        <header><div><span class="live-dot"></span> LIVE STATUS</div><time>${statusData.codex.resetText || "--:--"}</time></header>
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
}

async function refreshStatus() {
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
setInterval(refreshStatus, 30_000);

window.winplate.onNavigate((section) => {
  currentSection = section;
  if (view === "main") {
    renderMain();
  }
});
