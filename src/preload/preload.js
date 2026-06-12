const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("winplate", {
  showMainWindow: (section = "Dashboard") => ipcRenderer.send("window:show-main", section),
  onNavigate: (callback) => ipcRenderer.on("main:navigate", (_event, section) => callback(section)),
  openGithubProfile: (url) => ipcRenderer.send("github:open-profile", url),
  refreshGithub: () => ipcRenderer.invoke("github:refresh"),
  getCodexUsage: (options = {}) => ipcRenderer.invoke("codex:usage", options),
  setWindowTheme: (theme) => ipcRenderer.send("window:set-theme", theme),
  minimizeWindow: () => ipcRenderer.send("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window:toggle-maximize"),
  closeWindow: () => ipcRenderer.send("window:close"),
  onMaximizedChange: (callback) => ipcRenderer.on("window:maximized", (_event, value) => callback(value)),

  setFloatingPinned: (value) => ipcRenderer.invoke("floating:set-pinned", value),
  setFloatingPinInteractive: (value) => ipcRenderer.send("floating:pin-interactive", value),
  showTooltip: (payload) => ipcRenderer.send("tooltip:show", payload),
  hideTooltip: () => ipcRenderer.send("tooltip:hide"),
  onTooltipUpdate: (callback) => ipcRenderer.on("tooltip:update", (_event, data) => callback(data))
});
