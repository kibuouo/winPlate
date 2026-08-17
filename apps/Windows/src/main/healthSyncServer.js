const http = require("node:http");
const os = require("node:os");
const fs = require("node:fs/promises");
const path = require("node:path");

const HEALTH_SYNC_SCHEMA_VERSION = 2;
const SUPPORTED_HEALTH_SYNC_SCHEMA_VERSIONS = new Set([1, HEALTH_SYNC_SCHEMA_VERSION]);
const DEFAULT_HEALTH_SYNC_PORT = 8766;
const MAX_BODY_BYTES = 64 * 1024;
const STALE_AFTER_MS = 2 * 60 * 1000;
const HEART_RATE_HISTORY_FILE_NAME = "health-heart-rate-history.json";
const HEART_RATE_HISTORY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_HEART_RATE_HISTORY_POINTS = 2048;

function getLanIPv4Addresses(networkInterfaces = os.networkInterfaces()) {
  const addresses = [];
  for (const entries of Object.values(networkInterfaces || {})) {
    for (const entry of entries || []) {
      const family = typeof entry.family === "string" ? entry.family : Number(entry.family) === 4 ? "IPv4" : "";
      if (family === "IPv4" && !entry.internal && entry.address && !addresses.includes(entry.address)) {
        addresses.push(entry.address);
      }
    }
  }
  return addresses;
}

function parseDate(value, fieldName, { required = false } = {}) {
  if (value === null || value === undefined || value === "") {
    if (required) throw new Error(`${fieldName} is required`);
    return null;
  }

  let timestamp;
  if (typeof value === "number" && Number.isFinite(value)) {
    // Swift's JSONEncoder encodes Date as seconds since 2001-01-01.
    timestamp = value < 10_000_000_000 ? (value + 978307200) * 1000 : value;
  } else if (typeof value === "string") {
    timestamp = Date.parse(value);
  }
  if (!Number.isFinite(timestamp)) throw new Error(`${fieldName} is invalid`);
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) throw new Error(`${fieldName} is invalid`);
  return date.toISOString();
}

function optionalNumber(value, fieldName, { minimum = 0, maximum = Number.POSITIVE_INFINITY } = {}) {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new Error(`${fieldName} is invalid`);
  }
  return number;
}

function optionalSnapshotId(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > 100) throw new Error("snapshotId is invalid");
  return value;
}

function optionalReason(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > 64) throw new Error("reason is invalid");
  return value;
}

function normalizeHeartRateHistory(points, nowTimestamp = Date.now()) {
  const nowMs = Number.isFinite(Number(nowTimestamp)) ? Number(nowTimestamp) : Date.now();
  const cutoff = nowMs - HEART_RATE_HISTORY_WINDOW_MS;
  const bySampleTimestamp = new Map();

  for (const point of Array.isArray(points) ? points : []) {
    const rawSampleAt = point?.sampleAt ?? point?.heartRateSampleAt;
    let sampleAt;
    try {
      sampleAt = parseDate(rawSampleAt, "sampleAt");
    } catch {
      continue;
    }
    const sampleTimestamp = Date.parse(sampleAt);
    const heartRate = Number(point?.heartRate ?? point?.value);
    if (
      !Number.isFinite(sampleTimestamp)
      || sampleTimestamp < cutoff
      || !Number.isFinite(heartRate)
      || heartRate < 0
      || heartRate > 300
    ) {
      continue;
    }
    bySampleTimestamp.set(sampleTimestamp, {
      sampleAt: new Date(sampleTimestamp).toISOString(),
      heartRate
    });
  }

  return [...bySampleTimestamp.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, point]) => point)
    .slice(-MAX_HEART_RATE_HISTORY_POINTS);
}

function mergeHeartRateHistory(history, snapshot, nowTimestamp = Date.now()) {
  if (snapshot?.heartRate === null || snapshot?.heartRate === undefined) {
    return normalizeHeartRateHistory(history, nowTimestamp);
  }
  return normalizeHeartRateHistory(
    [
      ...(Array.isArray(history) ? history : []),
      {
        sampleAt: snapshot.heartRateSampleAt || snapshot.healthUpdatedAt || snapshot.sentAt,
        heartRate: snapshot.heartRate
      }
    ],
    nowTimestamp
  );
}

function metricFreshness(sampleAt, nowTimestamp, { freshMs, agingMs }) {
  if (!sampleAt) return { state: "unavailable", ageMs: null };
  const timestamp = Date.parse(sampleAt);
  if (!Number.isFinite(timestamp)) return { state: "unavailable", ageMs: null };
  const ageMs = Math.max(0, nowTimestamp - timestamp);
  return {
    state: ageMs <= freshMs ? "fresh" : ageMs <= agingMs ? "aging" : "stale",
    ageMs
  };
}

