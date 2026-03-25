import { nativeImage, Tray, Menu, BrowserWindow } from 'electron'

/** 16x16 简单托盘图标（灰底 + 深色） */
const TRAY_ICON_DATA =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAOklEQVQ4T2NkYGD4z0ABYBzVMGoB1AIMDP8ZGBj+M/xnYGD4z8DAwMgw6gYGBgZGBkYGBob/ow4YdQODAwMAuIkL/0eLhJAAAAAASUVORK5CYII='

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

export function createTray(mainWindow: BrowserWindow) {
  mainWindowRef = mainWindow
  const icon = nativeImage.createFromDataURL(TRAY_ICON_DATA)
  const size = process.platform === 'win32' ? 32 : 22
  tray = new Tray(icon.resize({ width: size, height: size }))

  tray.setToolTip('WorkBreak - 可配置提醒')
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
  if (tray) {
    tray.destroy()
    tray = null
  }
  mainWindowRef = null
  liveWallpaperTrayHooks = null
}
