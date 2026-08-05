const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const https = require("node:https");
const { spawn } = require("node:child_process");

const READ_TIMEOUT_MS = 5_000;
const SUCCESS_CACHE_TTL_MS = 5 * 60_000;
const FAILURE_CACHE_TTL_MS = 60_000;
const LOG_FALLBACK_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
const DEFAULT_BILLING_URL = "https://cli-chat-proxy.grok.com/v1/billing?format=credits";

let cachedUsage = null;
let cachedAt = 0;
let lastSuccessfulUsage = null;
let pendingRead = null;

function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function formatResetTimestamp(resetAtMs, now = Date.now()) {
  if (!Number.isFinite(resetAtMs)) return undefined;
  const remainingMinutes = Math.max(0, Math.ceil((resetAtMs - now) / 60_000));
  const days = Math.floor(remainingMinutes / 1440);
  const hours = Math.floor((remainingMinutes % 1440) / 60);
  const minutes = remainingMinutes % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

function formatResetClock(resetAtMs) {
  if (!Number.isFinite(resetAtMs)) return undefined;
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(resetAtMs));
}

function resolveGrokHome() {
  const fromEnv = String(process.env.GROK_HOME || "").trim();
  if (fromEnv) return fromEnv;
  // Grok Build stores config/auth/logs under ~/.grok
  return path.join(os.homedir(), ".grok");
}

function resolveGrokBuildBinaryCandidates(home = resolveGrokHome()) {
  const binDir = path.join(home, "bin");
  const candidates = [];
  if (process.platform === "win32") {
    candidates.push(
      path.join(binDir, "grok.exe"),
      path.join(binDir, "agent.exe")
    );
    const localAppData = String(process.env.LOCALAPPDATA || "").trim();
    if (localAppData) {
      candidates.push(
        path.join(localAppData, "Programs", "Grok Build", "grok.exe"),
        path.join(localAppData, "Programs", "Grok", "grok.exe")
      );
    }
  } else {
    candidates.push(
      path.join(binDir, "grok"),
      path.join(binDir, "agent"),
      "/usr/local/bin/grok",
      path.join(os.homedir(), ".local", "bin", "grok")
    );
  }
  return candidates;
}

function resolveGrokLaunch() {
  const home = resolveGrokHome();
  for (const candidate of resolveGrokBuildBinaryCandidates(home)) {
    if (candidate && fs.existsSync(candidate)) {
      return { command: candidate, args: [], shell: false, home, product: "Grok Build" };
    }
  }
  return {
    command: process.platform === "win32" ? "grok.cmd" : "grok",
    args: [],
    shell: process.platform === "win32",
    home,
    product: "Grok Build"
  };
}

function unavailableUsage(message, extra = {}) {
  return {
    source: "grok-build",
    remainingPct: null,
    usedPct: null,
    resetText: undefined,
    resetClock: undefined,
    resetAt: null,
    windowDays: 7,
    subscriptionTier: null,
    updatedAt: Date.now(),
    status: "Unavailable",
    raw: message,
    ...extra
  };
}

