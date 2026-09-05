(function initWeatherState(scope, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (scope) scope.WinPlateWeatherState = api;
})(typeof window !== "undefined" ? window : globalThis, () => {
  function createRequests() {
    let version = 0;
    let pending = false;
    return {
      begin() { pending = true; return ++version; },
      current(token) { return token === version; },
      finish(token) { if (token === version) pending = false; },
      get version() { return version; },
      get pending() { return pending; }
    };
  }

  function normalizeAlerts(value = {}) {
    const alerts = Array.isArray(value?.alerts) ? value.alerts : [];
    const error = typeof value?.error === "string" ? value.error : "";
    return {
      source: value?.source || "qweather",
      alerts,
      availability: value?.availability || (error ? "unavailable" : alerts.length ? "active" : "empty"),
      locationQuery: String(value?.locationQuery || ""),
      updatedAt: value?.updatedAt != null && Number.isFinite(Number(value.updatedAt)) ? Number(value.updatedAt) : null,
      error
    };
  }

  function alertsAreCurrent(value, weather, now = Date.now()) {
    return ["active", "empty"].includes(value?.availability) && !value?.error
      && Boolean(value.updatedAt) && now - value.updatedAt <= 10 * 60_000
      && Boolean(value.locationQuery) && value.locationQuery === weather?.locationQuery;
  }

  function currentAlerts(value, weather, now = Date.now()) {
    return alertsAreCurrent(value, weather, now) ? value.alerts || [] : [];
  }

  function activeAlerts(value, weather, now = Date.now()) {
    return currentAlerts(value, weather, now).filter((alert) => !["resolved", "cancelled", "ended"].includes(String(alert?.lifecycle || "").toLowerCase()));
  }

  function failedAlerts(previous, error) {
    return { ...normalizeAlerts(previous), availability: previous?.alerts?.length ? "stale" : "unavailable", error: error?.message || "天气预警读取失败" };
  }

  return { createRequests, normalizeAlerts, alertsAreCurrent, currentAlerts, activeAlerts, failedAlerts };
});
