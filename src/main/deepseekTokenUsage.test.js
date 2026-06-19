const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  localDateKey,
  normalizeUsageCounters,
  readDeepSeekTokenUsage,
  recordDeepSeekTokenUsage,
  usageFilePath
} = require("./deepseekTokenUsage");

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "winplate-deepseek-usage-"));
}

test("normalizes DeepSeek usage field names into local counters", () => {
  assert.deepEqual(normalizeUsageCounters({
    prompt_tokens: 12,
    completion_tokens: 5,
    total_tokens: 17,
    prompt_cache_hit_tokens: 4,
    prompt_cache_miss_tokens: 8,
    completion_tokens_details: {
      reasoning_tokens: 2
    }
  }), {
    inputTokens: 12,
    outputTokens: 5,
    totalTokens: 17,
    cacheHitTokens: 4,
    cacheMissTokens: 8,
    reasoningTokens: 2
  });
});

test("records today's and total DeepSeek token usage", async () => {
  const dir = await tempDir();
  const now = new Date("2026-06-19T12:00:00");
  const usage = await recordDeepSeekTokenUsage(dir, {
    prompt_tokens: 10,
    completion_tokens: 4,
    total_tokens: 14,
    prompt_cache_hit_tokens: 6,
    prompt_cache_miss_tokens: 4,
    completion_tokens_details: {
      reasoning_tokens: 1
    }
  }, { now, feature: "smartBrief" });

  assert.equal(usage.schemaVersion, 1);
  assert.equal(usage.source, "winplate-deepseek-chat");
  assert.equal(usage.dateKey, "2026-06-19");
  assert.deepEqual(usage.today, {
    inputTokens: 10,
    outputTokens: 4,
    totalTokens: 14,
    cacheHitTokens: 6,
    cacheMissTokens: 4,
    reasoningTokens: 1
  });
  assert.deepEqual(usage.total, usage.today);
  assert.deepEqual(usage.byFeature.smartBrief.today, usage.today);
  assert.deepEqual(usage.byFeature.smartBrief.total, usage.total);
  assert.equal(localDateKey(now), "2026-06-19");
});

test("resets today across local dates while preserving total", async () => {
  const dir = await tempDir();
  await recordDeepSeekTokenUsage(dir, {
    prompt_tokens: 10,
    completion_tokens: 4,
    total_tokens: 14
  }, { now: new Date("2026-06-19T12:00:00") });
  const next = await recordDeepSeekTokenUsage(dir, {
    prompt_tokens: 3,
    completion_tokens: 2,
    total_tokens: 5
  }, { now: new Date("2026-06-20T01:00:00") });

  assert.equal(next.dateKey, "2026-06-20");
  assert.deepEqual(next.today, {
    inputTokens: 3,
    outputTokens: 2,
    totalTokens: 5,
    cacheHitTokens: 0,
    cacheMissTokens: 0,
    reasoningTokens: 0
  });
  assert.deepEqual(next.total, {
    inputTokens: 13,
    outputTokens: 6,
    totalTokens: 19,
    cacheHitTokens: 0,
    cacheMissTokens: 0,
    reasoningTokens: 0
  });
});

test("serializes concurrent token usage writes without losing increments", async () => {
  const dir = await tempDir();
  const now = new Date("2026-06-19T12:00:00");

  await Promise.all(Array.from({ length: 8 }, (_, index) => (
    recordDeepSeekTokenUsage(dir, {
      prompt_tokens: 1,
      completion_tokens: 2,
      total_tokens: 3
    }, { now, feature: index % 2 === 0 ? "smartBrief" : "testChat" })
  )));
  const usage = await readDeepSeekTokenUsage(dir, { now });

  assert.equal(usage.today.inputTokens, 8);
  assert.equal(usage.today.outputTokens, 16);
  assert.equal(usage.today.totalTokens, 24);
  assert.equal(usage.byFeature.smartBrief.total.totalTokens, 12);
  assert.equal(usage.byFeature.testChat.total.totalTokens, 12);
});

test("does not write empty usage records", async () => {
  const dir = await tempDir();
  const usage = await recordDeepSeekTokenUsage(dir, {}, { now: new Date("2026-06-19T12:00:00") });

  assert.equal(usage.updatedAt, null);
  await assert.rejects(() => fs.stat(usageFilePath(dir)), { code: "ENOENT" });
});

test("reads corrupted token usage as an empty safe state", async () => {
  const dir = await tempDir();
  await fs.writeFile(usageFilePath(dir), "not json", "utf8");

  const usage = await readDeepSeekTokenUsage(dir, { now: new Date("2026-06-19T12:00:00") });

  assert.equal(usage.source, "winplate-deepseek-chat");
  assert.equal(usage.dateKey, "2026-06-19");
  assert.equal(usage.total.totalTokens, 0);
  assert.deepEqual(usage.byFeature, {});
});