function buildMetricFreshness(snapshot, nowTimestamp) {
  return {
    heartRate: metricFreshness(snapshot?.heartRateSampleAt, nowTimestamp, {
      freshMs: 5 * 60 * 1000,
      agingMs: 15 * 60 * 1000
    }),
    stepCount: metricFreshness(snapshot?.stepCountSampleAt, nowTimestamp, {
      freshMs: 30 * 60 * 1000,
      agingMs: 2 * 60 * 60 * 1000
    }),
    activeEnergy: metricFreshness(snapshot?.activeEnergySampleAt, nowTimestamp, {
      freshMs: 30 * 60 * 1000,
      agingMs: 2 * 60 * 60 * 1000
    })
  };
}

function normalizeHealthPayload(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("health payload must be an object");
  }
  const schemaVersion = Number(input.schemaVersion);
  if (!SUPPORTED_HEALTH_SYNC_SCHEMA_VERSIONS.has(schemaVersion)) {
    throw new Error(`unsupported health schema version: ${input.schemaVersion}`);
  }
  if (typeof input.sender !== "string" || !input.sender.trim() || input.sender.length > 256) {
    throw new Error("sender is invalid");
  }
  if (typeof input.permissionGranted !== "boolean") {
    throw new Error("permissionGranted is invalid");
  }

  return {
    schemaVersion,
    snapshotId: optionalSnapshotId(input.snapshotId),
    reason: optionalReason(input.reason),
    sender: input.sender.trim(),
    sentAt: parseDate(input.sentAt, "sentAt", { required: true }),
    healthUpdatedAt: parseDate(input.healthUpdatedAt, "healthUpdatedAt"),
    permissionGranted: input.permissionGranted,
    heartRate: optionalNumber(input.heartRate, "heartRate", { maximum: 300 }),
    stepCount: optionalNumber(input.stepCount, "stepCount"),
    activeEnergy: optionalNumber(input.activeEnergy, "activeEnergy"),
    heartRateSampleAt: parseDate(input.heartRateSampleAt, "heartRateSampleAt"),
    stepCountSampleAt: parseDate(input.stepCountSampleAt, "stepCountSampleAt"),
    activeEnergySampleAt: parseDate(input.activeEnergySampleAt, "activeEnergySampleAt")
  };
}

function optionalStatusText(value, fieldName, maxLength = 256) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value !== "string" || value.length > maxLength) {
    throw new Error(`${fieldName} is invalid`);
  }
  return value.trim();
}

function normalizeDesktopStatusSnapshot(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("desktop status must be an object");
  }
  const schemaVersion = Number(input.schemaVersion);
  if (schemaVersion !== 1) {
    throw new Error(`unsupported desktop status schema version: ${input.schemaVersion}`);
  }
  const sender = optionalStatusText(input.sender, "sender");
  const sentAt = parseDate(input.sentAt, "sentAt", { required: true });
  const weather = input.weather && typeof input.weather === "object"
    ? {
        source: optionalStatusText(input.weather.source, "weather.source"),
        location: optionalStatusText(input.weather.location, "weather.location"),
        condition: optionalStatusText(input.weather.condition, "weather.condition"),
        temperature: optionalNumber(input.weather.temperature, "weather.temperature", { minimum: -100, maximum: 100 }),
        feelsLike: optionalNumber(input.weather.feelsLike, "weather.feelsLike", { minimum: -100, maximum: 100 }),
        humidity: optionalNumber(input.weather.humidity, "weather.humidity", { maximum: 100 }),
        icon: optionalStatusText(input.weather.icon, "weather.icon", 32)
      }
    : null;
  const normalizeQuota = (value, fieldName) => value && typeof value === "object"
    ? {
        status: optionalStatusText(value.status, `${fieldName}.status`),
        remainingPct: optionalNumber(value.remainingPct, `${fieldName}.remainingPct`, { maximum: 100 }),
        resetText: optionalStatusText(value.resetText, `${fieldName}.resetText`, 128)
      }
    : null;
  const deepSeek = input.deepSeek && typeof input.deepSeek === "object"
    ? {
        status: optionalStatusText(input.deepSeek.status, "deepSeek.status"),
        currency: optionalStatusText(input.deepSeek.currency, "deepSeek.currency", 16),
        balance: optionalStatusText(input.deepSeek.balance, "deepSeek.balance", 64)
      }
    : null;
  return {
    schemaVersion,
    sender,
    sentAt,
    weather,
    codex: normalizeQuota(input.codex, "codex"),
    superGrok: normalizeQuota(input.superGrok, "superGrok"),
    deepSeek
  };
}

