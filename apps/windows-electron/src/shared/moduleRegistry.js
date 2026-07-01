(function initModuleRegistry(globalScope, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.WinPlateModuleRegistry = api;
})(typeof window !== "undefined" ? window : globalThis, () => {
  const MODULES = Object.freeze([
    { id: "github", title: "GitHub", section: "GitHub", views: ["dashboard", "detail", "floating"], defaultEnabled: true, defaultOrder: 10, defaultRefreshSeconds: 300, minRefreshSeconds: 30, maxRefreshSeconds: 3600, configurable: true },
    { id: "codex", title: "Codex", section: "Codex", views: ["dashboard", "detail", "floating"], defaultEnabled: true, defaultOrder: 20, defaultRefreshSeconds: 30, minRefreshSeconds: 15, maxRefreshSeconds: 600, configurable: true },
    { id: "notifications", title: "Notifications", section: "Notifications", views: ["detail", "floating"], defaultEnabled: true, defaultOrder: 40, defaultRefreshSeconds: 60, minRefreshSeconds: 30, maxRefreshSeconds: 1800, configurable: true },
    { id: "mail", title: "Mail", section: "Mail", views: ["detail"], defaultEnabled: true, defaultOrder: 30, defaultRefreshSeconds: 30, minRefreshSeconds: 15, maxRefreshSeconds: 1800, configurable: true },
    { id: "weather", title: "QWeather", section: "QWeather", views: ["dashboard", "detail", "floating"], defaultEnabled: true, defaultOrder: 60, defaultRefreshSeconds: 600, minRefreshSeconds: 60, maxRefreshSeconds: 3600, configurable: true },
    { id: "heart", title: "Heart", section: "Heart", views: ["dashboard", "detail", "floating"], defaultEnabled: true, defaultOrder: 50, defaultRefreshSeconds: 60, minRefreshSeconds: 30, maxRefreshSeconds: 3600, configurable: true },
    { id: "network", title: "Network", section: null, views: ["floating"], defaultEnabled: true, defaultOrder: 70, defaultRefreshSeconds: 2, minRefreshSeconds: 1, maxRefreshSeconds: 60, configurable: true }
  ]);

  const MODULE_BY_ID = new Map(MODULES.map((module) => [module.id, module]));

  function getModuleMeta(id) {
    return MODULE_BY_ID.get(String(id || "")) || null;
  }

  function orderedModules(order = []) {
    const requested = Array.isArray(order) ? order : [];
    const rank = new Map(requested.map((id, index) => [id, index]));
    return [...MODULES].sort((left, right) => {
      const leftRank = rank.has(left.id) ? rank.get(left.id) : requested.length + left.defaultOrder;
      const rightRank = rank.has(right.id) ? rank.get(right.id) : requested.length + right.defaultOrder;
      return leftRank - rightRank;
    });
  }

  function modulesForView(view, settings = {}) {
    const enabled = settings.enabled || {};
    return orderedModules(settings.order)
      .filter((module) => module.views.includes(view))
      .filter((module) => enabled[module.id] !== false);
  }

  return { MODULES, getModuleMeta, orderedModules, modulesForView };
});
