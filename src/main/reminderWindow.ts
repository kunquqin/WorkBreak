import { app, BrowserWindow, screen, type BrowserWindowConstructorOptions } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import type {
  PopupTextAlign,
  PopupTextOrientationMode,
  PopupTextWritingMode,
  PopupTheme,
  PopupTextVerticalAlign,
  TextTransform,
} from '../shared/settings'
import { MAIN_REST_LAYOUT_DEFAULTS } from '../shared/settings'
import {
  ensureThemeLayers,
  POPUP_BACKGROUND_IMAGE_BLUR_MAX_PX,
  resolveBackgroundImagePanForCss,
} from '../shared/settings'
import {
  DESKTOP_DEFAULT_TIME_DATE_TRANSFORMS,
  type ImageThemeLayer,
  type PopupThemeLayer,
  type TextThemeLayer,
} from '../shared/popupThemeLayers'
import { layerTextEffectsCss, layerTextEffectsCssFromEffects, textFillColorCss } from '../shared/popupTextEffects'
import { resolveDecoFontFamilyCss, resolvePopupFontFamilyCss } from '../shared/popupThemeFonts'
import { formatPopupThemeDateString } from '../shared/popupThemeDateFormat'
import {
  WB_TEXT_INNER,
  isVerticalWritingMode,
  textAlignForVerticalInner,
  verticalTextInnerBoxCss,
} from '../shared/popupVerticalText'
import { buildPopupOverlayBackgroundCss } from '../shared/popupOverlayGradient'

/**
 * Windows 无边框铺满屏：默认可带 WS_THICKFRAME 阴影，角上易露桌面/系统色条；
 * 关 thickFrame + shadow 与 HTML 直角贴齐（roundedCorners 在部分版本仅标 darwin，仍保留）。
 */
function win32FramelessEdgeToEdgeOpts(): Pick<BrowserWindowConstructorOptions, 'thickFrame' | 'hasShadow'> {
  if (process.platform !== 'win32') return {}
  return { thickFrame: false, hasShadow: false }
}

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
  /**
   * 桌面壁纸导出页：在 HTML 内注入脚本，使时间与日期每秒与系统同步（标准设壁纸 API 仍为单帧位图）。
   */
  liveDesktopWallpaper?: boolean
  /**
   * 休息段结束时刻（epoch ms）。仅 `theme.target === 'rest'` 时由提醒调度传入：
   * 绑定时间层显示剩余 mm:ss、按秒递减，与最后 `min(5,restSec)` 秒黑底倒计时衔接。
   */
  restPhaseEndAtMs?: number
  /**
   * 是否允许用户通过右上角关叉或 Esc 关闭弹窗。默认 true。
   * 强制休息模式下对休息主题弹窗传入 false。
   */
  allowUserClose?: boolean
}

/** 休息弹窗绑定时间层：剩余总秒数 → mm:ss（与预览占位一致） */
export function formatRemainSecondsAsMmSs(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec))
  const m = Math.floor(sec / 60)
  const r = sec % 60
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
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
  if (!theme) return hexToRgba('#000000', clampOpacity(undefined, 0.45))
  return buildPopupOverlayBackgroundCss(theme)
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

function clampBackgroundImageBlurPx(theme: PopupTheme | undefined): number {
  const n = Math.round(Number(theme?.backgroundImageBlurPx))
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(POPUP_BACKGROUND_IMAGE_BLUR_MAX_PX, n))
}

function isDefaultBackgroundImageTransform(theme: PopupTheme | undefined): boolean {
  const { txPct, tyPct, rotation, scale } = resolveBackgroundImagePanForCss(
    theme ?? { backgroundImageTransform: undefined, backgroundImageXYKind: undefined },
  )
  return (
    Math.abs(txPct) < 1e-6 &&
    Math.abs(tyPct) < 1e-6 &&
    rotation === 0 &&
    Math.abs(scale - 1) < 1e-9
  )
}

/** translate(x%,y%) 平移 + 固定 cover 居中锚点 + 旋转缩放，与预览一致 */
function backgroundImageTransformCss(theme: PopupTheme | undefined): string {
  const { txPct, tyPct, rotation, scale } = resolveBackgroundImagePanForCss(
    theme ?? { backgroundImageTransform: undefined, backgroundImageXYKind: undefined },
  )
  return `background-position:center;background-size:cover;background-repeat:no-repeat;transform:translate(${txPct}%,${tyPct}%) rotate(${rotation}deg) scale(${scale});transform-origin:center center;`
}

/** 模糊后裁边补偿：内层比视口放大，减轻边缘露底 */
function backgroundBlurOutsetPx(blur: number): number {
  if (blur <= 0) return 0
  return Math.min(320, Math.ceil(blur * 2.5))
}

function countExistingFolderImageFiles(theme: PopupTheme): number {
  if (theme.backgroundType !== 'image' || theme.imageSourceType !== 'folder') return 0
  const files = Array.isArray(theme.imageFolderFiles) ? theme.imageFolderFiles : []
  let n = 0
  for (const f of files) {
    if (typeof f === 'string' && f.trim() && existsSync(f.trim())) n++
  }
  return n
}

/**
 * 将文件夹内存在的壁纸拷入 HTML 目录；仅当 ≥2 张成功拷贝时返回相对名列表供轮播。
 */
function copyFolderImagesForBackgroundSlideshow(theme: PopupTheme, htmlDir: string): string[] | null {
  if (theme.backgroundType !== 'image' || theme.imageSourceType !== 'folder') return null
  const files = Array.isArray(theme.imageFolderFiles) ? theme.imageFolderFiles : []
  const rels: string[] = []
  for (const f of files) {
    if (typeof f !== 'string' || !f.trim()) continue
    const p = f.trim()
    if (!existsSync(p)) continue
    const base = copyLayerImageForHtml(p, htmlDir)
    if (base) rels.push(base)
  }
  return rels.length >= 2 ? rels : null
}

