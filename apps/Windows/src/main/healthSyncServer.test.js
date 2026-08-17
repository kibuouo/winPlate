const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  buildHealthPairingPayload,
  createHealthSyncServer,
  getLanIPv4Addresses,
  mergeHeartRateHistory,
  normalizeHeartRateHistory,
  normalizeHealthPayload,
  normalizeDesktopStatusSnapshot,
  parseHealthPairingPayload
} = require("./healthSyncServer");

const TOKEN = "test-health-sync-token-123456";

test("Windows shared heart-rate history script stays identical to @winplate/core/health", async () => {
  const core = await fs.readFile(require.resolve("@winplate/core/health"), "utf8");
  const shared = await fs.readFile(path.join(__dirname, "../shared/heartRateHistory.js"), "utf8");
  assert.equal(shared, core);
});

test("deduplicates, sorts, and prunes local heart-rate history", () => {
  const now = Date.parse("2026-08-08T00:00:00.000Z");
  const history = normalizeHeartRateHistory([
    { sampleAt: "2026-08-07T00:00:00.000Z", heartRate: 76 },
    { sampleAt: "2026-08-07T01:00:00.000Z", heartRate: 82 },
    { sampleAt: "2026-08-07T01:00:00.000Z", heartRate: 84 },
    { sampleAt: "2026-07-30T00:00:00.000Z", heartRate: 60 }
  ], now);

  assert.deepEqual(history, [
    { sampleAt: "2026-08-07T00:00:00.000Z", heartRate: 76 },
    { sampleAt: "2026-08-07T01:00:00.000Z", heartRate: 84 }
  ]);
  assert.deepEqual(
    mergeHeartRateHistory(history, {
      heartRate: 88,
      heartRateSampleAt: "2026-08-07T02:00:00.000Z"
    }, now),
    [
      { sampleAt: "2026-08-07T00:00:00.000Z", heartRate: 76 },
      { sampleAt: "2026-08-07T01:00:00.000Z", heartRate: 84 },
      { sampleAt: "2026-08-07T02:00:00.000Z", heartRate: 88 }
    ]
  );
});

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

