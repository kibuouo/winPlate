const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const stripAnsi = require("strip-ansi");

const READ_TIMEOUT_MS = 15_000;
const SUCCESS_CACHE_TTL_MS = 15 * 60_000;
const FAILURE_CACHE_TTL_MS = 5 * 60_000;

let cachedUsage = null;
let cachedAt = 0;
let lastSuccessfulUsage = null;
let pendingRead = null;

function clampPercent(value) {
  return Math.max(0, Math.min(100, Number(value)));
}

function formatResetText(value) {
  const resetText = value?.trim().replace(/\)+$/, "");
  const clockTime = resetText?.match(/^(\d{1,2}:\d{2})\b/);
  return clockTime?.[1] || resetText;
}

function parseWindow(lines, labelPattern, fallbackLine) {
  const labelIndex = lines.findIndex((line, index) => {
    if (!labelPattern.test(line)) return false;
    return lines.slice(index, index + 4).some((candidate) => /(\d{1,3})\s*%/i.test(candidate));
  });
  const candidates = labelIndex >= 0 ? lines.slice(labelIndex, labelIndex + 4) : [];
  const joined = candidates.join(" ");
  const percentSource = candidates.find((line) => /(\d{1,3})\s*%/i.test(line)) || fallbackLine || "";
  const percentMatch = percentSource.match(/(\d{1,3})\s*%\s*(left|remaining|used)?/i);
  if (!percentMatch) return null;

  const value = clampPercent(percentMatch[1]);
  const used = /used/i.test(percentMatch[2] || "") || /\bused\b/i.test(percentSource);
  const remainingPct = used ? 100 - value : value;
  const resetSource = candidates.find((line) => /resets?|reset\s*[:：]/i.test(line)) || joined;
  const resetMatch =
    resetSource.match(/resets?\s+(?:in|at)\s+([^)]+)/i) ||
    resetSource.match(/resets?\s+([^)]+)/i) ||
    resetSource.match(/reset\s*[:：]\s*(.+)$/i);

  return {
    remainingPct,
    usedPct: 100 - remainingPct,
    resetText: formatResetText(resetMatch?.[1])
  };
}

function parseCodexStatus(text) {
  const plain = stripAnsi(text)
    .replace(/\r/g, "")
    .replace(/[\u2500-\u257f]/g, " ");
  const lines = plain.split("\n").map((line) => line.trim()).filter(Boolean);
  const percentLines = lines.filter((line) => /(\d{1,3})\s*%/i.test(line));
  const fiveHour = parseWindow(
    lines,
    /(?:5\s*[- ]?h(?:our)?|session|primary)/i,
    percentLines[0]
  );
  const sevenDay = parseWindow(
    lines,
    /(?:7\s*[- ]?day|weekly)/i,
    percentLines[1]
  );
  const remainingPct = fiveHour?.remainingPct ?? null;

  return {
    source: "codex-cli-status",
    remainingPct,
    usedPct: remainingPct == null ? null : 100 - remainingPct,
    resetText: fiveHour?.resetText,
    windows: {
      fiveHour,
      sevenDay
    },
    updatedAt: Date.now(),
    status: remainingPct == null ? "Unavailable" : "Normal",
    raw: plain.trim()
  };
}

function formatResetTimestamp(value, now = Date.now()) {
  if (!Number.isFinite(value)) return undefined;
  const remainingMinutes = Math.max(0, Math.ceil((value * 1000 - now) / 60_000));
  const days = Math.floor(remainingMinutes / 1440);
  const hours = Math.floor((remainingMinutes % 1440) / 60);
  const minutes = remainingMinutes % 60;

  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

function formatResetClock(value) {
  if (!Number.isFinite(value)) return undefined;
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value * 1000));
}

function normalizeRateLimitWindow(window, now = Date.now()) {
  if (!window || !Number.isFinite(window.usedPercent)) return null;
  const usedPct = clampPercent(window.usedPercent);
  return {
    remainingPct: 100 - usedPct,
    usedPct,
    resetText: formatResetTimestamp(window.resetsAt, now),
    resetClock: formatResetClock(window.resetsAt)
  };
}

