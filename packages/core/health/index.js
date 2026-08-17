const HEART_RATE_HISTORY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_HEART_RATE_HISTORY_POINTS = 2048;
const SWIFT_REFERENCE_DATE_OFFSET_SECONDS = 978_307_200;
const MIN_HEART_RATE = 0;
const MAX_HEART_RATE = 300;
const CSV_HEADERS = Object.freeze(["采样时间", "心率 (BPM)"]);

function createHealthHistoryApi() {
  function parseHealthTimestamp(value) {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "number" && Number.isFinite(value)) {
      return value < 10_000_000_000
        ? (value + SWIFT_REFERENCE_DATE_OFFSET_SECONDS) * 1000
        : value;
    }
    if (typeof value === "string") {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  function parseHealthDate(value, fieldName, { required = false } = {}) {
    if (value === null || value === undefined || value === "") {
      if (required) throw new Error(`${fieldName} is required`);
      return null;
    }
    const timestamp = parseHealthTimestamp(value);
    if (!Number.isFinite(timestamp)) throw new Error(`${fieldName} is invalid`);
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) throw new Error(`${fieldName} is invalid`);
    return date.toISOString();
  }

  function readHeartRate(value) {
    if (value === null || value === undefined || value === "") return null;
    const heartRate = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(heartRate) || heartRate < MIN_HEART_RATE || heartRate > MAX_HEART_RATE) {
      return null;
    }
    return heartRate;
  }

  function normalizeHeartRateHistory(points, nowTimestamp = Date.now()) {
    const nowMs = Number.isFinite(Number(nowTimestamp)) ? Number(nowTimestamp) : Date.now();
    const cutoff = nowMs - HEART_RATE_HISTORY_WINDOW_MS;
    const bySampleTimestamp = new Map();

    for (const point of Array.isArray(points) ? points : []) {
      const timestamp = parseHealthTimestamp(point?.sampleAt ?? point?.heartRateSampleAt ?? point?.date);
      const heartRate = readHeartRate(point?.heartRate ?? point?.bpm ?? point?.value);
      if (!Number.isFinite(timestamp) || timestamp < cutoff || heartRate === null) continue;
      bySampleTimestamp.set(timestamp, {
        sampleAt: new Date(timestamp).toISOString(),
        heartRate
      });
    }

    return [...bySampleTimestamp.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, point]) => point)
      .slice(-MAX_HEART_RATE_HISTORY_POINTS);
  }

  function normalizeIncomingHeartRateSamples(samples) {
    if (samples === null || samples === undefined || samples === "") return [];
    if (!Array.isArray(samples)) throw new Error("heartRateSamples is invalid");
    const normalized = [];
    for (const sample of samples.slice(-MAX_HEART_RATE_HISTORY_POINTS)) {
      let sampleAt;
      try {
        sampleAt = parseHealthDate(sample?.sampleAt ?? sample?.date, "heartRateSamples.sampleAt");
      } catch {
        continue;
      }
      const heartRate = readHeartRate(sample?.heartRate ?? sample?.bpm ?? sample?.value);
      if (!sampleAt || heartRate === null) continue;
      normalized.push({ sampleAt, heartRate });
    }
    return normalized;
  }

  function mergeHeartRateHistory(history, snapshot, nowTimestamp = Date.now()) {
    const incoming = [];
    if (Array.isArray(snapshot?.heartRateSamples)) {
      incoming.push(...snapshot.heartRateSamples);
    }
    if (snapshot?.heartRate !== null && snapshot?.heartRate !== undefined) {
      incoming.push({
        sampleAt: snapshot.heartRateSampleAt || snapshot.healthUpdatedAt || snapshot.sentAt,
        heartRate: snapshot.heartRate
      });
    }
    if (incoming.length === 0) {
      return normalizeHeartRateHistory(history, nowTimestamp);
    }
    return normalizeHeartRateHistory(
      [...(Array.isArray(history) ? history : []), ...incoming],
      nowTimestamp
    );
  }

  function heartRateRange(rangeKey = "day") {
    if (rangeKey === "week") {
      return { key: "week", label: "7 天", windowMs: HEART_RATE_HISTORY_WINDOW_MS };
    }
    return { key: "day", label: "24 小时", windowMs: 24 * 60 * 60 * 1000 };
  }

  function filterHeartRateHistory(points, { range = "day", nowTimestamp = Date.now() } = {}) {
    const rangeConfig = heartRateRange(range);
    const nowMs = Number.isFinite(Number(nowTimestamp)) ? Number(nowTimestamp) : Date.now();
    const start = nowMs - rangeConfig.windowMs;
    return normalizeHeartRateHistory(points, nowMs).filter((point) => {
      const timestamp = parseHealthTimestamp(point.sampleAt);
      return timestamp >= start && timestamp <= nowMs + 60 * 1000;
    });
  }

  function heartRateStats(samples) {
    const values = (Array.isArray(samples) ? samples : [])
      .map((point) => Number(point?.heartRate))
      .filter((value) => Number.isFinite(value));
    if (!values.length) return null;
    return {
      count: values.length,
      average: values.reduce((sum, value) => sum + value, 0) / values.length,
      minimum: Math.min(...values),
      maximum: Math.max(...values)
    };
  }

  function escapeCsvField(value) {
    const text = String(value ?? "");
    if (/[",\r\n]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  }

  function formatExportTimestamp(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "unknown-time";
    return date.toISOString().replace(/[:.]/g, "-");
  }

  function buildHeartRateExportFilename(rangeKey, exportedAt = Date.now()) {
    const rangeLabel = rangeKey === "week" ? "7d" : "24h";
    return `winplate-heart-rate-${rangeLabel}-${formatExportTimestamp(exportedAt)}.csv`;
  }

  function buildHeartRateCsv(samples, { rangeLabel = "24 小时" } = {}) {
    const rows = (Array.isArray(samples) ? samples : [])
      .map((sample) => {
        const sampleAt = String(sample?.sampleAt || "").trim();
        const heartRate = Number(sample?.heartRate);
        if (!sampleAt || !Number.isFinite(heartRate)) return null;
        return [sampleAt, String(Math.round(heartRate))];
      })
      .filter(Boolean);

    const lines = [
      `# WinPlate 心率导出 · ${rangeLabel} · ${rows.length} 条采样`,
      CSV_HEADERS.map(escapeCsvField).join(","),
      ...rows.map((row) => row.map(escapeCsvField).join(","))
    ];
    return `${lines.join("\r\n")}\r\n`;
  }

  return {
    HEART_RATE_HISTORY_WINDOW_MS,
    MAX_HEART_RATE_HISTORY_POINTS,
    CSV_HEADERS,
    parseHealthTimestamp,
    parseHealthDate,
    normalizeHeartRateHistory,
    normalizeIncomingHeartRateSamples,
    mergeHeartRateHistory,
    heartRateRange,
    filterHeartRateHistory,
    heartRateStats,
    escapeCsvField,
    buildHeartRateExportFilename,
    buildHeartRateCsv
  };
}

const healthHistoryApi = createHealthHistoryApi();

if (typeof module !== "undefined" && module.exports) {
  module.exports = Object.assign(healthHistoryApi, { createHealthHistoryApi });
} else if (typeof globalThis !== "undefined") {
  globalThis.WinPlateHealthHistory = healthHistoryApi;
}
