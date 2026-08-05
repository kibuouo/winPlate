const test = require("node:test");
const assert = require("node:assert/strict");
const { parseCodexTokenLines } = require("./codexTokenUsage");

function logLine(iso, turn, tokens) {
  const ts = Math.floor(Date.parse(iso) / 1000);
  return `${ts}\tsession turn_id=${turn} total_usage_tokens=${tokens}`;
}

test("aggregates final turn totals into hourly and daily buckets", () => {
  const now = Date.parse("2026-08-05T15:30:00");
  const usage = parseCodexTokenLines([
    logLine("2026-08-04T23:15:00", "turn-b", 180),
    logLine("2026-08-04T23:16:00", "turn-b", 250),
    logLine("2026-08-05T15:00:00", "turn-c", 80),
    "not-a-log-line"
  ], now);

  assert.equal(usage.available, true);
  assert.equal(usage.hourly.length >= 2, true);
  assert.equal(usage.daily.length, 2);
  assert.equal(usage.hourly[0].tokens, 250);
  assert.equal(usage.hourly.at(-1).tokens, 80);
  assert.equal(usage.daily[0].tokens, 250);
  assert.equal(usage.daily.at(-1).tokens, 80);
  assert.equal(usage.totalTokens, 330);
});

test("returns unavailable when no turns were recorded", () => {
  const usage = parseCodexTokenLines([], Date.parse("2026-08-05T15:30:00"));
  assert.equal(usage.available, false);
  assert.deepEqual(usage.hourly, []);
  assert.deepEqual(usage.daily, []);
});
