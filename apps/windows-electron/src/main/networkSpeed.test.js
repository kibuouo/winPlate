const assert = require("assert");
const test = require("node:test");
const {
  calculateRate,
  chooseEffectiveAdapters,
  normalizeAdapterRows,
  normalizeLatencyMs,
  readWindowsLatencyMs,
  resetNetworkSpeedState
} = require("./networkSpeed");

test("network adapter selection prefers physical up adapters", () => {
  const rows = normalizeAdapterRows([
    {
      Name: "vEthernet",
      Status: "Up",
      HardwareInterface: false,
      InterfaceDescription: "Hyper-V Virtual Ethernet",
      ReceivedBytes: 9000,
      SentBytes: 4000
    },
    {
      Name: "Wi-Fi",
      Status: "Up",
      HardwareInterface: true,
      InterfaceDescription: "Intel Wi-Fi",
      ReceivedBytes: 12000,
      SentBytes: 5000
    },
    {
      Name: "Loopback",
      Status: "Up",
      HardwareInterface: true,
      InterfaceDescription: "Loopback",
      ReceivedBytes: 99999,
      SentBytes: 99999
    }
  ]);

  assert.deepEqual(chooseEffectiveAdapters(rows).map((row) => row.name), ["Wi-Fi"]);
});

test("network speed returns zero for first sample and smooths later samples", () => {
  resetNetworkSpeedState();
  const adapters = [{ receivedBytes: 1024, sentBytes: 512 }];

  const first = calculateRate({ adapters, latencyMs: 28 }, null, 1000);
  assert.equal(first.downloadBytesPerSecond, 0);
  assert.equal(first.uploadBytesPerSecond, 0);
  assert.equal(first.latencyMs, 28);
  assert.equal(first.status, "正常");

  const second = calculateRate({
    adapters: [{ receivedBytes: 1024 + 2048, sentBytes: 512 + 1024 }],
    latencyMs: 182
  }, { receivedBytes: 1024, sentBytes: 512, timestamp: 1000 }, 3000);

  assert.equal(second.downloadBytesPerSecond, 1024);
  assert.equal(second.uploadBytesPerSecond, 512);
  assert.equal(second.latencyMs, 182);
  assert.equal(second.status, "延迟高");
});

test("network speed handles missing adapters as disconnected", () => {
  resetNetworkSpeedState();
  const result = calculateRate({ adapters: [] }, null, 1000);

  assert.equal(result.status, "无连接");
  assert.equal(result.downloadBytesPerSecond, null);
  assert.equal(result.uploadBytesPerSecond, null);
  assert.equal(result.latencyMs, null);
});

test("latency helper preserves null and rounds valid numbers", () => {
  assert.equal(normalizeLatencyMs(26.4), 26);
  assert.equal(normalizeLatencyMs("91"), 91);
  assert.equal(normalizeLatencyMs(-1), null);
  assert.equal(normalizeLatencyMs(null), null);
  assert.equal(normalizeLatencyMs(undefined), null);
  assert.equal(normalizeLatencyMs(""), null);
});

test("latency measurement reads response time from powershell json", async () => {
  const calls = [];
  const latencyMs = await readWindowsLatencyMs(async (command, args) => {
    calls.push({ command, args });
    return { stdout: "{\"Target\":\"223.5.5.5\",\"ResponseTime\":34}" };
  });

  assert.equal(latencyMs, 34);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "powershell.exe");
  assert.ok(calls[0].args.includes("-Command"));
});

test("latency measurement returns null on command failure", async () => {
  const latencyMs = await readWindowsLatencyMs(async () => {
    throw new Error("timeout");
  });

  assert.equal(latencyMs, null);
});
