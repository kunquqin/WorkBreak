import {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  nativeImage,
  Notification,
  screen,
  shell,
  type OpenDialogOptions,
} from 'electron'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { createTray, destroyTray, destroyTrayIconOnly, setLiveWallpaperTrayHooks } from './tray'
import {
  getSettings,
  setSettings,
  getSettingsFilePath,
  getSettingsPathMeta,
  saveCurrentSettingsToCustomPath,
  pointSettingsToExistingFile,
  resetSettingsFileToDefaultLocation,
  applyLaunchAtLoginFromSettings,
  type AppSettings,
} from './settings'
import {
  startReminders,
  getReminderCountdowns,
  resetReminderProgress,
  setFixedTimeCountdownOverride,
  resetAllReminderProgress,
  restartReminders,
  syncIntervalTimersAfterSettingsChange,
  syncFixedTimersAfterSettingsChange,
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

const __dirname = dirname(fileURLToPath(import.meta.url))

/** 用户界面展示名（`app.setName` 仍为 workbreak，以保留 userData 等路径兼容） */
const APP_NAME_ZH = '喵息'
const APP_NAME_EN = 'MeowBreak'

function showAboutDialog() {
  const v = app.getVersion()
  void dialog.showMessageBox({
    type: 'none',
    title: `关于${APP_NAME_ZH}（${APP_NAME_EN}）`,
    message: '',
    detail: [
      `版本：v${v}`,
      '开发者：KevinQin',
      '博客：https://kunquqin.github.io',
      '邮箱：3790891281@qq.com',
      '系统：Windows 10及以上',
      '发布：2026-03-29',
      '版权：© 2026 KevinQin All Rights Reserved.',
    ].join('\n'),
    /**
     * Windows：不传 `icon` 时仍会套用应用图标，正文左侧出现大图。
     * 传 `createEmpty()` 可去掉该侧栏（勿传真实应用图，否则又变成大图）。
     */
    ...(process.platform === 'win32' ? { icon: nativeImage.createEmpty() } : {}),
  })
}

/** 与登录项注册一致：仅 Windows 登录启动时带上此参数，用于不弹出主窗口、仅托盘 */
const WORKBREAK_BOOT_TRAY_ARG = '--workbreak-boot-tray'

// 统一应用名，保证开发/打包后 userData 路径一致，设置才能持久化
app.setName('workbreak')
/** Windows 任务栏分组、聚焦与再次启动时唤起主窗体依赖一致 AUMID；须尽早设置 */
if (process.platform === 'win32') {
  app.setAppUserModelId('com.workbreak.app')
}

/**
 * 开发模式：Chromium 缓存与已安装版共用 %APPDATA%\\workbreak 时，易出现
 * Unable to move the cache / 0x5（拒绝访问）导致进程秒退。将 userData 指到仓库内目录，与正式安装隔离。
 * （设置文件仍由 settings.ts 在开发时写项目根 workbreak-settings.json，不依赖此处。）
 */
if (process.env.VITE_DEV_SERVER_URL) {
  const devUserData = join(__dirname, '../../.electron-user-data')
  try {
    mkdirSync(devUserData, { recursive: true })
    app.setPath('userData', devUserData)
  } catch (e) {
    console.warn('[WorkBreak] 开发模式无法创建 .electron-user-data，沿用默认 userData:', e)
  }
}

let mainWindow: BrowserWindow | null = null

/** 为 true 时允许主窗口真正关闭（托盘「退出」/ app.quit），不得再 intercept 为隐藏或弹通知 */
let isAppQuitting = false

/**
 * 托盘仅 show、或 Windows 上前台与 WebContents 未对齐时，首记指针常只激活窗口、不落到控件上；
 * 显式聚焦页面后，主题名称等输入框可一次点中。
 */
/** 开机自启动时静默进托盘：Windows 凭 argv；macOS 凭 openAsHidden + wasOpenedAsHidden（见 applyLaunchAtLoginFromSettings） */
function shouldStartMainWindowHidden(): boolean {
  if (!app.isPackaged) return false
  if (process.platform === 'win32') {
    return process.argv.includes(WORKBREAK_BOOT_TRAY_ARG)
  }
  if (process.platform === 'darwin') {
    try {
      const st = app.getLoginItemSettings({ path: process.execPath })
      return Boolean(st.wasOpenedAsHidden)
    } catch {
      return false
    }
  }
  return false
}

function scheduleRestorePersistedDesktopWallpaper(): void {
  if (process.platform !== 'win32') return
  const s = getSettings()
  const id = s.desktopLiveWallpaperThemeId
  if (!id) return
  const theme = s.popupThemes.find((t) => t.id === id && t.target === 'desktop')
  if (!theme) {
    try {
      setSettings({ desktopLiveWallpaperThemeId: null })
    } catch {
      /* ignore */
    }
    return
  }
  const copy = structuredClone(theme) as PopupTheme
  setTimeout(() => {
    void startDesktopLiveWallpaper(copy).then((result) => {
      if (!result.success) {
        console.warn('[WorkBreak] 启动时恢复动态桌面壁纸失败:', result.error)
      }
    })
  }, 900)
}

function ensureMainWindowFocusedForInput() {
  const win = mainWindow
  if (!win || win.isDestroyed()) return
  win.show()
  try {
    if (process.platform === 'win32') win.moveTop()
  } catch {
    /* ignore */
  }
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
      label: APP_NAME_ZH,
      submenu: [
        {
          label: `关于${APP_NAME_ZH}（${APP_NAME_EN}）`,
          click: () => showAboutDialog(),
        },
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
          label: `关于${APP_NAME_ZH}（${APP_NAME_EN}）`,
          click: () => showAboutDialog(),
        },
      ],
    },
  )
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow(options?: { startHidden?: boolean }) {
  const startHidden = Boolean(options?.startHidden)
  /** 开发：手写 preload.cjs（与 HMR 一致）；打包后 main 在 out/main，须加载 Vite 产物 out/preload/index.cjs */
  const preloadPath = process.env.VITE_DEV_SERVER_URL
    ? resolve(__dirname, '../../src/preload/preload.cjs')
    : join(__dirname, '../preload/index.cjs')
  if (!existsSync(preloadPath)) console.warn('[WorkBreak] preload 路径不存在:', preloadPath)

  /** 开发 HMR / 重复 createWindow：旧窗 close 用了 preventDefault，须先卸监听再 destroy，否则会留下「点×无效」的幽灵窗 */
  if (mainWindow && !mainWindow.isDestroyed()) {
    destroyTrayIconOnly()
    const oldWin = mainWindow
    mainWindow = null
    try {
      oldWin.removeAllListeners()
      oldWin.destroy()
    } catch {
      /* ignore */
    }
  }

  const win = new BrowserWindow({
    width: 800,
    height: 560,
    title: APP_NAME_ZH,
    /** 等首帧绘制再显示，避免白屏/未就绪时任务栏「无窗体」观感；加载失败仍会通过 did-fail-load 强制 show */
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // 部分环境下 sandbox 会导致 preload 无法注入
    },
  })
  mainWindow = win

  const revealMainWindow = () => {
    if (win.isDestroyed()) return
    win.show()
    try {
      if (process.platform === 'win32') win.moveTop()
    } catch {
      /* ignore */
    }
    win.focus()
  }

  win.once('ready-to-show', () => {
    if (!startHidden) revealMainWindow()
  })
  /** 极少数环境 ready-to-show 过晚或不触发，避免用户以为双击无反应（开机静默启动时不自动弹出） */
  let revealFallback: ReturnType<typeof setTimeout> | undefined
  if (!startHidden) {
    const revealFallbackMs = 12_000
    revealFallback = setTimeout(() => {
      if (!win.isDestroyed() && !win.isVisible()) {
        console.warn('[WorkBreak] ready-to-show 未在预期内触发，强制显示主窗口')
        revealMainWindow()
      }
    }, revealFallbackMs)
    win.once('show', () => {
      if (revealFallback) clearTimeout(revealFallback)
    })
  }

  win.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return
      console.error('[WorkBreak] 主界面加载失败', errorCode, errorDescription, validatedURL)
      revealMainWindow()
      try {
        dialog.showErrorBox(
          `${APP_NAME_ZH} 无法加载界面`,
          '请检查是否被杀毒/权限拦截，或重新下载便携版。\n\n' +
            (errorDescription || String(errorCode)) +
            (validatedURL ? `\n${validatedURL}` : ''),
        )
      } catch {
        /* ignore */
      }
    },
  )

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
    win.webContents.openDevTools() // 开发时打开控制台，便于调试
    win.webContents.on('did-finish-load', () => {
      win.webContents
        .executeJavaScript('typeof window.electronAPI')
        .then((t) => console.log('[WorkBreak] 页面加载后 window.electronAPI 类型:', t))
        .catch((e) => console.error('[WorkBreak] 检查 electronAPI 失败', e))
    })
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  win.on('close', (e) => {
    if (isAppQuitting) return
    e.preventDefault()
    try {
      if (!win.isDestroyed()) win.hide()
    } catch (err) {
      console.error('[WorkBreak] 关闭时隐藏窗口失败', err)
    }
    try {
      if (Notification.isSupported()) {
        new Notification({
          title: APP_NAME_ZH,
          body: '已收到托盘，点击托盘图标可打开',
          silent: true,
        }).show()
      }
    } catch (err) {
      console.warn('[WorkBreak] 托盘提示通知失败', err)
    }
  })

  try {
    createTray(win)
  } catch (err) {
    console.error('[WorkBreak] createTray 失败（将无托盘图标）', err)
  }
}

