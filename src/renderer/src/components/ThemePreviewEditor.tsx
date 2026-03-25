import React, {
  useRef,
  useCallback,
  useMemo,
  useLayoutEffect,
  useState,
  useEffect,
  type ReactNode,
} from 'react'
import { flushSync } from 'react-dom'
import Moveable from 'react-moveable'
import type { PopupTheme, TextTransform } from '../types'
import { rendererSafePreviewImageUrl } from '../utils/popupThemePreview'
import { layerTextEffectsReactStyle, textFillColorCss } from '../../../shared/popupTextEffects'
import { resolvePopupFontFamilyCss, resolveDecoFontFamilyCss } from '../../../shared/popupThemeFonts'
import {
  ensureThemeLayers,
  MAIN_REST_LAYOUT_DEFAULTS,
  POPUP_BACKGROUND_IMAGE_BLUR_MAX_PX,
  resolveBackgroundImagePanForCss,
  REST_POPUP_PREVIEW_TIME_TEXT,
} from '../../../shared/settings'
import { buildPopupOverlayBackgroundCss } from '../../../shared/popupOverlayGradient'
import type { ImageThemeLayer, TextThemeLayer } from '../../../shared/popupThemeLayers'
import {
  DESKTOP_DEFAULT_TIME_DATE_TRANSFORMS,
  POPUP_LAYER_BACKGROUND_ID,
  POPUP_LAYER_BINDING_CONTENT_ID,
  POPUP_LAYER_BINDING_DATE_ID,
  POPUP_LAYER_BINDING_TIME_ID,
  POPUP_LAYER_OVERLAY_ID,
  removeThemeLayers,
  updateDecorationLayer,
} from '../../../shared/popupThemeLayers'
import { formatPopupThemeDateString } from '../../../shared/popupThemeDateFormat'
import type { PopupTextOrientationMode, PopupTextWritingMode } from '../../../shared/settings'
import {
  WB_TEXT_INNER,
  isVerticalWritingMode,
  textAlignForVerticalInner,
  verticalTextInnerDomStyle,
} from '../../../shared/popupVerticalText'
import type { PopupThemeEditUpdateMeta } from '../hooks/usePopupThemeEditHistory'

export type TextElementKey = 'content' | 'time' | 'date' | 'countdown'

/**
 * 只读缩略图（主题工坊列表等）下桌面「时间/日期」绑定层锚点：固定本地正午，
 * 与可编辑预览共用同一套 `toLocaleTimeString` / `formatPopupThemeDateString`，避免占位变窄变宽；不启定时器。
 */
const DESKTOP_THUMBNAIL_CLOCK_FROZEN_AT = new Date(2020, 5, 15, 12, 0, 0, 0)

/** 参数区优先编辑文字：预览双击时交给面板聚焦对应输入框 */
export type PanelTextFocusRequest =
  | { kind: 'binding'; key: TextElementKey }
  | { kind: 'decoration'; layerId: string }

function themeTransformField(key: TextElementKey): 'contentTransform' | 'timeTransform' | 'dateTransform' | 'countdownTransform' {
  switch (key) {
    case 'content':
      return 'contentTransform'
    case 'time':
      return 'timeTransform'
    case 'date':
      return 'dateTransform'
    case 'countdown':
      return 'countdownTransform'
  }
}

interface ThemePreviewEditorProps {
  theme: PopupTheme
  onUpdateTheme: (themeId: string, patch: Partial<PopupTheme>, meta?: PopupThemeEditUpdateMeta) => void
  previewViewportWidth: number
  previewImageUrlMap: Record<string, string>
  popupPreviewAspect: '16:9' | '4:3'
  selectedElements: TextElementKey[]
  onSelectElements: (keys: TextElementKey[]) => void
  /** 覆盖预览文案（如子项表单里的提醒内容 / 休息时间） */
  previewLabels?: Partial<Record<TextElementKey, string>>
  /** 允许双击进入文字编辑的层；默认仅 content（需同时传 onLiveTextCommit） */
  editableTextKeys?: TextElementKey[]
  /** 预览内编辑失焦后回写（如更新子项 content / restContent） */
  onLiveTextCommit?: (key: TextElementKey, text: string) => void
  /** 方向键微调作用域：含面板参数区；缺省仅预览黑底内 */
  keyboardScopeRef?: React.RefObject<HTMLElement | null>
  /** 主题工坊列表缩略图等：与完整预览同一套比例与排版，禁止编辑与拖拽 */
  readOnly?: boolean
  /** false：不显示说明条与多选对齐工具栏，仅黑底画幅（嵌入卡片顶图等） */
  showToolbar?: boolean
  /**
   * 与对齐/打组工具栏同一行、渲染在中间（如预览比例）。仅 `showToolbar !== false` 时显示；
   * 与 `toolbarTrailing` 同时存在时采用左对齐区 / 居中 / 右尾区三列布局。
   */
  toolbarCenter?: ReactNode
  /**
   * 与对齐/打组工具栏同一行、渲染在右侧（如全屏预览）。仅 `showToolbar !== false` 时显示。
   */
  toolbarTrailing?: ReactNode
  /**
   * 与全屏弹窗相同的逻辑像素画幅（宽×高）。用于主题工坊缩略图：外层再 CSS scale 压入窄槽，换行与真实弹窗一致。
   */
  fixedPreviewPixelSize?: { width: number; height: number }
  /**
   * capped：黑底画幅 max-width 920px 并居中（默认，适合窄栏/设置卡）；
   * fill：黑底画幅随父级宽度拉满（主题工坊左栏等，与主屏比例仍由 previewScale 映射）
   */
  previewWidthMode?: 'capped' | 'fill'
  /** card：白底圆角外框+内边距；none：无外框（与工具条直接贴父级，省画面） */
  outerChrome?: 'card' | 'none'
  /** 选中的装饰层（补充文本 / 图片）；与 selectedElements 互斥，由图层栏或预览点击同步 */
  selectedDecorationLayerId?: string | null
  onSelectDecorationLayer?: (id: string | null) => void
  /** 选中绑定文案/时间时清空「背景/遮罩」结构层选中（主题工坊图层栏） */
  onSelectStructuralLayer?: (id: string | null) => void
  /** 图层栏选中的背景/遮罩 id；与 Delete/Backspace 删除结构层一致 */
  selectedStructuralLayerId?: string | null
  /**
   * true：预览内文字只读，不在画布上用 contentEditable；双击文字改为回调 `onRequestPanelTextFocus`，由右侧参数区编辑。
   * 用于主题参数面板，避免横/竖排与 Moveable 框联动导致的裁切与滚动条问题。
   */
  panelFirstTextEditing?: boolean
  /** 与 `panelFirstTextEditing` 配套：双击绑定层/装饰文本时请求面板聚焦 */
  onRequestPanelTextFocus?: (req: PanelTextFocusRequest) => void
  /**
   * readOnly + fixedPreviewPixelSize（主题工坊列表缩略图）：主题未指定底色时不用纯黑，改用该浅底以减轻「未加载」黑块感。
   */
  readOnlyCanvasFallbackBg?: string
}

/** Moveable 打组轨道平移多为 translate(xpx,ypx)，偶发 translate3d */
function parseTransformValues(css: string): { translateX: number; translateY: number; rotation: number; scale: number } {
  let tx = 0, ty = 0
  const t2 = /translate\(\s*([-\d.]+)px\s*,\s*([-\d.]+)px\s*\)/.exec(css)
  if (t2) { tx = parseFloat(t2[1]); ty = parseFloat(t2[2]) }
  else {
    const t3 = /translate3d\(\s*([-\d.]+)px\s*,\s*([-\d.]+)px/.exec(css)
    if (t3) { tx = parseFloat(t3[1]); ty = parseFloat(t3[2]) }
  }
  const r = /rotate\(\s*([-\d.]+)deg\s*\)/.exec(css)
  const sm = /scale\(\s*([-\d.]+)(?:\s*,\s*([-\d.]+))?\s*\)/.exec(css)
  let sc = 1
  if (sm) {
    const sx = parseFloat(sm[1])
    const sy = sm[2] !== undefined ? parseFloat(sm[2]) : sx
    sc = Math.sqrt(Math.max(1e-8, sx * sy))
  }
  return { translateX: tx, translateY: ty, rotation: r ? parseFloat(r[1]) : 0, scale: sc }
}

function hasPixelTranslate(css: string): boolean {
  return /\btranslate\s*\([^)]*px/.test(css) || /\btranslate3d\s*\([^)]*px/.test(css)
}

function buildTransform(tx: number, ty: number, rotation: number, scale: number): string {
  return `translate(${tx}px, ${ty}px) rotate(${rotation}deg) scale(${scale})`
}

function getOverlayBackground(theme: PopupTheme): string {
  return buildPopupOverlayBackgroundCss(theme)
}

/** 元素本地四角（相对 transform-origin 中心、缩放后）映射到预览容器内像素；旋转后≠AABB 四角 */
type ScaleFixedCorner = 'tl' | 'tr' | 'bl' | 'br'

/**
 * 旋转后对象的真实角点相对容器左上角（勿用 getBoundingClientRect 的 AABB 角，否则缩放锚会像贴在「外接矩形」上）。
 * 假定 `transform-origin: center`，顺序为 translate → rotate → scale（与 buildTransform 一致）。
 */
function getRotatedLocalCornerInContainer(el: HTMLElement, cr: DOMRect, corner: ScaleFixedCorner): { x: number; y: number } {
  const er = el.getBoundingClientRect()
  const cx = (er.left + er.right) / 2 - cr.left
  const cy = (er.top + er.bottom) / 2 - cr.top
  const { rotation, scale } = parseTransformValues(el.style.transform)
  const rad = (rotation * Math.PI) / 180
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  const sc = scale || 1
  const hx = (el.offsetWidth * sc) / 2
  const hy = (el.offsetHeight * sc) / 2
  let lx = 0
  let ly = 0
  switch (corner) {
    case 'tl':
      lx = -hx
      ly = -hy
      break
    case 'tr':
      lx = hx
      ly = -hy
      break
    case 'br':
      lx = hx
      ly = hy
      break
    case 'bl':
      lx = -hx
      ly = hy
      break
  }
  // 与 CSS 2D rotate(θ) 矩阵一致：x' = x cos θ - y sin θ, y' = x sin θ + y cos θ
  const rx = lx * c - ly * s
  const ry = lx * s + ly * c
  return { x: cx + rx, y: cy + ry }
}

/**
 * Moveable Scalable 的 direction（所拖角）→ 缩放时应保持不动的对角。
 * nw [-1,-1]→右下；ne [1,-1]→左下；sw [-1,1]→右上；se [1,1]→左上。
 */
function fixedCornerFromScaleDirection(direction: number[]): ScaleFixedCorner {
  const dx = Math.sign(direction[0] || 0)
  const dy = Math.sign(direction[1] || 0)
  if (dx === -1 && dy === -1) return 'br'
  if (dx === 1 && dy === -1) return 'bl'
  if (dx === -1 && dy === 1) return 'tr'
  if (dx === 1 && dy === 1) return 'tl'
  return 'tl'
}

/** 多选缩放钉扎：用当前选中项轴对齐外包矩形（容器坐标），与 Moveable 组框一致 */
function getAxisAlignedUnionBoxInContainer(els: HTMLElement[], cr: DOMRect): {
  left: number
  top: number
  right: number
  bottom: number
} {
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const el of els) {
    const r = el.getBoundingClientRect()
    left = Math.min(left, r.left - cr.left)
    top = Math.min(top, r.top - cr.top)
    right = Math.max(right, r.right - cr.left)
    bottom = Math.max(bottom, r.bottom - cr.top)
  }
  if (!Number.isFinite(left)) return { left: 0, top: 0, right: 0, bottom: 0 }
  return { left, top, right, bottom }
}

function unionBoxCorner(
  u: { left: number; top: number; right: number; bottom: number },
  corner: ScaleFixedCorner,
): { x: number; y: number } {
  switch (corner) {
    case 'tl':
      return { x: u.left, y: u.top }
    case 'tr':
      return { x: u.right, y: u.top }
    case 'br':
      return { x: u.right, y: u.bottom }
    case 'bl':
      return { x: u.left, y: u.bottom }
  }
}

/** Moveable 拖动缩放过程中可能输出 scale(sx,sy) 且 sx≠sy，字会被「压扁/拉宽」；松手后若只取单轴易误判，故在每一帧强制为等比 scale */
function forceUniformScaleInFullTransform(css: string): string {
  if (!css || !/\bscale\s*\(/.test(css)) return css
  return css.replace(/scale\(\s*([-\d.]+)(?:\s*,\s*([-\d.]+))?\s*\)/g, (_m, a, b) => {
    const sx = parseFloat(a)
    const sy = b !== undefined ? parseFloat(b) : sx
    const u = Math.sqrt(Math.max(1e-8, sx * sy))
    return `scale(${u})`
  })
}

/**
 * 打组旋转/缩放：子事件里 `transform` 常只有 rotate/scale；
 * 轨道平移多在 `drag.transform`；`afterTransform` 理论上等于 drag 合成，但有时与 `transform` 相同（都缺平移）。
 */
function pickMoveableCssTransform(e: { transform?: string; afterTransform?: string; drag?: { transform?: string; afterTransform?: string } }): string {
  const t = (e.transform ?? '').trim()
  const a = (e.afterTransform ?? '').trim()
  const dt = (e.drag?.transform ?? '').trim()
  const da = (e.drag?.afterTransform ?? '').trim()

  if (a.length > 0 && a !== t && hasPixelTranslate(a)) return a
  if (dt.length > 0 && hasPixelTranslate(dt)) return dt
  if (da.length > 0 && hasPixelTranslate(da)) return da
  if (a.length > 0 && hasPixelTranslate(a)) return a
  if (a.length > 0) return a
  if (da.length > 0) return da
  if (dt.length > 0) return dt
  return t
}

/** Shift 吸附角度：只改第一个 rotate()，保留多段 translate 等 */
/** Moveable 把手/连线等；点击时会抢走 contentEditable 焦点（relatedTarget 有时为 null，需配合 pointer 捕获 ref） */
function isThemePreviewMoveableChrome(node: EventTarget | null): boolean {
  if (!node || !(node instanceof HTMLElement)) return false
  return Boolean(
    node.closest('.moveable-control-box') ||
      node.closest('.moveable-control') ||
      node.closest('.moveable-line'),
  )
}

function snapRotateInFullTransform(css: string, inputEvent: MouseEvent | TouchEvent | null): string {
  if (!inputEvent || !(inputEvent as MouseEvent).shiftKey) return css
  const m = /rotate\(\s*([-\d.]+)deg\s*\)/.exec(css)
  if (!m || m.index === undefined) return css
  const r = parseFloat(m[1])
  const snapped = Math.round(r / 15) * 15
  return css.slice(0, m.index) + `rotate(${snapped}deg)` + css.slice(m.index + m[0].length)
}

/** 自动贴合：默认宽/高不超过预览区该比例；超出在框内换行/换列并由内层 overflow 滚动；手动拉框仍可至 CONTENT_TEXT_BOX_CAP_RATIO */
const CONTENT_TEXT_AUTO_FIT_MAX_RATIO = 0.8
/** 横排：单行固有宽 ≤ 此比例时栏宽贴内容；超出则锁为该比例宽并换行（与竖排列高上限对称） */
const CONTENT_TEXT_INLINE_MAX_RATIO = CONTENT_TEXT_AUTO_FIT_MAX_RATIO
const CONTENT_TEXT_BOX_CAP_RATIO = 0.96
/** 竖排：单列沿预览区高度方向不超过此比例时贴高；超出则锁高并换列 */
const CONTENT_TEXT_VERTICAL_INLINE_MAX_RATIO = CONTENT_TEXT_AUTO_FIT_MAX_RATIO
/**
 * 竖排画布编辑：外层列高取自 textBoxHeightPct。若为横排遗留的较小百分比（如一行高 12%），
 * 列过矮会迫使块向多列挤在窄宽内，出现假横条、截断，失焦后宽高语义错乱。非手动拉框时低于此阈值则编辑态列高改用画布 80%。
 */
const VERTICAL_EDIT_COLUMN_MIN_HEIGHT_PCT = 28

type ContentTextBoxAutoOpts = { force?: boolean }

/** 主文案输入时写回 textBox 的防抖（ms），减轻 scrollHeight 与重渲染导致的 Moveable 高度抖动 */
const TEXT_EDIT_LAYOUT_DEBOUNCE_MS = 90

function parseDecoWritingSigToMap(sig: string): Map<string, string> {
  const m = new Map<string, string>()
  if (!sig) return m
  for (const seg of sig.split('|')) {
    const idx = seg.indexOf(':')
    if (idx <= 0) continue
    const id = seg.slice(0, idx)
    const wm = seg.slice(idx + 1)
    if (id) m.set(id, wm)
  }
  return m
}

/** 签名变化时仅「新建层或 writingMode 变化」的 id；避免对全部装饰层 force 贴盒引发连串 onUpdateTheme + ResizeObserver，新建文本时 Moveable 底边像往下「长」一截 */
function decoWritingSigTouchedLayerIds(prevSig: string, nextSig: string): string[] {
  if (prevSig === nextSig) return []
  const prevM = parseDecoWritingSigToMap(prevSig)
  const nextM = parseDecoWritingSigToMap(nextSig)
  const touched: string[] = []
  for (const [id, wm] of nextM) {
    if (prevM.get(id) !== wm) touched.push(id)
  }
  return touched
}

/** 与 liveSnap / useMemo 依赖稳定：勿每轮渲染 new 新数组，否则小窗预览会跟着时钟抖动 */
const DEFAULT_EDITABLE_CONTENT_ONLY: TextElementKey[] = ['content']
/** 仅主文案可预览内双击编辑；时间层仅 Moveable 变换（与真实弹窗一致） */
const DEFAULT_EDITABLE_ALL_LAYERS: TextElementKey[] = ['content']

/** 结束 / 休息壁纸共用同一套默认层变换，仅 `target` 决定子项关联用途 */
export const DEFAULT_LAYER_TRANSFORMS: Record<TextElementKey, TextTransform> = {
  content: { ...MAIN_REST_LAYOUT_DEFAULTS.contentTransform },
  /** 时间单行：不设 textBoxHeightPct，高度随字行高，避免预览 Moveable 上下留白过大 */
  time: { ...MAIN_REST_LAYOUT_DEFAULTS.timeTransform },
  date: { x: 50, y: 65, rotation: 0, scale: 1 },
  countdown: { x: 50, y: 78, rotation: 0, scale: 1 },
}
export const DEFAULT_TRANSFORMS: Record<'main' | 'rest' | 'desktop', Record<TextElementKey, TextTransform>> = {
  main: DEFAULT_LAYER_TRANSFORMS,
  rest: DEFAULT_LAYER_TRANSFORMS,
  desktop: {
    ...DEFAULT_LAYER_TRANSFORMS,
    time: DESKTOP_DEFAULT_TIME_DATE_TRANSFORMS.timeTransform,
    date: DESKTOP_DEFAULT_TIME_DATE_TRANSFORMS.dateTransform,
  },
}

const ALIGN_ICONS = {
  left: (<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><line x1="2" y1="2" x2="2" y2="14" /><line x1="5" y1="5" x2="14" y2="5" /><line x1="5" y1="11" x2="11" y2="11" /></svg>),
  centerH: (<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><line x1="8" y1="2" x2="8" y2="14" /><line x1="3" y1="5" x2="13" y2="5" /><line x1="4" y1="11" x2="12" y2="11" /></svg>),
  right: (<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><line x1="14" y1="2" x2="14" y2="14" /><line x1="2" y1="5" x2="11" y2="5" /><line x1="5" y1="11" x2="11" y2="11" /></svg>),
  top: (<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><line x1="2" y1="2" x2="14" y2="2" /><line x1="5" y1="5" x2="5" y2="14" /><line x1="11" y1="5" x2="11" y2="11" /></svg>),
  centerV: (<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><line x1="2" y1="8" x2="14" y2="8" /><line x1="5" y1="3" x2="5" y2="13" /><line x1="11" y1="4" x2="11" y2="12" /></svg>),
  bottom: (<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><line x1="2" y1="14" x2="14" y2="14" /><line x1="5" y1="2" x2="5" y2="11" /><line x1="11" y1="5" x2="11" y2="11" /></svg>),
}

const GROUP_ICON = (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="1" width="5" height="5" rx="0.5" /><rect x="8" y="8" width="5" height="5" rx="0.5" />
    <path d="M6 3.5h2M8 3.5v5M8 8.5h-2M6 8.5v-5" strokeDasharray="1.5 1" />
  </svg>
)
const UNGROUP_ICON = (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="1" width="5" height="5" rx="0.5" /><rect x="8" y="8" width="5" height="5" rx="0.5" />
  </svg>
)

interface ElementSnapshot { t: TextTransform; txPx: number; tyPx: number }

function alignForKey(theme: PopupTheme, key: TextElementKey): PopupTheme['textAlign'] {
  if (key === 'content') return theme.contentTextAlign ?? theme.textAlign
  if (key === 'time') return theme.timeTextAlign ?? theme.textAlign
  if (key === 'date') return theme.dateTextAlign ?? theme.textAlign
  return theme.countdownTextAlign ?? theme.textAlign
}

function verticalAlignForKey(theme: PopupTheme, key: TextElementKey): 'top' | 'middle' | 'bottom' {
  const base = theme.textVerticalAlign ?? 'middle'
  if (key === 'content') return theme.contentTextVerticalAlign ?? base
  if (key === 'time') return theme.timeTextVerticalAlign ?? base
  if (key === 'date') return theme.dateTextVerticalAlign ?? base
  return theme.countdownTextVerticalAlign ?? base
}

function justifyFromTextAlign(align: PopupTheme['textAlign']): 'flex-start' | 'center' | 'flex-end' {
  if (align === 'left' || align === 'start' || align === 'justify') return 'flex-start'
  if (align === 'right' || align === 'end') return 'flex-end'
  return 'center'
}

function alignFromVerticalAlign(align: 'top' | 'middle' | 'bottom'): 'flex-start' | 'center' | 'flex-end' {
  if (align === 'top') return 'flex-start'
  if (align === 'bottom') return 'flex-end'
  return 'center'
}

function letterSpacingForKey(theme: PopupTheme, key: TextElementKey): number {
  if (key === 'content') return theme.contentLetterSpacing ?? 0
  if (key === 'time') return theme.timeLetterSpacing ?? 0
  if (key === 'date') return theme.dateLetterSpacing ?? 0
  return theme.countdownLetterSpacing ?? 0
}

function lineHeightForKey(theme: PopupTheme, key: TextElementKey): number {
  if (key === 'content') return theme.contentLineHeight ?? 1.35
  if (key === 'time') return theme.timeLineHeight ?? 1
  if (key === 'date') return theme.dateLineHeight ?? 1
  return theme.countdownLineHeight ?? 1
}

function getTextLayoutRoot(el: HTMLElement): HTMLElement {
  return (el.querySelector(`[${WB_TEXT_INNER}]`) as HTMLElement | null) ?? el
}

/**
 * 竖排块向（物理宽度）测量时，外层若仍为横排遗留的窄 `width: %`，会夹死内层 `max-content`，
 * `scrollWidth` 偏小 → 编辑态 Moveable 不随列变宽、失焦后宽度写回错误呈「长条截断」。
 */
function pushVerticalMeasureUnconstrainOuter(
  outer: HTMLElement,
  inner: HTMLElement,
  maxOuterWidthPx: number,
): () => void {
  if (outer === inner) return () => {}
  const capPx = Math.max(1, maxOuterWidthPx)
  const prev = {
    width: outer.style.width,
    maxWidth: outer.style.maxWidth,
    minWidth: outer.style.minWidth,
    boxSizing: outer.style.boxSizing,
  }
  outer.style.boxSizing = 'border-box'
  outer.style.width = 'max-content'
  outer.style.maxWidth = `${capPx}px`
  outer.style.minWidth = '0'
  return () => {
    outer.style.width = prev.width
    outer.style.maxWidth = prev.maxWidth
    outer.style.minWidth = prev.minWidth
    outer.style.boxSizing = prev.boxSizing
  }
}

function writingModeForKey(theme: PopupTheme, key: TextElementKey): PopupTextWritingMode {
  if (key === 'content') return theme.contentWritingMode ?? 'horizontal-tb'
  /** 时间/日期仅横排（产品决策：不开放竖排） */
  if (key === 'time' || key === 'date') return 'horizontal-tb'
  return theme.countdownWritingMode ?? 'horizontal-tb'
}

function textOrientationForKey(theme: PopupTheme, key: TextElementKey): PopupTextOrientationMode | undefined {
  if (key === 'content') return theme.contentTextOrientation
  if (key === 'time' || key === 'date') return undefined
  return theme.countdownTextOrientation
}

function combineUprightForKey(theme: PopupTheme, key: TextElementKey): boolean {
  if (key === 'content') return theme.contentCombineUprightDigits === true
  if (key === 'time' || key === 'date') return false
  return theme.countdownCombineUprightDigits !== false
}

function previewBackgroundImageTransformStyle(theme: PopupTheme): React.CSSProperties {
  const { txPct, tyPct, rotation, scale } = resolveBackgroundImagePanForCss(theme)
  return {
    backgroundPosition: 'center',
    transform: `translate(${txPct}%, ${tyPct}%) rotate(${rotation}deg) scale(${scale})`,
    transformOrigin: 'center center',
  }
}

/** 文件夹壁纸：与真弹窗一致的双层交叉淡化（仅可编辑预览；只读缩略图走首张静态图） */
function FolderBgCrossfade({
  layerId,
  zIndex,
  urls,
  intervalSec,
  crossfadeSec,
  randomMode,
  bgColor,
  blur,
  bgTransformStyle,
}: {
  layerId: string
  zIndex: number
  urls: string[]
  intervalSec: number
  crossfadeSec: number
  randomMode: boolean
  bgColor: string
  blur: number
  bgTransformStyle: React.CSSProperties
}) {
  const holdMs = Math.max(300, Math.round(intervalSec * 1000))
  const fadeMs = Math.max(100, Math.round(crossfadeSec * 1000))
  const blurOut = blur > 0 ? Math.min(200, Math.ceil(blur * 2.5)) : 0
  const [opA, setOpA] = useState(1)
  const [opB, setOpB] = useState(0)
  const [urlA, setUrlA] = useState(urls[0] ?? '')
  const [urlB, setUrlB] = useState(urls.length >= 2 ? (urls[1 % urls.length] ?? '') : '')
  const idxRef = useRef(0)
  const topARef = useRef(true)

  useEffect(() => {
    if (urls.length < 2) return
    setUrlA(urls[0] ?? '')
    setUrlB(urls[1 % urls.length] ?? '')
    setOpA(1)
    setOpB(0)
    idxRef.current = 0
    topARef.current = true
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const pickNext = (): number => {
      if (randomMode) {
        const j = Math.floor(Math.random() * urls.length)
        return j === idxRef.current ? (j + 1) % urls.length : j
      }
      return (idxRef.current + 1) % urls.length
    }
    const tick = () => {
      if (cancelled) return
      const ni = pickNext()
      if (topARef.current) {
        setUrlB(urls[ni] ?? '')
        setOpB(1)
        setOpA(0)
      } else {
        setUrlA(urls[ni] ?? '')
        setOpA(1)
        setOpB(0)
      }
      idxRef.current = ni
      topARef.current = !topARef.current
      timer = setTimeout(tick, holdMs + fadeMs)
    }
    timer = setTimeout(tick, holdMs)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [urls, holdMs, fadeMs, randomMode])

  const innerBg = (url: string) =>
    blur > 0 ? (
      <div className="absolute overflow-hidden" style={{ inset: 0 }}>
        <div
          className="absolute"
          style={{
            left: -blurOut,
            top: -blurOut,
            width: `calc(100% + ${blurOut * 2}px)`,
            height: `calc(100% + ${blurOut * 2}px)`,
            backgroundImage: `url("${url}")`,
            backgroundSize: 'cover',
            backgroundRepeat: 'no-repeat',
            filter: `blur(${blur}px)`,
            ...bgTransformStyle,
          }}
        />
      </div>
    ) : (
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `url("${url}")`,
          backgroundSize: 'cover',
          backgroundRepeat: 'no-repeat',
          ...bgTransformStyle,
        }}
      />
    )

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      data-layer="bg"
      style={{ zIndex: zIndex, backgroundColor: bgColor }}
      data-bg-folder-slideshow={layerId}
    >
      <div
        className="absolute inset-0"
        style={{
          opacity: opA,
          transition: `opacity ${fadeMs}ms ease-in-out`,
          overflow: 'hidden',
          pointerEvents: 'none',
          backgroundColor: bgColor,
        }}
      >
        {urlA ? innerBg(urlA) : null}
      </div>
      <div
        className="absolute inset-0"
        style={{
          opacity: opB,
          transition: `opacity ${fadeMs}ms ease-in-out`,
          overflow: 'hidden',
          pointerEvents: 'none',
          backgroundColor: bgColor,
        }}
      >
        {urlB ? innerBg(urlB) : null}
      </div>
    </div>
  )
}

