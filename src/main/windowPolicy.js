function getMainWindowOptions(platform, { icon, dark, webPreferences }) {
  if (platform === "win32") {
    return {
      width: 1080,
      height: 720,
      minWidth: 860,
      minHeight: 560,
      show: false,
      backgroundColor: dark ? "#181818" : "#f7f7f8",
      title: "WinPlate",
      icon,
      autoHideMenuBar: true,
      frame: false,
      webPreferences
    };
  }

  if (platform === "darwin") {
    return {
      width: 1040,
      height: 720,
      minWidth: 880,
      minHeight: 580,
      show: false,
      title: "WinPlate",
      frame: true,
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 16, y: 16 },
      transparent: true,
      backgroundColor: "#00000000",
      vibrancy: "window",
      visualEffectState: "followWindow",
      webPreferences
    };
  }

  throw new Error(`Unsupported platform: ${platform}`);
}

module.exports = { getMainWindowOptions };
