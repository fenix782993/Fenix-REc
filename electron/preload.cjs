const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('fenix', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: value => ipcRenderer.invoke('settings:save', value),
  chooseFolder: () => ipcRenderer.invoke('folder:choose'),
  openFolder: () => ipcRenderer.invoke('folder:open'),
  startRecording: options => ipcRenderer.invoke('record:start', options),
  stopRecording: () => ipcRenderer.invoke('record:stop'),
  openLog: () => ipcRenderer.invoke('diagnostics:open-log'),
  listAudioDevices: () => ipcRenderer.invoke('audio:list-devices'),
  testMic: device => ipcRenderer.invoke('audio:test-mic', device),
  onRecordingEnded: callback => ipcRenderer.on('record:ended', (_event, data) => callback(data))
});