test("normalizes schema 2 snapshot identity and per-metric timestamps", () => {
  const payload = normalizeHealthPayload({
    schemaVersion: 2,
    snapshotId: "snapshot-123",
    reason: "healthKitObserver",
    sender: "iPhone",
    sentAt: new Date().toISOString(),
    healthUpdatedAt: new Date().toISOString(),
    permissionGranted: true,
    heartRate: 81,
    heartRateSampleAt: new Date().toISOString(),
    stepCount: 1200,
    stepCountSampleAt: new Date().toISOString(),
    activeEnergy: 125,
    activeEnergySampleAt: new Date().toISOString()
  });

  assert.equal(payload.schemaVersion, 2);
  assert.equal(payload.snapshotId, "snapshot-123");
  assert.equal(payload.reason, "healthKitObserver");
  assert.match(payload.heartRateSampleAt, /^\d{4}-\d{2}-\d{2}T/);
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

test("normalizes and stores desktop status without sensitive configuration", () => {
  const snapshot = normalizeDesktopStatusSnapshot({
    schemaVersion: 1,
    sender: "Windows WinPlate",
    sentAt: new Date().toISOString(),
    weather: {
      source: "qweather",
      location: "上海",
      condition: "晴",
      temperature: 28,
      feelsLike: 30,
      humidity: 65,
      icon: "100"
    },
    codex: { status: "Normal", remainingPct: 84, resetText: "6d 20h" },
    superGrok: { status: "Unavailable", remainingPct: null, resetText: null },
    deepSeek: { status: "Normal", currency: "CNY", balance: "12.34" }
  });

  assert.equal(snapshot.weather.temperature, 28);
  assert.equal(snapshot.codex.remainingPct, 84);
  assert.equal(snapshot.deepSeek.balance, "12.34");
  assert.equal(Object.hasOwn(snapshot, "apiKey"), false);

  const service = createHealthSyncServer({ token: TOKEN });
  service.setDesktopStatusSnapshot(snapshot);
  assert.deepEqual(service.getStatus().desktopStatus, snapshot);
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
      schemaVersion: 2,
      snapshotId: "snapshot-accepted",
      reason: "manual",
      sender: "iPhone",
      sentAt,
      healthUpdatedAt: null,
      permissionGranted: true,
      heartRate: 84,
      heartRateSampleAt: new Date().toISOString(),
      stepCount: 363,
      stepCountSampleAt: new Date().toISOString(),
      activeEnergy: 78
    };

    const accepted = await fetch(`http://127.0.0.1:${port}/api/health/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-WinPlate-Health-Token": TOKEN
      },
      body: JSON.stringify(payload)
    });
    assert.equal(accepted.status, 200);
    assert.equal(service.getStatus().snapshot.heartRate, 84);
    assert.equal(service.getStatus().lastSnapshotId, "snapshot-accepted");
    assert.deepEqual(service.getStatus().heartRateHistory, [
      { sampleAt: payload.heartRateSampleAt, heartRate: 84 }
    ]);
    assert.equal(service.getStatus().freshness.heartRate.state, "fresh");
    assert.equal(service.getStatus().state, "live");

    const duplicate = await fetch(`http://127.0.0.1:${port}/api/health/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-WinPlate-Health-Token": TOKEN
      },
      body: JSON.stringify(payload)
    });
    assert.equal(duplicate.status, 200);
    assert.equal((await duplicate.json()).duplicate, true);

    const nextPayload = {
      ...payload,
      snapshotId: "snapshot-next",
      sentAt: new Date(Date.now() + 1_000).toISOString(),
      heartRate: 88,
      heartRateSampleAt: new Date(Date.now() + 1_000).toISOString()
    };
    const next = await fetch(`http://127.0.0.1:${port}/api/health/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-WinPlate-Health-Token": TOKEN
      },
      body: JSON.stringify(nextPayload)
    });
    assert.equal(next.status, 200);
    assert.equal(service.getStatus().heartRateHistory.length, 2);

    const rejectedQuery = await fetch(`http://127.0.0.1:${port}/api/health/sync?token=${TOKEN}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    assert.equal(rejectedQuery.status, 401);

    const rejected = await fetch(`http://127.0.0.1:${port}/api/health/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-WinPlate-Health-Token": "wrong"
      },
      body: JSON.stringify(payload)
    });
    assert.equal(rejected.status, 401);

    const cors = await fetch(`http://127.0.0.1:${port}/api/health/status`, {
      headers: { "X-WinPlate-Health-Token": TOKEN }
    });
    assert.equal(cors.headers.get("access-control-allow-origin"), null);
    assert.equal(service.getStatus().pairingToken, undefined);
    assert.equal(service.getStatus({ includePairingToken: true }).pairingToken, TOKEN);
    assert.match(service.getStatus().connectionUrls[0], /^http:\/\/192\.168\.1\.20:\d+\/api\/health\/sync$/);
    assert.doesNotMatch(service.getStatus().connectionUrls[0], /token=/);
    assert.equal(service.getStatus().pairingPayloads, undefined);
    const pairing = service.getStatus({ includePairingToken: true });
    assert.match(pairing.pairingPayloads[0], /^winplate:\/\/192\.168\.1\.20:\d+#/);
    assert.ok(pairing.pairingPayloads[0].endsWith(`#${TOKEN}`));
  } finally {
    await service.stop();
  }
});

