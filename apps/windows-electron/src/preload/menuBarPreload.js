const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("winplate", {
  showMainWindow: (section = "Dashboard") => (
    ipcRenderer.send("window:show-main", section)
  ),
  getStatus: () => ipcRenderer.invoke("status:get"),
  getCodexUsage: (options = {}) => ipcRenderer.invoke("codex:usage", options),
  getDeepSeekUsage: (options = {}) => ipcRenderer.invoke("deepseek:usage", options),
  updateMenuBarTemperature: (temperature) => (
    ipcRenderer.send("menubar:update-temperature", temperature)
  ),
  hideMenuBarPanel: () => ipcRenderer.send("menubar:hide"),
  onMenuBarRefresh: (callback) => {
    if (typeof callback !== "function") {
      throw new TypeError("callback must be a function");
    }
    const listener = (_event, ...args) => callback(...args);
    ipcRenderer.on("menubar:refresh", listener);
    return () => ipcRenderer.removeListener("menubar:refresh", listener);
  }
});
