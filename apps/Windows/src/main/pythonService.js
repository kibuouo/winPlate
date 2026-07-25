const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { repositoryRoot, resolveBackendPaths } = require("./repositoryPaths");

let backendProcess;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForBackend() {
  let lastError;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:8765/api/health");
      if (response.ok) {
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(200);
  }
  throw new Error(`FastAPI failed to become ready: ${lastError?.message}`);
}

function backendPythonArgs({ backendAppDir, backendLogConfigPath }) {
  return [
    "-m", "uvicorn", "winplate_local_api.main:api",
    "--app-dir", backendAppDir,
    "--host", "127.0.0.1",
    "--port", "8765",
    "--log-config", backendLogConfigPath
  ];
}

function resolveBackendLaunch({
  isPackaged = false,
  resourcesPath,
  userDataPath,
  repositoryRoot: sourceRoot = repositoryRoot,
  platform = process.platform,
  env = process.env,
  existsSync = fs.existsSync
} = {}) {
  const paths = resolveBackendPaths({ isPackaged, resourcesPath, repositoryRoot: sourceRoot });
  const extension = platform === "win32" ? ".exe" : "";
  const packagedExecutable = env.WINPLATE_BACKEND_EXECUTABLE
    || (isPackaged ? path.join(resourcesPath, "backend", "bin", `winplate-backend${extension}`) : null);
  if (packagedExecutable && existsSync(packagedExecutable)) {
    return {
      command: packagedExecutable,
      args: [],
      cwd: path.dirname(packagedExecutable),
      env: userDataPath ? { WINPLATE_DATA_DIR: userDataPath } : {}
    };
  }

  const venvPython = platform === "win32"
    ? path.join(sourceRoot, ".venv", "Scripts", "python.exe")
    : path.join(sourceRoot, ".venv", "bin", "python");
  const bundledPython = !isPackaged
    ? null
    : platform === "win32"
      ? path.join(resourcesPath, "python", "python.exe")
      : path.join(resourcesPath, "python", "bin", "python3");
  const configuredPython = env.WINPLATE_PYTHON;
  let python;
  if (configuredPython && (!isPackaged || existsSync(configuredPython))) {
    python = configuredPython;
  } else if (bundledPython && existsSync(bundledPython)) {
    python = bundledPython;
  } else if (!isPackaged) {
    python = existsSync(venvPython) ? venvPython : (platform === "win32" ? "python" : "python3");
  }
  if (!python) {
    throw new Error(
      "No packaged WinPlate backend runtime was found. Set WINPLATE_BACKEND_EXECUTABLE, "
      + "bundle backend/bin/winplate-backend, bundle resources/python, or set WINPLATE_PYTHON "
      + "to an existing interpreter."
    );
  }
  return {
    command: python,
    args: backendPythonArgs(paths),
    cwd: isPackaged ? resourcesPath : sourceRoot,
    env: userDataPath ? { WINPLATE_DATA_DIR: userDataPath } : {}
  };
}

async function startPythonService(options = {}) {
  if (backendProcess && !backendProcess.killed) {
    return;
  }

  const launch = resolveBackendLaunch(options);
  backendProcess = spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...launch.env,
      FORCE_COLOR: "1",
      TERM: process.env.TERM || "xterm-256color"
    }
  });

  backendProcess.stdout.on("data", (data) => process.stdout.write(`\u001b[36m[backend]\u001b[0m ${data}`));
  backendProcess.stderr.on("data", (data) => process.stderr.write(`\u001b[36m[backend]\u001b[0m ${data}`));
  backendProcess.on("error", (error) => console.error("Failed to start FastAPI backend:", error.message));
  backendProcess.on("exit", () => {
    backendProcess = null;
  });

  await waitForBackend();
}

function stopPythonService() {
  if (!backendProcess || backendProcess.killed) {
    return;
  }

  backendProcess.kill();
  backendProcess = null;
}

module.exports = { backendPythonArgs, resolveBackendLaunch, startPythonService, stopPythonService };
