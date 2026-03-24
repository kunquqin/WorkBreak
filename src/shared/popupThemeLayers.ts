/**
 * 弹窗主题：图层顺序、可见性（文本 / 时间 / 图片 / 背景 / 遮罩）。
 * 文本层统一为 kind: 'text'；其中 bindsReminderBody 为 true 的层接收提醒主文案注入。
 */
import type {
  PopupLayerTextEffects,
  PopupTextAlign,
  PopupTextOrientationMode,
  PopupTextVerticalAlign,
  PopupTextWritingMode,
  PopupTheme,
  TextTransform,
} from './settings'
import { normalizePopupTextOrientationMode, normalizePopupTextWritingMode } from './popupVerticalText'

function sanitizeLayerTextEffects(raw: unknown): PopupLayerTextEffects | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const out: PopupLayerTextEffects = {}
  if (typeof o.strokeEnabled === 'boolean') out.strokeEnabled = o.strokeEnabled
  if (typeof o.shadowEnabled === 'boolean') out.shadowEnabled = o.shadowEnabled
  const strokeW = Number(o.strokeWidthPx)
  if (Number.isFinite(strokeW)) out.strokeWidthPx = Math.max(0, Math.min(24, strokeW))
  if (typeof o.strokeColor === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(o.strokeColor.trim())) {
    out.strokeColor = o.strokeColor.trim()
  }
  const strokeOp = Number(o.strokeOpacity)
  if (Number.isFinite(strokeOp)) out.strokeOpacity = Math.max(0, Math.min(1, strokeOp))
  if (typeof o.shadowColor === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(o.shadowColor.trim())) {
    out.shadowColor = o.shadowColor.trim()
  }
  const shadowOp = Number(o.shadowOpacity)
  if (Number.isFinite(shadowOp)) out.shadowOpacity = Math.max(0, Math.min(1, shadowOp))
  const shadowBlur = Number(o.shadowBlurPx)
  if (Number.isFinite(shadowBlur)) out.shadowBlurPx = Math.max(0, Math.min(80, shadowBlur))
  const shadowSize = Number(o.shadowSizePx)
  if (Number.isFinite(shadowSize)) out.shadowSizePx = Math.max(0, Math.min(48, shadowSize))
  const shadowDist = Number(o.shadowDistancePx)
  if (Number.isFinite(shadowDist)) out.shadowDistancePx = Math.max(0, Math.min(160, shadowDist))
  const shadowAng = Number(o.shadowAngleDeg)
  if (Number.isFinite(shadowAng)) out.shadowAngleDeg = Math.max(-360, Math.min(360, shadowAng))
  return Object.keys(out).length > 0 ? out : undefined
}

function baseTransform(): TextTransform {
  return { x: 50, y: 50, rotation: 0, scale: 1 }
}

export const POPUP_LAYER_BACKGROUND_ID = 'layer-bg'
export const POPUP_LAYER_OVERLAY_ID = 'layer-overlay'
export const POPUP_LAYER_BINDING_CONTENT_ID = 'layer-binding-content'
export const POPUP_LAYER_BINDING_TIME_ID = 'layer-binding-time'
export const POPUP_LAYER_BINDING_DATE_ID = 'layer-binding-date'

/** 文本层数量上限（含「提醒文案」绑定层） */
export const MAX_TEXT_LAYERS = 10

/** 与 `settings.BUILTIN_*_POPUP_FALLBACK_BODY` 文案保持一致（避免 settings↔本模块循环依赖） */
export const RESTORE_BINDING_BODY_MAIN = '时间到啦'
export const RESTORE_BINDING_BODY_REST = '休息一下'
export const MAX_DECORATION_IMAGE_LAYERS = 5

export type PopupThemeLayerKind =
  | 'background'
  | 'overlay'
  | 'image'
  | 'text'
  | 'bindingTime'
  | 'bindingDate'

export interface PopupThemeLayerBase {
  id: string
  kind: PopupThemeLayerKind
  /** false：该层不参与绘制（主进程与预览一致） */
  visible: boolean
}

export interface BackgroundThemeLayer extends PopupThemeLayerBase {
  kind: 'background'
}