test("persists heart-rate history across health sync server restarts", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "winplate-health-"));
  const historyFilePath = path.join(directory, "health-heart-rate-history.json");
  const create = () => createHealthSyncServer({
    host: "127.0.0.1",
    port: 0,
    token: TOKEN,
    historyFilePath,
    networkInterfaces: { WiFi: [{ address: "192.168.1.20", family: "IPv4", internal: false }] }
  });

  let service = create();
  await service.start();
  const port = new URL(service.getStatus().connectionUrls[0]).port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-WinPlate-Health-Token": TOKEN
      },
      body: JSON.stringify({
        schemaVersion: 2,
        snapshotId: "snapshot-persisted",
        sender: "iPhone",
        sentAt: new Date().toISOString(),
        healthUpdatedAt: new Date().toISOString(),
        permissionGranted: true,
        heartRate: 79,
        heartRateSampleAt: new Date().toISOString()
      })
    });
    assert.equal(response.status, 200);
  } finally {
    await service.stop();
  }

  service = create();
  await service.start();
  try {
    assert.deepEqual(service.getStatus().heartRateHistory.map((point) => point.heartRate), [79]);
    assert.equal(JSON.parse(await fs.readFile(historyFilePath, "utf8")).points[0].heartRate, 79);
  } finally {
    await service.stop();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("marks the health connection stale after the idle window", async () => {
  let now = Date.parse("2026-08-17T00:00:00.000Z");
  const service = createHealthSyncServer({
    host: "127.0.0.1",
    port: 0,
    token: TOKEN,
    now: () => now,
    networkInterfaces: { WiFi: [{ address: "192.168.1.20", family: "IPv4", internal: false }] }
  });
  await service.start();
  try {
    const port = new URL(service.getStatus().connectionUrls[0]).port;
    const response = await fetch(`http://127.0.0.1:${port}/api/health/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-WinPlate-Health-Token": TOKEN
      },
      body: JSON.stringify({
        schemaVersion: 2,
        snapshotId: "snapshot-stale",
        sender: "iPhone",
        sentAt: new Date(now).toISOString(),
        healthUpdatedAt: new Date(now).toISOString(),
        permissionGranted: true,
        heartRate: 70,
        heartRateSampleAt: new Date(now).toISOString()
      })
    });
    assert.equal(response.status, 200);
    assert.equal(service.getStatus().state, "live");
    now += (2 * 60 * 1000) + 1;
    assert.equal(service.getStatus().state, "stale");
    assert.equal(service.getStatus().snapshot.heartRate, 70);
  } finally {
    await service.stop();
  }
});

test("merges a heart-rate sample series from a health snapshot", () => {
  const now = Date.parse("2026-08-08T00:00:00.000Z");
  const payload = normalizeHealthPayload({
    schemaVersion: 2,
    sender: "iPhone",
    sentAt: "2026-08-08T00:00:00.000Z",
    healthUpdatedAt: "2026-08-08T00:00:00.000Z",
    permissionGranted: true,
    heartRate: 90,
    heartRateSampleAt: "2026-08-07T23:50:00.000Z",
    heartRateSamples: [
      { sampleAt: "2026-08-07T22:00:00.000Z", heartRate: 72 },
      { sampleAt: "2026-08-07T23:00:00.000Z", bpm: 80 },
      { sampleAt: "2026-08-07T23:50:00.000Z", heartRate: 90 }
    ]
  });

  assert.equal(payload.heartRateSamples.length, 3);
  assert.deepEqual(
    mergeHeartRateHistory([], payload, now),
    [
      { sampleAt: "2026-08-07T22:00:00.000Z", heartRate: 72 },
      { sampleAt: "2026-08-07T23:00:00.000Z", heartRate: 80 },
      { sampleAt: "2026-08-07T23:50:00.000Z", heartRate: 90 }
    ]
  );
});

test("builds and parses a single Windows health pairing payload", () => {
  const payload = buildHealthPairingPayload("http://192.168.1.20:8766/api/health/sync", TOKEN);
  assert.equal(payload, `winplate://192.168.1.20:8766#${TOKEN}`);
  assert.deepEqual(parseHealthPairingPayload(payload), {
    endpoint: "http://192.168.1.20:8766/api/health/sync",
    token: TOKEN
  });
  assert.deepEqual(
    parseHealthPairingPayload("http://192.168.1.20:8766/api/health/sync?token=legacy-token"),
    {
      endpoint: "http://192.168.1.20:8766/api/health/sync",
      token: "legacy-token"
    }
  );
  assert.deepEqual(
    parseHealthPairingPayload("192.168.1.20:8766\nsecond-line-token"),
    {
      endpoint: "http://192.168.1.20:8766/api/health/sync",
      token: "second-line-token"
    }
  );
});