export function ThemePreviewEditor({
  theme, onUpdateTheme, previewViewportWidth, previewImageUrlMap,
  popupPreviewAspect, selectedElements, onSelectElements,
  previewLabels,
  editableTextKeys,
  onLiveTextCommit,
  keyboardScopeRef,
  readOnly = false,
  showToolbar = true,
  previewWidthMode = 'capped',
  outerChrome = 'card',
  fixedPreviewPixelSize,
  selectedDecorationLayerId = null,
  onSelectDecorationLayer,
  onSelectStructuralLayer,
  selectedStructuralLayerId = null,
  panelFirstTextEditing = false,
  onRequestPanelTextFocus,
  readOnlyCanvasFallbackBg,
  toolbarCenter,
  toolbarTrailing,
}: ThemePreviewEditorProps) {
  /** 未传回调时仍允许画布内联编辑，避免误开 panelFirst 导致无法改字 */
  const useInlineTextEditing = !readOnly && !(panelFirstTextEditing && Boolean(onRequestPanelTextFocus))
  const previewDefaultBg =
    readOnly && fixedPreviewPixelSize && readOnlyCanvasFallbackBg
      ? theme.backgroundColor?.trim() || readOnlyCanvasFallbackBg
      : theme.backgroundColor?.trim() || '#000000'
  const containerRef = useRef<HTMLDivElement>(null)
  const decoRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const contentRef = useRef<HTMLDivElement>(null)
  const timeRef = useRef<HTMLDivElement>(null)
  const dateRef = useRef<HTMLDivElement>(null)
  const moveableRef = useRef<Moveable | null>(null)

  /**
   * 未指定时：有 onLiveTextCommit 仅开放主文案（子项小预览）；否则三层均可编辑（主题工坊写回 preview* 字段）
   * 稳定化：
   * - `onLiveTextCommit` 常为内联函数，不能以引用为 deps；
   * - `editableTextKeys` 常为内联数组（如 Panel 仅主文案等），引用每帧变也会拖垮 liveSnap。
   * 故：用 `hasLiveTextCommit` + `editableKeysSig`（排序拼接）作为 memo 依赖；显式 keys 在 sig 不变时返回缓存的拷贝。
   */
  const hasLiveTextCommit = Boolean(onLiveTextCommit)
  const editableTextKeysRef = useRef(editableTextKeys)
  editableTextKeysRef.current = editableTextKeys
  const editableKeysSig =
    editableTextKeys != null && editableTextKeys.length > 0
      ? [...editableTextKeys].sort().join('\x1e')
      : ''
  const effectiveEditableKeys = useMemo((): TextElementKey[] => {
    if (readOnly) return []
    if (editableKeysSig !== '') {
      const src = editableTextKeysRef.current
      if (src != null && src.length > 0) return [...src]
    }
    if (hasLiveTextCommit) return DEFAULT_EDITABLE_CONTENT_ONLY
    return DEFAULT_EDITABLE_ALL_LAYERS
  }, [readOnly, editableKeysSig, hasLiveTextCommit])

  const [editingTextKey, setEditingTextKey] = useState<TextElementKey | null>(null)
  const editingTextKeyRef = useRef<TextElementKey | null>(null)
  editingTextKeyRef.current = editingTextKey
  const themeForVerticalRepairRef = useRef(theme)
  themeForVerticalRepairRef.current = theme
  /** onLoad / 异步回调里读最新 theme，避免闭包陈旧 */
  const themeLatestRef = useRef(theme)
  themeLatestRef.current = theme
  /** 装饰图片层：同 path+natural 尺寸已成功「纠宽高比」写回 theme 则跳过后续 onLoad，避免 StrictMode 双调用重复提交 */
  const imageDecoIntrinsicPatchedKeyRef = useRef<Record<string, string>>({})

  const [editingDecoLayerId, setEditingDecoLayerId] = useState<string | null>(null)
  const editingDecoLayerIdRef = useRef<string | null>(null)
  editingDecoLayerIdRef.current = editingDecoLayerId
  /** 内联编辑时关闭 Moveable 拖拽/旋转/等比缩放，避免抢走 contentEditable 的指针与焦点 */
  const moveableTransformGesturesEnabled = !(
    useInlineTextEditing &&
    (editingTextKey != null || editingDecoLayerId != null)
  )
  /** 框选得到的装饰层多选（text/image）；单选仍走 selectedDecorationLayerId */
  const [marqueeDecorationLayerIds, setMarqueeDecorationLayerIds] = useState<string[]>([])
  /** 避免：点空白 blur 后同一次点击又执行 onSelectElements([]) 清掉选中 */
  const justExitedTextEditRef = useRef(false)
  /** 捕获阶段：指针落在 Moveable 控件上（先于 contentEditable 的 blur） */
  const moveableChromePointerDownRef = useRef(false)
  /** 编辑中频繁改 theme 的 textBox 会触发重渲染 + scrollHeight 抖动；输入时防抖再写回 */
  const contentLayoutInputDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const decoLayoutInputDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /**
   * 单选缩放锚点：
   * - 默认：拖哪个角，**对角**相对黑底容器位置不动（直觉上的「从对角拉开」）；
   * - 按住 **Ctrl**：锁定 AABB **中心**；松键时按当前几何与起始拖角恢复对角锚点。
   */
  const scalePinBoxRef = useRef<
    | { mode: 'corner'; corner: ScaleFixedCorner; pinX: number; pinY: number }
    | { mode: 'center'; cx: number; cy: number }
    | null
  >(null)
  /** 松手 Ctrl 时恢复对角锚点用（与 onScaleStart 的 direction 一致） */
  const scaleDirectionForPinRef = useRef<number[] | null>(null)

  const [groupMode, setGroupMode] = useState(true)
  /** 为 true 时禁止从 theme 同步 transform 到 DOM（避免覆盖 Moveable）；必须用 React style 持有 transform，否则父组件重渲染会清掉 Moveable 写的内联样式 */
  const [transformSyncLocked, setTransformSyncLocked] = useState(false)
  /** ResizeObserver / fonts.ready 回调需读最新锁定态，避免闭包过期 */
  const transformSyncLockedRef = useRef(false)
  transformSyncLockedRef.current = transformSyncLocked
  /** 与 theme 对齐的 transform 字符串，必须出现在 JSX style 中，防止 React 提交时抹掉 transform */
  const [styleTransformByKey, setStyleTransformByKey] = useState<Partial<Record<TextElementKey, string>>>({})
  const [decoStyleTransformById, setDecoStyleTransformById] = useState<Record<string, string>>({})

  /**
   * 与真实全屏弹窗的横向比例：须用「当前预览盒实际宽度 / 逻辑视口宽」，不能用固定 920。
   * 否则在子项窄栏、展开前后宽度变化时，字号/字距仍按 920 参考缩放 → 文字远大于画面（位置/旋转相对也会「不对」）。
   */
  const [previewContainerWidth, setPreviewContainerWidth] = useState(0)
  /** 与宽度同步测量，供吸附线用；勿在 useMemo 里读 ref，否则首帧常为 null → 贴边无磁力 */
  const [previewContainerHeight, setPreviewContainerHeight] = useState(0)
  const fallbackPreviewScale = Math.min(1, 920 / Math.max(1, previewViewportWidth))
  const previewScale =
    previewContainerWidth > 1
      ? Math.min(1, previewContainerWidth / Math.max(1, previewViewportWidth))
      : fallbackPreviewScale
  const toPreviewPx = (px: number) => Math.max(1, px * previewScale)

  /**
   * Moveable 吸附线：须包含预览黑底 **四边**（0 与宽高），否则拖到边缘没有「磁力」。
   * 坐标来自 `previewContainerWidth/Height`（ResizeObserver + layout），避免 useMemo 读 ref 首帧为空。
   */
  const previewSnapGuidelines = useMemo(() => {
    const w = previewContainerWidth
    const h = previewContainerHeight
    if (w < 2 || h < 2) return { vertical: [] as number[], horizontal: [] as number[] }
    const rv = (x: number) => Math.round(x)
    return {
      vertical: [0, rv(w * 0.25), rv(w * 0.5), rv(w * 0.75), rv(w)],
      horizontal: [0, rv(h * 0.25), rv(h * 0.5), rv(h * 0.75), rv(h)],
    }
  }, [previewContainerWidth, previewContainerHeight])

  /** 预览用逻辑字号：与松手缩放烘焙一致用整数 px，避免先小数再 floor/归一化导致轻微跳变 */
  const contentFontPx = Math.max(
    1,
    Math.min(
      8000,
      Math.round(
        theme.contentFontSize ??
          (theme.target === 'main' || theme.target === 'rest'
            ? MAIN_REST_LAYOUT_DEFAULTS.contentFontSize
            : 180),
      ),
    ),
  )
  const timeFontPx = Math.max(
    1,
    Math.min(
      8000,
      Math.round(
        theme.timeFontSize ??
          (theme.target === 'desktop'
            ? DESKTOP_DEFAULT_TIME_DATE_TRANSFORMS.timeFontSize!
            : MAIN_REST_LAYOUT_DEFAULTS.timeFontSize),
      ),
    ),
  )
  const dateFontPx = Math.max(
    1,
    Math.min(
      8000,
      Math.round(
        theme.dateFontSize ??
          (theme.target === 'desktop' ? DESKTOP_DEFAULT_TIME_DATE_TRANSFORMS.dateFontSize! : 72),
      ),
    ),
  )
  const countdownFontPx = Math.max(1, Math.min(8000, Math.round(theme.countdownFontSize ?? 180)))

  /** 日期预览：可编辑模式下定时刷新；只读缩略图不注册定时器（见 readOnly 分支） */
  const [datePreviewTick, setDatePreviewTick] = useState(0)
  useEffect(() => {
    if (readOnly) return undefined
    if (theme.target === 'desktop') {
      let cancelled = false
      let tid: ReturnType<typeof window.setTimeout> | undefined
      const tickAligned = () => {
        if (cancelled) return
        setDatePreviewTick((n) => n + 1)
        const ms = Date.now() % 1000
        const dly = ms === 0 ? 1000 : 1000 - ms
        tid = window.setTimeout(tickAligned, dly)
      }
      tickAligned()
      return () => {
        cancelled = true
        if (tid !== undefined) window.clearTimeout(tid)
      }
    }
    const id = window.setInterval(() => setDatePreviewTick((n) => n + 1), 30000)
    return () => clearInterval(id)
  }, [theme.target, readOnly])

  /** 切换休息/结束/桌面等导致图层与 DOM 重建时，退出编辑态，避免 contentEditable 挂在已卸载节点上 */
  useEffect(() => {
    setEditingTextKey(null)
    setEditingDecoLayerId(null)
  }, [theme.target, theme.id])

  const getTransform = useCallback((key: TextElementKey): TextTransform => {
    const t =
      key === 'content'
        ? theme.contentTransform
        : key === 'time'
          ? theme.timeTransform
          : key === 'date'
            ? theme.dateTransform
            : theme.countdownTransform
    const fallbackTarget: 'main' | 'rest' | 'desktop' =
      theme.target === 'rest' || theme.target === 'desktop' ? theme.target : 'main'
    const layerDefaults = DEFAULT_TRANSFORMS[fallbackTarget]
    return t ?? layerDefaults[key] ?? { x: 50, y: 50, rotation: 0, scale: 1 }
  }, [theme.contentTransform, theme.timeTransform, theme.dateTransform, theme.countdownTransform, theme.target])

  const getTransformRef = useRef(getTransform)
  getTransformRef.current = getTransform

  const updateTransform = useCallback((key: TextElementKey, patch: Partial<TextTransform>) => {
    const current = getTransform(key)
    const field = themeTransformField(key)
    onUpdateTheme(theme.id, { [field]: { ...current, ...patch } })
  }, [getTransform, onUpdateTheme, theme.id])

  /**
   * 竖排以列序贴边（flex-start / flex-end）时，失焦后栏宽变化会改变 offsetWidth；
   * theme 的 x 为块中心百分比，不修正则视觉上图块会相对列序「滑」向一侧。
   */
  const adjustBindingVerticalEdgeAnchor = useCallback(
    (key: TextElementKey, el: HTMLElement, widthBefore: number) => {
      if (widthBefore < 2 || key !== 'content') return
      const wm = writingModeForKey(theme, key)
      if (!isVerticalWritingMode(wm)) return
      const cur = getTransformRef.current(key)
      if (cur.contentTextBoxUserSized === true) return
      const wAfter = el.offsetWidth
      if (Math.abs(wAfter - widthBefore) < 0.75) return
      const container = containerRef.current
      if (!container) return
      const cW = container.offsetWidth
      const oldCx = (cW * cur.x) / 100
      const newX =
        wm === 'vertical-lr'
          ? Math.max(0, Math.min(100, ((oldCx - widthBefore / 2 + wAfter / 2) / cW) * 100))
          : Math.max(0, Math.min(100, ((oldCx + widthBefore / 2 - wAfter / 2) / cW) * 100))
      if (Math.abs(newX - cur.x) < 0.08) return
      updateTransform(key, { x: newX })
    },
    [theme, updateTransform],
  )

  const adjustDecoVerticalEdgeAnchor = useCallback(
    (layerId: string, el: HTMLElement, widthBefore: number) => {
      if (widthBefore < 2) return
      const layers = ensureThemeLayers(theme).layers ?? []
      const L = layers.find((x) => x.id === layerId && x.kind === 'text') as TextThemeLayer | undefined
      if (!L || L.bindsReminderBody) return
      const wm = L.writingMode ?? 'horizontal-tb'
      if (!isVerticalWritingMode(wm)) return
      const cur = L.transform ?? { x: 50, y: 50, rotation: 0, scale: 1 }
      if (cur.contentTextBoxUserSized === true) return
      const wAfter = el.offsetWidth
      if (Math.abs(wAfter - widthBefore) < 0.75) return
      const container = containerRef.current
      if (!container) return
      const cW = container.offsetWidth
      const oldCx = (cW * (cur.x ?? 50)) / 100
      const newX =
        wm === 'vertical-lr'
          ? Math.max(0, Math.min(100, ((oldCx - widthBefore / 2 + wAfter / 2) / cW) * 100))
          : Math.max(0, Math.min(100, ((oldCx + widthBefore / 2 - wAfter / 2) / cW) * 100))
      if (Math.abs(newX - (cur.x ?? 50)) < 0.08) return
      const patch = updateDecorationLayer(theme, layerId, {
        transform: { ...cur, x: newX },
      })
      if (patch) onUpdateTheme(theme.id, patch)
    },
    [theme, onUpdateTheme],
  )

  /** 装饰文本层 transform（与主文案 contentTransform 字段结构相同，含 contentTextBoxUserSized） */
  const getDecoTextLayerTransform = useCallback((layerId: string): TextTransform | null => {
    const layers = ensureThemeLayers(theme).layers ?? []
    const layer = layers.find((x) => x.id === layerId && x.kind === 'text') as TextThemeLayer | undefined
    if (!layer || layer.bindsReminderBody) return null
    return layer.transform ?? { x: 50, y: 50, rotation: 0, scale: 1 }
  }, [theme])
  const getDecoTextLayerTransformRef = useRef(getDecoTextLayerTransform)
  getDecoTextLayerTransformRef.current = getDecoTextLayerTransform

  const getTargetRef = useCallback((key: TextElementKey | null) => {
    if (key === 'content') return contentRef
    if (key === 'time') return timeRef
    if (key === 'date') return dateRef
    return null
  }, [])

  const elementGuidelineRefs = useCallback(() => {
    const refs: HTMLDivElement[] = []
    if (contentRef.current && !selectedElements.includes('content')) refs.push(contentRef.current)
    if (timeRef.current && !selectedElements.includes('time')) refs.push(timeRef.current)
    if (dateRef.current && !selectedElements.includes('date')) refs.push(dateRef.current)
    const ly = ensureThemeLayers(theme).layers ?? []
    for (const L of ly) {
      if (!L.visible) continue
      if (L.kind === 'image') {
        const el = decoRefs.current[L.id]
        if (el && L.id !== selectedDecorationLayerId) refs.push(el)
        continue
      }
      if (L.kind === 'text') {
        const tl = L as TextThemeLayer
        if (tl.bindsReminderBody) continue
        const el = decoRefs.current[L.id]
        if (el && L.id !== selectedDecorationLayerId) refs.push(el)
      }
    }
    return refs
  }, [selectedElements, selectedDecorationLayerId, theme, theme.target])

  const handleElementClick = useCallback((key: TextElementKey, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingDecoLayerId(null)
    setMarqueeDecorationLayerIds([])
    onSelectStructuralLayer?.(null)
    onSelectDecorationLayer?.(null)
    if (e.shiftKey) {
      if (selectedElements.includes(key)) onSelectElements(selectedElements.filter(k => k !== key))
      else onSelectElements([...selectedElements, key])
    } else {
      if (selectedElements.length === 1 && selectedElements[0] === key) return
      onSelectElements([key])
    }
  }, [onSelectElements, selectedElements, onSelectDecorationLayer, onSelectStructuralLayer])

  const folderPreviewUrls = useMemo(() => {
    if (theme.backgroundType !== 'image' || theme.imageSourceType !== 'folder') return [] as string[]
    const out: string[] = []
    for (const f of theme.imageFolderFiles ?? []) {
      if (typeof f !== 'string' || !f.trim()) continue
      const u = rendererSafePreviewImageUrl(f.trim(), previewImageUrlMap)
      if (u) out.push(u)
    }
    return out
  }, [theme.backgroundType, theme.imageSourceType, theme.imageFolderFiles, previewImageUrlMap])

  const singleBgPath = (theme.imagePath ?? '').trim()
  const bgImageUrl =
    theme.imageSourceType === 'folder'
      ? (folderPreviewUrls[0] ?? '')
      : rendererSafePreviewImageUrl(singleBgPath, previewImageUrlMap)
  const hasBgImage =
    theme.backgroundType === 'image' &&
    (Boolean(singleBgPath) || (theme.imageFolderFiles != null && theme.imageFolderFiles.length > 0))

  const getDisplayText = useCallback(
    (key: TextElementKey, fallback: string) => {
      const pl = previewLabels?.[key]
      if (key === 'content') {
        if (pl != null && pl !== '') return pl
        if (theme.previewContentText?.trim()) return theme.previewContentText.trim()
        return fallback
      }
      if (key === 'time') {
        if (theme.target === 'desktop') {
          const loc = (theme.dateLocale ?? '').trim() || 'zh-CN'
          const at = readOnly ? DESKTOP_THUMBNAIL_CLOCK_FROZEN_AT : new Date()
          return at.toLocaleTimeString(loc, {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
          })
        }
        if (theme.target === 'rest') {
          if (theme.previewTimeText?.trim()) return theme.previewTimeText.trim()
          if (pl != null && pl !== '') return pl
          return REST_POPUP_PREVIEW_TIME_TEXT
        }
        if (theme.previewTimeText?.trim()) return theme.previewTimeText.trim()
        if (pl != null && pl !== '') return pl
        return fallback
      }
      if (key === 'date') {
        const at =
          theme.target === 'desktop' && readOnly ? DESKTOP_THUMBNAIL_CLOCK_FROZEN_AT : new Date()
        return formatPopupThemeDateString(theme, at, 'preview') || fallback
      }
      if (theme.previewCountdownText?.trim()) return theme.previewCountdownText.trim()
      if (pl != null && pl !== '') return pl
      return fallback
    },
    [
      previewLabels,
      theme,
      theme.previewContentText,
      theme.previewTimeText,
      theme.previewCountdownText,
      theme.previewDateText,
      theme.dateLocale,
      theme.dateShowYear,
      theme.dateShowMonth,
      theme.dateShowDay,
      theme.dateShowWeekday,
      theme.dateYearFormat,
      theme.dateMonthFormat,
      theme.dateDayFormat,
      theme.dateWeekdayFormat,
      datePreviewTick,
      theme.target,
      readOnly,
    ],
  )

  const textLayerPairs = useMemo((): { key: TextElementKey; ref: React.RefObject<HTMLDivElement | null> }[] => {
    const ly = ensureThemeLayers(theme).layers ?? []
    const hasDate = ly.some((l) => l.kind === 'bindingDate')
    const out: { key: TextElementKey; ref: React.RefObject<HTMLDivElement | null> }[] = []
    if (theme.target !== 'desktop') {
      out.push({ key: 'content', ref: contentRef })
    }
    out.push({ key: 'time', ref: timeRef })
    if (hasDate) out.push({ key: 'date', ref: dateRef })
    return out
  }, [theme])

  const multiSelected = selectedElements.length >= 2
  const selectedElementsSig = useMemo(() => selectedElements.slice().sort().join('\x1e'), [selectedElements])

  const getFontWeight = useCallback((key: TextElementKey): number => {
    if (key === 'content') return theme.contentFontWeight ?? 600
    if (key === 'time') return theme.timeFontWeight ?? 400
    if (key === 'date') return theme.dateFontWeight ?? 400
    return theme.countdownFontWeight ?? 700
  }, [theme.contentFontWeight, theme.timeFontWeight, theme.dateFontWeight, theme.countdownFontWeight])
  const getFontStyle = useCallback((key: TextElementKey): 'normal' | 'italic' => {
    if (key === 'content') return theme.contentFontItalic === true ? 'italic' : 'normal'
    if (key === 'time') return theme.timeFontItalic === true ? 'italic' : 'normal'
    if (key === 'date') return theme.dateFontItalic === true ? 'italic' : 'normal'
    return theme.countdownFontItalic === true ? 'italic' : 'normal'
  }, [theme.contentFontItalic, theme.timeFontItalic, theme.dateFontItalic, theme.countdownFontItalic])
  const getTextDecoration = useCallback((key: TextElementKey): 'none' | 'underline' => {
    if (key === 'content') return theme.contentUnderline === true ? 'underline' : 'none'
    if (key === 'time') return theme.timeUnderline === true ? 'underline' : 'none'
    if (key === 'date') return theme.dateUnderline === true ? 'underline' : 'none'
    return theme.countdownUnderline === true ? 'underline' : 'none'
  }, [theme.contentUnderline, theme.timeUnderline, theme.dateUnderline, theme.countdownUnderline])

  const mergeStyleTransforms = useCallback((patch: Partial<Record<TextElementKey, string>>) => {
    setStyleTransformByKey(prev => ({ ...prev, ...patch }))
  }, [])

  /** 预览内拖拽时：每指针事件都写 DOM，但 React state + updateRect 合并到每帧一次，减轻卡顿与布局抖动 */
  const pendingMoveablePatchRef = useRef<Partial<Record<TextElementKey, string>>>({})
  const pendingDecoMoveablePatchRef = useRef<Record<string, string>>({})
  const moveableVisualRafRef = useRef<number | null>(null)

  const resetMoveableVisualPipeline = useCallback(() => {
    if (moveableVisualRafRef.current != null) {
      cancelAnimationFrame(moveableVisualRafRef.current)
      moveableVisualRafRef.current = null
    }
    pendingMoveablePatchRef.current = {}
    pendingDecoMoveablePatchRef.current = {}
  }, [])

  const flushMoveableVisual = useCallback((mode: 'sync' | 'raf') => {
    const run = () => {
      moveableVisualRafRef.current = null
      /** 拖拽/旋转/缩放中：仅写 DOM（applyMoveableFrame），避免每帧 setState 整树重绘与 updateRect 叠加卡顿；松手 sync 再刷回 state */
      const locked = transformSyncLockedRef.current
      const allowReactFlush = !locked || mode === 'sync'
      const pending = pendingMoveablePatchRef.current
      if (Object.keys(pending).length > 0) {
        if (allowReactFlush) {
          const patch = { ...pending }
          pendingMoveablePatchRef.current = {}
          mergeStyleTransforms(patch)
        }
      }
      const decoP = pendingDecoMoveablePatchRef.current
      if (Object.keys(decoP).length > 0) {
        if (allowReactFlush) {
          const dp = { ...decoP }
          pendingDecoMoveablePatchRef.current = {}
          setDecoStyleTransformById((prev) => ({ ...prev, ...dp }))
        }
      }
      if (allowReactFlush) {
        moveableRef.current?.updateRect()
      }
    }
    if (mode === 'sync') {
      if (moveableVisualRafRef.current != null) {
        cancelAnimationFrame(moveableVisualRafRef.current)
        moveableVisualRafRef.current = null
      }
      run()
    } else if (moveableVisualRafRef.current == null) {
      moveableVisualRafRef.current = requestAnimationFrame(run)
    }
  }, [mergeStyleTransforms])

  useEffect(() => () => {
    if (moveableVisualRafRef.current != null) cancelAnimationFrame(moveableVisualRafRef.current)
  }, [])

  /**
   * 从 theme 计算各层像素 transform。启动/首屏时若容器或文字仍为 0 尺寸（aspect-ratio 未算完、字体未就绪），
   * 用错误 offsetWidth 算出的 tx/ty 会锁进 state，表现为错乱；点一下重渲染才恢复。
   * 故：尺寸未就绪则跳过写入；并由 ResizeObserver + fonts.ready + 双 rAF 补算。
   */
  const recomputeStyleTransformsFromTheme = useCallback(() => {
    if (transformSyncLockedRef.current) return
    const container = containerRef.current
    if (!container) return
    const cW = container.offsetWidth
    const cH = container.offsetHeight
    if (cW < 2 || cH < 2) return
    const next: Partial<Record<TextElementKey, string>> = {}
    for (const { ref, key } of textLayerPairs) {
      const el = ref.current
      if (!el || el.offsetWidth < 1 || el.offsetHeight < 1) continue
      const t = getTransform(key)
      const tx = cW * (t.x / 100) - el.offsetWidth / 2
      const ty = cH * (t.y / 100) - el.offsetHeight / 2
      next[key] = buildTransform(tx, ty, t.rotation, t.scale)
    }
    setStyleTransformByKey(prev => {
      let same = true
      for (const k of Object.keys(next) as TextElementKey[]) {
        if (prev[k] !== next[k]) {
          same = false
          break
        }
      }
      if (same && Object.keys(prev).length === Object.keys(next).length) return prev
      return { ...prev, ...next }
    })
  }, [textLayerPairs, getTransform])

  const recomputeDecoStyleTransformsFromTheme = useCallback(() => {
    if (transformSyncLockedRef.current) return
    const container = containerRef.current
    if (!container) return
    const cW = container.offsetWidth
    const cH = container.offsetHeight
    if (cW < 2 || cH < 2) return
    const layers = ensureThemeLayers(theme).layers ?? []
    const next: Record<string, string> = {}
    for (const L of layers) {
      if (!L.visible) continue
      if (L.kind === 'text') {
        const tl = L as TextThemeLayer
        if (tl.bindsReminderBody) continue
      } else if (L.kind !== 'image') {
        continue
      }
      const el = decoRefs.current[L.id]
      if (!el || el.offsetWidth < 1 || el.offsetHeight < 1) continue
      const t =
        L.kind === 'text'
          ? (L as TextThemeLayer).transform
          : (L as ImageThemeLayer).transform
      const tt = t ?? { x: 50, y: 50, rotation: 0, scale: 1 }
      const tx = cW * (tt.x / 100) - el.offsetWidth / 2
      const ty = cH * (tt.y / 100) - el.offsetHeight / 2
      next[L.id] = buildTransform(tx, ty, tt.rotation ?? 0, tt.scale ?? 1)
    }
    /**
     * 必须与 `recomputeStyleTransformsFromTheme` 一致：theme 更新后始终用当前 DOM 尺寸回写 translate。
     * 旧逻辑「仅填补空 id」会导致：缩放手松后先把错误 translate 写入 state，字号变化使 offsetWidth 已变，
     * 但后续 recompute 无法覆盖 → 文本相对操作框偏移一跳。
     * 拖拽/缩放过程中 `transformSyncLockedRef` 会短路本函数，不会与 Moveable 实时 transform 打架。
     */
    setDecoStyleTransformById((prev) => {
      const merged = { ...prev, ...next }
      const keys = new Set([...Object.keys(prev), ...Object.keys(merged)])
      let same = true
      for (const id of keys) {
        if ((prev[id] ?? '') !== (merged[id] ?? '')) {
          same = false
          break
        }
      }
      if (same) return prev
      return merged
    })
  }, [theme])

  /**
   * 新建/换图后：contain 下图层框若与素材宽高比不一致会出现 letterbox，Moveable 贴的是 div 外框而非「可见图」。
   * 首帧 decode 后按自然比例写入 textBox*Pct（上限约 40% 视口），与弹窗 background-size: contain 语义一致。
   */
  const applyDecoImageIntrinsicBox = useCallback(
    (layerId: string, imagePath: string, nw: number, nh: number) => {
      if (readOnly) return
      const pathKey = imagePath.trim()
      if (!pathKey || nw < 1 || nh < 1) return

      let attempts = 0
      const run = () => {
        attempts++
        if (attempts > 32) return
        const cont = containerRef.current
        const t = themeLatestRef.current
        if (!cont) return
        const cW = cont.offsetWidth
        const cH = cont.offsetHeight
        if (cW < 2 || cH < 2) {
          requestAnimationFrame(run)
          return
        }
        const list = ensureThemeLayers(t).layers ?? []
        const L = list.find((x) => x.id === layerId)
        if (!L || L.kind !== 'image') return
        const im = L as ImageThemeLayer
        if ((im.imagePath ?? '').trim() !== pathKey) return
        if (im.objectFit === 'cover') {
          return
        }
        const cur = im.transform ?? { x: 50, y: 50, rotation: 0, scale: 1 }
        const tw0 = Math.min(96, Math.max(5, cur.textBoxWidthPct ?? 28))
        const th0 = Math.min(100, Math.max(3, cur.textBoxHeightPct ?? 22))
        const imgAr = nw / nh
        const boxAr = tw0 / th0
        const aspectRelDiff = Math.abs(boxAr - imgAr) / Math.max(imgAr, boxAr, 1e-6)
        /** 已与素材宽高比一致则不写 theme（避免把用户故意放大的框压回 40% 上限） */
        if (aspectRelDiff < 0.012) {
          return
        }
        const patchDedupe = `${pathKey}|${nw}x${nh}`
        if (imageDecoIntrinsicPatchedKeyRef.current[layerId] === patchDedupe) {
          return
        }
        const MAX_W_FRAC = 0.4
        const MAX_H_FRAC = 0.4
        const maxPxW = cW * MAX_W_FRAC
        const maxPxH = cH * MAX_H_FRAC
        const s = Math.min(maxPxW / nw, maxPxH / nh, 1)
        const dispW = nw * s
        const dispH = nh * s
        let wPct = Math.round((dispW / cW) * 1000) / 10
        let hPct = Math.round((dispH / cH) * 1000) / 10
        wPct = Math.min(96, Math.max(5, wPct))
        hPct = Math.min(100, Math.max(3, hPct))
        const patchTransform: TextTransform = {
          ...cur,
          textBoxWidthPct: wPct,
          textBoxHeightPct: hPct,
        }
        const patch = updateDecorationLayer(t, layerId, { transform: patchTransform } as Partial<ImageThemeLayer>)
        if (patch) onUpdateTheme(t.id, patch)
        imageDecoIntrinsicPatchedKeyRef.current[layerId] = patchDedupe
      }
      run()
    },
    [readOnly, onUpdateTheme],
  )

  /** 样式属性签名：根字段字号/字重等变化时触发双帧重算，覆盖首帧测量未稳定。装饰层 transform 见 `recomputeDecoStyleTransformsFromTheme` 合并策略。 */
  const decoForceStyleSig = useMemo(() => [
    contentFontPx, timeFontPx, dateFontPx, countdownFontPx, previewScale,
    theme.contentFontWeight, theme.timeFontWeight, theme.dateFontWeight, theme.countdownFontWeight,
    theme.contentFontItalic, theme.timeFontItalic, theme.dateFontItalic, theme.countdownFontItalic,
    theme.contentUnderline, theme.timeUnderline, theme.dateUnderline, theme.countdownUnderline,
    theme.textAlign, theme.contentTextAlign, theme.timeTextAlign, theme.dateTextAlign, theme.countdownTextAlign,
    theme.textVerticalAlign, theme.contentTextVerticalAlign, theme.timeTextVerticalAlign, theme.dateTextVerticalAlign, theme.countdownTextVerticalAlign,
    theme.contentLetterSpacing, theme.timeLetterSpacing, theme.dateLetterSpacing, theme.countdownLetterSpacing,
    theme.contentLineHeight, theme.timeLineHeight, theme.dateLineHeight, theme.countdownLineHeight,
    theme.contentFontSize, theme.timeFontSize, theme.dateFontSize, theme.countdownFontSize,
    theme.contentTransform, theme.timeTransform, theme.dateTransform, theme.countdownTransform, theme.target,
    theme.popupFontFamilyPreset, theme.popupFontFamilySystem,
    theme.contentFontFamilyPreset, theme.contentFontFamilySystem,
    theme.timeFontFamilyPreset, theme.timeFontFamilySystem,
    theme.dateFontFamilyPreset, theme.dateFontFamilySystem,
    theme.countdownFontFamilyPreset, theme.countdownFontFamilySystem,
    theme.contentTextEffects, theme.timeTextEffects, theme.dateTextEffects, theme.countdownTextEffects,
    theme.previewDateText,
    theme.dateLocale,
    theme.dateShowYear,
    theme.dateShowMonth,
    theme.dateShowDay,
    theme.dateShowWeekday,
    theme.dateYearFormat,
    theme.dateMonthFormat,
    theme.dateDayFormat,
    theme.dateWeekdayFormat,
    datePreviewTick,
  ].join('\x1e'), [
    contentFontPx, timeFontPx, dateFontPx, countdownFontPx, previewScale,
    theme.contentFontWeight, theme.timeFontWeight, theme.dateFontWeight, theme.countdownFontWeight,
    theme.contentFontItalic, theme.timeFontItalic, theme.dateFontItalic, theme.countdownFontItalic,
    theme.contentUnderline, theme.timeUnderline, theme.dateUnderline, theme.countdownUnderline,
    theme.textAlign, theme.contentTextAlign, theme.timeTextAlign, theme.dateTextAlign, theme.countdownTextAlign,
    theme.textVerticalAlign, theme.contentTextVerticalAlign, theme.timeTextVerticalAlign, theme.dateTextVerticalAlign, theme.countdownTextVerticalAlign,
    theme.contentLetterSpacing, theme.timeLetterSpacing, theme.dateLetterSpacing, theme.countdownLetterSpacing,
    theme.contentLineHeight, theme.timeLineHeight, theme.dateLineHeight, theme.countdownLineHeight,
    theme.contentFontSize, theme.timeFontSize, theme.dateFontSize, theme.countdownFontSize,
    theme.contentTransform, theme.timeTransform, theme.dateTransform, theme.countdownTransform, theme.target,
    theme.popupFontFamilyPreset, theme.popupFontFamilySystem,
    theme.contentFontFamilyPreset, theme.contentFontFamilySystem,
    theme.timeFontFamilyPreset, theme.timeFontFamilySystem,
    theme.dateFontFamilyPreset, theme.dateFontFamilySystem,
    theme.countdownFontFamilyPreset, theme.countdownFontFamilySystem,
    theme.contentTextEffects, theme.timeTextEffects, theme.dateTextEffects, theme.countdownTextEffects,
    theme.previewDateText,
    theme.dateLocale,
    theme.dateShowYear,
    theme.dateShowMonth,
    theme.dateShowDay,
    theme.dateShowWeekday,
    theme.dateYearFormat,
    theme.dateMonthFormat,
    theme.dateDayFormat,
    theme.dateWeekdayFormat,
    datePreviewTick,
  ])
  const decoForceStyleSigRef = useRef(decoForceStyleSig)

  // 从 theme 同步 transform（layout 后立刻算 + 延后两帧再算，覆盖首帧尺寸未稳定）
  useLayoutEffect(() => {
    if (transformSyncLocked) return
    decoForceStyleSigRef.current = decoForceStyleSig
    let cancelled = false
    recomputeStyleTransformsFromTheme()
    recomputeDecoStyleTransformsFromTheme()
    const id0 = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!cancelled) {
          recomputeStyleTransformsFromTheme()
          recomputeDecoStyleTransformsFromTheme()
        }
      })
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(id0)
    }
  }, [transformSyncLocked, recomputeStyleTransformsFromTheme, recomputeDecoStyleTransformsFromTheme, decoForceStyleSig, theme.layers])

  /** 首帧/比例切换后同步测量预览盒宽高（供 previewScale + 吸附线） */
  useLayoutEffect(() => {
    const c = containerRef.current
    if (!c) return
    const r = c.getBoundingClientRect()
    const w = Math.round(r.width)
    const h = Math.round(r.height)
    if (w > 1) setPreviewContainerWidth((prev) => (prev === w ? prev : w))
    if (h > 1) setPreviewContainerHeight((prev) => (prev === h ? prev : h))
  }, [popupPreviewAspect, theme.target, theme.id, previewViewportWidth, fixedPreviewPixelSize?.width, fixedPreviewPixelSize?.height])

  /**
   * 仅观察预览容器：观察各文字层会在 snap→换行→尺寸抖动→recompute 间形成高频循环，表现为小窗预览「过一会儿闪一下」。
   * 容器宽变化仍会触发重算；主题 transform / 字体等变更由其它 useLayoutEffect 负责。
   */
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let raf: number | null = null
    let debounce: ReturnType<typeof setTimeout> | null = null
    const flushRecompute = () => {
      if (raf != null) return
      raf = requestAnimationFrame(() => {
        raf = null
        recomputeStyleTransformsFromTheme()
        recomputeDecoStyleTransformsFromTheme()
      })
    }
    const scheduleRecompute = () => {
      if (debounce != null) clearTimeout(debounce)
      debounce = setTimeout(() => {
        debounce = null
        flushRecompute()
      }, 50)
    }
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        if (e.target === container) {
          const w = Math.round(e.contentRect.width)
          const h = Math.round(e.contentRect.height)
          if (w > 1) setPreviewContainerWidth((prev) => (prev === w ? prev : w))
          if (h > 1) setPreviewContainerHeight((prev) => (prev === h ? prev : h))
        }
      }
      scheduleRecompute()
    })
    ro.observe(container)
    flushRecompute()
    return () => {
      ro.disconnect()
      if (debounce != null) clearTimeout(debounce)
      if (raf != null) cancelAnimationFrame(raf)
    }
  }, [recomputeStyleTransformsFromTheme, recomputeDecoStyleTransformsFromTheme, theme.target])

  useEffect(() => {
    const fonts = document.fonts
    if (!fonts?.ready) return
    let cancelled = false
    fonts.ready.then(() => {
      if (cancelled) return
      requestAnimationFrame(() => {
        recomputeStyleTransformsFromTheme()
        recomputeDecoStyleTransformsFromTheme()
      })
    })
    return () => { cancelled = true }
  }, [recomputeStyleTransformsFromTheme, recomputeDecoStyleTransformsFromTheme])

  /**
   * 与 useLayoutEffect 中正算 `tx = cW*(x/100)-w/2` 严格互逆；松手时勿用 getBoundingClientRect 中心（旋转后 AABB 中心 ≠ 布局中心），
   * 也不要用 toFixed 后的 x/y 反算 tx，否则会出现往右下角的亚像素跳变。
   */
  const translateToThemePercent = useCallback((el: HTMLElement, translateX: number, translateY: number) => {
    const container = containerRef.current
    if (!container) return { x: 50, y: 50 }
    const cW = container.offsetWidth
    const cH = container.offsetHeight
    const w = el.offsetWidth
    const h = el.offsetHeight
    const x = Math.max(0, Math.min(100, ((translateX + w / 2) / cW) * 100))
    const y = Math.max(0, Math.min(100, ((translateY + h / 2) / cH) * 100))
    return { x, y }
  }, [])

  const finalizeDecorationTransform = useCallback(
    (el: HTMLElement) => {
      const id = el.dataset.decoLayerId
      if (!id || !containerRef.current) return
      const css = el.style.transform || decoStyleTransformById[id] || ''
      const { translateX, translateY, rotation, scale } = parseTransformValues(css)
      const pos = translateToThemePercent(el, translateX, translateY)
      const list = ensureThemeLayers(theme).layers ?? []
      const L = list.find((x) => x.id === id)
      if (!L) return
      let cur: TextTransform | undefined
      if (L.kind === 'image') {
        cur = (L as ImageThemeLayer).transform
      } else if (L.kind === 'text') {
        const tl = L as TextThemeLayer
        if (tl.bindsReminderBody) return
        cur = tl.transform
      } else {
        return
      }
      const patchT: TextTransform = {
        ...(cur ?? { x: 50, y: 50, rotation: 0, scale: 1 }),
        x: pos.x,
        y: pos.y,
        rotation: +rotation.toFixed(2),
        scale: +scale.toFixed(4),
      }
      const patch = updateDecorationLayer(theme, id, { transform: patchT } as Partial<TextThemeLayer>)
      if (patch) onUpdateTheme(theme.id, patch)
      const tf = buildTransform(translateX, translateY, rotation, scale)
      el.style.transform = tf
      setDecoStyleTransformById((p) => ({ ...p, [id]: tf }))
    },
    [decoStyleTransformById, onUpdateTheme, theme, translateToThemePercent],
  )

  const finalizeElement = useCallback((el: HTMLElement | SVGElement) => {
    if (!(el instanceof HTMLElement)) return
    if (el.dataset.decoLayerId) {
      finalizeDecorationTransform(el)
      return
    }
    const k = (el.dataset.elementKey as TextElementKey) || null
    if (!k || !containerRef.current) return
    const css = el.style.transform || styleTransformByKey[k] || ''
    const { translateX, translateY, rotation, scale } = parseTransformValues(css)
    const pos = translateToThemePercent(el, translateX, translateY)
    updateTransform(k, {
      x: pos.x,
      y: pos.y,
      rotation: +rotation.toFixed(2),
      scale: +scale.toFixed(4),
    })
    const tf = buildTransform(translateX, translateY, rotation, scale)
    el.style.transform = tf
    mergeStyleTransforms({ [k]: tf })
  }, [styleTransformByKey, translateToThemePercent, updateTransform, mergeStyleTransforms, finalizeDecorationTransform])

  /** 方向键：预览逻辑像素 ±1，多选则各层同时平移；与 finalize 相同 tx/ty → theme x/y 语义 */
  const nudgeSelectedByPreviewPixels = useCallback(
    (dx: number, dy: number) => {
      if (dx === 0 && dy === 0) return
      const cont = containerRef.current
      if (!cont || cont.offsetWidth < 2) return
      if (selectedDecorationLayerId) {
        const el = decoRefs.current[selectedDecorationLayerId]
        if (!el) return
        const css = el.style.transform || decoStyleTransformById[selectedDecorationLayerId] || ''
        const { translateX, translateY, rotation, scale } = parseTransformValues(css)
        const nx = translateX + dx
        const ny = translateY + dy
        const pos = translateToThemePercent(el, nx, ny)
        const list = ensureThemeLayers(theme).layers ?? []
        const L = list.find((x) => x.id === selectedDecorationLayerId)
        if (!L) return
        let cur: TextTransform | undefined
        if (L.kind === 'image') {
          cur = (L as ImageThemeLayer).transform
        } else if (L.kind === 'text') {
          const tl = L as TextThemeLayer
          if (tl.bindsReminderBody) return
          cur = tl.transform
        } else {
          return
        }
        const patchT: TextTransform = {
          ...(cur ?? { x: 50, y: 50, rotation: 0, scale: 1 }),
          x: pos.x,
          y: pos.y,
          rotation,
          scale,
        }
        const p = updateDecorationLayer(theme, selectedDecorationLayerId, { transform: patchT } as Partial<TextThemeLayer>)
        if (p) onUpdateTheme(theme.id, p)
        const tf = buildTransform(nx, ny, rotation, scale)
        el.style.transform = tf
        setDecoStyleTransformById((prev) => ({ ...prev, [selectedDecorationLayerId]: tf }))
        requestAnimationFrame(() => moveableRef.current?.updateRect())
        return
      }
      if (selectedElements.length === 0) return
      const patch: Partial<PopupTheme> = {}
      const domPatch: Partial<Record<TextElementKey, string>> = {}
      for (const key of selectedElements) {
        const el = getTargetRef(key)?.current
        if (!el) continue
        const css = el.style.transform || styleTransformByKey[key] || ''
        const { translateX, translateY, rotation, scale } = parseTransformValues(css)
        const nx = translateX + dx
        const ny = translateY + dy
        const pos = translateToThemePercent(el, nx, ny)
        const cur = getTransform(key)
        const field = themeTransformField(key)
        ;(patch as Record<string, TextTransform>)[field] = { ...cur, x: pos.x, y: pos.y, rotation, scale }
        const tf = buildTransform(nx, ny, rotation, scale)
        domPatch[key] = tf
        el.style.transform = tf
      }
      if (Object.keys(patch).length === 0) return
      mergeStyleTransforms(domPatch)
      onUpdateTheme(theme.id, patch)
      requestAnimationFrame(() => moveableRef.current?.updateRect())
    },
    [
      selectedElements,
      selectedDecorationLayerId,
      decoStyleTransformById,
      getTargetRef,
      styleTransformByKey,
      translateToThemePercent,
      getTransform,
      mergeStyleTransforms,
      onUpdateTheme,
      theme,
    ],
  )

  useEffect(() => {
    if (readOnly) return
    const onKey = (e: KeyboardEvent) => {
      if (editingTextKeyRef.current) return
      if (editingDecoLayerIdRef.current) return
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
      const t = e.target as HTMLElement | null
      if (!t?.closest) return
      if (t.closest('input, textarea, select, [contenteditable="true"]')) return
      const aeArrow = document.activeElement as HTMLElement | null
      if (aeArrow?.closest?.('input, textarea, select, [contenteditable="true"]')) return
      const scope = keyboardScopeRef?.current ?? containerRef.current
      if (!scope?.contains(t)) return
      if (selectedElements.length === 0 && !selectedDecorationLayerId) return
      e.preventDefault()
      const step = 1
      let dx = 0
      let dy = 0
      if (e.key === 'ArrowLeft') dx = -step
      if (e.key === 'ArrowRight') dx = step
      if (e.key === 'ArrowUp') dy = -step
      if (e.key === 'ArrowDown') dy = step
      nudgeSelectedByPreviewPixels(dx, dy)
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [readOnly, selectedElements, selectedDecorationLayerId, keyboardScopeRef, nudgeSelectedByPreviewPixels])

  /** Delete/Backspace：与图层栏 × 相同（removeThemeLayers），经 onUpdateTheme 进入撤销栈 */
  useEffect(() => {
    if (readOnly) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Backspace' && e.key !== 'Delete') return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (editingTextKeyRef.current) return
      if (editingDecoLayerIdRef.current) return
      const t = e.target as HTMLElement | null
      if (t?.closest?.('input, textarea, select, [contenteditable="true"]')) return
      const aeDel = document.activeElement as HTMLElement | null
      if (aeDel?.closest?.('input, textarea, select, [contenteditable="true"]')) return
      const scope = keyboardScopeRef?.current ?? containerRef.current
      if (!scope) return
      const ae = document.activeElement
      const inScope =
        (t instanceof HTMLElement && scope.contains(t)) ||
        (ae instanceof HTMLElement && scope.contains(ae))
      if (!inScope) return

      const ids: string[] = []
      if (
        selectedStructuralLayerId === POPUP_LAYER_BACKGROUND_ID ||
        selectedStructuralLayerId === POPUP_LAYER_OVERLAY_ID
      ) {
        ids.push(selectedStructuralLayerId)
      }
      if (marqueeDecorationLayerIds.length > 0) {
        ids.push(...marqueeDecorationLayerIds)
      } else if (selectedDecorationLayerId) {
        ids.push(selectedDecorationLayerId)
      }
      for (const key of selectedElements) {
        if (key === 'content') ids.push(POPUP_LAYER_BINDING_CONTENT_ID)
        else if (key === 'time') ids.push(POPUP_LAYER_BINDING_TIME_ID)
        else if (key === 'date') ids.push(POPUP_LAYER_BINDING_DATE_ID)
      }
      const unique = [...new Set(ids)]
      if (unique.length === 0) return

      const patch = removeThemeLayers(theme, unique)
      if (!patch) return

      e.preventDefault()
      e.stopPropagation()
      onUpdateTheme(theme.id, patch)
      setMarqueeDecorationLayerIds([])
      onSelectStructuralLayer?.(null)
      onSelectDecorationLayer?.(null)
      onSelectElements([])
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [
    readOnly,
    theme,
    onUpdateTheme,
    selectedElements,
    selectedDecorationLayerId,
    selectedStructuralLayerId,
    marqueeDecorationLayerIds,
    onSelectElements,
    onSelectDecorationLayer,
    onSelectStructuralLayer,
  ])

  /** 拖动四边/四角调整文字区域后：把当前像素宽高写入 textBox*Pct，与真实弹窗 CSS 一致 */
  const finalizeResize = useCallback(
    (target: HTMLElement) => {
      const decoId = target.dataset.decoLayerId
      if (decoId && containerRef.current) {
        const c = containerRef.current
        const cw = c.offsetWidth
        const ch = c.offsetHeight
        if (cw >= 2 && ch >= 2) {
          const wPct = Math.round((target.offsetWidth / cw) * 1000) / 10
          const hPct = Math.round((target.offsetHeight / ch) * 1000) / 10
          const css = target.style.transform || decoStyleTransformById[decoId] || ''
          const { translateX, translateY, rotation, scale } = parseTransformValues(css)
          const pos = translateToThemePercent(target, translateX, translateY)
          const list = ensureThemeLayers(theme).layers ?? []
          const L = list.find((x) => x.id === decoId)
          if (L && L.kind === 'text' && !(L as TextThemeLayer).bindsReminderBody) {
            const tl = L as TextThemeLayer
            const patch = updateDecorationLayer(theme, decoId, {
              transform: {
                ...(tl.transform ?? { x: 50, y: 50, rotation: 0, scale: 1 }),
                x: pos.x,
                y: pos.y,
                rotation: +rotation.toFixed(2),
                scale: +scale.toFixed(4),
                textBoxWidthPct: Math.max(5, Math.min(96, wPct)),
                textBoxHeightPct: Math.max(3, Math.min(100, hPct)),
                contentTextBoxUserSized: true as const,
              },
            })
            if (patch) onUpdateTheme(theme.id, patch)
            const tf = buildTransform(translateX, translateY, rotation, scale)
            target.style.transform = tf
            setDecoStyleTransformById((p) => ({ ...p, [decoId]: tf }))
            requestAnimationFrame(() => moveableRef.current?.updateRect())
          }
        }
        return
      }
      const k = (target.dataset.elementKey as TextElementKey) || null
      if (!k || !containerRef.current) return
      const c = containerRef.current
      const cw = c.offsetWidth
      const ch = c.offsetHeight
      if (cw < 2 || ch < 2) return
      const wPct = Math.round((target.offsetWidth / cw) * 1000) / 10
      const hPct = Math.round((target.offsetHeight / ch) * 1000) / 10
      const css = target.style.transform || styleTransformByKey[k] || ''
      const { translateX, translateY, rotation, scale } = parseTransformValues(css)
      const pos = translateToThemePercent(target, translateX, translateY)
      updateTransform(k, {
        x: pos.x,
        y: pos.y,
        rotation: +rotation.toFixed(2),
        scale: +scale.toFixed(4),
        textBoxWidthPct: Math.max(5, Math.min(96, wPct)),
        textBoxHeightPct: Math.max(3, Math.min(100, hPct)),
        ...(k === 'content'
          ? { contentTextBoxUserSized: true as const }
          : k === 'time' || k === 'date' || k === 'countdown'
            ? { shortLayerTextBoxLockWidth: true as const }
            : {}),
      })
      const tf = buildTransform(translateX, translateY, rotation, scale)
      mergeStyleTransforms({ [k]: tf })
      requestAnimationFrame(() => moveableRef.current?.updateRect())
    },
    [decoStyleTransformById, mergeStyleTransforms, onUpdateTheme, styleTransformByKey, theme, translateToThemePercent, updateTransform],
  )

  const snapshotsRef = useRef(new Map<string, ElementSnapshot>())
  const takeSnapshots = useCallback(() => {
    snapshotsRef.current.clear()
    for (const k of selectedElements) {
      const el = getTargetRef(k)?.current
      if (!el) continue
      const { translateX, translateY } = parseTransformValues(el.style.transform)
      snapshotsRef.current.set(k, { t: { ...getTransform(k) }, txPx: translateX, tyPx: translateY })
    }
  }, [selectedElements, getTransform, getTargetRef])

  /**
   * 主文案竖排：列高（沿预览区竖直方向）≤80% 画布高时贴内容；超出则锁高并换列；总宽默认不超过 80% 画布宽。
   */
  const applyContentTextBoxAutoLayoutVertical = useCallback(
    (el: HTMLElement, opts?: ContentTextBoxAutoOpts) => {
      const force = opts?.force === true
      const outer = el
      const node = getTextLayoutRoot(el)
      const container = containerRef.current
      if (!container) return
      const cw = Math.max(1, container.offsetWidth)
      const ch = Math.max(1, container.offsetHeight)
      const cur = getTransformRef.current('content')
      const maxBlockPx =
        cur.contentTextBoxUserSized === true
          ? cw * CONTENT_TEXT_BOX_CAP_RATIO
          : cw * CONTENT_TEXT_AUTO_FIT_MAX_RATIO
      const capInlinePx = ch * CONTENT_TEXT_VERTICAL_INLINE_MAX_RATIO
      const pad = toPreviewPx(3) * 2
      const restoreOuter = pushVerticalMeasureUnconstrainOuter(outer, node, maxBlockPx)
      const prev = {
        width: node.style.width,
        height: node.style.height,
        maxWidth: node.style.maxWidth,
        maxHeight: node.style.maxHeight,
        overflow: node.style.overflow,
        minHeight: node.style.minHeight,
      }
      let wBoxPx = 1
      let hBoxPx = 1
      try {
        node.style.overflow = 'visible'
        node.style.maxWidth = 'none'
        node.style.maxHeight = 'none'
        node.style.minHeight = '0'
        node.style.width = 'max-content'
        node.style.height = 'max-content'

        const w0 = Math.max(1, node.offsetWidth, node.scrollWidth)
        const h0 = Math.max(1, node.offsetHeight, node.scrollHeight)

        const minBlockPx = Math.min(maxBlockPx, Math.max(40, toPreviewPx(24)))

        if (h0 <= capInlinePx + 0.5) {
          hBoxPx = Math.min(h0, capInlinePx)
          wBoxPx = Math.max(minBlockPx, Math.min(w0, maxBlockPx))
        } else {
          node.style.maxHeight = `${capInlinePx}px`
          node.style.height = 'auto'
          node.style.width = 'max-content'
          const w1 = Math.max(1, node.scrollWidth, node.offsetWidth)
          hBoxPx = capInlinePx
          wBoxPx = Math.max(minBlockPx, Math.min(w1, maxBlockPx))
        }

        node.style.width = prev.width
        node.style.height = prev.height
        node.style.maxWidth = prev.maxWidth
        node.style.maxHeight = prev.maxHeight
        node.style.overflow = prev.overflow
        node.style.minHeight = prev.minHeight
      } finally {
        restoreOuter()
      }

      const wPctMax =
        cur.contentTextBoxUserSized === true
          ? CONTENT_TEXT_BOX_CAP_RATIO * 100
          : CONTENT_TEXT_AUTO_FIT_MAX_RATIO * 100
      const wPct = Math.min(wPctMax, Math.max(5, Math.round((wBoxPx / cw) * 1000) / 10 + 0.5))
      const hPct = Math.min(
        CONTENT_TEXT_AUTO_FIT_MAX_RATIO * 100,
        Math.max(3, Math.round(((hBoxPx + pad) / ch) * 1000) / 10 + 0.3),
      )
      const curNow = getTransformRef.current('content')
      if (
        !force &&
        curNow.textBoxWidthPct != null &&
        curNow.textBoxHeightPct != null &&
        curNow.contentTextBoxUserSized !== true &&
        Math.abs(curNow.textBoxWidthPct - wPct) < 0.45 &&
        Math.abs(curNow.textBoxHeightPct - hPct) < 0.4
      ) {
        return
      }
      updateTransform('content', {
        textBoxWidthPct: wPct,
        textBoxHeightPct: hPct,
        contentTextBoxUserSized: false,
      })
      requestAnimationFrame(() => moveableRef.current?.updateRect())
    },
    [toPreviewPx, updateTransform],
  )

  /**
   * 主文案：自动栏宽（未 userSized）。短文栏宽贴内容；超出默认 80% 宽则锁宽换行；高默认不超过 80%。
   */
  const applyContentTextBoxAutoLayout = useCallback(
    (el: HTMLElement, opts?: ContentTextBoxAutoOpts) => {
      const force = opts?.force === true
      const wm = theme.contentWritingMode ?? 'horizontal-tb'
      if (isVerticalWritingMode(wm)) {
        applyContentTextBoxAutoLayoutVertical(el, opts)
        return
      }
      if (!force && editingTextKeyRef.current === 'content') {
        const root = contentRef.current
        const ae = document.activeElement
        if (root && ae && root.contains(ae)) {
          requestAnimationFrame(() => moveableRef.current?.updateRect())
          return
        }
      }
      const node = getTextLayoutRoot(el)
      const container = containerRef.current
      if (!container) return
      const cw = Math.max(1, container.offsetWidth)
      const ch = Math.max(1, container.offsetHeight)
      const capInlinePx = cw * CONTENT_TEXT_INLINE_MAX_RATIO
      const maxBodyPx = cw * CONTENT_TEXT_AUTO_FIT_MAX_RATIO
      const pad = toPreviewPx(3) * 2
      const prev = {
        width: node.style.width,
        height: node.style.height,
        maxWidth: node.style.maxWidth,
        maxHeight: node.style.maxHeight,
        overflow: node.style.overflow,
        minHeight: node.style.minHeight,
      }
      node.style.overflow = 'visible'
      node.style.maxHeight = 'none'
      node.style.minHeight = '0'

      node.style.width = 'max-content'
      node.style.maxWidth = `${maxBodyPx}px`
      node.style.height = 'auto'
      const wRead = Math.max(1, node.offsetWidth, node.scrollWidth)
      let wIntrinsic = Math.min(wRead, maxBodyPx)

      const minWpx = Math.min(maxBodyPx, Math.max(40, toPreviewPx(24)))
      wIntrinsic = Math.max(wIntrinsic, minWpx)

      const wBoxPx = wIntrinsic <= capInlinePx + 0.5 ? wIntrinsic : capInlinePx

      node.style.width = `${wBoxPx}px`
      node.style.maxWidth = 'none'
      const hBody = Math.max(1, node.scrollHeight)

      node.style.width = prev.width
      node.style.height = prev.height
      node.style.maxWidth = prev.maxWidth
      node.style.maxHeight = prev.maxHeight
      node.style.overflow = prev.overflow
      node.style.minHeight = prev.minHeight

      const wPctMax = CONTENT_TEXT_AUTO_FIT_MAX_RATIO * 100
      const wPct = Math.min(wPctMax, Math.max(5, Math.round((wBoxPx / cw) * 1000) / 10 + 0.5))
      const hPct = Math.min(
        CONTENT_TEXT_AUTO_FIT_MAX_RATIO * 100,
        Math.max(3, Math.round(((hBody + pad) / ch) * 1000) / 10 + 0.3),
      )
      const cur = getTransformRef.current('content')
      if (
        !force &&
        cur.textBoxWidthPct != null &&
        cur.textBoxHeightPct != null &&
        cur.contentTextBoxUserSized !== true &&
        Math.abs(cur.textBoxWidthPct - wPct) < 0.45 &&
        Math.abs(cur.textBoxHeightPct - hPct) < 0.4
      ) {
        return
      }
      updateTransform('content', {
        textBoxWidthPct: wPct,
        textBoxHeightPct: hPct,
        contentTextBoxUserSized: false,
      })
      requestAnimationFrame(() => moveableRef.current?.updateRect())
    },
    [applyContentTextBoxAutoLayoutVertical, theme.contentWritingMode, toPreviewPx, updateTransform],
  )

  /** 横排 ↔ 竖排切换：旧 textBox 宽高语义与 DOM 不一致，强制重算并取消 userSized，避免 Moveable 仍按横排框裁切竖排字。 */
  const prevContentVerticalRef = useRef<boolean | null>(null)
  useLayoutEffect(() => {
    if (readOnly) return
    if (!effectiveEditableKeys.includes('content')) return
    const wm = theme.contentWritingMode ?? 'horizontal-tb'
    const nowV = isVerticalWritingMode(wm)
    const prev = prevContentVerticalRef.current
    prevContentVerticalRef.current = nowV
    if (prev === null) return
    if (prev === nowV) return
    if (editingTextKeyRef.current === 'content') return
    const node = contentRef.current
    if (!node) return
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const n = contentRef.current
        if (!n) return
        applyContentTextBoxAutoLayout(n, { force: true })
        moveableRef.current?.updateRect()
      })
    })
    return () => cancelAnimationFrame(id)
  }, [readOnly, theme.contentWritingMode, effectiveEditableKeys, applyContentTextBoxAutoLayout])

  const decoTextLayerWritingSig = useMemo(() => {
    const ly = ensureThemeLayers(theme).layers ?? []
    return ly
      .filter((L) => L.kind === 'text' && !(L as TextThemeLayer).bindsReminderBody)
      .map((L) => `${L.id}:${(L as TextThemeLayer).writingMode ?? 'horizontal-tb'}`)
      .join('|')
  }, [theme.layers])

  /**
   * 主文案失焦或 userSized：
   * - 横排：保持栏宽，只按 scrollHeight 更新高度 pct。
   * - 竖排：保持栏高（列高上限），按 scrollWidth 更新宽度 pct（换列后变宽）。
   */
  const snapContentTextBoxHeightOnly = useCallback(
    (el: HTMLElement) => {
      if (editingTextKeyRef.current === 'content') {
        const root = contentRef.current
        const ae = document.activeElement
        if (root && ae && root.contains(ae)) {
          requestAnimationFrame(() => moveableRef.current?.updateRect())
          return
        }
      }
      const outer = el
      const node = getTextLayoutRoot(el)
      const container = containerRef.current
      if (!container) return
      const cur = getTransformRef.current('content')
      const cw = Math.max(1, container.offsetWidth)
      const ch = Math.max(1, container.offsetHeight)
      const pad = toPreviewPx(3) * 2
      const wm = theme.contentWritingMode ?? 'horizontal-tb'
      if (isVerticalWritingMode(wm)) {
        if (cur.textBoxHeightPct == null || !Number.isFinite(cur.textBoxHeightPct)) {
          applyContentTextBoxAutoLayout(el)
          return
        }
        const maxOuterPx =
          cur.contentTextBoxUserSized === true
            ? cw * CONTENT_TEXT_BOX_CAP_RATIO
            : cw * CONTENT_TEXT_AUTO_FIT_MAX_RATIO
        const restoreOuter = pushVerticalMeasureUnconstrainOuter(outer, node, maxOuterPx)
        const prev = {
          width: node.style.width,
          height: node.style.height,
          maxWidth: node.style.maxWidth,
          maxHeight: node.style.maxHeight,
          overflow: node.style.overflow,
          minHeight: node.style.minHeight,
        }
        let wBody = 1
        try {
          const hPctClamped = Math.max(3, Math.min(100, cur.textBoxHeightPct))
          const hPx = Math.max(1, (hPctClamped / 100) * ch)
          node.style.overflow = 'visible'
          node.style.maxWidth = 'none'
          node.style.minHeight = '0'
          node.style.width = 'max-content'
          node.style.height = 'auto'
          node.style.maxHeight = `${hPx}px`
          wBody = Math.max(1, node.scrollWidth, node.offsetWidth)

          node.style.width = prev.width
          node.style.height = prev.height
          node.style.maxWidth = prev.maxWidth
          node.style.maxHeight = prev.maxHeight
          node.style.overflow = prev.overflow
          node.style.minHeight = prev.minHeight
        } finally {
          restoreOuter()
        }

        const wCapPct =
          cur.contentTextBoxUserSized === true
            ? CONTENT_TEXT_BOX_CAP_RATIO * 100
            : CONTENT_TEXT_AUTO_FIT_MAX_RATIO * 100
        const wPct = Math.min(wCapPct, Math.max(5, Math.round((wBody / cw) * 1000) / 10 + 0.5))
        if (cur.textBoxWidthPct != null && Math.abs(cur.textBoxWidthPct - wPct) < 0.45) return
        updateTransform('content', { textBoxWidthPct: wPct })
        requestAnimationFrame(() => moveableRef.current?.updateRect())
        return
      }
      if (cur.textBoxWidthPct == null || !Number.isFinite(cur.textBoxWidthPct)) {
        applyContentTextBoxAutoLayout(el)
        return
      }
      const prev = {
        width: node.style.width,
        height: node.style.height,
        maxWidth: node.style.maxWidth,
        maxHeight: node.style.maxHeight,
        overflow: node.style.overflow,
        minHeight: node.style.minHeight,
      }
      const wPctClamped = Math.max(5, Math.min(CONTENT_TEXT_BOX_CAP_RATIO * 100, cur.textBoxWidthPct))
      const wPx = (wPctClamped / 100) * cw
      node.style.overflow = 'visible'
      node.style.maxHeight = 'none'
      node.style.minHeight = '0'
      node.style.width = `${wPx}px`
      node.style.maxWidth = 'none'
      node.style.height = 'auto'
      const hBody = Math.max(1, node.scrollHeight)

      node.style.width = prev.width
      node.style.height = prev.height
      node.style.maxWidth = prev.maxWidth
      node.style.maxHeight = prev.maxHeight
      node.style.overflow = prev.overflow
      node.style.minHeight = prev.minHeight

      const hCapPct = cur.contentTextBoxUserSized === true ? 100 : CONTENT_TEXT_AUTO_FIT_MAX_RATIO * 100
      const hPct = Math.min(hCapPct, Math.max(3, Math.round(((hBody + pad) / ch) * 1000) / 10 + 0.3))
      if (cur.textBoxHeightPct != null && Math.abs(cur.textBoxHeightPct - hPct) < 0.35) return
      updateTransform('content', { textBoxHeightPct: hPct })
      requestAnimationFrame(() => moveableRef.current?.updateRect())
    },
    [applyContentTextBoxAutoLayout, theme.contentWritingMode, toPreviewPx, updateTransform],
  )

  const syncContentPreviewTextBox = useCallback(
    (el: HTMLElement) => {
      if (editingTextKeyRef.current != null) return
      const t = getTransformRef.current('content')
      if (t.contentTextBoxUserSized === true) snapContentTextBoxHeightOnly(el)
      else applyContentTextBoxAutoLayout(el)
    },
    [applyContentTextBoxAutoLayout, snapContentTextBoxHeightOnly],
  )

  /**
   * 时间 / 倒计时：主题内多为固定框；若无 textBox，编辑结束时收紧一次（单行 nowrap）。
   */
  const snapShortLayerTightContent = useCallback(
    (k: TextElementKey, el: HTMLElement) => {
      if (k !== 'time' && k !== 'date' && k !== 'countdown') return
      if (k === 'countdown' && theme.target !== 'rest' && theme.target !== 'desktop') return
      const measureEl = getTextLayoutRoot(el)
      const container = containerRef.current
      if (!container) return
      const cw = Math.max(1, container.offsetWidth)
      const ch = Math.max(1, container.offsetHeight)
      /** 与 JSX 中 `padding: toPreviewPx(3)` 一致：四边同值，量宽/高时用 2×边距 */
      const padEdge = toPreviewPx(3)
      const pad2 = padEdge * 2
      const maxBodyPx = Math.max(1, cw * CONTENT_TEXT_BOX_CAP_RATIO)
      const prev = {
        width: measureEl.style.width,
        height: measureEl.style.height,
        maxWidth: measureEl.style.maxWidth,
        maxHeight: measureEl.style.maxHeight,
        overflow: measureEl.style.overflow,
        minHeight: measureEl.style.minHeight,
      }
      measureEl.style.overflow = 'visible'
      measureEl.style.maxHeight = 'none'
      measureEl.style.minHeight = '0'

      measureEl.style.width = 'max-content'
      measureEl.style.maxWidth = `${maxBodyPx}px`
      measureEl.style.height = 'auto'
      const wRead = Math.max(1, measureEl.offsetWidth, measureEl.scrollWidth)

      const fontPx =
        k === 'date' ? dateFontPx : k === 'countdown' ? countdownFontPx : timeFontPx
      const previewFont = toPreviewPx(fontPx)
      /** 斜体字形外倾时 scrollWidth 偶发偏紧，加一点像素余量避免右侧被裁切 */
      const italicSlackPx =
        (k === 'date' && theme.dateFontItalic === true) ||
        (k === 'time' && theme.timeFontItalic === true) ||
        (k === 'countdown' && theme.countdownFontItalic === true)
          ? Math.ceil(previewFont * 0.55)
          : 0
      const raw = (el.textContent ?? '').replace(/\u00a0/g, ' ')
      const longestLine = raw.split(/\n/).reduce((m, line) => Math.max(m, line.length), 0) || 1
      /** 时间与倒计时同一套：按字数估宽 + 对称 pad，避免时间用 7em、倒计时用 5em 导致左右留白不一致 */
      const charW = previewFont * 0.58
      const minFromChars = longestLine * charW + pad2
      const minFloor = previewFont * 1.35 + pad2
      const wIntrinsic = Math.min(
        maxBodyPx,
        Math.max(wRead + italicSlackPx, minFromChars + italicSlackPx, minFloor + italicSlackPx),
      )

      measureEl.style.width = `${wIntrinsic}px`
      measureEl.style.maxWidth = 'none'
      const hBody = Math.max(1, measureEl.scrollHeight)

      measureEl.style.width = prev.width
      measureEl.style.height = prev.height
      measureEl.style.maxWidth = prev.maxWidth
      measureEl.style.maxHeight = prev.maxHeight
      measureEl.style.overflow = prev.overflow
      measureEl.style.minHeight = prev.minHeight

      const wPct = Math.min(96, Math.max(5, Math.round((wIntrinsic / cw) * 1000) / 10 + 0.5))
      const hPct = Math.min(100, Math.max(3, Math.round(((hBody + pad2) / ch) * 1000) / 10 + 0.3))
      const cur = getTransformRef.current(k)
      if (
        cur.textBoxWidthPct != null &&
        cur.textBoxHeightPct != null &&
        Math.abs(cur.textBoxWidthPct - wPct) < 0.4 &&
        Math.abs(cur.textBoxHeightPct - hPct) < 0.4
      ) {
        return
      }
      updateTransform(k, {
        textBoxWidthPct: wPct,
        textBoxHeightPct: hPct,
        shortLayerTextBoxLockWidth: false,
      })
      requestAnimationFrame(() => moveableRef.current?.updateRect())
    },
    [
      toPreviewPx,
      updateTransform,
      timeFontPx,
      dateFontPx,
      countdownFontPx,
      theme.dateFontItalic,
      theme.timeFontItalic,
      theme.countdownFontItalic,
      theme.target,
    ],
  )

  /**
   * 装饰文本竖排：与主文案 `applyContentTextBoxAutoLayoutVertical` 同算法。
   */
  const applyDecoTextBoxAutoLayoutVertical = useCallback(
    (layerId: string, el: HTMLElement, opts?: ContentTextBoxAutoOpts) => {
      const force = opts?.force === true
      const outer = el
      const node = getTextLayoutRoot(el)
      const container = containerRef.current
      if (!container) return
      const cur = getDecoTextLayerTransformRef.current(layerId)
      if (!cur) return
      const cw = Math.max(1, container.offsetWidth)
      const ch = Math.max(1, container.offsetHeight)
      const maxBlockPx =
        cur.contentTextBoxUserSized === true
          ? cw * CONTENT_TEXT_BOX_CAP_RATIO
          : cw * CONTENT_TEXT_AUTO_FIT_MAX_RATIO
      const capInlinePx = ch * CONTENT_TEXT_VERTICAL_INLINE_MAX_RATIO
      const pad = toPreviewPx(3) * 2
      const restoreOuter = pushVerticalMeasureUnconstrainOuter(outer, node, maxBlockPx)
      const prev = {
        width: node.style.width,
        height: node.style.height,
        maxWidth: node.style.maxWidth,
        maxHeight: node.style.maxHeight,
        overflow: node.style.overflow,
        minHeight: node.style.minHeight,
      }
      let wBoxPx = 1
      let hBoxPx = 1
      try {
        node.style.overflow = 'visible'
        node.style.maxWidth = 'none'
        node.style.maxHeight = 'none'
        node.style.minHeight = '0'
        node.style.width = 'max-content'
        node.style.height = 'max-content'

        const w0 = Math.max(1, node.offsetWidth, node.scrollWidth)
        const h0 = Math.max(1, node.offsetHeight, node.scrollHeight)

        const minBlockPx = Math.min(maxBlockPx, Math.max(40, toPreviewPx(24)))

        if (h0 <= capInlinePx + 0.5) {
          hBoxPx = Math.min(h0, capInlinePx)
          wBoxPx = Math.max(minBlockPx, Math.min(w0, maxBlockPx))
        } else {
          node.style.maxHeight = `${capInlinePx}px`
          node.style.height = 'auto'
          node.style.width = 'max-content'
          const w1 = Math.max(1, node.scrollWidth, node.offsetWidth)
          hBoxPx = capInlinePx
          wBoxPx = Math.max(minBlockPx, Math.min(w1, maxBlockPx))
        }

        node.style.width = prev.width
        node.style.height = prev.height
        node.style.maxWidth = prev.maxWidth
        node.style.maxHeight = prev.maxHeight
        node.style.overflow = prev.overflow
        node.style.minHeight = prev.minHeight
      } finally {
        restoreOuter()
      }

      const wPctMax =
        cur.contentTextBoxUserSized === true
          ? CONTENT_TEXT_BOX_CAP_RATIO * 100
          : CONTENT_TEXT_AUTO_FIT_MAX_RATIO * 100
      const wPct = Math.min(wPctMax, Math.max(5, Math.round((wBoxPx / cw) * 1000) / 10 + 0.5))
      const hPct = Math.min(
        CONTENT_TEXT_AUTO_FIT_MAX_RATIO * 100,
        Math.max(3, Math.round(((hBoxPx + pad) / ch) * 1000) / 10 + 0.3),
      )
      const curDecoNow = getDecoTextLayerTransformRef.current(layerId)
      if (
        !force &&
        curDecoNow &&
        curDecoNow.textBoxWidthPct != null &&
        curDecoNow.textBoxHeightPct != null &&
        curDecoNow.contentTextBoxUserSized !== true &&
        Math.abs(curDecoNow.textBoxWidthPct - wPct) < 0.45 &&
        Math.abs(curDecoNow.textBoxHeightPct - hPct) < 0.4
      ) {
        return
      }
      const patch = updateDecorationLayer(theme, layerId, {
        transform: {
          ...(curDecoNow ?? cur),
          textBoxWidthPct: wPct,
          textBoxHeightPct: hPct,
          contentTextBoxUserSized: false,
        },
      })
      if (patch) onUpdateTheme(theme.id, patch)
      requestAnimationFrame(() => moveableRef.current?.updateRect())
    },
    [theme, toPreviewPx, onUpdateTheme],
  )

  /**
   * 装饰文本：与主文案自动栏宽规则一致；竖排走 `applyDecoTextBoxAutoLayoutVertical`。
   */
  const applyDecoTextBoxAutoLayout = useCallback(
    (layerId: string, el: HTMLElement, opts?: ContentTextBoxAutoOpts) => {
      const ly = ensureThemeLayers(theme).layers ?? []
      const tl = ly.find((x) => x.id === layerId && x.kind === 'text') as TextThemeLayer | undefined
      const decoWm = tl?.writingMode ?? 'horizontal-tb'
      if (isVerticalWritingMode(decoWm)) {
        applyDecoTextBoxAutoLayoutVertical(layerId, el, opts)
        return
      }
      const force = opts?.force === true
      if (!force && editingDecoLayerIdRef.current === layerId) {
        const root = decoRefs.current[layerId]
        const ae = document.activeElement
        if (root && ae && root.contains(ae)) {
          requestAnimationFrame(() => moveableRef.current?.updateRect())
          return
        }
      }
      const node = getTextLayoutRoot(el)
      const container = containerRef.current
      if (!container) return
      const cur = getDecoTextLayerTransformRef.current(layerId)
      if (!cur) return
      const cw = Math.max(1, container.offsetWidth)
      const ch = Math.max(1, container.offsetHeight)
      const capInlinePx = cw * CONTENT_TEXT_INLINE_MAX_RATIO
      const maxBodyPx = cw * CONTENT_TEXT_AUTO_FIT_MAX_RATIO
      const pad = toPreviewPx(3) * 2
      const prev = {
        width: node.style.width,
        height: node.style.height,
        maxWidth: node.style.maxWidth,
        maxHeight: node.style.maxHeight,
        overflow: node.style.overflow,
        minHeight: node.style.minHeight,
      }
      node.style.overflow = 'visible'
      node.style.maxHeight = 'none'
      node.style.minHeight = '0'

      node.style.width = 'max-content'
      node.style.maxWidth = `${maxBodyPx}px`
      node.style.height = 'auto'
      const wRead = Math.max(1, node.offsetWidth, node.scrollWidth)
      let wIntrinsic = Math.min(wRead, maxBodyPx)

      const minWpx = Math.min(maxBodyPx, Math.max(40, toPreviewPx(24)))
      wIntrinsic = Math.max(wIntrinsic, minWpx)

      const wBoxPx = wIntrinsic <= capInlinePx + 0.5 ? wIntrinsic : capInlinePx

      node.style.width = `${wBoxPx}px`
      node.style.maxWidth = 'none'
      const hBody = Math.max(1, node.scrollHeight)

      node.style.width = prev.width
      node.style.height = prev.height
      node.style.maxWidth = prev.maxWidth
      node.style.maxHeight = prev.maxHeight
      node.style.overflow = prev.overflow
      node.style.minHeight = prev.minHeight

      const wPctMax = CONTENT_TEXT_AUTO_FIT_MAX_RATIO * 100
      const wPct = Math.min(wPctMax, Math.max(5, Math.round((wBoxPx / cw) * 1000) / 10 + 0.5))
      const hPct = Math.min(
        CONTENT_TEXT_AUTO_FIT_MAX_RATIO * 100,
        Math.max(3, Math.round(((hBody + pad) / ch) * 1000) / 10 + 0.3),
      )
      if (
        !force &&
        cur.textBoxWidthPct != null &&
        cur.textBoxHeightPct != null &&
        cur.contentTextBoxUserSized !== true &&
        Math.abs(cur.textBoxWidthPct - wPct) < 0.45 &&
        Math.abs(cur.textBoxHeightPct - hPct) < 0.4
      ) {
        return
      }
      const patch = updateDecorationLayer(theme, layerId, {
        transform: {
          ...cur,
          textBoxWidthPct: wPct,
          textBoxHeightPct: hPct,
          contentTextBoxUserSized: false,
        },
      })
      if (patch) onUpdateTheme(theme.id, patch)
      requestAnimationFrame(() => moveableRef.current?.updateRect())
    },
    [theme, toPreviewPx, onUpdateTheme, applyDecoTextBoxAutoLayoutVertical],
  )

  /** 装饰文本：与主文案 `snapContentTextBoxHeightOnly` 对齐（userSized 时只调高度 pct）。 */
  const snapDecoTextBoxHeightOnly = useCallback(
    (layerId: string, el: HTMLElement) => {
      if (editingDecoLayerIdRef.current === layerId) {
        const root = decoRefs.current[layerId]
        const ae = document.activeElement
        if (root && ae && root.contains(ae)) {
          requestAnimationFrame(() => moveableRef.current?.updateRect())
          return
        }
      }
      const node = getTextLayoutRoot(el)
      const container = containerRef.current
      if (!container) return
      const cur = getDecoTextLayerTransformRef.current(layerId)
      if (!cur) return
      const ly = ensureThemeLayers(theme).layers ?? []
      const tl = ly.find((x) => x.id === layerId && x.kind === 'text') as TextThemeLayer | undefined
      const decoWm = tl?.writingMode ?? 'horizontal-tb'
      const cw = Math.max(1, container.offsetWidth)
      const ch = Math.max(1, container.offsetHeight)
      const pad = toPreviewPx(3) * 2
      if (isVerticalWritingMode(decoWm)) {
        if (cur.textBoxHeightPct == null || !Number.isFinite(cur.textBoxHeightPct)) {
          applyDecoTextBoxAutoLayout(layerId, el)
          return
        }
        const maxOuterPx =
          cur.contentTextBoxUserSized === true
            ? cw * CONTENT_TEXT_BOX_CAP_RATIO
            : cw * CONTENT_TEXT_AUTO_FIT_MAX_RATIO
        const restoreOuter = pushVerticalMeasureUnconstrainOuter(el, node, maxOuterPx)
        const prev = {
          width: node.style.width,
          height: node.style.height,
          maxWidth: node.style.maxWidth,
          maxHeight: node.style.maxHeight,
          overflow: node.style.overflow,
          minHeight: node.style.minHeight,
        }
        let wBody = 1
        try {
          const hPctClamped = Math.max(3, Math.min(100, cur.textBoxHeightPct))
          const hPx = Math.max(1, (hPctClamped / 100) * ch)
          node.style.overflow = 'visible'
          node.style.maxWidth = 'none'
          node.style.minHeight = '0'
          node.style.width = 'max-content'
          node.style.height = 'auto'
          node.style.maxHeight = `${hPx}px`
          wBody = Math.max(1, node.scrollWidth, node.offsetWidth)

          node.style.width = prev.width
          node.style.height = prev.height
          node.style.maxWidth = prev.maxWidth
          node.style.maxHeight = prev.maxHeight
          node.style.overflow = prev.overflow
          node.style.minHeight = prev.minHeight
        } finally {
          restoreOuter()
        }

        const wCapPct =
          cur.contentTextBoxUserSized === true
            ? CONTENT_TEXT_BOX_CAP_RATIO * 100
            : CONTENT_TEXT_AUTO_FIT_MAX_RATIO * 100
        const wPct = Math.min(wCapPct, Math.max(5, Math.round((wBody / cw) * 1000) / 10 + 0.5))
        if (cur.textBoxWidthPct != null && Math.abs(cur.textBoxWidthPct - wPct) < 0.45) return
        const patch = updateDecorationLayer(theme, layerId, {
          transform: {
            ...cur,
            textBoxWidthPct: wPct,
          },
        })
        if (patch) onUpdateTheme(theme.id, patch)
        requestAnimationFrame(() => moveableRef.current?.updateRect())
        return
      }
      if (cur.textBoxWidthPct == null || !Number.isFinite(cur.textBoxWidthPct)) {
        applyDecoTextBoxAutoLayout(layerId, el)
        return
      }
      const prev = {
        width: node.style.width,
        height: node.style.height,
        maxWidth: node.style.maxWidth,
        maxHeight: node.style.maxHeight,
        overflow: node.style.overflow,
        minHeight: node.style.minHeight,
      }
      const wPctClamped = Math.max(5, Math.min(CONTENT_TEXT_BOX_CAP_RATIO * 100, cur.textBoxWidthPct))
      const wPx = (wPctClamped / 100) * cw
      node.style.overflow = 'visible'
      node.style.maxHeight = 'none'
      node.style.minHeight = '0'
      node.style.width = `${wPx}px`
      node.style.maxWidth = 'none'
      node.style.height = 'auto'
      const hBody = Math.max(1, node.scrollHeight)

      node.style.width = prev.width
      node.style.height = prev.height
      node.style.maxWidth = prev.maxWidth
      node.style.maxHeight = prev.maxHeight
      node.style.overflow = prev.overflow
      node.style.minHeight = prev.minHeight

      const hCapPct = cur.contentTextBoxUserSized === true ? 100 : CONTENT_TEXT_AUTO_FIT_MAX_RATIO * 100
      const hPct = Math.min(hCapPct, Math.max(3, Math.round(((hBody + pad) / ch) * 1000) / 10 + 0.3))
      if (cur.textBoxHeightPct != null && Math.abs(cur.textBoxHeightPct - hPct) < 0.35) return
      const patch = updateDecorationLayer(theme, layerId, {
        transform: {
          ...cur,
          textBoxHeightPct: hPct,
        },
      })
      if (patch) onUpdateTheme(theme.id, patch)
      requestAnimationFrame(() => moveableRef.current?.updateRect())
    },
    [theme, toPreviewPx, onUpdateTheme, applyDecoTextBoxAutoLayout, applyDecoTextBoxAutoLayoutVertical],
  )

  /** 装饰文本：仅新建层或某层 writingMode 变化时对该层 force 贴盒（见 decoWritingSigTouchedLayerIds）。 */
  const decoWritingSigInitRef = useRef(false)
  const prevDecoWritingLayoutSigRef = useRef<string>('')
  useLayoutEffect(() => {
    if (readOnly) return
    if (!decoWritingSigInitRef.current) {
      decoWritingSigInitRef.current = true
      prevDecoWritingLayoutSigRef.current = decoTextLayerWritingSig
      return
    }
    const prevSig = prevDecoWritingLayoutSigRef.current
    if (prevSig === decoTextLayerWritingSig) return
    prevDecoWritingLayoutSigRef.current = decoTextLayerWritingSig
    const touched = decoWritingSigTouchedLayerIds(prevSig, decoTextLayerWritingSig)
    if (touched.length === 0) return
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        for (const layerId of touched) {
          if (editingDecoLayerIdRef.current === layerId) continue
          const el = decoRefs.current[layerId]
          if (!el) continue
          applyDecoTextBoxAutoLayout(layerId, el, { force: true })
        }
        moveableRef.current?.updateRect()
      })
    })
    return () => cancelAnimationFrame(id)
  }, [readOnly, decoTextLayerWritingSig, applyDecoTextBoxAutoLayout])

  const syncContentPreviewTextBoxRef = useRef(syncContentPreviewTextBox)
  syncContentPreviewTextBoxRef.current = syncContentPreviewTextBox

  /** 绑定层竖排：见下方 useLayoutEffect 说明；需在 snap 短行 / 主文案栏宽 rAF 之后再打补丁。 */
  const repairBindingVerticalWritingModeDom = useCallback(() => {
    if (editingTextKeyRef.current != null) return
    const th = themeForVerticalRepairRef.current
    const repair = (root: HTMLElement | null, wm: PopupTextWritingMode | undefined) => {
      if (!root || !wm || !isVerticalWritingMode(wm)) return
      const innerEl = root.querySelector(`[${WB_TEXT_INNER}]`) as HTMLElement | null
      if (!innerEl) return
      const cs = getComputedStyle(innerEl).writingMode
      if (cs === 'vertical-rl' || cs === 'vertical-lr') return
      innerEl.style.setProperty('writing-mode', wm)
    }
    repair(contentRef.current, th.contentWritingMode)
  }, [])

  /**
   * 主文案：文案或**字体/间距/对齐**变化时重算栏宽/高，避免 Moveable 仍按旧度量裁切。
   * 切勿把 time/date 的 preview* 或「每秒变」的 previewLabels.time 打进本 sig（子项小窗时间会拖垮主文案 snap）。
   */
  const contentLayoutSnapSig = useMemo(() => {
    if (!effectiveEditableKeys.includes('content')) return ''
    return [
      previewLabels?.content ?? '',
      theme.previewContentText ?? '',
      theme.contentFontSize,
      theme.contentFontWeight,
      theme.contentFontFamilyPreset ?? '',
      theme.contentFontFamilySystem ?? '',
      theme.contentLetterSpacing,
      theme.contentLineHeight,
      theme.contentFontItalic === true ? '1' : '0',
      theme.contentUnderline === true ? '1' : '0',
      theme.textAlign,
      theme.contentTextAlign ?? '',
      theme.contentTextVerticalAlign ?? theme.textVerticalAlign ?? '',
      theme.contentWritingMode ?? '',
      theme.contentTextOrientation ?? '',
      theme.contentCombineUprightDigits === true ? '1' : theme.contentCombineUprightDigits === false ? '0' : '',
      JSON.stringify(theme.contentTextEffects ?? {}),
    ].join('\x1e')
  }, [
    effectiveEditableKeys,
    previewLabels?.content,
    theme.previewContentText,
    theme.contentFontSize,
    theme.contentFontWeight,
    theme.contentFontFamilyPreset,
    theme.contentFontFamilySystem,
    theme.contentLetterSpacing,
    theme.contentLineHeight,
    theme.contentFontItalic,
    theme.contentUnderline,
    theme.textAlign,
    theme.contentTextAlign,
    theme.contentTextVerticalAlign,
    theme.textVerticalAlign,
    theme.contentWritingMode,
    theme.contentTextOrientation,
    theme.contentCombineUprightDigits,
    theme.contentTextEffects,
  ])

  /**
   * 外部改主文案或正文字体参数时同步栏宽/高；编辑态不抢焦点。Moveable.updateRect 另见下方 effect。
   */
  useLayoutEffect(() => {
    if (readOnly) return
    if (transformSyncLockedRef.current) return
    if (editingTextKeyRef.current != null) return
    const id = requestAnimationFrame(() => {
      if (effectiveEditableKeys.includes('content')) {
        const node = contentRef.current
        if (node) syncContentPreviewTextBoxRef.current(node)
      }
      repairBindingVerticalWritingModeDom()
    })
    return () => cancelAnimationFrame(id)
  }, [readOnly, contentLayoutSnapSig, effectiveEditableKeys, repairBindingVerticalWritingModeDom])

  /**
   * 时间/日期短行层：`textBoxWidthPct` 会作为 max-width 残留；切换格式或字体后字符串变长会被 overflow:hidden 裁切，
   * 需按当前 DOM 重算贴字宽高并刷新 Moveable（与 blur 后 snap 同源）。
   */
  const dateTimeIntrinsicSig = useMemo(
    () =>
      [
        theme.previewTimeText ?? '',
        theme.previewDateText ?? '',
        previewLabels?.time ?? '',
        previewLabels?.date ?? '',
        theme.dateShowYear !== false ? '1' : '0',
        theme.dateShowMonth !== false ? '1' : '0',
        theme.dateShowDay !== false ? '1' : '0',
        theme.dateShowWeekday !== false ? '1' : '0',
        theme.dateYearFormat ?? '',
        theme.dateMonthFormat ?? '',
        theme.dateDayFormat ?? '',
        theme.dateWeekdayFormat ?? '',
        theme.dateLocale ?? '',
        String(datePreviewTick),
        theme.timeFontSize,
        theme.dateFontSize,
        theme.timeFontWeight,
        theme.dateFontWeight,
        theme.timeFontFamilyPreset ?? '',
        theme.dateFontFamilyPreset ?? '',
        theme.timeFontFamilySystem ?? '',
        theme.dateFontFamilySystem ?? '',
        theme.timeLetterSpacing,
        theme.dateLetterSpacing,
        theme.timeLineHeight,
        theme.dateLineHeight,
        theme.timeFontItalic === true ? '1' : '0',
        theme.dateFontItalic === true ? '1' : '0',
        theme.timeUnderline === true ? '1' : '0',
        theme.dateUnderline === true ? '1' : '0',
        JSON.stringify(theme.timeTextEffects ?? {}),
        JSON.stringify(theme.dateTextEffects ?? {}),
        theme.countdownWritingMode ?? '',
        theme.countdownTextOrientation ?? '',
        theme.countdownCombineUprightDigits === true ? '1' : theme.countdownCombineUprightDigits === false ? '0' : '',
        theme.target,
      ].join('\x1e'),
    [
      theme.previewTimeText,
      theme.previewDateText,
      previewLabels?.time,
      previewLabels?.date,
      theme.dateShowYear,
      theme.dateShowMonth,
      theme.dateShowDay,
      theme.dateShowWeekday,
      theme.dateYearFormat,
      theme.dateMonthFormat,
      theme.dateDayFormat,
      theme.dateWeekdayFormat,
      theme.dateLocale,
      datePreviewTick,
      theme.timeFontSize,
      theme.dateFontSize,
      theme.timeFontWeight,
      theme.dateFontWeight,
      theme.timeFontFamilyPreset,
      theme.dateFontFamilyPreset,
      theme.timeFontFamilySystem,
      theme.dateFontFamilySystem,
      theme.timeLetterSpacing,
      theme.dateLetterSpacing,
      theme.timeLineHeight,
      theme.dateLineHeight,
      theme.timeFontItalic,
      theme.dateFontItalic,
      theme.timeUnderline,
      theme.dateUnderline,
      theme.timeTextEffects,
      theme.dateTextEffects,
      theme.countdownWritingMode,
      theme.countdownTextOrientation,
      theme.countdownCombineUprightDigits,
      theme.target,
    ],
  )

  /**
   * Chromium：绑定层竖排内层在「退出 contentEditable / 同步栏宽」后，偶发丢失 computed writing-mode，退回横排，
   * 叠合 inner overflow 后出现左右裁切。装饰层不经 applyContentTextBoxAutoLayout 故无此问题。
   * 在展示态于 layout + 下一帧各修一次，确保与 theme 一致。
   */
  useLayoutEffect(() => {
    if (readOnly) return
    if (editingTextKey != null) return
    repairBindingVerticalWritingModeDom()
    let innerRaf = 0
    const outerRaf = requestAnimationFrame(() => {
      repairBindingVerticalWritingModeDom()
      innerRaf = requestAnimationFrame(() => {
        repairBindingVerticalWritingModeDom()
      })
    })
    return () => {
      cancelAnimationFrame(outerRaf)
      cancelAnimationFrame(innerRaf)
    }
  }, [
    readOnly,
    editingTextKey,
    contentLayoutSnapSig,
    dateTimeIntrinsicSig,
    repairBindingVerticalWritingModeDom,
  ])

  useLayoutEffect(() => {
    if (readOnly) return
    if (transformSyncLockedRef.current) return
    let outer = 0
    let inner = 0
    outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        if (transformSyncLockedRef.current) return
        /** 勿仅限「当前选中」：否则在面板改日期格式/语言后未选中该层时 textBox 不更新，会裁切 */
        if (dateRef.current) {
          snapShortLayerTightContent('date', dateRef.current)
        }
        if (timeRef.current) {
          snapShortLayerTightContent('time', timeRef.current)
        }
        repairBindingVerticalWritingModeDom()
        moveableRef.current?.updateRect()
      })
    })
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
    }
  }, [readOnly, dateTimeIntrinsicSig, selectedElementsSig, snapShortLayerTightContent, repairBindingVerticalWritingModeDom])

  /**
   * 角点等比缩放松手后：把 CSS scale 乘进主题字号并 reset scale→1，这样「缩放=改字号」且外框与文字度量一致；
   * 避免仅 transform 缩放导致面板里字号不变、框与字间距别扭。
   */
  const finalizeScaleBakesFontSize = useCallback(
    (el: HTMLElement | SVGElement) => {
      if (!(el instanceof HTMLElement)) return
      const decoId = el.dataset.decoLayerId
      if (decoId) {
        const css = el.style.transform || decoStyleTransformById[decoId] || ''
        const { rotation, scale: newScale } = parseTransformValues(css)
        const list = ensureThemeLayers(theme).layers ?? []
        const L = list.find((x) => x.id === decoId)
        if (!L || L.kind !== 'text') {
          finalizeDecorationTransform(el)
          return
        }
        const tl = L as TextThemeLayer
        if (tl.bindsReminderBody) {
          finalizeDecorationTransform(el)
          return
        }
        const oldScale = Math.max(0.05, Math.min(25, tl.transform?.scale ?? 1))
        if (Math.abs(newScale - oldScale) < 1e-5) {
          finalizeDecorationTransform(el)
          return
        }
        const ratio = newScale / oldScale
        const cont = containerRef.current
        if (!cont) return
        const cWo = Math.max(1, cont.offsetWidth)
        const cHo = Math.max(1, cont.offsetHeight)
        const cr = cont.getBoundingClientRect()
        const er = el.getBoundingClientRect()
        const anchorCx = (er.left + er.right) / 2 - cr.left
        const anchorCy = (er.top + er.bottom) / 2 - cr.top
        const xPct = Math.max(0, Math.min(100, (anchorCx / cWo) * 100))
        const yPct = Math.max(0, Math.min(100, (anchorCy / cHo) * 100))
        const curTf = tl.transform ?? { x: 50, y: 50, rotation: 0, scale: 1 }
        const boxPatch: Partial<Pick<TextTransform, 'textBoxWidthPct' | 'textBoxHeightPct'>> = {}
        if (curTf.textBoxWidthPct != null && Number.isFinite(curTf.textBoxWidthPct)) {
          boxPatch.textBoxWidthPct = Math.min(96, Math.max(1, Math.round(curTf.textBoxWidthPct * ratio * 10) / 10 + 0.5))
        }
        if (curTf.textBoxHeightPct != null && Number.isFinite(curTf.textBoxHeightPct)) {
          boxPatch.textBoxHeightPct = Math.min(100, Math.max(1, Math.round(curTf.textBoxHeightPct * ratio * 10) / 10 + 0.3))
        }
        const patchTransform: TextTransform = {
          ...curTf,
          ...boxPatch,
          x: xPct,
          y: yPct,
          rotation: +rotation.toFixed(2),
          scale: 1,
        }
        const patch = updateDecorationLayer(theme, decoId, {
          fontSize: Math.max(1, Math.min(8000, Math.round((tl.fontSize ?? 28) * ratio))),
          transform: patchTransform,
        })
        if (patch) onUpdateTheme(theme.id, patch)
        const wLay = el.offsetWidth
        const hLay = el.offsetHeight
        const tx0 = cWo * (xPct / 100) - wLay / 2
        const ty0 = cHo * (yPct / 100) - hLay / 2
        const tf = buildTransform(tx0, ty0, rotation, 1)
        el.style.transform = tf
        setDecoStyleTransformById((p) => ({ ...p, [decoId]: tf }))
        requestAnimationFrame(() => moveableRef.current?.updateRect())
        return
      }
      const k = (el.dataset.elementKey as TextElementKey) || null
      if (!k || !containerRef.current) return
      const snap = snapshotsRef.current.get(k)
      const css = el.style.transform || styleTransformByKey[k] || ''
      const { rotation, scale: newScale } = parseTransformValues(css)
      const oldScale = snap?.t.scale ?? 1
      if (Math.abs(newScale - oldScale) < 1e-5) {
        finalizeElement(el)
        return
      }
      const ratio = newScale / oldScale
      /**
       * 松手瞬间用 translate 反推 theme x/y 会在「scale→1 + 字号/textBox 变化」后与下一帧 recompute 的 tx/ty 不一致 → 跳动。
       * 改为记录当前**视觉包围盒中心**在预览容器内的比例，作为 theme 的中心点；与 recompute「中心在 x%/y%」模型一致。
       */
      const cont = containerRef.current
      const cWo = Math.max(1, cont.offsetWidth)
      const cHo = Math.max(1, cont.offsetHeight)
      const cr = cont.getBoundingClientRect()
      const er = el.getBoundingClientRect()
      const anchorCx = (er.left + er.right) / 2 - cr.left
      const anchorCy = (er.top + er.bottom) / 2 - cr.top
      /** 分母必须与 recomputeStyleTransformsFromTheme 的 cW/cH（offset 尺寸）一致，避免与 getBoundingClientRect().width 亚像素差导致一帧跳变 */
      const xPct = Math.max(0, Math.min(100, (anchorCx / cWo) * 100))
      const yPct = Math.max(0, Math.min(100, (anchorCy / cHo) * 100))
      const current = getTransform(k)
      /** 与预览 `*FontPx` 一致：按当前**已渲染的整数字号**乘缩放比再四舍五入，不写小数，避免与 floor/持久化归整打架 */
      const baseContentPx = Math.max(
        1,
        Math.min(
          8000,
          Math.round(
            theme.contentFontSize ??
              (theme.target === 'main' || theme.target === 'rest'
                ? MAIN_REST_LAYOUT_DEFAULTS.contentFontSize
                : 180),
          ),
        ),
      )
      const baseTimePx = Math.max(
        1,
        Math.min(
          8000,
          Math.round(
            theme.timeFontSize ??
              (theme.target === 'desktop'
                ? DESKTOP_DEFAULT_TIME_DATE_TRANSFORMS.timeFontSize!
                : MAIN_REST_LAYOUT_DEFAULTS.timeFontSize),
          ),
        ),
      )
      const baseDatePx = Math.max(
        1,
        Math.min(
          8000,
          Math.round(
            theme.dateFontSize ??
              (theme.target === 'desktop' ? DESKTOP_DEFAULT_TIME_DATE_TRANSFORMS.dateFontSize! : 72),
          ),
        ),
      )
      const baseCountdownPx = Math.max(1, Math.min(8000, Math.round(theme.countdownFontSize ?? 180)))
      const fontPatch: Partial<PopupTheme> = {}
      if (k === 'content') {
        fontPatch.contentFontSize = Math.max(1, Math.min(8000, Math.round(baseContentPx * ratio)))
      } else if (k === 'time') {
        fontPatch.timeFontSize = Math.max(1, Math.min(8000, Math.round(baseTimePx * ratio)))
      } else if (k === 'date') {
        fontPatch.dateFontSize = Math.max(1, Math.min(8000, Math.round(baseDatePx * ratio)))
      } else {
        fontPatch.countdownFontSize = Math.max(1, Math.min(8000, Math.round(baseCountdownPx * ratio)))
      }
      /**
       * 字号随 ratio 变，但 textBox 百分比不变时，像素框不变、字变大 → overflow 滚动条 + 底部截断。
       * 与「等比缩放整块」一致：有 textBox 时同步按 ratio 缩放宽高百分比；无固定框时再靠测量贴齐。
       */
      const boxPatch: Partial<Pick<TextTransform, 'textBoxWidthPct' | 'textBoxHeightPct'>> = {}
      if (current.textBoxWidthPct != null && Number.isFinite(current.textBoxWidthPct)) {
        boxPatch.textBoxWidthPct = Math.min(96, Math.max(1, Math.round(current.textBoxWidthPct * ratio * 10) / 10 + 0.5))
      }
      if (current.textBoxHeightPct != null && Number.isFinite(current.textBoxHeightPct)) {
        boxPatch.textBoxHeightPct = Math.min(100, Math.max(1, Math.round(current.textBoxHeightPct * ratio * 10) / 10 + 0.3))
      }
      const field = themeTransformField(k)
      onUpdateTheme(theme.id, {
        ...fontPatch,
        [field]: {
          ...current,
          ...boxPatch,
          x: xPct,
          y: yPct,
          rotation: +rotation.toFixed(2),
          scale: 1,
        },
      })
      const wLay = el.offsetWidth
      const hLay = el.offsetHeight
      const tx0 = cWo * (xPct / 100) - wLay / 2
      const ty0 = cHo * (yPct / 100) - hLay / 2
      const tf0 = buildTransform(tx0, ty0, rotation, 1)
      el.style.transform = tf0
      mergeStyleTransforms({ [k]: tf0 })
      /**
       * 已有 textBox 时松手已按 ratio 同步 textBox*Pct；若再 tight snap 会改框宽/高，在左/顶对齐下「div 中心不变、文字相对框」仍会漂移，观感像松手跳一下。
       * 无固定 textBox 时仍双帧 snap 贴齐内容。
       */
      const didScaleTextBoxPct = Object.keys(boxPatch).length > 0
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const node = getTargetRef(k)?.current
          if (!node) return
          if (didScaleTextBoxPct) moveableRef.current?.updateRect()
          else if (k === 'content') syncContentPreviewTextBoxRef.current(node)
          else snapShortLayerTightContent(k, node)
        })
      })
    },
    [
      theme.id,
      theme.contentFontSize,
      theme.timeFontSize,
      theme.dateFontSize,
      theme.countdownFontSize,
      getTransform,
      onUpdateTheme,
      mergeStyleTransforms,
      styleTransformByKey,
      finalizeElement,
      finalizeDecorationTransform,
      decoStyleTransformById,
      translateToThemePercent,
      getTargetRef,
      snapShortLayerTightContent,
    ],
  )

  const [marqueeRect, setMarqueeRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const justMarqueedRef = useRef(false)

  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    if (readOnly) return
    if (justMarqueedRef.current) { justMarqueedRef.current = false; return }
    if (justExitedTextEditRef.current) {
      justExitedTextEditRef.current = false
      return
    }
    const t = e.target as HTMLElement
    const onBg = Boolean(t.closest('[data-layer="bg"]'))
    if (e.target === containerRef.current || onBg) {
      const ek = editingTextKeyRef.current
      if (ek) {
        const node = getTargetRef(ek)?.current
        justExitedTextEditRef.current = true
        node?.blur()
        return
      }
      const decoId = editingDecoLayerIdRef.current
      if (decoId) {
        decoRefs.current[decoId]?.blur()
        return
      }
      if (onBg) {
        onSelectStructuralLayer?.(POPUP_LAYER_BACKGROUND_ID)
        onSelectElements([])
        setMarqueeDecorationLayerIds([])
        onSelectDecorationLayer?.(null)
        return
      }
      onSelectStructuralLayer?.(null)
      onSelectElements([])
      setMarqueeDecorationLayerIds([])
      onSelectDecorationLayer?.(null)
    }
  }, [readOnly, onSelectElements, getTargetRef, onSelectDecorationLayer, onSelectStructuralLayer])

  const handleContainerMouseDown = useCallback((e: React.MouseEvent) => {
    if (readOnly) return
    const hit = e.target as HTMLElement
    if (hit !== containerRef.current && !hit.closest('[data-layer="bg"]')) return
    const ek = editingTextKeyRef.current
    if (ek) {
      const node = getTargetRef(ek)?.current
      justExitedTextEditRef.current = true
      node?.blur()
      return
    }
    const decoId = editingDecoLayerIdRef.current
    if (decoId) {
      decoRefs.current[decoId]?.blur()
      return
    }
    e.preventDefault()
    const container = containerRef.current!
    const cRect = container.getBoundingClientRect()
    const startX = e.clientX - cRect.left, startY = e.clientY - cRect.top
    let active = false
    const onMove = (ev: MouseEvent) => {
      const curX = Math.max(0, Math.min(cRect.width, ev.clientX - cRect.left))
      const curY = Math.max(0, Math.min(cRect.height, ev.clientY - cRect.top))
      if (!active && (Math.abs(curX - startX) > 3 || Math.abs(curY - startY) > 3)) active = true
      if (active) setMarqueeRect({ left: Math.min(startX, curX), top: Math.min(startY, curY), width: Math.abs(curX - startX), height: Math.abs(curY - startY) })
    }
    const onUp = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      if (active) {
        justMarqueedRef.current = true
        const endX = Math.max(0, Math.min(cRect.width, ev.clientX - cRect.left))
        const endY = Math.max(0, Math.min(cRect.height, ev.clientY - cRect.top))
        const sL = Math.min(startX, endX), sT = Math.min(startY, endY)
        const sR = Math.max(startX, endX), sB = Math.max(startY, endY)
        const cW = container.offsetWidth, cH = container.offsetHeight
        const hits: TextElementKey[] = []
        for (const { key } of textLayerPairs) {
          const t = getTransform(key)
          const cx = (t.x / 100) * cW, cy = (t.y / 100) * cH
          if (cx >= sL && cx <= sR && cy >= sT && cy <= sB) hits.push(key)
        }
        const decoHits: string[] = []
        const layers = ensureThemeLayers(theme).layers ?? []
        for (const L of layers) {
          if (!L.visible || L.kind !== 'text') continue
          const tl = L as TextThemeLayer
          if (tl.bindsReminderBody) continue
          const t = tl.transform
          const cx = ((t?.x ?? 50) / 100) * cW
          const cy = ((t?.y ?? 50) / 100) * cH
          if (cx >= sL && cx <= sR && cy >= sT && cy <= sB) decoHits.push(L.id)
        }
        onSelectElements(hits)
        if (decoHits.length === 1 && hits.length === 0) {
          setMarqueeDecorationLayerIds([])
          onSelectDecorationLayer?.(decoHits[0])
        } else {
          setMarqueeDecorationLayerIds(decoHits)
          onSelectDecorationLayer?.(null)
        }
      }
      setMarqueeRect(null)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [readOnly, textLayerPairs, getTransform, onSelectElements, getTargetRef, onSelectDecorationLayer, theme])

  /** 多选对齐：按各层变换后的轴对齐包围盒（AABB）对齐，与 Figma / 设计工具一致；不用中心点百分比直接比较 */
  const handleAlign = useCallback((mode: 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom') => {
    if (selectedElements.length < 2) return
    const container = containerRef.current
    if (!container) return
    const cRect = container.getBoundingClientRect()
    type Box = { key: TextElementKey; el: HTMLElement; left: number; right: number; top: number; bottom: number }
    const boxes: Box[] = []
    for (const k of selectedElements) {
      const el = getTargetRef(k)?.current
      if (!el) continue
      const r = el.getBoundingClientRect()
      boxes.push({
        key: k,
        el,
        left: r.left - cRect.left,
        right: r.right - cRect.left,
        top: r.top - cRect.top,
        bottom: r.bottom - cRect.top,
      })
    }
    if (boxes.length < 2) return

    const minL = Math.min(...boxes.map(b => b.left))
    const maxR = Math.max(...boxes.map(b => b.right))
    const minT = Math.min(...boxes.map(b => b.top))
    const maxB = Math.max(...boxes.map(b => b.bottom))
    const unionCx = (minL + maxR) / 2
    const unionCy = (minT + maxB) / 2

    const fieldOf = (k: TextElementKey) => themeTransformField(k)
    const cW = container.offsetWidth
    const cH = container.offsetHeight

    const readTranslate = (b: Box) => {
      const css = (b.el.style.transform || styleTransformByKey[b.key] || '').trim()
      if (css) return parseTransformValues(css)
      const t = getTransform(b.key)
      return {
        translateX: cW * (t.x / 100) - b.el.offsetWidth / 2,
        translateY: cH * (t.y / 100) - b.el.offsetHeight / 2,
        rotation: t.rotation,
        scale: t.scale,
      }
    }

    const stylePatch: Partial<Record<TextElementKey, string>> = {}
    for (const b of boxes) {
      const { translateX, translateY, rotation, scale } = readTranslate(b)
      const cx = (b.left + b.right) / 2
      const cy = (b.top + b.bottom) / 2
      let deltaX = 0
      let deltaY = 0
      if (mode === 'left') deltaX = minL - b.left
      else if (mode === 'right') deltaX = maxR - b.right
      else if (mode === 'centerH') deltaX = unionCx - cx
      else if (mode === 'top') deltaY = minT - b.top
      else if (mode === 'bottom') deltaY = maxB - b.bottom
      else if (mode === 'centerV') deltaY = unionCy - cy

      const newTf = buildTransform(translateX + deltaX, translateY + deltaY, rotation, scale)
      b.el.style.transform = newTf
      stylePatch[b.key] = newTf
    }
    mergeStyleTransforms(stylePatch)

    const patch: Partial<PopupTheme> = {}
    for (const b of boxes) {
      const css = (b.el.style.transform || styleTransformByKey[b.key] || '').trim()
      const { translateX, translateY, rotation, scale } = parseTransformValues(css)
      const pos = translateToThemePercent(b.el, translateX, translateY)
      const cur = getTransform(b.key)
      ;(patch as Record<string, TextTransform>)[fieldOf(b.key)] = {
        ...cur,
        x: pos.x,
        y: pos.y,
        rotation: +rotation.toFixed(2),
        scale: +scale.toFixed(4),
      }
    }
    onUpdateTheme(theme.id, patch)
    requestAnimationFrame(() => moveableRef.current?.updateRect())
  }, [selectedElements, getTargetRef, getTransform, onUpdateTheme, theme.id, styleTransformByKey, mergeStyleTransforms, translateToThemePercent])

  const alignButtons = useMemo(() => [
    { mode: 'left' as const, icon: ALIGN_ICONS.left, title: '左对齐' },
    { mode: 'centerH' as const, icon: ALIGN_ICONS.centerH, title: '水平居中' },
    { mode: 'right' as const, icon: ALIGN_ICONS.right, title: '右对齐' },
    { mode: 'top' as const, icon: ALIGN_ICONS.top, title: '顶部对齐' },
    { mode: 'centerV' as const, icon: ALIGN_ICONS.centerV, title: '垂直居中' },
    { mode: 'bottom' as const, icon: ALIGN_ICONS.bottom, title: '底部对齐' },
  ], [])

  /** 编辑文字时仍保留 Moveable；refs 在 commit 后才可用，useMemo 读 .current 会导致首帧无目标、且不随 ref 挂载重算 */
  const [moveableTargets, setMoveableTargets] = useState<HTMLElement[]>([])
  useEffect(() => {
    if (readOnly) {
      // 只读缩略图不需要维护 Moveable 目标，避免在 layout effect 中形成重复 setState。
      return
    }
    if (!selectedDecorationLayerId && selectedElements.length === 0 && marqueeDecorationLayerIds.length === 0) {
      setMoveableTargets((p) => (p.length === 0 ? p : []))
      return
    }
    if (selectedDecorationLayerId) {
      const el = decoRefs.current[selectedDecorationLayerId]
      const next = el ? [el] : []
      setMoveableTargets((p) => (p.length === next.length && p[0] === next[0] ? p : next))
      return
    }
    const textEls = selectedElements
      .map((k) => getTargetRef(k)?.current)
      .filter((e): e is HTMLDivElement => e != null)
    const decoEls = marqueeDecorationLayerIds
      .map((id) => decoRefs.current[id])
      .filter((e): e is HTMLDivElement => e != null)
    const els = [...textEls, ...decoEls]
    setMoveableTargets((p) => {
      if (p.length === els.length && p.every((x, i) => x === els[i])) return p
      return els
    })
  }, [
    readOnly,
    selectedElements,
    selectedDecorationLayerId,
    marqueeDecorationLayerIds,
    editingDecoLayerId,
    editingTextKey,
    theme.layers,
    theme.id,
    decoStyleTransformById,
    getTargetRef,
  ])

  /**
   * 参数区改字号/字重/对齐/装饰层图层数据等导致目标尺寸变化时，同步 Moveable 外框。
   * 必须依赖 `theme.layers`：装饰文本字号写在图层上，不会动根字段 `contentFontSize`，缺此项则面板调字后框不跟。
   * 双 rAF：等浏览器完成字体/换行布局后再量，避免仍用上帧尺寸。
   */
  useEffect(() => {
    if (transformSyncLocked) return
    if (selectedElements.length === 0 && !selectedDecorationLayerId) return
    if (moveableTargets.length === 0) return
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        moveableRef.current?.updateRect()
      })
    })
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
    }
  }, [styleTransformByKey, decoStyleTransformById, contentFontPx, timeFontPx, dateFontPx, countdownFontPx, theme.textAlign,
    theme.contentTextAlign, theme.timeTextAlign, theme.dateTextAlign, theme.countdownTextAlign,
    theme.textVerticalAlign, theme.contentTextVerticalAlign, theme.timeTextVerticalAlign, theme.dateTextVerticalAlign, theme.countdownTextVerticalAlign,
    theme.contentLetterSpacing, theme.timeLetterSpacing, theme.dateLetterSpacing, theme.countdownLetterSpacing,
    theme.contentLineHeight, theme.timeLineHeight, theme.dateLineHeight, theme.countdownLineHeight,
    theme.contentFontWeight, theme.timeFontWeight, theme.dateFontWeight, theme.countdownFontWeight,
    theme.contentFontItalic, theme.timeFontItalic, theme.dateFontItalic, theme.countdownFontItalic,
    theme.contentUnderline, theme.timeUnderline, theme.dateUnderline, theme.countdownUnderline,
    theme.popupFontFamilyPreset,
    theme.popupFontFamilySystem,
    theme.contentFontFamilyPreset,
    theme.contentFontFamilySystem,
    theme.timeFontFamilyPreset,
    theme.timeFontFamilySystem,
    theme.dateFontFamilyPreset,
    theme.dateFontFamilySystem,
    theme.countdownFontFamilyPreset,
    theme.countdownFontFamilySystem,
    theme.contentTextEffects, theme.timeTextEffects, theme.dateTextEffects, theme.countdownTextEffects,
    theme.layers,
    theme.previewContentText,
    theme.previewTimeText,
    theme.previewDateText,
    theme.dateShowYear,
    theme.dateShowMonth,
    theme.dateShowDay,
    theme.dateShowWeekday,
    theme.dateYearFormat,
    theme.dateMonthFormat,
    theme.dateDayFormat,
    theme.dateWeekdayFormat,
    theme.dateLocale,
    datePreviewTick,
    previewLabels?.content,
    previewLabels?.time,
    previewLabels?.date,
    contentLayoutSnapSig,
    dateTimeIntrinsicSig,
    theme.contentWritingMode,
    theme.countdownWritingMode,
    theme.contentTextOrientation,
    theme.countdownTextOrientation,
    theme.contentCombineUprightDigits,
    theme.countdownCombineUprightDigits,
    selectedElementsSig, selectedDecorationLayerId, transformSyncLocked, previewViewportWidth, popupPreviewAspect, editingTextKey, moveableTargets.length])

  const moveableTarget = useMemo(
    () => moveableTargets.length === 1 ? moveableTargets[0] : moveableTargets,
    [moveableTargets],
  )

  const resizableEnabled = moveableTargets.length === 1
  const moveableKey = useMemo(() => {
    if (selectedDecorationLayerId) {
      const decoTextBounds =
        resizableEnabled &&
        editingDecoLayerId != null &&
        selectedDecorationLayerId === editingDecoLayerId
      return `deco:${selectedDecorationLayerId}|${editingTextKey ?? ''}|${editingDecoLayerId ?? ''}|${decoTextBounds ? 'box' : 'tf'}`
    }
    if (marqueeDecorationLayerIds.length > 0) {
      return `marquee-deco:${marqueeDecorationLayerIds.slice().sort().join(',')}|text:${selectedElements.slice().sort().join(',')}|${editingTextKey ?? ''}`
    }
    const rb =
      resizableEnabled &&
      editingTextKey != null &&
      selectedElements.length === 1 &&
      selectedElements[0] === editingTextKey
    const cwM = theme.contentWritingMode ?? 'horizontal-tb'
    return `${selectedElements.slice().sort().join(',')}|${editingTextKey ?? ''}|${rb ? 'box' : 'tf'}|wm:${cwM}`
  }, [
    selectedDecorationLayerId,
    marqueeDecorationLayerIds,
    selectedElements,
    editingTextKey,
    resizableEnabled,
    editingDecoLayerId,
    theme.contentWritingMode,
  ])
  /** 仅在「文字编辑态」显示四边/四角拉框，写入 textBoxWidthPct/HeightPct；预览态只用等比缩放（scalable）变换整块 */
  const resizableForTextBounds =
    resizableEnabled &&
    (
      (
        editingTextKey != null &&
        selectedElements.length === 1 &&
        selectedElements[0] === editingTextKey
      ) ||
      (
        editingDecoLayerId != null &&
        selectedDecorationLayerId != null &&
        selectedDecorationLayerId === editingDecoLayerId &&
        moveableTargets.length === 1
      )
    )

  const keyOfEl = (el: HTMLElement | SVGElement) =>
    el instanceof HTMLElement ? ((el.dataset.elementKey as TextElementKey) || null) : null

  const applyMoveableFrame = useCallback((events: { target: HTMLElement | SVGElement; transform: string }[]) => {
    for (const ev of events) {
      if (!(ev.target instanceof HTMLElement)) continue
      ev.target.style.transform = ev.transform
      const k = keyOfEl(ev.target)
      if (k) pendingMoveablePatchRef.current[k] = ev.transform
      const decoId = ev.target.dataset.decoLayerId
      if (decoId) pendingDecoMoveablePatchRef.current[decoId] = ev.transform
    }
    flushMoveableVisual('raf')
  }, [flushMoveableVisual])

  /** 先选中再立刻拖：flushSync 后 Moveable 可能尚未挂 ref，故带重试 */
  const scheduleDragStart = useCallback((nativeEv: MouseEvent) => {
    const tryStart = (): boolean => {
      const m = moveableRef.current
      if (!m) return false
      try {
        m.dragStart(nativeEv)
        return true
      } catch {
        return false
      }
    }
    if (tryStart()) return
    let n = 0
    const tick = () => {
      n++
      if (tryStart() || n >= 16) return
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, [])

  useEffect(() => {
    return () => {
      if (contentLayoutInputDebounceRef.current) clearTimeout(contentLayoutInputDebounceRef.current)
      if (decoLayoutInputDebounceRef.current) clearTimeout(decoLayoutInputDebounceRef.current)
    }
  }, [])

  const applyContentTextBoxAutoLayoutRef = useRef(applyContentTextBoxAutoLayout)
  applyContentTextBoxAutoLayoutRef.current = applyContentTextBoxAutoLayout
  const applyDecoTextBoxAutoLayoutRef = useRef(applyDecoTextBoxAutoLayout)
  applyDecoTextBoxAutoLayoutRef.current = applyDecoTextBoxAutoLayout

  /** 进入竖排主文案编辑：双 rAF 后再 force 重算，避免与编辑态外层列高样式同帧竞态导致量出窄宽/错 bh */
  const verticalContentEditEntryRef = useRef(false)
  const contentVerticalEditLastWmRef = useRef<string>(theme.contentWritingMode ?? 'horizontal-tb')
  useLayoutEffect(() => {
    const wmNow = theme.contentWritingMode ?? 'horizontal-tb'
    if (contentVerticalEditLastWmRef.current !== wmNow) {
      verticalContentEditEntryRef.current = false
      contentVerticalEditLastWmRef.current = wmNow
    }
    if (readOnly || editingTextKey !== 'content') {
      verticalContentEditEntryRef.current = false
      return
    }
    const wm = wmNow
    if (!isVerticalWritingMode(wm)) {
      verticalContentEditEntryRef.current = false
      return
    }
    if (getTransformRef.current('content').contentTextBoxUserSized === true) return
    if (verticalContentEditEntryRef.current) return
    const node = contentRef.current
    if (!node) return
    verticalContentEditEntryRef.current = true
    let cancelled = false
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) return
        if (editingTextKeyRef.current !== 'content') return
        applyContentTextBoxAutoLayoutRef.current(node, { force: true })
        moveableRef.current?.updateRect()
      })
    })
    return () => {
      cancelled = true
    }
  }, [readOnly, editingTextKey, theme.contentWritingMode])

  /** 进入竖排装饰文本编辑：同上；用 ref 避免 theme.layers 每键更新导致反复 force */
  const verticalDecoEditEntryRef = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (readOnly || !editingDecoLayerId) {
      verticalDecoEditEntryRef.current = null
      return
    }
    if (verticalDecoEditEntryRef.current === editingDecoLayerId) return
    const ly = ensureThemeLayers(theme).layers ?? []
    const tl = ly.find((x) => x.id === editingDecoLayerId && x.kind === 'text') as TextThemeLayer | undefined
    if (!tl || tl.bindsReminderBody) return
    const dwm = tl.writingMode ?? 'horizontal-tb'
    if (!isVerticalWritingMode(dwm)) return
    const cur = tl.transform ?? { x: 50, y: 50, rotation: 0, scale: 1 }
    if (cur.contentTextBoxUserSized === true) return
    const node = decoRefs.current[editingDecoLayerId]
    if (!node) return
    const layerId = editingDecoLayerId
    verticalDecoEditEntryRef.current = layerId
    let cancelled = false
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) return
        if (editingDecoLayerIdRef.current !== layerId) return
        const n = decoRefs.current[layerId]
        if (!n) return
        applyDecoTextBoxAutoLayoutRef.current(layerId, n, { force: true })
        moveableRef.current?.updateRect()
      })
    })
    return () => {
      cancelled = true
    }
  }, [readOnly, editingDecoLayerId, theme.layers, theme.id])

  const editSessionRef = useRef<TextElementKey | null>(null)
  useLayoutEffect(() => {
    if (!editingTextKey) {
      editSessionRef.current = null
      return
    }
    const el = getTargetRef(editingTextKey)?.current
    if (!el) return
    const textEl = getTextLayoutRoot(el)
    if (editSessionRef.current !== editingTextKey) {
      editSessionRef.current = editingTextKey
      const defaults: Record<TextElementKey, string> = {
        content: '文本',
        time: theme.target === 'rest' ? REST_POPUP_PREVIEW_TIME_TEXT : '12:00',
        date: '2025年3月23日',
        countdown: '5',
      }
      textEl.textContent = getDisplayText(editingTextKey, defaults[editingTextKey] ?? '')
    }
    requestAnimationFrame(() => {
      const node = getTargetRef(editingTextKey)?.current
      const te = node ? getTextLayoutRoot(node) : null
      if (!te || document.activeElement === te) return
      te.focus()
      const range = document.createRange()
      range.selectNodeContents(te)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    })
  }, [editingTextKey, getTargetRef, getDisplayText, theme.target])

  const decoEditSessionRef = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (!editingDecoLayerId) {
      decoEditSessionRef.current = null
      return
    }
    const layers = ensureThemeLayers(theme).layers ?? []
    const td = layers.find(
      (x) => x.id === editingDecoLayerId && x.kind === 'text' && !(x as TextThemeLayer).bindsReminderBody,
    ) as TextThemeLayer | undefined
    if (!td) return
    const el = decoRefs.current[editingDecoLayerId]
    if (!el) return
    if (decoEditSessionRef.current !== editingDecoLayerId) {
      decoEditSessionRef.current = editingDecoLayerId
      getTextLayoutRoot(el).textContent = td.text ?? ''
    }
    requestAnimationFrame(() => {
      const node = decoRefs.current[editingDecoLayerId]
      const te = node ? getTextLayoutRoot(node) : null
      if (!te || document.activeElement === te) return
      te.focus()
      const range = document.createRange()
      range.selectNodeContents(te)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    })
  }, [editingDecoLayerId, theme])

  useEffect(() => {
    if (!editingDecoLayerId) return
    if (selectedDecorationLayerId !== editingDecoLayerId) setEditingDecoLayerId(null)
  }, [selectedDecorationLayerId, editingDecoLayerId])

  /**
   * 点击 Moveable 把手/连线时，会先让 contentEditable blur；必须在捕获阶段标记「正在点操作组件」，
   * 否则 blur 里会误判为退出编辑。Moveable 控件常挂在预览容器外（portal），不能用 container.contains 过滤。
   * 绑定文案与装饰文本编辑态都要注册，否则会一点 resize 就失焦并取消编辑。
   */
  useEffect(() => {
    if (!editingTextKey && !editingDecoLayerId) {
      moveableChromePointerDownRef.current = false
      return
    }
    const clearChromeFlag = () => {
      requestAnimationFrame(() => {
        moveableChromePointerDownRef.current = false
      })
    }
    const onPointerDownCapture = (e: PointerEvent) => {
      const t = e.target
      if (!(t instanceof HTMLElement)) return
      if (isThemePreviewMoveableChrome(t)) moveableChromePointerDownRef.current = true
    }
    document.addEventListener('pointerdown', onPointerDownCapture, true)
    document.addEventListener('pointerup', clearChromeFlag, true)
    document.addEventListener('pointercancel', clearChromeFlag, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDownCapture, true)
      document.removeEventListener('pointerup', clearChromeFlag, true)
      document.removeEventListener('pointercancel', clearChromeFlag, true)
    }
  }, [editingTextKey, editingDecoLayerId])

  const handleTextPointerDown = useCallback((key: TextElementKey, e: React.MouseEvent) => {
    if (e.button !== 0) return
    const decoEd = editingDecoLayerIdRef.current
    if (decoEd) decoRefs.current[decoEd]?.blur()
    const ek = editingTextKeyRef.current
    if (ek && ek !== key) {
      getTargetRef(ek)?.current?.blur()
    }
    if (editingTextKey === key) return
    if (effectiveEditableKeys.includes(key) && e.detail >= 2) return
    if (e.shiftKey) return
    e.stopPropagation()
    const targetEl = e.currentTarget as HTMLElement
    const inSel = selectedElements.includes(key)
    const multi = selectedElements.length >= 2
    if (multi && inSel) {
      flushSync(() => {
        setMarqueeDecorationLayerIds([])
        onSelectStructuralLayer?.(null)
        onSelectDecorationLayer?.(null)
      })
      scheduleDragStart(e.nativeEvent)
      return
    }
    const wasAlreadyOnlySelected = selectedElements.length === 1 && selectedElements[0] === key && inSel
    if (!inSel || selectedElements.length !== 1 || selectedElements[0] !== key) {
      flushSync(() => {
        setMarqueeDecorationLayerIds([])
        onSelectStructuralLayer?.(null)
        onSelectDecorationLayer?.(null)
        onSelectElements([key])
        setMoveableTargets([targetEl])
      })
    } else {
      setMarqueeDecorationLayerIds([])
      onSelectStructuralLayer?.(null)
      onSelectDecorationLayer?.(null)
      setMoveableTargets([targetEl])
    }
    /** 可双击内联编辑的层：第一次单击只选中不启 Moveable 拖拽，避免双击第一下误开 drag 抢走第二下 */
    const skipDragUntilReclick =
      useInlineTextEditing &&
      effectiveEditableKeys.includes(key) &&
      e.detail === 1 &&
      !wasAlreadyOnlySelected
    if (!skipDragUntilReclick) {
      scheduleDragStart(e.nativeEvent)
    }
  }, [
    selectedElements,
    onSelectElements,
    onSelectDecorationLayer,
    onSelectStructuralLayer,
    scheduleDragStart,
    editingTextKey,
    effectiveEditableKeys,
    getTargetRef,
    editingDecoLayerIdRef,
    onSelectStructuralLayer,
    setMarqueeDecorationLayerIds,
    useInlineTextEditing,
  ])

  const renderTextLayerForKey = (layerId: string, key: TextElementKey, zi: number): React.ReactNode => {
    const ref = getTargetRef(key)
    if (!ref) return null
    const label =
      key === 'content'
        ? '文本'
        : key === 'time'
          ? theme.target === 'rest'
            ? REST_POPUP_PREVIEW_TIME_TEXT
            : '12:00'
          : key === 'date'
            ? '2025年3月23日'
            : '5:00'
    const fontSize =
      key === 'content'
        ? contentFontPx
        : key === 'time'
          ? timeFontPx
          : key === 'date'
            ? dateFontPx
            : countdownFontPx
    const color = textFillColorCss(
      key === 'content'
        ? theme.contentColor
        : key === 'countdown'
          ? (theme.countdownColor || theme.timeColor || '#ffffff')
          : key === 'date'
            ? (theme.dateColor || theme.timeColor || '#ffffff')
            : theme.timeColor || '#ffffff',
      key === 'content'
        ? theme.contentTextOpacity
        : key === 'countdown'
          ? theme.countdownTextOpacity
          : key === 'date'
            ? theme.dateTextOpacity
            : theme.timeTextOpacity,
    )
    const tf = styleTransformByKey[key] ?? 'translate(0px,0px) rotate(0deg) scale(1)'
    const displayText = getDisplayText(key, label)
    const ta = alignForKey(theme, key)
    const ls = letterSpacingForKey(theme, key)
    const lh = lineHeightForKey(theme, key)
    const isEditing = editingTextKey === key
    const canEditText = effectiveEditableKeys.includes(key)
    const tform = getTransform(key)
    const bw = tform.textBoxWidthPct
    const bh = tform.textBoxHeightPct
    const bindingContentUserSized = key === 'content' && tform.contentTextBoxUserSized === true
    const wm = writingModeForKey(theme, key)
    const isVertical = isVerticalWritingMode(wm)
    const shortLineLayer =
      key === 'time' ||
      key === 'date' ||
      (key === 'countdown' && (theme.target === 'rest' || theme.target === 'desktop'))
    const shortLayerLockW = shortLineLayer && tform.shortLayerTextBoxLockWidth === true
    const tv = verticalAlignForKey(theme, key)
    const shortLayerFlexJustify = justifyFromTextAlign(ta)
    const shortLayerFlexAlign = alignFromVerticalAlign(tv)
    const contentFlexJustify = alignFromVerticalAlign(tv)
    const innerTypo = {
      writingMode: wm,
      textOrientation: textOrientationForKey(theme, key),
      combineUpright: combineUprightForKey(theme, key),
      textAlign: textAlignForVerticalInner(ta),
      letterSpacingPx: toPreviewPx(ls),
      lineHeight: lh,
    }
    const innerStyle = verticalTextInnerDomStyle(
      innerTypo,
      shortLineLayer,
      isVertical && isEditing && canEditText && !readOnly && useInlineTextEditing ? 'previewEdit' : 'popup',
    )

    const flushLayerTextBlur = (ev: React.FocusEvent<HTMLElement>) => {
      if (!isEditing) return
      const keepEditing =
        moveableChromePointerDownRef.current || isThemePreviewMoveableChrome(ev.relatedTarget)
      if (keepEditing) {
        requestAnimationFrame(() => {
          if (editingTextKeyRef.current !== key) return
          const el = getTargetRef(key)?.current
          const te = el ? getTextLayoutRoot(el) : null
          te?.focus()
        })
        return
      }
      const root = ref.current
      const text = (root ? getTextLayoutRoot(root).textContent : '')
        ?.replace(/\u00a0/g, ' ')
        .replace(/\n+$/g, '') ?? ''
      if (contentLayoutInputDebounceRef.current) {
        clearTimeout(contentLayoutInputDebounceRef.current)
        contentLayoutInputDebounceRef.current = null
      }
      if (onLiveTextCommit) onLiveTextCommit(key, text)
      else if (key === 'content') onUpdateTheme(theme.id, { previewContentText: text })
      else if (key === 'time') onUpdateTheme(theme.id, { previewTimeText: text })
      else onUpdateTheme(theme.id, { previewCountdownText: text })
      setEditingTextKey(null)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const node = getTargetRef(key)?.current
          if (!node) return
          const wBefore = isVertical ? node.offsetWidth : 0
          if (key === 'content') {
            snapContentTextBoxHeightOnly(node)
            if (isVertical) adjustBindingVerticalEdgeAnchor('content', node, wBefore)
          } else {
            const tf0 = getTransformRef.current(key)
            if (tf0.textBoxWidthPct == null || tf0.textBoxHeightPct == null) {
              snapShortLayerTightContent(key, node)
            }
          }
          repairBindingVerticalWritingModeDom()
        })
      })
    }

    const innerMergedVerticalStyle = (
      isVertical
        ? ({ ...innerStyle, flexShrink: 0 } as Record<string, string | number>)
        : innerStyle
    ) as Record<string, string | number>

    /** 竖排编辑：列高须为确定值；过小列高 + 窄块向会诱发假横条与失焦后框错乱（见 VERTICAL_EDIT_COLUMN_MIN_HEIGHT_PCT） */
    const verticalEditColumnHeightPct =
      !shortLineLayer && isVertical && isEditing && canEditText && !readOnly && useInlineTextEditing
        ? (() => {
            const cap = CONTENT_TEXT_VERTICAL_INLINE_MAX_RATIO * 100
            if (bh != null && Number.isFinite(bh) && bh >= 8) {
              const merged = Math.min(cap, Math.max(12, bh))
              if (bindingContentUserSized) return merged
              if (merged < VERTICAL_EDIT_COLUMN_MIN_HEIGHT_PCT) return cap
              return merged
            }
            return cap
          })()
        : null

    return (
      <div
        key={layerId}
        ref={ref as React.RefObject<HTMLDivElement>}
        data-element-key={key}
        contentEditable={!isVertical && isEditing && useInlineTextEditing}
        suppressContentEditableWarning={!isVertical && isEditing && useInlineTextEditing}
        className={`absolute ${readOnly ? 'cursor-default' : isEditing && useInlineTextEditing ? 'cursor-text select-text' : 'cursor-move'} rounded-sm`}
        style={{
          left: 0, top: 0,
          transform: tf,
          transformOrigin: 'center',
          color, fontSize: `${toPreviewPx(fontSize)}px`, fontWeight: getFontWeight(key),
          fontStyle: getFontStyle(key),
          textDecoration: getTextDecoration(key),
          ...(isVertical ? {} : { textAlign: ta, letterSpacing: `${toPreviewPx(ls)}px` }),
          zIndex: zi,
          /** 与 reminderWindow 绑定短行一致：左右略增，避免斜体/描边在 max-width+nowrap 下被裁 */
          padding: shortLineLayer
            ? `${toPreviewPx(3)}px ${toPreviewPx(12)}px`
            : `${toPreviewPx(3)}px`,
          ...(shortLineLayer
            ? {
                display: 'flex',
                alignItems: shortLayerFlexAlign,
                justifyContent: shortLayerFlexJustify,
                lineHeight: isVertical ? undefined : 1,
              }
            : isEditing && !isVertical && useInlineTextEditing
              ? { display: 'block', lineHeight: lh }
              : {
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: contentFlexJustify,
                  /** 竖排：列在物理上的左右与 vertical-rl / vertical-lr 对齐（横排仍 stretch） */
                  ...(isVertical && !shortLineLayer
                    ? { alignItems: wm === 'vertical-rl' ? ('flex-end' as const) : ('flex-start' as const) }
                    : {}),
                  lineHeight: lh,
                }),
          fontFamily: resolvePopupFontFamilyCss(theme, key),
          outline: 'none',
          ...layerTextEffectsReactStyle(theme, key),
          ...(shortLineLayer
            ? shortLayerLockW && bw != null && Number.isFinite(bw)
              ? {
                  width: `${Math.min(96, Math.max(5, bw))}%`,
                  maxWidth: '100%',
                  boxSizing: 'border-box' as const,
                }
              : {
                  width: 'max-content',
                  maxWidth:
                    bw != null && Number.isFinite(bw)
                      ? `${Math.min(96, Math.max(5, bw))}%`
                      : `${CONTENT_TEXT_AUTO_FIT_MAX_RATIO * 100}%`,
                  boxSizing: 'border-box' as const,
                }
            : bw != null && Number.isFinite(bw)
              ? { width: `${bw}%`, maxWidth: '100%', boxSizing: 'border-box' as const }
              : { maxWidth: `${CONTENT_TEXT_AUTO_FIT_MAX_RATIO * 100}%` }),
          ...(shortLineLayer
            ? bh != null && Number.isFinite(bh) && isEditing && useInlineTextEditing
              ? { minHeight: `${bh}%`, height: 'auto', maxHeight: '100%', overflow: 'visible' as const }
              : {
                  height: 'auto' as const,
                  maxHeight:
                    bh != null && Number.isFinite(bh)
                      ? `${Math.min(100, Math.max(3, bh))}%`
                      : '100%',
                  overflow: 'visible' as const,
                }
            : !shortLineLayer && isVertical
              ? verticalEditColumnHeightPct != null
                ? {
                    height: `${verticalEditColumnHeightPct}%`,
                    maxHeight: `${CONTENT_TEXT_VERTICAL_INLINE_MAX_RATIO * 100}%`,
                    ...(bw != null && Number.isFinite(bw)
                      ? {}
                      : { maxWidth: `${CONTENT_TEXT_AUTO_FIT_MAX_RATIO * 100}%` }),
                    boxSizing: 'border-box' as const,
                    overflowX: 'visible' as const,
                    overflowY: 'visible' as const,
                  }
                : bh != null && Number.isFinite(bh)
                  ? {
                      height: `${Math.min(100, Math.max(3, bh))}%`,
                      maxHeight: '100%',
                      boxSizing: 'border-box' as const,
                      overflow: 'visible' as const,
                    }
                  : {}
              : bh != null && Number.isFinite(bh)
                ? isEditing && useInlineTextEditing
                  ? { minHeight: `${bh}%`, height: 'auto', maxHeight: '100%', overflow: 'visible' as const }
                  : { height: `${bh}%`, maxHeight: '100%', overflow: 'visible' as const }
                : {}),
          whiteSpace: (shortLineLayer && !isVertical ? 'nowrap' : isVertical ? 'normal' : 'pre-wrap') as
            | 'nowrap'
            | 'pre-wrap'
            | 'normal',
          wordWrap: (shortLineLayer && !isVertical ? 'normal' : 'break-word') as 'normal' | 'break-word',
          overflowWrap: (shortLineLayer && !isVertical ? 'normal' : 'break-word') as 'normal' | 'break-word',
          ...(shortLineLayer && !isVertical ? {} : !shortLineLayer ? { wordBreak: 'keep-all' as const } : {}),
        }}
        onMouseDownCapture={(e) => {
          if (e.button !== 0) return
          if (!canEditText) return
          if (key === 'time' || key === 'date') return
          if (e.detail === 2) {
            e.preventDefault()
            e.stopPropagation()
            flushSync(() => {
              onSelectElements([key])
              if (panelFirstTextEditing && onRequestPanelTextFocus) {
                onRequestPanelTextFocus({ kind: 'binding', key })
              } else {
                setEditingTextKey(key)
              }
            })
            setMoveableTargets([e.currentTarget])
          }
        }}
        onMouseDown={(e) => handleTextPointerDown(key, e)}
        onClick={(e) => handleElementClick(key, e)}
        onInput={
          !isVertical && isEditing && useInlineTextEditing
            ? () => {
                requestAnimationFrame(() => moveableRef.current?.updateRect())
                if (key !== 'content') return
                if (contentLayoutInputDebounceRef.current) clearTimeout(contentLayoutInputDebounceRef.current)
                contentLayoutInputDebounceRef.current = window.setTimeout(() => {
                  contentLayoutInputDebounceRef.current = null
                  const node = getTargetRef('content')?.current
                  if (!node || editingTextKeyRef.current !== 'content') return
                  const tr = getTransformRef.current('content')
                  if (tr.contentTextBoxUserSized === true) snapContentTextBoxHeightOnly(node)
                  else applyContentTextBoxAutoLayout(node)
                  moveableRef.current?.updateRect()
                }, TEXT_EDIT_LAYOUT_DEBOUNCE_MS)
              }
            : undefined
        }
        onBlur={!isVertical && isEditing && useInlineTextEditing ? flushLayerTextBlur : undefined}
        onKeyDown={
          !isVertical && isEditing && useInlineTextEditing
            ? (e) => {
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setEditingTextKey(null)
                  void ref.current?.blur()
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void ref.current?.blur()
                }
              }
            : undefined
        }
      >
        {isVertical ? (
          <div
            key={`${layerId}-wb-${wm}-${isEditing && canEditText && useInlineTextEditing ? 'e' : 'v'}`}
            {...{ [WB_TEXT_INNER]: '1' }}
            contentEditable={isEditing && canEditText && useInlineTextEditing}
            suppressContentEditableWarning={isEditing && canEditText && useInlineTextEditing}
            style={innerMergedVerticalStyle}
            className="min-h-0 min-w-0 outline-none"
            onInput={
              isVertical && isEditing && canEditText && useInlineTextEditing
                ? () => {
                    requestAnimationFrame(() => moveableRef.current?.updateRect())
                    if (key !== 'content') return
                    if (contentLayoutInputDebounceRef.current) clearTimeout(contentLayoutInputDebounceRef.current)
                    contentLayoutInputDebounceRef.current = window.setTimeout(() => {
                      contentLayoutInputDebounceRef.current = null
                      const node = getTargetRef('content')?.current
                      if (!node || editingTextKeyRef.current !== 'content') return
                      const tr = getTransformRef.current('content')
                      if (tr.contentTextBoxUserSized === true) snapContentTextBoxHeightOnly(node)
                      else applyContentTextBoxAutoLayout(node)
                      moveableRef.current?.updateRect()
                    }, TEXT_EDIT_LAYOUT_DEBOUNCE_MS)
                  }
                : undefined
            }
            onBlur={isVertical && isEditing && canEditText && useInlineTextEditing ? flushLayerTextBlur : undefined}
            onKeyDown={
              isVertical && isEditing && canEditText && useInlineTextEditing
                ? (e) => {
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      setEditingTextKey(null)
                      void getTextLayoutRoot(ref.current ?? document.body).blur()
                    }
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      void getTextLayoutRoot(ref.current ?? document.body).blur()
                    }
                  }
                : undefined
            }
          >
            {!isEditing ? displayText : null}
          </div>
        ) : (
          !isEditing ? displayText : null
        )}
      </div>
    )
  }

  const outerWrapClass =
    !showToolbar ? 'w-full' : outerChrome === 'none' ? 'w-full min-w-0' : 'rounded-md border border-slate-200 bg-white p-2'
  /** 主题工坊缩略图：仅此处使用 fixedPreviewPixelSize；底色跟主题，避免露缝时一条纯黑边 */
  const previewBoxClass = fixedPreviewPixelSize
    ? 'relative overflow-hidden rounded-none border-0 bg-transparent'
    : previewWidthMode === 'fill'
      ? 'relative w-full max-w-full overflow-hidden rounded-none border border-slate-300 bg-black'
      : showToolbar
        ? 'relative mx-auto w-full max-w-[920px] overflow-hidden rounded-none border border-slate-300 bg-black'
        : 'relative w-full max-w-full overflow-hidden rounded-none border border-slate-300 bg-black'

  return (
    <div className={outerWrapClass}>
      {showToolbar && (
        <>
          <div className="mb-1.5 flex min-w-0 items-center gap-1 px-1">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5">
              {alignButtons.map(({ mode, icon, title }) => (
                <button key={mode} type="button" title={title} disabled={!multiSelected} onClick={() => handleAlign(mode)}
                  className={`rounded p-1 transition-colors ${multiSelected ? 'text-slate-600 hover:bg-indigo-50 hover:text-indigo-700' : 'text-slate-300 cursor-default'}`}>
                  {icon}
                </button>
              ))}
              {multiSelected && (
                <>
                  <div className="mx-1.5 h-4 w-px bg-slate-200" />
                  <button type="button" onClick={() => setGroupMode(v => !v)}
                    title={groupMode ? '打组：围绕整体中心变换' : '解组：围绕各自中心变换'}
                    className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${groupMode ? 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100' : 'bg-slate-50 text-slate-400 hover:bg-slate-100 hover:text-slate-500'}`}>
                    {groupMode ? GROUP_ICON : UNGROUP_ICON}
                    {groupMode ? '打组' : '解组'}
                  </button>
                  <span className="ml-1 text-[10px] text-indigo-500">已选 {selectedElements.length} 个</span>
                </>
              )}
            </div>
            {toolbarCenter != null ? (
              <>
                <div className="flex shrink-0 items-center justify-center px-2">{toolbarCenter}</div>
                <div className="flex min-w-0 flex-1 justify-end">
                  {toolbarTrailing ? <div className="flex shrink-0 items-center">{toolbarTrailing}</div> : null}
                </div>
              </>
            ) : (
              toolbarTrailing ? <div className="flex shrink-0 items-center">{toolbarTrailing}</div> : null
            )}
          </div>
        </>
      )}

      <div
        ref={containerRef}
        data-theme-preview-root
        className={`${previewBoxClass} ${editingTextKey || editingDecoLayerId ? '' : 'select-none'} ${readOnly ? 'pointer-events-none' : ''}`}
        style={
          fixedPreviewPixelSize
            ? {
                width: fixedPreviewPixelSize.width,
                height: fixedPreviewPixelSize.height,
                backgroundColor: previewDefaultBg,
              }
            : { aspectRatio: popupPreviewAspect === '16:9' ? '16 / 9' : '4 / 3' }
        }
        onClick={handleContainerClick} onMouseDown={handleContainerMouseDown}>

        {(ensureThemeLayers(theme).layers ?? []).map((L, i) => {
          const zi = i + 1
          if (!L.visible) return null
          switch (L.kind) {
            case 'background': {
              const blurRaw = Math.round(Number(theme.backgroundImageBlurPx))
              const bgBlur =
                Number.isFinite(blurRaw) ? Math.max(0, Math.min(POPUP_BACKGROUND_IMAGE_BLUR_MAX_PX, blurRaw)) : 0
              const blurOut = bgBlur > 0 ? Math.min(200, Math.ceil(bgBlur * 2.5)) : 0
              if (
                !readOnly &&
                theme.imageSourceType === 'folder' &&
                folderPreviewUrls.length >= 2
              ) {
                return (
                  <FolderBgCrossfade
                    key={L.id}
                    layerId={L.id}
                    zIndex={zi}
                    urls={folderPreviewUrls}
                    intervalSec={theme.imageFolderIntervalSec ?? 30}
                    crossfadeSec={theme.imageFolderCrossfadeSec ?? 2}
                    randomMode={theme.imageFolderPlayMode === 'random'}
                    bgColor={previewDefaultBg}
                    blur={bgBlur}
                    bgTransformStyle={previewBackgroundImageTransformStyle(theme)}
                  />
                )
              }
              if (hasBgImage && bgImageUrl) {
                const bgTf = previewBackgroundImageTransformStyle(theme)
                if (bgBlur > 0) {
                  return (
                    <div
                      key={L.id}
                      className="absolute inset-0 overflow-hidden"
                      data-layer="bg"
                      style={{ zIndex: zi, backgroundColor: previewDefaultBg }}
                    >
                      <div
                        className="absolute"
                        style={{
                          left: -blurOut,
                          top: -blurOut,
                          width: `calc(100% + ${blurOut * 2}px)`,
                          height: `calc(100% + ${blurOut * 2}px)`,
                          backgroundImage: `url("${bgImageUrl}")`,
                          backgroundSize: 'cover',
                          backgroundRepeat: 'no-repeat',
                          filter: `blur(${bgBlur}px)`,
                          ...bgTf,
                        }}
                      />
                    </div>
                  )
                }
                return (
                  <div
                    key={L.id}
                    className="absolute inset-0 overflow-hidden"
                    data-layer="bg"
                    style={{ zIndex: zi, backgroundColor: previewDefaultBg }}
                  >
                    <div
                      className="absolute inset-0"
                      style={{
                        backgroundImage: `url("${bgImageUrl}")`,
                        backgroundSize: 'cover',
                        backgroundRepeat: 'no-repeat',
                        ...bgTf,
                      }}
                    />
                  </div>
                )
              }
              return (
                <div
                  key={L.id}
                  className="absolute inset-0"
                  data-layer="bg"
                  style={{
                    zIndex: zi,
                    background: previewDefaultBg,
                  }}
                />
              )
            }
            case 'overlay':
              return (
                <div
                  key={L.id}
                  className="absolute inset-0 pointer-events-none"
                  data-layer="overlay"
                  style={{
                    zIndex: zi,
                    background: getOverlayBackground(theme),
                    opacity: theme.overlayEnabled ? 1 : 0,
                  }}
                />
              )
            case 'bindingTime':
              return renderTextLayerForKey(L.id, 'time', zi)
            case 'bindingDate':
              return renderTextLayerForKey(L.id, 'date', zi)
            case 'text': {
              const tl = L as TextThemeLayer
              if (tl.bindsReminderBody) return renderTextLayerForKey(L.id, 'content', zi)
              const td = tl
              const dtf = decoStyleTransformById[L.id] ?? 'translate(0px,0px) rotate(0deg) scale(1)'
              const fs = Math.max(1, Math.min(8000, Math.round(td.fontSize ?? 28)))
              const fakeTheme: PopupTheme = {
                ...theme,
                contentTextEffects: td.textEffects,
              }
              const isDecoEditing = editingDecoLayerId === L.id
              const decoInlineEditing = isDecoEditing && useInlineTextEditing
              const decoAlign = (td.textAlign ?? theme.textAlign) as PopupTheme['textAlign']
              const decoVerticalAlign = td.textVerticalAlign ?? theme.textVerticalAlign ?? 'middle'
              const decoTf = td.transform ?? { x: 50, y: 50, rotation: 0, scale: 1 }
              const decoBw = decoTf.textBoxWidthPct
              const decoBh = decoTf.textBoxHeightPct
              const decoWm = td.writingMode ?? 'horizontal-tb'
              const decoIsVertical = isVerticalWritingMode(decoWm)
              const decoInnerStyle = verticalTextInnerDomStyle(
                {
                  writingMode: decoWm,
                  textOrientation: td.textOrientation,
                  combineUpright:
                    td.combineUprightDigits === true ? true : td.combineUprightDigits === false ? false : false,
                  textAlign: textAlignForVerticalInner(decoAlign),
                  letterSpacingPx: toPreviewPx(td.letterSpacing ?? 0),
                  lineHeight: td.lineHeight ?? 1.35,
                },
                false,
                decoIsVertical && decoInlineEditing && !readOnly ? 'previewEdit' : 'popup',
              )
              const decoInnerPreviewStyle = decoIsVertical
                ? decoInlineEditing && !readOnly
                  ? decoInnerStyle
                  : ({ ...decoInnerStyle, overflow: 'hidden' as const } as Record<string, string | number>)
                : decoInnerStyle
              /** 横排字距/行高/对齐放在内层，外层永不 contentEditable，与主文案竖排内层一致，避免父级重渲染清空可编辑区 */
              const decoInnerDomStyle = (
                decoIsVertical
                  ? decoInnerPreviewStyle
                  : ({
                      display: 'block',
                      boxSizing: 'border-box',
                      maxWidth: '100%',
                      maxHeight: '100%',
                      overflow: 'auto',
                      lineHeight: td.lineHeight ?? 1.35,
                      textAlign: decoAlign,
                      letterSpacing: `${toPreviewPx(td.letterSpacing ?? 0)}px`,
                      whiteSpace: 'pre-wrap',
                      wordWrap: 'break-word',
                      overflowWrap: 'break-word',
                      wordBreak: 'keep-all',
                    } as Record<string, string | number>)
              ) as Record<string, string | number>
              const decoUserSized = td.transform?.contentTextBoxUserSized === true
              const decoVerticalEditColHPct =
                decoIsVertical && decoInlineEditing && !readOnly
                  ? (() => {
                      const cap = CONTENT_TEXT_VERTICAL_INLINE_MAX_RATIO * 100
                      if (decoBh != null && Number.isFinite(decoBh) && decoBh >= 8) {
                        const merged = Math.min(cap, Math.max(12, decoBh))
                        if (decoUserSized) return merged
                        if (merged < VERTICAL_EDIT_COLUMN_MIN_HEIGHT_PCT) return cap
                        return merged
                      }
                      return cap
                    })()
                  : null
              return (
                <div
                  key={L.id}
                  ref={(el) => {
                    decoRefs.current[L.id] = el
                  }}
                  data-deco-layer-id={L.id}
                  className={`absolute rounded-sm ${readOnly ? 'cursor-default' : decoInlineEditing ? 'cursor-text select-text' : 'cursor-move'}`}
                  style={{
                    left: 0,
                    top: 0,
                    transform: dtf,
                    transformOrigin: 'center',
                    zIndex: zi,
                    color: textFillColorCss(td.color || '#ffffff', td.colorOpacity),
                    fontSize: `${toPreviewPx(fs)}px`,
                    fontWeight: td.fontWeight ?? 500,
                    fontStyle: td.fontItalic === true ? 'italic' : 'normal',
                    textDecoration: td.textUnderline === true ? 'underline' : 'none',
                    padding: `${toPreviewPx(3)}px`,
                    fontFamily: resolveDecoFontFamilyCss(td.fontFamilyPreset, td.fontFamilySystem),
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: alignFromVerticalAlign(decoVerticalAlign),
                    alignItems: decoIsVertical
                      ? decoWm === 'vertical-rl'
                        ? 'flex-end'
                        : 'flex-start'
                      : 'stretch',
                    /** 与 renderTextLayerForKey(content) 完全一致：有 textBox 才定宽；无 textBox 仅限制 maxWidth。 */
                    ...(decoBw != null && Number.isFinite(decoBw)
                      ? { width: `${Math.min(96, Math.max(5, decoBw))}%`, maxWidth: '100%', boxSizing: 'border-box' as const }
                      : { maxWidth: `${CONTENT_TEXT_AUTO_FIT_MAX_RATIO * 100}%` }),
                    ...(decoVerticalEditColHPct != null
                      ? {
                          height: `${decoVerticalEditColHPct}%`,
                          maxHeight: `${CONTENT_TEXT_VERTICAL_INLINE_MAX_RATIO * 100}%`,
                          ...(decoBw != null && Number.isFinite(decoBw)
                            ? {}
                            : { maxWidth: `${CONTENT_TEXT_AUTO_FIT_MAX_RATIO * 100}%` }),
                          boxSizing: 'border-box' as const,
                          overflowX: 'visible' as const,
                          overflowY: 'visible' as const,
                        }
                      : decoBh != null && Number.isFinite(decoBh)
                        ? {
                            height: `${Math.min(100, Math.max(3, decoBh))}%`,
                            maxHeight: '100%',
                            boxSizing: 'border-box' as const,
                            overflow: 'visible' as const,
                          }
                        : {}),
                    outline: 'none',
                    ...layerTextEffectsReactStyle(fakeTheme, 'content'),
                  }}
                  onMouseDownCapture={(e) => {
                    if (readOnly || e.button !== 0) return
                    if (e.detail === 2) {
                      e.preventDefault()
                      e.stopPropagation()
                      flushSync(() => {
                        setMarqueeDecorationLayerIds([])
                        onSelectStructuralLayer?.(null)
                        onSelectElements([])
                        onSelectDecorationLayer?.(L.id)
                        if (panelFirstTextEditing && onRequestPanelTextFocus) {
                          onRequestPanelTextFocus({ kind: 'decoration', layerId: L.id })
                        } else {
                          setEditingDecoLayerId(L.id)
                        }
                      })
                      setMoveableTargets([e.currentTarget as HTMLDivElement])
                    }
                  }}
                  onMouseDown={(e) => {
                    if (readOnly || e.button !== 0) return
                    if (e.shiftKey) return
                    if (e.detail >= 2) return
                    if (decoInlineEditing) return
                    e.stopPropagation()
                    const wasOnlyThisDeco = selectedDecorationLayerId === L.id
                    flushSync(() => {
                      setMarqueeDecorationLayerIds([])
                      onSelectStructuralLayer?.(null)
                      onSelectElements([])
                      onSelectDecorationLayer?.(L.id)
                    })
                    setMoveableTargets([e.currentTarget as HTMLDivElement])
                    const skipDecoFirstPickDrag = useInlineTextEditing && e.detail === 1 && !wasOnlyThisDeco
                    if (!skipDecoFirstPickDrag) {
                      scheduleDragStart(e.nativeEvent)
                    }
                  }}
                >
                  <span
                    key={`${L.id}-wb-${decoWm}-${decoInlineEditing && !readOnly ? 'e' : 'v'}`}
                    {...{ [WB_TEXT_INNER]: '1' }}
                    contentEditable={decoInlineEditing && !readOnly}
                    suppressContentEditableWarning={decoInlineEditing && !readOnly}
                    style={decoInnerDomStyle}
                    className="min-h-0 min-w-0 flex-1 outline-none"
                    onInput={
                      decoInlineEditing && !readOnly
                        ? () => {
                            requestAnimationFrame(() => moveableRef.current?.updateRect())
                            if (decoLayoutInputDebounceRef.current) clearTimeout(decoLayoutInputDebounceRef.current)
                            const layerId = L.id
                            decoLayoutInputDebounceRef.current = window.setTimeout(() => {
                              decoLayoutInputDebounceRef.current = null
                              if (editingDecoLayerIdRef.current !== layerId) return
                              const node = decoRefs.current[layerId]
                              if (!node) return
                              const tr = getDecoTextLayerTransformRef.current(layerId)
                              if (!tr) return
                              if (tr.contentTextBoxUserSized === true) snapDecoTextBoxHeightOnly(layerId, node)
                              else applyDecoTextBoxAutoLayout(layerId, node)
                              moveableRef.current?.updateRect()
                            }, TEXT_EDIT_LAYOUT_DEBOUNCE_MS)
                          }
                        : undefined
                    }
                    onBlur={(ev) => {
                      if (!decoInlineEditing) return
                      const keepEditing =
                        moveableChromePointerDownRef.current || isThemePreviewMoveableChrome(ev.relatedTarget)
                      if (keepEditing) {
                        requestAnimationFrame(() => {
                          if (editingDecoLayerIdRef.current !== L.id) return
                          const root = decoRefs.current[L.id]
                          getTextLayoutRoot(root ?? document.body).focus()
                        })
                        return
                      }
                      if (decoLayoutInputDebounceRef.current) {
                        clearTimeout(decoLayoutInputDebounceRef.current)
                        decoLayoutInputDebounceRef.current = null
                      }
                      const elBlur = decoRefs.current[L.id]
                      const text = (elBlur ? getTextLayoutRoot(elBlur).textContent : '')
                        ?.replace(/\u00a0/g, ' ')
                        .replace(/\n+$/g, '')
                        .slice(0, 2000) ?? ''
                      let patch: Partial<PopupTheme> | null = null
                      if (elBlur && containerRef.current) {
                        const css = elBlur.style.transform || decoStyleTransformById[L.id] || ''
                        const { translateX, translateY, rotation, scale } = parseTransformValues(css)
                        const pos = translateToThemePercent(elBlur, translateX, translateY)
                        const list = ensureThemeLayers(theme).layers ?? []
                        const curLayer = list.find((x) => x.id === L.id)
                        const curTransform =
                          curLayer && (curLayer.kind === 'text' || curLayer.kind === 'image')
                            ? (curLayer as TextThemeLayer | ImageThemeLayer).transform
                            : undefined
                        const patchTransform: TextTransform = {
                          ...(curTransform ?? { x: 50, y: 50, rotation: 0, scale: 1 }),
                          x: pos.x,
                          y: pos.y,
                          rotation: +rotation.toFixed(2),
                          scale: +scale.toFixed(4),
                        }
                        patch = updateDecorationLayer(theme, L.id, { text, transform: patchTransform })
                      } else {
                        patch = updateDecorationLayer(theme, L.id, { text })
                      }
                      if (patch) onUpdateTheme(theme.id, patch)
                      setEditingDecoLayerId(null)
                      requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                          const node = decoRefs.current[L.id]
                          if (node) {
                            const wBefore = decoIsVertical ? node.offsetWidth : 0
                            snapDecoTextBoxHeightOnly(L.id, node)
                            if (decoIsVertical) adjustDecoVerticalEdgeAnchor(L.id, node, wBefore)
                          } else moveableRef.current?.updateRect()
                        })
                      })
                    }}
                    onKeyDown={
                      decoInlineEditing && !readOnly
                        ? (e) => {
                            if (e.key === 'Escape') {
                              e.preventDefault()
                              setEditingDecoLayerId(null)
                              getTextLayoutRoot(decoRefs.current[L.id] ?? document.body).blur()
                            }
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault()
                              getTextLayoutRoot(decoRefs.current[L.id] ?? document.body).blur()
                            }
                          }
                        : undefined
                    }
                  >
                    {!decoInlineEditing ? (td.text ?? '') : null}
                  </span>
                </div>
              )
            }
            case 'image': {
              const im = L as ImageThemeLayer
              const pathTrim = (im.imagePath ?? '').trim()
              const url = rendererSafePreviewImageUrl(pathTrim, previewImageUrlMap)
              const dtf = decoStyleTransformById[L.id] ?? 'translate(0px,0px) rotate(0deg) scale(1)'
              const tw = im.transform?.textBoxWidthPct ?? 28
              const th = im.transform?.textBoxHeightPct ?? 22
              const fit = im.objectFit === 'contain' ? 'contain' : 'cover'
              const maxWpct = Math.min(96, Math.max(5, tw))
              const maxHpct = Math.min(100, Math.max(3, th))
              const contEl = containerRef.current
              const cw0 = contEl?.clientWidth ?? 0
              const ch0 = contEl?.clientHeight ?? 0
              const capsReady = cw0 > 2 && ch0 > 2
              const capPxW = capsReady ? (cw0 * maxWpct) / 100 : null
              const capPxH = capsReady ? (ch0 * maxHpct) / 100 : null
              const isContain = fit === 'contain'
              return (
                <div
                  key={L.id}
                  ref={(el) => {
                    decoRefs.current[L.id] = el
                  }}
                  data-deco-layer-id={L.id}
                  className={`absolute ${readOnly ? 'cursor-default' : 'cursor-move'}`}
                  style={{
                    left: 0,
                    top: 0,
                    transform: dtf,
                    transformOrigin: 'center',
                    zIndex: zi,
                    boxSizing: 'border-box',
                    ...(isContain
                      ? {
                          /** 上限只加在 img 上：父级同时 max-height 会钳死「已用高度」而子图仍按宽算出更高，导致上下溢出、Moveable 量高偏矮 */
                          display: 'inline-block',
                          lineHeight: 0,
                        }
                      : {
                          width: `${maxWpct}%`,
                          height: `${maxHpct}%`,
                          maxWidth: '100%',
                          maxHeight: '100%',
                        }),
                  }}
                  onMouseDown={(e) => {
                    if (readOnly || e.button !== 0) return
                    if (e.shiftKey) return
                    e.stopPropagation()
                    flushSync(() => {
                      setMarqueeDecorationLayerIds([])
                      onSelectStructuralLayer?.(null)
                      onSelectElements([])
                      onSelectDecorationLayer?.(L.id)
                    })
                    setMoveableTargets([e.currentTarget as HTMLDivElement])
                    scheduleDragStart(e.nativeEvent)
                  }}
                >
                  {url ? (
                    <img
                      alt=""
                      src={url}
                      draggable={false}
                      decoding="async"
                      className={`pointer-events-none select-none ${isContain ? '' : 'h-full w-full'}`}
                      style={
                        isContain
                          ? {
                              display: 'block',
                              width: 'auto',
                              height: 'auto',
                              maxWidth: capPxW != null ? `${capPxW}px` : `${maxWpct}%`,
                              maxHeight: capPxH != null ? `${capPxH}px` : `${maxHpct}%`,
                              objectFit: fit,
                            }
                          : { objectFit: fit, display: 'block' }
                      }
                      onLoad={(ev) => {
                        const img = ev.currentTarget
                        applyDecoImageIntrinsicBox(L.id, pathTrim, img.naturalWidth, img.naturalHeight)
                      }}
                    />
                  ) : null}
                </div>
              )
            }
            default:
              return null
          }
        })}

        {marqueeRect && (
          <div className="absolute pointer-events-none" style={{
            left: marqueeRect.left, top: marqueeRect.top, width: marqueeRect.width, height: marqueeRect.height,
            border: '1px solid rgba(99, 102, 241, 0.8)', background: 'rgba(99, 102, 241, 0.12)', zIndex: 20,
          }} />
        )}

        {!readOnly && moveableTargets.length > 0 && (
          <Moveable
            ref={moveableRef}
            key={moveableKey}
            target={moveableTarget}
            container={containerRef.current}
            snapContainer={containerRef}
            individualGroupable={false}
            useResizeObserver={false}
            defaultGroupOrigin="50% 50%"
            draggable={moveableTransformGesturesEnabled}
            rotatable={moveableTransformGesturesEnabled}
            scalable={moveableTransformGesturesEnabled ? { keepRatio: true } : false}
            resizable={resizableForTextBounds ? { throttleResize: 0, keepRatio: false } : false}
            snappable={true}
            snapDirections={{ top: true, left: true, bottom: true, right: true, center: true, middle: true }}
            elementSnapDirections={{ top: true, left: true, bottom: true, right: true, center: true, middle: true }}
            /** 0.56+ 以 snapHorizontal/VerticalThreshold 为准，snapThreshold 已弃用；默认仅 5px 贴边不易感知 */
            snapThreshold={14}
            snapHorizontalThreshold={14}
            snapVerticalThreshold={14}
            isDisplaySnapDigit={true}
            snapGap={true}
            elementGuidelines={elementGuidelineRefs()}
            horizontalGuidelines={previewSnapGuidelines.horizontal}
            verticalGuidelines={previewSnapGuidelines.vertical}
            throttleDrag={0} throttleRotate={0} throttleScale={0.01}
            rotationPosition="top"
            renderDirections={resizableForTextBounds ? ['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w'] : ['nw', 'ne', 'sw', 'se']}
            edge={false}

            onDragStart={() => {
              transformSyncLockedRef.current = true
              resetMoveableVisualPipeline()
              setTransformSyncLocked(true)
            }}
            onDrag={({ target, transform }) => {
              applyMoveableFrame([{ target, transform }])
            }}
            onDragEnd={({ target }) => {
              flushMoveableVisual('sync')
              finalizeElement(target)
              transformSyncLockedRef.current = false
              setTransformSyncLocked(false)
            }}

            onRotateStart={() => {
              transformSyncLockedRef.current = true
              resetMoveableVisualPipeline()
              setTransformSyncLocked(true)
            }}
            onRotate={({ target, transform, afterTransform, inputEvent }) => {
              const css = snapRotateInFullTransform(pickMoveableCssTransform({ transform, afterTransform }), inputEvent)
              applyMoveableFrame([{ target, transform: css }])
            }}
            onRotateEnd={({ target }) => {
              flushMoveableVisual('sync')
              finalizeElement(target)
              transformSyncLockedRef.current = false
              setTransformSyncLocked(false)
            }}

            onScaleStart={({ inputEvent, direction }) => {
              transformSyncLockedRef.current = true
              resetMoveableVisualPipeline()
              setTransformSyncLocked(true)
              takeSnapshots()
              const cont = containerRef.current
              const el =
                selectedDecorationLayerId
                  ? decoRefs.current[selectedDecorationLayerId]
                  : selectedElements.length === 1
                    ? getTargetRef(selectedElements[0])?.current
                    : null
              if (!cont || !el) {
                scalePinBoxRef.current = null
                scaleDirectionForPinRef.current = null
                return
              }
              scaleDirectionForPinRef.current =
                Array.isArray(direction) && direction.length >= 2 ? [direction[0], direction[1]] : [1, 1]
              const cr = cont.getBoundingClientRect()
              const er = el.getBoundingClientRect()
              const ctrlHeld =
                !!inputEvent &&
                typeof inputEvent === 'object' &&
                'ctrlKey' in inputEvent &&
                Boolean((inputEvent as MouseEvent | PointerEvent).ctrlKey)
              if (ctrlHeld) {
                scalePinBoxRef.current = {
                  mode: 'center',
                  cx: (er.left + er.right) / 2 - cr.left,
                  cy: (er.top + er.bottom) / 2 - cr.top,
                }
              } else {
                const corner = fixedCornerFromScaleDirection(scaleDirectionForPinRef.current)
                const pos = getRotatedLocalCornerInContainer(el, cr, corner)
                scalePinBoxRef.current = { mode: 'corner', corner, pinX: pos.x, pinY: pos.y }
              }
            }}
            onScale={({ target, transform, afterTransform, inputEvent }) => {
              let raw = forceUniformScaleInFullTransform(pickMoveableCssTransform({ transform, afterTransform }))
              applyMoveableFrame([{ target, transform: raw }])
              const cont = containerRef.current
              if (!cont || !(target instanceof HTMLElement)) return
              let pin = scalePinBoxRef.current
              if (!pin) return
              const cr = cont.getBoundingClientRect()
              const er = target.getBoundingClientRect()
              const ctrlHeld =
                !!inputEvent &&
                typeof inputEvent === 'object' &&
                'ctrlKey' in inputEvent &&
                Boolean((inputEvent as MouseEvent | PointerEvent).ctrlKey)
              const wantMode = ctrlHeld ? 'center' : 'corner'
              if (pin.mode !== wantMode) {
                if (wantMode === 'center') {
                  scalePinBoxRef.current = {
                    mode: 'center',
                    cx: (er.left + er.right) / 2 - cr.left,
                    cy: (er.top + er.bottom) / 2 - cr.top,
                  }
                } else {
                  const dir = scaleDirectionForPinRef.current ?? [1, 1]
                  const corner = fixedCornerFromScaleDirection(dir)
                  const pos = getRotatedLocalCornerInContainer(target, cr, corner)
                  scalePinBoxRef.current = { mode: 'corner', corner, pinX: pos.x, pinY: pos.y }
                }
                pin = scalePinBoxRef.current
              }
              let dlx = 0
              let dty = 0
              if (pin.mode === 'corner') {
                const cur = getRotatedLocalCornerInContainer(target, cr, pin.corner)
                dlx = pin.pinX - cur.x
                dty = pin.pinY - cur.y
              } else {
                const cx = (er.left + er.right) / 2 - cr.left
                const cy = (er.top + er.bottom) / 2 - cr.top
                dlx = pin.cx - cx
                dty = pin.cy - cy
              }
              if (Math.abs(dlx) > 0.02 || Math.abs(dty) > 0.02) {
                const p = parseTransformValues(target.style.transform)
                raw = buildTransform(p.translateX + dlx, p.translateY + dty, p.rotation, p.scale)
                applyMoveableFrame([{ target, transform: raw }])
              }
            }}
            onScaleEnd={({ target }) => {
              scalePinBoxRef.current = null
              scaleDirectionForPinRef.current = null
              flushMoveableVisual('sync')
              finalizeScaleBakesFontSize(target)
              transformSyncLockedRef.current = false
              setTransformSyncLocked(false)
            }}

            onDragGroupStart={() => {
              transformSyncLockedRef.current = true
              resetMoveableVisualPipeline()
              setTransformSyncLocked(true)
              takeSnapshots()
            }}
            onDragGroup={({ events }) => {
              applyMoveableFrame(events.map(ev => ({ target: ev.target, transform: ev.transform })))
            }}
            onDragGroupEnd={({ events }) => {
              flushMoveableVisual('sync')
              events.forEach(ev => finalizeElement(ev.target))
              transformSyncLockedRef.current = false
              setTransformSyncLocked(false)
            }}

            onRotateGroupStart={() => {
              transformSyncLockedRef.current = true
              resetMoveableVisualPipeline()
              setTransformSyncLocked(true)
              takeSnapshots()
            }}
            onRotateGroup={({ events, inputEvent }) => {
              if (groupMode) {
                applyMoveableFrame(events.map(ev => ({
                  target: ev.target,
                  transform: snapRotateInFullTransform(pickMoveableCssTransform(ev), inputEvent),
                })))
              } else {
                const firstK = keyOfEl(events[0]?.target)
                const firstSnap = firstK ? snapshotsRef.current.get(firstK) : null
                if (!firstSnap) return
                const evRot = parseTransformValues(pickMoveableCssTransform(events[0])).rotation
                let delta = evRot - firstSnap.t.rotation
                if (inputEvent && (inputEvent as MouseEvent).shiftKey) delta = Math.round(delta / 15) * 15
                const frames = events.map(ev => {
                  const k = keyOfEl(ev.target)
                  const snap = k ? snapshotsRef.current.get(k) : null
                  const tf = snap ? buildTransform(snap.txPx, snap.tyPx, snap.t.rotation + delta, snap.t.scale) : ev.transform
                  return { target: ev.target, transform: tf }
                })
                applyMoveableFrame(frames)
              }
            }}
            onRotateGroupEnd={({ events }) => {
              flushMoveableVisual('sync')
              events.forEach(ev => finalizeElement(ev.target))
              transformSyncLockedRef.current = false
              setTransformSyncLocked(false)
            }}

            onScaleGroupStart={(e) => {
              transformSyncLockedRef.current = true
              resetMoveableVisualPipeline()
              setTransformSyncLocked(true)
              takeSnapshots()
              const cont = containerRef.current
              const targetsRaw = e.targets
              const tgs =
                Array.isArray(targetsRaw) && targetsRaw.length > 0
                  ? (targetsRaw as HTMLElement[]).filter((x): x is HTMLElement => x instanceof HTMLElement)
                  : []
              if (!cont || !groupMode || tgs.length < 2) {
                scalePinBoxRef.current = null
                scaleDirectionForPinRef.current = null
                return
              }
              const cr = cont.getBoundingClientRect()
              scaleDirectionForPinRef.current =
                Array.isArray(e.direction) && e.direction.length >= 2 ? [e.direction[0], e.direction[1]] : [1, 1]
              const union = getAxisAlignedUnionBoxInContainer(tgs, cr)
              const ctrlHeld =
                !!e.inputEvent &&
                typeof e.inputEvent === 'object' &&
                'ctrlKey' in e.inputEvent &&
                Boolean((e.inputEvent as MouseEvent | PointerEvent).ctrlKey)
              if (ctrlHeld) {
                scalePinBoxRef.current = {
                  mode: 'center',
                  cx: (union.left + union.right) / 2,
                  cy: (union.top + union.bottom) / 2,
                }
              } else {
                const corner = fixedCornerFromScaleDirection(scaleDirectionForPinRef.current)
                const pos = unionBoxCorner(union, corner)
                scalePinBoxRef.current = { mode: 'corner', corner, pinX: pos.x, pinY: pos.y }
              }
            }}
            onScaleGroup={({ events, inputEvent }) => {
              if (groupMode) {
                const frames0 = events.map(ev => ({
                  target: ev.target,
                  transform: forceUniformScaleInFullTransform(pickMoveableCssTransform(ev)),
                }))
                applyMoveableFrame(frames0)
                const cont = containerRef.current
                if (!cont || events.length === 0) return
                let pin = scalePinBoxRef.current
                if (!pin) return
                const cr = cont.getBoundingClientRect()
                const els = events.map(ev => ev.target).filter((x): x is HTMLElement => x instanceof HTMLElement)
                const union = getAxisAlignedUnionBoxInContainer(els, cr)
                const ctrlHeld =
                  !!inputEvent &&
                  typeof inputEvent === 'object' &&
                  'ctrlKey' in inputEvent &&
                  Boolean((inputEvent as MouseEvent | PointerEvent).ctrlKey)
                const wantMode = ctrlHeld ? 'center' : 'corner'
                if (pin.mode !== wantMode) {
                  if (wantMode === 'center') {
                    scalePinBoxRef.current = {
                      mode: 'center',
                      cx: (union.left + union.right) / 2,
                      cy: (union.top + union.bottom) / 2,
                    }
                  } else {
                    const dir = scaleDirectionForPinRef.current ?? [1, 1]
                    const corner = fixedCornerFromScaleDirection(dir)
                    const pos = unionBoxCorner(union, corner)
                    scalePinBoxRef.current = { mode: 'corner', corner, pinX: pos.x, pinY: pos.y }
                  }
                  pin = scalePinBoxRef.current
                }
                let dlx = 0
                let dty = 0
                if (pin.mode === 'corner') {
                  const cur = unionBoxCorner(union, pin.corner)
                  dlx = pin.pinX - cur.x
                  dty = pin.pinY - cur.y
                } else {
                  const cx = (union.left + union.right) / 2
                  const cy = (union.top + union.bottom) / 2
                  dlx = pin.cx - cx
                  dty = pin.cy - cy
                }
                if (Math.abs(dlx) > 0.02 || Math.abs(dty) > 0.02) {
                  const frames = els.map((el) => {
                    const p = parseTransformValues(el.style.transform)
                    const raw = buildTransform(p.translateX + dlx, p.translateY + dty, p.rotation, p.scale)
                    return { target: el, transform: raw }
                  })
                  applyMoveableFrame(frames)
                }
              } else {
                const firstK = keyOfEl(events[0]?.target)
                const firstSnap = firstK ? snapshotsRef.current.get(firstK) : null
                if (!firstSnap || !firstSnap.t.scale) return
                const evScale = parseTransformValues(forceUniformScaleInFullTransform(pickMoveableCssTransform(events[0]))).scale
                const ratio = evScale / firstSnap.t.scale
                const frames = events.map(ev => {
                  const k = keyOfEl(ev.target)
                  const snap = k ? snapshotsRef.current.get(k) : null
                  const tf = snap
                    ? buildTransform(snap.txPx, snap.tyPx, snap.t.rotation, Math.max(0.05, Math.min(25, snap.t.scale * ratio)))
                    : ev.transform
                  return { target: ev.target, transform: tf }
                })
                applyMoveableFrame(frames)
              }
            }}
            onScaleGroupEnd={({ events }) => {
              scalePinBoxRef.current = null
              scaleDirectionForPinRef.current = null
              flushMoveableVisual('sync')
              events.forEach(ev => finalizeScaleBakesFontSize(ev.target))
              transformSyncLockedRef.current = false
              setTransformSyncLocked(false)
            }}

            onResizeStart={() => {
              transformSyncLockedRef.current = true
              resetMoveableVisualPipeline()
              setTransformSyncLocked(true)
            }}
            onResize={(e) => {
              if (!(e.target instanceof HTMLElement)) return
              const el = e.target
              el.style.width = `${e.width}px`
              el.style.height = `${e.height}px`
              const tf = e.drag?.transform ?? e.transform
              if (tf) el.style.transform = tf
            }}
            onResizeEnd={(e) => {
              flushMoveableVisual('sync')
              if (e.target instanceof HTMLElement) finalizeResize(e.target)
              transformSyncLockedRef.current = false
              setTransformSyncLocked(false)
            }}
          />
        )}
      </div>
    </div>
  )
}
