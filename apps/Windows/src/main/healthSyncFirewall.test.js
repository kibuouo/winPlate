const test = require("node:test");
const assert = require("node:assert/strict");

const {
  HEALTH_SYNC_FIREWALL_RULE,
  ensureHealthSyncFirewallRule
} = require("./healthSyncFirewall");

test("ensureHealthSyncFirewallRule skips non-Windows platforms", async () => {
  const result = await ensureHealthSyncFirewallRule({
    exePath: "C:\\Apps\\WinPlate\\WinPlate.exe",
    platform: "darwin",
    execFile: async () => {
      throw new Error("should not be called");
    }
  });
  assert.deepEqual(result, { applied: false, reason: "unsupported-platform" });
});

test("ensureHealthSyncFirewallRule adds a private inbound rule for the health listener", async () => {
  const calls = [];
  const result = await ensureHealthSyncFirewallRule({
    exePath: "C:\\Apps\\WinPlate\\WinPlate.exe",
    port: 8766,
    platform: "win32",
    execFile: async (command, args) => {
      calls.push({ command, args });
      if (args.includes("show")) {
        const error = new Error("No rules match the specified criteria.");
        error.code = 1;
        throw error;
      }
    }
  });

  assert.equal(result.applied, true);
  assert.equal(result.reason, "created");
  assert.equal(calls[0].command, "netsh");
  assert.deepEqual(calls[1].args.slice(0, 5), ["advfirewall", "firewall", "add", "rule", `name=${HEALTH_SYNC_FIREWALL_RULE}`]);
  assert.ok(calls[1].args.includes("profile=private"));
  assert.ok(calls[1].args.includes("localport=8766"));
  assert.ok(calls[1].args.includes("program=C:\\Apps\\WinPlate\\WinPlate.exe"));
});
