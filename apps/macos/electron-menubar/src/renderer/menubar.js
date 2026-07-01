"use strict";

const {
  EMPTY_PANEL_STATE: initialPanelState,
  reducePanelState: reduceMenuBarPanelState
} = window.WinPlateMenuBarModel;

const panel = document.querySelector("#menu-bar-panel");
const refreshButton = document.querySelector("#refresh-panel");
const elements = {
  codexStatusPoint: document.querySelector("#codex-status-point"),
  codexStatusCopy: document.querySelector("#codex-status-copy"),
  codexUpdatedAt: document.querySelector("#codex-updated-at"),
  fiveHourProgress: document.querySelector("#codex-five-hour-progress"),
  fiveHourPercent: document.querySelector("#codex-five-hour-percent"),
  fiveHourReset: document.querySelector("#codex-five-hour-reset"),
  sevenDayProgress: document.querySelector("#codex-seven-day-progress"),
  sevenDayPercent: document.querySelector("#codex-seven-day-percent"),
  sevenDayReset: document.querySelector("#codex-seven-day-reset"),
  deepseekStatusPoint: document.querySelector("#deepseek-status-point"),
  deepseekStatusCopy: document.querySelector("#deepseek-status-copy"),
  deepseekUpdatedAt: document.querySelector("#deepseek-updated-at"),
  deepseekBalance: document.querySelector("#deepseek-balance"),
  deepseekConfigure: document.querySelector("#deepseek-configure"),
  weatherIcon: document.querySelector("#weather-icon"),
  weatherTemperature: document.querySelector("#weather-temperature"),
  weatherCondition: document.querySelector("#weather-condition"),
  weatherLocation: document.querySelector("#weather-location")
};

let panelState = initialPanelState;
let refreshing = false;

function formatUpdatedAt(value) {
  if (value === null || value === undefined) return "更新于 --";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "更新于 --";
  return `更新于 ${date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  })}`;
}

function serviceStatusCopy(service) {
  if (service.active) return "可用 (Active)";
  if (service.status === "Unconfigured") return "未配置 (Unconfigured)";
  return "不可用 (Unavailable)";
}

function updateServiceStatus(point, copy, service) {
  point.classList.toggle("inactive", !service.active);
  copy.textContent = serviceStatusCopy(service);
}

function updateProgress(progress, percent, reset, usage) {
  const value = Number.isFinite(usage.remainingPct) ? usage.remainingPct : null;
  progress.value = value ?? 0;
  progress.setAttribute("aria-valuetext", value === null ? "不可用" : `剩余 ${value}%`);
  percent.textContent = value === null ? "--%" : `${value}%`;
  reset.textContent = usage.resetText || "--";
}

function updatePanelDom() {
  updateServiceStatus(
    elements.codexStatusPoint,
    elements.codexStatusCopy,
    panelState.codex
  );
  elements.codexUpdatedAt.textContent = formatUpdatedAt(panelState.codex.updatedAt);
  updateProgress(
    elements.fiveHourProgress,
    elements.fiveHourPercent,
    elements.fiveHourReset,
    panelState.codex.fiveHour
  );
  updateProgress(
    elements.sevenDayProgress,
    elements.sevenDayPercent,
    elements.sevenDayReset,
    panelState.codex.sevenDay
  );

  updateServiceStatus(
    elements.deepseekStatusPoint,
    elements.deepseekStatusCopy,
    panelState.deepseek
  );
  elements.deepseekUpdatedAt.textContent = formatUpdatedAt(panelState.deepseek.updatedAt);
  elements.deepseekBalance.textContent = panelState.deepseek.balance === null
    ? "¥--"
    : `¥${panelState.deepseek.balance}`;
  elements.deepseekConfigure.hidden = panelState.deepseek.status !== "Unconfigured";

  const weather = panelState.weather;
  const temperature = weather.available && Number.isFinite(weather.temperature)
    ? Math.round(weather.temperature)
    : null;
  elements.weatherTemperature.textContent = temperature === null
    ? "--°"
    : `${temperature}°`;
  elements.weatherCondition.textContent = weather.available
    ? weather.condition
    : "不可用";
  elements.weatherLocation.textContent = weather.available ? weather.location : "--";

  const icon = weather.available && typeof weather.icon === "string" && /^\d{3}$/.test(weather.icon)
    ? weather.icon
    : null;
  elements.weatherIcon.hidden = icon === null;
  if (icon === null) {
    elements.weatherIcon.removeAttribute("src");
    elements.weatherIcon.alt = "";
  } else {
    elements.weatherIcon.src = `../../assets/qweather-icons/icons/${icon}.svg`;
    elements.weatherIcon.alt = `${weather.condition}天气图标`;
  }

  window.winplate.updateMenuBarTemperature(temperature);
}

function settledResult(result) {
  return result.status === "fulfilled"
    ? { ok: true, value: result.value }
    : { ok: false, error: result.reason };
}

async function refresh({ force = false } = {}) {
  if (refreshing) return;

  refreshing = true;
  refreshButton.disabled = true;
  panel.setAttribute("aria-busy", "true");

  try {
    const [status, codex, deepseek] = await Promise.allSettled([
      Promise.resolve().then(() => window.winplate.getStatus()),
      Promise.resolve().then(() => window.winplate.getCodexUsage({ force })),
      Promise.resolve().then(() => window.winplate.getDeepSeekUsage({ force }))
    ]);

    panelState = reduceMenuBarPanelState(panelState, {
      status: settledResult(status),
      codex: settledResult(codex),
      deepseek: settledResult(deepseek)
    });
    updatePanelDom();
  } catch (error) {
    console.error("Failed to refresh menu bar panel", error);
  } finally {
    refreshing = false;
    refreshButton.disabled = false;
    panel.removeAttribute("aria-busy");
  }
}

document.querySelector("#open-dashboard").addEventListener("click", () => {
  window.winplate.showMainWindow("Dashboard");
});

document.querySelector("#open-settings").addEventListener("click", () => {
  window.winplate.showMainWindow("Settings");
});

elements.deepseekConfigure.addEventListener("click", () => {
  window.winplate.showMainWindow("Settings");
});

refreshButton.addEventListener("click", () => refresh({ force: true }));

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") window.winplate.hideMenuBarPanel();
});

window.winplate.onMenuBarRefresh(() => refresh({ force: true }));
refresh();
setInterval(refresh, 30_000);
