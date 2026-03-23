import { app, BrowserWindow, screen } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { PopupTheme, TextTransform } from '../shared/settings'
import { ensureThemeLayers } from '../shared/settings'
import type { ImageThemeLayer, PopupThemeLayer, TextThemeLayer } from '../shared/popupThemeLayers'
import { layerTextEffectsCss, layerTextEffectsCssFromEffects } from '../shared/popupTextEffects'
import { resolveDecoFontFamilyCss, resolvePopupFontFamilyCss } from '../shared/popupThemeFonts'

export interface ReminderPopupOptions {
  title: string
  body: string
  timeStr: string
  theme?: PopupTheme
  /**
   * 已废弃：休息段中途不在主题壁纸页叠倒计时（最后 N 秒用 `showRestEndCountdownPopup` 硬切全屏）。
   * 保留字段仅为类型兼容，主进程不应再传入。
   */
  countdownStr?: string
}

function resolveThemeBodyText(theme: PopupTheme | undefined, fallbackBody: string): string {
  if (!theme) return fallbackBody
  const fromPreview = (theme.previewContentText ?? '').trim()
  if (fromPreview) return fromPreview
  const fromBinding = theme.layers?.find(
    (l): l is TextThemeLayer => l.kind === 'text' && (l as TextThemeLayer).bindsReminderBody === true,
  )
  const fromLayer = (fromBinding?.text ?? '').trim()
  if (fromLayer) return fromLayer
  return fallbackBody
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * 图层路径用 `style="..."` 拼整条 CSS 时，`font-family: system-ui, "Microsoft YaHei", sans-serif`
 * 以及 `url("data:...")` 里的双引号会提前结束 HTML 属性，后续 font-size/color 全部失效 → 只剩 body 默认小白字、布局乱。
 * 写入属性前把 `"` 转成 `&quot;`（及 `&`），浏览器解码后 CSS 仍正确。
 */
function escapeInlineStyleForHtmlAttribute(css: string): string {
  return css.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

function escapeCssUrl(s: string): string {
  return s.replace(/["\\]/g, '\\$&')
}

function clampOpacity(v: number | undefined, fallback: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.min(1, n))
}

function normalizeAngleDeg(v: number | undefined, fallback: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  const mod = n % 360
  return mod < 0 ? mod + 360 : mod
}

function hexToRgba(hex: string, alpha: number): string {
  const a = clampOpacity(alpha, 1)
  const raw = (hex || '').trim()
  const m = raw.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
  if (!m) return `rgba(0,0,0,${a})`
  const h = m[1].length === 3
    ? m[1].split('').map((c) => c + c).join('')
    : m[1]
  const r = Number.parseInt(h.slice(0, 2), 16)
  const g = Number.parseInt(h.slice(2, 4), 16)
  const b = Number.parseInt(h.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${a})`
}

function overlayGradientCss(theme: PopupTheme | undefined): string {
  const color = theme?.overlayColor || '#000000'
  const mode = theme?.overlayMode === 'gradient' ? 'gradient' : 'solid'
  if (mode !== 'gradient') {
    return hexToRgba(color, clampOpacity(theme?.overlayOpacity, 0.45))
  }
  const start = clampOpacity(theme?.overlayGradientStartOpacity, 0.7)
  const end = clampOpacity(theme?.overlayGradientEndOpacity, 0)
  const dir = theme?.overlayGradientDirection ?? 'leftToRight'
  const angle =
    dir === 'custom' ? normalizeAngleDeg(theme?.overlayGradientAngleDeg, 90)
      : dir === 'rightToLeft' ? 270
        : dir === 'topToBottom' ? 180
          : dir === 'bottomToTop' ? 0
            : dir === 'topLeftToBottomRight' ? 135
              : dir === 'topRightToBottomLeft' ? 225
                : dir === 'bottomLeftToTopRight' ? 45
                  : dir === 'bottomRightToTopLeft' ? 315
                    : 90
  return `linear-gradient(${angle}deg, ${hexToRgba(color, start)} 0%, ${hexToRgba(color, end)} 100%)`
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

/** 解析当前应显示的一张壁纸绝对路径（与预览/图层栈一致）；不存在则 null */
function resolveBackgroundImageFilePath(theme: PopupTheme): string | null {
  if (theme.backgroundType !== 'image') return null
  const folderFiles = Array.isArray(theme.imageFolderFiles) ? theme.imageFolderFiles : []
  const folderCandidate =
    theme.imageSourceType === 'folder' && folderFiles.length > 0
      ? (
          theme.imageFolderPlayMode === 'random'
            ? folderFiles[Math.floor(Math.random() * folderFiles.length)]
            : folderFiles[Math.floor(Date.now() / 1000 / Math.max(1, theme.imageFolderIntervalSec ?? 30)) % folderFiles.length]
        )
      : undefined
  const candidate = (folderCandidate || theme.imagePath || '').trim()
  if (!candidate) return null
  return existsSync(candidate) ? candidate : null
}

function getBackgroundStyle(theme: PopupTheme | undefined): string {
  if (!theme) return 'background-color: #000000;'
  if (theme.backgroundType === 'image') {
    const p = resolveBackgroundImageFilePath(theme)
    if (!p) return `background-color: ${theme.backgroundColor || '#000000'};`
    const dataUrl = readLocalImageAsDataUrl(p)
    if (dataUrl) {
      return `background-image: url("${escapeCssUrl(dataUrl)}"); background-size: cover; background-position: center; background-repeat: no-repeat; background-color: ${theme.backgroundColor || '#000000'};`
    }
  }
  return `background-color: ${theme.backgroundColor || '#000000'};`
}

function getPopupTempDir(): string {
  const dir = join(app.getPath('temp'), 'workbreak-popups')
  mkdirSync(dir, { recursive: true })
  return dir
}

function writePopupHtmlToTempFile(fileName: string, html: string): string {
  const dir = getPopupTempDir()
  const filePath = join(dir, fileName)
  writeFileSync(filePath, html, 'utf8')
  return filePath
}

/** 将图层资源拷入与 HTML 同目录，避免超长 data: URL 嵌入 HTML */
function copyLayerImageForHtml(absSrc: string, htmlDir: string): string | null {
  if (!existsSync(absSrc)) return null
  try {
    const ext = extname(absSrc) || '.img'
    const base = `ly_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`
    const dest = join(htmlDir, base)
    copyFileSync(absSrc, dest)
    return base
  } catch {
    return null
  }
}

/** 与 Moveable 预览一致范围 0.1–5；磁盘上异常小数（如误写 0.02）会导致全屏弹窗字「只有几个像素」 */
function clampLayerTransformScale(raw: number | undefined): number {
  const s = Number(raw)
  if (!Number.isFinite(s)) return 1
  return Math.max(0.1, Math.min(5, s))
}

/** 主题字号写入磁盘时偶发非数字，Math.floor(NaN) 会导致 CSS font-size 无效、继承成系统小字 */
function safeFontPx(raw: unknown, fallback: number, minPx: number): number {
  const n = Math.floor(Number(raw))
  if (!Number.isFinite(n)) return fallback
  return Math.max(minPx, Math.min(8000, n))
}

function transformStyle(t: TextTransform | undefined, fallbackX: number, fallbackY: number): string {
  const xRaw = t?.x ?? fallbackX
  const yRaw = t?.y ?? fallbackY
  const x = Number.isFinite(Number(xRaw)) ? Math.max(0, Math.min(100, Number(xRaw))) : fallbackX
  const y = Number.isFinite(Number(yRaw)) ? Math.max(0, Math.min(100, Number(yRaw))) : fallbackY
  const rRaw = t?.rotation ?? 0
  const r = Number.isFinite(Number(rRaw)) ? (Number(rRaw) % 360) : 0
  const s = clampLayerTransformScale(t?.scale)
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
    if (layer === 'content') {
      s += ` height: ${hp}%; max-height: 100%; overflow: auto;`
    } else {
      // 时间/倒计时单行：高度随字行盒，textBoxHeightPct 仅作上限，与预览 Moveable 贴字边一致
      s += ` height: auto; max-height: ${hp}%; overflow: hidden;`
    }
  }
  if (layer === 'content') {
    // 与 ThemePreviewEditor 一致：不用 overflow-wrap:anywhere，避免窄框下中文被逐字强拆行（与编辑态不一致）
    s += ' white-space: pre-wrap; word-wrap: break-word; overflow-wrap: break-word; word-break: keep-all;'
  } else {
    s += ' white-space: nowrap; word-break: keep-all; overflow-wrap: normal;'
  }
  return s
}

/** 与 ThemePreviewEditor 中单行时间层：`shortLineLayer` 下强制 `lineHeight: 1` */
function layerTypographyCss(theme: PopupTheme | undefined, layer: 'content' | 'time' | 'countdown'): string {
  const baseAlign = theme?.textAlign ?? 'center'
  const baseVerticalAlign = theme?.textVerticalAlign ?? 'middle'
  let align = baseAlign
  let verticalAlign = baseVerticalAlign
  let letterSpacing = 0
  let lineHeight = layer === 'countdown' ? 1 : 1.35
  if (layer === 'content') {
    align = theme?.contentTextAlign ?? baseAlign
    verticalAlign = theme?.contentTextVerticalAlign ?? baseVerticalAlign
    letterSpacing = theme?.contentLetterSpacing ?? 0
    lineHeight = theme?.contentLineHeight ?? 1.35
  } else if (layer === 'time') {
    align = theme?.timeTextAlign ?? baseAlign
    verticalAlign = theme?.timeTextVerticalAlign ?? baseVerticalAlign
    letterSpacing = theme?.timeLetterSpacing ?? 0
    lineHeight = theme?.timeLineHeight ?? 1
  } else {
    align = theme?.countdownTextAlign ?? baseAlign
    verticalAlign = theme?.countdownTextVerticalAlign ?? baseVerticalAlign
    letterSpacing = theme?.countdownLetterSpacing ?? 0
    lineHeight = theme?.countdownLineHeight ?? 1
  }
  return `text-align: ${align}; letter-spacing: ${letterSpacing}px; line-height: ${lineHeight}; --wb-v-align: ${verticalAlign};`
}

/** 与 ThemePreviewEditor 时间层 `display:flex` + `justifyContent` 一致 */
function flexJustifyForTextAlign(align: string): string {
  if (align === 'left' || align === 'start') return 'flex-start'
  if (align === 'right' || align === 'end') return 'flex-end'
  return 'center'
}

function flexAlignForTextVerticalAlign(align: string): string {
  if (align === 'top') return 'flex-start'
  if (align === 'bottom') return 'flex-end'
  return 'center'
}

function verticalAlignForThemeLayer(theme: PopupTheme | undefined, layer: 'content' | 'time' | 'countdown'): 'top' | 'middle' | 'bottom' {
  const base = theme?.textVerticalAlign ?? 'middle'
  if (layer === 'content') return (theme?.contentTextVerticalAlign ?? base) as 'top' | 'middle' | 'bottom'
  if (layer === 'time') return (theme?.timeTextVerticalAlign ?? base) as 'top' | 'middle' | 'bottom'
  return (theme?.countdownTextVerticalAlign ?? base) as 'top' | 'middle' | 'bottom'
}

/** 预览中各绑定文字层有 `padding: toPreviewPx(3)`；全屏按逻辑像素 3px 对齐 */
const BINDING_TEXT_PADDING_PX = 3

function textLayerTypographyCss(theme: PopupTheme | undefined, L: TextThemeLayer): string {
  const baseAlign = theme?.textAlign ?? 'center'
  const baseVerticalAlign = theme?.textVerticalAlign ?? 'middle'
  const align = L.textAlign ?? baseAlign
  const verticalAlign = L.textVerticalAlign ?? baseVerticalAlign
  const ls = L.letterSpacing ?? 0
  const lh = L.lineHeight ?? 1.35
  return `text-align: ${align}; letter-spacing: ${ls}px; line-height: ${lh}; --wb-v-align: ${verticalAlign};`
}

function verticalAlignForTextLayer(theme: PopupTheme | undefined, L: TextThemeLayer): 'top' | 'middle' | 'bottom' {
  const base = theme?.textVerticalAlign ?? 'middle'
  return (L.textVerticalAlign ?? base) as 'top' | 'middle' | 'bottom'
}

const REMINDER_CLOSE_CSS = `
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
      z-index: 99990;
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
    }`

const REMINDER_CLOSE_HTML_SCRIPT = `
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
  </script>`

/** 无主题或旧逻辑回退：背景在 body，遮罩 + 双文字层 */
function buildReminderHtmlLegacy(options: ReminderPopupOptions): string {
  const { title, body, timeStr, theme } = options
  const titleEsc = escapeHtml(title)
  const bodyEsc = escapeHtml(resolveThemeBodyText(theme, body))
  const timeEsc = escapeHtml(timeStr)
  const contentFont = safeFontPx(theme?.contentFontSize, 180, 16)
  const timeFont = safeFontPx(theme?.timeFontSize, 100, 14)
  const contentColor = theme?.contentColor || '#ffffff'
  const timeColor = theme?.timeColor || '#e2e8f0'
  const overlayEnabled = Boolean(theme?.overlayEnabled)
  const bgStyle = getBackgroundStyle(theme)
  const contentFontFamilyCss = resolvePopupFontFamilyCss(theme, 'content')
  const timeFontFamilyCss = resolvePopupFontFamilyCss(theme, 'time')
  const contentPos = transformStyle(theme?.contentTransform, 50, 42)
  const timePos = transformStyle(theme?.timeTransform, 50, 55)
  const contentWeight = theme?.contentFontWeight ?? 600
  const timeWeight = theme?.timeFontWeight ?? 400
  const contentItalic = theme?.contentFontItalic === true ? 'italic' : 'normal'
  const timeItalic = theme?.timeFontItalic === true ? 'italic' : 'normal'
  const contentUnderline = theme?.contentUnderline === true ? 'underline' : 'none'
  const timeUnderline = theme?.timeUnderline === true ? 'underline' : 'none'
  const tyContent = layerTypographyCss(theme, 'content')
  const tyTime = layerTypographyCss(theme, 'time')
  const contentVA = flexAlignForTextVerticalAlign(verticalAlignForThemeLayer(theme, 'content'))
  const timeVA = flexAlignForTextVerticalAlign(verticalAlignForThemeLayer(theme, 'time'))

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>${titleEsc}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; min-height: 100%; margin: 0; color: #fff; font-family: system-ui, sans-serif; overflow: hidden; ${bgStyle} }
    .overlay { position: fixed; inset: 0; background: ${overlayGradientCss(theme)}; opacity: ${overlayEnabled ? 1 : 0}; pointer-events: none; }
    .content { position: relative; z-index: 1; width: 100%; height: 100%; }
    .line1 { ${contentPos} box-sizing: border-box; padding: ${BINDING_TEXT_PADDING_PX}px; display:flex; flex-direction:column; justify-content:${contentVA}; font-family: ${contentFontFamilyCss}; font-size: ${contentFont}px; color: ${contentColor}; ${tyContent} font-weight: ${contentWeight}; font-style: ${contentItalic}; text-decoration: ${contentUnderline}; ${textBoxLayoutCss(theme?.contentTransform, 'content')} ${layerTextEffectsCss(theme, 'content')} }
    .line2 { ${timePos} box-sizing: border-box; padding: ${BINDING_TEXT_PADDING_PX}px; display: flex; align-items: ${timeVA}; justify-content: ${flexJustifyForTextAlign(theme?.timeTextAlign ?? theme?.textAlign ?? 'center')}; font-family: ${timeFontFamilyCss}; font-size: ${timeFont}px; color: ${timeColor}; ${tyTime} font-weight: ${timeWeight}; font-style: ${timeItalic}; text-decoration: ${timeUnderline}; ${textBoxLayoutCss(theme?.timeTransform, 'time')} ${layerTextEffectsCss(theme, 'time')} }
    ${REMINDER_CLOSE_CSS}
  </style>
</head>
<body>
  <div class="overlay"></div>
  <div class="content">
    <div class="line1">${bodyEsc}</div>
    <div class="line2">${timeEsc}</div>
  </div>
  ${REMINDER_CLOSE_HTML_SCRIPT}
</body>
</html>`
}

function renderLayerFragment(
  theme: PopupTheme,
  L: PopupThemeLayer,
  z: number,
  timeEsc: string,
  htmlDir: string,
): string {
  if (!L.visible) return ''
  switch (L.kind) {
    case 'background': {
      if (theme.backgroundType === 'image') {
        const p = resolveBackgroundImageFilePath(theme)
        if (p) {
          const base = copyLayerImageForHtml(p, htmlDir)
          if (base) {
            const urlEsc = escapeCssUrl(base)
            const bgc = theme.backgroundColor || '#000000'
            return `<div style="${escapeInlineStyleForHtmlAttribute(`position:absolute;inset:0;z-index:${z};pointer-events:none;background-image:url('./${urlEsc}');background-size:cover;background-position:center;background-repeat:no-repeat;background-color:${bgc};`)}"></div>`
          }
        }
      }
      const bg = getBackgroundStyle(theme)
      return `<div style="${escapeInlineStyleForHtmlAttribute(`position:absolute;inset:0;z-index:${z};pointer-events:none;${bg}`)}"></div>`
    }
    case 'overlay': {
      const overlayOpacity = theme.overlayEnabled ? 1 : 0
      return `<div style="${escapeInlineStyleForHtmlAttribute(`position:absolute;inset:0;z-index:${z};pointer-events:none;background:${overlayGradientCss(theme)};opacity:${overlayOpacity};`)}"></div>`
    }
    case 'text': {
      const tl = L as TextThemeLayer
      if (tl.bindsReminderBody) {
        /** 文本内容不再从提醒项注入，统一以主题编辑内容为准。 */
        const srcEsc = escapeHtml((tl.text ?? '').trim())
        /** 与 ThemePreviewEditor.renderTextLayerForKey(content) 一致：排版以主题根字段为准，保证时间样式等与预览一致。 */
        const fs = safeFontPx(theme.contentFontSize, 180, 16)
        const col = theme.contentColor || '#ffffff'
        const ff = resolvePopupFontFamilyCss(theme, 'content')
        const pos = transformStyle(theme.contentTransform, 50, 42)
        const fw = theme.contentFontWeight ?? 600
        const fi = theme.contentFontItalic === true ? 'italic' : 'normal'
        const td = theme.contentUnderline === true ? 'underline' : 'none'
        const ty = layerTypographyCss(theme, 'content')
        const va = flexAlignForTextVerticalAlign(verticalAlignForThemeLayer(theme, 'content'))
        const fx = layerTextEffectsCss(theme, 'content')
        const stBody = `${pos} z-index:${z}; pointer-events:none; box-sizing:border-box; padding:${BINDING_TEXT_PADDING_PX}px; display:flex; flex-direction:column; justify-content:${va}; font-family:${ff}; font-size:${fs}px; color:${col}; ${ty} font-weight:${fw}; font-style:${fi}; text-decoration:${td}; ${textBoxLayoutCss(theme.contentTransform, 'content')} ${fx}`
        return `<div style="${escapeInlineStyleForHtmlAttribute(stBody)}">${srcEsc}</div>`
      }
      const srcEsc = escapeHtml(tl.text ?? '')
      const fs = Math.max(1, Math.min(8000, Math.floor(tl.fontSize ?? 28)))
      const col = tl.color || '#ffffff'
      const ff = resolveDecoFontFamilyCss(tl.fontFamilyPreset, tl.fontFamilySystem)
      const pos = transformStyle(tl.transform, 50, 50)
      const fw = tl.fontWeight ?? 500
      const ty = textLayerTypographyCss(theme, tl)
      const va = flexAlignForTextVerticalAlign(verticalAlignForTextLayer(theme, tl))
      /** 与绑定主文案层一致：box-sizing + 3px 内边距，避免预览与真弹窗度量偏差 */
      const stDeco = `${pos} z-index:${z}; pointer-events:none; box-sizing:border-box; padding:${BINDING_TEXT_PADDING_PX}px; display:flex; flex-direction:column; justify-content:${va}; font-family:${ff}; font-size:${fs}px; color:${col}; ${ty} font-weight:${fw}; ${textBoxLayoutCss(tl.transform, 'content')} ${layerTextEffectsCssFromEffects(tl.textEffects)}`
      return `<div style="${escapeInlineStyleForHtmlAttribute(stDeco)}">${srcEsc}</div>`
    }
    case 'bindingTime': {
      const timeFont = safeFontPx(theme.timeFontSize, 100, 14)
      const timeColor = theme.timeColor || '#e2e8f0'
      const timeFontFamilyCss = resolvePopupFontFamilyCss(theme, 'time')
      const timePos = transformStyle(theme.timeTransform, 50, 55)
      const timeWeight = theme.timeFontWeight ?? 400
      const timeItalic = theme.timeFontItalic === true ? 'italic' : 'normal'
      const timeUnderline = theme.timeUnderline === true ? 'underline' : 'none'
      const tyTime = layerTypographyCss(theme, 'time')
      const tj = flexJustifyForTextAlign(theme?.timeTextAlign ?? theme?.textAlign ?? 'center')
      const tv = flexAlignForTextVerticalAlign(verticalAlignForThemeLayer(theme, 'time'))
      const stTime = `${timePos} z-index:${z}; pointer-events:none; box-sizing:border-box; padding:${BINDING_TEXT_PADDING_PX}px; display:flex; align-items:${tv}; justify-content:${tj}; font-family:${timeFontFamilyCss}; font-size:${timeFont}px; color:${timeColor}; ${tyTime} font-weight:${timeWeight}; font-style:${timeItalic}; text-decoration:${timeUnderline}; ${textBoxLayoutCss(theme.timeTransform, 'time')} ${layerTextEffectsCss(theme, 'time')}`
      return `<div style="${escapeInlineStyleForHtmlAttribute(stTime)}">${timeEsc}</div>`
    }
    case 'image': {
      const im = L as ImageThemeLayer
      const fileBase = copyLayerImageForHtml(im.imagePath, htmlDir)
      if (!fileBase) return ''
      const t = im.transform
      const x = t?.x ?? 50
      const y = t?.y ?? 50
      const r = t?.rotation ?? 0
      const s = clampLayerTransformScale(t?.scale)
      const wp = Math.max(5, Math.min(96, t?.textBoxWidthPct ?? 28))
      const hp = Math.max(3, Math.min(100, t?.textBoxHeightPct ?? 22))
      const fit = im.objectFit === 'contain' ? 'contain' : 'cover'
      const tf = `translate(-50%, -50%) rotate(${r}deg) scale(${s})`
      const urlEsc = escapeCssUrl(fileBase)
      return `<div style="${escapeInlineStyleForHtmlAttribute(`position:absolute;left:${x}%;top:${y}%;transform:${tf};transform-origin:center;width:${wp}%;height:${hp}%;max-width:100%;max-height:100%;box-sizing:border-box;z-index:${z};pointer-events:none;background-image:url('./${urlEsc}');background-size:${fit};background-position:center;background-repeat:no-repeat;`)}"></div>`
    }
    default:
      return ''
  }
}

function buildReminderHtmlWithLayers(options: ReminderPopupOptions, theme: PopupTheme, htmlDir: string): string {
  const { title, timeStr } = options
  const titleEsc = escapeHtml(title)
  const timeEsc = escapeHtml(timeStr)
  const layers = theme.layers ?? []
  const parts: string[] = []
  for (let i = 0; i < layers.length; i++) {
    parts.push(renderLayerFragment(theme, layers[i]!, i, timeEsc, htmlDir))
  }
  const stageInner = parts.join('\n')
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>${titleEsc}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; min-height: 100%; margin: 0; color: #fff; font-family: system-ui, sans-serif; overflow: hidden; background: #000000; }
    .stage { position: fixed; inset: 0; width: 100%; height: 100%; overflow: hidden; }
    ${REMINDER_CLOSE_CSS}
  </style>
</head>
<body>
  <div class="stage">
${stageInner}
  </div>
  ${REMINDER_CLOSE_HTML_SCRIPT}
</body>
</html>`
}

function buildReminderHtml(options: ReminderPopupOptions, htmlDir?: string): string {
  const { theme } = options
  if (!theme) return buildReminderHtmlLegacy(options)
  const t = ensureThemeLayers(theme)
  /**
   * `ensureThemeLayers` 在磁盘上 `layers: []` 时保留空栈（与「用户清空图层」一致），
   * 但此时图层路径不会渲染任何绑定文案；预览侧未落盘空数组时会走 migrate，二者易不一致。
   * 真弹窗统一回退 legacy：仍读主题根字段（content / time 等），与早期无 layers 行为一致。
   */
  if (!t.layers || t.layers.length === 0) {
    return buildReminderHtmlLegacy({ ...options, theme: t })
  }
  const dir = htmlDir ?? getPopupTempDir()
  return buildReminderHtmlWithLayers({ ...options, theme: t }, t, dir)
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
    webPreferences: { nodeIntegration: false, contextIsolation: true, zoomFactor: 1 },
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
  const htmlDir = getPopupTempDir()
  const html = buildReminderHtml(options, htmlDir)
  /** loadFile 失败时仍带主题根字段，避免 theme:undefined 的 legacy 丢字号/颜色；休息倒计时仍以主 HTML 为准（失败时仅无 mm:ss 叠层） */
  const fallbackHtml = buildReminderHtmlLegacy({
    ...options,
    theme: options.theme ? ensureThemeLayers(options.theme) : undefined,
  })
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
