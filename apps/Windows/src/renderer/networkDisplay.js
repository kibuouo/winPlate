(function initNetworkDisplay(globalScope, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.WinPlateNetworkDisplay = api;
})(typeof window !== "undefined" ? window : globalThis, () => {
  function formatSpeedCompact(bytesPerSecond) {
    const value = Number(bytesPerSecond);
    if (!Number.isFinite(value) || value < 0) return "---";
    const kb = value / 1024;
    if (kb < 1) return "0K";
    if (kb < 1000) return `${Math.round(kb)}K`;
    const mb = kb / 1024;
    return `${mb.toFixed(mb >= 10 ? 0 : 1)}M`;
  }

  function formatSpeedFull(bytesPerSecond) {
    const value = Number(bytesPerSecond);
    if (!Number.isFinite(value) || value < 0) return "---";
    const kb = value / 1024;
    if (kb < 1) return "0 KB/s";
    if (kb < 1000) return `${Math.round(kb)} KB/s`;
    const mb = kb / 1024;
    return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB/s`;
  }

  function formatNetworkSpeed(bytesPerSecond, compact = true) {
    return compact ? formatSpeedCompact(bytesPerSecond) : formatSpeedFull(bytesPerSecond);
  }

  function formatLatency(latencyMs) {
    const value = Number(latencyMs);
    if (!Number.isFinite(value) || value < 0) return "---";
    return `${Math.round(value)}ms`;
  }

  function networkStatusKind(status, downloadBytesPerSecond = 0, uploadBytesPerSecond = 0) {
    if (status === "获取失败" || status === "无连接") return "error";
    if (status === "网络弱" || status === "延迟高" || status === "API 不稳定") return "warning";
    const download = Number(downloadBytesPerSecond) || 0;
    const upload = Number(uploadBytesPerSecond) || 0;
    if (download < 1024 && upload < 1024) return "idle";
    return "normal";
  }

  return Object.freeze({
    formatSpeedCompact,
    formatSpeedFull,
    formatNetworkSpeed,
    formatLatency,
    networkStatusKind
  });
});
