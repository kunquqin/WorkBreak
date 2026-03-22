import { app, BrowserWindow, screen } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { PopupTheme, TextTransform } from '../shared/settings'
import { layerTextEffectsCss } from '../shared/popupTextEffects'
import { resolvePopupFontFamilyCss } from '../shared/popupThemeFonts'

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

function transformStyle(t: TextTransform | undefined, fallbackX: number, fallbackY: number): string {
  const x = t?.x ?? fallbackX
  const y = t?.y ?? fallbackY
  const r = t?.rotation ?? 0
  const s = t?.scale ?? 1
  return `position: absolute; left: ${x}%; top: ${y}%; transform: translate(-50%, -50%) rotate(${r}deg) scale(${s}); transform-origin: center;`
}

/** 文字层固定排版区域（与 ThemePreviewEditor 中 textBoxWidthPct / textBoxHeightPct 一致） */
type TextBoxLayer = 'content' | 'time' | 'countdown'

/** 时间与倒计时为实时单行数据，nowrap 避免窄 textBox 下被 overflow-wrap:anywhere 拆成「1」「2」「:」多行 */
function textBoxLayoutCss(t: TextTransform | undefined, layer: TextBoxLayer): string {
  const w = t?.textBoxWidthPct
  const h = t?.textBoxHeightPct
  const lockW = t?.shortLayerTextBoxLockWidth === true
  let s = ''
  if (layer === 'content') {
    if (w != null && Number.isFinite(w)) {
      const wp = Math.max(5, Math.min(96, w))
      s += `width: ${wp}%; max-width: 100%; box-sizing: border-box;`
    } else {
      s += 'max-width: 96vw;'
    }
  } else {
    // time / countdown：默认横向贴字宽（与预览 Moveable 外框一致）；锁定后才是定宽条
    s += 'box-sizing: border-box;'
    if (lockW && w != null && Number.isFinite(w)) {
      const wp = Math.max(5, Math.min(96, w))
      s += `width: ${wp}%; max-width: 100%;`
    } else {
      s += 'width: max-content;'
      if (w != null && Number.isFinite(w)) {
        s += ` max-width: ${Math.max(5, Math.min(96, w))}%;`
      } else {
        s += ' max-width: 96vw;'
      }
    }
  }
  if (h != null && Number.isFinite(h)) {
    const hp = Math.max(3, Math.min(100, h))
    // 时间/倒计时单行 nowrap：auto 在固定高度下易误出纵向滚动条；主文案多行仍 auto 以容纳长文
    const ov = layer === 'content' ? 'auto' : 'hidden'
    s += ` height: ${hp}%; max-height: 100%; overflow: ${ov};`
  }
  if (layer === 'content') {
    // 与 ThemePreviewEditor 一致：不用 overflow-wrap:anywhere，避免窄框下中文被逐字强拆行（与编辑态不一致）
    s += ' white-space: pre-wrap; word-wrap: break-word; overflow-wrap: break-word; word-break: keep-all;'
  } else {
    s += ' white-space: nowrap; word-break: keep-all; overflow-wrap: normal;'
  }
  return s
}

/** 各文字层排版：对齐 / 字间距 / 行高（缺省回落 textAlign 与内置行高） */
function layerTypographyCss(theme: PopupTheme | undefined, layer: 'content' | 'time' | 'countdown'): string {
  const baseAlign = theme?.textAlign ?? 'center'
  let align = baseAlign
  let letterSpacing = 0
  let lineHeight = layer === 'countdown' ? 1 : 1.35
  if (layer === 'content') {
    align = theme?.contentTextAlign ?? baseAlign
    letterSpacing = theme?.contentLetterSpacing ?? 0
    lineHeight = theme?.contentLineHeight ?? 1.35
  } else if (layer === 'time') {
    align = theme?.timeTextAlign ?? baseAlign
    letterSpacing = theme?.timeLetterSpacing ?? 0
    lineHeight = theme?.timeLineHeight ?? 1.35
  } else {
    align = theme?.countdownTextAlign ?? baseAlign
    letterSpacing = theme?.countdownLetterSpacing ?? 0
    lineHeight = theme?.countdownLineHeight ?? 1
  }
  return `text-align: ${align}; letter-spacing: ${letterSpacing}px; line-height: ${lineHeight};`
}

