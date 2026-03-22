import { contextBridge, ipcRenderer } from 'electron'

import type { AppSettings } from '../shared/settings'

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  getSettings: () => ipcRenderer.invoke('getSettings') as Promise<AppSettings>,
  getSettingsFilePath: () => ipcRenderer.invoke('getSettingsFilePath') as Promise<string>,
  setSettings: (settings: Partial<AppSettings>) =>
    ipcRenderer.invoke('setSettings', settings) as Promise<
      { success: true; data: AppSettings } | { success: false; error: string }
    >,
  showMainWindow: () => ipcRenderer.invoke('showMainWindow'),
  getPrimaryDisplaySize: () =>
    ipcRenderer.invoke('getPrimaryDisplaySize') as Promise<{ width: number; height: number }>,
  resolvePreviewImageUrl: (imagePath: string) =>
    ipcRenderer.invoke('resolvePreviewImageUrl', imagePath) as Promise<
      { success: true; url: string } | { success: false; error: string }
    >,
  pickPopupImageFile: () =>
    ipcRenderer.invoke('pickPopupImageFile') as Promise<
      { success: true; path: string } | { success: false; error: string }
    >,
  pickPopupImageFolder: () =>
    ipcRenderer.invoke('pickPopupImageFolder') as Promise<
      { success: true; folderPath: string; files: string[] } | { success: false; error: string }
    >,
  getSystemFontFamilies: () =>
    ipcRenderer.invoke('getSystemFontFamilies') as Promise<
      { success: true; fonts: string[] } | { success: false; fonts: string[]; error: string }
    >,
  clearSystemFontListCache: () => ipcRenderer.invoke('clearSystemFontListCache') as Promise<void>,
})