export interface OverlayThemeLayer extends PopupThemeLayerBase {
  kind: 'overlay'
}

export interface ImageThemeLayer extends PopupThemeLayerBase {
  kind: 'image'
  imagePath: string
  transform: TextTransform
  objectFit?: 'cover' | 'contain'
}

/** 统一文本层；bindsReminderBody 为 true 时弹窗/预览注入提醒主文案 */
export interface TextThemeLayer extends PopupThemeLayerBase {
  kind: 'text'
  bindsReminderBody: boolean
  text: string
  transform: TextTransform
  color: string
  fontSize: number
  fontWeight?: number
  textAlign?: PopupTextAlign
  textVerticalAlign?: PopupTextVerticalAlign
  letterSpacing?: number
  lineHeight?: number
  fontFamilyPreset?: string
  fontFamilySystem?: string
  textEffects?: PopupLayerTextEffects
  /** 与主题根 `contentFontItalic` 等语义对齐，仅装饰/独立文本层使用；绑定层仍以根字段为准 */
  fontItalic?: boolean
  textUnderline?: boolean
  /** 装饰文本排向与竖排选项（绑定主文案仍以主题根字段为准） */
  writingMode?: PopupTextWritingMode
  textOrientation?: PopupTextOrientationMode
  combineUprightDigits?: boolean
}

export interface BindingTimeThemeLayer extends PopupThemeLayerBase {
  kind: 'bindingTime'
}

export interface BindingDateThemeLayer extends PopupThemeLayerBase {
  kind: 'bindingDate'
}

export type PopupThemeLayer =
  | BackgroundThemeLayer
  | OverlayThemeLayer
  | ImageThemeLayer
  | TextThemeLayer
  | BindingTimeThemeLayer
  | BindingDateThemeLayer

function newDecoId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function defaultFreeTextTransform(): TextTransform {
  /**
   * 新增装饰文本默认应为「贴字」而非固定大框：
   * 不预置 textBoxWidth/Height，交给预览按内容尺寸自适应；
   * 用户手动拉框后再写入 textBox*Pct 持久化。
   */
  /** y 与绑定主文案默认 42% 对齐，新建装饰句视觉中心接近主文案 */
  return { ...baseTransform(), x: 50, y: 36 }
}

function defaultImageTransform(): TextTransform {
  return { ...baseTransform(), x: 50, y: 50, textBoxWidthPct: 28, textBoxHeightPct: 22 }
}

function bindingBodyTextFromTheme(theme: PopupTheme): Omit<TextThemeLayer, 'id' | 'kind' | 'visible'> {
  const te = theme.contentTextEffects ? sanitizeLayerTextEffects(theme.contentTextEffects) : undefined
  return {
    bindsReminderBody: true,
    text: theme.previewContentText?.trim() ?? '',
    color: theme.contentColor || '#ffffff',
    fontSize: Math.max(1, Math.min(8000, Math.floor(theme.contentFontSize ?? 180))),
    fontWeight: theme.contentFontWeight ?? 600,
    textAlign: theme.contentTextAlign,
    textVerticalAlign: theme.contentTextVerticalAlign,
    letterSpacing: theme.contentLetterSpacing,
    lineHeight: theme.contentLineHeight,
    fontFamilyPreset: theme.contentFontFamilyPreset,
    fontFamilySystem: theme.contentFontFamilySystem,
    transform: theme.contentTransform ?? { x: 50, y: 36, rotation: 0, scale: 1 },
    ...(te ? { textEffects: te } : {}),
  }
}

/** 从旧主题（无 layers）生成默认栈 */
export function migrateLegacyLayerStack(theme: PopupTheme): PopupThemeLayer[] {
  const overlayVisible = theme.overlayEnabled !== false
  const body = bindingBodyTextFromTheme(theme)
  const T: TextThemeLayer = {
    id: POPUP_LAYER_BINDING_CONTENT_ID,
    kind: 'text',
    visible: true,
    ...body,
  }
  return [
    { id: POPUP_LAYER_BACKGROUND_ID, kind: 'background', visible: true },
    { id: POPUP_LAYER_OVERLAY_ID, kind: 'overlay', visible: overlayVisible },
    T,
    { id: POPUP_LAYER_BINDING_TIME_ID, kind: 'bindingTime', visible: true },
  ]
}

