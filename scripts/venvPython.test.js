const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { getVenvPythonPath, runVenvPython } = require("./venvPython");

test("selects the virtualenv Python executable for each platform", () => {
  assert.equal(
    getVenvPythonPath("win32"),
    path.join(".venv", "Scripts", "python.exe")
  );
  assert.equal(
    getVenvPythonPath("darwin"),
    path.join(".venv", "bin", "python")
  );
});

test("forwards Python arguments and returns the child exit status", () => {
  const calls = [];
  const status = runVenvPython(["-m", "unittest"], (executable, args, options) => {
    calls.push({ executable, args, options });
    return { status: 7 };
  }, "darwin");

  assert.equal(status, 7);
  assert.deepEqual(calls, [{
    executable: path.join(".venv", "bin", "python"),
    args: ["-m", "unittest"],
    options: { stdio: "inherit" }
  }]);
});
