const test = require("node:test");
const assert = require("node:assert/strict");
const {
  canonicalAlertColor,
  classifyWeatherAlert,
  weatherAlertColor,
  weatherDisplaySeverity,
  weatherStorageLevel
} = require("./weather");

test("maps QWeather severity tokens onto canonical alert colors", () => {
  assert.equal(canonicalAlertColor("extreme"), "red");
  assert.equal(canonicalAlertColor("red"), "red");
  assert.equal(canonicalAlertColor("severe"), "yellow");
  assert.equal(canonicalAlertColor("orange"), "yellow");
  assert.equal(canonicalAlertColor("amber"), "yellow");
  assert.equal(canonicalAlertColor("moderate"), "yellow");
  assert.equal(canonicalAlertColor("yellow"), "yellow");
  assert.equal(canonicalAlertColor("minor"), "blue");
  assert.equal(canonicalAlertColor("blue"), "blue");
  assert.equal(canonicalAlertColor("green"), "green");
  assert.equal(canonicalAlertColor("unknown"), null);
});

test("QWeather severe stays warning, never display danger", () => {
  const orange = classifyWeatherAlert({
    source: "qweather",
    title: "高温橙色预警",
    metadata: { severity: "severe", lifecycle: "issued" }
  });
  assert.deepEqual(orange, { alertColor: "yellow", level: "warning", severity: "warning" });
  assert.equal(weatherDisplaySeverity("yellow"), "warning");
  assert.equal(weatherStorageLevel("red"), "critical");
  assert.equal(weatherDisplaySeverity("red"), "danger");
});

test("blue Chinese titles and minor tokens are informational", () => {
  assert.deepEqual(
    classifyWeatherAlert({ source: "qweather", title: "大风蓝色预警", level: "warning" }),
    { alertColor: "blue", level: "info", severity: "info" }
  );
  assert.deepEqual(
    classifyWeatherAlert({
      source: "qweather",
      title: "大风预警",
      metadata: { severity: "minor", lifecycle: "issued" }
    }),
    { alertColor: "blue", level: "info", severity: "info" }
  );
});

test("title color beats a conflicting CAP severity token", () => {
  assert.equal(weatherAlertColor({
    source: "qweather",
    title: "大风蓝色预警",
    metadata: { severity: "moderate" }
  }), "blue");
  assert.equal(weatherAlertColor({
    source: "qweather",
    title: "暴雨红色预警",
    metadata: { severity: "severe" }
  }), "red");
});