/**
 * 文件夹壁纸：双层层叠 + opacity 过渡；`holdMs` 为每张图**全不透明停留**，`fadeMs` 为交叉淡化时长。
 */
function buildFolderBackgroundSlideshowFromRels(
  theme: PopupTheme,
  rels: string[],
  z: number,
  position: 'absolute' | 'fixed',
): string {
  const bgc = theme.backgroundColor || '#000000'
  const blur = clampBackgroundImageBlurPx(theme)
  const ex = backgroundBlurOutsetPx(blur)
  const holdMs = Math.max(300, Math.round((theme.imageFolderIntervalSec ?? 30) * 1000))
  const fadeMs = Math.max(100, Math.round((theme.imageFolderCrossfadeSec ?? 2) * 1000))
  const randomMode = theme.imageFolderPlayMode === 'random'
  const urlsJson = JSON.stringify(rels)
  const pos = position
  const blurFilter = blur > 0 ? `filter:blur(${blur}px);` : ''
  const tf = backgroundImageTransformCss(theme)
  const innerGeom =
    blur > 0
      ? `position:absolute;left:-${ex}px;top:-${ex}px;width:calc(100% + ${ex * 2}px);height:calc(100% + ${ex * 2}px);background-size:cover;background-repeat:no-repeat;${blurFilter}${tf}`
      : `position:absolute;inset:0;background-size:cover;background-repeat:no-repeat;${tf}`
  const slide = (id: string, op: number) => {
    const outer = `position:absolute;inset:0;opacity:${op};transition:opacity ${fadeMs}ms ease-in-out;overflow:hidden;pointer-events:none;background-color:${bgc}`
    return `<div id="${id}" class="wb-bg-fs-slide" style="${escapeInlineStyleForHtmlAttribute(outer)}"><div class="wb-bg-fs-inner" style="${escapeInlineStyleForHtmlAttribute(innerGeom)}"></div></div>`
  }
  const host = `position:${pos};inset:0;z-index:${z};pointer-events:none;overflow:hidden;background-color:${bgc}`
  const slideA = slide('wb-bg-fs-a', 1)
  const slideB = slide('wb-bg-fs-b', 0)
  const scriptFixed = `<script>(function(){var U=${urlsJson};var R=${randomMode ? '1' : '0'};var H=${holdMs};var F=${fadeMs};var a=document.getElementById('wb-bg-fs-a');var b=document.getElementById('wb-bg-fs-b');if(!a||!b||U.length<2)return;function innerSet(el,ix){var n=el.querySelector('.wb-bg-fs-inner');if(!n)return;n.style.backgroundImage="url('./"+U[ix]+"')";}var idx=0;innerSet(a,0);innerSet(b,U.length>1?1%U.length:0);var topA=true;function nxt(){if(R){if(U.length<2)return 0;var j=Math.floor(Math.random()*U.length);return j===idx?(j+1)%U.length:j;}return(idx+1)%U.length;}function tick(){var ni=nxt();var t=topA?b:a;var o=topA?a:b;innerSet(t,ni);t.style.opacity='1';o.style.opacity='0';idx=ni;topA=!topA;setTimeout(tick,H+F);}setTimeout(tick,H);})();</script>`

  return `<div style="${escapeInlineStyleForHtmlAttribute(host)}">${slideA}${slideB}</div>${scriptFixed}`
}

function getBackgroundStyle(theme: PopupTheme | undefined): string {
  if (!theme) return 'background-color: #000000;'
  /** 文件夹多图轮播由独立层 + 脚本负责，body 仅铺底色 */
  if (theme.backgroundType === 'image' && countExistingFolderImageFiles(theme) >= 2) {
    return `background-color: ${theme.backgroundColor || '#000000'};`
  }
  if (theme.backgroundType === 'image') {
    const p = resolveBackgroundImageFilePath(theme)
    if (!p) return `background-color: ${theme.backgroundColor || '#000000'};`
    const dataUrl = readLocalImageAsDataUrl(p)
    if (dataUrl) {
      const blur = clampBackgroundImageBlurPx(theme)
      if (blur > 0) {
        return `background-color: ${theme.backgroundColor || '#000000'};`
      }
      if (!isDefaultBackgroundImageTransform(theme)) {
        return `background-color: ${theme.backgroundColor || '#000000'};`
      }
      return `background-image: url("${escapeCssUrl(dataUrl)}"); background-size: cover; background-position: center; background-repeat: no-repeat; background-color: ${theme.backgroundColor || '#000000'};`
    }
  }
  return `background-color: ${theme.backgroundColor || '#000000'};`
}

/** Legacy 模板：有壁纸且 blur>0 时在 body 内最底层插入固定层（body 仅铺底色） */
function legacyBlurredBackgroundLayerHtml(theme: PopupTheme | undefined): string {
  if (!theme || theme.backgroundType !== 'image') return ''
  /** 多图轮播层内已处理模糊 */
  if (countExistingFolderImageFiles(theme) >= 2) return ''
  const blur = clampBackgroundImageBlurPx(theme)
  if (blur <= 0) return ''
  const p = resolveBackgroundImageFilePath(theme)
  if (!p) return ''
  const dataUrl = readLocalImageAsDataUrl(p)
  if (!dataUrl) return ''
  const bgc = theme.backgroundColor || '#000000'
  const ex = backgroundBlurOutsetPx(blur)
  const url = escapeCssUrl(dataUrl)
  const outer = `position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden;background-color:${bgc}`
  const tf = backgroundImageTransformCss(theme)
  const inner = `position:absolute;left:-${ex}px;top:-${ex}px;width:calc(100% + ${ex * 2}px);height:calc(100% + ${ex * 2}px);background-image:url("${url}");background-size:cover;background-repeat:no-repeat;filter:blur(${blur}px);${tf}`
  return `<div style="${escapeInlineStyleForHtmlAttribute(outer)}"><div style="${escapeInlineStyleForHtmlAttribute(inner)}"></div></div>`
}

