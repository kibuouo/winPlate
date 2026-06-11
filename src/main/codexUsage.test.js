const test = require("node:test");
const assert = require("node:assert/strict");
const { parseCodexStatus } = require("./codexUsage");

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

test("returns unavailable when status contains no percentage", () => {
  const usage = parseCodexStatus("Not logged in");
  assert.equal(usage.remainingPct, null);
  assert.equal(usage.status, "Unavailable");
});
