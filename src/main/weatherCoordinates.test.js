const assert = require("node:assert/strict");
const test = require("node:test");

const { normalizeWeatherCoordinates } = require("./weatherCoordinates");

test("accepts coordinate boundaries and preserves latitude-longitude serialization order", () => {
  assert.equal(
    JSON.stringify(normalizeWeatherCoordinates({ latitude: "-90", longitude: "180" })),
    '{"latitude":-90,"longitude":180}'
  );
  assert.deepEqual(
    normalizeWeatherCoordinates({ latitude: 90, longitude: -180 }),
    { latitude: 90, longitude: -180 }
  );
});

test("rejects missing, non-finite, and out-of-range coordinates", () => {
  for (const location of [
    undefined,
    {},
    { latitude: NaN, longitude: 0 },
    { latitude: 0, longitude: Infinity },
    { latitude: -90.01, longitude: 0 },
    { latitude: 90.01, longitude: 0 },
    { latitude: 0, longitude: -180.01 },
    { latitude: 0, longitude: 180.01 }
  ]) {
    assert.throws(
      () => normalizeWeatherCoordinates(location),
      { message: "Invalid weather coordinates" }
    );
  }
});
