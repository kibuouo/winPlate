(function initSvgChartGeometry(globalScope, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.WinPlateSvgChartGeometry = api;
})(typeof window !== "undefined" ? window : globalThis, () => {
  function numberOr(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function viewBoxMetrics(rect, viewBox) {
    const width = numberOr(rect?.width);
    const height = numberOr(rect?.height);
    const viewBoxWidth = numberOr(viewBox?.width);
    const viewBoxHeight = numberOr(viewBox?.height);
    if (width <= 0 || height <= 0 || viewBoxWidth <= 0 || viewBoxHeight <= 0) return null;

    const scale = Math.min(width / viewBoxWidth, height / viewBoxHeight);
    return {
      scale,
      offsetX: (width - viewBoxWidth * scale) / 2,
      offsetY: (height - viewBoxHeight * scale) / 2,
      viewBoxX: numberOr(viewBox?.x),
      viewBoxY: numberOr(viewBox?.y)
    };
  }

  function clientToSvgPoint(clientX, clientY, rect, viewBox) {
    const metrics = viewBoxMetrics(rect, viewBox);
    if (!metrics) return { x: 0, y: 0 };
    return {
      x: metrics.viewBoxX + (numberOr(clientX) - numberOr(rect?.left) - metrics.offsetX) / metrics.scale,
      y: metrics.viewBoxY + (numberOr(clientY) - numberOr(rect?.top) - metrics.offsetY) / metrics.scale
    };
  }

  function svgPointToClient(svgX, svgY, rect, viewBox) {
    const metrics = viewBoxMetrics(rect, viewBox);
    if (!metrics) return { x: numberOr(rect?.left), y: numberOr(rect?.top) };
    return {
      x: numberOr(rect?.left) + metrics.offsetX + (numberOr(svgX) - metrics.viewBoxX) * metrics.scale,
      y: numberOr(rect?.top) + metrics.offsetY + (numberOr(svgY) - metrics.viewBoxY) * metrics.scale
    };
  }

  return Object.freeze({ viewBoxMetrics, clientToSvgPoint, svgPointToClient });
});
