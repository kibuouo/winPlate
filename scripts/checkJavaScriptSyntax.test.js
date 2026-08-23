const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  checkJavaScriptFiles,
  collectJavaScriptFiles
} = require("./checkJavaScriptSyntax");

test("collects every JavaScript file recursively in stable order", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "winplate-syntax-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "nested"));
  fs.writeFileSync(path.join(root, "z.js"), "const z = true;\n");
  fs.writeFileSync(path.join(root, "nested", "a.js"), "const a = true;\n");
  fs.writeFileSync(path.join(root, "nested", "ignored.json"), "{}\n");

  assert.deepEqual(
    collectJavaScriptFiles(root).map((file) => path.relative(root, file)),
    [path.join("nested", "a.js"), "z.js"]
  );
});

test("checks files with the active Node executable and returns the first failure", () => {
  const calls = [];
  const status = checkJavaScriptFiles(["one.js", "two.js", "three.js"], (command, args, options) => {
    calls.push({ command, args, options });
    return { status: args[1] === "two.js" ? 7 : 0 };
  });

  assert.equal(status, 7);
  assert.deepEqual(calls, [
    { command: process.execPath, args: ["--check", "one.js"], options: { stdio: "inherit" } },
    { command: process.execPath, args: ["--check", "two.js"], options: { stdio: "inherit" } }
  ]);
});
