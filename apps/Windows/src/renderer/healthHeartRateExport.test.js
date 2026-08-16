const assert = require("node:assert/strict");
const test = require("node:test");
const {
  escapeCsvField,
  buildHeartRateExportFilename,
  buildHeartRateCsv,
  downloadTextFile
} = require("./healthHeartRateExport");

test("escapeCsvField quotes values that contain commas or quotes", () => {
  assert.equal(escapeCsvField("plain"), "plain");
  assert.equal(escapeCsvField('note, "resting"'), '"note, ""resting"""');
  assert.equal(escapeCsvField("line\nbreak"), '"line\nbreak"');
});

test("buildHeartRateCsv emits a header row and normalized sample rows", () => {
  const csv = buildHeartRateCsv([
    { sampleAt: "2026-08-16T04:00:00.000Z", heartRate: 72.4 },
    { sampleAt: "2026-08-16T05:00:00.000Z", heartRate: 84 },
    { sampleAt: "", heartRate: 90 },
    { sampleAt: "2026-08-16T06:00:00.000Z", heartRate: "not-a-number" }
  ], { rangeLabel: "7 天" });

  assert.match(csv, /^# WinPlate 心率导出 · 7 天 · 2 条采样/);
  assert.match(csv, /采样时间,心率 \(BPM\)/);
  assert.match(csv, /2026-08-16T04:00:00\.000Z,72/);
  assert.match(csv, /2026-08-16T05:00:00\.000Z,84/);
  assert.doesNotMatch(csv, /not-a-number/);
});

test("buildHeartRateExportFilename reflects the selected range", () => {
  const exportedAt = Date.parse("2026-08-16T05:30:00.000Z");
  assert.equal(
    buildHeartRateExportFilename("day", exportedAt),
    "winplate-heart-rate-24h-2026-08-16T05-30-00-000Z.csv"
  );
  assert.equal(
    buildHeartRateExportFilename("week", exportedAt),
    "winplate-heart-rate-7d-2026-08-16T05-30-00-000Z.csv"
  );
});

test("downloadTextFile creates a temporary anchor and revokes the blob URL", () => {
  const clicks = [];
  const revokes = [];
  const anchor = {
    href: "",
    download: "",
    style: { display: "" },
    click() { clicks.push(this.download); },
    remove() {}
  };
  const documentRef = {
    createElement(tag) {
      assert.equal(tag, "a");
      return anchor;
    },
    body: {
      appendChild(node) {
        assert.equal(node, anchor);
      }
    }
  };

  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  URL.createObjectURL = () => "blob:winplate-test";
  URL.revokeObjectURL = (url) => revokes.push(url);

  try {
    assert.equal(downloadTextFile({
      content: "a,b",
      filename: "winplate-heart-rate.csv",
      documentRef
    }), true);
    assert.deepEqual(clicks, ["winplate-heart-rate.csv"]);
    assert.equal(anchor.href, "blob:winplate-test");
    assert.deepEqual(revokes, ["blob:winplate-test"]);
    assert.equal(downloadTextFile({ content: "", filename: "x.csv", documentRef }), false);
  } finally {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  }
});
