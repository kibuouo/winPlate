function getMainWindowOptions({ icon, dark, webPreferences }) {
  return {
    width: 1080,
    height: 720,
    minWidth: 860,
    minHeight: 560,
    show: false,
    backgroundColor: dark ? "#202123" : "#ffffff",
    title: "WinPlate",
    icon,
    autoHideMenuBar: true,
    frame: false,
    webPreferences
  };
}

module.exports = { getMainWindowOptions };
