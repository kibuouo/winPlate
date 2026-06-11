const pty = require("node-pty");
const stripAnsi = require("strip-ansi");

const STATUS_FALLBACK_MS = 6000;
const READ_TIMEOUT_MS = 30_000;
const STATUS_RETRY_DELAY_MS = 3_000;
const CACHE_TTL_MS = 30_000;

let cachedUsage = null;
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

function spawnCodexStatus() {
  return new Promise((resolve) => {
    const command = process.platform === "win32" ? "codex.cmd" : "codex";
    const proc = pty.spawn(command, ["--no-alt-screen", "-c", "mcp_servers={}"], {
      name: "xterm-color",
      cols: 140,
      rows: 50,
      cwd: process.cwd(),
      env: { ...process.env, TERM: "xterm-256color" }
    });

    let output = "";
    let finished = false;
    let statusSent = false;
    let statusRetryStarted = false;
    let statusTimer;
    let timeoutTimer;
    let retryTimer;

    const finish = (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(statusTimer);
      clearTimeout(timeoutTimer);
      clearTimeout(retryTimer);
      try {
        proc.write("/exit\r");
        proc.kill();
      } catch {}

      if (error) {
        resolve({
          source: "codex-cli-status",
          remainingPct: null,
          usedPct: null,
          updatedAt: Date.now(),
          status: "Unavailable",
          raw: `${stripAnsi(output).trim()}\n${error.message}`.trim()
        });
        return;
      }
      resolve(parseCodexStatus(output));
    };

    const submitStatus = () => {
      if (finished) return;
      proc.write("\x1b");
      setTimeout(() => {
        proc.write("/status");
        setTimeout(() => proc.write("\r"), 300);
      }, 400);
    };

    const sendStatus = () => {
      if (finished || statusSent) return;
      statusSent = true;
      submitStatus();
    };

    const retryStatus = () => {
      if (finished) return;
      submitStatus();
      retryTimer = setTimeout(retryStatus, STATUS_RETRY_DELAY_MS);
    };

    proc.onData((data) => {
      output += data;
      const plainOutput = stripAnsi(output);
      if (
        !statusSent &&
        /(?:›\s*(?:Summarize recent commits)?|\/model to change)[\s\S]*?(?:·\s*~|directory:)/i.test(plainOutput) &&
        !/Starting MCP servers[^\n]*\(\d+\/\d+\)/i.test(data)
      ) {
        setTimeout(sendStatus, 500);
      }
      if (
        !statusRetryStarted &&
        /refresh requested;\s*run\s+\/status\s+again shortly/i.test(plainOutput)
      ) {
        statusRetryStarted = true;
        retryTimer = setTimeout(retryStatus, STATUS_RETRY_DELAY_MS);
      }
      const percentageMatches = plainOutput.match(
        /(\d{1,3})\s*%\s*(?:left|remaining|used)/gi
      );
      if ((percentageMatches?.length || 0) >= 2) {
        setTimeout(() => finish(), 250);
      }
    });
    proc.onExit(() => finish());
    statusTimer = setTimeout(sendStatus, STATUS_FALLBACK_MS);
    timeoutTimer = setTimeout(() => finish(new Error("Timed out reading Codex /status")), READ_TIMEOUT_MS);
  });
}

async function readCodexUsage({ force = false } = {}) {
  if (!force && cachedUsage && Date.now() - cachedUsage.updatedAt < CACHE_TTL_MS) {
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
      cachedUsage = usage;
      return usage;
    })
    .finally(() => {
      pendingRead = null;
    });
  return pendingRead;
}

module.exports = { parseCodexStatus, readCodexUsage };