function jsonResponse(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  response.end(body);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (tooLarge) {
        const error = new Error("health payload is too large");
        error.statusCode = 413;
        reject(error);
        return;
      }
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    request.on("error", reject);
  });
}

function createHealthSyncServer({
  host = "0.0.0.0",
  port = DEFAULT_HEALTH_SYNC_PORT,
  token,
  networkInterfaces,
  now = () => Date.now(),
  historyFilePath = null,
  onUpdate
} = {}) {
  if (typeof token !== "string" || token.trim().length < 16) {
    throw new Error("health sync pairing token is required");
  }

  let server = null;
  let boundPort = Number(port);
  let snapshot = null;
  let lastReceivedAt = null;
  let lastSnapshotId = null;
  let lastError = null;
  let heartRateHistory = [];
  let historyLoaded = false;
  let historyWrite = Promise.resolve();

  async function loadHeartRateHistory() {
    if (historyLoaded) return;
    historyLoaded = true;
    if (!historyFilePath) return;

    try {
      const stored = JSON.parse(await fs.readFile(historyFilePath, "utf8"));
      const points = Array.isArray(stored) ? stored : stored?.points || stored?.heartRateHistory;
      heartRateHistory = normalizeHeartRateHistory(points, now());
    } catch (error) {
      if (error.code !== "ENOENT") heartRateHistory = [];
    }
  }

  function persistHeartRateHistory() {
    if (!historyFilePath) return;
    const payload = JSON.stringify({
      version: 1,
      points: heartRateHistory
    });
    historyWrite = historyWrite
      .catch(() => {})
      .then(async () => {
        await fs.mkdir(path.dirname(historyFilePath), { recursive: true });
        await fs.writeFile(historyFilePath, payload, "utf8");
      });
  }
  let desktopStatus = null;

  function connectionUrls() {
    const availableInterfaces = typeof networkInterfaces === "function"
      ? networkInterfaces()
      : networkInterfaces || os.networkInterfaces();
    const addresses = getLanIPv4Addresses(availableInterfaces);
    const usableAddresses = addresses.length ? addresses : ["127.0.0.1"];
    return usableAddresses.map((address) => (
      `http://${address}:${boundPort}/api/health/sync`
    ));
  }

  function pairingPayloads() {
    return connectionUrls().map((url) => buildHealthPairingPayload(url, token));
  }

  function connectionState() {
    if (lastError) return "error";
    if (!snapshot || !lastReceivedAt) return "waiting";
    const receivedAt = Date.parse(lastReceivedAt);
    if (Number.isFinite(receivedAt) && now() - receivedAt > STALE_AFTER_MS) return "stale";
    return "live";
  }

  function getStatus({ includePairingToken = false } = {}) {
    const normalizedHistory = normalizeHeartRateHistory(heartRateHistory, now());
    if (normalizedHistory.length !== heartRateHistory.length) {
      heartRateHistory = normalizedHistory;
      persistHeartRateHistory();
    }
    const status = {
      schemaVersion: HEALTH_SYNC_SCHEMA_VERSION,
      state: connectionState(),
      lastReceivedAt,
      lastSnapshotId,
      freshness: buildMetricFreshness(snapshot, now()),
      heartRateHistory: heartRateHistory.map((point) => ({ ...point })),
      error: lastError,
      snapshot,
      desktopStatus,
      connectionUrls: connectionUrls()
    };
    if (includePairingToken) {
      status.pairingToken = token;
      status.pairingPayloads = pairingPayloads();
    }
    return status;
  }

  function notify() {
    onUpdate?.(getStatus());
  }

  function setDesktopStatusSnapshot(input) {
    desktopStatus = normalizeDesktopStatusSnapshot(input);
    notify();
    return desktopStatus;
  }

  function authorized(url, request) {
    const headerToken = typeof request.headers["x-winplate-health-token"] === "string"
      ? request.headers["x-winplate-health-token"]
      : "";
    return headerToken === token;
  }

  async function handleRequest(request, response) {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    if (request.method === "GET" && url.pathname === "/health") {
      jsonResponse(response, 200, { status: "ok" });
      return;
    }

    if (url.pathname === "/api/health/status" && request.method === "GET") {
      if (!authorized(url, request)) {
        jsonResponse(response, 401, { detail: "invalid pairing token" });
        return;
      }
      jsonResponse(response, 200, getStatus());
      return;
    }

    if (url.pathname === "/api/health/sync" && request.method === "POST") {
      if (!authorized(url, request)) {
        jsonResponse(response, 401, { detail: "invalid pairing token" });
        return;
      }
      try {
        const rawBody = await readBody(request);
        const payload = normalizeHealthPayload(JSON.parse(rawBody));
        const currentSentAt = snapshot?.sentAt ? Date.parse(snapshot.sentAt) : null;
        const incomingSentAt = Date.parse(payload.sentAt);

        if (payload.snapshotId && payload.snapshotId === lastSnapshotId) {
          lastError = null;
          jsonResponse(response, 200, {
            ok: true,
            duplicate: true,
            receivedAt: lastReceivedAt
          });
          notify();
          return;
        }

        if (Number.isFinite(currentSentAt) && Number.isFinite(incomingSentAt) && incomingSentAt < currentSentAt) {
          jsonResponse(response, 200, {
            ok: true,
            ignored: "older",
            receivedAt: lastReceivedAt
          });
          return;
        }

        lastError = null;
        snapshot = payload;
        lastSnapshotId = payload.snapshotId;
        lastReceivedAt = new Date(now()).toISOString();
        const nextHeartRateHistory = mergeHeartRateHistory(heartRateHistory, payload, now());
        if (JSON.stringify(nextHeartRateHistory) !== JSON.stringify(heartRateHistory)) {
          heartRateHistory = nextHeartRateHistory;
          persistHeartRateHistory();
        }
        jsonResponse(response, 200, { ok: true, receivedAt: lastReceivedAt });
        notify();
      } catch (error) {
        lastError = error.message;
        jsonResponse(response, error.statusCode || 400, { detail: error.message });
        notify();
      }
      return;
    }

    jsonResponse(response, 404, { detail: "not found" });
  }

  async function start() {
    if (server) return getStatus();
    await loadHeartRateHistory();
    server = http.createServer((request, response) => {
      handleRequest(request, response).catch((error) => {
        lastError = error.message;
        jsonResponse(response, 500, { detail: "health sync server error" });
        notify();
      });
    });
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        server?.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server?.off("error", onError);
        const address = server.address();
        boundPort = typeof address === "object" && address ? address.port : boundPort;
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(boundPort, host);
    });
    lastError = null;
    notify();
    return getStatus();
  }

  async function stop() {
    if (server) {
      const currentServer = server;
      server = null;
      await new Promise((resolve) => currentServer.close(() => resolve()));
    }
    await historyWrite.catch(() => {});
  }

  return {
    start,
    stop,
    getStatus,
    normalizeHealthPayload,
    setDesktopStatusSnapshot
  };
}

