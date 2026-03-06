const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("market", {
  getSnapshot: () => ipcRenderer.invoke("market:getSnapshot"),
  setSymbols: (symbols) => ipcRenderer.invoke("market:setSymbols", symbols),
  setMarket: (market) => ipcRenderer.invoke("market:setMarket", market),
  onUpdate: (handler) => {
    const wrapped = (_, payload) => handler(payload);
    ipcRenderer.on("market:update", wrapped);
    return () => ipcRenderer.removeListener("market:update", wrapped);
  },
  onError: (handler) => {
    const wrapped = (_, payload) => handler(payload);
    ipcRenderer.on("market:error", wrapped);
    return () => ipcRenderer.removeListener("market:error", wrapped);
  },
  onPinned: (handler) => {
    const wrapped = (_, pinned) => handler(pinned);
    ipcRenderer.on("window:pinned", wrapped);
    return () => ipcRenderer.removeListener("window:pinned", wrapped);
  },
});

contextBridge.exposeInMainWorld("watchGroups", {
  get: () => ipcRenderer.invoke("watchgroups:get"),
  save: (payload) => ipcRenderer.invoke("watchgroups:save", payload),
  remove: (groupId) => ipcRenderer.invoke("watchgroups:remove", groupId),
  activate: (groupId) => ipcRenderer.invoke("watchgroups:activate", groupId),
  onUpdate: (handler) => {
    const wrapped = (_, payload) => handler(payload);
    ipcRenderer.on("watchgroups:update", wrapped);
    return () => ipcRenderer.removeListener("watchgroups:update", wrapped);
  },
});

contextBridge.exposeInMainWorld("appWindow", {
  togglePin: () => ipcRenderer.send("window:toggle-pin"),
  previewOpacity: (opacity) => ipcRenderer.send("window:preview-opacity", opacity),
  setOpacity: (opacity) => ipcRenderer.invoke("window:set-opacity", opacity),
  onOpacity: (handler) => {
    const wrapped = (_, opacity) => handler(opacity);
    ipcRenderer.on("window:opacity", wrapped);
    return () => ipcRenderer.removeListener("window:opacity", wrapped);
  },
});
