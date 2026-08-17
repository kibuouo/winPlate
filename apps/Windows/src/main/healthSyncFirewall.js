const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const DEFAULT_HEALTH_SYNC_PORT = 8766;
const HEALTH_SYNC_FIREWALL_RULE = "WinPlate Health Sync";
const execFileAsync = promisify(execFile);

async function ensureHealthSyncFirewallRule({
  exePath,
  port = DEFAULT_HEALTH_SYNC_PORT,
  platform = process.platform,
  execFile = execFileAsync
} = {}) {
  if (platform !== "win32") {
    return { applied: false, reason: "unsupported-platform" };
  }
  const program = String(exePath || "").trim();
  const localPort = Number(port);
  if (!program || !Number.isInteger(localPort) || localPort <= 0) {
    return { applied: false, reason: "invalid-rule" };
  }

  try {
    await execFile("netsh", [
      "advfirewall",
      "firewall",
      "show",
      "rule",
      `name=${HEALTH_SYNC_FIREWALL_RULE}`
    ], { windowsHide: true });
    return { applied: true, reason: "already-present", ruleName: HEALTH_SYNC_FIREWALL_RULE };
  } catch {
    // The scoped inbound rule is created below when it is missing.
  }

  try {
    await execFile("netsh", [
      "advfirewall",
      "firewall",
      "add",
      "rule",
      `name=${HEALTH_SYNC_FIREWALL_RULE}`,
      "dir=in",
      "action=allow",
      "protocol=TCP",
      `localport=${localPort}`,
      "profile=private",
      `program=${program}`
    ], { windowsHide: true });
    return { applied: true, reason: "created", ruleName: HEALTH_SYNC_FIREWALL_RULE };
  } catch (error) {
    return { applied: false, reason: error.message || "netsh-failed" };
  }
}

module.exports = {
  DEFAULT_HEALTH_SYNC_PORT,
  HEALTH_SYNC_FIREWALL_RULE,
  ensureHealthSyncFirewallRule
};
