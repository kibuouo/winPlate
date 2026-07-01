const path = require("node:path");
const { spawnSync } = require("node:child_process");

function getVenvPythonPath(platform = process.platform) {
  return platform === "win32"
    ? path.join(".venv", "Scripts", "python.exe")
    : path.join(".venv", "bin", "python");
}

function runVenvPython(args, spawn = spawnSync, platform = process.platform) {
  const result = spawn(getVenvPythonPath(platform), args, { stdio: "inherit" });
  if (result.error) {
    throw result.error;
  }
  return Number.isInteger(result.status) ? result.status : 1;
}

if (require.main === module) {
  try {
    process.exitCode = runVenvPython(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { getVenvPythonPath, runVenvPython };
