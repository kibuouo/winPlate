const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const {
  aggregateTokenUsage,
  unavailableTokenUsage
} = require("./agentTokenUsageAggregator");

const HISTORY_HORIZON_DAYS = 30;
const QUERY_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 60_000;

let cachedUsage = null;
let cachedAt = 0;
let pendingRead = null;
let DatabaseSync = null;

try {
  ({ DatabaseSync } = require("node:sqlite"));
} catch {
  DatabaseSync = null;
}

function valueAfter(key, body) {
  const index = body.indexOf(key);
  if (index < 0) return null;
  const remainder = body.slice(index + key.length);
  const match = remainder.match(/^[^\s}\t,]+/);
  return match ? match[0] : null;
}

/**
 * Parse tab-separated Codex turn telemetry lines:
 * `<unixTs>\t... turn_id=... total_usage_tokens=...`
 * Keeps the largest token total per turn_id (same as macOS).
 */
function parseCodexTokenLines(lines, now = Date.now()) {
  const latestByTurn = new Map();
  for (const line of Array.isArray(lines) ? lines : []) {
    const text = String(line || "");
    const separator = text.indexOf("\t");
    if (separator < 0) continue;
    const timestamp = Number(text.slice(0, separator));
    if (!Number.isFinite(timestamp)) continue;
    const body = text.slice(separator + 1);
    const turnID = valueAfter("turn_id=", body)
      || valueAfter("turn.id=", body);
    const tokenText = valueAfter("total_usage_tokens=", body)
      || valueAfter("total_tokens=", body);
    const tokens = Number(tokenText);
    if (!turnID || !Number.isFinite(tokens) || tokens < 0) continue;

    const existing = latestByTurn.get(turnID);
    if (existing && existing.tokens > tokens) continue;
    latestByTurn.set(turnID, {
      date: timestamp < 1e12 ? timestamp * 1000 : timestamp,
      tokens: Math.trunc(tokens)
    });
  }

  return aggregateTokenUsage([...latestByTurn.values()], now);
}

function resolveCodexHome() {
  const fromEnv = String(process.env.CODEX_HOME || "").trim();
  if (fromEnv) return fromEnv;
  return path.join(os.homedir(), ".codex");
}

function databasePaths(home = resolveCodexHome()) {
  if (!home || !fs.existsSync(home)) return [];
  let files = [];
  try {
    files = fs.readdirSync(home);
  } catch {
    return [];
  }
  return files
    .filter((name) => /^logs(?:_\d+)?\.sqlite$/i.test(name))
    .sort()
    .map((name) => path.join(home, name));
}

function queryDatabaseWithNodeSqlite(database, cutoffSeconds) {
  if (!DatabaseSync) return null;
  try {
    const db = new DatabaseSync(database, { readOnly: true });
    try {
      const rows = db.prepare(`
        SELECT ts, feedback_log_body AS body
        FROM logs
        WHERE target = 'codex_core::session::turn'
          AND feedback_log_body LIKE '%post sampling token usage%'
          AND ts >= ?
        ORDER BY ts ASC
      `).all(cutoffSeconds);
      return rows.map((row) => `${row.ts}\t${row.body || ""}`);
    } finally {
      try { db.close(); } catch {}
    }
  } catch {
    return null;
  }
}

function resolveSqlite3() {
  const candidates = process.platform === "win32"
    ? [
      process.env.SQLITE3_PATH,
      path.join(process.env.LOCALAPPDATA || "", "Programs", "sqlite", "sqlite3.exe"),
      "sqlite3.exe",
      "sqlite3"
    ]
    : [
      process.env.SQLITE3_PATH,
      "/usr/bin/sqlite3",
      "/opt/homebrew/bin/sqlite3",
      "/usr/local/bin/sqlite3",
      "sqlite3"
    ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (candidate.includes(path.sep) || candidate.includes("/")) {
      if (fs.existsSync(candidate)) return { command: candidate, shell: false };
    } else {
      return { command: candidate, shell: process.platform === "win32" };
    }
  }
  return null;
}

function queryDatabaseWithCli(database, cutoffSeconds) {
  const sqlite = resolveSqlite3();
  if (!sqlite) return null;
  const sql = [
    "SELECT ts || char(9) || feedback_log_body FROM logs",
    "WHERE target = 'codex_core::session::turn'",
    "AND feedback_log_body LIKE '%post sampling token usage%'",
    `AND ts >= ${cutoffSeconds}`,
    "ORDER BY ts ASC;"
  ].join(" ");

  return new Promise((resolve) => {
    const proc = spawn(sqlite.command, ["-readonly", "-separator", "\t", database, sql], {
      windowsHide: true,
      shell: sqlite.shell,
      stdio: ["ignore", "pipe", "ignore"]
    });
    let stdout = "";
    let finished = false;
    const finish = (lines) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { proc.kill(); } catch {}
      resolve(lines);
    };
    const timer = setTimeout(() => finish(null), QUERY_TIMEOUT_MS);
    proc.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    proc.on("error", () => finish(null));
    proc.on("exit", (code) => {
      if (code !== 0) {
        finish(null);
        return;
      }
      finish(stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
    });
  });
}

async function queryDatabase(database, cutoffSeconds) {
  const viaNode = queryDatabaseWithNodeSqlite(database, cutoffSeconds);
  if (viaNode) return viaNode;
  return queryDatabaseWithCli(database, cutoffSeconds);
}

async function readCodexTokenUsageFromDisk(now = Date.now()) {
  const databases = databasePaths();
  if (!databases.length) return unavailableTokenUsage(now);

  const earliestDay = new Date(now);
  earliestDay.setHours(0, 0, 0, 0);
  earliestDay.setDate(earliestDay.getDate() - HISTORY_HORIZON_DAYS);
  const cutoffSeconds = Math.floor(earliestDay.getTime() / 1000);

  const lines = [];
  let querySucceeded = false;
  for (const database of databases) {
    const result = await queryDatabase(database, cutoffSeconds);
    if (result) {
      querySucceeded = true;
      lines.push(...result);
    }
  }
  if (!querySucceeded) return unavailableTokenUsage(now);
  return parseCodexTokenLines(lines, now);
}

async function readCodexTokenUsage({ force = false, now = Date.now() } = {}) {
  if (!force && cachedUsage && now - cachedAt < CACHE_TTL_MS) {
    return cachedUsage;
  }
  if (pendingRead) return pendingRead;

  pendingRead = readCodexTokenUsageFromDisk(now)
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

function clearCodexTokenUsageCache() {
  cachedUsage = null;
  cachedAt = 0;
  pendingRead = null;
}

module.exports = {
  parseCodexTokenLines,
  readCodexTokenUsage,
  clearCodexTokenUsageCache,
  databasePaths
};
