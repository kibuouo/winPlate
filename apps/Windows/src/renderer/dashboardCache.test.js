const assert = require("node:assert/strict");
const test = require("node:test");
const {
  CACHE_KEY,
  CACHE_VERSION,
  read,
  write
} = require("./dashboardCache");

function createStorage(initial = null) {
  let value = initial;
  return {
    getItem(key) {
      return key === CACHE_KEY ? value : null;
    },
    setItem(key, next) {
      if (key === CACHE_KEY) value = next;
    },
    removeItem(key) {
      if (key === CACHE_KEY) value = null;
    }
  };
}

test("dashboard cache round-trips the current data snapshot with a version and timestamp", () => {
  const storage = createStorage();
  const data = { statusData: { github: { name: "current" } }, qweatherUsage: { used: 12 } };

  assert.equal(write(data, { storage, now: 1234 }), true);
  assert.deepEqual(read(storage), {
    version: CACHE_VERSION,
    updatedAt: 1234,
    data
  });
});

test("dashboard cache ignores malformed or incompatible snapshots", () => {
  const malformed = createStorage("not-json");
  assert.equal(read(malformed), null);

  const incompatible = createStorage(JSON.stringify({
    version: CACHE_VERSION + 1,
    updatedAt: 1234,
    data: { statusData: {} }
  }));
  assert.equal(read(incompatible), null);
});

test("dashboard cache tolerates unavailable storage without affecting the renderer", () => {
  const unavailable = {
    getItem() { throw new Error("storage unavailable"); },
    setItem() { throw new Error("storage unavailable"); }
  };

  assert.equal(read(unavailable), null);
  assert.equal(write({ statusData: {} }, { storage: unavailable, now: 1234 }), false);
});