function parseExpiryMs(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && String(value).trim() !== "") {
    return asNumber < 1e12 ? asNumber * 1000 : asNumber;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function readGrokAuth(home = resolveGrokHome()) {
  const authPath = path.join(home, "auth.json");
  if (!fs.existsSync(authPath)) {
    return { error: "Grok Build not logged in; run `grok login`" };
  }
  try {
    const payload = JSON.parse(fs.readFileSync(authPath, "utf8"));
    if (!payload || typeof payload !== "object") {
      return { error: "Grok Build auth.json is invalid; run `grok login`" };
    }
    const entries = Object.values(payload)
      .filter((entry) => entry && typeof entry === "object" && typeof entry.key === "string" && entry.key.trim())
      .map((entry) => ({ entry, expiresMs: parseExpiryMs(entry.expires_at) }))
      .sort((left, right) => (right.expiresMs || 0) - (left.expiresMs || 0));
    const selected = entries[0];
    if (!selected) return { error: "Grok Build session missing; run `grok login`" };
    if (selected.expiresMs != null && selected.expiresMs <= Date.now()) {
      return {
        error: "Grok Build login expired; run `grok login`",
        refreshable: Boolean(selected.entry.refresh_token)
      };
    }
    return {
      token: selected.entry.key.trim(),
      subscriptionTier: selected.entry.subscription_tier || selected.entry.subscriptionTier || null,
      email: selected.entry.email || null
    };
  } catch (error) {
    return { error: error.message || "Failed to read Grok Build auth" };
  }
}

function resolveBillingUrl() {
  const base = String(process.env.GROK_CLI_CHAT_PROXY_BASE_URL || "https://cli-chat-proxy.grok.com/v1")
    .trim()
    .replace(/\/+$/, "");
  if (!base) return DEFAULT_BILLING_URL;
  return `${base}/billing?format=credits`;
}

function parseBillingConfig(config, {
  now = Date.now(),
  source = "grok-build",
  subscriptionTier = null,
  updatedAt = now
} = {}) {
  if (!config || typeof config !== "object") {
    return unavailableUsage("Failed to parse Grok Build billing response");
  }

  // Grok Build omits creditUsagePercent for a fresh period with no history.
  // Its TUI renders that shape as "Weekly limit: 0%", i.e. 0% used.
  const usedPct = config.creditUsagePercent == null && Number(config.historyLen) === 0
    ? 0
    : clampPercent(config.creditUsagePercent);
  if (usedPct === null) {
    return unavailableUsage("Grok Build weekly usage percentage unavailable");
  }
  const remainingPct = 100 - usedPct;
  const periodEnd = config.currentPeriod?.end || config.billingPeriodEnd || null;
  const resetAt = periodEnd ? Date.parse(periodEnd) : NaN;
  if (Number.isFinite(resetAt) && resetAt <= now) {
    return unavailableUsage("Grok Build billing period has ended; refresh Grok Build or run `grok login`");
  }
  const periodStart = config.currentPeriod?.start || config.billingPeriodStart || null;
  let windowDays = 7;
  if (periodStart && Number.isFinite(resetAt)) {
    const startMs = Date.parse(periodStart);
    if (Number.isFinite(startMs) && resetAt > startMs) {
      windowDays = Math.max(1, Math.round((resetAt - startMs) / (24 * 60 * 60_000)));
    }
  }

  return {
    source,
    remainingPct,
    usedPct,
    resetText: Number.isFinite(resetAt) ? formatResetTimestamp(resetAt, now) : undefined,
    resetClock: Number.isFinite(resetAt) ? formatResetClock(resetAt) : undefined,
    resetAt: Number.isFinite(resetAt) ? resetAt : null,
    windowDays,
    periodType: String(config.currentPeriod?.type || ""),
    subscriptionTier: subscriptionTier || config.subscriptionTier || null,
    updatedAt,
    status: "Normal",
    raw: ""
  };
}

function hasActiveUsagePeriod(usage, now = Date.now()) {
  return !Number.isFinite(usage?.resetAt) || usage.resetAt > now;
}

function refreshGrokAuth(launch, { spawnImpl = spawn, timeoutMs = READ_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const proc = spawnImpl(launch.command, [...launch.args, "models"], {
      shell: launch.shell,
      windowsHide: true,
      stdio: "ignore"
    });
    const timer = setTimeout(() => {
      proc.kill();
      finish();
    }, timeoutMs);
    proc.on("error", finish);
    proc.on("exit", finish);
  });
}

function parseBillingResponse(payload, now = Date.now()) {
  const config = payload?.config && typeof payload.config === "object"
    ? payload.config
    : payload && typeof payload === "object"
      ? payload
      : null;
  return parseBillingConfig(config, {
    now,
    source: "grok-build",
    subscriptionTier: payload?.subscriptionTier || null,
    updatedAt: now
  });
}

function readTailText(filePath, maxBytes = 512 * 1024) {
  const stat = fs.statSync(filePath);
  const size = stat.size;
  const start = Math.max(0, size - maxBytes);
  const length = size - start;
  if (length <= 0) return "";
  const fd = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, start);
    return buffer.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

function readUsageFromGrokLogs(home = resolveGrokHome(), now = Date.now()) {
  const logPath = path.join(home, "logs", "unified.jsonl");
  if (!fs.existsSync(logPath)) return null;
  let text = "";
  try {
    text = readTailText(logPath);
  } catch {
    return null;
  }
  const lines = text.split(/\r?\n/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line.includes("billing: fetched credits config")) continue;
    try {
      const entry = JSON.parse(line);
      const config = entry?.ctx?.config;
      if (!config || typeof config !== "object") continue;
      const logAt = entry.ts ? Date.parse(entry.ts) : NaN;
      if (Number.isFinite(logAt) && now - logAt > LOG_FALLBACK_MAX_AGE_MS) {
        return unavailableUsage("Grok Build billing log is stale; open Grok Build once to refresh");
      }
      return parseBillingConfig(config, {
        now,
        source: "grok-build-log",
        subscriptionTier: entry?.ctx?.subscriptionTier || null,
        updatedAt: Number.isFinite(logAt) ? logAt : now
      });
    } catch {
      // continue scanning older matching lines
    }
  }
  return null;
}

