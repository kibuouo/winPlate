const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  aggregateTokenUsage,
  unavailableTokenUsage
} = require("./agentTokenUsageAggregator");

const HISTORY_HORIZON_DAYS = 30;
const READ_TIMEOUT_MS = 4_000;
const MAX_FILES = 24;
const CACHE_TTL_MS = 60_000;

let cachedUsage = null;
let cachedAt = 0;
let pendingRead = null;

function resolveGrokHome() {
  const fromEnv = String(process.env.GROK_HOME || "").trim();
  if (fromEnv) return fromEnv;
  return path.join(os.homedir(), ".grok");
}

function toInt64(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

/**
 * Parse ACP session/update JSONL lines. Keeps max totalTokens per promptId
 * and prefers in-prompt growth (macOS GrokTokenUsageReader parity).
 */
function parseGrokTokenLines(lines, { cutoff = 0, now = Date.now() } = {}) {
  const byPrompt = new Map();
  for (const line of Array.isArray(lines) ? lines : []) {
    let root;
    try {
      root = JSON.parse(line);
    } catch {
      continue;
    }
    const timestamp = toInt64(root?.timestamp);
    if (timestamp == null || timestamp < cutoff) continue;
    const meta = root?.params?._meta;
    const promptID = typeof meta?.promptId === "string" ? meta.promptId : "";
    const tokens = toInt64(meta?.totalTokens);
    if (!promptID || tokens == null || tokens < 0) continue;

    const dateMs = timestamp < 1e12 ? timestamp * 1000 : timestamp;
    const existing = byPrompt.get(promptID);
    if (existing) {
      existing.minTokens = Math.min(existing.minTokens, tokens);
      if (tokens >= existing.maxTokens) {
        existing.maxTokens = tokens;
        existing.date = dateMs;
      }
    } else {
      byPrompt.set(promptID, {
        minTokens: tokens,
        maxTokens: tokens,
        date: dateMs
      });
    }
  }

  const entries = [...byPrompt.values()].map((sample) => {
    const grown = sample.maxTokens - sample.minTokens;
    return {
      date: sample.date,
      tokens: grown > 0 ? grown : sample.maxTokens
    };
  });
  return aggregateTokenUsage(entries, now);
}

function collectSessionUpdateFiles(root, modifiedAfter) {
  const results = [];
  if (!root || !fs.existsSync(root)) return results;

  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (entry.name !== "updates.jsonl") continue;
      let modified = 0;
      try {
        modified = fs.statSync(full).mtimeMs;
      } catch {
        continue;
      }
      if (modified >= modifiedAfter) {
        results.push({ path: full, modified });
      }
    }
  }
  return results.sort((a, b) => b.modified - a.modified).map((item) => item.path);
}

function readLinesFromFile(filePath, deadline) {
  const lines = [];
  let handle;
  try {
    handle = fs.openSync(filePath, "r");
  } catch {
    return { lines, readable: false };
  }
  try {
    const buffer = Buffer.alloc(64 * 1024);
    let pending = "";
    while (Date.now() < deadline) {
      const bytes = fs.readSync(handle, buffer, 0, buffer.length, null);
      if (bytes <= 0) break;
      pending += buffer.subarray(0, bytes).toString("utf8");
      const parts = pending.split("\n");
      pending = parts.pop() || "";
      for (const part of parts) {
        const line = part.trim();
        if (line) lines.push(line);
      }
    }
    if (pending.trim()) lines.push(pending.trim());
    return { lines, readable: true };
  } finally {
    try { fs.closeSync(handle); } catch {}
  }
}

function readGrokTokenUsageFromDisk(now = Date.now()) {
  const earliestDay = new Date(now);
  earliestDay.setHours(0, 0, 0, 0);
  earliestDay.setDate(earliestDay.getDate() - HISTORY_HORIZON_DAYS);
  const cutoff = Math.floor(earliestDay.getTime() / 1000);
  const sessionsRoot = path.join(resolveGrokHome(), "sessions");
  const files = collectSessionUpdateFiles(sessionsRoot, earliestDay.getTime());
  if (!files.length) return unavailableTokenUsage(now);

  const deadline = Date.now() + READ_TIMEOUT_MS;
  const lines = [];
  let anyReadable = false;
  for (const file of files.slice(0, MAX_FILES)) {
    if (Date.now() >= deadline) break;
    const result = readLinesFromFile(file, deadline);
    if (result.readable) {
      anyReadable = true;
      lines.push(...result.lines);
    }
  }
  if (!anyReadable) return unavailableTokenUsage(now);
  return parseGrokTokenLines(lines, { cutoff, now });
}

async function readGrokTokenUsage({ force = false, now = Date.now() } = {}) {
  if (!force && cachedUsage && now - cachedAt < CACHE_TTL_MS) {
    return cachedUsage;
  }
  if (pendingRead) return pendingRead;

  pendingRead = Promise.resolve()
    .then(() => readGrokTokenUsageFromDisk(now))
    .catch(() => unavailableTokenUsage(now))
    .then((usage) => {
      cachedAt = Date.now();
      cachedUsage = usage;
      return usage;
    })
    .finally(() => {
      pendingRead = null;
    });
  return pendingRead;
}

function clearGrokTokenUsageCache() {
  cachedUsage = null;
  cachedAt = 0;
  pendingRead = null;
}

module.exports = {
  parseGrokTokenLines,
  readGrokTokenUsage,
  clearGrokTokenUsageCache,
  resolveGrokHome
};