function countKind(layers: PopupThemeLayer[], k: PopupThemeLayerKind): number {
  return layers.filter((x) => x.kind === k).length
}

function normalizeLayerTransform(raw: unknown): TextTransform | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const x = Number(o.x)
  const y = Number(o.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined
  const rotation = Number(o.rotation)
  const scale = Number(o.scale)
  const out: TextTransform = {
    x: Math.max(0, Math.min(100, x)),
    y: Math.max(0, Math.min(100, y)),
    rotation: Number.isFinite(rotation) ? rotation % 360 : 0,
    scale: Number.isFinite(scale) ? Math.max(0.1, Math.min(5, scale)) : 1,
  }
  const wp = Number(o.textBoxWidthPct)
  const hp = Number(o.textBoxHeightPct)
  if (Number.isFinite(wp)) out.textBoxWidthPct = Math.max(5, Math.min(96, wp))
  if (Number.isFinite(hp)) out.textBoxHeightPct = Math.max(3, Math.min(100, hp))
  if (o.contentTextBoxUserSized === true) out.contentTextBoxUserSized = true
  if (o.shortLayerTextBoxLockWidth === true) out.shortLayerTextBoxLockWidth = true
  return out
}

function sanitizeLayer(raw: unknown, theme: PopupTheme): PopupThemeLayer | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : ''
  const visible = o.visible === false ? false : true
  const kind = o.kind as string
  if (kind === 'background' && id === POPUP_LAYER_BACKGROUND_ID) {
    return { id, kind: 'background', visible }
  }
  if (kind === 'overlay' && id === POPUP_LAYER_OVERLAY_ID) {
    return { id, kind: 'overlay', visible }
  }
  if (kind === 'bindingTime' && id === POPUP_LAYER_BINDING_TIME_ID) {
    return { id, kind: 'bindingTime', visible }
  }
  if (kind === 'bindingDate' && id === POPUP_LAYER_BINDING_DATE_ID) {
    return { id, kind: 'bindingDate', visible }
  }
  if (kind === 'bindingCountdown') return null

  /** 新版 text 或旧 bindingContent */
  if (kind === 'text' && id) {
    const binds = o.bindsReminderBody === true
    const baseBody = binds ? bindingBodyTextFromTheme(theme) : null
    const text =
      typeof o.text === 'string'
        ? o.text.slice(0, 2000)
        : baseBody
          ? baseBody.text
          : ''
    const color =
      typeof o.color === 'string' && o.color
        ? o.color
        : baseBody
          ? baseBody.color
          : '#ffffff'
    const fsRaw = Math.floor(Number(o.fontSize))
    const fs = Number.isFinite(fsRaw) && fsRaw > 0
      ? Math.max(1, Math.min(8000, fsRaw))
      : baseBody
        ? baseBody.fontSize
        : 28
    const fw = Number(o.fontWeight)
    const transform =
      normalizeLayerTransform(o.transform) ??
      (baseBody ? baseBody.transform : binds ? { x: 50, y: 36, rotation: 0, scale: 1 } : defaultFreeTextTransform())
    const te = sanitizeLayerTextEffects(o.textEffects) ?? baseBody?.textEffects
    const align =
      o.textAlign === 'left' || o.textAlign === 'right' || o.textAlign === 'center' || o.textAlign === 'start' || o.textAlign === 'end' || o.textAlign === 'justify'
        ? o.textAlign
        : baseBody?.textAlign
    const verticalAlign =
      o.textVerticalAlign === 'top' || o.textVerticalAlign === 'middle' || o.textVerticalAlign === 'bottom'
        ? o.textVerticalAlign
        : baseBody?.textVerticalAlign
    const letterSpacing = Number.isFinite(Number(o.letterSpacing))
      ? Math.max(-2, Math.min(20, Number(o.letterSpacing)))
      : baseBody?.letterSpacing
    const lineHeight = Number.isFinite(Number(o.lineHeight))
      ? Math.max(0.8, Math.min(3, Number(o.lineHeight)))
      : baseBody?.lineHeight
    const fontFamilyPreset =
      typeof o.fontFamilyPreset === 'string' ? o.fontFamilyPreset : baseBody?.fontFamilyPreset
    const fontFamilySystem =
      typeof o.fontFamilySystem === 'string' ? o.fontFamilySystem : baseBody?.fontFamilySystem
    const fontWeight = Number.isFinite(fw)
      ? Math.max(100, Math.min(900, Math.round(fw / 100) * 100))
      : baseBody?.fontWeight
    const writingMode = normalizePopupTextWritingMode(o.writingMode)
    const textOrientation = normalizePopupTextOrientationMode(o.textOrientation)
    const combineUprightDigits =
      o.combineUprightDigits === true ? true : o.combineUprightDigits === false ? false : undefined
    return {
      id,
      kind: 'text',
      visible,
      bindsReminderBody: binds,
      text,
      color,
      fontSize: fs,
      ...(fontWeight !== undefined ? { fontWeight } : {}),
      transform,
      ...(align ? { textAlign: align } : {}),
      ...(verticalAlign ? { textVerticalAlign: verticalAlign } : {}),
      ...(letterSpacing !== undefined ? { letterSpacing } : {}),
      ...(lineHeight !== undefined ? { lineHeight } : {}),
      ...(fontFamilyPreset ? { fontFamilyPreset } : {}),
      ...(fontFamilySystem ? { fontFamilySystem } : {}),
      ...(te ? { textEffects: te } : {}),
      ...(o.fontItalic === true ? { fontItalic: true as const } : {}),
      ...(o.textUnderline === true ? { textUnderline: true as const } : {}),
      ...(writingMode ? { writingMode } : {}),
      ...(textOrientation ? { textOrientation } : {}),
      ...(combineUprightDigits !== undefined ? { combineUprightDigits } : {}),
    }
  }

  if (kind === 'bindingContent' && id === POPUP_LAYER_BINDING_CONTENT_ID) {
    const base = bindingBodyTextFromTheme(theme)
    return {
      id,
      kind: 'text',
      visible,
      ...base,
      text: typeof o.text === 'string' ? o.text.slice(0, 2000) : base.text,
      transform: normalizeLayerTransform(o.transform) ?? base.transform,
    }
  }

  /** 旧 textDeco → text */
  if (kind === 'textDeco' && id) {
    const text = typeof o.text === 'string' ? o.text.slice(0, 2000) : ''
    const color = typeof o.color === 'string' && o.color ? o.color : '#ffffff'
    const fs = Math.max(1, Math.min(8000, Math.floor(Number(o.fontSize)) || 28))
    const fw = Number(o.fontWeight)
    const transform = normalizeLayerTransform(o.transform) ?? defaultFreeTextTransform()
    const te = sanitizeLayerTextEffects(o.textEffects)
    const decoWm = normalizePopupTextWritingMode(o.writingMode)
    const decoOri = normalizePopupTextOrientationMode(o.textOrientation)
    return {
      id,
      kind: 'text',
      visible,
      bindsReminderBody: false,
      text,
      color,
      fontSize: fs,
      fontWeight: Number.isFinite(fw) ? Math.max(100, Math.min(900, Math.round(fw / 100) * 100)) : undefined,
      transform,
      textAlign:
        o.textAlign === 'left' || o.textAlign === 'right' || o.textAlign === 'center' || o.textAlign === 'start' || o.textAlign === 'end' || o.textAlign === 'justify'
          ? o.textAlign
          : undefined,
      textVerticalAlign:
        o.textVerticalAlign === 'top' || o.textVerticalAlign === 'middle' || o.textVerticalAlign === 'bottom'
          ? o.textVerticalAlign
          : undefined,
      letterSpacing: Number.isFinite(Number(o.letterSpacing)) ? Math.max(-2, Math.min(20, Number(o.letterSpacing))) : undefined,
      lineHeight: Number.isFinite(Number(o.lineHeight)) ? Math.max(0.8, Math.min(3, Number(o.lineHeight))) : undefined,
      fontFamilyPreset: typeof o.fontFamilyPreset === 'string' ? o.fontFamilyPreset : undefined,
      fontFamilySystem: typeof o.fontFamilySystem === 'string' ? o.fontFamilySystem : undefined,
      ...(te ? { textEffects: te } : {}),
      ...(o.fontItalic === true ? { fontItalic: true as const } : {}),
      ...(o.textUnderline === true ? { textUnderline: true as const } : {}),
      ...(decoWm ? { writingMode: decoWm } : {}),
      ...(decoOri ? { textOrientation: decoOri } : {}),
      ...(o.combineUprightDigits === true ? { combineUprightDigits: true as const } : {}),
      ...(o.combineUprightDigits === false ? { combineUprightDigits: false as const } : {}),
    }
  }

  if (kind === 'image' && id) {
    const imagePath = typeof o.imagePath === 'string' && o.imagePath.trim() ? o.imagePath.trim() : ''
    if (!imagePath) return null
    const transform = normalizeLayerTransform(o.transform) ?? defaultImageTransform()
    const fit = o.objectFit === 'contain' ? 'contain' : 'cover'
    return { id, kind: 'image', visible, imagePath, transform, objectFit: fit }
  }
  return null
}

