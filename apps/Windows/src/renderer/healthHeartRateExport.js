(function initHealthHeartRateExport(globalScope, factory) {
  const history = typeof module !== "undefined" && module.exports
    ? require("@winplate/core/health")
    : globalScope.WinPlateHealthHistory;
  const api = factory(history);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.WinPlateHealthHeartRateExport = api;
})(typeof window !== "undefined" ? window : globalThis, (history) => {
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
    CSV_HEADERS: history.CSV_HEADERS,
    escapeCsvField: history.escapeCsvField,
    buildHeartRateExportFilename: history.buildHeartRateExportFilename,
    buildHeartRateCsv: history.buildHeartRateCsv,
    downloadTextFile
  });
});
