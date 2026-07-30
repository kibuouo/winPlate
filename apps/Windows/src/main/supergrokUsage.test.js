const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  clearSuperGrokUsageCache,
  formatResetTimestamp,
  parseBillingResponse,
  readSuperGrokUsage,
  readUsageFromGrokLogs
} = require("./supergrokUsage");

test("formatResetTimestamp renders relative weekly remaining time", () => {
  const now = Date.parse("2026-07-27T12:00:00.000Z");
  assert.equal(formatResetTimestamp(now + (2 * 24 + 5) * 60 * 60_000 + 30 * 60_000, now), "2d 5h");
  assert.equal(formatResetTimestamp(now + 3 * 60 * 60_000 + 12 * 60_000, now), "3h 12m");
  assert.equal(formatResetTimestamp(now + 9 * 60_000, now), "9m");
});

test("parseBillingResponse maps SuperGrok weekly credit usage", () => {
  const now = Date.parse("2026-07-27T12:00:00.000Z");
  const usage = parseBillingResponse({
    subscriptionTier: "SuperGrok",
    config: {
      creditUsagePercent: 85,
      currentPeriod: {
        type: "USAGE_PERIOD_TYPE_WEEKLY",
        start: "2026-07-21T04:55:52.954563+00:00",
        end: "2026-07-28T04:55:52.954563+00:00"
      }
    }
  }, now);

  assert.equal(usage.status, "Normal");
  assert.equal(usage.source, "grok-build");
  assert.equal(usage.usedPct, 85);
  assert.equal(usage.remainingPct, 15);
  assert.equal(usage.windowDays, 7);
  assert.equal(usage.subscriptionTier, "SuperGrok");
  assert.equal(usage.resetAt, Date.parse("2026-07-28T04:55:52.954563+00:00"));
  assert.equal(usage.resetText, "16h 56m");
});

test("parseBillingResponse treats Grok's no-history period as zero used", () => {
  const now = Date.parse("2026-07-30T06:30:00.000Z");
  const usage = parseBillingResponse({
    subscriptionTier: "SuperGrok",
    config: {
      historyLen: 0,
      currentPeriod: {
        type: "USAGE_PERIOD_TYPE_WEEKLY",
        start: "2026-07-28T04:55:52.954563+00:00",
        end: "2026-08-04T04:55:52.954563+00:00"
      }
    }
  }, now);

  assert.equal(usage.status, "Normal");
  assert.equal(usage.usedPct, 0);
  assert.equal(usage.remainingPct, 100);
  assert.equal(usage.resetText, "4d 22h");
});

test("parseBillingResponse returns unavailable without percentage", () => {
  const usage = parseBillingResponse({ config: {} });
  assert.equal(usage.status, "Unavailable");
  assert.equal(usage.remainingPct, null);
});

test("parseBillingResponse rejects a completed billing period", () => {
  const usage = parseBillingResponse({
    config: {
      creditUsagePercent: 100,
      currentPeriod: {
        type: "USAGE_PERIOD_TYPE_WEEKLY",
        start: "2026-07-21T04:55:52.954563+00:00",
        end: "2026-07-28T04:55:52.954563+00:00"
      }
    }
  }, Date.parse("2026-07-30T12:00:00.000Z"));

  assert.equal(usage.status, "Unavailable");
  assert.match(usage.raw, /period has ended/);
});

