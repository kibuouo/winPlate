const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const stripAnsi = require("strip-ansi");

const READ_TIMEOUT_MS = 15_000;
const SUCCESS_CACHE_TTL_MS = 30 * 60_000;
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

// Legacy parser kept for older `codex status` text output tests.
// Runtime usage now reads JSON rate limits from `codex app-server`.
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
  if (!["number", "string"].includes(typeof window?.usedPercent)
    || (typeof window.usedPercent === "string" && !window.usedPercent.trim())) return null;
  const usedPercent = Number(window?.usedPercent);
  if (!window || !Number.isFinite(usedPercent)) return null;
  const usedPct = clampPercent(usedPercent);
  return {
    remainingPct: 100 - usedPct,
    usedPct,
    resetText: formatResetTimestamp(window.resetsAt, now),
    resetClock: formatResetClock(window.resetsAt)
  };
}

function classifyRateLimitWindows(rateLimits, now = Date.now()) {
  // Classify by windowDurationMins when present. Current Plus plans expose a
  // single primary weekly window (10080 mins / 7d) with secondary: null.
  // Legacy payloads without duration keep primary≈5h / secondary≈7d.
  const sessionWindowMaxMins = 12 * 60;
  const weeklyWindowMinMins = 24 * 60;
  let fiveHour = null;
  let sevenDay = null;

  for (const [raw, key] of [
    [rateLimits?.primary, "primary"],
    [rateLimits?.secondary, "secondary"]
  ]) {
    const window = normalizeRateLimitWindow(raw, now);
    if (!window) continue;
    const durationMins = Number(raw?.windowDurationMins);
    if (Number.isFinite(durationMins) && durationMins > 0) {
      if (durationMins <= sessionWindowMaxMins) {
        fiveHour = window;
      } else if (durationMins >= weeklyWindowMinMins) {
        sevenDay = window;
      } else if (!sevenDay) {
        sevenDay = window;
      } else if (!fiveHour) {
        fiveHour = window;
      }
    } else if (key === "primary") {
      fiveHour = window;
    } else {
      sevenDay = window;
    }
  }

  return { fiveHour, sevenDay };
}

function parseRateLimitsResponse(result, now = Date.now()) {
  const rateLimits = result?.rateLimitsByLimitId?.codex || result?.rateLimits;
  const { fiveHour, sevenDay } = classifyRateLimitWindows(rateLimits, now);
  const display = sevenDay || fiveHour;
  const remainingPct = display?.remainingPct ?? null;

  return {
    source: "codex-app-server",
    remainingPct,
    usedPct: display?.usedPct ?? null,
    resetText: display?.resetText,
    resetClock: display?.resetClock,
    windows: { fiveHour, sevenDay },
    updatedAt: now,
    status: remainingPct == null ? "Unavailable" : "Normal",
    raw: ""
  };
}

function envValue(environment, name) {
  const key = Object.keys(environment || {}).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? environment[key] : undefined;
}

function existingCodexExecutable(localAppData, fileSystem = fs) {
  if (!localAppData) return null;
  const binRoot = path.join(localAppData, "OpenAI", "Codex", "bin");
  let versions;
  try {
    versions = fileSystem.readdirSync(binRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(binRoot, entry.name))
      .map((directory) => path.join(directory, "codex.exe"))
      .filter((candidate) => {
        try {
          return fileSystem.statSync(candidate).isFile();
        } catch {
          return false;
        }
      });
  } catch {
    return null;
  }
  if (!versions.length) return null;
  return versions.sort((left, right) => {
    try {
      return fileSystem.statSync(right).mtimeMs - fileSystem.statSync(left).mtimeMs;
    } catch {
      return 0;
    }
  })[0];
}

function existingCodexOnPath(pathValue, fileSystem = fs) {
  return String(pathValue || "")
    .split(path.delimiter)
    .map((directory) => directory.trim())
    .filter(Boolean)
    .map((directory) => path.join(directory, "codex.exe"))
    .find((candidate) => {
      try {
        return fileSystem.statSync(candidate).isFile();
      } catch {
        return false;
      }
    }) || null;
}

function resolveCodexLaunch({
  platform = process.platform,
  appData = process.env.APPDATA,
  localAppData = process.env.LOCALAPPDATA,
  environment = process.env,
  fileSystem = fs
} = {}) {
  const npmBin = appData && path.join(appData, "npm");
  const cliScript = npmBin && path.join(npmBin, "node_modules", "@openai", "codex", "bin", "codex.js");
  if (cliScript && fileSystem.existsSync(cliScript)) {
    return { command: "node", args: [cliScript], shell: false };
  }
  if (platform !== "win32") {
    return { command: "codex", args: [], shell: false };
  }

  const configuredPath = String(envValue(environment, "CODEX_CLI_PATH") || "").trim();
  const configuredExecutable = configuredPath && fileSystem.existsSync(configuredPath)
    ? configuredPath
    : null;
  const executable = configuredExecutable
    || existingCodexOnPath(envValue(environment, "PATH"), fileSystem)
    || existingCodexExecutable(localAppData, fileSystem);
  return {
    command: executable || "codex.exe",
    args: [],
    shell: false
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
        clientInfo: { name: "winplate", version: "0.3.0" },
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

module.exports = { parseCodexStatus, parseRateLimitsResponse, readCodexUsage, resolveCodexLaunch };
