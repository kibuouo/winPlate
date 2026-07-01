const REQUIRED_META_FIELDS = [
  "id",
  "title",
  "views",
  "defaultEnabled",
  "defaultOrder",
  "defaultRefreshSeconds",
  "minRefreshSeconds",
  "maxRefreshSeconds",
  "configurable"
];

export function validateRendererModuleContract(module) {
  if (!module || typeof module !== "object") throw new TypeError("renderer module must be an object");
  REQUIRED_META_FIELDS.forEach((field) => {
    if (module.meta?.[field] === undefined) throw new TypeError(`renderer module meta.${field} is required`);
  });
  ["load", "normalize", "getStatus", "renderDashboard", "renderDetail", "renderFloating", "bind"].forEach((method) => {
    if (typeof module[method] !== "function") throw new TypeError(`renderer module ${module.meta.id} requires ${method}()`);
  });
  return module;
}

export function createRendererModule(meta) {
  return {
    meta,
    load: (context, options = {}) => context.load(meta.id, options),
    normalize: (raw, previous) => ({ ...(previous || {}), ...(raw || {}) }),
    getStatus: (_data, health) => health?.state || "loading",
    renderDashboard: (context) => context.render(meta.id, "dashboard"),
    renderDetail: (context) => context.render(meta.id, "detail"),
    renderFloating: (context) => context.render(meta.id, "floating"),
    bind: (root, context) => context.bind(meta.id, root)
  };
}