function httpsGetJson(url, headers, { family = 4, timeoutMs = READ_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const request = https.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || 443,
      path: `${target.pathname}${target.search}`,
      method: "GET",
      family,
      servername: target.hostname,
      headers,
      timeout: timeoutMs
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        resolve({
          ok: response.statusCode >= 200 && response.statusCode < 300,
          status: response.statusCode || 0,
          text: body,
          json: async () => JSON.parse(body)
        });
      });
    });
    request.on("timeout", () => {
      request.destroy(new Error(`Timed out after ${timeoutMs}ms`));
    });
    request.on("error", reject);
    request.end();
  });
}

function curlGetJson(url, headers, timeoutMs = READ_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const args = [
      "-sS",
      "-L",
      "--max-time",
      String(Math.ceil(timeoutMs / 1000)),
      "-w",
      "\n__WINPLATE_HTTP_STATUS__:%{http_code}",
      "-H",
      `Authorization: ${headers.Authorization}`,
      "-H",
      "Accept: application/json",
      "-H",
      `User-Agent: ${headers["User-Agent"] || "winplate/0.2.0"}`,
      url
    ];
    const command = process.platform === "win32" ? "curl.exe" : "curl";
    const proc = spawn(command, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let finished = false;
    const finish = (error, value) => {
      if (finished) return;
      finished = true;
      if (error) reject(error);
      else resolve(value);
    };
    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    proc.on("error", (error) => finish(error));
    proc.on("exit", (code) => {
      const marker = "\n__WINPLATE_HTTP_STATUS__:";
      const splitAt = stdout.lastIndexOf(marker);
      if (splitAt < 0) {
        finish(new Error(stderr.trim() || `curl exited with code ${code}`));
        return;
      }
      const body = stdout.slice(0, splitAt);
      const status = Number(stdout.slice(splitAt + marker.length).trim()) || 0;
      finish(null, {
        ok: status >= 200 && status < 300,
        status,
        text: body,
        json: async () => JSON.parse(body)
      });
    });
  });
}

function resolveElectronFetch() {
  try {
    // Prefer Electron's network stack when running inside the app.
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    const electron = require("electron");
    if (electron?.net?.fetch) return electron.net.fetch.bind(electron.net);
  } catch {
    // unit tests / plain node
  }
  return null;
}

async function fetchBillingJson(token, { fetchImpl = null, now = Date.now() } = {}) {
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "winplate/0.2.0"
  };
  const url = resolveBillingUrl();
  const errors = [];

  const tryParse = async (response) => {
    if (response.status === 401 || response.status === 403) {
      return unavailableUsage("Grok Build auth rejected; run `grok login`");
    }
    if (!response.ok) {
      return unavailableUsage(`Grok Build billing failed: HTTP ${response.status}`);
    }
    const payload = typeof response.json === "function"
      ? await response.json()
      : JSON.parse(response.text || "{}");
    return parseBillingResponse(payload, now);
  };

  // Injected fetch is exclusive (unit tests); do not fall through to live network.
  if (fetchImpl) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);
      try {
        const response = await fetchImpl(url, { headers, signal: controller.signal });
        return await tryParse(response);
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      return unavailableUsage(error?.message || String(error));
    }
  }

  // 1) Electron net / undici fetch
  const primaryFetch = resolveElectronFetch() || (typeof fetch === "function" ? fetch : null);
  if (primaryFetch) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);
      try {
        const response = await primaryFetch(url, { headers, signal: controller.signal });
        const parsed = await tryParse(response);
        if (parsed.status === "Normal") return parsed;
        errors.push(parsed.raw || `HTTP ${response.status}`);
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      errors.push(error?.message || String(error));
    }
  }

  // 2) Native HTTPS with IPv4 preference (avoids broken IPv6 routes)
  try {
    const response = await httpsGetJson(url, headers, { family: 4 });
    const parsed = await tryParse(response);
    if (parsed.status === "Normal") return parsed;
    errors.push(parsed.raw || `https/ipv4 HTTP ${response.status}`);
  } catch (error) {
    errors.push(`https/ipv4: ${error?.message || error}`);
  }

  // 3) curl fallback (often works when Node network stack is restricted)
  try {
    const response = await curlGetJson(url, headers);
    const parsed = await tryParse(response);
    if (parsed.status === "Normal") return parsed;
    errors.push(parsed.raw || `curl HTTP ${response.status}`);
  } catch (error) {
    errors.push(`curl: ${error?.message || error}`);
  }

  return unavailableUsage(errors.filter(Boolean).join(" | ") || "Failed to read Grok Build billing");
}

