const test = require("node:test");
const assert = require("node:assert/strict");
const { aggregateTokenUsage } = require("./agentTokenUsageAggregator");

test("aggregates entries into contiguous hourly and daily buckets", () => {
  const now = Date.parse("2026-08-05T15:30:00");
  const usage = aggregateTokenUsage([
    { date: Date.parse("2026-08-04T23:15:00"), tokens: 250 },
    { date: Date.parse("2026-08-05T15:00:00"), tokens: 80 }
  ], now);

  assert.equal(usage.available, true);
  assert.equal(usage.hourly.length >= 2, true);
  assert.equal(usage.daily.length, 2);
  assert.equal(usage.hourly[0].tokens, 250);
  assert.equal(usage.hourly.at(-1).tokens, 80);
  assert.equal(usage.totalTokens, 330);
});

test("returns unavailable when there are no entries", () => {
  const usage = aggregateTokenUsage([], Date.parse("2026-08-05T15:30:00"));
  assert.equal(usage.available, false);
  assert.deepEqual(usage.hourly, []);
  assert.deepEqual(usage.daily, []);
});
