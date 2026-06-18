const assert = require("assert");
const test = require("node:test");
const {
  calculateRate,
  chooseEffectiveAdapters,
  normalizeAdapterRows,
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

  const first = calculateRate({ adapters }, null, 1000);
  assert.equal(first.downloadBytesPerSecond, 0);
  assert.equal(first.uploadBytesPerSecond, 0);
  assert.equal(first.status, "正常");

  const second = calculateRate({
    adapters: [{ receivedBytes: 1024 + 2048, sentBytes: 512 + 1024 }]
  }, { receivedBytes: 1024, sentBytes: 512, timestamp: 1000 }, 3000);

  assert.equal(second.downloadBytesPerSecond, 1024);
  assert.equal(second.uploadBytesPerSecond, 512);
  assert.equal(second.status, "正常");
});

test("network speed handles missing adapters as disconnected", () => {
  resetNetworkSpeedState();
  const result = calculateRate({ adapters: [] }, null, 1000);

  assert.equal(result.status, "无连接");
  assert.equal(result.downloadBytesPerSecond, null);
  assert.equal(result.uploadBytesPerSecond, null);
});