/** 解析磁盘 JSON；保持数组顺序；不强行补回已删的固定层；裁剪超额层 */
export function normalizePopupThemeLayersFromRaw(raw: unknown, theme: PopupTheme): PopupThemeLayer[] {
  const defaults = migrateLegacyLayerStack(theme)
  if (!Array.isArray(raw)) return defaults
  if (raw.length === 0) return []

  const seen = new Set<string>()
  const list: PopupThemeLayer[] = []
  for (const item of raw) {
    const L = sanitizeLayer(item, theme)
    if (!L || seen.has(L.id)) continue
    seen.add(L.id)
    list.push(L)
  }
  /** 非空 raw 但全部解析失败时回退整套默认栈，避免坏数据导致无层 */
  if (list.length === 0) return defaults

  let textCount = 0
  let imgCount = 0
  const out: PopupThemeLayer[] = []
  for (const L of list) {
    if (L.kind === 'text') {
      if (textCount >= MAX_TEXT_LAYERS) continue
      textCount++
      out.push(L)
    } else if (L.kind === 'image') {
      if (imgCount >= MAX_DECORATION_IMAGE_LAYERS) continue
      imgCount++
      out.push(L)
    } else {
      out.push(L)
    }
  }
  return out
}

export function syncOverlayEnabledFromLayers(theme: PopupTheme): PopupTheme {
  const ov = theme.layers?.find((l) => l.id === POPUP_LAYER_OVERLAY_ID && l.kind === 'overlay') as OverlayThemeLayer | undefined
  if (!ov) return theme
  return { ...theme, overlayEnabled: ov.visible }
}

