import { contextBridge, ipcRenderer } from 'electron'

import type { AppSettings, CountdownItem, PopupTheme, ResetIntervalPayload } from '../shared/settings'

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  getSettings: () => ipcRenderer.invoke('getSettings') as Promise<AppSettings>,
  getSettingsFilePath: () => ipcRenderer.invoke('getSettingsFilePath') as Promise<string>,
  getSettingsPathMeta: () =>
    ipcRenderer.invoke('getSettingsPathMeta') as Promise<{
      currentPath: string
      defaultPath: string
      isCustom: boolean
    }>,
  getAppVersion: () => ipcRenderer.invoke('getAppVersion') as Promise<string>,
  pickAndSaveSettingsFile: () =>
    ipcRenderer.invoke('pickAndSaveSettingsFile') as Promise<
      { success: true } | { success: false; error: string }
    >,
  pickExistingSettingsFile: () =>
    ipcRenderer.invoke('pickExistingSettingsFile') as Promise<
      { success: true } | { success: false; error: string }
    >,
  resetSettingsFileToDefault: () =>
    ipcRenderer.invoke('resetSettingsFileToDefault') as Promise<
      { success: true } | { success: false; error: string }
    >,
  showSettingsInFolder: () =>
    ipcRenderer.invoke('showSettingsInFolder') as Promise<{ success: true } | { success: false; error: string }>,
  setSettings: (settings: Partial<AppSettings>) =>
    ipcRenderer.invoke('setSettings', settings) as Promise<
      { success: true; data: AppSettings } | { success: false; error: string }
    >,
  showMainWindow: () => ipcRenderer.invoke('showMainWindow'),
  focusMainWebContents: () => ipcRenderer.invoke('focusMainWebContents'),
  openThemeEditorFullscreenPreview: (theme) => ipcRenderer.invoke('openThemeEditorFullscreenPreview', theme),
  getReminderCountdowns: () => ipcRenderer.invoke('getReminderCountdowns') as Promise<CountdownItem[]>,
  getPrimaryDisplaySize: () =>
    ipcRenderer.invoke('getPrimaryDisplaySize') as Promise<{ width: number; height: number }>,
  resetReminderProgress: (key: string, payload?: ResetIntervalPayload) =>
    ipcRenderer.invoke('resetReminderProgress', key, payload) as Promise<void>,
  setFixedTimeCountdownOverride: (key: string, time: string) =>
    ipcRenderer.invoke('setFixedTimeCountdownOverride', key, time) as Promise<void>,
  resetAllReminderProgress: () => ipcRenderer.invoke('resetAllReminderProgress') as Promise<void>,
  restartReminders: () => ipcRenderer.invoke('restartReminders') as Promise<void>,
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
  listPopupImageFolderFiles: (folderPath: string) =>
    ipcRenderer.invoke('listPopupImageFolderFiles', folderPath) as Promise<
      { success: true; files: string[] } | { success: false; error: string }
    >,
  getSystemFontFamilies: () =>
    ipcRenderer.invoke('getSystemFontFamilies') as Promise<
      { success: true; fonts: string[] } | { success: false; fonts: string[]; error: string }
    >,
  clearSystemFontListCache: () => ipcRenderer.invoke('clearSystemFontListCache') as Promise<void>,
  startDesktopLiveWallpaper: (theme: PopupTheme) =>
    ipcRenderer.invoke('startDesktopLiveWallpaper', theme) as Promise<
      | { success: true }
      | { success: false; error: string }
      | { pending: true; requestId: number }
    >,
  waitDesktopLiveWallpaperApplyDone: (requestId: number) =>
    new Promise<{ success: true } | { success: false; error: string }>((resolve) => {
      const onDone = (
        _e: unknown,
        result: { requestId: number; success: boolean; error?: string },
      ) => {
        if (result.requestId !== requestId) return
        ipcRenderer.removeListener('desktop-live-wallpaper-apply-done', onDone)
        window.clearTimeout(timeoutId)
        if (result.success) resolve({ success: true })
        else resolve({ success: false, error: result.error || '设置失败' })
      }
      const timeoutId = window.setTimeout(() => {
        ipcRenderer.removeListener('desktop-live-wallpaper-apply-done', onDone)
        resolve({ success: false, error: '等待超时或已中断' })
      }, 300_000)
      ipcRenderer.on('desktop-live-wallpaper-apply-done', onDone)
    }),
  stopDesktopLiveWallpaper: () => ipcRenderer.invoke('stopDesktopLiveWallpaper') as Promise<{ success: true }>,
  isDesktopLiveWallpaperActive: () => ipcRenderer.invoke('isDesktopLiveWallpaperActive') as Promise<boolean>,
  getDesktopLiveWallpaperState: () =>
    ipcRenderer.invoke('getDesktopLiveWallpaperState') as Promise<{ active: boolean; themeId: string | null }>,
  onMenuUndo: (cb: () => void) => {
    const fn = () => cb()
    ipcRenderer.on('menu-edit-undo', fn)
    return () => ipcRenderer.removeListener('menu-edit-undo', fn)
  },
  onMenuRedo: (cb: () => void) => {
    const fn = () => cb()
    ipcRenderer.on('menu-edit-redo', fn)
    return () => ipcRenderer.removeListener('menu-edit-redo', fn)
  },
})
