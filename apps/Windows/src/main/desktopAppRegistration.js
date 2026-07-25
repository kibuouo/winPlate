const fs = require("node:fs/promises");
const path = require("node:path");

const WINPLATE_APP_USER_MODEL_ID = "com.kiko.winplate";
const WINPLATE_SHORTCUT_NAME = "WinPlate.lnk";

function resolveStartMenuProgramsDir(appDataPath) {
  return path.join(String(appDataPath || ""), "Microsoft", "Windows", "Start Menu", "Programs");
}

function shouldUseAppPathArgument(app, processObject = process) {
  return !app?.isPackaged || Boolean(processObject?.defaultApp);
}

function resolveShortcutDetails(app, options = {}) {
  const processObject = options.processObject || process;
  const iconPath = String(options.iconPath || "");
  const executablePath = String(app.getPath("exe") || processObject.execPath || "");
  const appPath = String(app.getAppPath() || "");
  const argumentsValue = shouldUseAppPathArgument(app, processObject) && appPath
    ? `"${appPath}"`
    : "";

  const executableDirectory = /^[A-Za-z]:[\\/]/.test(executablePath)
    ? path.win32.dirname(executablePath)
    : path.dirname(executablePath);

  return {
    target: executablePath,
    args: argumentsValue,
    cwd: shouldUseAppPathArgument(app, processObject) && appPath
      ? appPath
      : executableDirectory,
    description: "WinPlate desktop status board",
    icon: iconPath,
    iconIndex: 0,
    appUserModelId: WINPLATE_APP_USER_MODEL_ID
  };
}

async function registerWindowsDesktopApp({
  app,
  shell,
  iconPath,
  fsModule = fs,
  pathModule = path,
  platform = process.platform
} = {}) {
  if (!app || !shell) {
    throw new TypeError("registerWindowsDesktopApp requires app and shell");
  }
  if (platform !== "win32") {
    return { registered: false, reason: "unsupported-platform" };
  }

  app.setAppUserModelId(WINPLATE_APP_USER_MODEL_ID);

  const startMenuDir = resolveStartMenuProgramsDir(app.getPath("appData"));
  const shortcutPath = pathModule.join(startMenuDir, WINPLATE_SHORTCUT_NAME);
  const details = resolveShortcutDetails(app, { iconPath });

  await fsModule.mkdir(startMenuDir, { recursive: true });

  let operation = "create";
  try {
    await fsModule.access(shortcutPath);
    operation = "update";
  } catch {}

  const written = shell.writeShortcutLink(shortcutPath, operation, details);
  if (!written) {
    throw new Error(`Failed to ${operation} Start menu shortcut`);
  }

  return {
    registered: true,
    shortcutPath,
    operation,
    details
  };
}

module.exports = {
  WINPLATE_APP_USER_MODEL_ID,
  WINPLATE_SHORTCUT_NAME,
  registerWindowsDesktopApp,
  resolveShortcutDetails,
  resolveStartMenuProgramsDir,
  shouldUseAppPathArgument
};
