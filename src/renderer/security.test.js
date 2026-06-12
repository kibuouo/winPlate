const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

test("content security policy permits GitHub avatar images", () => {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");

  assert.match(
    html,
    /img-src[^;]*https:\/\/avatars\.githubusercontent\.com/,
    "GitHub avatar CDN must be allowed by the renderer CSP"
  );
});