/** Legacy：无模糊单图且 x/y/旋转/缩放非默认时，不用 body 背景图而改用固定层（body 仅底色） */
function legacyPlainImageTransformLayerHtml(theme: PopupTheme | undefined): string {
  if (!theme || theme.backgroundType !== 'image') return ''
  if (countExistingFolderImageFiles(theme) >= 2) return ''
  if (clampBackgroundImageBlurPx(theme) > 0) return ''
  if (isDefaultBackgroundImageTransform(theme)) return ''
  const p = resolveBackgroundImageFilePath(theme)
  if (!p) return ''
  const dataUrl = readLocalImageAsDataUrl(p)
  if (!dataUrl) return ''
  const bgc = theme.backgroundColor || '#000000'
  const url = escapeCssUrl(dataUrl)
  const tf = backgroundImageTransformCss(theme)
  const outer = `position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden;background-color:${bgc}`
  const inner = `position:absolute;inset:0;background-image:url("${url}");background-size:cover;background-repeat:no-repeat;${tf}`
  return `<div style="${escapeInlineStyleForHtmlAttribute(outer)}"><div style="${escapeInlineStyleForHtmlAttribute(inner)}"></div></div>`
}

export function getPopupTempDir(): string {
  const dir = join(app.getPath('temp'), 'workbreak-popups')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function writePopupHtmlToTempFile(fileName: string, html: string): string {
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
type TextBoxLayer = 'content' | 'time' | 'date' | 'countdown'

function themeLayerWritingMode(theme: PopupTheme, layer: TextBoxLayer): PopupTextWritingMode {
  if (layer === 'content') return theme.contentWritingMode ?? 'horizontal-tb'
  /** 时间/日期仅横排（与预览、面板一致） */
  if (layer === 'time' || layer === 'date') return 'horizontal-tb'
  return theme.countdownWritingMode ?? 'horizontal-tb'
}

function themeLayerTextOrientation(theme: PopupTheme, layer: TextBoxLayer): PopupTextOrientationMode | undefined {
  if (layer === 'content') return theme.contentTextOrientation
  if (layer === 'time' || layer === 'date') return undefined
  return theme.countdownTextOrientation
}

/** 主文案默认关；时间/日期/倒计时未写磁盘时默认开（减少竖排数字一位一列） */
function themeLayerCombineUpright(theme: PopupTheme, layer: TextBoxLayer): boolean {
  if (layer === 'content') return theme.contentCombineUprightDigits === true
  if (layer === 'time' || layer === 'date') return false
  return theme.countdownCombineUprightDigits !== false
}

function isThemeLayerVertical(theme: PopupTheme | undefined, layer: TextBoxLayer): boolean {
  if (!theme) return false
  return isVerticalWritingMode(themeLayerWritingMode(theme, layer))
}

function popupLayerTypographyParts(
  theme: PopupTheme | undefined,
  layer: 'content' | 'time' | 'date' | 'countdown',
): { align: PopupTextAlign; verticalAlign: PopupTextVerticalAlign; letterSpacing: number; lineHeight: number } {
  const baseAlign = theme?.textAlign ?? 'center'
  const baseVerticalAlign = theme?.textVerticalAlign ?? 'middle'
  let align: PopupTextAlign = baseAlign
  let verticalAlign: PopupTextVerticalAlign = baseVerticalAlign
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
  } else if (layer === 'date') {
    align = theme?.dateTextAlign ?? baseAlign
    verticalAlign = theme?.dateTextVerticalAlign ?? baseVerticalAlign
    letterSpacing = theme?.dateLetterSpacing ?? 0
    lineHeight = theme?.dateLineHeight ?? 1
  } else {
    align = theme?.countdownTextAlign ?? baseAlign
    verticalAlign = theme?.countdownTextVerticalAlign ?? baseVerticalAlign
    letterSpacing = theme?.countdownLetterSpacing ?? 0
    lineHeight = theme?.countdownLineHeight ?? 1
  }
  return { align, verticalAlign, letterSpacing, lineHeight }
}

/** 横排外层；竖排时字距/行高/ text-align 由内层 span 承担 */
function layerTypographyCss(theme: PopupTheme | undefined, layer: 'content' | 'time' | 'date' | 'countdown'): string {
  if (theme && isThemeLayerVertical(theme, layer)) return ''
  const p = popupLayerTypographyParts(theme, layer)
  return `text-align: ${p.align}; letter-spacing: ${p.letterSpacing}px; line-height: ${p.lineHeight}; --wb-v-align: ${p.verticalAlign};`
}

function wrapThemeTextVerticalInner(
  theme: PopupTheme,
  layer: TextBoxLayer,
  shortLayer: boolean,
  bodyEsc: string,
): string {
  const wm = themeLayerWritingMode(theme, layer)
  if (!isVerticalWritingMode(wm)) return bodyEsc
  const p = popupLayerTypographyParts(theme, layer)
  const innerAlign = textAlignForVerticalInner(p.align)
  const css = verticalTextInnerBoxCss(
    {
      writingMode: wm,
      textOrientation: themeLayerTextOrientation(theme, layer),
      combineUpright: themeLayerCombineUpright(theme, layer),
      textAlign: innerAlign,
      letterSpacingPx: p.letterSpacing,
      lineHeight: p.lineHeight,
    },
    shortLayer,
  )
  return `<span ${WB_TEXT_INNER}="1" style="${escapeInlineStyleForHtmlAttribute(css)}">${bodyEsc}</span>`
}

/** 时间与倒计时为实时单行数据；竖排时 nowrap 改由内层 pre-wrap 负责 */
function textBoxLayoutCss(t: TextTransform | undefined, layer: TextBoxLayer, vertical?: boolean): string {
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
    // time / date / countdown：默认横向贴字宽（与预览 Moveable 外框一致）；锁定后才是定宽条
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
      // 竖排外层若用 overflow:auto，块轴上易出现与内层叠加的横向假滚动条；与 popupVerticalText 内层一致拆开轴向
      s +=
        vertical === true
          ? ` height: ${hp}%; max-height: 100%; overflow-x: hidden; overflow-y: auto; min-width: 0;`
          : ` height: ${hp}%; max-height: 100%; overflow: auto;`
    } else {
      // 时间/日期/倒计时：高度随字行盒，textBoxHeightPct 仅作上限。勿用 overflow:hidden，否则 max-width+nowrap 下易裁掉斜体/描边/阴影左右外延
      s += ` height: auto; max-height: ${hp}%; overflow: visible;`
    }
  }
  if (vertical) return s
  if (layer === 'content') {
    // 与 ThemePreviewEditor 一致：不用 overflow-wrap:anywhere，避免窄框下中文被逐字强拆行（与编辑态不一致）
    s += ' white-space: pre-wrap; word-wrap: break-word; overflow-wrap: break-word; word-break: keep-all;'
  } else {
    s += ' white-space: nowrap; word-break: keep-all; overflow-wrap: normal;'
  }
  return s
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

