import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, nativeImage, Tray, Menu, BrowserWindow } from 'electron'

/** 无 build/icon.ico 时的兜底（尽量不用：Windows 上易糊成一块灰） */
const TRAY_ICON_DATA =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAOklEQVQ4T2NkYGD4z0ABYBzVMGoB1AIMDP8ZGBj+M/xnYGD4z8DAwMgw6gYGBgZGBkYGBob/ow4YdQODAwMAuIkL/0eLhJAAAAAASUVORK5CYII='

function resolveTrayIcon(): Electron.NativeImage {
  const packagedPath = join(process.resourcesPath, 'icon.ico')
  const devPath = join(process.cwd(), 'build', 'icon.ico')
  const pathStr = app.isPackaged
    ? existsSync(packagedPath)
      ? packagedPath
      : null
    : existsSync(devPath)
      ? devPath
      : null
  if (pathStr) {
    try {
      const img = nativeImage.createFromPath(pathStr)
      if (!img.isEmpty()) return img
    } catch {
      /* use fallback */
    }
  }
  return nativeImage.createFromDataURL(TRAY_ICON_DATA)
}

let tray: Tray | null = null
let mainWindowRef: BrowserWindow | null = null

type LiveWallpaperTrayHooks = {
  isActive: () => boolean
  stop: () => void
}

let liveWallpaperTrayHooks: LiveWallpaperTrayHooks | null = null

export function setLiveWallpaperTrayHooks(hooks: LiveWallpaperTrayHooks | null) {
  liveWallpaperTrayHooks = hooks
  rebuildTrayMenu()
}

/** 仅销毁托盘实例（不清空 liveWallpaperTrayHooks），主进程重建主窗口时用 */
export function destroyTrayIconOnly() {
  disposeTrayIfAny()
}

export function rebuildTrayMenu() {
  if (!tray) return
  const items: Electron.MenuItemConstructorOptions[] = [
    {
      label: '打开设置',
      click: () => {
        const w = mainWindowRef
        if (!w || w.isDestroyed()) return
        w.show()
        w.focus()
        try {
          w.webContents.focus()
        } catch {
          /* ignore */
        }
        try {
          w.focusOnWebView()
        } catch {
          /* ignore */
        }
      },
    },
  ]
  if (liveWallpaperTrayHooks?.isActive()) {
    items.push({
      label: '停止桌面动态壁纸',
      click: () => liveWallpaperTrayHooks?.stop(),
    })
  }
  items.push(
    { type: 'separator' },
    {
      label: '退出',
      click: () => (globalThis as unknown as { workbreakQuit?: () => void }).workbreakQuit?.(),
    },
  )
  tray.setContextMenu(Menu.buildFromTemplate(items))
}

function disposeTrayIfAny() {
  if (!tray) return
  /** 勿对 Tray removeAllListeners：可能破坏 Electron 内部回调，仅 destroy 即可 */
  try {
    tray.destroy()
  } catch {
    /* ignore */
  }
  tray = null
}

export function createTray(mainWindow: BrowserWindow) {
  /** 同一进程内若重复 createWindow 会再次调用此处；不先销户则会叠多个托盘图标。 */
  disposeTrayIfAny()
  mainWindowRef = mainWindow
  const icon = resolveTrayIcon()
  const size = process.platform === 'win32' ? 32 : 22
  let trayImage: Electron.NativeImage
  try {
    trayImage = icon.isEmpty() ? nativeImage.createFromDataURL(TRAY_ICON_DATA) : icon
    trayImage = trayImage.resize({ width: size, height: size })
  } catch {
    trayImage = nativeImage.createFromDataURL(TRAY_ICON_DATA).resize({ width: size, height: size })
  }
  tray = new Tray(trayImage)

  tray.setToolTip('WorkBreak - 点击图标打开设置；点窗口× 会退到托盘（未退出）')
  rebuildTrayMenu()
  const showAndFocus = () => {
    const w = mainWindow
    if (!w || w.isDestroyed()) return
    w.show()
    w.focus()
    try {
      w.webContents.focus()
    } catch {
      /* ignore */
    }
    try {
      w.focusOnWebView()
    } catch {
      /* ignore */
    }
  }
  tray.on('double-click', showAndFocus)
  tray.on('click', showAndFocus)
}

export function destroyTray() {
  disposeTrayIfAny()
  mainWindowRef = null
  liveWallpaperTrayHooks = null
}