function parseRateLimitsResponse(result, now = Date.now()) {
  const rateLimits = result?.rateLimitsByLimitId?.codex || result?.rateLimits;
  const fiveHour = normalizeRateLimitWindow(rateLimits?.primary, now);
  const sevenDay = normalizeRateLimitWindow(rateLimits?.secondary, now);
  const remainingPct = fiveHour?.remainingPct ?? null;

  return {
    source: "codex-app-server",
    remainingPct,
    usedPct: fiveHour?.usedPct ?? null,
    resetText: fiveHour?.resetText,
    resetClock: fiveHour?.resetClock,
    windows: { fiveHour, sevenDay },
    updatedAt: now,
    status: remainingPct == null ? "Unavailable" : "Normal",
    raw: ""
  };
}

function resolveCodexLaunch() {
  const npmBin = process.env.APPDATA && path.join(process.env.APPDATA, "npm");
  const cliScript = npmBin && path.join(npmBin, "node_modules", "@openai", "codex", "bin", "codex.js");
  if (cliScript && fs.existsSync(cliScript)) {
    return { command: "node", args: [cliScript] };
  }
  return {
    command: process.platform === "win32" ? "codex.cmd" : "codex",
    args: [],
    shell: process.platform === "win32"
  };
}

function unavailableUsage(message) {
  return {
    source: "codex-app-server",
    remainingPct: null,
    usedPct: null,
    updatedAt: Date.now(),
    status: "Unavailable",
    raw: message
  };
}

function spawnCodexStatus() {
  return new Promise((resolve) => {
    const launch = resolveCodexLaunch();
    const proc = spawn(launch.command, [...launch.args, "app-server", "--listen", "stdio://"], {
      cwd: process.cwd(),
      env: process.env,
      windowsHide: true,
      shell: launch.shell,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let finished = false;

    const finish = (usage) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeoutTimer);
      try {
        proc.kill();
      } catch {}
      resolve(usage);
    };

    const handleLine = (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.id === 1 && message.result) {
        proc.stdin.write(`${JSON.stringify({ method: "initialized" })}\n`);
        proc.stdin.write(`${JSON.stringify({
          id: 2,
          method: "account/rateLimits/read",
          params: {}
        })}\n`);
      } else if (message.id === 2) {
        if (message.error) {
          finish(unavailableUsage(message.error.message || "Codex rate-limit query failed"));
        } else {
          finish(parseRateLimitsResponse(message.result));
        }
      }
    };

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      const lines = stdout.split(/\r?\n/);
      stdout = lines.pop() || "";
      lines.filter(Boolean).forEach(handleLine);
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (/refresh token (?:has already been used|was already used)|log out and sign in again/i.test(stderr)) {
        finish(unavailableUsage("Codex CLI login expired; run `codex logout` and `codex login`"));
      }
    });
    proc.on("error", (error) => finish(unavailableUsage(error.message)));
    proc.on("exit", () => {
      if (!finished) finish(unavailableUsage(stderr.trim() || "Codex app-server exited unexpectedly"));
    });

    proc.stdin.write(`${JSON.stringify({
      id: 1,
      method: "initialize",
      params: {
        clientInfo: { name: "winplate", version: "0.1.0" },
        capabilities: { experimentalApi: true }
      }
    })}\n`);

    const timeoutTimer = setTimeout(() => {
      finish(unavailableUsage(stderr.trim() || "Timed out reading Codex rate limits"));
    }, READ_TIMEOUT_MS);
  });
}

async function readCodexUsage({ force = false } = {}) {
  const cacheTtl = cachedUsage?.status === "Normal"
    ? SUCCESS_CACHE_TTL_MS
    : FAILURE_CACHE_TTL_MS;
  if (!force && cachedUsage && Date.now() - cachedAt < cacheTtl) {
    return cachedUsage;
  }
  if (pendingRead) return pendingRead;

  pendingRead = spawnCodexStatus()
    .catch((error) => ({
      source: "codex-cli-status",
      remainingPct: null,
      usedPct: null,
      updatedAt: Date.now(),
      status: "Unavailable",
      raw: error.message
    }))
    .then((usage) => {
      cachedAt = Date.now();
      if (usage.status === "Normal") {
        lastSuccessfulUsage = usage;
        cachedUsage = usage;
        return usage;
      }
      if (lastSuccessfulUsage) {
        cachedUsage = {
          ...lastSuccessfulUsage,
          source: `${lastSuccessfulUsage.source}-cache`,
          status: "Cached",
          raw: usage.raw
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

module.exports = { parseCodexStatus, parseRateLimitsResponse, readCodexUsage };
