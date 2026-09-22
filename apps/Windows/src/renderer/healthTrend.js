(function initHealthTrend(globalScope, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.WinPlateHealthTrend = api;
})(typeof window !== "undefined" ? window : globalThis, () => {
  function heartRateRange(historyApi, range = "day") {
    return historyApi.heartRateRange(range);
  }

  function heartRateSamples(historyApi, history, range = "day", nowTimestamp = Date.now()) {
    return historyApi.filterHeartRateHistory(history, {
      range,
      nowTimestamp
    });
  }

  function heartRateStats(historyApi, samples) {
    return historyApi.heartRateStats(samples);
  }

  function axisBounds(stats) {
    if (!stats) return { minimum: 60, maximum: 100 };
    let minimum = Math.max(0, Math.floor((stats.minimum - 10) / 10) * 10);
    let maximum = Math.ceil((stats.maximum + 10) / 10) * 10;
    if (maximum - minimum < 20) {
      const midpoint = (minimum + maximum) / 2;
      minimum = Math.max(0, Math.floor((midpoint - 10) / 10) * 10);
      maximum = Math.ceil((midpoint + 10) / 10) * 10;
    }
    return { minimum, maximum };
  }

  function axisLabel(value, range) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    if (range === "week") return `${date.getMonth() + 1}/${date.getDate()}`;
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }

  function chartPoints(
    samples,
    {
      range = "day",
      nowTimestamp = Date.now(),
      plotOriginX = 42,
      plotWidth = 514,
      plotHeight = 132,
      minimum = 60,
      maximum = 100
    } = {},
    { historyApi, metric } = {}
  ) {
    const rangeConfig = heartRateRange(historyApi, range);
    const nowMs = Number.isFinite(Number(nowTimestamp)) ? Number(nowTimestamp) : Date.now();
    const start = nowMs - rangeConfig.windowMs;
    const valueRange = Math.max(1, maximum - minimum);
    return (Array.isArray(samples) ? samples : []).map((sample) => {
      const timestamp = Date.parse(sample.sampleAt);
      const timeRatio = Math.min(1, Math.max(0, (timestamp - start) / rangeConfig.windowMs));
      const value = Number(sample.heartRate);
      const valueRatio = Math.min(1, Math.max(0, (value - minimum) / valueRange));
      return {
        x: plotOriginX + plotWidth * timeRatio,
        y: plotHeight * (1 - valueRatio),
        heartRate: value,
        sampleAt: sample.sampleAt,
        label: `${axisLabel(sample.sampleAt, range)} · ${metric(value)} BPM`
      };
    });
  }

  function downsample(samples, limit = 48) {
    const list = Array.isArray(samples) ? samples : [];
    if (list.length <= limit) {
      return list.map((sample) => ({
        sampleAt: sample.sampleAt,
        heartRate: sample.heartRate
      }));
    }
    const lastIndex = list.length - 1;
    const picked = [];
    for (let index = 0; index < limit; index += 1) {
      const sourceIndex = index === limit - 1
        ? lastIndex
        : Math.round((index / (limit - 1)) * lastIndex);
      const point = list[sourceIndex];
      if (!point) continue;
      const previous = picked.at(-1);
      if (previous && previous.sampleAt === point.sampleAt) continue;
      picked.push({
        sampleAt: point.sampleAt,
        heartRate: point.heartRate
      });
    }
    return picked;
  }

  return Object.freeze({
    heartRateRange,
    heartRateSamples,
    heartRateStats,
    axisBounds,
    axisLabel,
    chartPoints,
    downsample
  });
});
