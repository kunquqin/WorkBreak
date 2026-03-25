import { app, BrowserWindow, Menu, dialog, ipcMain, Notification, screen, type OpenDialogOptions } from 'electron'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { createTray, destroyTray, setLiveWallpaperTrayHooks } from './tray'

const __dirname = dirname(fileURLToPath(import.meta.url))

// 统一应用名，保证开发/打包后 userData 路径一致，设置才能持久化
app.setName('workbreak')

import { getSettings, setSettings, getSettingsFilePath, type AppSettings } from './settings'
import {
  startReminders,
  getReminderCountdowns,
  resetReminderProgress,
  setFixedTimeCountdownOverride,
  resetAllReminderProgress,
  restartReminders,
  syncIntervalTimersAfterSettingsChange,
} from './reminders'
import { clearSystemFontListCache, getSystemFontFamilies } from './systemFonts'
import {
  BUILTIN_MAIN_POPUP_FALLBACK_BODY,
  REST_POPUP_PREVIEW_TIME_TEXT,
  type PopupTheme,
} from '../shared/settings'
import {
  closeThemeEditorFullscreenPreview,
  showThemeEditorFullscreenPreview,
} from './reminderWindow'
import {
  startDesktopLiveWallpaper,
  stopDesktopLiveWallpaper,
  isDesktopLiveWallpaperActive,
  getDesktopLiveWallpaperState,
  registerDesktopLiveWallpaperQuitHook,
} from './desktopWallpaperPlayer'

let mainWindow: BrowserWindow | null = null

/**
 * 托盘仅 show、或 Windows 上前台与 WebContents 未对齐时，首记指针常只激活窗口、不落到控件上；
 * 显式聚焦页面后，主题名称等输入框可一次点中。
 */
function ensureMainWindowFocusedForInput() {
  const win = mainWindow
  if (!win || win.isDestroyed()) return
  win.show()
  win.focus()
  try {
    win.webContents.focus()
  } catch {
    /* ignore */
  }
  try {
    win.focusOnWebView()
  } catch {
    /* ignore */
  }
}

/** 动态壁纸异步应用：新一次「设为壁纸」或「关闭」会使进行中的完成回调失效，避免乱序通知 */
let desktopWallpaperApplyNonce = 0
let desktopWallpaperApplyRequestSeq = 0
/** 进行中的「设为桌面壁纸」requestId；nonce 递增时必须通知，否则渲染进程会空等至超时 */
let pendingDesktopWallpaperRequestId: number | null = null

type DesktopWallpaperApplyDonePayload =
  | { requestId: number; success: true }
  | { requestId: number; success: false; error: string }

function broadcastDesktopLiveWallpaperApplyDone(payload: DesktopWallpaperApplyDonePayload) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.isDestroyed()) continue
    try {
      w.webContents.send('desktop-live-wallpaper-apply-done', payload)
    } catch {
      /* 忽略 */
    }
  }
}

function installAppMenu() {
  const mod = process.platform === 'darwin' ? 'Cmd' : 'Ctrl'
  const template: Electron.MenuItemConstructorOptions[] = []
  if (process.platform === 'darwin') {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    })
  }
  template.push(
    {
      label: 'File',
      submenu: [
        {
          label: '显示主窗口',
          click: () => {
            if (!mainWindow || mainWindow.isDestroyed()) return
            mainWindow.show()
            mainWindow.focus()
          },
        },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Undo',
          accelerator: `${mod}+Z`,
          click: () => {
            if (!mainWindow || mainWindow.isDestroyed()) return
            mainWindow.webContents.send('menu-edit-undo')
          },
        },
        {
          label: 'Redo',
          accelerator: `${mod}+Y`,
          click: () => {
            if (!mainWindow || mainWindow.isDestroyed()) return
            mainWindow.webContents.send('menu-edit-redo')
          },
        },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(process.platform === 'darwin' ? [{ type: 'separator' as const }, { role: 'front' as const }] : []),
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: '关于 WorkBreak',
          click: () => {
            dialog.showMessageBox({
              type: 'info',
              title: '关于 WorkBreak',
              message: 'WorkBreak',
              detail: '桌面提醒应用',
            })
          },
        },
      ],
    },
  )
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow() {
  // 用手写CommonJS，避免 Vite 把 preload 打成 ESM；开发时从源码加载
  const preloadPath = resolve(__dirname, '../../src/preload/preload.cjs')
  const preloadExists = existsSync(preloadPath)
  if (!preloadExists) console.warn('[WorkBreak] preload 路径:', preloadPath, '不存在')

  mainWindow = new BrowserWindow({
    width: 800,
    height: 560,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // 部分环境下 sandbox 会导致 preload 无法注入
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools() // 开发时打开控制台，便于调试
    mainWindow.webContents.on('did-finish-load', () => {
      mainWindow?.webContents.executeJavaScript('typeof window.electronAPI')
        .then((t) => console.log('[WorkBreak] 页面加载后 window.electronAPI 类型:', t))
        .catch((e) => console.error('[WorkBreak] 检查 electronAPI 失败', e))
    })
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.on('close', (e) => {
    e.preventDefault()
    mainWindow?.hide()
    if (Notification.isSupported()) {
      new Notification({
        title: 'WorkBreak',
        body: '已最小化到托盘。请点击任务栏右下角（时钟旁）的图标，或点击「↑」展开隐藏图标后找到 WorkBreak。',
      }).show()
    }
  })

  createTray(mainWindow)
}

;(globalThis as unknown as { workbreakQuit?: () => void }).workbreakQuit = () => {
  closeThemeEditorFullscreenPreview()
  stopDesktopLiveWallpaper()
  destroyTray()
  mainWindow = null
  app.quit()
}

// 只允许一个实例，避免重复点 bat 或 HMR 重建时弹出多窗口
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    ensureMainWindowFocusedForInput()
  })
}