export function syncThemeRootFromBindingTextLayer(theme: PopupTheme): PopupTheme {
  const tl = theme.layers?.find((l) => l.kind === 'text' && (l as TextThemeLayer).bindsReminderBody) as TextThemeLayer | undefined
  if (!tl) return theme
  const patch = themePatchFromBindingTextLayer(tl)
  const pSz = patch.contentFontSize
  const rootSz = theme.contentFontSize
  /** 旧版 binding 缺省字号曾用 56，层快照会把根上大字覆盖成小字 */
  if (typeof pSz === 'number' && typeof rootSz === 'number' && pSz === 56 && rootSz > 56) {
    delete patch.contentFontSize
  }
  if (typeof pSz === 'number' && rootSz === undefined && pSz === 56) {
    patch.contentFontSize = 180
  }
  return { ...theme, ...patch }
}

/** 预览/主题根字段变更时同步写入「提醒文案」文本层 */
export function mergeContentThemePatchIntoBindingTextLayer(theme: PopupTheme, patch: Partial<PopupTheme>): Partial<PopupTheme> | undefined {
  const layers = theme.layers
  if (!layers?.length) return undefined
  const idx = layers.findIndex((l) => l.kind === 'text' && (l as TextThemeLayer).bindsReminderBody)
  if (idx < 0) return undefined
  const cur = layers[idx] as TextThemeLayer
  const u: Partial<TextThemeLayer> = {}
  if (patch.previewContentText !== undefined) u.text = patch.previewContentText
  if (patch.contentColor !== undefined) u.color = patch.contentColor
  if (patch.contentFontSize !== undefined) u.fontSize = patch.contentFontSize
  if (patch.contentFontWeight !== undefined) u.fontWeight = patch.contentFontWeight
  if (patch.contentTextAlign !== undefined) u.textAlign = patch.contentTextAlign
  if (patch.contentTextVerticalAlign !== undefined) u.textVerticalAlign = patch.contentTextVerticalAlign
  if (patch.contentLetterSpacing !== undefined) u.letterSpacing = patch.contentLetterSpacing
  if (patch.contentLineHeight !== undefined) u.lineHeight = patch.contentLineHeight
  if (patch.contentFontFamilyPreset !== undefined) u.fontFamilyPreset = patch.contentFontFamilyPreset
  if (patch.contentFontFamilySystem !== undefined) u.fontFamilySystem = patch.contentFontFamilySystem
  if (patch.contentTransform !== undefined) u.transform = patch.contentTransform as TextTransform
  if (patch.contentTextEffects !== undefined) {
    const te = patch.contentTextEffects ? sanitizeLayerTextEffects(patch.contentTextEffects) : undefined
    u.textEffects = te
  }
  if (Object.keys(u).length === 0) return undefined
  const nl = [...layers]
  nl[idx] = { ...cur, ...u }
  return { layers: nl }
}

