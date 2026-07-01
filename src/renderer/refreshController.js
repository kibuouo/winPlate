(function initRefreshController(globalScope, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.WinPlateRefresh = api;
})(typeof window !== "undefined" ? window : globalThis, () => {
  const VALID_STATES = new Set(["loading", "live", "stale", "error"]);
  const DEFAULT_REFRESH_TIMEOUT_MS = 15_000;

  function normalizeInterval(value) {
    const interval = Number(value);
    return Number.isFinite(interval) && interval > 0 ? Math.round(interval) : 0;
  }

  function normalizeTimeout(value) {
    const timeout = Number(value);
    return Number.isFinite(timeout) && timeout > 0
      ? Math.round(timeout)
      : DEFAULT_REFRESH_TIMEOUT_MS;
  }

  function createRefreshController({
    now = () => Date.now(),
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    onHealthChange = () => {}
  } = {}) {
    const entries = new Map();
    let started = false;

    function emit(entry, patch = {}) {
      entry.health = {
        ...entry.health,
        ...patch
      };
      if (!VALID_STATES.has(entry.health.state)) entry.health.state = "error";
      onHealthChange(entry.id, { ...entry.health });
    }

    function register(definition) {
      const id = String(definition?.id || "").trim();
      if (!id) throw new TypeError("refresh task id is required");
      if (typeof definition.refresh !== "function") throw new TypeError(`refresh task ${id} requires a refresh function`);
      if (entries.has(id)) throw new Error(`refresh task ${id} is already registered`);
      const entry = {
        id,
        refresh: definition.refresh,
        intervalMs: normalizeInterval(definition.intervalMs),
        timeoutMs: normalizeTimeout(definition.timeoutMs),
        timer: null,
        inFlight: null,
        forceQueued: false,
        queuedPromise: null,
        health: {
          state: "loading",
          lastSuccessAt: null,
          lastAttemptAt: null,
          error: ""
        }
      };
      entries.set(id, entry);
      if (started) schedule(entry);
      return controller;
    }

    function schedule(entry) {
      if (entry.timer) clearIntervalFn(entry.timer);
      entry.timer = null;
      if (!started || !entry.intervalMs) return;
      entry.timer = setIntervalFn(() => {
        refresh(entry.id, { force: false, reason: "timer" }).catch(() => {});
      }, entry.intervalMs);
    }

    function run(entry, options) {
      const attemptedAt = now();
      emit(entry, {
        state: entry.health.lastSuccessAt ? "stale" : "loading",
        lastAttemptAt: attemptedAt,
        error: ""
      });
      let timeout = null;
      const refreshPromise = Promise.resolve()
        .then(() => entry.refresh({
          force: Boolean(options.force),
          reason: options.reason || "manual"
        }));
      const timeoutPromise = new Promise((resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`${entry.id} 刷新超时，请稍后重试`));
        }, entry.timeoutMs);
      });
      const operation = Promise.race([refreshPromise, timeoutPromise])
        .then((value) => {
          emit(entry, {
            state: "live",
            lastSuccessAt: now(),
            error: ""
          });
          return value;
        })
        .catch((error) => {
          emit(entry, {
            state: entry.health.lastSuccessAt ? "stale" : "error",
            error: error?.message || String(error || "refresh failed")
          });
          throw error;
        })
        .finally(() => {
          clearTimeout(timeout);
          if (entry.inFlight === operation) entry.inFlight = null;
        });
      entry.inFlight = operation;
      return operation;
    }

    function queueForce(entry, options) {
      entry.forceQueued = true;
      if (entry.queuedPromise) return entry.queuedPromise;
      entry.queuedPromise = entry.inFlight
        .catch(() => undefined)
        .then(() => {
          if (!entry.forceQueued) return undefined;
          entry.forceQueued = false;
          return run(entry, { force: true, reason: options.reason || "queued-force" });
        })
        .finally(() => {
          entry.queuedPromise = null;
        });
      return entry.queuedPromise;
    }

    function refresh(id, options = {}) {
      const entry = entries.get(id);
      if (!entry) return Promise.reject(new Error(`unknown refresh task: ${id}`));
      if (entry.inFlight) {
        return options.force ? queueForce(entry, options) : entry.inFlight;
      }
      return run(entry, options);
    }

    function refreshAll(options = {}) {
      const ids = Array.isArray(options.ids) ? options.ids : [...entries.keys()];
      return Promise.allSettled(ids.map((id) => refresh(id, options)));
    }

    function configure(id, { intervalMs, timeoutMs } = {}) {
      const entry = entries.get(id);
      if (!entry) throw new Error(`unknown refresh task: ${id}`);
      entry.intervalMs = normalizeInterval(intervalMs);
      if (timeoutMs !== undefined) entry.timeoutMs = normalizeTimeout(timeoutMs);
      schedule(entry);
      return controller;
    }

    function start({ immediate = false } = {}) {
      if (started) return immediate ? refreshAll({ reason: "start" }) : Promise.resolve([]);
      started = true;
      entries.forEach(schedule);
      return immediate ? refreshAll({ reason: "start" }) : Promise.resolve([]);
    }

    function stop() {
      started = false;
      entries.forEach((entry) => {
        if (entry.timer) clearIntervalFn(entry.timer);
        entry.timer = null;
        entry.forceQueued = false;
      });
    }

    function getHealth(id) {
      const health = entries.get(id)?.health;
      return health ? { ...health } : null;
    }

    function has(id) {
      return entries.has(id);
    }

    const controller = {
      register,
      configure,
      refresh,
      refreshAll,
      start,
      stop,
      getHealth,
      has
    };
    return controller;
  }

  return { createRefreshController, normalizeInterval, normalizeTimeout, DEFAULT_REFRESH_TIMEOUT_MS };
});
