const assert = require("node:assert/strict");
const test = require("node:test");
const { clientToSvgPoint, svgPointToClient, viewBoxMetrics } = require("./svgChartGeometry");

const rect = { left: 100, top: 40, width: 1000, height: 116 };
const viewBox = { x: 0, y: 0, width: 560, height: 116 };

test("accounts for the centered meet viewport when converting pointer coordinates", () => {
  assert.deepEqual(viewBoxMetrics(rect, viewBox), {
    scale: 1,
    offsetX: 220,
    offsetY: 0,
    viewBoxX: 0,
    viewBoxY: 0
  });
  assert.deepEqual(clientToSvgPoint(320, 98, rect, viewBox), { x: 0, y: 58 });
  assert.deepEqual(clientToSvgPoint(880, 98, rect, viewBox), { x: 560, y: 58 });
});

test("converts chart coordinates back to their actual client position", () => {
  assert.deepEqual(svgPointToClient(0, 0, rect, viewBox), { x: 320, y: 40 });
  assert.deepEqual(svgPointToClient(560, 116, rect, viewBox), { x: 880, y: 156 });
});
