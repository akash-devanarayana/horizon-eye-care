const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('horizon', {
  skipBreak: () => ipcRenderer.send('skip-break'),
});
