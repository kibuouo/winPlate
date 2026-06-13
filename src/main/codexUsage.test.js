const test = require("node:test");
const assert = require("node:assert/strict");
const { parseCodexStatus, parseRateLimitsResponse } = require("./codexUsage");

test("parses remaining percentage and reset text", () => {
  const usage = parseCodexStatus(`
    5h limit
    69% left
    Resets in 2h 14m
    Weekly limit
    42% left
  `);

  assert.equal(usage.remainingPct, 69);
  assert.equal(usage.usedPct, 31);
  assert.equal(usage.resetText, "2h 14m");
  assert.equal(usage.windows.sevenDay.remainingPct, 42);
  assert.equal(usage.status, "Normal");
});

test("converts an explicitly used percentage", () => {
  const usage = parseCodexStatus("Session: 25% used\nReset: 15:23");
  assert.equal(usage.remainingPct, 75);
  assert.equal(usage.usedPct, 25);
  assert.equal(usage.resetText, "15:23");
});

test("parses the current Codex CLI status line", () => {
  const usage = parseCodexStatus(
    "5h limit: [███████████████░░░░░] 75% left (resets 23:36)"
  );
  assert.equal(usage.remainingPct, 75);
  assert.equal(usage.resetText, "23:36");
});

test("does not confuse session metadata with the 5-hour limit", () => {
  const usage = parseCodexStatus(`
    Session: 019eb758-5ea6-7f23-a0a3-d6070790bf5f
    5h limit: [████████████████████] 98% left (resets 04:41 on 12 Jun)
    Weekly limit: [██████████████████░░] 91% left (resets 18:36 on 18 Jun)
  `);

  assert.equal(usage.windows.fiveHour.remainingPct, 98);
  assert.equal(usage.windows.fiveHour.resetText, "04:41");
  assert.equal(usage.resetText, "04:41");
});

test("parses 5-hour and 7-day status lines", () => {
  const usage = parseCodexStatus(`
    5-hour window: 26% left (resets in 1h27m)
    7-day window: 4% left (resets in 6d20h)
  `);

  assert.deepEqual(usage.windows.fiveHour, {
    remainingPct: 26,
    usedPct: 74,
    resetText: "1h27m"
  });
  assert.deepEqual(usage.windows.sevenDay, {
    remainingPct: 4,
    usedPct: 96,
    resetText: "6d20h"
  });
});

test("returns unavailable when status contains no percentage", () => {
  const usage = parseCodexStatus("Not logged in");
  assert.equal(usage.remainingPct, null);
  assert.equal(usage.status, "Unavailable");
});

test("ignores the temporary limits refresh response", () => {
  const usage = parseCodexStatus(
    "Limits: refresh requested; run /status again shortly."
  );
  assert.equal(usage.remainingPct, null);
  assert.equal(usage.status, "Unavailable");
});

test("maps app-server rate limits to the compact usage windows", () => {
  const now = Date.UTC(2026, 5, 13, 4, 0, 0);
  const usage = parseRateLimitsResponse({
    rateLimits: {
      primary: {
        usedPercent: 18,
        resetsAt: Math.floor((now + 2 * 60 * 60 * 1000) / 1000)
      },
      secondary: {
        usedPercent: 36,
        resetsAt: Math.floor((now + 3 * 24 * 60 * 60 * 1000) / 1000)
      }
    }
  }, now);

  assert.equal(usage.remainingPct, 82);
  assert.deepEqual(usage.windows.fiveHour, {
    remainingPct: 82,
    usedPct: 18,
    resetText: "2h",
    resetClock: "14:00"
  });
  assert.deepEqual(usage.windows.sevenDay, {
    remainingPct: 64,
    usedPct: 36,
    resetText: "3d",
    resetClock: "12:00"
  });
  assert.equal(usage.source, "codex-app-server");
});
