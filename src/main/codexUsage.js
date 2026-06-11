const pty = require("node-pty");
const stripAnsi = require("strip-ansi");

const STATUS_FALLBACK_MS = 6000;
const READ_TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 30_000;

let cachedUsage = null;
let pendingRead = null;

function clampPercent(value) {
  return Math.max(0, Math.min(100, Number(value)));
}

function parseCodexStatus(text) {
  const plain = stripAnsi(text)
    .replace(/\r/g, "")
    .replace(/[\u2500-\u257f]/g, " ");
  const lines = plain.split("\n").map((line) => line.trim()).filter(Boolean);
  const percentLines = lines
    .map((line) => {
      const match = line.match(/(\d{1,3})\s*%\s*(left|remaining|used)?/i);
      if (!match) return null;
      const value = clampPercent(match[1]);
      const used = /used/i.test(match[2] || "") || /\bused\b/i.test(line);
      return { line, remainingPct: used ? 100 - value : value };
    })
    .filter(Boolean);

  const primary =
    percentLines.find(({ line }) => /(?:5\s*h(?:our)?|session|primary)/i.test(line)) ||
    percentLines[0];
  const resetLine =
    (primary?.line && /resets?|reset\s*[:：]/i.test(primary.line) ? primary.line : "") ||
    lines.find((line) => /resets?|reset\s*[:：]/i.test(line)) ||
    "";
  const resetMatch =
    resetLine.match(/resets?\s+(?:in|at)\s+(.+)/i) ||
    resetLine.match(/resets?\s+([^)]+)/i) ||
    resetLine.match(/reset\s*[:：]\s*(.+)/i);
  const remainingPct = primary?.remainingPct ?? null;

  return {
    source: "codex-cli-status",
    remainingPct,
    usedPct: remainingPct == null ? null : 100 - remainingPct,
    resetText: resetMatch?.[1]?.trim().replace(/\)+$/, ""),
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
    let statusTimer;
    let timeoutTimer;

    const finish = (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(statusTimer);
      clearTimeout(timeoutTimer);
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

    const sendStatus = () => {
      if (finished || statusSent) return;
      statusSent = true;
      proc.write("\x1b");
      setTimeout(() => {
        proc.write("/status");
        setTimeout(() => proc.write("\r"), 300);
      }, 400);
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
      if (/(\d{1,3})\s*%\s*(?:left|remaining|used)/i.test(plainOutput)) {
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
