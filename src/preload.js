const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('horizon', {
  skipBreak: () => ipcRenderer.send('skip-break'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.send('save-settings', settings),
  closeSettings: () => ipcRenderer.send('close-settings'),
});
