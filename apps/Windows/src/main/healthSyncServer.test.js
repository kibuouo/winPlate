const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createHealthSyncServer,
  getLanIPv4Addresses,
  normalizeHealthPayload
} = require("./healthSyncServer");

const TOKEN = "test-health-sync-token-123456";

test("normalizes Swift health payload dates and metrics", () => {
  const sentAt = (Date.now() - 978307200000) / 1000;
  const payload = normalizeHealthPayload({
    schemaVersion: 1,
    sender: "iPhone 16 Pro",
    sentAt,
    healthUpdatedAt: new Date().toISOString(),
    permissionGranted: true,
    heartRate: 76,
    stepCount: 4321,
    activeEnergy: 245.5
  });

  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.sender, "iPhone 16 Pro");
  assert.equal(payload.heartRate, 76);
  assert.match(payload.sentAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("filters internal and duplicate IPv4 addresses", () => {
  assert.deepEqual(
    getLanIPv4Addresses({
      WiFi: [
        { address: "192.168.1.20", family: "IPv4", internal: false },
        { address: "192.168.1.20", family: 4, internal: false }
      ],
      Loopback: [{ address: "127.0.0.1", family: "IPv4", internal: true }]
    }),
    ["192.168.1.20"]
  );
});

test("accepts authenticated health snapshots and rejects invalid tokens", async () => {
  const service = createHealthSyncServer({
    host: "127.0.0.1",
    port: 0,
    token: TOKEN,
    networkInterfaces: { WiFi: [{ address: "192.168.1.20", family: "IPv4", internal: false }] }
  });
  await service.start();

  try {
    const status = service.getStatus();
    const port = new URL(status.connectionUrls[0]).port;
    const sentAt = (Date.now() - 978307200000) / 1000;
    const payload = {
      schemaVersion: 1,
      sender: "iPhone",
      sentAt,
      healthUpdatedAt: null,
      permissionGranted: true,
      heartRate: 84,
      stepCount: 363,
      activeEnergy: 78
    };

    const accepted = await fetch(`http://127.0.0.1:${port}/api/health/sync?token=${TOKEN}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    assert.equal(accepted.status, 200);
    assert.equal(service.getStatus().snapshot.heartRate, 84);
    assert.equal(service.getStatus().state, "live");

    const rejected = await fetch(`http://127.0.0.1:${port}/api/health/sync?token=wrong`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    assert.equal(rejected.status, 401);
  } finally {
    await service.stop();
  }
});
