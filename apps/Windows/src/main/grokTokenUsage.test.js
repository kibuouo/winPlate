const test = require("node:test");
const assert = require("node:assert/strict");
const { parseGrokTokenLines } = require("./grokTokenUsage");

function updateLine(iso, prompt, tokens) {
  const ts = Math.floor(Date.parse(iso) / 1000);
  return JSON.stringify({
    timestamp: ts,
    method: "session/update",
    params: {
      sessionId: "s",
      update: { sessionUpdate: "agent_message_chunk" },
      _meta: { totalTokens: tokens, promptId: prompt }
    }
  });
}

test("aggregates prompt growth into hourly and daily buckets", () => {
  const now = Date.parse("2026-08-05T15:30:00");
  const usage = parseGrokTokenLines([
    updateLine("2026-08-04T23:15:00", "p1", 1000),
    updateLine("2026-08-04T23:16:00", "p1", 2500),
    updateLine("2026-08-05T15:00:00", "p2", 80),
    updateLine("2026-08-05T15:05:00", "p2", 80),
    "{\"not\":\"a session update\"}"
  ], { now });

  assert.equal(usage.available, true);
  assert.equal(usage.hourly.length >= 2, true);
  assert.equal(usage.daily.length, 2);
  // p1 growth 1500; p2 single/no-growth falls back to peak 80
  assert.equal(usage.hourly[0].tokens, 1500);
  assert.equal(usage.hourly.at(-1).tokens, 80);
  assert.equal(usage.totalTokens, 1580);
});

test("keeps max growth per prompt and ignores samples before cutoff", () => {
  const now = Date.parse("2026-08-05T12:00:00");
  const cutoff = Math.floor(Date.parse("2026-08-05T00:00:00") / 1000);
  const usage = parseGrokTokenLines([
    updateLine("2026-08-04T10:00:00", "old", 9999),
    updateLine("2026-08-05T10:00:00", "p", 200),
    updateLine("2026-08-05T10:30:00", "p", 500),
    updateLine("2026-08-05T10:20:00", "p", 300)
  ], { cutoff, now });

  assert.equal(usage.available, true);
  assert.equal(usage.totalTokens, 300); // 500 - 200
  assert.equal(usage.hourly[0].tokens, 300);
});

test("returns unavailable when no prompts were recorded", () => {
  const usage = parseGrokTokenLines([], { now: Date.parse("2026-08-05T15:30:00") });
  assert.equal(usage.available, false);
  assert.deepEqual(usage.hourly, []);
});
