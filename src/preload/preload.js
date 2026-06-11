const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("winplate", {
  showMainWindow: (section = "Dashboard") => ipcRenderer.send("window:show-main", section),
  onNavigate: (callback) => ipcRenderer.on("main:navigate", (_event, section) => callback(section)),
  openGithubProfile: () => ipcRenderer.send("github:open-profile"),
  refreshGithub: () => ipcRenderer.send("github:refresh")
  ,
  getCodexUsage: (options = {}) => ipcRenderer.invoke("codex:usage", options)
});