function verticalAlignForThemeLayer(theme: PopupTheme | undefined, layer: 'content' | 'time' | 'date' | 'countdown'): 'top' | 'middle' | 'bottom' {
  const base = theme?.textVerticalAlign ?? 'middle'
  if (layer === 'content') return (theme?.contentTextVerticalAlign ?? base) as 'top' | 'middle' | 'bottom'
  if (layer === 'time') return (theme?.timeTextVerticalAlign ?? base) as 'top' | 'middle' | 'bottom'
  if (layer === 'date') return (theme?.dateTextVerticalAlign ?? base) as 'top' | 'middle' | 'bottom'
  return (theme?.countdownTextVerticalAlign ?? base) as 'top' | 'middle' | 'bottom'
}

/** 预览中各绑定文字层有 `padding: toPreviewPx(3)`；全屏按逻辑像素 3px 对齐 */
const BINDING_TEXT_PADDING_PX = 3
/** 时间/日期等短行左右略增，减轻斜体、描边、阴影在 max-width+nowrap 下被裁掉（动态桌面日期首字缺笔） */
const BINDING_SHORT_LAYER_PAD_INLINE_PX = 12

function decoTypographyParts(
  theme: PopupTheme | undefined,
  L: TextThemeLayer,
): { align: PopupTextAlign; verticalAlign: PopupTextVerticalAlign; letterSpacing: number; lineHeight: number } {
  const baseAlign = theme?.textAlign ?? 'center'
  const baseVerticalAlign = theme?.textVerticalAlign ?? 'middle'
  return {
    align: (L.textAlign ?? baseAlign) as PopupTextAlign,
    verticalAlign: (L.textVerticalAlign ?? baseVerticalAlign) as PopupTextVerticalAlign,
    letterSpacing: L.letterSpacing ?? 0,
    lineHeight: L.lineHeight ?? 1.35,
  }
}

function textLayerTypographyCss(theme: PopupTheme | undefined, L: TextThemeLayer): string {
  const wm = L.writingMode ?? 'horizontal-tb'
  if (isVerticalWritingMode(wm)) return ''
  const p = decoTypographyParts(theme, L)
  return `text-align: ${p.align}; letter-spacing: ${p.letterSpacing}px; line-height: ${p.lineHeight}; --wb-v-align: ${p.verticalAlign};`
}

