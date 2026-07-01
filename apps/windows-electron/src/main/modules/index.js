const { MODULES } = require("../../shared/moduleRegistry");

const IPC_BY_MODULE = Object.freeze({
  github: ["github:refresh", "github:open-profile"],
  codex: ["codex:usage", "deepseek:usage"],
  notifications: ["notifications:get", "notification:get-digest", "notifications:get-detail", "notifications:navigate", "notifications:copy"],
  mail: ["mail:get-outline", "mail:refresh", "mail:get-message", "email:read-message"],
  weather: ["status:get", "weather:set-location", "weather:get-usage", "weather:get-alert"],
  heart: ["status:get"],
  network: ["network:speed"]
});

const mainModules = Object.freeze(MODULES.map((meta) => Object.freeze({
  meta,
  ipcChannels: Object.freeze([...(IPC_BY_MODULE[meta.id] || [])])
})));

function validateMainModules(modules = mainModules) {
  const ids = new Set();
  modules.forEach((module) => {
    if (!module?.meta?.id || ids.has(module.meta.id)) throw new Error("main module ids must be unique");
    if (!Array.isArray(module.ipcChannels)) throw new TypeError(`${module.meta.id} ipcChannels must be an array`);
    ids.add(module.meta.id);
  });
  return modules;
}

module.exports = { IPC_BY_MODULE, mainModules, validateMainModules };
