const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  getSettings: () => ipcRenderer.invoke('getSettings'),
  getSettingsFilePath: () => ipcRenderer.invoke('getSettingsFilePath'),
  setSettings: (settings) => ipcRenderer.invoke('setSettings', settings),
  showMainWindow: () => ipcRenderer.invoke('showMainWindow'),
  getReminderCountdowns: () => ipcRenderer.invoke('getReminderCountdowns'),
  getPrimaryDisplaySize: () => ipcRenderer.invoke('getPrimaryDisplaySize'),
  resetReminderProgress: (key, payload) => ipcRenderer.invoke('resetReminderProgress', key, payload),
  setFixedTimeCountdownOverride: (key, time) => ipcRenderer.invoke('setFixedTimeCountdownOverride', key, time),
  resetAllReminderProgress: () => ipcRenderer.invoke('resetAllReminderProgress'),
  restartReminders: () => ipcRenderer.invoke('restartReminders'),
  resolvePreviewImageUrl: (imagePath) => ipcRenderer.invoke('resolvePreviewImageUrl', imagePath),
  pickPopupImageFile: () => ipcRenderer.invoke('pickPopupImageFile'),
  pickPopupImageFolder: () => ipcRenderer.invoke('pickPopupImageFolder'),
  getSystemFontFamilies: () => ipcRenderer.invoke('getSystemFontFamilies'),
  clearSystemFontListCache: () => ipcRenderer.invoke('clearSystemFontListCache'),
})
