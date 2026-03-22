import React, { useRef, useCallback, useMemo, useLayoutEffect, useState, useEffect } from 'react'
import { flushSync } from 'react-dom'
import Moveable from 'react-moveable'
import type { PopupTheme, TextTransform } from '../types'
import { rendererSafePreviewImageUrl } from '../utils/popupThemePreview'
import { layerTextEffectsReactStyle } from '../../../shared/popupTextEffects'
import { resolvePopupFontFamilyCss, resolveDecoFontFamilyCss } from '../../../shared/popupThemeFonts'
import { ensureThemeLayers } from '../../../shared/settings'
import type { ImageThemeLayer, TextThemeLayer } from '../../../shared/popupThemeLayers'
import { updateDecorationLayer } from '../../../shared/popupThemeLayers'

export type TextElementKey = 'content' | 'time' | 'countdown'

interface ThemePreviewEditorProps {
  theme: PopupTheme
  onUpdateTheme: (themeId: string, patch: Partial<PopupTheme>) => void
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

/** 元素 AABB 四角相对黑底预览容器左上角的像素坐标（与 Moveable 校正 translate 一致） */
type ScaleFixedCorner = 'tl' | 'tr' | 'bl' | 'br'

function getBoxCornerInContainer(er: DOMRect, cr: DOMRect, corner: ScaleFixedCorner): { x: number; y: number } {
  const l = er.left - cr.left
  const t = er.top - cr.top
  const r = er.right - cr.left
  const b = er.bottom - cr.top
  switch (corner) {
    case 'tl':
      return { x: l, y: t }
    case 'tr':
      return { x: r, y: t }
    case 'bl':
      return { x: l, y: b }
    case 'br':
      return { x: r, y: b }
  }
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
/** Moveable 把手/连线等在 .moveable-control-box 内；点击时会抢走 contentEditable 焦点 */
function isThemePreviewMoveableChrome(node: EventTarget | null): boolean {
  if (!node || !(node instanceof HTMLElement)) return false
  return Boolean(node.closest('.moveable-control-box'))
}

function snapRotateInFullTransform(css: string, inputEvent: MouseEvent | TouchEvent | null): string {
  if (!inputEvent || !(inputEvent as MouseEvent).shiftKey) return css
  const m = /rotate\(\s*([-\d.]+)deg\s*\)/.exec(css)
  if (!m || m.index === undefined) return css
  const r = parseFloat(m[1])
  const snapped = Math.round(r / 15) * 15
  return css.slice(0, m.index) + `rotate(${snapped}deg)` + css.slice(m.index + m[0].length)
}

/** 主文案：单行固有宽 ≤ 画布此比例时栏宽贴内容；超出则栏宽锁为此比例并在框内换行；拉框可宽于此上限，至 CONTENT_TEXT_BOX_CAP_RATIO */
const CONTENT_TEXT_INLINE_MAX_RATIO = 0.6
const CONTENT_TEXT_BOX_CAP_RATIO = 0.96

/** 与 liveSnap / useMemo 依赖稳定：勿每轮渲染 new 新数组，否则小窗预览会跟着时钟抖动 */
const DEFAULT_EDITABLE_CONTENT_ONLY: TextElementKey[] = ['content']
/** 仅主文案可预览内双击编辑；时间层仅 Moveable 变换（与真实弹窗一致） */
const DEFAULT_EDITABLE_ALL_LAYERS: TextElementKey[] = ['content']

/** 结束 / 休息壁纸共用同一套默认层变换，仅 `target` 决定子项关联用途 */
export const DEFAULT_LAYER_TRANSFORMS: Record<TextElementKey, TextTransform> = {
  content: { x: 50, y: 42, rotation: 0, scale: 1 },
  /** 时间单行：不设 textBoxHeightPct，高度随字行高，避免预览 Moveable 上下留白过大 */
  time: { x: 50, y: 55, rotation: 0, scale: 1 },
  countdown: { x: 50, y: 70, rotation: 0, scale: 1 },
}
export const DEFAULT_TRANSFORMS: Record<'main' | 'rest', Record<TextElementKey, TextTransform>> = {
  main: DEFAULT_LAYER_TRANSFORMS,
  rest: DEFAULT_LAYER_TRANSFORMS,
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
  return theme.countdownTextAlign ?? theme.textAlign
}

function letterSpacingForKey(theme: PopupTheme, key: TextElementKey): number {
  if (key === 'content') return theme.contentLetterSpacing ?? 0
  if (key === 'time') return theme.timeLetterSpacing ?? 0
  return theme.countdownLetterSpacing ?? 0
}

function lineHeightForKey(theme: PopupTheme, key: TextElementKey): number {
  if (key === 'content') return theme.contentLineHeight ?? 1.35
  if (key === 'time') return theme.timeLineHeight ?? 1.35
  return theme.countdownLineHeight ?? 1
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
}: ThemePreviewEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const decoRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const contentRef = useRef<HTMLDivElement>(null)
  const timeRef = useRef<HTMLDivElement>(null)
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

  const [editingDecoLayerId, setEditingDecoLayerId] = useState<string | null>(null)
  const editingDecoLayerIdRef = useRef<string | null>(null)
  editingDecoLayerIdRef.current = editingDecoLayerId
  /** 避免：点空白 blur 后同一次点击又执行 onSelectElements([]) 清掉选中 */
  const justExitedTextEditRef = useRef(false)
  /** 捕获阶段：指针落在 Moveable 控件上（先于 contentEditable 的 blur） */
  const moveableChromePointerDownRef = useRef(false)
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
  const fallbackPreviewScale = Math.min(1, 920 / Math.max(1, previewViewportWidth))
  const previewScale =
    previewContainerWidth > 1
      ? Math.min(1, previewContainerWidth / Math.max(1, previewViewportWidth))
      : fallbackPreviewScale
  const toPreviewPx = (px: number) => Math.max(1, px * previewScale)

  /** 预览用逻辑字号：与松手缩放烘焙一致用整数 px，避免先小数再 floor/归一化导致轻微跳变 */
  const contentFontPx = Math.max(1, Math.min(8000, Math.round(theme.contentFontSize ?? 180)))
  const timeFontPx = Math.max(1, Math.min(8000, Math.round(theme.timeFontSize ?? 100)))
  const countdownFontPx = Math.max(1, Math.min(8000, Math.round(theme.countdownFontSize ?? 180)))

  const getTransform = useCallback((key: TextElementKey): TextTransform => {
    const t = key === 'content' ? theme.contentTransform : key === 'time' ? theme.timeTransform : theme.countdownTransform
    return t ?? DEFAULT_LAYER_TRANSFORMS[key] ?? { x: 50, y: 50, rotation: 0, scale: 1 }
  }, [theme.contentTransform, theme.timeTransform, theme.countdownTransform])

  const getTransformRef = useRef(getTransform)
  getTransformRef.current = getTransform

  const updateTransform = useCallback((key: TextElementKey, patch: Partial<TextTransform>) => {
    const current = getTransform(key)
    const field = key === 'content' ? 'contentTransform' : key === 'time' ? 'timeTransform' : 'countdownTransform'
    onUpdateTheme(theme.id, { [field]: { ...current, ...patch } })
  }, [getTransform, onUpdateTheme, theme.id])

  const getTargetRef = useCallback((key: TextElementKey | null) => {
    if (key === 'content') return contentRef
    if (key === 'time') return timeRef
    return null
  }, [])

  const elementGuidelineRefs = useCallback(() => {
    const refs: HTMLDivElement[] = []
    if (contentRef.current && !selectedElements.includes('content')) refs.push(contentRef.current)
    if (timeRef.current && !selectedElements.includes('time')) refs.push(timeRef.current)
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
  }, [selectedElements, selectedDecorationLayerId, theme])

  const handleElementClick = useCallback((key: TextElementKey, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingDecoLayerId(null)
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

  const bgImageKey = ((theme.imageSourceType === 'folder' ? theme.imageFolderFiles?.[0] : theme.imagePath) ?? '').trim()
  const bgImageUrl = rendererSafePreviewImageUrl(bgImageKey, previewImageUrlMap)
  const hasBgImage = theme.backgroundType === 'image' && (theme.imagePath || (theme.imageFolderFiles && theme.imageFolderFiles.length > 0))

  const getDisplayText = useCallback(
    (key: TextElementKey, fallback: string) => {
      const pl = previewLabels?.[key]
      if (key === 'content') {
        if (pl != null && pl !== '') return pl
        if (theme.previewContentText?.trim()) return theme.previewContentText.trim()
        return fallback
      }
      if (key === 'time') {
        if (theme.previewTimeText?.trim()) return theme.previewTimeText.trim()
        if (pl != null && pl !== '') return pl
        return fallback
      }
      if (theme.previewCountdownText?.trim()) return theme.previewCountdownText.trim()
      if (pl != null && pl !== '') return pl
      return fallback
    },
    [previewLabels, theme.previewContentText, theme.previewTimeText, theme.previewCountdownText],
  )

  const textLayerPairs = useMemo((): { key: TextElementKey; ref: React.RefObject<HTMLDivElement | null> }[] => {
    return [
      { key: 'content', ref: contentRef },
      { key: 'time', ref: timeRef },
    ]
  }, [])

  const multiSelected = selectedElements.length >= 2

  const getFontWeight = useCallback((key: TextElementKey): number => {
    if (key === 'content') return theme.contentFontWeight ?? 600
    if (key === 'time') return theme.timeFontWeight ?? 400
    return theme.countdownFontWeight ?? 700
  }, [theme.contentFontWeight, theme.timeFontWeight, theme.countdownFontWeight])

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
      const pending = pendingMoveablePatchRef.current
      if (Object.keys(pending).length > 0) {
        const patch = { ...pending }
        pendingMoveablePatchRef.current = {}
        mergeStyleTransforms(patch)
      }
      const decoP = pendingDecoMoveablePatchRef.current
      if (Object.keys(decoP).length > 0) {
        const dp = { ...decoP }
        pendingDecoMoveablePatchRef.current = {}
        setDecoStyleTransformById((prev) => ({ ...prev, ...dp }))
      }
      moveableRef.current?.updateRect()
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
    setDecoStyleTransformById((prev) => {
      const keys = new Set([...Object.keys(prev), ...Object.keys(next)])
      let same = true
      for (const id of keys) {
        if ((prev[id] ?? '') !== (next[id] ?? '')) {
          same = false
          break
        }
      }
      if (same) return prev
      return { ...prev, ...next }
    })
  }, [theme])

  // 从 theme 同步 transform（layout 后立刻算 + 延后两帧再算，覆盖首帧尺寸未稳定）
  useLayoutEffect(() => {
    if (transformSyncLocked) return
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
  }, [transformSyncLocked, recomputeStyleTransformsFromTheme, recomputeDecoStyleTransformsFromTheme, contentFontPx, timeFontPx, countdownFontPx,
    theme.contentFontWeight, theme.timeFontWeight, theme.countdownFontWeight, theme.textAlign,
    theme.contentTextAlign, theme.timeTextAlign, theme.countdownTextAlign,
    theme.contentLetterSpacing, theme.timeLetterSpacing, theme.countdownLetterSpacing,
    theme.contentLineHeight, theme.timeLineHeight, theme.countdownLineHeight,
    theme.contentFontSize, theme.timeFontSize, theme.countdownFontSize,
    previewScale,
    theme.contentTransform, theme.timeTransform, theme.countdownTransform, theme.target,
    theme.popupFontFamilyPreset,
    theme.popupFontFamilySystem,
    theme.contentFontFamilyPreset,
    theme.contentFontFamilySystem,
    theme.timeFontFamilyPreset,
    theme.timeFontFamilySystem,
    theme.countdownFontFamilyPreset,
    theme.countdownFontFamilySystem,
    theme.contentTextEffects, theme.timeTextEffects, theme.countdownTextEffects, theme.layers])

  /** 首帧/比例切换后同步测量预览盒宽度（供 previewScale） */
  useLayoutEffect(() => {
    const c = containerRef.current
    if (!c) return
    const w = Math.round(c.getBoundingClientRect().width)
    if (w > 1) setPreviewContainerWidth((prev) => (prev === w ? prev : w))
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
          if (w > 1) setPreviewContainerWidth((prev) => (prev === w ? prev : w))
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

  /** 下方参数区改字号/字重/对齐等导致目标尺寸变化时，同步 Moveable 外框（拖拽中由 applyMoveableFrame 内 updateRect） */
  useLayoutEffect(() => {
    if (transformSyncLocked) return
    if (selectedElements.length === 0 && !selectedDecorationLayerId) return
    moveableRef.current?.updateRect()
  }, [styleTransformByKey, decoStyleTransformById, contentFontPx, timeFontPx, countdownFontPx, theme.textAlign,
    theme.contentTextAlign, theme.timeTextAlign, theme.countdownTextAlign,
    theme.contentLetterSpacing, theme.timeLetterSpacing, theme.countdownLetterSpacing,
    theme.contentLineHeight, theme.timeLineHeight, theme.countdownLineHeight,
    theme.contentFontWeight, theme.timeFontWeight, theme.countdownFontWeight,
    theme.popupFontFamilyPreset,
    theme.popupFontFamilySystem,
    theme.contentFontFamilyPreset,
    theme.contentFontFamilySystem,
    theme.timeFontFamilyPreset,
    theme.timeFontFamilySystem,
    theme.countdownFontFamilyPreset,
    theme.countdownFontFamilySystem,
    theme.contentTextEffects, theme.timeTextEffects, theme.countdownTextEffects,
    selectedElements, selectedDecorationLayerId, transformSyncLocked, previewViewportWidth, popupPreviewAspect, editingTextKey])

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
        const field = key === 'content' ? 'contentTransform' : key === 'time' ? 'timeTransform' : 'countdownTransform'
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

  /** 拖动四边/四角调整文字区域后：把当前像素宽高写入 textBox*Pct，与真实弹窗 CSS 一致 */
  const finalizeResize = useCallback(
    (target: HTMLElement) => {
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
          : k === 'time'
            ? { shortLayerTextBoxLockWidth: true as const }
            : {}),
      })
      const tf = buildTransform(translateX, translateY, rotation, scale)
      mergeStyleTransforms({ [k]: tf })
      requestAnimationFrame(() => moveableRef.current?.updateRect())
    },
    [styleTransformByKey, translateToThemePercent, updateTransform, mergeStyleTransforms],
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
   * 主文案：自动栏宽（未 userSized）。短文栏宽贴内容；若单行固有宽超过画布 60%，栏宽锁 60% 并在框内换行。
   */
  const applyContentTextBoxAutoLayout = useCallback(
    (el: HTMLElement) => {
      const container = containerRef.current
      if (!container) return
      const cw = Math.max(1, container.offsetWidth)
      const ch = Math.max(1, container.offsetHeight)
      const capInlinePx = cw * CONTENT_TEXT_INLINE_MAX_RATIO
      const maxBodyPx = cw * CONTENT_TEXT_BOX_CAP_RATIO
      const pad = toPreviewPx(3) * 2
      const prev = {
        width: el.style.width,
        height: el.style.height,
        maxWidth: el.style.maxWidth,
        maxHeight: el.style.maxHeight,
        overflow: el.style.overflow,
        minHeight: el.style.minHeight,
      }
      el.style.overflow = 'visible'
      el.style.maxHeight = 'none'
      el.style.minHeight = '0'

      el.style.width = 'max-content'
      el.style.maxWidth = `${maxBodyPx}px`
      el.style.height = 'auto'
      const wRead = Math.max(1, el.offsetWidth, el.scrollWidth)
      let wIntrinsic = Math.min(wRead, maxBodyPx)

      const minWpx = Math.min(maxBodyPx, Math.max(40, toPreviewPx(24)))
      wIntrinsic = Math.max(wIntrinsic, minWpx)

      const wBoxPx = wIntrinsic <= capInlinePx + 0.5 ? wIntrinsic : capInlinePx

      el.style.width = `${wBoxPx}px`
      el.style.maxWidth = 'none'
      const hBody = Math.max(1, el.scrollHeight)

      el.style.width = prev.width
      el.style.height = prev.height
      el.style.maxWidth = prev.maxWidth
      el.style.maxHeight = prev.maxHeight
      el.style.overflow = prev.overflow
      el.style.minHeight = prev.minHeight

      const wPctMax = CONTENT_TEXT_BOX_CAP_RATIO * 100
      const wPct = Math.min(wPctMax, Math.max(5, Math.round((wBoxPx / cw) * 1000) / 10 + 0.5))
      const hPct = Math.min(100, Math.max(3, Math.round(((hBody + pad) / ch) * 1000) / 10 + 0.3))
      const cur = getTransformRef.current('content')
      if (
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
    [toPreviewPx, updateTransform],
  )

  /** 主文案失焦或 userSized：保持当前栏宽（百分比），只按 scrollHeight 更新高度 pct。 */
  const snapContentTextBoxHeightOnly = useCallback(
    (el: HTMLElement) => {
      const container = containerRef.current
      if (!container) return
      const cur = getTransformRef.current('content')
      const cw = Math.max(1, container.offsetWidth)
      const ch = Math.max(1, container.offsetHeight)
      const pad = toPreviewPx(3) * 2
      if (cur.textBoxWidthPct == null || !Number.isFinite(cur.textBoxWidthPct)) {
        applyContentTextBoxAutoLayout(el)
        return
      }
      const prev = {
        width: el.style.width,
        height: el.style.height,
        maxWidth: el.style.maxWidth,
        maxHeight: el.style.maxHeight,
        overflow: el.style.overflow,
        minHeight: el.style.minHeight,
      }
      const wPctClamped = Math.max(5, Math.min(CONTENT_TEXT_BOX_CAP_RATIO * 100, cur.textBoxWidthPct))
      const wPx = (wPctClamped / 100) * cw
      el.style.overflow = 'visible'
      el.style.maxHeight = 'none'
      el.style.minHeight = '0'
      el.style.width = `${wPx}px`
      el.style.maxWidth = 'none'
      el.style.height = 'auto'
      const hBody = Math.max(1, el.scrollHeight)

      el.style.width = prev.width
      el.style.height = prev.height
      el.style.maxWidth = prev.maxWidth
      el.style.maxHeight = prev.maxHeight
      el.style.overflow = prev.overflow
      el.style.minHeight = prev.minHeight

      const hPct = Math.min(100, Math.max(3, Math.round(((hBody + pad) / ch) * 1000) / 10 + 0.3))
      if (cur.textBoxHeightPct != null && Math.abs(cur.textBoxHeightPct - hPct) < 0.35) return
      updateTransform('content', { textBoxHeightPct: hPct })
      requestAnimationFrame(() => moveableRef.current?.updateRect())
    },
    [toPreviewPx, updateTransform, applyContentTextBoxAutoLayout],
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
      if (k !== 'time') return
      const container = containerRef.current
      if (!container) return
      const cw = Math.max(1, container.offsetWidth)
      const ch = Math.max(1, container.offsetHeight)
      /** 与 JSX 中 `padding: toPreviewPx(3)` 一致：四边同值，量宽/高时用 2×边距 */
      const padEdge = toPreviewPx(3)
      const pad2 = padEdge * 2
      const maxBodyPx = Math.max(1, cw * CONTENT_TEXT_BOX_CAP_RATIO)
      const prev = {
        width: el.style.width,
        height: el.style.height,
        maxWidth: el.style.maxWidth,
        maxHeight: el.style.maxHeight,
        overflow: el.style.overflow,
        minHeight: el.style.minHeight,
      }
      el.style.overflow = 'visible'
      el.style.maxHeight = 'none'
      el.style.minHeight = '0'

      el.style.width = 'max-content'
      el.style.maxWidth = `${maxBodyPx}px`
      el.style.height = 'auto'
      const wRead = Math.max(1, el.offsetWidth, el.scrollWidth)

      const fontPx = timeFontPx
      const previewFont = toPreviewPx(fontPx)
      const raw = (el.textContent ?? '').replace(/\u00a0/g, ' ')
      const longestLine = raw.split(/\n/).reduce((m, line) => Math.max(m, line.length), 0) || 1
      /** 时间与倒计时同一套：按字数估宽 + 对称 pad，避免时间用 7em、倒计时用 5em 导致左右留白不一致 */
      const charW = previewFont * 0.58
      const minFromChars = longestLine * charW + pad2
      const minFloor = previewFont * 1.35 + pad2
      const wIntrinsic = Math.min(maxBodyPx, Math.max(wRead, minFromChars, minFloor))

      el.style.width = `${wIntrinsic}px`
      el.style.maxWidth = 'none'
      const hBody = Math.max(1, el.scrollHeight)

      el.style.width = prev.width
      el.style.height = prev.height
      el.style.maxWidth = prev.maxWidth
      el.style.maxHeight = prev.maxHeight
      el.style.overflow = prev.overflow
      el.style.minHeight = prev.minHeight

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
    [toPreviewPx, updateTransform, timeFontPx],
  )

  const syncContentPreviewTextBoxRef = useRef(syncContentPreviewTextBox)
  syncContentPreviewTextBoxRef.current = syncContentPreviewTextBox

  /**
   * 仅主文案变化才触发 content textBox 的 liveSnap。
   * 切勿把 time/countdown 的 preview* 或 previewLabels 打进同一 sig：否则改倒计时文案、子项里时间每秒走表
   * 会误跑 syncContentPreviewTextBox，与短层操作叠在一起 → 主文案框高度被多算、操作框底部异常延伸。
   */
  const contentSnapLabelSig = useMemo(() => {
    if (!effectiveEditableKeys.includes('content')) return ''
    return `c:${previewLabels?.content ?? ''}|${theme.previewContentText ?? ''}`
  }, [effectiveEditableKeys, previewLabels?.content, theme.previewContentText])

  /**
   * 外部改主文案时同步栏宽/高；时间每秒变不参与 snap（固定框）。用 ref 判断编辑态，避免与 blur 重复。
   * 勿依赖 selectedElements：取消选中时会误再跑一遍 sync，与 blur 双 rAF 叠加以致 textBox 高度被多算一行、文字上移。
   * Moveable.updateRect 见下方仅随选中/样式变的 effect。
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
    })
    return () => cancelAnimationFrame(id)
  }, [readOnly, contentSnapLabelSig, effectiveEditableKeys])

  /**
   * 角点等比缩放松手后：把 CSS scale 乘进主题字号并 reset scale→1，这样「缩放=改字号」且外框与文字度量一致；
   * 避免仅 transform 缩放导致面板里字号不变、框与字间距别扭。
   */
  const finalizeScaleBakesFontSize = useCallback(
    (el: HTMLElement | SVGElement) => {
      if (!(el instanceof HTMLElement)) return
      if (el.dataset.decoLayerId) {
        finalizeDecorationTransform(el)
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
      const baseContentPx = Math.max(1, Math.min(8000, Math.round(theme.contentFontSize ?? 180)))
      const baseTimePx = Math.max(1, Math.min(8000, Math.round(theme.timeFontSize ?? 100)))
      const baseCountdownPx = Math.max(1, Math.min(8000, Math.round(theme.countdownFontSize ?? 180)))
      const fontPatch: Partial<PopupTheme> = {}
      if (k === 'content') {
        fontPatch.contentFontSize = Math.max(1, Math.min(8000, Math.round(baseContentPx * ratio)))
      } else if (k === 'time') {
        fontPatch.timeFontSize = Math.max(1, Math.min(8000, Math.round(baseTimePx * ratio)))
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
      const field = k === 'content' ? 'contentTransform' : k === 'time' ? 'timeTransform' : 'countdownTransform'
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
      theme.countdownFontSize,
      getTransform,
      onUpdateTheme,
      mergeStyleTransforms,
      styleTransformByKey,
      finalizeElement,
      finalizeDecorationTransform,
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
    if (e.target === containerRef.current || t.dataset?.layer === 'bg') {
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
      onSelectElements([])
      onSelectDecorationLayer?.(null)
    }
  }, [readOnly, onSelectElements, getTargetRef, onSelectDecorationLayer])

  const handleContainerMouseDown = useCallback((e: React.MouseEvent) => {
    if (readOnly) return
    const hit = e.target as HTMLElement
    if (hit !== containerRef.current && hit.dataset?.layer !== 'bg') return
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
        onSelectElements(hits)
        onSelectDecorationLayer?.(null)
      }
      setMarqueeRect(null)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [readOnly, textLayerPairs, getTransform, onSelectElements, getTargetRef, onSelectDecorationLayer])

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

    const fieldOf = (k: TextElementKey) => k === 'content' ? 'contentTransform' : k === 'time' ? 'timeTransform' : 'countdownTransform'
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

  /** 编辑文字时仍保留 Moveable，便于同时拖动 / 旋转 / 缩放 / 调文字框（把手在文字块外侧） */
  const moveableTargets = useMemo(() => {
    if (selectedDecorationLayerId) {
      if (editingDecoLayerId && selectedDecorationLayerId === editingDecoLayerId) return []
      const el = decoRefs.current[selectedDecorationLayerId]
      return el ? [el] : []
    }
    return selectedElements
      .map((k) => getTargetRef(k)?.current)
      .filter((e): e is HTMLDivElement => e != null)
  }, [selectedElements, selectedDecorationLayerId, getTargetRef, decoStyleTransformById, theme.layers, editingDecoLayerId])

  const moveableTarget = useMemo(
    () => moveableTargets.length === 1 ? moveableTargets[0] : moveableTargets,
    [moveableTargets],
  )

  const resizableEnabled = moveableTargets.length === 1
  const moveableKey = useMemo(() => {
    if (selectedDecorationLayerId) {
      return `deco:${selectedDecorationLayerId}|${editingTextKey ?? ''}|${editingDecoLayerId ?? ''}|tf`
    }
    const rb =
      resizableEnabled &&
      editingTextKey != null &&
      selectedElements.length === 1 &&
      selectedElements[0] === editingTextKey
    return `${selectedElements.slice().sort().join(',')}|${editingTextKey ?? ''}|${rb ? 'box' : 'tf'}`
  }, [selectedDecorationLayerId, selectedElements, editingTextKey, resizableEnabled, editingDecoLayerId])
  /** 仅在「文字编辑态」显示四边/四角拉框，写入 textBoxWidthPct/HeightPct；预览态只用等比缩放（scalable）变换整块 */
  const resizableForTextBounds =
    resizableEnabled &&
    editingTextKey != null &&
    selectedElements.length === 1 &&
    selectedElements[0] === editingTextKey

  /** 与黑底预览容器对齐：拖拽/缩放/拉框边缘不可超出画幅（Moveable Snappable bounds） */
  const previewMoveableBounds = useMemo(
    () => ({ position: 'css' as const, left: 0, top: 0, right: 0, bottom: 0 }),
    [],
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

  const editSessionRef = useRef<TextElementKey | null>(null)
  useLayoutEffect(() => {
    if (!editingTextKey) {
      editSessionRef.current = null
      return
    }
    const el = getTargetRef(editingTextKey)?.current
    if (!el) return
    if (editSessionRef.current !== editingTextKey) {
      editSessionRef.current = editingTextKey
      const defaults: Record<TextElementKey, string> = { content: '文本', time: '12:00', countdown: '5' }
      el.textContent = getDisplayText(editingTextKey, defaults[editingTextKey] ?? '')
    }
    requestAnimationFrame(() => {
      const node = getTargetRef(editingTextKey)?.current
      if (!node || document.activeElement === node) return
      node.focus()
      const range = document.createRange()
      range.selectNodeContents(node)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    })
  }, [editingTextKey, getTargetRef, getDisplayText])

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
      el.textContent = td.text ?? ''
    }
    requestAnimationFrame(() => {
      const node = decoRefs.current[editingDecoLayerId]
      if (!node || document.activeElement === node) return
      node.focus()
      const range = document.createRange()
      range.selectNodeContents(node)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    })
  }, [editingDecoLayerId, theme])

  useEffect(() => {
    if (!editingDecoLayerId) return
    if (selectedDecorationLayerId !== editingDecoLayerId) setEditingDecoLayerId(null)
  }, [selectedDecorationLayerId, editingDecoLayerId])

  useEffect(() => {
    if (!editingTextKey) {
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
      if (!containerRef.current?.contains(t)) return
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
  }, [editingTextKey])

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
    const inSel = selectedElements.includes(key)
    const multi = selectedElements.length >= 2
    if (multi && inSel) {
      flushSync(() => {
        onSelectStructuralLayer?.(null)
        onSelectDecorationLayer?.(null)
      })
      scheduleDragStart(e.nativeEvent)
      return
    }
    if (!inSel || selectedElements.length !== 1 || selectedElements[0] !== key) {
      flushSync(() => {
        onSelectStructuralLayer?.(null)
        onSelectDecorationLayer?.(null)
        onSelectElements([key])
      })
    }
    scheduleDragStart(e.nativeEvent)
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
  ])

  const renderTextLayerForKey = (layerId: string, key: TextElementKey, zi: number): React.ReactNode => {
    const ref = getTargetRef(key)!
    const label = key === 'content' ? '文本' : key === 'time' ? '12:00' : '5:00'
    const fontSize = key === 'content' ? contentFontPx : key === 'time' ? timeFontPx : countdownFontPx
    const color = key === 'content' ? theme.contentColor : key === 'countdown' ? (theme.countdownColor || theme.timeColor) : theme.timeColor
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
    const shortLineLayer = key === 'time'
    const shortLayerLockW = shortLineLayer && tform.shortLayerTextBoxLockWidth === true
    const shortLayerFlexJustify = ta === 'left' ? 'flex-start' : ta === 'right' ? 'flex-end' : 'center'
    return (
      <div
        key={layerId}
        ref={ref as React.RefObject<HTMLDivElement>}
        data-element-key={key}
        contentEditable={isEditing}
        suppressContentEditableWarning
        className={`absolute ${readOnly ? 'cursor-default' : isEditing ? 'cursor-text select-text ring-2 ring-indigo-400/90' : 'cursor-move'} rounded-sm`}
        style={{
          left: 0, top: 0,
          transform: tf,
          transformOrigin: 'center',
          /** 时间层叠在文本层之上且区域常重叠；未选中时间时让点击穿透，避免双击落在时间层上无法进入文本编辑 */
          ...(key === 'time'
            ? { pointerEvents: selectedElements.includes('time') ? ('auto' as const) : ('none' as const) }
            : {}),
          willChange: selectedElements.includes(key) ? 'transform' : undefined,
          color, fontSize: `${toPreviewPx(fontSize)}px`, fontWeight: getFontWeight(key),
          lineHeight: lh, textAlign: ta,
          letterSpacing: `${toPreviewPx(ls)}px`,
          zIndex: zi,
          padding: `${toPreviewPx(3)}px`,
          ...(shortLineLayer
            ? {
                display: 'flex',
                alignItems: 'center',
                justifyContent: shortLayerFlexJustify,
                /** 单行时间：行高贴字高，减少 flex 行盒上下「空行」导致操作框纵向变宽 */
                lineHeight: 1,
              }
            : {}),
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
                  maxWidth: bw != null && Number.isFinite(bw) ? `${Math.min(96, Math.max(5, bw))}%` : '96%',
                  boxSizing: 'border-box' as const,
                }
            : bw != null && Number.isFinite(bw)
              ? { width: `${bw}%`, maxWidth: '100%', boxSizing: 'border-box' as const }
              : { maxWidth: '96%' }),
          ...(shortLineLayer
            ? bh != null && Number.isFinite(bh) && isEditing
              ? { minHeight: `${bh}%`, height: 'auto', maxHeight: '100%', overflow: 'hidden' as const }
              : {
                  height: 'auto' as const,
                  maxHeight:
                    bh != null && Number.isFinite(bh)
                      ? `${Math.min(100, Math.max(3, bh))}%`
                      : '100%',
                  overflow: 'hidden' as const,
                }
            : bh != null && Number.isFinite(bh)
              ? isEditing
                ? { minHeight: `${bh}%`, height: 'auto', maxHeight: '100%', overflow: 'visible' as const }
                : { height: `${bh}%`, maxHeight: '100%', overflow: 'visible' as const }
              : {}),
          whiteSpace: (shortLineLayer ? 'nowrap' : 'pre-wrap') as 'nowrap' | 'pre-wrap',
          wordWrap: (shortLineLayer ? 'normal' : 'break-word') as 'normal' | 'break-word',
          overflowWrap: (shortLineLayer ? 'normal' : 'break-word') as 'normal' | 'break-word',
          ...(shortLineLayer ? {} : { wordBreak: 'keep-all' as const }),
        }}
        onMouseDownCapture={(e) => {
          if (e.button !== 0) return
          if (!canEditText) return
          if (key === 'time') return
          if (e.detail === 2) {
            e.preventDefault()
            e.stopPropagation()
            flushSync(() => onSelectElements([key]))
            setEditingTextKey(key)
          }
        }}
        onMouseDown={(e) => handleTextPointerDown(key, e)}
        onClick={(e) => handleElementClick(key, e)}
        onInput={
          isEditing
            ? () => {
                requestAnimationFrame(() => {
                  const node = getTargetRef(key)?.current
                  if (node && key === 'content') {
                    const tr = getTransformRef.current('content')
                    if (tr.contentTextBoxUserSized === true) snapContentTextBoxHeightOnly(node)
                    else applyContentTextBoxAutoLayout(node)
                  }
                  moveableRef.current?.updateRect()
                })
              }
            : undefined
        }
        onBlur={(ev: React.FocusEvent<HTMLDivElement>) => {
          if (!isEditing) return
          const keepEditing =
            moveableChromePointerDownRef.current || isThemePreviewMoveableChrome(ev.relatedTarget)
          if (keepEditing) {
            requestAnimationFrame(() => {
              if (editingTextKeyRef.current !== key) return
              getTargetRef(key)?.current?.focus()
            })
            return
          }
          const elBlur = ref.current
          const text = (elBlur?.textContent ?? '').replace(/\u00a0/g, ' ').replace(/\n+$/g, '')
          if (onLiveTextCommit) onLiveTextCommit(key, text)
          else if (key === 'content') onUpdateTheme(theme.id, { previewContentText: text })
          else if (key === 'time') onUpdateTheme(theme.id, { previewTimeText: text })
          else onUpdateTheme(theme.id, { previewCountdownText: text })
          setEditingTextKey(null)
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              const node = getTargetRef(key)?.current
              if (!node) return
              if (key === 'content') snapContentTextBoxHeightOnly(node)
              else {
                const tf0 = getTransformRef.current(key)
                if (tf0.textBoxWidthPct == null || tf0.textBoxHeightPct == null) {
                  snapShortLayerTightContent(key, node)
                }
              }
            })
          })
        }}
        onKeyDown={(e) => {
          if (!isEditing) return
          if (e.key === 'Escape') {
            e.preventDefault()
            setEditingTextKey(null)
            void ref.current?.blur()
          }
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            void ref.current?.blur()
          }
        }}
      >
        {!isEditing ? displayText : null}
      </div>
    )
  }

  const outerWrapClass =
    !showToolbar ? 'w-full' : outerChrome === 'none' ? 'w-full min-w-0' : 'rounded-md border border-slate-200 bg-white p-2'
  const previewBoxClass = fixedPreviewPixelSize
    ? 'relative overflow-hidden rounded border border-slate-300 bg-black'
    : previewWidthMode === 'fill'
      ? 'relative w-full max-w-full overflow-hidden rounded border border-slate-300 bg-black'
      : showToolbar
        ? 'relative mx-auto w-full max-w-[920px] overflow-hidden rounded border border-slate-300 bg-black'
        : 'relative w-full max-w-full overflow-hidden rounded border border-slate-300 bg-black'

  return (
    <div className={outerWrapClass}>
      {showToolbar && (
        <>
          <p className="mb-1.5 px-1 text-[10px] leading-relaxed text-slate-500">
            <strong className="text-slate-600">预览态</strong>：仅<strong className="text-slate-600">四角</strong>等比缩放（拖某角则锚定<strong className="text-slate-600">对角</strong>；按住 <kbd className="rounded border border-slate-300 bg-slate-50 px-0.5 font-mono text-[9px]">Ctrl</kbd> 为<strong className="text-slate-600">中心点</strong>），松手后<strong className="text-slate-600">字号写入主题</strong>；绑定<strong className="text-slate-600">文本</strong>层与装饰<strong className="text-slate-600">文本</strong>层可双击改字，时间层仅拖拽缩放（双击不进入改字）。双击文本层后出现四边拉框。选中层后可用<strong className="text-slate-600">方向键</strong>按预览逻辑像素平移 1px（焦点在面板内且非输入框时）。文本层未手调框时：栏宽约 ≤60% 画布则贴字边，超出则锁 60% 换行；手拉后可更宽（至约 96%）；失焦后在<strong className="text-slate-600">当前宽度</strong>下自动增高包全文。
          </p>
          <div className="mb-1.5 flex items-center gap-0.5 px-1">
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
        </>
      )}

      <div ref={containerRef}
        className={`${previewBoxClass} ${editingTextKey || editingDecoLayerId ? '' : 'select-none'} ${readOnly ? 'pointer-events-none' : ''}`}
        style={
          fixedPreviewPixelSize
            ? { width: fixedPreviewPixelSize.width, height: fixedPreviewPixelSize.height }
            : { aspectRatio: popupPreviewAspect === '16:9' ? '16 / 9' : '4 / 3' }
        }
        onClick={handleContainerClick} onMouseDown={handleContainerMouseDown}>

        {(ensureThemeLayers(theme).layers ?? []).map((L, i) => {
          const zi = i + 1
          if (!L.visible) return null
          switch (L.kind) {
            case 'background':
              return (
                <div
                  key={L.id}
                  className="absolute inset-0"
                  data-layer="bg"
                  style={{
                    zIndex: zi,
                    background:
                      hasBgImage && bgImageUrl
                        ? `url("${bgImageUrl}") center / cover no-repeat, ${theme.backgroundColor || '#000000'}`
                        : (theme.backgroundColor || '#000000'),
                  }}
                />
              )
            case 'overlay':
              return (
                <div
                  key={L.id}
                  className="absolute inset-0 pointer-events-none"
                  data-layer="overlay"
                  style={{
                    zIndex: zi,
                    background: theme.overlayColor || '#000000',
                    opacity: theme.overlayEnabled ? Math.max(0, Math.min(1, theme.overlayOpacity ?? 0.45)) : 0,
                  }}
                />
              )
            case 'bindingTime':
              return renderTextLayerForKey(L.id, 'time', zi)
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
              return (
                <div
                  key={L.id}
                  ref={(el) => {
                    decoRefs.current[L.id] = el
                  }}
                  data-deco-layer-id={L.id}
                  contentEditable={isDecoEditing && !readOnly}
                  suppressContentEditableWarning
                  className={`absolute rounded-sm ${readOnly ? 'cursor-default' : isDecoEditing ? 'cursor-text select-text ring-2 ring-indigo-400/90' : 'cursor-move'}`}
                  style={{
                    left: 0,
                    top: 0,
                    transform: dtf,
                    transformOrigin: 'center',
                    zIndex: zi,
                    color: td.color || '#ffffff',
                    fontSize: `${toPreviewPx(fs)}px`,
                    fontWeight: td.fontWeight ?? 500,
                    lineHeight: td.lineHeight ?? 1.35,
                    textAlign: (td.textAlign ?? theme.textAlign) as 'left' | 'center' | 'right',
                    letterSpacing: `${toPreviewPx(td.letterSpacing ?? 0)}px`,
                    padding: `${toPreviewPx(3)}px`,
                    fontFamily: resolveDecoFontFamilyCss(td.fontFamilyPreset, td.fontFamilySystem),
                    maxWidth: td.transform?.textBoxWidthPct != null ? `${Math.min(96, Math.max(5, td.transform.textBoxWidthPct))}%` : '96%',
                    maxHeight: td.transform?.textBoxHeightPct != null ? `${Math.min(100, Math.max(3, td.transform.textBoxHeightPct))}%` : undefined,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'keep-all',
                    overflowWrap: 'break-word',
                    outline: 'none',
                    willChange: selectedDecorationLayerId === L.id ? 'transform' : undefined,
                    ...layerTextEffectsReactStyle(fakeTheme, 'content'),
                  }}
                  onMouseDownCapture={(e) => {
                    if (readOnly || e.button !== 0) return
                    if (e.detail === 2) {
                      e.preventDefault()
                      e.stopPropagation()
                      flushSync(() => {
                        onSelectElements([])
                        onSelectDecorationLayer?.(L.id)
                      })
                      setEditingDecoLayerId(L.id)
                    }
                  }}
                  onMouseDown={(e) => {
                    if (readOnly || e.button !== 0) return
                    if (e.shiftKey) return
                    if (e.detail >= 2) return
                    if (editingDecoLayerId === L.id) return
                    e.stopPropagation()
                    flushSync(() => {
                      onSelectElements([])
                      onSelectDecorationLayer?.(L.id)
                    })
                    scheduleDragStart(e.nativeEvent)
                  }}
                  onBlur={(ev) => {
                    if (!isDecoEditing) return
                    const keepEditing =
                      moveableChromePointerDownRef.current || isThemePreviewMoveableChrome(ev.relatedTarget)
                    if (keepEditing) {
                      requestAnimationFrame(() => {
                        if (editingDecoLayerIdRef.current !== L.id) return
                        decoRefs.current[L.id]?.focus()
                      })
                      return
                    }
                    const elBlur = decoRefs.current[L.id]
                    const text = (elBlur?.textContent ?? '').replace(/\u00a0/g, ' ').replace(/\n+$/g, '').slice(0, 2000)
                    const patch = updateDecorationLayer(theme, L.id, { text })
                    if (patch) onUpdateTheme(theme.id, patch)
                    setEditingDecoLayerId(null)
                    requestAnimationFrame(() => moveableRef.current?.updateRect())
                  }}
                  onKeyDown={(e) => {
                    if (!isDecoEditing) return
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      setEditingDecoLayerId(null)
                      decoRefs.current[L.id]?.blur()
                    }
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      decoRefs.current[L.id]?.blur()
                    }
                  }}
                >
                  {!isDecoEditing ? (td.text ?? '') : null}
                </div>
              )
            }
            case 'image': {
              const im = L as ImageThemeLayer
              const url = rendererSafePreviewImageUrl((im.imagePath ?? '').trim(), previewImageUrlMap)
              const dtf = decoStyleTransformById[L.id] ?? 'translate(0px,0px) rotate(0deg) scale(1)'
              const tw = im.transform?.textBoxWidthPct ?? 28
              const th = im.transform?.textBoxHeightPct ?? 22
              const fit = im.objectFit === 'contain' ? 'contain' : 'cover'
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
                    width: `${Math.min(96, Math.max(5, tw))}%`,
                    height: `${Math.min(100, Math.max(3, th))}%`,
                    maxWidth: '100%',
                    maxHeight: '100%',
                    boxSizing: 'border-box',
                    backgroundImage: url ? `url("${url}")` : 'none',
                    backgroundSize: fit,
                    backgroundPosition: 'center',
                    backgroundRepeat: 'no-repeat',
                    willChange: selectedDecorationLayerId === L.id ? 'transform' : undefined,
                  }}
                  onMouseDown={(e) => {
                    if (readOnly || e.button !== 0) return
                    if (e.shiftKey) return
                    e.stopPropagation()
                    flushSync(() => {
                      onSelectElements([])
                      onSelectDecorationLayer?.(L.id)
                    })
                    scheduleDragStart(e.nativeEvent)
                  }}
                />
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
            bounds={previewMoveableBounds}
            individualGroupable={false}
            useResizeObserver
            defaultGroupOrigin="50% 50%"
            draggable={true}
            rotatable={true}
            scalable={{ keepRatio: true }}
            resizable={resizableForTextBounds ? { throttleResize: 0, keepRatio: false } : false}
            snappable={true}
            snapDirections={{ top: true, left: true, bottom: true, right: true, center: true, middle: true }}
            elementSnapDirections={{ top: true, left: true, bottom: true, right: true, center: true, middle: true }}
            snapThreshold={5}
            isDisplaySnapDigit={true}
            snapGap={true}
            elementGuidelines={elementGuidelineRefs()}
            horizontalGuidelines={containerRef.current ? [containerRef.current.offsetHeight * 0.25, containerRef.current.offsetHeight * 0.5, containerRef.current.offsetHeight * 0.75] : []}
            verticalGuidelines={containerRef.current ? [containerRef.current.offsetWidth * 0.25, containerRef.current.offsetWidth * 0.5, containerRef.current.offsetWidth * 0.75] : []}
            throttleDrag={0} throttleRotate={0} throttleScale={0.01}
            rotationPosition="top"
            renderDirections={resizableForTextBounds ? ['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w'] : ['nw', 'ne', 'sw', 'se']}
            edge={false}

            onDragStart={() => { resetMoveableVisualPipeline(); setTransformSyncLocked(true) }}
            onDrag={({ target, transform }) => {
              applyMoveableFrame([{ target, transform }])
            }}
            onDragEnd={({ target, isDrag }) => {
              flushMoveableVisual('sync')
              if (isDrag) finalizeElement(target)
              setTransformSyncLocked(false)
            }}

            onRotateStart={() => { resetMoveableVisualPipeline(); setTransformSyncLocked(true) }}
            onRotate={({ target, transform, afterTransform, inputEvent }) => {
              const css = snapRotateInFullTransform(pickMoveableCssTransform({ transform, afterTransform }), inputEvent)
              applyMoveableFrame([{ target, transform: css }])
            }}
            onRotateEnd={({ target, isDrag }) => {
              flushMoveableVisual('sync')
              if (isDrag) finalizeElement(target)
              setTransformSyncLocked(false)
            }}

            onScaleStart={({ inputEvent, direction }) => {
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
                const pos = getBoxCornerInContainer(er, cr, corner)
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
                  const pos = getBoxCornerInContainer(er, cr, corner)
                  scalePinBoxRef.current = { mode: 'corner', corner, pinX: pos.x, pinY: pos.y }
                }
                pin = scalePinBoxRef.current
              }
              let dlx = 0
              let dty = 0
              if (pin.mode === 'corner') {
                const cur = getBoxCornerInContainer(er, cr, pin.corner)
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
            onScaleEnd={({ target, isDrag }) => {
              scalePinBoxRef.current = null
              scaleDirectionForPinRef.current = null
              flushMoveableVisual('sync')
              if (isDrag) finalizeScaleBakesFontSize(target)
              setTransformSyncLocked(false)
            }}

            onDragGroupStart={() => { resetMoveableVisualPipeline(); setTransformSyncLocked(true); takeSnapshots() }}
            onDragGroup={({ events }) => {
              applyMoveableFrame(events.map(ev => ({ target: ev.target, transform: ev.transform })))
            }}
            onDragGroupEnd={({ events, isDrag }) => {
              flushMoveableVisual('sync')
              if (isDrag) events.forEach(ev => finalizeElement(ev.target))
              setTransformSyncLocked(false)
            }}

            onRotateGroupStart={() => { resetMoveableVisualPipeline(); setTransformSyncLocked(true); takeSnapshots() }}
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
            onRotateGroupEnd={({ events, isDrag }) => {
              flushMoveableVisual('sync')
              if (isDrag) events.forEach(ev => finalizeElement(ev.target))
              setTransformSyncLocked(false)
            }}

            onScaleGroupStart={() => {
              resetMoveableVisualPipeline()
              setTransformSyncLocked(true)
              takeSnapshots()
              scalePinBoxRef.current = null
            }}
            onScaleGroup={({ events }) => {
              if (groupMode) {
                applyMoveableFrame(events.map(ev => ({
                  target: ev.target,
                  transform: forceUniformScaleInFullTransform(pickMoveableCssTransform(ev)),
                })))
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
            onScaleGroupEnd={({ events, isDrag }) => {
              flushMoveableVisual('sync')
              if (isDrag) events.forEach(ev => finalizeScaleBakesFontSize(ev.target))
              setTransformSyncLocked(false)
            }}

            onResizeStart={() => { resetMoveableVisualPipeline(); setTransformSyncLocked(true) }}
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
              if (e.isDrag && e.target instanceof HTMLElement) finalizeResize(e.target)
              setTransformSyncLocked(false)
            }}
          />
        )}
      </div>
    </div>
  )
}
