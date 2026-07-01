const fs = require("fs/promises");
const path = require("path");

const SOURCE = "winplate-deepseek-chat";
const SCHEMA_VERSION = 1;
const EMPTY_COUNTERS = Object.freeze({
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cacheHitTokens: 0,
  cacheMissTokens: 0,
  reasoningTokens: 0
});
let writeQueue = Promise.resolve();

function localDateKey(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function emptyCounters() {
  return { ...EMPTY_COUNTERS };
}

function normalizeCounter(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : 0;
}

function normalizeUsageCounters(value = {}) {
  const inputTokens = normalizeCounter(value.inputTokens ?? value.prompt_tokens ?? value.promptTokens);
  const outputTokens = normalizeCounter(value.outputTokens ?? value.completion_tokens ?? value.completionTokens);
  const totalTokens = normalizeCounter(value.totalTokens ?? value.total_tokens) || inputTokens + outputTokens;
  const cacheHitTokens = normalizeCounter(
    value.cacheHitTokens
      ?? value.prompt_cache_hit_tokens
      ?? value.prompt_cache_hitTokens
      ?? value.promptCacheHitTokens
  );
  const cacheMissTokens = normalizeCounter(
    value.cacheMissTokens
      ?? value.prompt_cache_miss_tokens
      ?? value.prompt_cache_missTokens
      ?? value.promptCacheMissTokens
  );
  const reasoningTokens = normalizeCounter(
    value.reasoningTokens
      ?? value.completion_tokens_details?.reasoning_tokens
      ?? value.completionTokensDetails?.reasoningTokens
  );
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cacheHitTokens,
    cacheMissTokens,
    reasoningTokens
  };
}

function hasUsageCounters(counters) {
  return Object.values(counters || {}).some((value) => normalizeCounter(value) > 0);
}

function normalizeStoredUsage(payload = {}, dateKey = localDateKey()) {
  const storedDateKey = typeof payload.dateKey === "string" && payload.dateKey
    ? payload.dateKey
    : dateKey;
  const rawByFeature = payload.byFeature && typeof payload.byFeature === "object"
    ? payload.byFeature
    : {};
  const byFeature = {};
  for (const [feature, value] of Object.entries(rawByFeature)) {
    if (!isSafeFeatureName(feature)) continue;
    byFeature[feature] = {
      today: storedDateKey === dateKey ? normalizeUsageCounters(value?.today) : emptyCounters(),
      total: normalizeUsageCounters(value?.total)
    };
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    source: SOURCE,
    dateKey: storedDateKey,
    today: storedDateKey === dateKey ? normalizeUsageCounters(payload.today) : emptyCounters(),
    total: normalizeUsageCounters(payload.total),
    byFeature,
    updatedAt: Number.isFinite(Number(payload.updatedAt)) ? Number(payload.updatedAt) : null
  };
}

function addCounters(left = {}, right = {}) {
  const normalizedLeft = normalizeUsageCounters(left);
  const normalizedRight = normalizeUsageCounters(right);
  return {
    inputTokens: normalizedLeft.inputTokens + normalizedRight.inputTokens,
    outputTokens: normalizedLeft.outputTokens + normalizedRight.outputTokens,
    totalTokens: normalizedLeft.totalTokens + normalizedRight.totalTokens,
    cacheHitTokens: normalizedLeft.cacheHitTokens + normalizedRight.cacheHitTokens,
    cacheMissTokens: normalizedLeft.cacheMissTokens + normalizedRight.cacheMissTokens,
    reasoningTokens: normalizedLeft.reasoningTokens + normalizedRight.reasoningTokens
  };
}

function isSafeFeatureName(feature) {
  return /^[a-z][a-z0-9_-]{0,40}$/i.test(String(feature || ""));
}

function normalizeFeature(feature) {
  return isSafeFeatureName(feature) ? String(feature) : "unknown";
}

function usageFilePath(userDataPath) {
  return path.join(userDataPath, "deepseek-token-usage.json");
}

async function readDeepSeekTokenUsage(userDataPath, { now = new Date() } = {}) {
  const dateKey = localDateKey(now);
  try {
    const payload = JSON.parse(await fs.readFile(usageFilePath(userDataPath), "utf8"));
    return normalizeStoredUsage(payload, dateKey);
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn("deepseek token usage read failed:", error.message);
    }
    return normalizeStoredUsage({}, dateKey);
  }
}

async function writeDeepSeekTokenUsage(userDataPath, usage) {
  await fs.mkdir(userDataPath, { recursive: true });
  await fs.writeFile(
    usageFilePath(userDataPath),
    `${JSON.stringify(usage, null, 2)}\n`,
    "utf8"
  );
  return usage;
}

async function appendDeepSeekTokenUsage(userDataPath, usage, { now = new Date(), feature = "unknown" } = {}) {
  const counters = normalizeUsageCounters(usage);
  if (!hasUsageCounters(counters)) {
    return readDeepSeekTokenUsage(userDataPath, { now });
  }
  const dateKey = localDateKey(now);
  const current = await readDeepSeekTokenUsage(userDataPath, { now });
  const featureKey = normalizeFeature(feature);
  const currentFeature = current.byFeature?.[featureKey] || { today: emptyCounters(), total: emptyCounters() };
  const updated = {
    schemaVersion: SCHEMA_VERSION,
    source: SOURCE,
    dateKey,
    today: addCounters(current.today, counters),
    total: addCounters(current.total, counters),
    byFeature: {
      ...current.byFeature,
      [featureKey]: {
        today: addCounters(currentFeature.today, counters),
        total: addCounters(currentFeature.total, counters)
      }
    },
    updatedAt: now instanceof Date ? now.getTime() : Number(now)
  };
  return writeDeepSeekTokenUsage(userDataPath, updated);
}

function recordDeepSeekTokenUsage(userDataPath, usage, options = {}) {
  const operation = writeQueue.then(() => appendDeepSeekTokenUsage(userDataPath, usage, options));
  writeQueue = operation.catch(() => {});
  return operation;
}

module.exports = {
  SCHEMA_VERSION,
  SOURCE,
  addCounters,
  emptyCounters,
  hasUsageCounters,
  isSafeFeatureName,
  localDateKey,
  normalizeStoredUsage,
  normalizeUsageCounters,
  normalizeFeature,
  readDeepSeekTokenUsage,
  recordDeepSeekTokenUsage,
  usageFilePath
};
