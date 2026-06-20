const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);
const SAMPLE_MAX_AGE_MS = 15_000;
const MIN_SAMPLE_INTERVAL_MS = 500;
const SMOOTHING_ALPHA = 0.45;
const PING_TARGETS = ["1.1.1.1", "223.5.5.5", "114.114.114.114"];
const PING_TIMEOUT_MS = 1200;
const HIGH_LATENCY_MS = 150;

let previousSample = null;
let smoothedDownload = 0;
let smoothedUpload = 0;

function emptySpeed(status = "获取失败", error = "") {
  return {
    downloadBytesPerSecond: null,
    uploadBytesPerSecond: null,
    latencyMs: null,
    status,
    error,
    updatedAt: Date.now()
  };
}

function normalizeLatencyMs(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.round(number);
}

function networkStatusFromLatency(latencyMs) {
  return latencyMs !== null && latencyMs >= HIGH_LATENCY_MS ? "延迟高" : "正常";
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

  const latencyMs = normalizeLatencyMs(current.latencyMs);
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
      latencyMs,
      status: networkStatusFromLatency(latencyMs),
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
      latencyMs,
      status: networkStatusFromLatency(latencyMs),
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
    latencyMs,
    status: networkStatusFromLatency(latencyMs),
    updatedAt: now
  };
}

async function readWindowsLatencyMs(exec = execFileAsync) {
  const targetList = PING_TARGETS.map((target) => `'${target}'`).join(", ");
  const script = `
$targets = @(${targetList})
foreach ($target in $targets) {
  try {
    $result = Test-Connection -ComputerName $target -Count 1 -ErrorAction Stop
    if ($null -ne $result -and $result.StatusCode -eq 0 -and $null -ne $result.ResponseTime) {
      [PSCustomObject]@{
        Target = $target
        ResponseTime = [int]$result.ResponseTime
      } | ConvertTo-Json -Compress
      exit 0
    }
  } catch {
  }
}
`.trim();
  try {
    const { stdout } = await exec("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-Command", script
    ], { windowsHide: true, timeout: PING_TIMEOUT_MS * PING_TARGETS.length + 1200, maxBuffer: 1024 * 64 });
    const payload = stdout ? JSON.parse(stdout) : null;
    return normalizeLatencyMs(payload?.ResponseTime);
  } catch {
    return null;
  }
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
    const [totals, latencyMs] = await Promise.all([
      readWindowsAdapterTotals(),
      readWindowsLatencyMs()
    ]);
    return calculateRate({ ...totals, latencyMs });
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
  normalizeLatencyMs,
  readNetworkSpeed,
  readWindowsLatencyMs,
  resetNetworkSpeedState
};
