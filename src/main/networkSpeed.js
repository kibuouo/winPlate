const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);
const SAMPLE_MAX_AGE_MS = 15_000;
const MIN_SAMPLE_INTERVAL_MS = 500;
const SMOOTHING_ALPHA = 0.45;

let previousSample = null;
let smoothedDownload = 0;
let smoothedUpload = 0;

function emptySpeed(status = "获取失败", error = "") {
  return {
    downloadBytesPerSecond: null,
    uploadBytesPerSecond: null,
    status,
    error,
    updatedAt: Date.now()
  };
}

function normalizeAdapterRows(payload) {
  if (!payload) return [];
  const rows = Array.isArray(payload) ? payload : [payload];
  return rows.map((row) => ({
    name: String(row.Name || ""),
    status: String(row.Status || ""),
    hardwareInterface: row.HardwareInterface === true || String(row.HardwareInterface).toLowerCase() === "true",
    interfaceDescription: String(row.InterfaceDescription || ""),
    receivedBytes: Number(row.ReceivedBytes),
    sentBytes: Number(row.SentBytes)
  })).filter((row) => (
    row.name
    && Number.isFinite(row.receivedBytes)
    && Number.isFinite(row.sentBytes)
  ));
}

function chooseEffectiveAdapters(rows) {
  const upRows = rows.filter((row) => row.status.toLowerCase() === "up");
  const physicalRows = upRows.filter((row) => (
    row.hardwareInterface
    && !/loopback/i.test(row.name)
    && !/loopback/i.test(row.interfaceDescription)
  ));
  return physicalRows.length ? physicalRows : upRows.filter((row) => (
    !/loopback/i.test(row.name)
    && !/loopback/i.test(row.interfaceDescription)
  ));
}

function calculateRate(current, previous = previousSample, now = Date.now()) {
  if (!current?.adapters?.length) {
    previousSample = null;
    return emptySpeed("无连接");
  }

  const receivedBytes = current.adapters.reduce((sum, row) => sum + row.receivedBytes, 0);
  const sentBytes = current.adapters.reduce((sum, row) => sum + row.sentBytes, 0);
  const sample = { receivedBytes, sentBytes, timestamp: now };
  previousSample = sample;

  if (!previous) {
    smoothedDownload = 0;
    smoothedUpload = 0;
    return {
      downloadBytesPerSecond: 0,
      uploadBytesPerSecond: 0,
      status: "正常",
      updatedAt: now
    };
  }

  const elapsedMs = now - previous.timestamp;
  if (elapsedMs < MIN_SAMPLE_INTERVAL_MS || elapsedMs > SAMPLE_MAX_AGE_MS) {
    smoothedDownload = 0;
    smoothedUpload = 0;
    return {
      downloadBytesPerSecond: 0,
      uploadBytesPerSecond: 0,
      status: "正常",
      updatedAt: now
    };
  }

  const elapsedSeconds = elapsedMs / 1000;
  const rawDownload = Math.max(0, (receivedBytes - previous.receivedBytes) / elapsedSeconds);
  const rawUpload = Math.max(0, (sentBytes - previous.sentBytes) / elapsedSeconds);
  smoothedDownload = smoothedDownload
    ? smoothedDownload * (1 - SMOOTHING_ALPHA) + rawDownload * SMOOTHING_ALPHA
    : rawDownload;
  smoothedUpload = smoothedUpload
    ? smoothedUpload * (1 - SMOOTHING_ALPHA) + rawUpload * SMOOTHING_ALPHA
    : rawUpload;

  return {
    downloadBytesPerSecond: Math.round(smoothedDownload),
    uploadBytesPerSecond: Math.round(smoothedUpload),
    status: "正常",
    updatedAt: now
  };
}

async function readWindowsAdapterTotals() {
  const script = `
$rows = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' } | ForEach-Object {
  $stats = Get-NetAdapterStatistics -Name $_.Name
  [PSCustomObject]@{
    Name = $_.Name
    Status = $_.Status
    HardwareInterface = $_.HardwareInterface
    InterfaceDescription = $_.InterfaceDescription
    ReceivedBytes = [double]$stats.ReceivedBytes
    SentBytes = [double]$stats.SentBytes
  }
}
$rows | ConvertTo-Json -Compress
`.trim();
  const { stdout } = await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-Command", script
  ], { windowsHide: true, timeout: 4000, maxBuffer: 1024 * 256 });
  const rows = normalizeAdapterRows(JSON.parse(stdout || "[]"));
  return { adapters: chooseEffectiveAdapters(rows) };
}

async function readNetworkSpeed() {
  if (process.platform !== "win32") {
    return emptySpeed("获取失败", "Network speed is only implemented for Windows");
  }
  try {
    return calculateRate(await readWindowsAdapterTotals());
  } catch (error) {
    return emptySpeed("获取失败", error.message);
  }
}

function resetNetworkSpeedState() {
  previousSample = null;
  smoothedDownload = 0;
  smoothedUpload = 0;
}

module.exports = {
  calculateRate,
  chooseEffectiveAdapters,
  normalizeAdapterRows,
  readNetworkSpeed,
  resetNetworkSpeedState
};
