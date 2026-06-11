const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

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

async function startPythonService() {
  if (backendProcess && !backendProcess.killed) {
    return;
  }

  const backendDir = path.join(__dirname, "..", "..", "backend");
  const projectDir = path.join(backendDir, "..");
  const venvPython = process.platform === "win32"
    ? path.join(projectDir, ".venv", "Scripts", "python.exe")
    : path.join(projectDir, ".venv", "bin", "python");
  const python = process.env.WINPLATE_PYTHON
    || (fs.existsSync(venvPython) ? venvPython : (process.platform === "win32" ? "python" : "python3"));
  backendProcess = spawn(python, ["main.py"], {
    cwd: backendDir,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });

  backendProcess.stdout.on("data", (data) => console.log(`[backend] ${data}`));
  backendProcess.stderr.on("data", (data) => console.error(`[backend] ${data}`));
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

module.exports = { startPythonService, stopPythonService };
