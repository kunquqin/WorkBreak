import { app, BrowserWindow, screen, type BrowserWindowConstructorOptions } from 'electron'
import { execFile } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PopupTheme } from '../shared/settings'
import { ensureThemeLayers, stripBindingContentAndEnsureDateForDesktop } from '../shared/popupThemeLayers'
import {
  buildReminderHtml,
  buildReminderHtmlLegacy,
  getPopupTempDir,
  writePopupHtmlToTempFile,
} from './reminderWindow'

/** 归一化主题；必要时补日期层（主文案与装饰层原样保留） */
export function prepareThemeForDesktopWallpaper(themeRaw: PopupTheme): PopupTheme {
  let t = ensureThemeLayers({ ...themeRaw })
  const desk = stripBindingContentAndEnsureDateForDesktop(t)
  return { ...t, ...desk }
}

/** 写入临时 HTML（主路径 + legacy 回退），供动态桌面窗口或未来快照导出共用 */
export function writeDesktopWallpaperHtmlFiles(theme: PopupTheme): {
  primaryPath: string
  fallbackPath: string
} {
  const htmlDir = getPopupTempDir()
  const loc = (theme.dateLocale ?? '').trim() || 'zh-CN'
  const timeStr = new Date().toLocaleTimeString(loc, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const options = {
    title: '喵息',
    body: '',
    timeStr,
    theme,
    liveDesktopWallpaper: true as const,
  }
  const html = buildReminderHtml(options, htmlDir)
  const ensured = theme.layers?.length ? ensureThemeLayers(theme) : theme
  const fallbackHtml = buildReminderHtmlLegacy(
    {
      title: options.title,
      body: '',
      timeStr: options.timeStr,
      theme: ensured,
    },
    htmlDir,
  )
  const stamp = Date.now()
  return {
    primaryPath: writePopupHtmlToTempFile(`wb-live-wallpaper-${stamp}.html`, html),
    fallbackPath: writePopupHtmlToTempFile(`wb-live-wallpaper-fallback-${stamp}.html`, fallbackHtml),
  }
}

function setWindowsWallpaper(absPathWin: string): Promise<string | null> {
  const escaped = absPathWin.replace(/'/g, "''")
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WBWall {
  [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern int SystemParametersInfo(int uAction, int uParam, string lpvParam, int fuWinIni);
}
"@
[WBWall]::SystemParametersInfo(20, 0, '${escaped}', 3)
`.trim()
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: 45_000, windowsHide: true },
      (err, _stdout, stderr) => {
        if (err) {
          resolve(
            err.message ||
              (typeof stderr === 'string' && stderr.trim()) ||
              '调用系统接口设置壁纸失败',
          )
        } else resolve(null)
      },
    )
  })
}

const CAPTURE_SETTLE_MS = 1200

/**
 * 未来降级：仅静态单图、无轮播时可用 PNG + SPI_SETDESKWALLPAPER。
 * 当前「设为桌面壁纸」入口使用全屏动态窗口，不调用本函数。
 */
export async function captureDesktopWallpaperSnapshotAndApplySpi(
  themeRaw: PopupTheme,
): Promise<{ success: true } | { success: false; error: string }> {
  if (process.platform !== 'win32') {
    return {
      success: false,
      error: '当前系统暂不支持（仅 Windows）。',
    }
  }

  const theme = prepareThemeForDesktopWallpaper(themeRaw)
  const { primaryPath, fallbackPath } = writeDesktopWallpaperHtmlFiles(theme)

  const primary = screen.getPrimaryDisplay()
  const { x, y, width, height } = primary.bounds

  const win32Edge: Pick<BrowserWindowConstructorOptions, 'thickFrame' | 'hasShadow'> =
    process.platform === 'win32' ? { thickFrame: false, hasShadow: false } : {}

  const win = new BrowserWindow({
    x,
    y,
    width,
    height,
    show: false,
    frame: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    hasShadow: false,
    roundedCorners: false,
    transparent: false,
    backgroundColor: '#000000',
    ...win32Edge,
    webPreferences: { nodeIntegration: false, contextIsolation: true, zoomFactor: 1 },
  })

  try {
    try {
      await win.loadFile(primaryPath)
    } catch {
      await win.loadFile(fallbackPath)
    }
    await new Promise<void>((r) => {
      setTimeout(r, CAPTURE_SETTLE_MS)
    })
    const img = await win.webContents.capturePage()
    const outDir = join(app.getPath('userData'), 'wallpaper-export')
    mkdirSync(outDir, { recursive: true })
    const pngPath = join(outDir, `desktop-wallpaper-${Date.now()}.png`)
    writeFileSync(pngPath, img.toPNG())

    const wallErr = await setWindowsWallpaper(pngPath)
    if (wallErr) return { success: false, error: wallErr }
    return { success: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { success: false, error: msg || '导出或设置壁纸失败' }
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}