function buildReminderHtml(options: ReminderPopupOptions): string {
  const { title, body, timeStr, theme } = options
  const titleEsc = escapeHtml(title)
  const bodyEsc = escapeHtml(body)
  const timeEsc = escapeHtml(timeStr)
  const contentFont = Math.max(1, Math.min(8000, Math.floor(theme?.contentFontSize ?? 56)))
  const timeFont = Math.max(1, Math.min(8000, Math.floor(theme?.timeFontSize ?? 30)))
  const contentColor = theme?.contentColor || '#ffffff'
  const timeColor = theme?.timeColor || '#e2e8f0'
  const overlayEnabled = Boolean(theme?.overlayEnabled)
  const overlayColor = theme?.overlayColor || '#000000'
  const overlayOpacity = clampOpacity(theme?.overlayOpacity, 0.45)
  const bgStyle = getBackgroundStyle(theme)
  const contentFontFamilyCss = resolvePopupFontFamilyCss(theme, 'content')
  const timeFontFamilyCss = resolvePopupFontFamilyCss(theme, 'time')
  const contentPos = transformStyle(theme?.contentTransform, 50, 42)
  const timePos = transformStyle(theme?.timeTransform, 50, 55)
  const contentWeight = theme?.contentFontWeight ?? 600
  const timeWeight = theme?.timeFontWeight ?? 400
  const tyContent = layerTypographyCss(theme, 'content')
  const tyTime = layerTypographyCss(theme, 'time')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${titleEsc}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; color: #fff; font-family: system-ui, sans-serif; overflow: hidden; ${bgStyle} }
    .overlay { position: fixed; inset: 0; background: ${overlayColor}; opacity: ${overlayEnabled ? overlayOpacity : 0}; pointer-events: none; }
    .content { position: relative; z-index: 1; width: 100%; height: 100%; }
    .line1 { ${contentPos} font-family: ${contentFontFamilyCss}; font-size: ${contentFont}px; color: ${contentColor}; ${tyContent} font-weight: ${contentWeight}; ${textBoxLayoutCss(theme?.contentTransform, 'content')} ${layerTextEffectsCss(theme, 'content')} }
    .line2 { ${timePos} font-family: ${timeFontFamilyCss}; font-size: ${timeFont}px; color: ${timeColor}; ${tyTime} font-weight: ${timeWeight}; ${textBoxLayoutCss(theme?.timeTransform, 'time')} ${layerTextEffectsCss(theme, 'time')} }
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
let popupSeq = 0
let popupChain: Promise<void> = Promise.resolve()

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

function ensurePopupWindow(): BrowserWindow {
  if (reminderPopupWindow && !reminderPopupWindow.isDestroyed()) {
    return reminderPopupWindow
  }
  const primary = screen.getPrimaryDisplay()
  const { x, y, width, height } = primary.bounds
  const win = new BrowserWindow({
    x, y, width, height,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: true,
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })
  win.on('closed', () => {
    if (reminderPopupWindow === win) reminderPopupWindow = null
  })
  reminderPopupWindow = win
  return win
}

function enqueuePopupLoad(htmlPath: string, fallbackPath: string) {
  const seq = ++popupSeq
  popupChain = popupChain.then(async () => {
    if (seq !== popupSeq) return
    try {
      const win = ensurePopupWindow()
      applyDisplayBounds(win)
      try {
        await win.loadFile(htmlPath)
      } catch {
        if (win.isDestroyed() || seq !== popupSeq) return
        await win.loadFile(fallbackPath).catch(() => {})
      }
      if (!win.isDestroyed() && seq === popupSeq) presentReminderWindow(win)
    } catch { /* window destroyed during operation — safe to ignore */ }
  })
}

/** 到点提醒：铺满当前主显示器（含任务栏区域，与任务栏重叠） */
export function showReminderPopup(options: ReminderPopupOptions) {
  const html = buildReminderHtml(options)
  const fallbackHtml = buildReminderHtml({ ...options, theme: undefined })
  const htmlPath = writePopupHtmlToTempFile('reminder-popup.html', html)
  const fallbackPath = writePopupHtmlToTempFile('reminder-popup-fallback.html', fallbackHtml)
  enqueuePopupLoad(htmlPath, fallbackPath)
}

/** 若存在提醒弹窗则关闭（例如应用退出前可选调用） */
export function closeReminderPopupIfAny() {
  popupSeq++
  if (reminderPopupWindow && !reminderPopupWindow.isDestroyed()) {
    reminderPopupWindow.close()
    reminderPopupWindow = null
  }
}

/* ─── 休息即将结束：倒计时弹窗 ─── */

/** 休息段最后 N 秒：与休息主题硬切，固定黑底白字，不读主题壁纸/遮罩/排版 */
function buildRestEndCountdownHtml(countdownSec: number): string {
  const sec = Math.max(1, Math.min(countdownSec, 99))
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>休息即将结束</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; color: #fff; font-family: system-ui, "Segoe UI", sans-serif; overflow: hidden; background: #000000; }
    .stack {
      position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
      z-index: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: clamp(10px, 2.2vmin, 28px); text-align: center; padding: 2vmin;
    }
    .title { font-size: clamp(30px, 5.5vmin, 64px); font-weight: 600; line-height: 1.25; color: #ffffff; }
    .countdown {
      font-size: clamp(104px, 28vmin, 340px); font-weight: 700; line-height: 1; color: #ffffff;
      font-variant-numeric: tabular-nums;
      transition: scale 0.15s ease-out, opacity 0.15s ease-out;
    }
    .countdown.tick { scale: 1.15; opacity: 0.7; }
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
  <div class="stack">
    <div class="title">休息即将结束</div>
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
 * 休息即将结束倒计时弹窗：全屏固定黑底白字，大数字从 countdownSec 倒数到 0 后自动关闭。
 * 复用同一个 reminderPopupWindow 单例（覆盖当前休息提醒弹窗内容）。
 */
export function showRestEndCountdownPopup(countdownSec: number) {
  const html = buildRestEndCountdownHtml(countdownSec)
  const htmlPath = writePopupHtmlToTempFile('rest-countdown-popup.html', html)
  const fallbackPath = writePopupHtmlToTempFile('rest-countdown-popup-fallback.html', html)
  enqueuePopupLoad(htmlPath, fallbackPath)
}
