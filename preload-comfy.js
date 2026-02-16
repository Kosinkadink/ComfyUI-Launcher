const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  restartApp: () => ipcRenderer.invoke("restart-core"),
});
