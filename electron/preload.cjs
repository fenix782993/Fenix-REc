const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('fenix', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: value => ipcRenderer.invoke('settings:save', value),
  chooseFolder: () => ipcRenderer.invoke('folder:choose'),
  openFolder: () => ipcRenderer.invoke('folder:open'),
  saveRecording: payload => ipcRenderer.invoke('record:save', payload),
  convertRecording: path => ipcRenderer.invoke('record:convert', path),
  getCaptureSources: () => ipcRenderer.invoke('capture:sources')
});