export function ensureThemeLayers(theme: PopupTheme): PopupTheme {
  if (Array.isArray(theme.layers) && theme.layers.length === 0) {
    const next = { ...theme, layers: [] as PopupThemeLayer[], formatVersion: Math.max(2, theme.formatVersion ?? 2) }
    return syncOverlayEnabledFromLayers(next)
  }
  const layers =
    theme.layers && theme.layers.length > 0 ? normalizePopupThemeLayersFromRaw(theme.layers, theme) : migrateLegacyLayerStack(theme)
  let next: PopupTheme = { ...theme, layers, formatVersion: Math.max(2, theme.formatVersion ?? 2) }
  next = syncThemeRootFromBindingTextLayer(next)
  return syncOverlayEnabledFromLayers(next)
}

export function setLayerVisibility(theme: PopupTheme, layerId: string, visible: boolean): Partial<PopupTheme> {
  const layers = (theme.layers ?? migrateLegacyLayerStack(theme)).map((l) => (l.id === layerId ? { ...l, visible } : l))
  const patch: Partial<PopupTheme> = { layers }
  if (layerId === POPUP_LAYER_OVERLAY_ID) {
    patch.overlayEnabled = visible
  }
  return patch
}

export function reorderLayers(theme: PopupTheme, fromIndex: number, toIndex: number): Partial<PopupTheme> | null {
  const layers = [...(theme.layers ?? migrateLegacyLayerStack(theme))]
  if (fromIndex < 0 || fromIndex >= layers.length || toIndex < 0 || toIndex >= layers.length) return null
  const [item] = layers.splice(fromIndex, 1)
  layers.splice(toIndex, 0, item)
  return { layers }
}

/**
 * 恢复唯一「主文案」绑定层（用户曾删除时）；文案随 `theme.target`：`main`→时间到啦，`rest`→休息一下。
 * 不计入 MAX_TEXT_LAYERS 限制（与必选层语义一致）。
 */
