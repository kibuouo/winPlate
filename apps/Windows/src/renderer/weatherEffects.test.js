const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MAX_CANVAS_WIDTH,
  MAX_CANVAS_HEIGHT,
  MAX_PARTICLES,
  MAX_DROPLETS,
  canvasBitmapSize,
  particleBudget,
  dropletBudget,
  effectSignature,
  sceneNeedsAnimation
} = require("./weatherEffects");

test("weather canvas bitmaps stay within a fixed memory budget", () => {
  const huge = canvasBitmapSize(12_000, 8_000, 3);
  assert.equal(huge.cssWidth, MAX_CANVAS_WIDTH);
  assert.equal(huge.cssHeight, MAX_CANVAS_HEIGHT);
  assert.equal(huge.pixelRatio, 1);
  assert.ok(huge.bitmapWidth * huge.bitmapHeight <= MAX_CANVAS_WIDTH * MAX_CANVAS_HEIGHT);
  const same = canvasBitmapSize(320, 180, 1);
  assert.deepEqual(canvasBitmapSize(320, 180, 1), same);
});

test("weather particle counts stay capped even for storm intensity", () => {
  const storm = { scene: "storm", intensity: 1, density: 1, haze: 1 };
  assert.ok(particleBudget(storm) <= MAX_PARTICLES);
  assert.ok(dropletBudget(storm) <= MAX_DROPLETS);
  assert.equal(dropletBudget({ scene: "clear-day" }), 0);
});

test("weather effects remount only when scene or density changes", () => {
  const canvas = {
    dataset: { scene: "rain", density: "1", windSpeed: "12", humidity: "80" }
  };
  assert.equal(effectSignature(canvas), "rain|1");
  canvas.dataset.windSpeed = "40";
  canvas.dataset.humidity = "95";
  assert.equal(effectSignature(canvas), "rain|1");
  canvas.dataset.scene = "snow";
  assert.equal(effectSignature(canvas), "snow|1");
});

test("static weather scenes skip the animation loop", () => {
  assert.equal(sceneNeedsAnimation({ scene: "clear-day" }), false);
  assert.equal(sceneNeedsAnimation({ scene: "clear-night" }), false);
  assert.equal(sceneNeedsAnimation({ scene: "overcast" }), false);
  assert.equal(sceneNeedsAnimation({ scene: "unknown" }), false);
  assert.equal(sceneNeedsAnimation({ scene: "rain", intensity: 1, density: 1 }), true);
  assert.equal(sceneNeedsAnimation({ scene: "storm", intensity: 1, density: 1 }), true);
});
