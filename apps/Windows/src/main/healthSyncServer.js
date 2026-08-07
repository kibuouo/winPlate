const http = require("node:http");
const os = require("node:os");

const HEALTH_SYNC_SCHEMA_VERSION = 1;
const DEFAULT_HEALTH_SYNC_PORT = 8766;
const MAX_BODY_BYTES = 64 * 1024;
const STALE_AFTER_MS = 2 * 60 * 1000;

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

function normalizeHealthPayload(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("health payload must be an object");
  }
  if (Number(input.schemaVersion) !== HEALTH_SYNC_SCHEMA_VERSION) {
    throw new Error(`unsupported health schema version: ${input.schemaVersion}`);
  }
  if (typeof input.sender !== "string" || !input.sender.trim() || input.sender.length > 256) {
    throw new Error("sender is invalid");
  }
  if (typeof input.permissionGranted !== "boolean") {
    throw new Error("permissionGranted is invalid");
  }

  return {
    schemaVersion: HEALTH_SYNC_SCHEMA_VERSION,
    sender: input.sender.trim(),
    sentAt: parseDate(input.sentAt, "sentAt", { required: true }),
    healthUpdatedAt: parseDate(input.healthUpdatedAt, "healthUpdatedAt"),
    permissionGranted: input.permissionGranted,
    heartRate: optionalNumber(input.heartRate, "heartRate", { maximum: 300 }),
    stepCount: optionalNumber(input.stepCount, "stepCount"),
    activeEnergy: optionalNumber(input.activeEnergy, "activeEnergy")
  };
}

function jsonResponse(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
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
  onUpdate
} = {}) {
  if (typeof token !== "string" || token.trim().length < 16) {
    throw new Error("health sync pairing token is required");
  }

  let server = null;
  let boundPort = Number(port);
  let snapshot = null;
  let lastReceivedAt = null;
  let lastError = null;

  function connectionUrls() {
    const availableInterfaces = typeof networkInterfaces === "function"
      ? networkInterfaces()
      : networkInterfaces || os.networkInterfaces();
    const addresses = getLanIPv4Addresses(availableInterfaces);
    const usableAddresses = addresses.length ? addresses : ["127.0.0.1"];
    return usableAddresses.map((address) => (
      `http://${address}:${boundPort}/api/health/sync?token=${encodeURIComponent(token)}`
    ));
  }

  function getStatus() {
    const receivedTimestamp = lastReceivedAt ? Date.parse(lastReceivedAt) : null;
    const age = Number.isFinite(receivedTimestamp) ? Math.max(0, now() - receivedTimestamp) : null;
    const state = lastError
      ? "error"
      : !snapshot
        ? "waiting"
        : age !== null && age > STALE_AFTER_MS
          ? "stale"
          : "live";
    return {
      schemaVersion: HEALTH_SYNC_SCHEMA_VERSION,
      state,
      lastReceivedAt,
      error: lastError,
      snapshot,
      connectionUrls: connectionUrls()
    };
  }

  function notify() {
    onUpdate?.(getStatus());
  }

  function authorized(url, request) {
    const queryToken = url.searchParams.get("token");
    const headerToken = typeof request.headers["x-winplate-health-token"] === "string"
      ? request.headers["x-winplate-health-token"]
      : "";
    return queryToken === token || headerToken === token;
  }

  async function handleRequest(request, response) {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, X-WinPlate-Health-Token",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
      });
      response.end();
      return;
    }

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
        lastError = null;
        snapshot = payload;
        lastReceivedAt = new Date(now()).toISOString();
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
    if (!server) return;
    const currentServer = server;
    server = null;
    await new Promise((resolve) => currentServer.close(() => resolve()));
  }

  return {
    start,
    stop,
    getStatus,
    normalizeHealthPayload
  };
}

module.exports = {
  DEFAULT_HEALTH_SYNC_PORT,
  HEALTH_SYNC_SCHEMA_VERSION,
  STALE_AFTER_MS,
  createHealthSyncServer,
  getLanIPv4Addresses,
  normalizeHealthPayload
};