function buildHealthPairingPayload(url, token) {
  if (typeof url !== "string" || !url || typeof token !== "string" || !token) {
    throw new Error("health pairing payload requires a url and token");
  }
  const parsed = new URL(url);
  const port = parsed.port || String(DEFAULT_HEALTH_SYNC_PORT);
  return `winplate://${parsed.hostname}:${port}#${token}`;
}

function parseHealthPairingPayload(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;
  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length >= 2) {
    const first = parseHealthPairingPayload(lines[0]);
    if (first) {
      return {
        endpoint: first.endpoint,
        token: first.token || lines[1]
      };
    }
  }

  const candidate = trimmed.includes("://") ? trimmed : `http://${trimmed}`;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  const scheme = parsed.protocol.replace(":", "").toLowerCase();
  if (!["http", "https", "winplate"].includes(scheme) || !parsed.hostname) return null;
  const port = parsed.port || (scheme === "https" ? "443" : String(DEFAULT_HEALTH_SYNC_PORT));
  const token = decodeURIComponent((parsed.hash || "").replace(/^#/, "") || parsed.searchParams.get("token") || "");
  return {
    endpoint: `http://${parsed.hostname}:${port}/api/health/sync`,
    token
  };
}

module.exports = {
  DEFAULT_HEALTH_SYNC_PORT,
  HEART_RATE_HISTORY_FILE_NAME,
  HEART_RATE_HISTORY_WINDOW_MS,
  MAX_HEART_RATE_HISTORY_POINTS,
  HEALTH_SYNC_SCHEMA_VERSION,
  SUPPORTED_HEALTH_SYNC_SCHEMA_VERSIONS,
  STALE_AFTER_MS,
  buildHealthPairingPayload,
  buildMetricFreshness,
  createHealthSyncServer,
  getLanIPv4Addresses,
  mergeHeartRateHistory,
  normalizeHeartRateHistory,
  normalizeHealthPayload,
  normalizeDesktopStatusSnapshot,
  parseHealthPairingPayload
};
