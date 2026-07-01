const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CORE_ROOT = __dirname;
const FORBIDDEN_PATTERNS = [
  /\belectron\b/i,
  /\bnode:fs\b/i,
  /\bfs\/promises\b/i,
  /\bchild_process\b/i,
  /\bsqlite\b/i,
  /\bfastapi\b/i,
  /\bSwiftUI\b/,
  /\bAppKit\b/,
  /\bBrowserWindow\b/
];

function jsFilesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return jsFilesUnder(fullPath);
    return entry.isFile() && entry.name.endsWith(".js") ? [fullPath] : [];
  });
}

test("core sources do not reference platform-specific APIs or runtimes", () => {
  const violations = [];
  for (const filePath of jsFilesUnder(CORE_ROOT)) {
    if (filePath.endsWith(".test.js")) continue;
    const text = fs.readFileSync(filePath, "utf8");
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(text)) violations.push(`${path.relative(CORE_ROOT, filePath)} matches ${pattern}`);
    }
  }
  assert.deepEqual(violations, []);
});