export function addBindingContentLayer(theme: PopupTheme): Partial<PopupTheme> | null {
  const layers = [...(theme.layers ?? migrateLegacyLayerStack(theme))]
  if (layers.some((l) => l.kind === 'text' && (l as TextThemeLayer).bindsReminderBody)) return null

  const bodyText = theme.target === 'rest' ? RESTORE_BINDING_BODY_REST : RESTORE_BINDING_BODY_MAIN
  const draftTheme: PopupTheme = { ...theme, previewContentText: bodyText }
  const base = bindingBodyTextFromTheme(draftTheme)
  const L: TextThemeLayer = {
    id: POPUP_LAYER_BINDING_CONTENT_ID,
    kind: 'text',
    visible: true,
    ...base,
    text: bodyText,
  }
  const timeIdx = layers.findIndex((l) => l.id === POPUP_LAYER_BINDING_TIME_ID && l.kind === 'bindingTime')
  const dateIdx = layers.findIndex((l) => l.id === POPUP_LAYER_BINDING_DATE_ID && l.kind === 'bindingDate')
  const clockIndices = [timeIdx, dateIdx].filter((i) => i >= 0).sort((a, b) => a - b)
  const firstClockIdx = clockIndices[0] ?? -1
  const insertAt =
    firstClockIdx >= 0
      ? firstClockIdx
      : (() => {
          const overlayIdx = layers.findIndex((l) => l.id === POPUP_LAYER_OVERLAY_ID && l.kind === 'overlay')
          return overlayIdx >= 0 ? overlayIdx + 1 : 0
        })()
  layers.splice(insertAt, 0, L)
  return { layers, ...themePatchFromBindingTextLayer(L) }
}

export function addTextLayer(theme: PopupTheme, bindsReminderBody = false): Partial<PopupTheme> | null {
  const layers = [...(theme.layers ?? migrateLegacyLayerStack(theme))]
  if (countKind(layers, 'text') >= MAX_TEXT_LAYERS) return null
  if (bindsReminderBody && layers.some((l) => l.kind === 'text' && (l as TextThemeLayer).bindsReminderBody)) return null
  const L: TextThemeLayer = bindsReminderBody
    ? {
        id: POPUP_LAYER_BINDING_CONTENT_ID,
        kind: 'text',
        visible: true,
        ...bindingBodyTextFromTheme(theme),
      }
    : {
        id: newDecoId('txt'),
        kind: 'text',
        visible: true,
        bindsReminderBody: false,
        text: '文本',
        color: '#ffffff',
        fontSize: 150,
        fontWeight: 500,
        transform: defaultFreeTextTransform(),
      }
  // 新增层默认放到顶层（最高 z），避免被既有遮罩/文本层压住。
  layers.push(L)
  return { layers }
}

export function addTimeLayer(theme: PopupTheme): Partial<PopupTheme> | null {
  const layers = [...(theme.layers ?? migrateLegacyLayerStack(theme))]
  if (layers.some((l) => l.kind === 'bindingTime')) return null
  const L: BindingTimeThemeLayer = { id: POPUP_LAYER_BINDING_TIME_ID, kind: 'bindingTime', visible: true }
  layers.push(L)
  return { layers }
}

export function addDateLayer(theme: PopupTheme): Partial<PopupTheme> | null {
  const layers = [...(theme.layers ?? migrateLegacyLayerStack(theme))]
  if (layers.some((l) => l.kind === 'bindingDate')) return null
  const L: BindingDateThemeLayer = { id: POPUP_LAYER_BINDING_DATE_ID, kind: 'bindingDate', visible: true }
  layers.push(L)
  const patch: Partial<PopupTheme> = { layers }
  if (!theme.dateTransform) {
    patch.dateTransform = { x: 50, y: 65, rotation: 0, scale: 1 }
  }
  if (theme.dateFontSize == null) {
    patch.dateFontSize = 72
  }
  if (theme.dateColor == null) {
    patch.dateColor = theme.timeColor || '#e2e8f0'
  }
  return patch
}

export function addImageDecorationLayer(theme: PopupTheme, imagePath: string): Partial<PopupTheme> | null {
  const layers = [...(theme.layers ?? migrateLegacyLayerStack(theme))]
  if (countKind(layers, 'image') >= MAX_DECORATION_IMAGE_LAYERS) return null
  const L: ImageThemeLayer = {
    id: newDecoId('img'),
    kind: 'image',
    visible: true,
    imagePath,
    transform: defaultImageTransform(),
    objectFit: 'contain',
  }
  layers.push(L)
  return { layers }
}

/** 一次从栈中移除多个图层（与图层栏 × 多次删除结果一致，便于撤销为单步时可由调用方拆步） */
export function removeThemeLayers(theme: PopupTheme, layerIds: string[]): Partial<PopupTheme> | null {
  if (!layerIds.length) return null
  const cur = theme.layers ?? migrateLegacyLayerStack(theme)
  const drop = new Set(layerIds.filter((id) => typeof id === 'string' && id.length > 0))
  if (drop.size === 0) return null
  const layers = cur.filter((l) => !drop.has(l.id))
  if (layers.length === cur.length) return null
  return { layers }
}