function wrapDecoTextVerticalInner(theme: PopupTheme, L: TextThemeLayer, bodyEsc: string): string {
  const wm = L.writingMode ?? 'horizontal-tb'
  if (!isVerticalWritingMode(wm)) return bodyEsc
  const p = decoTypographyParts(theme, L)
  const innerAlign = textAlignForVerticalInner(p.align)
  const combine = L.combineUprightDigits === true ? true : L.combineUprightDigits === false ? false : false
  const css = verticalTextInnerBoxCss(
    {
      writingMode: wm,
      textOrientation: L.textOrientation,
      combineUpright: combine,
      textAlign: innerAlign,
      letterSpacingPx: p.letterSpacing,
      lineHeight: p.lineHeight,
    },
    false,
  )
  return `<span ${WB_TEXT_INNER}="1" style="${escapeInlineStyleForHtmlAttribute(css)}">${bodyEsc}</span>`
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
export function buildReminderHtmlLegacy(options: ReminderPopupOptions, htmlDir?: string): string {
  const { title, body, timeStr, theme, restPhaseEndAtMs, allowUserClose } = options
  const showClose = allowUserClose !== false
  const titleEsc = escapeHtml(title)
  const bodyEsc = escapeHtml(resolveThemeBodyText(theme, body))
  const timeEsc = escapeHtml(timeStr)
  const contentFont = safeFontPx(theme?.contentFontSize, MAIN_REST_LAYOUT_DEFAULTS.contentFontSize, 16)
  const timeFont = safeFontPx(
    theme?.timeFontSize,
    theme?.target === 'desktop'
      ? DESKTOP_DEFAULT_TIME_DATE_TRANSFORMS.timeFontSize!
      : MAIN_REST_LAYOUT_DEFAULTS.timeFontSize,
    14,
  )
  const contentColor = textFillColorCss(theme?.contentColor, theme?.contentTextOpacity)
  const timeColor = textFillColorCss(theme?.timeColor, theme?.timeTextOpacity)
  const overlayEnabled = Boolean(theme?.overlayEnabled)
  const bgStyle = getBackgroundStyle(theme)
  const contentFontFamilyCss = resolvePopupFontFamilyCss(theme, 'content')
  const timeFontFamilyCss = resolvePopupFontFamilyCss(theme, 'time')
  const contentPos = transformStyle(theme?.contentTransform, 50, MAIN_REST_LAYOUT_DEFAULTS.contentTransform.y)
  const timePos = transformStyle(
    theme?.timeTransform,
    50,
    theme?.target === 'desktop'
      ? DESKTOP_DEFAULT_TIME_DATE_TRANSFORMS.timeTransform!.y
      : MAIN_REST_LAYOUT_DEFAULTS.timeTransform.y,
  )
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
  const contentVert = theme ? isThemeLayerVertical(theme, 'content') : false
  const timeVert = theme ? isThemeLayerVertical(theme, 'time') : false
  const bodyHtml = theme ? wrapThemeTextVerticalInner(theme, 'content', false, bodyEsc) : bodyEsc
  const useRestRemain =
    Boolean(theme) &&
    theme!.target === 'rest' &&
    typeof restPhaseEndAtMs === 'number' &&
    restPhaseEndAtMs > 0
  const timeInner = useRestRemain ? `<span id="wb-rest-remain">${timeEsc}</span>` : timeEsc
  const timeHtml = theme ? wrapThemeTextVerticalInner(theme, 'time', true, timeInner) : timeEsc

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>${titleEsc}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; min-height: 100%; margin: 0; color: #fff; font-family: system-ui, sans-serif; overflow: hidden; border-radius: 0; ${bgStyle} }
    .overlay { position: fixed; inset: 0; z-index: 1; background: ${overlayGradientCss(theme)}; opacity: ${overlayEnabled ? 1 : 0}; pointer-events: none; }
    .content { position: relative; z-index: 2; width: 100%; height: 100%; }
    .line1 { ${contentPos} box-sizing: border-box; padding: ${BINDING_TEXT_PADDING_PX}px; display:flex; flex-direction:column; justify-content:${contentVA}; font-family: ${contentFontFamilyCss}; font-size: ${contentFont}px; color: ${contentColor}; ${tyContent} font-weight: ${contentWeight}; font-style: ${contentItalic}; text-decoration: ${contentUnderline}; ${textBoxLayoutCss(theme?.contentTransform, 'content', contentVert)} ${layerTextEffectsCss(theme, 'content')} }
    .line2 { ${timePos} box-sizing: border-box; padding: ${BINDING_TEXT_PADDING_PX}px ${BINDING_SHORT_LAYER_PAD_INLINE_PX}px; display: flex; align-items: ${timeVA}; justify-content: ${flexJustifyForTextAlign(theme?.timeTextAlign ?? theme?.textAlign ?? 'center')}; font-family: ${timeFontFamilyCss}; font-size: ${timeFont}px; color: ${timeColor}; ${tyTime} font-weight: ${timeWeight}; font-style: ${timeItalic}; text-decoration: ${timeUnderline}; ${textBoxLayoutCss(theme?.timeTransform, 'time', timeVert)} ${layerTextEffectsCss(theme, 'time')} }
    ${showClose ? REMINDER_CLOSE_CSS : ''}
  </style>
</head>
<body>
  ${theme && htmlDir ? (() => {
    const rels = copyFolderImagesForBackgroundSlideshow(theme, htmlDir)
    return rels ? buildFolderBackgroundSlideshowFromRels(theme, rels, 0, 'fixed') : ''
  })() : ''}
  ${legacyPlainImageTransformLayerHtml(theme)}
  ${legacyBlurredBackgroundLayerHtml(theme)}
  <div class="overlay"></div>
  <div class="content">
    <div class="line1">${bodyHtml}</div>
    <div class="line2">${timeHtml}</div>
  </div>
  ${useRestRemain ? buildRestRemainCountdownScript(restPhaseEndAtMs!) : ''}
  ${showClose ? REMINDER_CLOSE_HTML_SCRIPT : ''}
</body>
</html>`
}

/** 动态桌面时钟：与 setInterval(1000) 不同，按「下一整秒」排程，避免与任务栏时钟稳定差一拍 */
function buildDesktopLiveClockScript(theme: PopupTheme): string {
  const loc = JSON.stringify((theme.dateLocale ?? '').trim() || 'zh-CN')
  return `<script>(function(){var L=${loc};var timeOpts={hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false};var dateOpts={year:"numeric",month:"2-digit",day:"2-digit",weekday:"short"};function paint(){var n=new Date();var t=document.getElementById("wb-live-time");if(t)t.textContent=n.toLocaleTimeString(L,timeOpts);var d=document.getElementById("wb-live-date");if(d)d.textContent=n.toLocaleDateString(L,dateOpts)}function tick(){paint();var ms=Date.now()%1000;var dly=ms===0?1000:(1000-ms);setTimeout(tick,dly)}tick();})();</script>`
}

/** 休息段剩余时间：按下一整秒排程，与黑底最后几秒倒计时对齐到同一秒的 floor 语义 */
function buildRestRemainCountdownScript(phaseEndAtMs: number): string {
  const end = Math.floor(phaseEndAtMs)
  return `<script>(function(){var E=${end};function fmt(s){s=Math.max(0,Math.floor(s));var m=Math.floor(s/60);var r=s%60;return(m<10?"0":"")+m+":"+(r<10?"0":"")+r;}function paint(){var t=document.getElementById("wb-rest-remain");if(!t)return;var sec=Math.max(0,Math.floor((E-Date.now())/1000));t.textContent=fmt(sec);}function tick(){paint();var ms=Date.now()%1000;var dly=ms===0?1000:(1000-ms);setTimeout(tick,dly)}tick();})();</script>`
}

function renderLayerFragment(
  theme: PopupTheme,
  L: PopupThemeLayer,
  z: number,
  timeEsc: string,
  dateEsc: string,
  htmlDir: string,
  liveDesktop: boolean,
  restPhaseEndAtMs?: number,
): string {
  if (!L.visible) return ''
  switch (L.kind) {
    case 'background': {
      if (theme.backgroundType === 'image') {
        const rels = copyFolderImagesForBackgroundSlideshow(theme, htmlDir)
        if (rels) {
          return buildFolderBackgroundSlideshowFromRels(theme, rels, z, 'absolute')
        }
        const p = resolveBackgroundImageFilePath(theme)
        if (p) {
          const base = copyLayerImageForHtml(p, htmlDir)
          if (base) {
            const urlEsc = escapeCssUrl(base)
            const bgc = theme.backgroundColor || '#000000'
            const blur = clampBackgroundImageBlurPx(theme)
            if (blur > 0) {
              const ex = backgroundBlurOutsetPx(blur)
              const tf = backgroundImageTransformCss(theme)
              const outer = `position:absolute;inset:0;z-index:${z};pointer-events:none;overflow:hidden;background-color:${bgc}`
              const inner = `position:absolute;left:-${ex}px;top:-${ex}px;width:calc(100% + ${ex * 2}px);height:calc(100% + ${ex * 2}px);background-image:url('./${urlEsc}');background-size:cover;background-repeat:no-repeat;filter:blur(${blur}px);${tf}`
              return `<div style="${escapeInlineStyleForHtmlAttribute(outer)}"><div style="${escapeInlineStyleForHtmlAttribute(inner)}"></div></div>`
            }
            const tf = backgroundImageTransformCss(theme)
            return `<div style="${escapeInlineStyleForHtmlAttribute(`position:absolute;inset:0;z-index:${z};pointer-events:none;background-image:url('./${urlEsc}');background-size:cover;background-repeat:no-repeat;background-color:${bgc};${tf}`)}"></div>`
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
        /** 文本内容不再从提醒项注入，统一以主题编辑内容为准（含桌面动态壁纸）。 */
        const srcEsc = escapeHtml((tl.text ?? '').trim())
        /** 与 ThemePreviewEditor.renderTextLayerForKey(content) 一致：排版以主题根字段为准，保证时间样式等与预览一致。 */
        const fs = safeFontPx(theme.contentFontSize, 180, 16)
        const col = textFillColorCss(theme.contentColor, theme.contentTextOpacity)
        const ff = resolvePopupFontFamilyCss(theme, 'content')
        const pos = transformStyle(theme.contentTransform, 50, MAIN_REST_LAYOUT_DEFAULTS.contentTransform.y)
        const fw = theme.contentFontWeight ?? 600
        const fi = theme.contentFontItalic === true ? 'italic' : 'normal'
        const td = theme.contentUnderline === true ? 'underline' : 'none'
        const ty = layerTypographyCss(theme, 'content')
        const va = flexAlignForTextVerticalAlign(verticalAlignForThemeLayer(theme, 'content'))
        const fx = layerTextEffectsCss(theme, 'content')
        const cVert = isThemeLayerVertical(theme, 'content')
        const innerB = wrapThemeTextVerticalInner(theme, 'content', false, srcEsc)
        const stBody = `${pos} z-index:${z}; pointer-events:none; box-sizing:border-box; padding:${BINDING_TEXT_PADDING_PX}px; display:flex; flex-direction:column; justify-content:${va}; font-family:${ff}; font-size:${fs}px; color:${col}; ${ty} font-weight:${fw}; font-style:${fi}; text-decoration:${td}; ${textBoxLayoutCss(theme.contentTransform, 'content', cVert)} ${fx}`
        return `<div style="${escapeInlineStyleForHtmlAttribute(stBody)}">${innerB}</div>`
      }
      const srcEsc = escapeHtml(tl.text ?? '')
      const fs = Math.max(1, Math.min(8000, Math.floor(tl.fontSize ?? 28)))
      const col = textFillColorCss(tl.color, tl.colorOpacity)
      const ff = resolveDecoFontFamilyCss(tl.fontFamilyPreset, tl.fontFamilySystem)
      const pos = transformStyle(tl.transform, 50, 50)
      const fw = tl.fontWeight ?? 500
      const ty = textLayerTypographyCss(theme, tl)
      const va = flexAlignForTextVerticalAlign(verticalAlignForTextLayer(theme, tl))
      const decoFi = tl.fontItalic === true ? 'italic' : 'normal'
      const decoTd = tl.textUnderline === true ? 'underline' : 'none'
      /** 与绑定主文案层一致：box-sizing + 3px 内边距，避免预览与真弹窗度量偏差 */
      const dVert = isVerticalWritingMode(tl.writingMode ?? 'horizontal-tb')
      const innerD = wrapDecoTextVerticalInner(theme, tl, srcEsc)
      const stDeco = `${pos} z-index:${z}; pointer-events:none; box-sizing:border-box; padding:${BINDING_TEXT_PADDING_PX}px; display:flex; flex-direction:column; justify-content:${va}; font-family:${ff}; font-size:${fs}px; color:${col}; ${ty} font-weight:${fw}; font-style:${decoFi}; text-decoration:${decoTd}; ${textBoxLayoutCss(tl.transform, 'content', dVert)} ${layerTextEffectsCssFromEffects(tl.textEffects)}`
      return `<div style="${escapeInlineStyleForHtmlAttribute(stDeco)}">${innerD}</div>`
    }
    case 'bindingTime': {
      const timeFont = safeFontPx(
        theme.timeFontSize,
        theme.target === 'desktop'
          ? DESKTOP_DEFAULT_TIME_DATE_TRANSFORMS.timeFontSize!
          : MAIN_REST_LAYOUT_DEFAULTS.timeFontSize,
        14,
      )
      const timeColor = textFillColorCss(theme.timeColor, theme.timeTextOpacity)
      const timeFontFamilyCss = resolvePopupFontFamilyCss(theme, 'time')
      const timePos = transformStyle(
        theme.timeTransform,
        50,
        theme.target === 'desktop'
          ? DESKTOP_DEFAULT_TIME_DATE_TRANSFORMS.timeTransform!.y
          : MAIN_REST_LAYOUT_DEFAULTS.timeTransform.y,
      )
      const timeWeight = theme.timeFontWeight ?? 400
      const timeItalic = theme.timeFontItalic === true ? 'italic' : 'normal'
      const timeUnderline = theme.timeUnderline === true ? 'underline' : 'none'
      const tyTime = layerTypographyCss(theme, 'time')
      const tj = flexJustifyForTextAlign(theme?.timeTextAlign ?? theme?.textAlign ?? 'center')
      const tv = flexAlignForTextVerticalAlign(verticalAlignForThemeLayer(theme, 'time'))
      const tVert = isThemeLayerVertical(theme, 'time')
      const useRestRemain =
        theme.target === 'rest' &&
        typeof restPhaseEndAtMs === 'number' &&
        restPhaseEndAtMs > 0 &&
        !liveDesktop
      const timeCore = liveDesktop
        ? `<span id="wb-live-time">${timeEsc}</span>`
        : useRestRemain
          ? `<span id="wb-rest-remain">${timeEsc}</span>`
          : timeEsc
      const innerT = wrapThemeTextVerticalInner(theme, 'time', true, timeCore)
      const stTime = `${timePos} z-index:${z}; pointer-events:none; box-sizing:border-box; padding:${BINDING_TEXT_PADDING_PX}px ${BINDING_SHORT_LAYER_PAD_INLINE_PX}px; display:flex; align-items:${tv}; justify-content:${tj}; font-family:${timeFontFamilyCss}; font-size:${timeFont}px; color:${timeColor}; ${tyTime} font-weight:${timeWeight}; font-style:${timeItalic}; text-decoration:${timeUnderline}; ${textBoxLayoutCss(theme.timeTransform, 'time', tVert)} ${layerTextEffectsCss(theme, 'time')}`
      return `<div style="${escapeInlineStyleForHtmlAttribute(stTime)}">${innerT}</div>`
    }
    case 'bindingDate': {
      if (!dateEsc && !liveDesktop) return ''
      const dateFont = safeFontPx(
        theme.dateFontSize,
        theme.target === 'desktop' ? DESKTOP_DEFAULT_TIME_DATE_TRANSFORMS.dateFontSize! : 72,
        14,
      )
      const dateColor = textFillColorCss(theme.dateColor || '#e2e8f0', theme.dateTextOpacity)
      const dateFontFamilyCss = resolvePopupFontFamilyCss(theme, 'date')
      const datePos = transformStyle(
        theme.dateTransform,
        50,
        theme.target === 'desktop' ? DESKTOP_DEFAULT_TIME_DATE_TRANSFORMS.dateTransform!.y : 65,
      )
      const dateWeight = theme.dateFontWeight ?? 400
      const dateItalic = theme.dateFontItalic === true ? 'italic' : 'normal'
      const dateUnderline = theme.dateUnderline === true ? 'underline' : 'none'
      const tyDate = layerTypographyCss(theme, 'date')
      const dj = flexJustifyForTextAlign(theme?.dateTextAlign ?? theme?.textAlign ?? 'center')
      const dv = flexAlignForTextVerticalAlign(verticalAlignForThemeLayer(theme, 'date'))
      const dVert = isThemeLayerVertical(theme, 'date')
      const dateCore = liveDesktop ? `<span id="wb-live-date">${dateEsc}</span>` : dateEsc
      const innerDt = wrapThemeTextVerticalInner(theme, 'date', true, dateCore)
      const stDate = `${datePos} z-index:${z}; pointer-events:none; box-sizing:border-box; padding:${BINDING_TEXT_PADDING_PX}px ${BINDING_SHORT_LAYER_PAD_INLINE_PX}px; display:flex; align-items:${dv}; justify-content:${dj}; font-family:${dateFontFamilyCss}; font-size:${dateFont}px; color:${dateColor}; ${tyDate} font-weight:${dateWeight}; font-style:${dateItalic}; text-decoration:${dateUnderline}; ${textBoxLayoutCss(theme.dateTransform, 'date', dVert)} ${layerTextEffectsCss(theme, 'date')}`
      return `<div style="${escapeInlineStyleForHtmlAttribute(stDate)}">${innerDt}</div>`
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
  const { title, timeStr, liveDesktopWallpaper, restPhaseEndAtMs, allowUserClose } = options
  const showClose = allowUserClose !== false
  const liveDesktop = Boolean(liveDesktopWallpaper)
  const titleEsc = escapeHtml(title)
  const timeEsc = escapeHtml(timeStr)
  const at = new Date()
  const dateEsc = escapeHtml(formatPopupThemeDateString(theme, at, 'live'))
  const layers = theme.layers ?? []
  const parts: string[] = []
  for (let i = 0; i < layers.length; i++) {
    parts.push(renderLayerFragment(theme, layers[i]!, i, timeEsc, dateEsc, htmlDir, liveDesktop, restPhaseEndAtMs))
  }
  const stageInner = parts.join('\n')
  const useRestRemain =
    theme.target === 'rest' &&
    typeof restPhaseEndAtMs === 'number' &&
    restPhaseEndAtMs > 0 &&
    !liveDesktop
  const liveScript = liveDesktop
    ? buildDesktopLiveClockScript(theme)
    : useRestRemain
      ? buildRestRemainCountdownScript(restPhaseEndAtMs)
      : ''
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>${titleEsc}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; min-height: 100%; margin: 0; color: #fff; font-family: system-ui, sans-serif; overflow: hidden; background: #000000; border-radius: 0; }
    .stage { position: fixed; inset: 0; width: 100%; height: 100%; overflow: hidden; border-radius: 0; }
    ${showClose ? REMINDER_CLOSE_CSS : ''}
  </style>
</head>
<body>
  <div class="stage">
${stageInner}
  </div>
  ${liveScript}
  ${showClose ? REMINDER_CLOSE_HTML_SCRIPT : ''}
</body>
</html>`
}

export function buildReminderHtml(options: ReminderPopupOptions, htmlDir?: string): string {
  const { theme } = options
  if (!theme) return buildReminderHtmlLegacy(options, htmlDir)
  const t = ensureThemeLayers(theme)
  /**
   * `ensureThemeLayers` 在磁盘上 `layers: []` 时保留空栈（与「用户清空图层」一致），
   * 但此时图层路径不会渲染任何绑定文案；预览侧未落盘空数组时会走 migrate，二者易不一致。
   * 真弹窗统一回退 legacy：仍读主题根字段（content / time 等），与早期无 layers 行为一致。
   */
  if (!t.layers || t.layers.length === 0) {
    return buildReminderHtmlLegacy({ ...options, theme: t }, htmlDir)
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
    roundedCorners: false,
    backgroundColor: '#000000',
    ...win32FramelessEdgeToEdgeOpts(),
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
  const fallbackHtml = buildReminderHtmlLegacy(
    {
      ...options,
      theme: options.theme ? ensureThemeLayers(options.theme) : undefined,
    },
    htmlDir,
  )
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

/** 与 `reminderPopupWindow` 分离，避免主题工坊全屏预览与到点提醒抢同一单例窗口 */
let themeEditorPreviewWindow: BrowserWindow | null = null

export function closeThemeEditorFullscreenPreview() {
  const w = themeEditorPreviewWindow
  themeEditorPreviewWindow = null
  if (w && !w.isDestroyed()) w.close()
}

/**
 * 主题编辑：用与到点提醒相同的 HTML（含右上角关叉、mousemove 显示 / 静止隐藏、Esc 关闭）全屏铺满主显示器。
 */
export async function showThemeEditorFullscreenPreview(options: ReminderPopupOptions): Promise<
  { success: true } | { success: false; error: string }
> {
  closeThemeEditorFullscreenPreview()
  const htmlDir = getPopupTempDir()
  const html = buildReminderHtml(options, htmlDir)
  const fallbackHtml = buildReminderHtmlLegacy(
    {
      ...options,
      theme: options.theme ? ensureThemeLayers(options.theme) : undefined,
    },
    htmlDir,
  )
  const htmlPath = writePopupHtmlToTempFile('theme-editor-preview.html', html)
  const fallbackPath = writePopupHtmlToTempFile('theme-editor-preview-fallback.html', fallbackHtml)

  const primary = screen.getPrimaryDisplay()
  const { x, y, width, height } = primary.bounds
  const win = new BrowserWindow({
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
    roundedCorners: false,
    backgroundColor: '#000000',
    ...win32FramelessEdgeToEdgeOpts(),
    webPreferences: { nodeIntegration: false, contextIsolation: true, zoomFactor: 1 },
  })
  themeEditorPreviewWindow = win
  win.on('closed', () => {
    if (themeEditorPreviewWindow === win) themeEditorPreviewWindow = null
  })
  try {
    try {
      await win.loadFile(htmlPath)
    } catch {
      if (!win.isDestroyed()) await win.loadFile(fallbackPath)
    }
    if (!win.isDestroyed()) {
      win.show()
      win.focus()
      win.setAlwaysOnTop(true, 'screen-saver')
    }
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!win.isDestroyed()) win.close()
    if (themeEditorPreviewWindow === win) themeEditorPreviewWindow = null
    return { success: false, error: message }
  }
}

/* ─── 休息即将结束：倒计时弹窗 ─── */

/** 休息段最后 N 秒：与休息主题硬切，固定黑底白字，不读主题壁纸/遮罩/排版 */
function buildRestEndCountdownHtml(countdownSec: number, allowUserClose: boolean): string {
  const sec = Math.max(1, Math.min(countdownSec, 99))
  const closeCss = allowUserClose
    ? `
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
    }`
    : ''
  const closeBtnHtml = allowUserClose
    ? `<button class="close-floating" id="closeBtn" aria-label="关闭弹窗">
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <line x1="6" y1="6" x2="18" y2="18"></line>
      <line x1="18" y1="6" x2="6" y2="18"></line>
    </svg>
  </button>`
    : ''
  const closeScript = allowUserClose
    ? `
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
      window.addEventListener('mousemove', showClose, { passive: true });
      window.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') window.close();
      });
      if (closeBtn) closeBtn.onclick = function() { window.close(); };`
    : ''
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>休息即将结束</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; color: #fff; font-family: system-ui, "Segoe UI", sans-serif; overflow: hidden; background: #000000; border-radius: 0; }
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
    ${closeCss}
  </style>
</head>
<body>
  <div class="stack">
    <div class="title">休息即将结束</div>
    <div class="countdown" id="cd">${sec}</div>
  </div>
  ${closeBtnHtml}
  <script>
    (function(){
      var remaining = ${sec};
      var el = document.getElementById('cd');
      ${closeScript}
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
      setTimeout(tick, 1000);
    })();
  </script>
</body>
</html>`
}

/**
 * 休息即将结束倒计时弹窗：全屏固定黑底白字，大数字从 countdownSec 倒数到 0 后自动关闭。
 * 复用同一个 reminderPopupWindow 单例（覆盖当前休息提醒弹窗内容）。
 * @param allowUserClose 为 false 时不显示关叉、不可用 Esc 关闭（与「强制休息模式」一致）。
 */
export function showRestEndCountdownPopup(countdownSec: number, allowUserClose = true) {
  const html = buildRestEndCountdownHtml(countdownSec, allowUserClose)
  const htmlPath = writePopupHtmlToTempFile('rest-countdown-popup.html', html)
  const fallbackPath = writePopupHtmlToTempFile('rest-countdown-popup-fallback.html', html)
  enqueuePopupLoad(htmlPath, fallbackPath)
}
