const test = require("node:test");
const assert = require("node:assert/strict");
const {
  HEART_RATE_HISTORY_WINDOW_MS,
  MAX_HEART_RATE_HISTORY_POINTS,
  parseHealthTimestamp,
  parseHealthDate,
  normalizeHeartRateHistory,
  normalizeIncomingHeartRateSamples,
  mergeHeartRateHistory,
  heartRateRange,
  filterHeartRateHistory,
  heartRateStats,
  buildHeartRateCsv,
  buildHeartRateExportFilename
} = require("@winplate/core/health");

test("parses ISO, unix milliseconds, and Swift reference-date seconds", () => {
  const iso = "2026-08-07T01:00:00.000Z";
  const unixMs = Date.parse(iso);
  const swiftSeconds = unixMs / 1000 - 978307200;

  assert.equal(parseHealthDate(iso, "sampleAt"), iso);
  assert.equal(parseHealthDate(unixMs, "sampleAt"), iso);
  assert.equal(parseHealthDate(swiftSeconds, "sampleAt"), iso);
  assert.equal(parseHealthTimestamp(iso), unixMs);
  assert.equal(parseHealthDate(null, "sampleAt"), null);
  assert.throws(() => parseHealthDate(null, "sentAt", { required: true }), /sentAt is required/);
  assert.throws(() => parseHealthDate("not-a-date", "sentAt"), /sentAt is invalid/);
});

test("normalizes, de-duplicates, and prunes heart-rate history", () => {
  const now = Date.parse("2026-08-08T00:00:00.000Z");
  const history = normalizeHeartRateHistory([
    { sampleAt: "2026-08-07T00:00:00.000Z", heartRate: 76 },
    { sampleAt: "2026-08-07T01:00:00.000Z", heartRate: 82 },
    { sampleAt: "2026-08-07T01:00:00.000Z", bpm: 84 },
    { sampleAt: "2026-07-30T00:00:00.000Z", heartRate: 60 },
    { sampleAt: "2026-08-07T02:00:00.000Z", heartRate: 400 }
  ], now);

  assert.deepEqual(history, [
    { sampleAt: "2026-08-07T00:00:00.000Z", heartRate: 76 },
    { sampleAt: "2026-08-07T01:00:00.000Z", heartRate: 84 }
  ]);
  assert.equal(HEART_RATE_HISTORY_WINDOW_MS, 7 * 24 * 60 * 60 * 1000);
  assert.equal(MAX_HEART_RATE_HISTORY_POINTS, 2048);
});

test("merges a snapshot series and the latest sample", () => {
  const now = Date.parse("2026-08-08T00:00:00.000Z");
  const payload = {
    heartRate: 90,
    heartRateSampleAt: "2026-08-07T23:50:00.000Z",
    heartRateSamples: [
      { sampleAt: "2026-08-07T22:00:00.000Z", heartRate: 72 },
      { sampleAt: "2026-08-07T23:00:00.000Z", bpm: 80 },
      { sampleAt: "2026-08-07T23:50:00.000Z", heartRate: 90 }
    ]
  };

  assert.deepEqual(normalizeIncomingHeartRateSamples(payload.heartRateSamples).map((point) => point.heartRate), [72, 80, 90]);
  assert.deepEqual(
    mergeHeartRateHistory([], payload, now),
    [
      { sampleAt: "2026-08-07T22:00:00.000Z", heartRate: 72 },
      { sampleAt: "2026-08-07T23:00:00.000Z", heartRate: 80 },
      { sampleAt: "2026-08-07T23:50:00.000Z", heartRate: 90 }
    ]
  );
});

test("filters a chart window and computes stats", () => {
  const now = Date.parse("2026-08-08T00:00:00.000Z");
  const points = [
    { sampleAt: "2026-08-06T12:00:00.000Z", heartRate: 70 },
    { sampleAt: "2026-08-07T12:00:00.000Z", heartRate: 80 },
    { sampleAt: "2026-08-07T18:00:00.000Z", heartRate: 90 }
  ];

  assert.equal(heartRateRange("week").label, "7 天");
  assert.deepEqual(
    filterHeartRateHistory(points, { range: "day", nowTimestamp: now }).map((point) => point.heartRate),
    [80, 90]
  );
  assert.deepEqual(heartRateStats(points), {
    count: 3,
    average: 80,
    minimum: 70,
    maximum: 90
  });
  assert.equal(heartRateStats([]), null);
});

test("builds a CSV export without a document", () => {
  const csv = buildHeartRateCsv([
    { sampleAt: "2026-08-16T04:00:00.000Z", heartRate: 72.4 },
    { sampleAt: "", heartRate: 90 }
  ], { rangeLabel: "7 天" });

  assert.match(csv, /^# WinPlate 心率导出 · 7 天 · 1 条采样/);
  assert.match(csv, /2026-08-16T04:00:00\.000Z,72/);
  assert.equal(
    buildHeartRateExportFilename("week", Date.parse("2026-08-16T05:30:00.000Z")),
    "winplate-heart-rate-7d-2026-08-16T05-30-00-000Z.csv"
  );
});