app.whenReady().then(() => {
  installAppMenu()
  createWindow()
  setLiveWallpaperTrayHooks({
    isActive: isDesktopLiveWallpaperActive,
    stop: stopDesktopLiveWallpaper,
  })
  registerDesktopLiveWallpaperQuitHook()
  startReminders()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (mainWindow === null) createWindow()
  else ensureMainWindowFocusedForInput()
})

ipcMain.handle('getSettings', () => getSettings())
ipcMain.handle('getSettingsFilePath', () => getSettingsFilePath())
ipcMain.handle('setSettings', (_e, settings: Partial<AppSettings>) => {
  const path = getSettingsFilePath()
  console.log('[WorkBreak] setSettings 被调用，写入路径:', path)
  try {
    const prev = getSettings()
    const next = setSettings(settings)
    if (settings.reminderCategories !== undefined) {
      syncIntervalTimersAfterSettingsChange(prev.reminderCategories, next.reminderCategories)
    }
    console.log('[WorkBreak] 保存成功:', JSON.stringify(next))
    return { success: true as const, data: next }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[WorkBreak] 保存失败:', message)
    return { success: false as const, error: message }
  }
})
ipcMain.handle('showMainWindow', () => {
  ensureMainWindowFocusedForInput()
})
ipcMain.handle('focusMainWebContents', () => {
  ensureMainWindowFocusedForInput()
})
ipcMain.handle('openThemeEditorFullscreenPreview', (_e, theme: PopupTheme) => {
  const now = new Date()
  const liveClock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const timeStr =
    theme.target === 'rest'
      ? (theme.previewTimeText ?? '').trim() || REST_POPUP_PREVIEW_TIME_TEXT
      : (theme.previewTimeText ?? '').trim() || liveClock
  const title = (theme.name ?? '').trim() || '壁纸预览'
  return showThemeEditorFullscreenPreview({
    title,
    body: BUILTIN_MAIN_POPUP_FALLBACK_BODY,
    timeStr,
    theme,
    liveDesktopWallpaper: theme.target === 'desktop',
  })
})
ipcMain.handle('getReminderCountdowns', () => getReminderCountdowns())
ipcMain.handle('getPrimaryDisplaySize', () => {
  const d = screen.getPrimaryDisplay()
  return { width: d.bounds.width, height: d.bounds.height }
})
ipcMain.handle('resetReminderProgress', (_e, key: string, payload?: import('../shared/settings').ResetIntervalPayload) => {
  resetReminderProgress(key, payload)
})
ipcMain.handle('setFixedTimeCountdownOverride', (_e, key: string, time: string) => {
  setFixedTimeCountdownOverride(key, time)
})
ipcMain.handle('resetAllReminderProgress', () => {
  resetAllReminderProgress()
})
ipcMain.handle('restartReminders', () => restartReminders())
ipcMain.handle('resolvePreviewImageUrl', (_e, rawPath: string) => {
  const input = String(rawPath ?? '').trim()
  if (!input) return { success: true as const, url: '' }
  if (/^(data|https?|file):/i.test(input)) return { success: true as const, url: input }
  try {
    if (!existsSync(input)) {
      return { success: false as const, error: '图片文件不存在' }
    }
    const ext = extname(input).toLowerCase()
    const mime =
      ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
        : ext === '.png' ? 'image/png'
          : ext === '.gif' ? 'image/gif'
            : ext === '.webp' ? 'image/webp'
              : ext === '.bmp' ? 'image/bmp'
                : 'application/octet-stream'
    const base64 = readFileSync(input).toString('base64')
    return { success: true as const, url: `data:${mime};base64,${base64}` }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false as const, error: message }
  }
})
ipcMain.handle('pickPopupImageFile', async () => {
  const win = mainWindow ?? BrowserWindow.getFocusedWindow()
  const options: OpenDialogOptions = {
    title: '选择背景图片',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] }],
  }
  const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  if (res.canceled || res.filePaths.length === 0) return { success: false as const, error: '已取消' }
  return { success: true as const, path: res.filePaths[0] }
})
ipcMain.handle('getSystemFontFamilies', async () => {
  try {
    const fonts = await getSystemFontFamilies()
    return { success: true as const, fonts }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[WorkBreak] getSystemFontFamilies:', message)
    return { success: false as const, fonts: [] as string[], error: message }
  }
})
ipcMain.handle('clearSystemFontListCache', () => {
  clearSystemFontListCache()
})
ipcMain.handle('startDesktopLiveWallpaper', (_e, theme: PopupTheme) => {
  if (process.platform !== 'win32') {
    return { success: false as const, error: '动态桌面壁纸当前仅支持 Windows。' }
  }
  if (pendingDesktopWallpaperRequestId !== null) {
    const prev = pendingDesktopWallpaperRequestId
    pendingDesktopWallpaperRequestId = null
    broadcastDesktopLiveWallpaperApplyDone({
      requestId: prev,
      success: false,
      error: '已有新的桌面壁纸请求，已取消上一次操作',
    })
  }
  const requestId = ++desktopWallpaperApplyRequestSeq
  const nonce = ++desktopWallpaperApplyNonce
  pendingDesktopWallpaperRequestId = requestId
  setImmediate(() => {
    void (async () => {
      try {
        const result = await startDesktopLiveWallpaper(theme)
        if (nonce !== desktopWallpaperApplyNonce) return
        if (pendingDesktopWallpaperRequestId === requestId) {
          pendingDesktopWallpaperRequestId = null
        }
        broadcastDesktopLiveWallpaperApplyDone(
          result.success
            ? { requestId, success: true as const }
            : { requestId, success: false as const, error: result.error },
        )
      } catch (err) {
        if (nonce !== desktopWallpaperApplyNonce) return
        if (pendingDesktopWallpaperRequestId === requestId) {
          pendingDesktopWallpaperRequestId = null
        }
        const message = err instanceof Error ? err.message : String(err)
        broadcastDesktopLiveWallpaperApplyDone({ requestId, success: false as const, error: message })
      }
    })()
  })
  return { pending: true as const, requestId }
})
ipcMain.handle('stopDesktopLiveWallpaper', () => {
  desktopWallpaperApplyNonce++
  if (pendingDesktopWallpaperRequestId !== null) {
    const rid = pendingDesktopWallpaperRequestId
    pendingDesktopWallpaperRequestId = null
    broadcastDesktopLiveWallpaperApplyDone({
      requestId: rid,
      success: false,
      error: '已取消桌面壁纸操作',
    })
  }
  stopDesktopLiveWallpaper()
  return { success: true as const }
})
ipcMain.handle('isDesktopLiveWallpaperActive', () => isDesktopLiveWallpaperActive())
ipcMain.handle('getDesktopLiveWallpaperState', () => getDesktopLiveWallpaperState())

