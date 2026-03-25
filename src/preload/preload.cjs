const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  getSettings: () => ipcRenderer.invoke('getSettings'),
  getSettingsFilePath: () => ipcRenderer.invoke('getSettingsFilePath'),
  setSettings: (settings) => ipcRenderer.invoke('setSettings', settings),
  showMainWindow: () => ipcRenderer.invoke('showMainWindow'),
  focusMainWebContents: () => ipcRenderer.invoke('focusMainWebContents'),
  openThemeEditorFullscreenPreview: (theme) => ipcRenderer.invoke('openThemeEditorFullscreenPreview', theme),
  getReminderCountdowns: () => ipcRenderer.invoke('getReminderCountdowns'),
  getPrimaryDisplaySize: () => ipcRenderer.invoke('getPrimaryDisplaySize'),
  resetReminderProgress: (key, payload) => ipcRenderer.invoke('resetReminderProgress', key, payload),
  setFixedTimeCountdownOverride: (key, time) => ipcRenderer.invoke('setFixedTimeCountdownOverride', key, time),
  resetAllReminderProgress: () => ipcRenderer.invoke('resetAllReminderProgress'),
  restartReminders: () => ipcRenderer.invoke('restartReminders'),
  resolvePreviewImageUrl: (imagePath) => ipcRenderer.invoke('resolvePreviewImageUrl', imagePath),
  pickPopupImageFile: () => ipcRenderer.invoke('pickPopupImageFile'),
  pickPopupImageFolder: () => ipcRenderer.invoke('pickPopupImageFolder'),
  listPopupImageFolderFiles: (folderPath) => ipcRenderer.invoke('listPopupImageFolderFiles', folderPath),
  getSystemFontFamilies: () => ipcRenderer.invoke('getSystemFontFamilies'),
  clearSystemFontListCache: () => ipcRenderer.invoke('clearSystemFontListCache'),
  startDesktopLiveWallpaper: (theme) => ipcRenderer.invoke('startDesktopLiveWallpaper', theme),
  waitDesktopLiveWallpaperApplyDone: (requestId) =>
    new Promise((resolve) => {
      const onDone = (_e, result) => {
        if (result.requestId !== requestId) return
        ipcRenderer.removeListener('desktop-live-wallpaper-apply-done', onDone)
        clearTimeout(timeoutId)
        if (result.success) resolve({ success: true })
        else resolve({ success: false, error: result.error || '设置失败' })
      }
      const timeoutId = setTimeout(() => {
        ipcRenderer.removeListener('desktop-live-wallpaper-apply-done', onDone)
        resolve({ success: false, error: '等待超时或已中断' })
      }, 300000)
      ipcRenderer.on('desktop-live-wallpaper-apply-done', onDone)
    }),
  stopDesktopLiveWallpaper: () => ipcRenderer.invoke('stopDesktopLiveWallpaper'),
  isDesktopLiveWallpaperActive: () => ipcRenderer.invoke('isDesktopLiveWallpaperActive'),
  getDesktopLiveWallpaperState: () => ipcRenderer.invoke('getDesktopLiveWallpaperState'),
  onMenuUndo: (cb) => {
    const fn = () => cb()
    ipcRenderer.on('menu-edit-undo', fn)
    return () => ipcRenderer.removeListener('menu-edit-undo', fn)
  },
  onMenuRedo: (cb) => {
    const fn = () => cb()
    ipcRenderer.on('menu-edit-redo', fn)
    return () => ipcRenderer.removeListener('menu-edit-redo', fn)
  },
})