test("readUsageFromGrokLogs parses latest billing config line", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "winplate-supergrok-log-"));
  const logsDir = path.join(directory, "logs");
  fs.mkdirSync(logsDir, { recursive: true });
  const now = Date.parse("2026-07-27T14:00:00.000Z");
  fs.writeFileSync(
    path.join(logsDir, "unified.jsonl"),
    `${JSON.stringify({
      ts: "2026-07-27T13:59:00.000Z",
      msg: "billing: fetched credits config",
      ctx: {
        subscriptionTier: "SuperGrok",
        config: {
          creditUsagePercent: 86,
          currentPeriod: {
            type: "USAGE_PERIOD_TYPE_WEEKLY",
            start: "2026-07-21T04:55:52.954563+00:00",
            end: "2026-07-28T04:55:52.954563+00:00"
          }
        }
      }
    })}\n`,
    "utf8"
  );
  try {
    const usage = readUsageFromGrokLogs(directory, now);
    assert.equal(usage.status, "Normal");
    assert.equal(usage.source, "grok-build-log");
    assert.equal(usage.usedPct, 86);
    assert.equal(usage.remainingPct, 14);
    assert.equal(usage.subscriptionTier, "SuperGrok");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("readSuperGrokUsage falls back to Grok Build logs when network fails", async () => {
  clearSuperGrokUsageCache();
  const now = Date.parse("2026-07-27T14:00:00.000Z");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "winplate-supergrok-"));
  fs.mkdirSync(path.join(directory, "logs"), { recursive: true });
  fs.writeFileSync(
    path.join(directory, "auth.json"),
    JSON.stringify({
      "https://auth.x.ai::test": {
        key: "test-session-token",
        auth_mode: "oidc",
        expires_at: new Date(Date.now() + 60 * 60_000).toISOString()
      }
    }),
    "utf8"
  );
  fs.writeFileSync(
    path.join(directory, "logs", "unified.jsonl"),
    `${JSON.stringify({
      ts: "2026-07-27T13:59:00.000Z",
      msg: "billing: fetched credits config",
      ctx: {
        subscriptionTier: "SuperGrok",
        config: {
          creditUsagePercent: 72,
          currentPeriod: {
            type: "USAGE_PERIOD_TYPE_WEEKLY",
            start: "2026-07-21T00:00:00.000Z",
            end: "2026-07-28T00:00:00.000Z"
          }
        }
      }
    })}\n`,
    "utf8"
  );
  const previousHome = process.env.GROK_HOME;
  process.env.GROK_HOME = directory;
  try {
    const usage = await readSuperGrokUsage({
      force: true,
      now,
      fetchImpl: async () => {
        throw new Error("fetch failed");
      }
    });
    assert.equal(usage.status, "Normal");
    assert.equal(usage.source, "grok-build-log");
    assert.equal(usage.usedPct, 72);
    assert.equal(usage.remainingPct, 28);
  } finally {
    if (previousHome === undefined) delete process.env.GROK_HOME;
    else process.env.GROK_HOME = previousHome;
    clearSuperGrokUsageCache();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("readSuperGrokUsage does not retain a completed period after a refresh failure", async () => {
  clearSuperGrokUsageCache();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "winplate-supergrok-period-"));
  const now = Date.now();
  const resetAt = now + 60_000;
  fs.writeFileSync(
    path.join(directory, "auth.json"),
    JSON.stringify({
      "https://auth.x.ai::test": {
        key: "test-session-token",
        auth_mode: "oidc",
        expires_at: new Date(now + 60 * 60_000).toISOString()
      }
    }),
    "utf8"
  );
  const previousHome = process.env.GROK_HOME;
  process.env.GROK_HOME = directory;
  try {
    const current = await readSuperGrokUsage({
      force: true,
      now,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          config: {
            creditUsagePercent: 100,
            currentPeriod: { start: new Date(now - 6 * 24 * 60 * 60_000).toISOString(), end: new Date(resetAt).toISOString() }
          }
        })
      })
    });
    assert.equal(current.remainingPct, 0);

    const afterReset = await readSuperGrokUsage({
      force: true,
      now: resetAt + 1,
      fetchImpl: async () => {
        throw new Error("fetch failed");
      }
    });
    assert.equal(afterReset.status, "Unavailable");
    assert.notEqual(afterReset.status, "Cached");
  } finally {
    if (previousHome === undefined) delete process.env.GROK_HOME;
    else process.env.GROK_HOME = previousHome;
    clearSuperGrokUsageCache();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("readSuperGrokUsage silently refreshes an expired Grok Build access token", async () => {
  clearSuperGrokUsageCache();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "winplate-supergrok-refresh-"));
  const now = Date.now();
  const scope = "https://auth.x.ai::test";
  const writeAuth = (entry) => fs.writeFileSync(
    path.join(directory, "auth.json"),
    JSON.stringify({ [scope]: entry }),
    "utf8"
  );
  writeAuth({
    key: "expired-access-token",
    refresh_token: "refresh-token",
    auth_mode: "oidc",
    expires_at: new Date(now - 60_000).toISOString()
  });
  const previousHome = process.env.GROK_HOME;
  process.env.GROK_HOME = directory;
  try {
    let refreshes = 0;
    const usage = await readSuperGrokUsage({
      force: true,
      now,
      refreshAuth: async () => {
        refreshes += 1;
        writeAuth({
          key: "refreshed-access-token",
          refresh_token: "rotated-refresh-token",
          auth_mode: "oidc",
          expires_at: new Date(now + 60 * 60_000).toISOString()
        });
      },
      fetchImpl: async (_url, options) => {
        assert.equal(options.headers.Authorization, "Bearer refreshed-access-token");
        return {
          ok: true,
          status: 200,
          json: async () => ({
            config: {
              creditUsagePercent: 0,
              currentPeriod: { start: new Date(now).toISOString(), end: new Date(now + 6 * 24 * 60 * 60_000).toISOString() }
            }
          })
        };
      }
    });
    assert.equal(refreshes, 1);
    assert.equal(usage.status, "Normal");
    assert.equal(usage.remainingPct, 100);
  } finally {
    if (previousHome === undefined) delete process.env.GROK_HOME;
    else process.env.GROK_HOME = previousHome;
    clearSuperGrokUsageCache();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