type ListPopupFolderFilesResult =
  | { success: true; files: string[] }
  | { success: false; error: string }

function listPopupImageFilesInFolder(folderPathRaw: string): ListPopupFolderFilesResult {
  const folderPath = folderPathRaw.trim()
  if (!folderPath) return { success: false, error: '路径为空' }
  try {
    if (!existsSync(folderPath)) return { success: false, error: '路径不存在' }
    const st = statSync(folderPath)
    if (!st.isDirectory()) return { success: false, error: '不是文件夹' }
    const files = readdirSync(folderPath)
      .filter((name) => /\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(name))
      .map((name) => join(folderPath, name))
    if (files.length === 0) return { success: false, error: '该文件夹内没有可用图片' }
    return { success: true, files }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: message }
  }
}

ipcMain.handle('pickPopupImageFolder', async () => {
  const win = mainWindow ?? BrowserWindow.getFocusedWindow()
  const options: OpenDialogOptions = {
    title: '选择图片文件夹',
    properties: ['openDirectory'],
  }
  const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  if (res.canceled || res.filePaths.length === 0) return { success: false as const, error: '已取消' }
  const folderPath = res.filePaths[0]
  const listed = listPopupImageFilesInFolder(folderPath)
  if (!listed.success) return { success: false as const, error: listed.error }
  return { success: true as const, folderPath, files: listed.files }
})

ipcMain.handle('listPopupImageFolderFiles', (_e, folderPath: unknown) => {
  if (typeof folderPath !== 'string') return { success: false as const, error: '路径无效' }
  return listPopupImageFilesInFolder(folderPath)
})
