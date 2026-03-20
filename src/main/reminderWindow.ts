import { app, BrowserWindow, screen } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { PopupTheme } from '../shared/settings'

export interface ReminderPopupOptions {
  title: string
  body: string
  timeStr: string
  theme?: PopupTheme
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeCssUrl(s: string): string {
  return s.replace(/["\\]/g, '\\$&')
}

function clampOpacity(v: number | undefined, fallback: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.min(1, n))
}

function readLocalImageAsDataUrl(imagePath: string): string | null {
  if (!existsSync(imagePath)) return null
  try {
    const ext = extname(imagePath).toLowerCase()
    const mime =
      ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
        : ext === '.png' ? 'image/png'
          : ext === '.gif' ? 'image/gif'
            : ext === '.webp' ? 'image/webp'
              : ext === '.bmp' ? 'image/bmp'
                : null
    if (!mime) return null
    const base64 = readFileSync(imagePath).toString('base64')
    return `data:${mime};base64,${base64}`
  } catch {
    return null
  }
}

function getBackgroundStyle(theme: PopupTheme | undefined): string {
  if (!theme) return 'background-color: #000000;'
  if (theme.backgroundType === 'image') {
    const folderFiles = Array.isArray(theme.imageFolderFiles) ? theme.imageFolderFiles : []
    const folderCandidate =
      theme.imageSourceType === 'folder' && folderFiles.length > 0
        ? (
            theme.imageFolderPlayMode === 'random'
              ? folderFiles[Math.floor(Math.random() * folderFiles.length)]
              : folderFiles[Math.floor(Date.now() / 1000 / Math.max(1, theme.imageFolderIntervalSec ?? 30)) % folderFiles.length]
          )
        : undefined
    const candidate = folderCandidate || theme.imagePath
    if (!candidate) return `background-color: ${theme.backgroundColor || '#000000'};`
    const dataUrl = readLocalImageAsDataUrl(candidate)
    if (dataUrl) {
      return `background-image: url("${escapeCssUrl(dataUrl)}"); background-size: cover; background-position: center; background-repeat: no-repeat; background-color: ${theme.backgroundColor || '#000000'};`
    }
  }
  return `background-color: ${theme.backgroundColor || '#000000'};`
}

function writePopupHtmlToTempFile(fileName: string, html: string): string {
  const dir = join(app.getPath('temp'), 'workbreak-popups')
  mkdirSync(dir, { recursive: true })
  const filePath = join(dir, fileName)
  writeFileSync(filePath, html, 'utf8')
  return filePath
}

function buildReminderHtml(options: ReminderPopupOptions): string {
  const { title, body, timeStr, theme } = options
  const titleEsc = escapeHtml(title)
  const bodyEsc = escapeHtml(body)
  const timeEsc = escapeHtml(timeStr)
  const textAlign = theme?.textAlign ?? 'center'
  const alignItems = textAlign === 'left' ? 'flex-start' : textAlign === 'right' ? 'flex-end' : 'center'
  const contentFont = Math.max(14, Math.min(120, Math.floor(theme?.contentFontSize ?? 56)))
  const timeFont = Math.max(10, Math.min(100, Math.floor(theme?.timeFontSize ?? 30)))
  const contentColor = theme?.contentColor || '#ffffff'
  const timeColor = theme?.timeColor || '#e2e8f0'
  const overlayEnabled = Boolean(theme?.overlayEnabled)
  const overlayColor = theme?.overlayColor || '#000000'
  const overlayOpacity = clampOpacity(theme?.overlayOpacity, 0.45)
  const bgStyle = getBackgroundStyle(theme)

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${titleEsc}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; color: #fff; font-family: system-ui, "Microsoft YaHei", sans-serif; overflow: hidden; ${bgStyle} }
    .overlay { position: fixed; inset: 0; background: ${overlayColor}; opacity: ${overlayEnabled ? overlayOpacity : 0}; pointer-events: none; }
    .content { position: relative; z-index: 1; width: 100%; height: 100%; display: flex; flex-direction: column; align-items: ${alignItems}; justify-content: center; padding: min(5vw, 48px); }
    .line1 { width: 100%; font-size: clamp(20px, 6vw, ${contentFont}px); color: ${contentColor}; text-align: ${textAlign}; line-height: 1.35; margin-bottom: clamp(16px, 3vw, 40px); font-weight: 600; max-width: 96vw; white-space: pre-wrap; }
    .line2 { width: 100%; font-size: clamp(14px, 3vw, ${timeFont}px); color: ${timeColor}; text-align: ${textAlign}; margin-bottom: clamp(32px, 5vw, 64px); max-width: 96vw; }
    .close-floating {
      position: fixed;
      top: clamp(12px, 2vw, 28px);
      right: clamp(12px, 2vw, 28px);
      width: clamp(50px, 5.2vw, 68px);
      height: clamp(50px, 5.2vw, 68px);
      border: none;
      border-radius: 9999px;
      background: rgba(0, 0, 0, 0.72);
      color: #fff;
      line-height: 1;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.18s ease;
      z-index: 3;
    }
    .close-floating svg {
      width: 52%;
      height: 52%;
      stroke: #fff;
      stroke-width: 1.8;
      stroke-linecap: round;
    }
    .close-floating.show {
      opacity: 1;
      pointer-events: auto;
    }
    .close-floating:hover {
      background: rgba(0, 0, 0, 0.84);
    }
  </style>
</head>
<body>
  <div class="overlay"></div>
  <div class="content">
    <div class="line1">${bodyEsc}</div>
    <div class="line2">${timeEsc}</div>
  </div>
  <button class="close-floating" id="closeBtn" aria-label="关闭弹窗">
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <line x1="6" y1="6" x2="18" y2="18"></line>
      <line x1="18" y1="6" x2="6" y2="18"></line>
    </svg>
  </button>
  <script>
    (function() {
      var btn = document.getElementById('closeBtn');
      var hideTimer = null;
      function showClose() {
        if (!btn) return;
        btn.classList.add('show');
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = setTimeout(function() {
          btn.classList.remove('show');
        }, 1300);
      }
      window.addEventListener('mousemove', showClose, { passive: true });
      window.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') window.close();
      });
      if (btn) btn.onclick = function() { window.close(); };
    })();
  </script>
</body>
</html>`
}

/** 全局唯一提醒弹窗：新提醒覆盖当前内容，不叠多个窗口 */
let reminderPopupWindow: BrowserWindow | null = null

function applyDisplayBounds(win: BrowserWindow) {
  const primary = screen.getPrimaryDisplay()
  const { x, y, width, height } = primary.bounds
  win.setBounds({ x, y, width, height })
}

function presentReminderWindow(win: BrowserWindow) {
  if (win.isDestroyed()) return
  win.show()
  win.focus()
  win.setAlwaysOnTop(true, 'screen-saver')
}

/** 到点提醒：铺满当前主显示器（含任务栏区域，与任务栏重叠） */
export function showReminderPopup(options: ReminderPopupOptions) {
  const html = buildReminderHtml(options)
  const fallbackHtml = buildReminderHtml({ ...options, theme: undefined })
  const htmlPath = writePopupHtmlToTempFile('reminder-popup.html', html)
  const fallbackPath = writePopupHtmlToTempFile('reminder-popup-fallback.html', fallbackHtml)

  if (reminderPopupWindow && !reminderPopupWindow.isDestroyed()) {
    applyDisplayBounds(reminderPopupWindow)
    void reminderPopupWindow.loadFile(htmlPath).then(() => {
      const w = reminderPopupWindow
      if (w && !w.isDestroyed()) presentReminderWindow(w)
    }).catch(() => {
      const w = reminderPopupWindow
      if (!w || w.isDestroyed()) return
      void w.loadFile(fallbackPath).then(() => {
        if (!w.isDestroyed()) presentReminderWindow(w)
      }).catch(() => {})
    })
    return
  }

  const primary = screen.getPrimaryDisplay()
  const { x, y, width, height } = primary.bounds

  reminderPopupWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  reminderPopupWindow.on('closed', () => {
    reminderPopupWindow = null
  })

  void reminderPopupWindow.loadFile(htmlPath).then(() => {
    const w = reminderPopupWindow
    if (w && !w.isDestroyed()) presentReminderWindow(w)
  }).catch(() => {
    const w = reminderPopupWindow
    if (!w || w.isDestroyed()) return
    void w.loadFile(fallbackPath).then(() => {
      if (!w.isDestroyed()) presentReminderWindow(w)
    }).catch(() => {})
  })
}

/** 若存在提醒弹窗则关闭（例如应用退出前可选调用） */
export function closeReminderPopupIfAny() {
  if (reminderPopupWindow && !reminderPopupWindow.isDestroyed()) {
    reminderPopupWindow.close()
    reminderPopupWindow = null
  }
}

/* ─── 休息即将结束：倒计时弹窗 ─── */

function buildRestEndCountdownHtml(countdownSec: number, content: string, timeStr: string, theme?: PopupTheme): string {
  const contentEsc = escapeHtml(content)
  const timeEsc = escapeHtml(timeStr)
  const sec = Math.max(1, Math.min(countdownSec, 99))
  const textAlign = theme?.textAlign ?? 'center'
  const alignItems = textAlign === 'left' ? 'flex-start' : textAlign === 'right' ? 'flex-end' : 'center'
  const contentColor = theme?.contentColor || '#ffffff'
  const timeColor = theme?.timeColor || '#e2e8f0'
  const countdownColor = theme?.countdownColor || '#ffffff'
  const overlayEnabled = Boolean(theme?.overlayEnabled)
  const overlayColor = theme?.overlayColor || '#000000'
  const overlayOpacity = clampOpacity(theme?.overlayOpacity, 0.4)
  const bgStyle = getBackgroundStyle(theme)
  const contentFont = Math.max(14, Math.min(120, Math.floor(theme?.contentFontSize ?? 40)))
  const timeFont = Math.max(10, Math.min(100, Math.floor(theme?.timeFontSize ?? 24)))
  const countdownFont = Math.max(48, Math.min(280, Math.floor(theme?.countdownFontSize ?? 180)))
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>休息即将结束</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; color: #fff; font-family: system-ui, "Microsoft YaHei", sans-serif; overflow: hidden; ${bgStyle} }
    .overlay { position: fixed; inset: 0; background: ${overlayColor}; opacity: ${overlayEnabled ? overlayOpacity : 0}; pointer-events: none; }
    .content { position: relative; z-index: 1; width: 100%; height: 100%; display: flex; flex-direction: column; align-items: ${alignItems}; justify-content: center; padding: min(5vw, 48px); }
    .line1 { width: 100%; font-size: clamp(20px, 6vw, ${contentFont}px); color: ${contentColor}; text-align: ${textAlign}; line-height: 1.35; margin-bottom: clamp(16px, 3vw, 40px); font-weight: 600; max-width: 96vw; white-space: pre-wrap; }
    .line2 { width: 100%; font-size: clamp(14px, 3vw, ${timeFont}px); color: ${timeColor}; text-align: ${textAlign}; margin-bottom: clamp(24px, 4vw, 56px); max-width: 96vw; }
    .countdown { width: 100%; color: ${countdownColor}; font-size: clamp(80px, 20vw, ${countdownFont}px); font-weight: 700; text-align: ${textAlign}; line-height: 1; font-variant-numeric: tabular-nums; transition: transform 0.15s ease-out, opacity 0.15s ease-out; max-width: 96vw; }
    .countdown.tick { transform: scale(1.15); opacity: 0.7; }
    .close-floating {
      position: fixed;
      top: clamp(12px, 2vw, 28px);
      right: clamp(12px, 2vw, 28px);
      width: clamp(50px, 5.2vw, 68px);
      height: clamp(50px, 5.2vw, 68px);
      border: none;
      border-radius: 9999px;
      background: rgba(0, 0, 0, 0.72);
      color: #fff;
      line-height: 1;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.18s ease;
      z-index: 3;
    }
    .close-floating svg {
      width: 52%;
      height: 52%;
      stroke: #fff;
      stroke-width: 1.8;
      stroke-linecap: round;
    }
    .close-floating.show {
      opacity: 1;
      pointer-events: auto;
    }
    .close-floating:hover {
      background: rgba(0, 0, 0, 0.84);
    }
  </style>
</head>
<body>
  <div class="overlay"></div>
  <div class="content">
    <div class="line1">${contentEsc}</div>
    <div class="line2">${timeEsc}</div>
    <div class="countdown" id="cd">${sec}</div>
  </div>
  <button class="close-floating" id="closeBtn" aria-label="关闭弹窗">
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <line x1="6" y1="6" x2="18" y2="18"></line>
      <line x1="18" y1="6" x2="6" y2="18"></line>
    </svg>
  </button>
  <script>
    (function(){
      var remaining = ${sec};
      var el = document.getElementById('cd');
      var closeBtn = document.getElementById('closeBtn');
      var hideTimer = null;
      function showClose() {
        if (!closeBtn) return;
        closeBtn.classList.add('show');
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = setTimeout(function() {
          closeBtn.classList.remove('show');
        }, 1300);
      }
      function tick() {
        remaining--;
        if (remaining <= 0) {
          el.textContent = '0';
          setTimeout(function(){ window.close(); }, 300);
          return;
        }
        el.textContent = String(remaining);
        el.classList.add('tick');
        setTimeout(function(){ el.classList.remove('tick'); }, 150);
        setTimeout(tick, 1000);
      }
      window.addEventListener('mousemove', showClose, { passive: true });
      window.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') window.close();
      });
      if (closeBtn) closeBtn.onclick = function() { window.close(); };
      setTimeout(tick, 1000);
    })();
  </script>
</body>
</html>`
}

