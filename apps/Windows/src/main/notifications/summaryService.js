const { createLocalDigest, digestHash } = require("./digestEngine");

function createNotificationSummaryService({
  store,
  onUpdated = () => {},
  debounceMs = 1_500,
  now = () => Date.now()
}) {
  if (!store?.collect) throw new TypeError("notification store is required");
  let current = null;
  let currentHash = "";
  let pending = null;
  let timer = null;
  let scheduledResolvers = [];

  async function refreshNow({ force = false } = {}) {
    if (pending) return pending;
    pending = (async () => {
      const snapshot = await store.collect();
      const hash = digestHash(snapshot.items);
      if (!force && current && currentHash === hash) return current;
      const generatedAt = now();
      currentHash = hash;
      current = {
        ...createLocalDigest(snapshot.items, generatedAt),
        generatedAt,
        source: "local"
      };
      onUpdated(current);
      return current;
    })().finally(() => {
      pending = null;
    });
    return pending;
  }

  function scheduleRefresh() {
    clearTimeout(timer);
    return new Promise((resolve, reject) => {
      scheduledResolvers.push({ resolve, reject });
      timer = setTimeout(async () => {
        const resolvers = scheduledResolvers;
        scheduledResolvers = [];
        timer = null;
        try {
          if (pending) await pending;
          const digest = await refreshNow();
          resolvers.forEach(({ resolve: done }) => done(digest));
        } catch (error) {
          resolvers.forEach(({ reject: fail }) => fail(error));
        }
      }, Math.max(0, debounceMs));
    });
  }

  return {
    getDigest: () => current ? Promise.resolve(current) : refreshNow(),
    refreshNow,
    scheduleRefresh
  };
}

module.exports = { createNotificationSummaryService };
