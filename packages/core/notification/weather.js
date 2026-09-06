const { notificationTaxonomy } = require("@winplate/shared-types");

const WEATHER = notificationTaxonomy.weather;
const CANONICAL_ALERT_COLORS = Object.freeze(Object.keys(WEATHER.alertColors));
const CANONICAL_ALERT_COLOR_SET = new Set(CANONICAL_ALERT_COLORS);
const ALIAS_TO_COLOR = new Map(
  Object.entries(WEATHER.alertColors)
    .flatMap(([color, aliases]) => aliases.map((alias) => [String(alias).toLowerCase(), color]))
);
const TITLE_CUE_ORDER = ["red", "yellow", "blue", "green"];
const TITLE_CUE_PATTERNS = TITLE_CUE_ORDER.map((color) => {
  const cues = WEATHER.titleCues?.[color] || [];
  const source = cues.map((cue) => cue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return { color, pattern: source ? new RegExp(source, "i") : /$^/ };
});

function canonicalAlertColor(value) {
  const token = String(value || "").trim().toLowerCase();
  if (!token) return null;
  if (CANONICAL_ALERT_COLOR_SET.has(token)) return token;
  return ALIAS_TO_COLOR.get(token) || null;
}

function weatherStorageLevel(color) {
  return WEATHER.alertColorLevels?.[color] || null;
}

function weatherDisplaySeverity(color) {
  return WEATHER.alertColorSeverities?.[color] || null;
}

function weatherColorFromTitle(content) {
  const text = String(content || "");
  if (!text.trim()) return null;
  for (const { color, pattern } of TITLE_CUE_PATTERNS) {
    if (pattern.test(text)) return color;
  }
  return null;
}

function weatherMeta(item = {}) {
  if (item.meta && typeof item.meta === "object") return item.meta;
  if (item.metadata && typeof item.metadata === "object") return item.metadata;
  return {};
}

function weatherAlertColor(item = {}) {
  const source = String(item.source || "").trim().toLowerCase();
  if (source && source !== "qweather" && source !== "weather") return null;
  const meta = weatherMeta(item);
  if (String(meta.lifecycle || "").toLowerCase() === "resolved") return "green";
  const titleColor = weatherColorFromTitle(`${item.title || ""} ${item.body || item.message || ""}`);
  if (titleColor) return titleColor;
  return canonicalAlertColor(meta.alertColor || meta.severity || meta.color || item.severity);
}

function classifyWeatherAlert(item = {}) {
  const color = weatherAlertColor(item);
  return {
    alertColor: color,
    level: weatherStorageLevel(color),
    severity: weatherDisplaySeverity(color)
  };
}

module.exports = {
  CANONICAL_ALERT_COLORS,
  canonicalAlertColor,
  classifyWeatherAlert,
  weatherAlertColor,
  weatherColorFromTitle,
  weatherDisplaySeverity,
  weatherStorageLevel
};
