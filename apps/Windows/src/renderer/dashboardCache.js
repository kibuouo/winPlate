(function initDashboardCache(globalScope, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.WinPlateDashboardCache = api;
})(typeof window !== "undefined" ? window : globalThis, () => {
  const CACHE_KEY = "winplate-dashboard-data-v1";
  const CACHE_VERSION = 1;

  function resolveStorage(storage) {
    if (storage !== undefined) return storage;
    try {
      return globalThis.localStorage;
    } catch {
      return null;
    }
  }

  function read(storage) {
    const target = resolveStorage(storage);
    if (!target || typeof target.getItem !== "function") return null;
    try {
      const raw = target.getItem(CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (
        !parsed
        || parsed.version !== CACHE_VERSION
        || !Number.isFinite(Number(parsed.updatedAt))
        || !parsed.data
        || typeof parsed.data !== "object"
        || Array.isArray(parsed.data)
      ) {
        return null;
      }
      return {
        version: CACHE_VERSION,
        updatedAt: Number(parsed.updatedAt),
        data: parsed.data
      };
    } catch {
      return null;
    }
  }

  function write(data, { storage, now = Date.now() } = {}) {
    const target = resolveStorage(storage);
    const timestamp = Number(now);
    if (
      !target
      || typeof target.setItem !== "function"
      || !data
      || typeof data !== "object"
      || Array.isArray(data)
      || !Number.isFinite(timestamp)
    ) {
      return false;
    }
    try {
      target.setItem(CACHE_KEY, JSON.stringify({
        version: CACHE_VERSION,
        updatedAt: timestamp,
        data
      }));
      return true;
    } catch {
      return false;
    }
  }

  function clear(storage) {
    const target = resolveStorage(storage);
    if (!target || typeof target.removeItem !== "function") return false;
    try {
      target.removeItem(CACHE_KEY);
      return true;
    } catch {
      return false;
    }
  }

  return Object.freeze({ CACHE_KEY, CACHE_VERSION, read, write, clear });
});
