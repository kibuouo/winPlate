const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

test("weather settings fields fit the default window content width", () => {
  const styles = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");

  assert.match(
    styles,
    /\.weather-settings-panel label\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(260px,\s*48%\);/
  );
  assert.match(styles, /\.weather-settings-panel label > \*\s*\{\s*min-width:\s*0;\s*\}/);
});