/**
 * 休息即将结束倒计时弹窗：全屏黑底，大数字从 countdownSec 倒数到 0 后自动关闭。
 * 复用同一个 reminderPopupWindow 单例（覆盖当前休息提醒弹窗内容）。
 */
export function showRestEndCountdownPopup(countdownSec: number, content: string, theme?: PopupTheme) {
  const now = new Date()
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const html = buildRestEndCountdownHtml(countdownSec, content, timeStr, theme)
  const fallbackHtml = buildRestEndCountdownHtml(countdownSec, content, timeStr, undefined)
  const htmlPath = writePopupHtmlToTempFile('rest-countdown-popup.html', html)
  const fallbackPath = writePopupHtmlToTempFile('rest-countdown-popup-fallback.html', fallbackHtml)

  if (reminderPopupWindow && !reminderPopupWindow.isDestroyed()) {
    applyDisplayBounds(reminderPopupWindow)
    void reminderPopupWindow.loadFile(htmlPath).then(() => {
      const w = reminderPopupWindow
      if (w && !w.isDestroyed()) presentReminderWindow(w)
    }).catch(() => {
      const w = reminderPopupWindow
      if (!w || w.isDestroyed()) return
      void w.loadFile(fallbackPath).then(() => {
        if (!w.isDestroyed()) presentReminderWindow(w)
      }).catch(() => {})
    })
    return
  }

  const primary = screen.getPrimaryDisplay()
  const { x, y, width, height } = primary.bounds

  reminderPopupWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  reminderPopupWindow.on('closed', () => {
    reminderPopupWindow = null
  })

  void reminderPopupWindow.loadFile(htmlPath).then(() => {
    const w = reminderPopupWindow
    if (w && !w.isDestroyed()) presentReminderWindow(w)
  }).catch(() => {
    const w = reminderPopupWindow
    if (!w || w.isDestroyed()) return
    void w.loadFile(fallbackPath).then(() => {
      if (!w.isDestroyed()) presentReminderWindow(w)
    }).catch(() => {})
  })
}