;(globalThis as unknown as { workbreakQuit?: () => void }).workbreakQuit = () => {
  isAppQuitting = true
  closeThemeEditorFullscreenPreview()
  stopDesktopLiveWallpaper()
  destroyTray()
  mainWindow = null
  app.quit()
}

// 只允许一个实例：未拿到锁的进程不得注册 whenReady / IPC，否则 quit 前仍可能 createWindow，出现多窗口与多托盘
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    ensureMainWindowFocusedForInput()
  })

  app.whenReady().then(() => {
    installAppMenu()
    const startHidden = shouldStartMainWindowHidden()
    createWindow({ startHidden })
    setLiveWallpaperTrayHooks({
      isActive: isDesktopLiveWallpaperActive,
      stop: stopDesktopLiveWallpaper,
    })
    registerDesktopLiveWallpaperQuitHook()
    applyLaunchAtLoginFromSettings(getSettings())
    startReminders()
    scheduleRestorePersistedDesktopWallpaper()
  })

  app.on('before-quit', () => {
    isAppQuitting = true
    destroyTray()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('activate', () => {
    if (mainWindow === null) createWindow()
    else ensureMainWindowFocusedForInput()
  })

  ipcMain.handle('getAppVersion', () => app.getVersion())
  ipcMain.handle('getSettings', () => getSettings())
ipcMain.handle('getSettingsFilePath', () => getSettingsFilePath())
ipcMain.handle('getSettingsPathMeta', () => getSettingsPathMeta())
ipcMain.handle('pickAndSaveSettingsFile', async () => {
  const win = BrowserWindow.getFocusedWindow() ?? mainWindow
  const { canceled, filePath } = await dialog.showSaveDialog(win ?? undefined, {
    title: '将当前配置保存到…',
    defaultPath: 'workbreak-settings.json',
    filters: [{ name: 'JSON', extensions: ['json'] }],
  })
  if (canceled || !filePath) return { success: false as const, error: '已取消' }
  const r = saveCurrentSettingsToCustomPath(filePath)
  if (r.success) restartReminders()
  return r
})
ipcMain.handle('pickExistingSettingsFile', async () => {
  const win = BrowserWindow.getFocusedWindow() ?? mainWindow
  const { canceled, filePaths } = await dialog.showOpenDialog(win ?? undefined, {
    title: '改用已有配置文件',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  })
  if (canceled || !filePaths?.[0]) return { success: false as const, error: '已取消' }
  const r = pointSettingsToExistingFile(filePaths[0])
  if (r.success) restartReminders()
  return r
})
ipcMain.handle('resetSettingsFileToDefault', () => {
  const r = resetSettingsFileToDefaultLocation()
  if (r.success) restartReminders()
  return r
})
ipcMain.handle('showSettingsInFolder', () => {
  try {
    const p = getSettingsFilePath()
    shell.showItemInFolder(p)
    return { success: true as const }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { success: false as const, error: message }
  }
})
ipcMain.handle('setSettings', (_e, settings: Partial<AppSettings>) => {
  const path = getSettingsFilePath()
  console.log('[WorkBreak] setSettings 被调用，写入路径:', path)
  try {
    const prev = getSettings()
    const next = setSettings(settings)
    if (settings.reminderCategories !== undefined) {
      syncIntervalTimersAfterSettingsChange(prev.reminderCategories, next.reminderCategories)
      syncFixedTimersAfterSettingsChange(prev.reminderCategories, next.reminderCategories)
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
        if (result.success) {
          try {
            setSettings({ desktopLiveWallpaperThemeId: theme.id })
          } catch (err) {
            console.warn('[WorkBreak] 持久化桌面壁纸主题失败', err)
          }
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
  try {
    setSettings({ desktopLiveWallpaperThemeId: null })
  } catch (err) {
    console.warn('[WorkBreak] 清除桌面壁纸持久化失败', err)
  }
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
}
