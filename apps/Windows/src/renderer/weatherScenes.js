(function initWeatherScenes(globalScope, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.WinPlateWeatherScenes = api;
})(typeof window !== "undefined" ? window : globalThis, () => {
  const SCENE_ICON_CODES = Object.freeze({
    "clear-day": Object.freeze(["100"]),
    "clear-night": Object.freeze(["150"]),
    "cloud-day": Object.freeze(["101", "102", "103"]),
    "cloud-night": Object.freeze(["151", "152", "153"]),
    overcast: Object.freeze(["104"]),
    rain: Object.freeze([
      "300", "301", "305", "306", "307", "308", "309", "310", "311", "312",
      "314", "315", "316", "317", "318", "350", "351", "399"
    ]),
    storm: Object.freeze(["302", "303", "304"]),
    sleet: Object.freeze(["313", "404", "405", "406"]),
    snow: Object.freeze(["400", "401", "402", "403", "407", "408", "409", "410", "456", "457", "499"]),
    mist: Object.freeze(["500", "501", "509", "510", "514", "515"]),
    haze: Object.freeze(["502", "511", "512", "513"]),
    sand: Object.freeze(["503", "504", "507", "508"]),
    hot: Object.freeze(["900"]),
    cold: Object.freeze(["901"]),
    unknown: Object.freeze(["999"])
  });

  const ICON_SCENES = new Map(
    Object.entries(SCENE_ICON_CODES)
      .flatMap(([scene, codes]) => codes.map((code) => [code, scene]))
  );

  const WEATHER_SCENE_ASSETS = Object.freeze({
    "clear-day": "clear-day.webp",
    "cloud-day": "clear-day.webp",
    hot: "clear-day.webp",
    "clear-night": "clear-night.webp",
    "cloud-night": "clear-night.webp",
    overcast: "storm.webp",
    rain: "storm.webp",
    storm: "storm.webp",
    sleet: "storm.webp",
    sand: "storm.webp",
    haze: "snow-mist.webp",
    mist: "snow-mist.webp",
    snow: "snow-mist.webp",
    cold: "snow-mist.webp"
  });

  function finiteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clamp(value, minimum = 0, maximum = 1) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function sceneFromCondition(condition = "") {
    const label = String(condition).trim();
    if (/雷|电|冰雹/.test(label)) return "storm";
    if (/雨夹雪|冻雨|雨雪/.test(label)) return "sleet";
    if (/雪/.test(label)) return "snow";
    if (/雨/.test(label)) return "rain";
    if (/沙|尘/.test(label)) return "sand";
    if (/霾/.test(label)) return "haze";
    if (/雾/.test(label)) return "mist";
    if (/高温|炎热|热/.test(label)) return "hot";
    if (/低温|严寒|寒冷|冷/.test(label)) return "cold";
    if (/阴/.test(label)) return "overcast";
    if (/云/.test(label)) return "cloud-day";
    if (/晴/.test(label)) return "clear-day";
    return "unknown";
  }

  function sceneForWeather(weather = {}) {
    if (["unconfigured", "unavailable"].includes(String(weather.source || ""))) return "unknown";
    const icon = String(weather.icon || "").trim();
    return ICON_SCENES.get(icon) || sceneFromCondition(weather.condition);
  }

  function effectProfile(weather = {}) {
    const scene = sceneForWeather(weather);
    const minutely = Array.isArray(weather.minutelyPrecipitation) ? weather.minutelyPrecipitation : [];
    const minutelyPeak = minutely.reduce(
      (peak, point) => Math.max(peak, finiteNumber(point?.precipitation)),
      0
    );
    const precipitation = Math.max(finiteNumber(weather.precipitation), minutelyPeak);
    const probability = clamp(finiteNumber(weather.precipitationProbability) / 100);
    const sceneFloor = {
      rain: .34,
      storm: .72,
      sleet: .48,
      snow: .42,
      mist: .24,
      haze: .22,
      sand: .34,
      cold: .16,
      hot: .12
    }[scene] || 0;
    const intensity = clamp(Math.max(sceneFloor, precipitation * 1.7, probability * .68));
    const visibility = clamp(finiteNumber(weather.visibility, 20), 1, 50);
    const humidity = clamp(finiteNumber(weather.humidity, 50), 0, 100);
    const aqi = clamp(finiteNumber(weather.airQuality?.aqi), 0, 500);
    return Object.freeze({
      scene,
      asset: WEATHER_SCENE_ASSETS[scene] || "",
      intensity,
      cloudCover: clamp(finiteNumber(weather.cloudCover, ["clear-day", "clear-night"].includes(scene) ? 8 : 72), 0, 100),
      windSpeed: clamp(finiteNumber(weather.windSpeed, finiteNumber(weather.windScale) * 3), 0, 120),
      windDegrees: ((finiteNumber(weather.windDegrees) % 360) + 360) % 360,
      humidity,
      visibility,
      haze: clamp(Math.max((humidity - 72) / 38, (12 - visibility) / 12, aqi / 360)),
      aqi
    });
  }

  return { SCENE_ICON_CODES, WEATHER_SCENE_ASSETS, sceneForWeather, effectProfile };
});
