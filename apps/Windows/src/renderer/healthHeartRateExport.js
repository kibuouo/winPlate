(function initHealthHeartRateExport(globalScope, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.WinPlateHealthHeartRateExport = api;
})(typeof window !== "undefined" ? window : globalThis, () => {
  const CSV_HEADERS = ["采样时间", "心率 (BPM)"];

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

  function downloadTextFile({ content, filename, documentRef = typeof document !== "undefined" ? document : null } = {}) {
    const text = String(content ?? "");
    const name = String(filename || "export.csv").trim() || "export.csv";
    if (!text || !documentRef?.createElement || typeof documentRef.body?.appendChild !== "function") {
      return false;
    }

    const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = documentRef.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.style.display = "none";
    documentRef.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    return true;
  }

  return Object.freeze({
    CSV_HEADERS,
    escapeCsvField,
    buildHeartRateExportFilename,
    buildHeartRateCsv,
    downloadTextFile
  });
});