async function spawnGrokUsage({ fetchImpl = null, now = Date.now(), refreshAuth = refreshGrokAuth } = {}) {
  const launch = resolveGrokLaunch();
  let auth = readGrokAuth(launch.home);
  if (auth.error && auth.refreshable) {
    await refreshAuth(launch);
    auth = readGrokAuth(launch.home);
  }

  // Network-first when logged in.
  if (!auth.error) {
    const live = await fetchBillingJson(auth.token, { fetchImpl, now });
    if (live.status === "Normal") {
      if (auth.subscriptionTier && !live.subscriptionTier) {
        live.subscriptionTier = auth.subscriptionTier;
      }
      return live;
    }

    // Fall back to Grok Build local billing logs when network is blocked.
    const fromLog = readUsageFromGrokLogs(launch.home, now);
    if (fromLog?.status === "Normal") {
      return {
        ...fromLog,
        raw: live.raw ? `network: ${live.raw}` : fromLog.raw
      };
    }
    return live;
  }

  // Not logged in: still try local log so dashboard can show recent quota.
  const fromLog = readUsageFromGrokLogs(launch.home, now);
  if (fromLog?.status === "Normal") return fromLog;
  return unavailableUsage(auth.error);
}

async function readSuperGrokUsage(options = {}) {
  const { force = false, now = Date.now(), fetchImpl = null, refreshAuth = refreshGrokAuth } = options;
  const cacheTtl = cachedUsage?.status === "Normal" || cachedUsage?.status === "Cached"
    ? SUCCESS_CACHE_TTL_MS
    : FAILURE_CACHE_TTL_MS;
  if (!force && cachedUsage && hasActiveUsagePeriod(cachedUsage, now) && now - cachedAt < cacheTtl) {
    if ((cachedUsage.status === "Normal" || cachedUsage.status === "Cached") && cachedUsage.resetAt) {
      return {
        ...cachedUsage,
        resetText: formatResetTimestamp(cachedUsage.resetAt, now),
        resetClock: formatResetClock(cachedUsage.resetAt)
      };
    }
    return cachedUsage;
  }
  if (pendingRead) return pendingRead;

  pendingRead = spawnGrokUsage({ fetchImpl, now, refreshAuth })
    .catch((error) => unavailableUsage(error.message || "Grok Build usage failed"))
    .then((usage) => {
      cachedAt = Date.now();
      if (usage.status === "Normal") {
        lastSuccessfulUsage = usage;
        cachedUsage = usage;
        return usage;
      }
      if (lastSuccessfulUsage && hasActiveUsagePeriod(lastSuccessfulUsage, now)) {
        cachedUsage = {
          ...lastSuccessfulUsage,
          source: `${lastSuccessfulUsage.source}-cache`,
          status: "Cached",
          raw: usage.raw,
          resetText: formatResetTimestamp(lastSuccessfulUsage.resetAt, now),
          resetClock: formatResetClock(lastSuccessfulUsage.resetAt)
        };
        return cachedUsage;
      }
      cachedUsage = usage;
      return usage;
    })
    .finally(() => {
      pendingRead = null;
    });
  return pendingRead;
}

function clearSuperGrokUsageCache() {
  cachedUsage = null;
  cachedAt = 0;
  lastSuccessfulUsage = null;
  pendingRead = null;
}

module.exports = {
  DEFAULT_BILLING_URL,
  clearSuperGrokUsageCache,
  formatResetClock,
  formatResetTimestamp,
  parseBillingResponse,
  readGrokAuth,
  readSuperGrokUsage,
  readUsageFromGrokLogs,
  resolveGrokBuildBinaryCandidates,
  resolveGrokHome,
  resolveGrokLaunch,
  unavailableUsage
};
