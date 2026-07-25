const test = require("node:test");
const assert = require("node:assert/strict");

const {
  SCENE_ICON_CODES,
  WEATHER_SCENE_ASSETS,
  sceneForWeather,
  effectProfile
} = require("./weatherScenes");

test("QWeather icon codes select the matching animated weather scene", () => {
  for (const [scene, iconCodes] of Object.entries(SCENE_ICON_CODES)) {
    for (const icon of iconCodes) {
      assert.equal(sceneForWeather({ source: "qweather", icon }), scene, `${icon} should use ${scene}`);
    }
  }
});

test("weather scenes fall back to condition text and stay neutral when unavailable", () => {
  assert.equal(sceneForWeather({ source: "qweather", condition: "强雷阵雨" }), "storm");
  assert.equal(sceneForWeather({ source: "qweather", condition: "中雪" }), "snow");
  assert.equal(sceneForWeather({ source: "qweather", condition: "重度霾" }), "haze");
  assert.equal(sceneForWeather({ source: "unconfigured", icon: "100", condition: "晴" }), "unknown");
});

test("weather effect profile derives motion from QWeather live fields", () => {
  const profile = effectProfile({
    source: "qweather",
    icon: "305",
    precipitation: 0.1,
    precipitationProbability: 40,
    minutelyPrecipitation: [{ precipitation: 0.62 }],
    cloudCover: 84,
    windSpeed: 18,
    windDegrees: 135,
    humidity: 81,
    visibility: 8,
    airQuality: { aqi: 32 }
  });

  assert.equal(profile.scene, "rain");
  assert.equal(profile.asset, "storm.webp");
  assert.equal(profile.intensity, 1);
  assert.equal(profile.cloudCover, 84);
  assert.equal(profile.windSpeed, 18);
  assert.equal(profile.windDegrees, 135);
  assert.ok(profile.haze > 0);
});

test("every visual scene uses a bundled local background asset", () => {
  assert.equal(WEATHER_SCENE_ASSETS["clear-day"], "clear-day.webp");
  assert.equal(WEATHER_SCENE_ASSETS["clear-night"], "clear-night.webp");
  assert.equal(WEATHER_SCENE_ASSETS.storm, "storm.webp");
  assert.equal(WEATHER_SCENE_ASSETS.snow, "snow-mist.webp");
});
