const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("fenext", {
  connectObsidian: () => ipcRenderer.invoke("fenext:connect-obsidian"),
  openObsidian: () => ipcRenderer.invoke("fenext:open-obsidian"),
  status: () => ipcRenderer.invoke("fenext:status"),
  sync: () => ipcRenderer.invoke("fenext:sync"),
  importNotes: () => ipcRenderer.invoke("fenext:import"),
  shortcut: (value) => ipcRenderer.invoke("fenext:shortcut", value),
  openNote: (id) => ipcRenderer.invoke("fenext:open-note", id),
  openMain: () => ipcRenderer.invoke("fenext:open-main"),
  hide: () => ipcRenderer.invoke("fenext:hide"),
});