export function removeThemeLayer(theme: PopupTheme, layerId: string): Partial<PopupTheme> | null {
  return removeThemeLayers(theme, [layerId])
}

export function addBackgroundLayer(theme: PopupTheme): Partial<PopupTheme> | null {
  const cur = [...(theme.layers ?? migrateLegacyLayerStack(theme))]
  if (cur.some((l) => l.id === POPUP_LAYER_BACKGROUND_ID && l.kind === 'background')) return null
  cur.unshift({ id: POPUP_LAYER_BACKGROUND_ID, kind: 'background', visible: true })
  return { layers: cur }
}

export function addOverlayLayer(theme: PopupTheme): Partial<PopupTheme> | null {
  const cur = [...(theme.layers ?? migrateLegacyLayerStack(theme))]
  if (cur.some((l) => l.id === POPUP_LAYER_OVERLAY_ID && l.kind === 'overlay')) return null
  const bgIdx = cur.findIndex((l) => l.kind === 'background')
  const insertAt = bgIdx >= 0 ? bgIdx + 1 : 0
  cur.splice(insertAt, 0, { id: POPUP_LAYER_OVERLAY_ID, kind: 'overlay', visible: theme.overlayEnabled !== false })
  return { layers: cur }
}

/** @deprecated 使用 removeThemeLayer */
export function removeDecorationLayer(theme: PopupTheme, layerId: string): Partial<PopupTheme> | null {
  return removeThemeLayer(theme, layerId)
}

export function updateTextLayer(theme: PopupTheme, layerId: string, patch: Partial<TextThemeLayer>): Partial<PopupTheme> | null {
  const layers = (theme.layers ?? migrateLegacyLayerStack(theme)).map((l) => {
    if (l.id !== layerId || l.kind !== 'text') return l
    return { ...l, ...patch } as TextThemeLayer
  })
  return { layers }
}

export function updateDecorationLayer(
  theme: PopupTheme,
  layerId: string,
  patch: Partial<TextThemeLayer> | Partial<ImageThemeLayer>,
): Partial<PopupTheme> | null {
  const layers = (theme.layers ?? migrateLegacyLayerStack(theme)).map((l) => {
    if (l.id !== layerId) return l
    if (l.kind === 'text' || l.kind === 'image') {
      return { ...l, ...patch } as PopupThemeLayer
    }
    return l
  })
  return { layers }
}

/** 将绑定文本层写回主题根字段，便于旧逻辑/子项 previewContentText 同步 */
export function themePatchFromBindingTextLayer(layer: TextThemeLayer): Partial<PopupTheme> {
  if (!layer.bindsReminderBody) return {}
  const te = layer.textEffects
  return {
    previewContentText: layer.text,
    contentColor: layer.color,
    contentFontSize: layer.fontSize,
    contentFontWeight: layer.fontWeight,
    contentTextAlign: layer.textAlign,
    contentTextVerticalAlign: layer.textVerticalAlign,
    contentLetterSpacing: layer.letterSpacing,
    contentLineHeight: layer.lineHeight,
    contentFontFamilyPreset: layer.fontFamilyPreset,
    contentFontFamilySystem: layer.fontFamilySystem,
    contentTransform: layer.transform,
    ...(te ? { contentTextEffects: te } : {}),
  }
}

export function bindingLayerVisible(theme: PopupTheme, kind: 'bindingContent' | 'bindingTime'): boolean {
  if (kind === 'bindingTime') {
    const L = theme.layers?.find((l) => l.id === POPUP_LAYER_BINDING_TIME_ID && l.kind === 'bindingTime')
    return L ? L.visible !== false : true
  }
  const L = theme.layers?.find((l) => l.id === POPUP_LAYER_BINDING_CONTENT_ID && l.kind === 'text') as TextThemeLayer | undefined
  return L ? L.visible !== false && L.bindsReminderBody : true
}
