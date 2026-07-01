const EMPTY_PANEL_STATE = Object.freeze({
  codex: Object.freeze({
    active: false,
    status: "Unavailable",
    fiveHour: Object.freeze({ remainingPct: null, resetText: "--", updatedAt: null }),
    sevenDay: Object.freeze({ remainingPct: null, resetText: "--", updatedAt: null }),
    updatedAt: null
  }),
  deepseek: Object.freeze({
    active: false,
    status: "Unavailable",
    balance: null,
    updatedAt: null
  }),
  weather: Object.freeze({
    available: false,
    temperature: null,
    condition: "--",
    location: "--",
    icon: null,
    updatedAt: null
  })
});

function copyState(previous) {
  const state = previous || EMPTY_PANEL_STATE;
  return {
    codex: {
      ...EMPTY_PANEL_STATE.codex,
      ...state.codex,
      fiveHour: {
        ...EMPTY_PANEL_STATE.codex.fiveHour,
        ...state.codex?.fiveHour
      },
      sevenDay: {
        ...EMPTY_PANEL_STATE.codex.sevenDay,
        ...state.codex?.sevenDay
      }
    },
    deepseek: {
      ...EMPTY_PANEL_STATE.deepseek,
      ...state.deepseek
    },
    weather: {
      ...EMPTY_PANEL_STATE.weather,
      ...state.weather
    }
  };
}

function resultValue(result) {
  return result?.value ?? result?.data;
}

function finiteNumber(value) {
  if (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "") ||
    (typeof value !== "number" && typeof value !== "string")
  ) {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function percent(value, fallback) {
  const number = finiteNumber(value);
  return number === null ? fallback : Math.min(100, Math.max(0, number));
}

function timestamp(value, fallback) {
  if (Number.isFinite(value)) return value;
  if (
    typeof value === "string" &&
    value.trim() &&
    Number.isFinite(Date.parse(value))
  ) {
    return value;
  }
  return fallback;
}

function nonEmptyText(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function reduceCodex(previous, result) {
  if (!result) return previous;
  if (!result.ok) {
    return { ...previous, active: false, status: "Unavailable" };
  }

  const value = resultValue(result) || {};
  const updatedAt = timestamp(value.updatedAt, previous.updatedAt);
  const hasFiveHour = value.windows?.fiveHour !== null &&
    typeof value.windows?.fiveHour === "object";
  const fiveHour = hasFiveHour ? value.windows.fiveHour : {};
  const sevenDay = value.windows?.sevenDay || {};

  return {
    active: value.status === "Normal",
    status: nonEmptyText(value.status, "Unavailable"),
    fiveHour: {
      remainingPct: percent(
        hasFiveHour ? fiveHour.remainingPct : value.remainingPct,
        previous.fiveHour.remainingPct
      ),
      resetText: nonEmptyText(
        hasFiveHour ? fiveHour.resetText : value.resetText,
        previous.fiveHour.resetText
      ),
      updatedAt
    },
    sevenDay: {
      remainingPct: percent(sevenDay.remainingPct, previous.sevenDay.remainingPct),
      resetText: nonEmptyText(sevenDay.resetText, previous.sevenDay.resetText),
      updatedAt
    },
    updatedAt
  };
}

function readCnyBalance(value) {
  const balances = Array.isArray(value.balances) ? value.balances : [];
  const cny = balances.find((balance) => String(balance?.currency).toUpperCase() === "CNY");
  const source = cny?.totalBalance ?? cny?.total_balance ?? value.balance;
  if (source === null || source === undefined) return null;

  const balance = String(source).trim();
  return balance && Number.isFinite(Number(balance)) ? balance : null;
}

function reduceDeepSeek(previous, result) {
  if (!result) return previous;
  if (!result.ok) {
    return { ...previous, active: false, status: "Unavailable" };
  }

  const value = resultValue(result) || {};
  const status = nonEmptyText(value.status, "Unavailable");

  if (status === "Unavailable") {
    return { ...previous, active: false, status };
  }

  const updatedAt = timestamp(value.updatedAt, previous.updatedAt);

  if (status === "Unconfigured") {
    return { active: false, status, balance: null, updatedAt };
  }

  const balance = readCnyBalance(value);
  return {
    active: status === "Normal" && balance !== null,
    status,
    balance,
    updatedAt
  };
}

function weatherResult(statusResult) {
  if (!statusResult || !statusResult.ok) return statusResult;
  return { ok: true, value: resultValue(statusResult)?.weather };
}

function reduceWeather(previous, result) {
  if (!result) return previous;
  if (!result.ok) return { ...previous, available: false };

  const value = resultValue(result) || {};
  const temperature = finiteNumber(value.temperature);
  if (value.source !== "qweather" || temperature === null) {
    return { ...previous, available: false };
  }

  return {
    available: true,
    temperature,
    condition: nonEmptyText(value.condition, previous.condition),
    location: nonEmptyText(value.location, previous.location),
    icon: typeof value.icon === "string" && /^\d{3}$/.test(value.icon)
      ? value.icon
      : null,
    updatedAt: timestamp(value.updatedAt, previous.updatedAt)
  };
}

function reducePanelState(previous, results = {}) {
  const state = copyState(previous);
  return {
    codex: reduceCodex(state.codex, results.codex),
    deepseek: reduceDeepSeek(state.deepseek, results.deepseek),
    weather: reduceWeather(state.weather, weatherResult(results.status))
  };
}

const api = { EMPTY_PANEL_STATE, reducePanelState };

if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
}

if (typeof window !== "undefined") {
  window.WinPlateMenuBarModel = api;
}
