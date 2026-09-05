const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const state = require("./weatherState");
const source = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function harness() {
  const context = {
    window: { WinPlateWeatherState: state, winplate: {} },
    navigator: {}, console,
    statusData: { weather: { locationQuery: "old", temperature: 1 } },
    mockStatus: { weather: {} },
    weatherRequests: state.createRequests(), weatherUpdateVersion: 0,
    weatherAlertRequestVersion: 0, weatherAlerts: state.normalizeAlerts(),
    locationWeatherPromise: null, weatherLocationLastSyncedPreference: null,
    selectedWeatherLocationOption: () => context.option,
    option: { id: "A", latitude: 1, longitude: 2 },
    normalizeWeatherAlerts: state.normalizeAlerts
  };
  vm.createContext(context);
  vm.runInContext([
    section("function beginWeatherLocationChange()", "const themeMedia"),
    section("async function refreshSelectedWeatherLocation(", "function bindMailControls()"),
    section("async function refreshQWeatherAlerts()", "async function hydrateMail(")
  ].join("\n"), context);
  return context;
}

test("late A response cannot overwrite B, and completed location promises are released", async () => {
  const ctx = harness();
  const a = deferred(), b = deferred();
  ctx.window.winplate.setWeatherLocation = ({ latitude }) => latitude === 1 ? a.promise : b.promise;
  const first = ctx.refreshSelectedWeatherLocation({ force: true });
  ctx.option = { id: "B", latitude: 3, longitude: 4 };
  const second = ctx.refreshSelectedWeatherLocation({ force: true });
  b.resolve({ locationQuery: "B", temperature: 20 });
  await second;
  a.resolve({ locationQuery: "A", temperature: 10 });
  assert.equal(await first, null);
  assert.equal(ctx.statusData.weather.locationQuery, "B");
  assert.equal(ctx.weatherLocationLastSyncedPreference, "B");
  assert.equal(ctx.locationWeatherPromise, null);
});

test("late automatic geolocation cannot write after a manual selection", async () => {
  const ctx = harness();
  let locate;
  const calls = [];
  ctx.navigator.geolocation = { getCurrentPosition(resolve) { locate = resolve; } };
  ctx.window.winplate.setWeatherLocation = async (coordinates) => {
    calls.push(coordinates);
    return { locationQuery: "manual" };
  };
  const automatic = ctx.refreshSelectedWeatherLocation({ force: true, allowSystem: true });
  await ctx.refreshSelectedWeatherLocation({ force: true });
  locate({ coords: { latitude: 30, longitude: 40 } });
  assert.equal(await automatic, null);
  assert.equal(calls.length, 1);
  assert.equal(ctx.statusData.weather.locationQuery, "manual");
});

test("alert response from an old location is discarded after switching", async () => {
  const ctx = harness();
  const old = deferred();
  const pending = ctx.loadWeatherAlerts(() => old.promise);
  ctx.beginWeatherLocationChange();
  old.resolve({ alerts: [{ id: "old" }], availability: "active", locationQuery: "old" });
  await pending;
  assert.equal(ctx.weatherAlerts.alerts.length, 0);
  assert.equal(ctx.weatherAlerts.availability, "unavailable");
});

test("empty, unconfigured and failed alerts stay distinct; stale and wrong-location alerts never appear active", () => {
  const now = Date.now();
  const active = state.normalizeAlerts({ alerts: [{ id: "red" }], locationQuery: "A", updatedAt: now });
  assert.equal(state.normalizeAlerts({ alerts: [] }).availability, "empty");
  assert.equal(state.normalizeAlerts({ availability: "unconfigured", error: "JWT" }).availability, "unconfigured");
  assert.equal(state.failedAlerts({}, new Error("offline")).availability, "unavailable");
  const failed = state.failedAlerts(active, new Error("offline"));
  assert.equal(failed.availability, "stale");
  assert.equal(failed.alerts.length, 1);
  assert.equal(state.activeAlerts(active, { locationQuery: "A" }, now).length, 1);
  for (const [value, weather, time] of [
    [failed, { locationQuery: "A" }, now],
    [active, { locationQuery: "B" }, now],
    [active, { locationQuery: "A" }, now + 600001]
  ]) assert.equal(state.activeAlerts(value, weather, time).length, 0);
});

function statusHarness() {
  const ctx = harness();
  Object.assign(ctx, {
    weatherStatusRequestVersion: 0,
    moduleEnabled: () => true,
    applyHealthSyncStatus() {}, hydrateQWeatherUsage: async () => {},
    updateCurrentViewDom() {}, scheduleDesktopStatusPublish() {}
  });
  ctx.option = { id: "auto" };
  ctx.window.winplate.refreshQWeatherAlerts = async () => ({ alerts: [] });
  vm.runInContext(section("async function refreshBackendStatus(", "async function refreshGithubData("), ctx);
  return ctx;
}

test("an in-flight forced refresh cannot replace a newly selected location", async () => {
  const ctx = statusHarness();
  const old = deferred();
  ctx.window.winplate.refreshWeather = () => old.promise;
  ctx.window.winplate.getStatus = async () => ({ weather: { locationQuery: "A" } });
  const pending = ctx.refreshBackendStatus({ force: true });
  const token = ctx.beginWeatherLocationChange();
  ctx.applyLocatedWeather({ locationQuery: "B", temperature: 22 }, token);
  ctx.weatherRequests.finish(token);
  old.resolve({ locationQuery: "A", temperature: 10 });
  await pending;
  assert.equal(ctx.statusData.weather.locationQuery, "B");
});

test("forced refresh failure cannot be hidden by a successful cached status read", async () => {
  const ctx = statusHarness();
  ctx.window.winplate.refreshWeather = async () => { throw new Error("offline"); };
  ctx.window.winplate.getStatus = async () => ({ weather: { source: "qweather", locationQuery: "A", temperature: 22 } });
  await assert.rejects(ctx.refreshBackendStatus({ force: true }), /offline/);
  assert.equal(ctx.statusData.weather.availability, "stale");
  assert.equal(ctx.statusData.weather.temperature, 22);
});

test("rejected location requests release pending state and can be retried", async () => {
  const ctx = harness();
  ctx.window.winplate.setWeatherLocation = async () => { throw new Error("offline"); };
  await assert.rejects(ctx.refreshSelectedWeatherLocation(), /offline/);
  assert.equal(ctx.locationWeatherPromise, null);
  assert.equal(ctx.weatherRequests.pending, false);
  ctx.window.winplate.setWeatherLocation = async () => ({ locationQuery: "A" });
  assert.equal((await ctx.refreshSelectedWeatherLocation()).locationQuery, "A");
});

test("failed switch clears the previous city's readings instead of presenting them for the new city", async () => {
  const ctx = harness();
  ctx.statusData.weather = { locationQuery: "old", source: "qweather", temperature: 25 };
  ctx.window.winplate.setWeatherLocation = async () => { throw new Error("offline"); };
  await assert.rejects(ctx.refreshSelectedWeatherLocation(), /offline/);
  assert.equal(ctx.statusData.weather.locationQuery, "2.00,1.00");
  assert.equal(ctx.statusData.weather.availability, "empty");
  assert.equal(ctx.statusData.weather.temperature, undefined);
});

test("failed same-location request preserves readings as stale", async () => {
  const ctx = harness();
  ctx.statusData.weather = { locationQuery: "2.00,1.00", source: "qweather", temperature: 25 };
  ctx.window.winplate.setWeatherLocation = async () => { throw new Error("offline"); };
  await assert.rejects(ctx.refreshSelectedWeatherLocation(), /offline/);
  assert.equal(ctx.statusData.weather.availability, "stale");
  assert.equal(ctx.statusData.weather.temperature, 25);
});

test("failed selected-city synchronization does not fall back to a different saved city", async () => {
  const ctx = statusHarness();
  ctx.option = { id: "B", latitude: 3, longitude: 4 };
  ctx.window.winplate.setWeatherLocation = async () => { throw new Error("offline"); };
  ctx.window.winplate.getStatus = async () => { throw new Error("must not read old city's status"); };
  await assert.rejects(ctx.refreshBackendStatus(), /offline/);
  assert.equal(ctx.statusData.weather.locationQuery, "4.00,3.00");
});

test("an empty alert result confirms no alerts only for its own location and while fresh", () => {
  const now = Date.now();
  const empty = state.normalizeAlerts({ alerts: [], updatedAt: now, locationQuery: "A" });
  assert.equal(state.alertsAreCurrent(empty, { locationQuery: "A" }, now), true);
  assert.equal(state.alertsAreCurrent(empty, { locationQuery: "B" }, now), false);
  assert.equal(state.alertsAreCurrent(empty, { locationQuery: "A" }, now + 600001), false);
});
