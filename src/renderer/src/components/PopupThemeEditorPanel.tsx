import { useRef, useEffect, useState, useCallback, useMemo, type RefObject } from 'react'
import { ThemePreviewEditor, type TextElementKey } from './ThemePreviewEditor'
import type { PopupLayerTextEffects, PopupTheme, TextTransform } from '../types'
import { usePopupThemeEditHistory, type PopupThemeEditUpdateMeta } from '../hooks/usePopupThemeEditHistory'
import {
  POPUP_TEXT_STROKE_WIDTH_MAX,
  POPUP_TEXT_SHADOW_BLUR_MAX,
  POPUP_TEXT_SHADOW_SIZE_MAX,
  POPUP_TEXT_SHADOW_DISTANCE_MAX,
} from '../../../shared/popupTextEffects'
import {
  DEFAULT_POPUP_FONT_PRESET_ID,
  POPUP_FONT_FAMILY_OPTIONS,
  type PopupTextFontLayer,
  popupFontLayerUsesSystemTab,
  popupFontPresetSelectValue,
  popupFontSystemInputValue,
} from '../../../shared/popupThemeFonts'
import { SystemFontFamilyPicker } from './SystemFontFamilyPicker'
import { PopupThemeColorSwatch } from './PopupThemeColorSwatch'
import { PopupThemeLayersBar } from './PopupThemeLayersBar'
import { POPUP_BACKGROUND_IMAGE_BLUR_MAX_PX, POPUP_FOLDER_CROSSFADE_MAX_SEC } from '../../../shared/settings'
import type { ImageThemeLayer, TextThemeLayer } from '../../../shared/popupThemeLayers'
import {
  POPUP_LAYER_BACKGROUND_ID,
  POPUP_LAYER_OVERLAY_ID,
  mergeContentThemePatchIntoBindingTextLayer,
  updateDecorationLayer,
  updateTextLayer,
} from '../../../shared/popupThemeLayers'
import { popupThemeDatePresetPatch, type PopupThemeDatePresetId } from '../../../shared/popupThemeDateFormat'

/** 本机字体为 OS 级数据，与当前编辑的 theme.id 无关。勿在 theme.id 变化时清空：会与异步 IPC 回写竞态，出现「日志里 count>0 但下拉永远空」。 */
let sharedSystemFontFamilies: string[] | null = null

function layerTypographyKeys(sel: TextElementKey): {
  align: 'contentTextAlign' | 'timeTextAlign' | 'dateTextAlign' | 'countdownTextAlign'
  verticalAlign: 'contentTextVerticalAlign' | 'timeTextVerticalAlign' | 'dateTextVerticalAlign' | 'countdownTextVerticalAlign'
  letterSpacing: 'contentLetterSpacing' | 'timeLetterSpacing' | 'dateLetterSpacing' | 'countdownLetterSpacing'
  lineHeight: 'contentLineHeight' | 'timeLineHeight' | 'dateLineHeight' | 'countdownLineHeight'
} {
  if (sel === 'content') return { align: 'contentTextAlign', verticalAlign: 'contentTextVerticalAlign', letterSpacing: 'contentLetterSpacing', lineHeight: 'contentLineHeight' }
  if (sel === 'time') return { align: 'timeTextAlign', verticalAlign: 'timeTextVerticalAlign', letterSpacing: 'timeLetterSpacing', lineHeight: 'timeLineHeight' }
  if (sel === 'date') return { align: 'dateTextAlign', verticalAlign: 'dateTextVerticalAlign', letterSpacing: 'dateLetterSpacing', lineHeight: 'dateLineHeight' }
  return { align: 'countdownTextAlign', verticalAlign: 'countdownTextVerticalAlign', letterSpacing: 'countdownLetterSpacing', lineHeight: 'countdownLineHeight' }
}

/** 主题内主提醒文案草稿（不含预览用占位），与预览双击写入同一字段 */
function bindingContentThemeDraft(theme: PopupTheme): string {
  const pct = theme.previewContentText?.trim()
  if (pct) return pct
  const tl = theme.layers?.find(
    (l): l is TextThemeLayer => l.kind === 'text' && Boolean((l as TextThemeLayer).bindsReminderBody),
  )
  return (tl?.text ?? '').trim()
}

function layerEffectsKey(sel: TextElementKey): 'contentTextEffects' | 'timeTextEffects' | 'dateTextEffects' | 'countdownTextEffects' {
  if (sel === 'content') return 'contentTextEffects'
  if (sel === 'time') return 'timeTextEffects'
  if (sel === 'date') return 'dateTextEffects'
  return 'countdownTextEffects'
}

function panelThemeTransformField(sel: TextElementKey): 'contentTransform' | 'timeTransform' | 'dateTransform' | 'countdownTransform' {
  if (sel === 'content') return 'contentTransform'
  if (sel === 'time') return 'timeTransform'
  if (sel === 'date') return 'dateTransform'
  return 'countdownTransform'
}

type HorizontalAlign = 'left' | 'center' | 'right' | 'start' | 'end' | 'justify'
type VerticalAlign = 'top' | 'middle' | 'bottom'

type OverlayPresetDirection = Exclude<NonNullable<PopupTheme['overlayGradientDirection']>, 'custom'>

const OVERLAY_DIRECTION_ANGLE_MAP: Record<OverlayPresetDirection, number> = {
  leftToRight: 90,
  rightToLeft: 270,
  topToBottom: 180,
  bottomToTop: 0,
  topLeftToBottomRight: 135,
  topRightToBottomLeft: 225,
  bottomLeftToTopRight: 45,
  bottomRightToTopLeft: 315,
}

function normalizeAngleDeg(v: number | undefined, fallback = 90): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  const mod = n % 360
  return mod < 0 ? mod + 360 : mod
}

function presetDirectionFromAngle(angle: number): OverlayPresetDirection | null {
  const normalized = normalizeAngleDeg(angle, 90)
  for (const [dir, deg] of Object.entries(OVERLAY_DIRECTION_ANGLE_MAP) as Array<[OverlayPresetDirection, number]>) {
    if (Math.abs(normalized - deg) < 0.0001) return dir
  }
  return null
}

function alignIcon(kind: HorizontalAlign) {
  const base = 'h-3 w-3 text-current'
  if (kind === 'left') {
    return (
      <svg viewBox="0 0 16 16" className={base} aria-hidden>
        <path d="M2 3h10v1H2zm0 3h8v1H2zm0 3h10v1H2zm0 3h7v1H2z" fill="currentColor" />
      </svg>
    )
  }
  if (kind === 'center') {
    return (
      <svg viewBox="0 0 16 16" className={base} aria-hidden>
        <path d="M3 3h10v1H3zm4 3h2v1H7zm-2 3h6v1H5zm3 3h1v1H8z" fill="currentColor" />
      </svg>
    )
  }
  if (kind === 'start') {
    return (
      <svg viewBox="0 0 16 16" className={base} aria-hidden>
        <path d="M2 2h1v12H2zM5 4h9v1H5zm0 3h6v1H5zm0 3h9v1H5zm0 3h7v1H5z" fill="currentColor" />
      </svg>
    )
  }
  if (kind === 'end') {
    return (
      <svg viewBox="0 0 16 16" className={base} aria-hidden>
        <path d="M13 2h1v12h-1zM2 4h9v1H2zm5 3h4v1H7zM2 10h9v1H2zm4 3h5v1H6z" fill="currentColor" />
      </svg>
    )
  }
  if (kind === 'justify') {
    return (
      <svg viewBox="0 0 16 16" className={base} aria-hidden>
        <path d="M2 3h12v1H2zm0 3h12v1H2zm0 3h12v1H2zm0 3h12v1H2z" fill="currentColor" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 16 16" className={base} aria-hidden>
      <path d="M4 3h10v1H4zm6 3h4v1h-4zM4 9h10v1H4zm7 3h3v1h-3z" fill="currentColor" />
    </svg>
  )
}

function verticalAlignIcon(kind: VerticalAlign) {
  const base = 'h-3 w-3 text-current'
  if (kind === 'top') {
    return (
      <svg viewBox="0 0 16 16" className={base} aria-hidden>
        <path d="M2 2h12v1H2zM5 4h6v8H5z" fill="currentColor" />
      </svg>
    )
  }
  if (kind === 'middle') {
    return (
      <svg viewBox="0 0 16 16" className={base} aria-hidden>
        <path d="M2 8h12v1H2zM5 5h6v6H5z" fill="currentColor" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 16 16" className={base} aria-hidden>
      <path d="M2 13h12v1H2zM5 4h6v8H5z" fill="currentColor" />
    </svg>
  )
}

export type ThemeSettingsPanelFilter = 'all' | 'text' | 'overlay' | 'background'

export type ThemeEditHistoryBundle = {
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
}

export type PopupThemeEditorPanelProps = {
  theme: PopupTheme
  onUpdateTheme: (themeId: string, patch: Partial<PopupTheme>) => void
  /** 撤销/重做时整主题写回（与 onUpdateTheme 同一数据源） */
  replaceThemeFull: (theme: PopupTheme) => void
  previewViewportWidth: number
  previewImageUrlMap: Record<string, string>
  popupPreviewAspect: '16:9' | '4:3'
  selectedElements: TextElementKey[]
  onSelectElements: (keys: TextElementKey[]) => void
  /** 与子项弹窗表单联动：覆盖预览文案；缺省用主题内 preview* 或默认占位 */
  previewLabels?: Partial<Record<TextElementKey, string>>
  /** 有则优先：失焦后写回子项 content 等；无则写入主题 previewContentText / previewTimeText */
  onLiveTextCommit?: (key: TextElementKey, text: string) => void
  /** 未传时：无 `onLiveTextCommit`（主题工坊）默认可编辑三层；有 `onLiveTextCommit`（子项联动）交给预览内逻辑，仅绑定文本层可双击编辑，时间/倒计时走 `previewLabels` 实时串 */
  editableTextKeys?: TextElementKey[]
  /** 未传则「选择图片」按钮不显示或禁用由外层决定；设置页传 bind 到 theme.id 的 picker */
  onPickImageFile?: () => void | Promise<void>
  onPickImageFolder?: () => void | Promise<void>
  /** 默认 stacked：预览在上；hidden 时由外层单独渲染预览（如主题工坊左右分栏） */
  previewPlacement?: 'stacked' | 'hidden'
  /** 与预览同屏时传入包裹预览+参数区的 ref，撤销快捷键才能在预览区生效 */
  editorSurfaceRef?: React.RefObject<HTMLElement | null>
  /** 装饰层（补充文本 / 图片）选中 id；绑定层用 selectedElements */
  selectedDecorationLayerId?: string | null
  onSelectDecorationLayer?: (id: string | null) => void
  /** 为装饰图片层选图（与背景「选择图片」分离） */
  onPickDecoImage?: () => void | Promise<void>
  /** 根容器 class（如 `min-h-0 flex-1` 填满右侧栏） */
  className?: string
  /** 图层栏选中的背景 / 遮罩层 id */
  selectedStructuralLayerId?: string | null
  onSelectStructuralLayer?: (id: string | null) => void
  /** 撤销栈深度（整主题快照）；默认 20 */
  editHistoryMaxSteps?: number
  /**
   * 主题工坊分栏：由 ThemeStudioEditWorkspace 注入「mergeContent + 撤销栈」后的更新函数，
   * 与左侧预览共用同一栈；传入时须同时传 `delegatedEditHistory`。
   */
  delegatedMergedOnUpdateTheme?: (themeId: string, patch: Partial<PopupTheme>, meta?: PopupThemeEditUpdateMeta) => void
  delegatedEditHistory?: ThemeEditHistoryBundle
}

type PopupThemeEditorPanelCoreProps = PopupThemeEditorPanelProps & {
  mergedWrappedOnUpdateTheme: (themeId: string, patch: Partial<PopupTheme>, meta?: PopupThemeEditUpdateMeta) => void
  historyBundle: ThemeEditHistoryBundle
}

function PopupThemeEditorPanelWithHistory(props: PopupThemeEditorPanelProps) {
  const { delegatedMergedOnUpdateTheme: _a, delegatedEditHistory: _b, editHistoryMaxSteps = 20, ...p } = props
  const hist = usePopupThemeEditHistory(p.theme, p.onUpdateTheme, p.replaceThemeFull, editHistoryMaxSteps)
  const mergedWrappedOnUpdateTheme = useCallback(
    (id: string, patch: Partial<PopupTheme>, meta?: PopupThemeEditUpdateMeta) => {
      if (id !== p.theme.id) {
        hist.wrappedOnUpdateTheme(id, patch, meta)
        return
      }
      const layerSync = mergeContentThemePatchIntoBindingTextLayer(p.theme, patch)
      hist.wrappedOnUpdateTheme(id, layerSync ? { ...patch, ...layerSync } : patch, meta)
    },
    [p.theme.id, p.theme, hist.wrappedOnUpdateTheme],
  )
  const historyBundle: ThemeEditHistoryBundle = {
    undo: hist.undo,
    redo: hist.redo,
    canUndo: hist.canUndo,
    canRedo: hist.canRedo,
  }
  return (
    <PopupThemeEditorPanelCore
      {...p}
      editHistoryMaxSteps={editHistoryMaxSteps}
      mergedWrappedOnUpdateTheme={mergedWrappedOnUpdateTheme}
      historyBundle={historyBundle}
    />
  )
}

/**
 * 弹窗主题完整编辑区：预览 + 参数区（按图层选中自动切换可见块）。
 * 设置页与子项全屏编辑器共用。
 */
export function PopupThemeEditorPanel(props: PopupThemeEditorPanelProps) {
  if (props.delegatedMergedOnUpdateTheme != null && props.delegatedEditHistory != null) {
    return (
      <PopupThemeEditorPanelCore
        {...props}
        mergedWrappedOnUpdateTheme={props.delegatedMergedOnUpdateTheme}
        historyBundle={props.delegatedEditHistory}
      />
    )
  }
  return <PopupThemeEditorPanelWithHistory {...props} />
}

function PopupThemeEditorPanelCore({
  theme,
  onUpdateTheme: _onUpdateTheme,
  replaceThemeFull: _replaceThemeFull,
  previewViewportWidth,
  previewImageUrlMap,
  popupPreviewAspect,
  selectedElements,
  onSelectElements,
  previewLabels,
  onLiveTextCommit,
  editableTextKeys,
  onPickImageFile,
  onPickImageFolder,
  previewPlacement = 'stacked',
  editorSurfaceRef,
  selectedDecorationLayerId = null,
  onSelectDecorationLayer = () => {},
  onPickDecoImage,
  className,
  selectedStructuralLayerId = null,
  onSelectStructuralLayer = () => {},
  editHistoryMaxSteps: _editHistoryMaxSteps = 20,
  delegatedMergedOnUpdateTheme: _delegatedMerged,
  delegatedEditHistory: _delegatedHist,
  mergedWrappedOnUpdateTheme,
  historyBundle,
}: PopupThemeEditorPanelCoreProps) {
  const themeId = theme.id
  const layoutContainerRef = useRef<HTMLDivElement>(null)
  const undoScopeRef: RefObject<HTMLElement | null> = editorSurfaceRef ?? layoutContainerRef
  const [layersCollapsed, setLayersCollapsed] = useState(false)
  const [propertiesCollapsed, setPropertiesCollapsed] = useState(false)
  const [layersPanelHeight, setLayersPanelHeight] = useState(220)
  const splitDragRef = useRef<{ startY: number; startH: number } | null>(null)

  const startLayersSplitDrag = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      splitDragRef.current = { startY: e.clientY, startH: layersPanelHeight }
      const onMove = (ev: MouseEvent) => {
        if (!splitDragRef.current) return
        const dy = ev.clientY - splitDragRef.current.startY
        const next = splitDragRef.current.startH + dy
        const box = layoutContainerRef.current
        const maxH = box ? Math.min(Math.floor(box.clientHeight * 0.62), box.clientHeight - 140) : 420
        setLayersPanelHeight(Math.round(Math.min(Math.max(96, next), Math.max(120, maxH))))
      }
      const onUp = () => {
        splitDragRef.current = null
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [layersPanelHeight],
  )
  const { undo, redo } = historyBundle

  const [fontUiMode, setFontUiMode] = useState<Record<PopupTextFontLayer, 'preset' | 'system'>>(() => ({
    content: popupFontLayerUsesSystemTab(theme, 'content') ? 'system' : 'preset',
    time: popupFontLayerUsesSystemTab(theme, 'time') ? 'system' : 'preset',
    date: popupFontLayerUsesSystemTab(theme, 'date') ? 'system' : 'preset',
    countdown: popupFontLayerUsesSystemTab(theme, 'countdown') ? 'system' : 'preset',
  }))
  useEffect(() => {
    setFontUiMode({
      content: popupFontLayerUsesSystemTab(theme, 'content') ? 'system' : 'preset',
      time: popupFontLayerUsesSystemTab(theme, 'time') ? 'system' : 'preset',
      date: popupFontLayerUsesSystemTab(theme, 'date') ? 'system' : 'preset',
      countdown: popupFontLayerUsesSystemTab(theme, 'countdown') ? 'system' : 'preset',
    })
  }, [
    theme.id,
    theme.contentFontFamilySystem,
    theme.timeFontFamilySystem,
    theme.dateFontFamilySystem,
    theme.countdownFontFamilySystem,
    theme.popupFontFamilySystem,
    theme.contentFontFamilyPreset,
    theme.timeFontFamilyPreset,
    theme.dateFontFamilyPreset,
    theme.countdownFontFamilyPreset,
    theme.popupFontFamilyPreset,
  ])
  const [decoTextFontModeMap, setDecoTextFontModeMap] = useState<Record<string, 'preset' | 'system'>>({})

  const [systemFonts, setSystemFonts] = useState<string[] | null>(() => sharedSystemFontFamilies)
  const [fontsLoading, setFontsLoading] = useState(false)
  const loadSystemFonts = useCallback(async (forceRefresh: boolean) => {
    const api = window.electronAPI
    if (!api?.getSystemFontFamilies) return
    if (forceRefresh && api.clearSystemFontListCache) await api.clearSystemFontListCache()
    if (forceRefresh) sharedSystemFontFamilies = null

    if (
      !forceRefresh &&
      sharedSystemFontFamilies !== null &&
      sharedSystemFontFamilies.length > 0
    ) {
      setSystemFonts(sharedSystemFontFamilies)
      return
    }

    setFontsLoading(true)
    try {
      const r = await api.getSystemFontFamilies()
      if (r?.success && Array.isArray(r.fonts) && r.fonts.length > 0) {
        sharedSystemFontFamilies = r.fonts
        setSystemFonts(r.fonts)
      } else {
        sharedSystemFontFamilies = null
        setSystemFonts(Array.isArray(r?.fonts) ? r.fonts : [])
      }
    } catch {
      sharedSystemFontFamilies = null
      setSystemFonts([])
    } finally {
      setFontsLoading(false)
    }
  }, [])

  const needsSystemFontList =
    fontUiMode.content === 'system' || fontUiMode.time === 'system' || fontUiMode.date === 'system'
  useEffect(() => {
    // 后台静默预热字体列表，避免用户切到本机字体时还要手动触发。
    if (!window.electronAPI?.getSystemFontFamilies) return
    if (systemFonts !== null || fontsLoading) return
    void loadSystemFonts(false)
  }, [systemFonts, fontsLoading, loadSystemFonts])
  useEffect(() => {
    if (!needsSystemFontList) return
    if (systemFonts !== null || fontsLoading) return
    if (!window.electronAPI?.getSystemFontFamilies) return
    void loadSystemFonts(false)
  }, [needsSystemFontList, systemFonts, fontsLoading, loadSystemFonts])

  const fontLayers: { layer: PopupTextFontLayer; title: string }[] = [
    { layer: 'content', title: '文本' },
    { layer: 'time', title: '时间字体' },
    { layer: 'date', title: '日期字体' },
  ]

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      const root = undoScopeRef.current
      if (!root) return
      const t = e.target as HTMLElement | null
      if (t?.closest?.('input, textarea, select, [contenteditable="true"]')) return
      const ae = document.activeElement
      const inScope =
        (t instanceof HTMLElement && root.contains(t)) ||
        (ae instanceof HTMLElement && root.contains(ae))
      if (!inScope) return

      if (e.key === 'Backspace' || e.key === 'Delete') {
        /** 图层删除由 ThemePreviewEditor 内统一处理（与图层栏 × 同源 patch，含撤销栈） */
        return
      }

      if (!(e.ctrlKey || e.metaKey)) return
      const key = e.key.toLowerCase()
      if (key !== 'z' && key !== 'y') return
      e.preventDefault()
      if (key === 'y') {
        redo()
        return
      }
      undo()
    }
    document.addEventListener('keydown', fn, true)
    return () => document.removeEventListener('keydown', fn, true)
  }, [undo, redo, undoScopeRef])

  useEffect(() => {
    const canHandleMenuEdit = () => {
      const root = undoScopeRef.current
      if (!root) return false
      const ae = document.activeElement
      if (ae instanceof HTMLElement && root.contains(ae)) return true
      return selectedElements.length > 0 || selectedDecorationLayerId != null || selectedStructuralLayerId != null
    }
    const offUndo = window.electronAPI?.onMenuUndo?.(() => {
      if (!canHandleMenuEdit()) return
      undo()
    })
    const offRedo = window.electronAPI?.onMenuRedo?.(() => {
      if (!canHandleMenuEdit()) return
      redo()
    })
    return () => {
      offUndo?.()
      offRedo?.()
    }
  }, [undo, redo, undoScopeRef, selectedElements.length, selectedDecorationLayerId, selectedStructuralLayerId])

  const decoLayer =
    selectedDecorationLayerId != null
      ? (theme.layers ?? []).find((l) => l.id === selectedDecorationLayerId)
      : undefined

  /** 与旧「分页」等价的可见区推导，仅由图层/绑定选中决定，不再提供手动分页 */
  const effectivePanelFilter: ThemeSettingsPanelFilter = useMemo(() => {
    if (selectedStructuralLayerId === POPUP_LAYER_BACKGROUND_ID) return 'background'
    if (selectedStructuralLayerId === POPUP_LAYER_OVERLAY_ID) return 'overlay'
    if (selectedDecorationLayerId) {
      const dl = (theme.layers ?? []).find((l) => l.id === selectedDecorationLayerId)
      if (dl?.kind === 'text' || dl?.kind === 'image') return 'text'
    }
    if (
      selectedElements.length === 1 &&
      (selectedElements[0] === 'content' || selectedElements[0] === 'time' || selectedElements[0] === 'date')
    ) {
      return 'text'
    }
    return 'all'
  }, [selectedStructuralLayerId, selectedDecorationLayerId, selectedElements, theme.layers])

  const hidePrimaryTextForms =
    selectedDecorationLayerId != null ||
    (selectedStructuralLayerId != null &&
      (selectedStructuralLayerId === POPUP_LAYER_BACKGROUND_ID ||
        selectedStructuralLayerId === POPUP_LAYER_OVERLAY_ID))

  const contentOnlySelection =
    !hidePrimaryTextForms &&
    selectedElements.length === 1 &&
    selectedElements[0] === 'content' &&
    selectedStructuralLayerId == null
  const timeOnlySelection =
    !hidePrimaryTextForms &&
    selectedElements.length === 1 &&
    selectedElements[0] === 'time' &&
    selectedStructuralLayerId == null
  const dateOnlySelection =
    !hidePrimaryTextForms &&
    selectedElements.length === 1 &&
    selectedElements[0] === 'date' &&
    selectedStructuralLayerId == null
  const showBothFontColumns = !hidePrimaryTextForms && selectedElements.length >= 2
  const showContentColumn = !hidePrimaryTextForms && (contentOnlySelection || showBothFontColumns)
  const showTimeColumn = !hidePrimaryTextForms && (timeOnlySelection || showBothFontColumns)
  const showDateColumn = !hidePrimaryTextForms && (dateOnlySelection || showBothFontColumns)
  const showIdleTextHint =
    !hidePrimaryTextForms &&
    selectedElements.length === 0 &&
    selectedStructuralLayerId == null &&
    decoLayer == null
  const isDecoTextSelected =
    decoLayer != null &&
    decoLayer.kind === 'text' &&
    !(decoLayer as TextThemeLayer).bindsReminderBody

  return (
    <div
      ref={layoutContainerRef}
      className={`flex min-h-0 flex-1 flex-col overflow-hidden ${className ?? ''}`}
      data-popup-theme-editor-panel
    >
      <div
        className={
          layersCollapsed
            ? 'shrink-0 overflow-hidden bg-white px-2 py-1.5'
            : 'flex min-h-0 shrink-0 flex-col overflow-hidden bg-white px-2 py-2'
        }
        style={layersCollapsed ? undefined : { height: layersPanelHeight, minHeight: 96 }}
      >
        <PopupThemeLayersBar
          theme={theme}
          onUpdateTheme={mergedWrappedOnUpdateTheme}
          selectedElements={selectedElements}
          onSelectElements={onSelectElements}
          selectedDecorationLayerId={selectedDecorationLayerId}
          onSelectDecorationLayer={onSelectDecorationLayer}
          onPickDecoImage={onPickDecoImage}
          collapsed={layersCollapsed}
          onCollapsedChange={setLayersCollapsed}
          className={layersCollapsed ? '' : 'min-h-0 flex-1'}
          selectedStructuralLayerId={selectedStructuralLayerId}
          onSelectStructuralLayer={onSelectStructuralLayer}
        />
      </div>
      {!layersCollapsed && !propertiesCollapsed && (
        <div
          role="separator"
          aria-orientation="horizontal"
          title="上下拖动调节图层区与参数区高度"
          className="group shrink-0 cursor-row-resize border-y border-slate-200 bg-slate-100 py-1.5 hover:bg-slate-200"
          onMouseDown={startLayersSplitDrag}
        >
          <div className="mx-auto h-0.5 w-14 rounded-full bg-slate-400 group-hover:bg-slate-500" />
        </div>
      )}
      <div
        className={
          propertiesCollapsed
            ? 'shrink-0 flex flex-col overflow-hidden'
            : 'flex min-h-0 flex-1 flex-col overflow-hidden'
        }
      >
        {previewPlacement !== 'hidden' && (
          <div className="shrink-0 border-b border-slate-100 px-1 py-2">
            <ThemePreviewEditor
              theme={theme}
              onUpdateTheme={mergedWrappedOnUpdateTheme}
              keyboardScopeRef={undoScopeRef}
              previewViewportWidth={previewViewportWidth}
              previewImageUrlMap={previewImageUrlMap}
              popupPreviewAspect={popupPreviewAspect}
              selectedElements={selectedElements}
              onSelectElements={onSelectElements}
              selectedDecorationLayerId={selectedDecorationLayerId}
              onSelectDecorationLayer={onSelectDecorationLayer}
              onSelectStructuralLayer={onSelectStructuralLayer}
              selectedStructuralLayerId={selectedStructuralLayerId}
              previewLabels={previewLabels}
              onLiveTextCommit={onLiveTextCommit}
              editableTextKeys={
                editableTextKeys != null
                  ? editableTextKeys
                  : onLiveTextCommit
                    ? undefined
                    : ['content']
              }
            />
          </div>
        )}
        <div className="shrink-0 border-b border-slate-100 px-3 py-1.5">
          <button
            type="button"
            className="text-xs font-medium text-slate-700 hover:text-slate-900"
            onClick={() => setPropertiesCollapsed((v) => !v)}
          >
            属性 {propertiesCollapsed ? '▸' : '▾'}
          </button>
        </div>
        {!propertiesCollapsed && (
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 py-2">
      {(effectivePanelFilter === 'all' || effectivePanelFilter === 'text') &&
        decoLayer &&
        decoLayer.kind === 'text' &&
        !(decoLayer as TextThemeLayer).bindsReminderBody &&
        (() => {
          const td = decoLayer as TextThemeLayer
          const pushDeco = (patch: Partial<TextThemeLayer>, meta?: PopupThemeEditUpdateMeta) => {
            const p = updateTextLayer(theme, td.id, patch)
            if (p) mergedWrappedOnUpdateTheme(themeId, p, meta)
          }
          const decoMode = decoTextFontModeMap[td.id] ?? (td.fontFamilySystem?.trim() ? 'system' : 'preset')
          const decoEffects: PopupLayerTextEffects = td.textEffects ?? {}
          const patchDecoFx = (p: Partial<PopupLayerTextEffects>, meta?: PopupThemeEditUpdateMeta) => {
            pushDeco({ textEffects: { ...decoEffects, ...p } }, meta)
          }
          const dt = td.transform ?? { x: 50, y: 42, rotation: 0, scale: 1 }
          return (
            <div className="space-y-2">
            <h4 className="text-xs font-semibold text-slate-700">文字</h4>
            <label className="block space-y-1 text-xs text-slate-600">
              <textarea
                rows={3}
                value={td.text ?? ''}
                onChange={(e) => pushDeco({ text: e.target.value.slice(0, 2000) })}
                className="w-full resize-y rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
              />
            </label>
            <div className="grid grid-cols-[60px_minmax(0,1fr)] items-center gap-2">
              <p className="text-xs text-slate-600">文本</p>
              <SystemFontFamilyPicker
                mode={decoMode}
                onModeChange={(next) => {
                  setDecoTextFontModeMap((m) => ({ ...m, [td.id]: next }))
                  if (next === 'preset') pushDeco({ fontFamilySystem: undefined })
                }}
                presetOptions={POPUP_FONT_FAMILY_OPTIONS}
                presetValue={td.fontFamilyPreset ?? DEFAULT_POPUP_FONT_PRESET_ID}
                onPresetChange={(presetId) => {
                  const presetVal = presetId === DEFAULT_POPUP_FONT_PRESET_ID ? undefined : presetId
                  pushDeco({ fontFamilyPreset: presetVal, fontFamilySystem: undefined })
                }}
                value={td.fontFamilySystem ?? ''}
                fonts={systemFonts}
                fontsLoading={fontsLoading}
                onChange={(v) => pushDeco({ fontFamilySystem: v || undefined, fontFamilyPreset: undefined })}
              />
            </div>
            <div className="grid grid-cols-[60px_minmax(0,1fr)_72px] items-center gap-2 text-xs text-slate-600">
              <span>字号</span>
              <input
                type="range"
                min={1}
                max={300}
                step={1}
                value={Math.max(1, Math.min(300, td.fontSize ?? 28))}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  if (!Number.isFinite(n)) return
                  pushDeco({ fontSize: Math.max(1, Math.min(8000, Math.floor(n))) })
                }}
                className="w-full accent-indigo-600"
              />
              <input
                type="number"
                min={1}
                max={8000}
                value={td.fontSize ?? 28}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  if (!Number.isFinite(n)) return
                  pushDeco({ fontSize: Math.max(1, Math.min(8000, Math.floor(n))) })
                }}
                className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <span className="shrink-0">颜色</span>
              <PopupThemeColorSwatch
                value={td.color}
                onChange={(v, m) => pushDeco({ color: v }, m)}
              />
            </div>
            <div className="space-y-2">
              <h5 className="text-xs font-semibold text-slate-700">样式</h5>
              <div className="grid grid-cols-[60px_minmax(0,1fr)_auto] items-center gap-2 text-xs text-slate-600">
                <span>字重</span>
                <select
                  value={td.fontWeight ?? 500}
                  onChange={(e) => pushDeco({ fontWeight: Number(e.target.value) })}
                  className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                >
                  {[100, 200, 300, 400, 500, 600, 700, 800, 900].map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </select>
                <div className="inline-flex rounded border border-slate-300 bg-white p-0.5">
                  <button
                    type="button"
                    onClick={() => pushDeco({ fontWeight: (td.fontWeight ?? 500) >= 700 ? 400 : 700 })}
                    className={`rounded px-2 py-0.5 text-[12px] font-semibold ${((td.fontWeight ?? 500) >= 700) ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                  >
                    B
                  </button>
                  <button
                    type="button"
                    onClick={() => pushDeco({ textUnderline: td.textUnderline === true ? undefined : true })}
                    className={`rounded px-2 py-0.5 text-[12px] underline ${td.textUnderline === true ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                  >
                    U
                  </button>
                  <button
                    type="button"
                    onClick={() => pushDeco({ fontItalic: td.fontItalic === true ? undefined : true })}
                    className={`rounded px-2 py-0.5 text-[12px] italic ${td.fontItalic === true ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                  >
                    I
                  </button>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <h5 className="text-xs font-semibold text-slate-700">排版</h5>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-slate-500 shrink-0">对齐</span>
                <div className="inline-flex rounded border border-slate-300 bg-white p-0.5">
                  {(['left', 'center', 'right', 'start', 'end', 'justify'] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => pushDeco({ textAlign: v })}
                      className={`rounded px-2 py-0.5 text-[11px] ${
                        v === (td.textAlign ?? theme.textAlign) ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'
                      }`}
                      title={
                        v === 'left'
                          ? '左对齐'
                          : v === 'center'
                            ? '居中对齐'
                            : v === 'right'
                              ? '右对齐'
                              : v === 'start'
                                ? '起点对齐'
                                : v === 'end'
                                  ? '终点对齐'
                                  : '两端对齐'
                      }
                    >
                      {alignIcon(v)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-slate-500 shrink-0">垂直</span>
                <div className="inline-flex rounded border border-slate-300 bg-white p-0.5">
                  {(['top', 'middle', 'bottom'] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => pushDeco({ textVerticalAlign: v })}
                      className={`rounded px-2 py-0.5 text-[11px] ${
                        v === (td.textVerticalAlign ?? theme.textVerticalAlign ?? 'middle')
                          ? 'bg-slate-800 text-white'
                          : 'text-slate-600 hover:bg-slate-100'
                      }`}
                      title={v === 'top' ? '顶部对齐' : v === 'middle' ? '垂直居中' : '底部对齐'}
                    >
                      {verticalAlignIcon(v)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="text-xs text-slate-600 space-y-1">
                  <span>字间距（px，-2～20）</span>
                  <input
                    type="number"
                    min={-2}
                    max={20}
                    step={0.5}
                    value={td.letterSpacing ?? 0}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      if (!Number.isFinite(n)) return
                      pushDeco({ letterSpacing: Math.max(-2, Math.min(20, n)) })
                    }}
                    className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  />
                </label>
                <label className="text-xs text-slate-600 space-y-1">
                  <span>行高（建议 1.1～2）</span>
                  <input
                    type="number"
                    min={0.8}
                    max={3}
                    step={0.05}
                    value={td.lineHeight ?? 1.35}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      if (!Number.isFinite(n)) return
                      pushDeco({ lineHeight: Math.max(0.8, Math.min(3, n)) })
                    }}
                    className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  />
                </label>
              </div>
            </div>
            <div className="space-y-2">
              <h5 className="text-xs font-semibold text-slate-700">效果</h5>
              <div className="space-y-2">
                <div className="space-y-1.5 rounded border border-white/80 bg-white/60 p-1.5">
                  <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={decoEffects.strokeEnabled === true}
                      onChange={(ev) =>
                        patchDecoFx(
                          ev.target.checked
                            ? {
                                strokeEnabled: true,
                                strokeWidthPx: decoEffects.strokeWidthPx ?? 2,
                                strokeColor: decoEffects.strokeColor ?? '#000000',
                                strokeOpacity: decoEffects.strokeOpacity ?? 1,
                              }
                            : { strokeEnabled: false },
                        )
                      }
                    />
                    描边
                  </label>
                  {decoEffects.strokeEnabled === true && (
                    <div className="space-y-2">
                      <label className="block text-[11px] text-slate-600 space-y-0.5">
                        <span>宽度（px，上限 {POPUP_TEXT_STROKE_WIDTH_MAX}）</span>
                        <input
                          type="number"
                          min={0.5}
                          max={POPUP_TEXT_STROKE_WIDTH_MAX}
                          step={0.5}
                          value={decoEffects.strokeWidthPx ?? 2}
                          onChange={(ev) => {
                            const n = Number(ev.target.value)
                            if (!Number.isFinite(n)) return
                            patchDecoFx({ strokeWidthPx: Math.max(0.5, Math.min(POPUP_TEXT_STROKE_WIDTH_MAX, n)) })
                          }}
                          className="w-full max-w-xs rounded border border-slate-300 px-2 py-1 text-xs"
                        />
                      </label>
                      <div className="grid grid-cols-[60px_minmax(0,1fr)] items-center gap-2 text-[11px] text-slate-600">
                        <span>颜色</span>
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <PopupThemeColorSwatch
                            value={decoEffects.strokeColor ?? '#000000'}
                            onChange={(v, m) => patchDecoFx({ strokeColor: v }, m)}
                          />
                          <span className="shrink-0 text-slate-500">不透明度</span>
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.01}
                            value={decoEffects.strokeOpacity ?? 1}
                            onChange={(ev) => {
                              const n = Number(ev.target.value)
                              if (!Number.isFinite(n)) return
                              patchDecoFx({ strokeOpacity: Math.max(0, Math.min(1, n)) })
                            }}
                            className="min-w-[80px] flex-1 accent-indigo-600"
                          />
                          <input
                            type="number"
                            min={0}
                            max={1}
                            step={0.05}
                            value={decoEffects.strokeOpacity ?? 1}
                            onChange={(ev) => {
                              const n = Number(ev.target.value)
                              if (!Number.isFinite(n)) return
                              patchDecoFx({ strokeOpacity: Math.max(0, Math.min(1, n)) })
                            }}
                            className="w-[72px] shrink-0 rounded border border-slate-300 px-2 py-1 text-xs"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                <div className="space-y-1.5 rounded border border-white/80 bg-white/60 p-1.5">
                  <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={decoEffects.shadowEnabled === true}
                      onChange={(ev) =>
                        patchDecoFx(
                          ev.target.checked
                            ? {
                                shadowEnabled: true,
                                shadowColor: decoEffects.shadowColor ?? '#000000',
                                shadowOpacity: decoEffects.shadowOpacity ?? 0.45,
                                shadowBlurPx: decoEffects.shadowBlurPx ?? 4,
                                shadowSizePx: decoEffects.shadowSizePx ?? 0,
                                shadowDistancePx: decoEffects.shadowDistancePx ?? 6,
                                shadowAngleDeg: decoEffects.shadowAngleDeg ?? 45,
                              }
                            : { shadowEnabled: false },
                        )
                      }
                    />
                    阴影
                  </label>
                  {decoEffects.shadowEnabled === true && (
                    <div className="space-y-2">
                      <div className="grid grid-cols-[60px_minmax(0,1fr)] items-center gap-2 text-[11px] text-slate-600">
                        <span>颜色</span>
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <PopupThemeColorSwatch
                            value={decoEffects.shadowColor ?? '#000000'}
                            onChange={(v, m) => patchDecoFx({ shadowColor: v }, m)}
                          />
                          <span className="shrink-0 text-slate-500">不透明度</span>
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.01}
                            value={decoEffects.shadowOpacity ?? 0.45}
                            onChange={(ev) => {
                              const n = Number(ev.target.value)
                              if (!Number.isFinite(n)) return
                              patchDecoFx({ shadowOpacity: Math.max(0, Math.min(1, n)) })
                            }}
                            className="min-w-[80px] flex-1 accent-indigo-600"
                          />
                          <input
                            type="number"
                            min={0}
                            max={1}
                            step={0.05}
                            value={decoEffects.shadowOpacity ?? 0.45}
                            onChange={(ev) => {
                              const n = Number(ev.target.value)
                              if (!Number.isFinite(n)) return
                              patchDecoFx({ shadowOpacity: Math.max(0, Math.min(1, n)) })
                            }}
                            className="w-[72px] shrink-0 rounded border border-slate-300 px-2 py-1 text-xs"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      <label className="text-[11px] text-slate-600 space-y-0.5">
                        <span>模糊（px，上限 {POPUP_TEXT_SHADOW_BLUR_MAX}）</span>
                        <input
                          type="number"
                          min={0}
                          max={POPUP_TEXT_SHADOW_BLUR_MAX}
                          step={1}
                          value={decoEffects.shadowBlurPx ?? 4}
                          onChange={(ev) => {
                            const n = Number(ev.target.value)
                            if (!Number.isFinite(n)) return
                            patchDecoFx({ shadowBlurPx: Math.max(0, Math.min(POPUP_TEXT_SHADOW_BLUR_MAX, n)) })
                          }}
                          className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                        />
                      </label>
                      <label className="text-[11px] text-slate-600 space-y-0.5">
                        <span>扩散（px，上限 {POPUP_TEXT_SHADOW_SIZE_MAX}）</span>
                        <input
                          type="number"
                          min={0}
                          max={POPUP_TEXT_SHADOW_SIZE_MAX}
                          step={1}
                          value={decoEffects.shadowSizePx ?? 0}
                          onChange={(ev) => {
                            const n = Number(ev.target.value)
                            if (!Number.isFinite(n)) return
                            patchDecoFx({ shadowSizePx: Math.max(0, Math.min(POPUP_TEXT_SHADOW_SIZE_MAX, n)) })
                          }}
                          className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                        />
                      </label>
                      <label className="text-[11px] text-slate-600 space-y-0.5">
                        <span>距离（px，上限 {POPUP_TEXT_SHADOW_DISTANCE_MAX}）</span>
                        <input
                          type="number"
                          min={0}
                          max={POPUP_TEXT_SHADOW_DISTANCE_MAX}
                          step={1}
                          value={decoEffects.shadowDistancePx ?? 6}
                          onChange={(ev) => {
                            const n = Number(ev.target.value)
                            if (!Number.isFinite(n)) return
                            patchDecoFx({ shadowDistancePx: Math.max(0, Math.min(POPUP_TEXT_SHADOW_DISTANCE_MAX, n)) })
                          }}
                          className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                        />
                      </label>
                      <label className="text-[11px] text-slate-600 space-y-0.5">
                        <span>角度（°，0=右，90=下）</span>
                        <input
                          type="number"
                          min={-360}
                          max={360}
                          step={1}
                          value={decoEffects.shadowAngleDeg ?? 45}
                          onChange={(ev) => {
                            const n = Number(ev.target.value)
                            if (!Number.isFinite(n)) return
                            patchDecoFx({ shadowAngleDeg: Math.max(-360, Math.min(360, n)) })
                          }}
                          className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                        />
                      </label>
                    </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="border-t border-slate-100 pt-2 mt-1 space-y-2">
              <h5 className="text-xs font-semibold text-slate-700">变换</h5>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <label className="text-[11px] text-slate-600 space-y-0.5">
                  <span>X 位置 (%)</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={+dt.x.toFixed(1)}
                    onChange={(e) => pushDeco({ transform: { ...dt, x: Math.max(0, Math.min(100, Number(e.target.value) || 0)) } })}
                    className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                  />
                </label>
                <label className="text-[11px] text-slate-600 space-y-0.5">
                  <span>Y 位置 (%)</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={+dt.y.toFixed(1)}
                    onChange={(e) => pushDeco({ transform: { ...dt, y: Math.max(0, Math.min(100, Number(e.target.value) || 0)) } })}
                    className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                  />
                </label>
                <label className="text-[11px] text-slate-600 space-y-0.5">
                  <span>旋转 (°)</span>
                  <input
                    type="number"
                    min={-360}
                    max={360}
                    step={1}
                    value={+dt.rotation.toFixed(1)}
                    onChange={(e) => pushDeco({ transform: { ...dt, rotation: Math.max(-360, Math.min(360, Number(e.target.value) || 0)) } })}
                    className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                  />
                </label>
                <label className="text-[11px] text-slate-600 space-y-0.5">
                  <span>缩放</span>
                  <input
                    type="number"
                    min={0.1}
                    max={5}
                    step={0.05}
                    value={+dt.scale.toFixed(2)}
                    onChange={(e) => pushDeco({ transform: { ...dt, scale: Math.max(0.1, Math.min(5, Number(e.target.value) || 1)) } })}
                    className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                  />
                </label>
              </div>
              <button
                type="button"
                onClick={() => pushDeco({ transform: { x: 50, y: 42, rotation: 0, scale: 1 } })}
                className="text-[11px] text-indigo-600 hover:text-indigo-800"
              >
                重置为默认位置
              </button>
            </div>
            </div>
          )
        })()}
      {(effectivePanelFilter === 'all' || effectivePanelFilter === 'text') && decoLayer && decoLayer.kind === 'image' && (() => {
        const im = decoLayer as ImageThemeLayer
        return (
          <div className="rounded-md border border-teal-200 bg-teal-50/40 p-3 space-y-2">
            <h4 className="text-xs font-semibold text-teal-900">图片层 · 属性</h4>
            <p className="break-all text-[11px] text-slate-600">{im.imagePath || '（无路径）'}</p>
            {onPickDecoImage && (
              <button
                type="button"
                onClick={() => void onPickDecoImage()}
                className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
              >
                更换图片
              </button>
            )}
            <label className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <span>填充</span>
              <select
                value={im.objectFit === 'contain' ? 'contain' : 'cover'}
                onChange={(e) => {
                  const p = updateDecorationLayer(theme, im.id, {
                    objectFit: e.target.value === 'contain' ? 'contain' : 'cover',
                  } as Partial<ImageThemeLayer>)
                  if (p) mergedWrappedOnUpdateTheme(themeId, p)
                }}
                className="rounded border border-slate-300 px-2 py-1 text-sm"
              >
                <option value="cover">覆盖</option>
                <option value="contain">包含</option>
              </select>
            </label>
            <p className="text-[10px] text-slate-500">位置与尺寸请在左侧预览中拖拽。</p>
          </div>
        )
      })()}
      {(effectivePanelFilter === 'all' || effectivePanelFilter === 'text') && !hidePrimaryTextForms && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-slate-700">文字</h4>
          {showIdleTextHint && (
            <p className="text-[11px] text-slate-600 leading-relaxed">
              在图层栏选择「文本」「时间」或「日期」后再编辑对应字体与颜色；未选层时不改动根字体参数。
            </p>
          )}
          {showContentColumn && (
            <label className="block space-y-1 text-xs text-slate-600">
              <textarea
                rows={3}
                value={
                  onLiveTextCommit != null
                    ? (previewLabels?.content ?? '')
                    : bindingContentThemeDraft(theme)
                }
                onChange={(e) => {
                  const v = e.target.value.slice(0, 2000)
                  onLiveTextCommit?.('content', v)
                  mergedWrappedOnUpdateTheme(themeId, { previewContentText: v })
                }}
                placeholder="可与左侧预览双击编辑互通"
                className="w-full resize-y rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
              />
            </label>
          )}
          <div className="space-y-2">
            {!window.electronAPI?.getSystemFontFamilies && (
              <p className="text-[11px] text-amber-700">当前环境非 Electron，无法枚举本机字体。</p>
            )}
            {fontLayers
              .filter(
                ({ layer }) =>
                  (layer === 'content' && showContentColumn) ||
                  (layer === 'time' && showTimeColumn) ||
                  (layer === 'date' && showDateColumn),
              )
              .map(({ layer, title }) => (
              <div key={layer} className="grid grid-cols-[60px_minmax(0,1fr)] items-center gap-2">
                <p className="text-xs text-slate-600">{title}</p>
                <SystemFontFamilyPicker
                  mode={fontUiMode[layer]}
                  onModeChange={(next) => {
                    setFontUiMode((m) => ({ ...m, [layer]: next }))
                    if (next === 'system') {
                      void loadSystemFonts(false)
                      return
                    }
                    const p: Partial<PopupTheme> =
                      layer === 'content'
                        ? { contentFontFamilySystem: undefined }
                        : layer === 'time'
                          ? { timeFontFamilySystem: undefined }
                          : layer === 'date'
                            ? { dateFontFamilySystem: undefined }
                            : { countdownFontFamilySystem: undefined }
                    mergedWrappedOnUpdateTheme(themeId, p)
                  }}
                  presetOptions={POPUP_FONT_FAMILY_OPTIONS}
                  presetValue={popupFontPresetSelectValue(theme, layer)}
                  onPresetChange={(presetId) => {
                    const presetVal = presetId === DEFAULT_POPUP_FONT_PRESET_ID ? undefined : presetId
                    if (layer === 'content') {
                      mergedWrappedOnUpdateTheme(themeId, {
                        contentFontFamilyPreset: presetVal,
                        contentFontFamilySystem: undefined,
                      })
                    } else if (layer === 'time') {
                      mergedWrappedOnUpdateTheme(themeId, {
                        timeFontFamilyPreset: presetVal,
                        timeFontFamilySystem: undefined,
                      })
                    } else if (layer === 'date') {
                      mergedWrappedOnUpdateTheme(themeId, {
                        dateFontFamilyPreset: presetVal,
                        dateFontFamilySystem: undefined,
                      })
                    } else {
                      mergedWrappedOnUpdateTheme(themeId, {
                        countdownFontFamilyPreset: presetVal,
                        countdownFontFamilySystem: undefined,
                      })
                    }
                  }}
                  value={popupFontSystemInputValue(theme, layer)}
                  fonts={systemFonts}
                  fontsLoading={fontsLoading}
                  onChange={(v) => {
                    const sys = v || undefined
                    if (layer === 'content') {
                      mergedWrappedOnUpdateTheme(themeId, {
                        contentFontFamilySystem: sys,
                        contentFontFamilyPreset: undefined,
                      })
                    } else if (layer === 'time') {
                      mergedWrappedOnUpdateTheme(themeId, {
                        timeFontFamilySystem: sys,
                        timeFontFamilyPreset: undefined,
                      })
                    } else if (layer === 'date') {
                      mergedWrappedOnUpdateTheme(themeId, {
                        dateFontFamilySystem: sys,
                        dateFontFamilyPreset: undefined,
                      })
                    } else {
                      mergedWrappedOnUpdateTheme(themeId, {
                        countdownFontFamilySystem: sys,
                        countdownFontFamilyPreset: undefined,
                      })
                    }
                  }}
                />
              </div>
            ))}
            {window.electronAPI?.getSystemFontFamilies && systemFonts !== null && systemFonts.length === 0 && !fontsLoading && (
              <p className="text-[11px] text-amber-700">未读到字体列表，可直接在输入框填写字体全名。</p>
            )}
          </div>
          {(showContentColumn || showTimeColumn || showDateColumn) && (
            <div className="space-y-2">
              {showContentColumn && (
                <div className="grid grid-cols-[60px_minmax(0,1fr)_72px] items-center gap-2 text-xs text-slate-600">
                  <span>字号</span>
                  <input
                    type="range"
                    min={1}
                    max={300}
                    step={1}
                    value={Math.max(1, Math.min(300, theme.contentFontSize))}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      if (!Number.isFinite(n)) return
                      mergedWrappedOnUpdateTheme(themeId, { contentFontSize: Math.max(1, Math.min(8000, Math.floor(n))) })
                    }}
                    className="w-full accent-indigo-600"
                  />
                  <input
                    type="number"
                    min={1}
                    max={8000}
                    value={theme.contentFontSize}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      mergedWrappedOnUpdateTheme(themeId, {
                        contentFontSize: Number.isFinite(n) ? Math.max(1, Math.min(8000, Math.floor(n))) : 12,
                      })
                    }}
                    className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  />
                </div>
              )}
              {showTimeColumn && (
                <div className="grid grid-cols-[60px_minmax(0,1fr)_72px] items-center gap-2 text-xs text-slate-600">
                  <span>时间字号</span>
                  <input
                    type="range"
                    min={1}
                    max={300}
                    step={1}
                    value={Math.max(1, Math.min(300, theme.timeFontSize))}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      if (!Number.isFinite(n)) return
                      mergedWrappedOnUpdateTheme(themeId, { timeFontSize: Math.max(1, Math.min(8000, Math.floor(n))) })
                    }}
                    className="w-full accent-indigo-600"
                  />
                  <input
                    type="number"
                    min={1}
                    max={8000}
                    value={theme.timeFontSize}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      mergedWrappedOnUpdateTheme(themeId, {
                        timeFontSize: Number.isFinite(n) ? Math.max(1, Math.min(8000, Math.floor(n))) : 10,
                      })
                    }}
                    className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  />
                </div>
              )}
              {showDateColumn && (
                <div className="grid grid-cols-[60px_minmax(0,1fr)_72px] items-center gap-2 text-xs text-slate-600">
                  <span>日期字号</span>
                  <input
                    type="range"
                    min={1}
                    max={300}
                    step={1}
                    value={Math.max(1, Math.min(300, theme.dateFontSize ?? 72))}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      if (!Number.isFinite(n)) return
                      mergedWrappedOnUpdateTheme(themeId, { dateFontSize: Math.max(1, Math.min(8000, Math.floor(n))) })
                    }}
                    className="w-full accent-indigo-600"
                  />
                  <input
                    type="number"
                    min={1}
                    max={8000}
                    value={theme.dateFontSize ?? 72}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      mergedWrappedOnUpdateTheme(themeId, {
                        dateFontSize: Number.isFinite(n) ? Math.max(1, Math.min(8000, Math.floor(n))) : 72,
                      })
                    }}
                    className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  />
                </div>
              )}
            </div>
          )}
          {(showContentColumn || showTimeColumn || showDateColumn) && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {showContentColumn && (
                <div className="flex items-center gap-2 text-xs text-slate-600">
                  <span className="shrink-0">颜色</span>
                  <PopupThemeColorSwatch
                    value={theme.contentColor}
                    onChange={(v, m) => mergedWrappedOnUpdateTheme(themeId, { contentColor: v }, m)}
                  />
                </div>
              )}
              {showTimeColumn && (
                <div className="flex items-center gap-2 text-xs text-slate-600">
                  <span className="shrink-0">时间颜色</span>
                  <PopupThemeColorSwatch
                    value={theme.timeColor}
                    onChange={(v, m) => mergedWrappedOnUpdateTheme(themeId, { timeColor: v }, m)}
                  />
                </div>
              )}
              {showDateColumn && (
                <div className="flex items-center gap-2 text-xs text-slate-600">
                  <span className="shrink-0">日期颜色</span>
                  <PopupThemeColorSwatch
                    value={theme.dateColor ?? theme.timeColor}
                    onChange={(v, m) => mergedWrappedOnUpdateTheme(themeId, { dateColor: v }, m)}
                  />
                </div>
              )}
            </div>
          )}
          {(showContentColumn || showTimeColumn || showDateColumn) && (
            <div className="space-y-2">
              <h5 className="text-xs font-semibold text-slate-700">样式</h5>
              {showContentColumn && (
                <div className="grid grid-cols-[60px_minmax(0,1fr)_auto] items-center gap-2 text-xs text-slate-600">
                  <span>字重</span>
                  <select
                    value={theme.contentFontWeight ?? 600}
                    onChange={(e) => mergedWrappedOnUpdateTheme(themeId, { contentFontWeight: Number(e.target.value) })}
                    className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  >
                    <option value={100}>100</option>
                    <option value={200}>200</option>
                    <option value={300}>300</option>
                    <option value={400}>400</option>
                    <option value={500}>500</option>
                    <option value={600}>600</option>
                    <option value={700}>700</option>
                    <option value={800}>800</option>
                    <option value={900}>900</option>
                  </select>
                  <div className="inline-flex rounded border border-slate-300 bg-white p-0.5">
                    <button
                      type="button"
                      onClick={() => mergedWrappedOnUpdateTheme(themeId, { contentFontWeight: (theme.contentFontWeight ?? 600) >= 700 ? 400 : 700 })}
                      className={`rounded px-2 py-0.5 text-[12px] font-semibold ${((theme.contentFontWeight ?? 600) >= 700) ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                    >
                      B
                    </button>
                    <button
                      type="button"
                      onClick={() => mergedWrappedOnUpdateTheme(themeId, { contentUnderline: theme.contentUnderline === true ? undefined : true })}
                      className={`rounded px-2 py-0.5 text-[12px] underline ${theme.contentUnderline === true ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                    >
                      U
                    </button>
                    <button
                      type="button"
                      onClick={() => mergedWrappedOnUpdateTheme(themeId, { contentFontItalic: theme.contentFontItalic === true ? undefined : true })}
                      className={`rounded px-2 py-0.5 text-[12px] italic ${theme.contentFontItalic === true ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                    >
                      I
                    </button>
                  </div>
                </div>
              )}
              {showTimeColumn && (
                <div className="grid grid-cols-[60px_minmax(0,1fr)_auto] items-center gap-2 text-xs text-slate-600">
                  <span>时间字重</span>
                  <select
                    value={theme.timeFontWeight ?? 400}
                    onChange={(e) => mergedWrappedOnUpdateTheme(themeId, { timeFontWeight: Number(e.target.value) })}
                    className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  >
                    <option value={100}>100</option>
                    <option value={200}>200</option>
                    <option value={300}>300</option>
                    <option value={400}>400</option>
                    <option value={500}>500</option>
                    <option value={600}>600</option>
                    <option value={700}>700</option>
                    <option value={800}>800</option>
                    <option value={900}>900</option>
                  </select>
                  <div className="inline-flex rounded border border-slate-300 bg-white p-0.5">
                    <button
                      type="button"
                      onClick={() => mergedWrappedOnUpdateTheme(themeId, { timeFontWeight: (theme.timeFontWeight ?? 400) >= 700 ? 400 : 700 })}
                      className={`rounded px-2 py-0.5 text-[12px] font-semibold ${((theme.timeFontWeight ?? 400) >= 700) ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                    >
                      B
                    </button>
                    <button
                      type="button"
                      onClick={() => mergedWrappedOnUpdateTheme(themeId, { timeUnderline: theme.timeUnderline === true ? undefined : true })}
                      className={`rounded px-2 py-0.5 text-[12px] underline ${theme.timeUnderline === true ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                    >
                      U
                    </button>
                    <button
                      type="button"
                      onClick={() => mergedWrappedOnUpdateTheme(themeId, { timeFontItalic: theme.timeFontItalic === true ? undefined : true })}
                      className={`rounded px-2 py-0.5 text-[12px] italic ${theme.timeFontItalic === true ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                    >
                      I
                    </button>
                  </div>
                </div>
              )}
              {showDateColumn && (
                <div className="grid grid-cols-[60px_minmax(0,1fr)_auto] items-center gap-2 text-xs text-slate-600">
                  <span>日期字重</span>
                  <select
                    value={theme.dateFontWeight ?? 400}
                    onChange={(e) => mergedWrappedOnUpdateTheme(themeId, { dateFontWeight: Number(e.target.value) })}
                    className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  >
                    <option value={100}>100</option>
                    <option value={200}>200</option>
                    <option value={300}>300</option>
                    <option value={400}>400</option>
                    <option value={500}>500</option>
                    <option value={600}>600</option>
                    <option value={700}>700</option>
                    <option value={800}>800</option>
                    <option value={900}>900</option>
                  </select>
                  <div className="inline-flex rounded border border-slate-300 bg-white p-0.5">
                    <button
                      type="button"
                      onClick={() => mergedWrappedOnUpdateTheme(themeId, { dateFontWeight: (theme.dateFontWeight ?? 400) >= 700 ? 400 : 700 })}
                      className={`rounded px-2 py-0.5 text-[12px] font-semibold ${((theme.dateFontWeight ?? 400) >= 700) ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                    >
                      B
                    </button>
                    <button
                      type="button"
                      onClick={() => mergedWrappedOnUpdateTheme(themeId, { dateUnderline: theme.dateUnderline === true ? undefined : true })}
                      className={`rounded px-2 py-0.5 text-[12px] underline ${theme.dateUnderline === true ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                    >
                      U
                    </button>
                    <button
                      type="button"
                      onClick={() => mergedWrappedOnUpdateTheme(themeId, { dateFontItalic: theme.dateFontItalic === true ? undefined : true })}
                      className={`rounded px-2 py-0.5 text-[12px] italic ${theme.dateFontItalic === true ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                    >
                      I
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {showDateColumn && (dateOnlySelection || (showBothFontColumns && selectedElements.includes('date'))) && (
            <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50/80 p-2">
              <h5 className="text-xs font-semibold text-slate-700">日期 · 显示与格式</h5>
              <p className="text-[10px] text-slate-500 leading-relaxed">
                使用系统 Intl 格式化；Locale 留空则跟随运行环境。真弹窗为打开瞬间的日期；下方固定预览文案仅用于工坊截图稳定。
              </p>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ['locale_zh', '中文常用'],
                    ['locale_en', '英文 (US)'],
                    ['iso', 'ISO 风格'],
                    ['weekday_only', '仅星期'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    title={
                      id === 'iso'
                        ? 'YYYY-MM-DD 数字格式；区域 en-CA，勾选「星期」时为英文星期名（非瑞典语等）'
                        : undefined
                    }
                    className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-100"
                    onClick={() => mergedWrappedOnUpdateTheme(themeId, popupThemeDatePresetPatch(id as PopupThemeDatePresetId))}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-3 text-[11px] text-slate-700">
                <label className="inline-flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={theme.dateShowYear !== false}
                    onChange={(e) => mergedWrappedOnUpdateTheme(themeId, { dateShowYear: e.target.checked ? undefined : false })}
                  />
                  年
                </label>
                <label className="inline-flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={theme.dateShowMonth !== false}
                    onChange={(e) => mergedWrappedOnUpdateTheme(themeId, { dateShowMonth: e.target.checked ? undefined : false })}
                  />
                  月
                </label>
                <label className="inline-flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={theme.dateShowDay !== false}
                    onChange={(e) => mergedWrappedOnUpdateTheme(themeId, { dateShowDay: e.target.checked ? undefined : false })}
                  />
                  日
                </label>
                <label className="inline-flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={theme.dateShowWeekday !== false}
                    onChange={(e) => mergedWrappedOnUpdateTheme(themeId, { dateShowWeekday: e.target.checked ? undefined : false })}
                  />
                  星期
                </label>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="text-[11px] text-slate-600 space-y-0.5">
                  <span>年</span>
                  <select
                    value={theme.dateYearFormat ?? 'numeric'}
                    onChange={(e) =>
                      mergedWrappedOnUpdateTheme(themeId, {
                        dateYearFormat: e.target.value === '2-digit' ? '2-digit' : 'numeric',
                      })
                    }
                    className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                  >
                    <option value="numeric">4 位</option>
                    <option value="2-digit">2 位</option>
                  </select>
                </label>
                <label className="text-[11px] text-slate-600 space-y-0.5">
                  <span>月</span>
                  <select
                    value={theme.dateMonthFormat ?? 'numeric'}
                    onChange={(e) => {
                      const v = e.target.value
                      mergedWrappedOnUpdateTheme(themeId, {
                        dateMonthFormat:
                          v === 'long' || v === 'short' || v === '2-digit' || v === 'numeric' ? v : 'numeric',
                      })
                    }}
                    className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                  >
                    <option value="numeric">数字</option>
                    <option value="2-digit">两位数字</option>
                    <option value="short">简写</option>
                    <option value="long">全称</option>
                  </select>
                </label>
                <label className="text-[11px] text-slate-600 space-y-0.5">
                  <span>日</span>
                  <select
                    value={theme.dateDayFormat ?? 'numeric'}
                    onChange={(e) =>
                      mergedWrappedOnUpdateTheme(themeId, {
                        dateDayFormat: e.target.value === '2-digit' ? '2-digit' : 'numeric',
                      })
                    }
                    className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                  >
                    <option value="numeric">数字</option>
                    <option value="2-digit">两位数字</option>
                  </select>
                </label>
                <label className="text-[11px] text-slate-600 space-y-0.5">
                  <span>星期</span>
                  <select
                    value={theme.dateWeekdayFormat ?? 'short'}
                    onChange={(e) =>
                      mergedWrappedOnUpdateTheme(themeId, {
                        dateWeekdayFormat: e.target.value === 'long' ? 'long' : 'short',
                      })
                    }
                    className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                  >
                    <option value="short">简写</option>
                    <option value="long">全称</option>
                  </select>
                </label>
              </div>
              <label className="block text-[11px] text-slate-600 space-y-0.5">
                <span>Locale（BCP 47，可选，如 zh-CN、en-US）</span>
                <input
                  type="text"
                  value={theme.dateLocale ?? ''}
                  placeholder="默认环境"
                  onChange={(e) => mergedWrappedOnUpdateTheme(themeId, { dateLocale: e.target.value.trim() || undefined })}
                  className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                />
              </label>
              <label className="block text-[11px] text-slate-600 space-y-0.5">
                <span>预览固定日期（可选，非空则预览不再跟系统时钟）</span>
                <input
                  type="text"
                  value={theme.previewDateText ?? ''}
                  placeholder="留空则实时格式化"
                  onChange={(e) => mergedWrappedOnUpdateTheme(themeId, { previewDateText: e.target.value.trim() || undefined })}
                  className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                />
              </label>
            </div>
          )}

          {!isDecoTextSelected && (
            <div className="space-y-2">
              <h5 className="text-xs font-semibold text-slate-700">排版</h5>
            {selectedElements.length === 0 ? (
              decoLayer &&
              ((decoLayer.kind === 'text' && !(decoLayer as TextThemeLayer).bindsReminderBody) ||
                decoLayer.kind === 'image') ? (
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  当前为装饰层；位置与旋转请在左侧预览拖拽。若需编辑绑定文本/时间的对齐与字间距，请先在图层列表中点击对应层。
                </p>
              ) : (
              <p className="text-[11px] text-slate-500 leading-relaxed">
                在预览区点击文字（或下方「位置与变换」里点选层）后，可为该层单独设置对齐、字间距与行高；未单独设置时沿用上方全局「文字对齐」与内置默认行高。
              </p>
              )
            ) : (
              (() => {
                const sel = selectedElements[0]
                const { align, verticalAlign, letterSpacing, lineHeight } = layerTypographyKeys(sel)
                const curAlign = ((theme[align] as string | undefined) ?? theme.textAlign) as HorizontalAlign
                const curVerticalAlign = ((theme[verticalAlign] as string | undefined) ?? theme.textVerticalAlign ?? 'middle') as VerticalAlign
                const lsVal = theme[letterSpacing]
                const lhDefault = sel === 'countdown' ? 1 : sel === 'time' || sel === 'date' ? 1 : 1.35
                const lhVal = theme[lineHeight] ?? lhDefault
                return (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] text-slate-500 shrink-0">对齐</span>
                      <div className="inline-flex rounded border border-slate-300 bg-white p-0.5">
                        {(['left', 'center', 'right', 'start', 'end', 'justify'] as const).map((v) => (
                          <button
                            key={v}
                            type="button"
                            onClick={() =>
                              mergedWrappedOnUpdateTheme(themeId, {
                                [align]: v as PopupTheme[typeof align],
                              })
                            }
                            className={`rounded px-2 py-0.5 text-[11px] ${
                              v === curAlign
                                ? 'bg-slate-800 text-white'
                                : 'text-slate-600 hover:bg-slate-100'
                            }`}
                            title={
                              v === 'left'
                                ? '左对齐'
                                : v === 'center'
                                  ? '居中对齐'
                                  : v === 'right'
                                    ? '右对齐'
                                    : v === 'start'
                                      ? '起点对齐'
                                      : v === 'end'
                                        ? '终点对齐'
                                        : '两端对齐'
                            }
                          >
                            {alignIcon(v)}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] text-slate-500 shrink-0">垂直</span>
                      <div className="inline-flex rounded border border-slate-300 bg-white p-0.5">
                        {(['top', 'middle', 'bottom'] as const).map((v) => (
                          <button
                            key={v}
                            type="button"
                            onClick={() =>
                              mergedWrappedOnUpdateTheme(themeId, {
                                [verticalAlign]: v as PopupTheme[typeof verticalAlign],
                              })
                            }
                            className={`rounded px-2 py-0.5 text-[11px] ${
                              v === curVerticalAlign
                                ? 'bg-slate-800 text-white'
                                : 'text-slate-600 hover:bg-slate-100'
                            }`}
                            title={v === 'top' ? '顶部对齐' : v === 'middle' ? '垂直居中' : '底部对齐'}
                          >
                            {verticalAlignIcon(v)}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <label className="text-xs text-slate-600 space-y-1">
                        <span>字间距（px，-2～20）</span>
                        <input
                          type="number"
                          min={-2}
                          max={20}
                          step={0.5}
                          value={lsVal ?? 0}
                          onChange={(e) => {
                            const n = Number(e.target.value)
                            if (!Number.isFinite(n)) return
                            mergedWrappedOnUpdateTheme(themeId, { [letterSpacing]: Math.max(-2, Math.min(20, n)) })
                          }}
                          className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                        />
                      </label>
                      <label className="text-xs text-slate-600 space-y-1">
                        <span>
                          行高（
                          {sel === 'countdown'
                            ? '倒计时建议 1～1.4'
                            : sel === 'time' || sel === 'date'
                              ? '单行建议 1'
                              : '建议 1.1～2'}
                          )
                        </span>
                        <input
                          type="number"
                          min={0.8}
                          max={3}
                          step={0.05}
                          value={lhVal}
                          onChange={(e) => {
                            const n = Number(e.target.value)
                            if (!Number.isFinite(n)) return
                            mergedWrappedOnUpdateTheme(themeId, { [lineHeight]: Math.max(0.8, Math.min(3, n)) })
                          }}
                          className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                        />
                      </label>
                    </div>
                  </div>
                )
              })()
            )}
            </div>
          )}

          {selectedElements.length > 0 && (effectivePanelFilter === 'all' || effectivePanelFilter === 'text') && (
            <div className="space-y-2">
              <h5 className="text-xs font-semibold text-slate-700">效果</h5>
              {(() => {
                const sel = selectedElements[0]
                const ek = layerEffectsKey(sel)
                const e: PopupLayerTextEffects = theme[ek] ?? {}
                const patchFx = (p: Partial<PopupLayerTextEffects>, meta?: PopupThemeEditUpdateMeta) =>
                  mergedWrappedOnUpdateTheme(themeId, { [ek]: { ...e, ...p } } as Partial<PopupTheme>, meta)
                return (
                  <div className="space-y-2">
                    <div className="space-y-1.5 rounded border border-white/80 bg-white/60 p-1.5">
                      <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                        <input
                          type="checkbox"
                          checked={e.strokeEnabled === true}
                          onChange={(ev) =>
                            patchFx(
                              ev.target.checked
                                ? {
                                    strokeEnabled: true,
                                    strokeWidthPx: e.strokeWidthPx ?? 2,
                                    strokeColor: e.strokeColor ?? '#000000',
                                    strokeOpacity: e.strokeOpacity ?? 1,
                                  }
                                : { strokeEnabled: false },
                            )
                          }
                        />
                        描边
                      </label>
                      {e.strokeEnabled === true && (
                        <div className="space-y-2">
                          <label className="block text-[11px] text-slate-600 space-y-0.5">
                            <span>宽度（px，上限 {POPUP_TEXT_STROKE_WIDTH_MAX}）</span>
                            <input
                              type="number"
                              min={0.5}
                              max={POPUP_TEXT_STROKE_WIDTH_MAX}
                              step={0.5}
                              value={e.strokeWidthPx ?? 2}
                              onChange={(ev) => {
                                const n = Number(ev.target.value)
                                if (!Number.isFinite(n)) return
                                patchFx({ strokeWidthPx: Math.max(0.5, Math.min(POPUP_TEXT_STROKE_WIDTH_MAX, n)) })
                              }}
                              className="w-full max-w-xs rounded border border-slate-300 px-2 py-1 text-xs"
                            />
                          </label>
                          <div className="grid grid-cols-[60px_minmax(0,1fr)] items-center gap-2 text-[11px] text-slate-600">
                            <span>颜色</span>
                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                              <PopupThemeColorSwatch
                                value={e.strokeColor ?? '#000000'}
                                onChange={(v, m) => patchFx({ strokeColor: v }, m)}
                              />
                              <span className="shrink-0 text-slate-500">不透明度</span>
                              <input
                                type="range"
                                min={0}
                                max={1}
                                step={0.01}
                                value={e.strokeOpacity ?? 1}
                                onChange={(ev) => {
                                  const n = Number(ev.target.value)
                                  if (!Number.isFinite(n)) return
                                  patchFx({ strokeOpacity: Math.max(0, Math.min(1, n)) })
                                }}
                                className="min-w-[80px] flex-1 accent-indigo-600"
                              />
                              <input
                                type="number"
                                min={0}
                                max={1}
                                step={0.05}
                                value={e.strokeOpacity ?? 1}
                                onChange={(ev) => {
                                  const n = Number(ev.target.value)
                                  if (!Number.isFinite(n)) return
                                  patchFx({ strokeOpacity: Math.max(0, Math.min(1, n)) })
                                }}
                                className="w-[72px] shrink-0 rounded border border-slate-300 px-2 py-1 text-xs"
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="space-y-1.5 rounded border border-white/80 bg-white/60 p-1.5">
                      <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                        <input
                          type="checkbox"
                          checked={e.shadowEnabled === true}
                          onChange={(ev) =>
                            patchFx(
                              ev.target.checked
                                ? {
                                    shadowEnabled: true,
                                    shadowColor: e.shadowColor ?? '#000000',
                                    shadowOpacity: e.shadowOpacity ?? 0.45,
                                    shadowBlurPx: e.shadowBlurPx ?? 4,
                                    shadowSizePx: e.shadowSizePx ?? 0,
                                    shadowDistancePx: e.shadowDistancePx ?? 6,
                                    shadowAngleDeg: e.shadowAngleDeg ?? 45,
                                  }
                                : { shadowEnabled: false },
                            )
                          }
                        />
                        阴影
                      </label>
                      {e.shadowEnabled === true && (
                        <div className="space-y-2">
                          <div className="grid grid-cols-[60px_minmax(0,1fr)] items-center gap-2 text-[11px] text-slate-600">
                            <span>颜色</span>
                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                              <PopupThemeColorSwatch
                                value={e.shadowColor ?? '#000000'}
                                onChange={(v, m) => patchFx({ shadowColor: v }, m)}
                              />
                              <span className="shrink-0 text-slate-500">不透明度</span>
                              <input
                                type="range"
                                min={0}
                                max={1}
                                step={0.01}
                                value={e.shadowOpacity ?? 0.45}
                                onChange={(ev) => {
                                  const n = Number(ev.target.value)
                                  if (!Number.isFinite(n)) return
                                  patchFx({ shadowOpacity: Math.max(0, Math.min(1, n)) })
                                }}
                                className="min-w-[80px] flex-1 accent-indigo-600"
                              />
                              <input
                                type="number"
                                min={0}
                                max={1}
                                step={0.05}
                                value={e.shadowOpacity ?? 0.45}
                                onChange={(ev) => {
                                  const n = Number(ev.target.value)
                                  if (!Number.isFinite(n)) return
                                  patchFx({ shadowOpacity: Math.max(0, Math.min(1, n)) })
                                }}
                                className="w-[72px] shrink-0 rounded border border-slate-300 px-2 py-1 text-xs"
                              />
                            </div>
                          </div>
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          <label className="text-[11px] text-slate-600 space-y-0.5">
                            <span>模糊（px，上限 {POPUP_TEXT_SHADOW_BLUR_MAX}）</span>
                            <input
                              type="number"
                              min={0}
                              max={POPUP_TEXT_SHADOW_BLUR_MAX}
                              step={1}
                              value={e.shadowBlurPx ?? 4}
                              onChange={(ev) => {
                                const n = Number(ev.target.value)
                                if (!Number.isFinite(n)) return
                                patchFx({ shadowBlurPx: Math.max(0, Math.min(POPUP_TEXT_SHADOW_BLUR_MAX, n)) })
                              }}
                              className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                            />
                          </label>
                          <label className="text-[11px] text-slate-600 space-y-0.5">
                            <span>扩散（px，上限 {POPUP_TEXT_SHADOW_SIZE_MAX}）</span>
                            <input
                              type="number"
                              min={0}
                              max={POPUP_TEXT_SHADOW_SIZE_MAX}
                              step={1}
                              value={e.shadowSizePx ?? 0}
                              onChange={(ev) => {
                                const n = Number(ev.target.value)
                                if (!Number.isFinite(n)) return
                                patchFx({ shadowSizePx: Math.max(0, Math.min(POPUP_TEXT_SHADOW_SIZE_MAX, n)) })
                              }}
                              className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                            />
                          </label>
                          <label className="text-[11px] text-slate-600 space-y-0.5">
                            <span>距离（px，上限 {POPUP_TEXT_SHADOW_DISTANCE_MAX}）</span>
                            <input
                              type="number"
                              min={0}
                              max={POPUP_TEXT_SHADOW_DISTANCE_MAX}
                              step={1}
                              value={e.shadowDistancePx ?? 6}
                              onChange={(ev) => {
                                const n = Number(ev.target.value)
                                if (!Number.isFinite(n)) return
                                patchFx({ shadowDistancePx: Math.max(0, Math.min(POPUP_TEXT_SHADOW_DISTANCE_MAX, n)) })
                              }}
                              className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                            />
                          </label>
                          <label className="text-[11px] text-slate-600 space-y-0.5">
                            <span>角度（°，0=右，90=下）</span>
                            <input
                              type="number"
                              min={-360}
                              max={360}
                              step={1}
                              value={e.shadowAngleDeg ?? 45}
                              onChange={(ev) => {
                                const n = Number(ev.target.value)
                                if (!Number.isFinite(n)) return
                                patchFx({ shadowAngleDeg: Math.max(-360, Math.min(360, n)) })
                              }}
                              className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                            />
                          </label>
                        </div>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })()}
            </div>
          )}

          {!isDecoTextSelected && (
            <div className="border-t border-slate-100 pt-2 mt-1 space-y-2">
            <div className="flex items-center justify-between">
              <h5 className="text-xs font-semibold text-slate-700">变换</h5>
            </div>
            {(() => {
              const sel = selectedElements[0]
              if (!sel) return <p className="text-[11px] text-slate-400">点击预览区文字或上方按钮选中元素</p>
              const tField = panelThemeTransformField(sel)
              const defaults: Record<string, Record<TextElementKey, TextTransform>> = {
                main: {
                  content: { x: 50, y: 42, rotation: 0, scale: 1 },
                  time: { x: 50, y: 55, rotation: 0, scale: 1 },
                  date: { x: 50, y: 58, rotation: 0, scale: 1 },
                  countdown: { x: 50, y: 70, rotation: 0, scale: 1 },
                },
                rest: {
                  content: { x: 50, y: 42, rotation: 0, scale: 1 },
                  time: { x: 50, y: 55, rotation: 0, scale: 1 },
                  date: { x: 50, y: 58, rotation: 0, scale: 1 },
                  countdown: { x: 50, y: 70, rotation: 0, scale: 1 },
                },
              }
              const def = defaults[theme.target]?.[sel] ?? { x: 50, y: 50, rotation: 0, scale: 1 }
              const t: TextTransform = (theme[tField as keyof PopupTheme] as TextTransform | undefined) ?? def
              const update = (patch: Partial<TextTransform>) => mergedWrappedOnUpdateTheme(themeId, { [tField]: { ...t, ...patch } })
              return (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <label className="text-[11px] text-slate-600 space-y-0.5">
                      <span>X 位置 (%)</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={0.5}
                        value={+t.x.toFixed(1)}
                        onChange={(e) => update({ x: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                        className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                      />
                    </label>
                    <label className="text-[11px] text-slate-600 space-y-0.5">
                      <span>Y 位置 (%)</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={0.5}
                        value={+t.y.toFixed(1)}
                        onChange={(e) => update({ y: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                        className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                      />
                    </label>
                    <label className="text-[11px] text-slate-600 space-y-0.5">
                      <span>旋转 (°)</span>
                      <input
                        type="number"
                        min={-360}
                        max={360}
                        step={1}
                        value={+t.rotation.toFixed(1)}
                        onChange={(e) => update({ rotation: Math.max(-360, Math.min(360, Number(e.target.value) || 0)) })}
                        className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                      />
                    </label>
                    <label className="text-[11px] text-slate-600 space-y-0.5">
                      <span>缩放</span>
                      <input
                        type="number"
                        min={0.1}
                        max={5}
                        step={0.05}
                        value={+t.scale.toFixed(2)}
                        onChange={(e) => update({ scale: Math.max(0.1, Math.min(5, Number(e.target.value) || 1)) })}
                        className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const patch: Partial<PopupTheme> = {}
                      for (const k of selectedElements) {
                        const field = panelThemeTransformField(k)
                        const d = defaults[theme.target]?.[k] ?? { x: 50, y: 50, rotation: 0, scale: 1 }
                        ;(patch as Record<string, TextTransform>)[field] = { ...d }
                      }
                      mergedWrappedOnUpdateTheme(themeId, patch)
                    }}
                    className="text-[11px] text-indigo-600 hover:text-indigo-800"
                  >
                    {selectedElements.length >= 2 ? '将全部选中项重置为默认位置' : '重置为默认位置'}
                  </button>
                </div>
              )
            })()}
            </div>
          )}
        </div>
      )}

      {(effectivePanelFilter === 'all' || effectivePanelFilter === 'overlay') && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-slate-700">遮罩</h4>
          {(() => {
            const overlayMode = theme.overlayMode === 'gradient' ? 'gradient' : 'solid'
            const overlayOpacity = Math.max(0, Math.min(1, theme.overlayOpacity ?? 0.45))
            const gradientStartOpacity = Math.max(0, Math.min(1, theme.overlayGradientStartOpacity ?? 0.7))
            const gradientEndOpacity = Math.max(0, Math.min(1, theme.overlayGradientEndOpacity ?? 0))
            const directionRaw = theme.overlayGradientDirection ?? 'leftToRight'
            const gradientAngle =
              directionRaw === 'custom'
                ? normalizeAngleDeg(theme.overlayGradientAngleDeg, 90)
                : OVERLAY_DIRECTION_ANGLE_MAP[directionRaw as OverlayPresetDirection]
            const presetDirection = presetDirectionFromAngle(gradientAngle)
            const gradientDirectionSelect = directionRaw === 'custom'
              ? (presetDirection ?? 'custom')
              : (directionRaw as OverlayPresetDirection)
            const disabled = !theme.overlayEnabled
            const updateGradientAngle = (nextAngleRaw: number) => {
              const nextAngle = normalizeAngleDeg(nextAngleRaw, gradientAngle)
              const matchedPreset = presetDirectionFromAngle(nextAngle)
              mergedWrappedOnUpdateTheme(themeId, {
                overlayGradientAngleDeg: nextAngle,
                overlayGradientDirection: (matchedPreset ?? 'custom') as PopupTheme['overlayGradientDirection'],
              })
            }
            const updateGradientAngleByPointer = (clientX: number, clientY: number, target: HTMLDivElement) => {
              const rect = target.getBoundingClientRect()
              const cx = rect.left + rect.width / 2
              const cy = rect.top + rect.height / 2
              const dx = clientX - cx
              const dy = clientY - cy
              const angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90
              updateGradientAngle(angle)
            }
            const handleRad = (gradientAngle - 90) * Math.PI / 180
            const handleX = 24 + Math.cos(handleRad) * 18
            const handleY = 24 + Math.sin(handleRad) * 18
            return (
              <>
          <label className="inline-flex items-center gap-2 text-xs text-slate-700">
            <input
              type="checkbox"
              checked={theme.overlayEnabled}
              onChange={(e) => mergedWrappedOnUpdateTheme(themeId, { overlayEnabled: e.target.checked })}
            />
            启用遮罩
          </label>
          <label className="block space-y-1 text-xs text-slate-600">
            <span>模式</span>
            <select
              value={overlayMode}
              onChange={(e) => mergedWrappedOnUpdateTheme(themeId, { overlayMode: e.target.value === 'gradient' ? 'gradient' : 'solid' })}
              disabled={disabled}
              className="w-full rounded border border-slate-300 px-2 py-1 text-sm disabled:opacity-50"
            >
              <option value="solid">纯色</option>
              <option value="gradient">渐变</option>
            </select>
          </label>
          {overlayMode === 'solid' ? (
          <div className="grid grid-cols-[60px_minmax(0,1fr)] items-center gap-2 text-xs text-slate-600">
            <span>颜色</span>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <PopupThemeColorSwatch
                value={theme.overlayColor}
                onChange={(v, m) => mergedWrappedOnUpdateTheme(themeId, { overlayColor: v }, m)}
                disabled={disabled}
              />
              <span className="shrink-0 text-slate-500">透明度</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={overlayOpacity}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  if (!Number.isFinite(n)) return
                  mergedWrappedOnUpdateTheme(themeId, { overlayOpacity: Math.max(0, Math.min(1, n)) })
                }}
                disabled={disabled}
                className="min-w-[80px] flex-1 accent-indigo-600 disabled:opacity-50"
              />
              <input
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={overlayOpacity}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  if (!Number.isFinite(n)) return
                  mergedWrappedOnUpdateTheme(themeId, { overlayOpacity: Math.max(0, Math.min(1, n)) })
                }}
                disabled={disabled}
                className="w-[72px] shrink-0 rounded border border-slate-300 px-2 py-1 text-sm disabled:opacity-50"
              />
            </div>
          </div>
          ) : (
            <>
              <div className="grid grid-cols-[60px_minmax(0,1fr)] items-center gap-2 text-xs text-slate-600">
                <span>颜色</span>
                <PopupThemeColorSwatch
                  value={theme.overlayColor}
                  onChange={(v, m) => mergedWrappedOnUpdateTheme(themeId, { overlayColor: v }, m)}
                  disabled={disabled}
                />
              </div>
              <label className="block space-y-1 text-xs text-slate-600">
                <span>方向</span>
                <select
                  value={gradientDirectionSelect}
                  onChange={(e) => {
                    const next = e.target.value as PopupTheme['overlayGradientDirection']
                    if (next === 'custom') {
                      mergedWrappedOnUpdateTheme(themeId, { overlayGradientDirection: 'custom' })
                      return
                    }
                    const nextAngle = OVERLAY_DIRECTION_ANGLE_MAP[next as OverlayPresetDirection] ?? gradientAngle
                    mergedWrappedOnUpdateTheme(themeId, {
                      overlayGradientDirection: next,
                      overlayGradientAngleDeg: nextAngle,
                    })
                  }}
                  disabled={disabled}
                  className="w-full rounded border border-slate-300 px-2 py-1 text-sm disabled:opacity-50"
                >
                  <option value="leftToRight">左 → 右</option>
                  <option value="rightToLeft">右 → 左</option>
                  <option value="topToBottom">上 → 下</option>
                  <option value="bottomToTop">下 → 上</option>
                  <option value="topLeftToBottomRight">左上 → 右下</option>
                  <option value="topRightToBottomLeft">右上 → 左下</option>
                  <option value="bottomLeftToTopRight">左下 → 右上</option>
                  <option value="bottomRightToTopLeft">右下 → 左上</option>
                  <option value="custom">自定义角度</option>
                </select>
              </label>
              <div className="grid grid-cols-[60px_minmax(0,1fr)_72px] items-center gap-2 text-xs text-slate-600">
                <span>角度</span>
                <div className="flex items-center gap-3">
                  <div
                    role="slider"
                    aria-label="遮罩渐变角度表盘"
                    aria-valuemin={0}
                    aria-valuemax={359}
                    aria-valuenow={Math.round(gradientAngle)}
                    tabIndex={disabled ? -1 : 0}
                    onPointerDown={(e) => {
                      if (disabled) return
                      const el = e.currentTarget as HTMLDivElement
                      el.setPointerCapture(e.pointerId)
                      updateGradientAngleByPointer(e.clientX, e.clientY, el)
                    }}
                    onPointerMove={(e) => {
                      if (disabled || (e.buttons & 1) !== 1) return
                      updateGradientAngleByPointer(
                        e.clientX,
                        e.clientY,
                        e.currentTarget as HTMLDivElement,
                      )
                    }}
                    onKeyDown={(e) => {
                      if (disabled) return
                      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
                        e.preventDefault()
                        updateGradientAngle(gradientAngle - 1)
                      } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
                        e.preventDefault()
                        updateGradientAngle(gradientAngle + 1)
                      }
                    }}
                    className={`relative w-14 aspect-square shrink-0 rounded-full ${disabled ? 'opacity-50' : 'cursor-pointer'}`}
                  >
                    <svg viewBox="0 0 48 48" className="h-full w-full" aria-hidden>
                      <circle cx="24" cy="24" r="18" fill="#fff" stroke="#cbd5e1" strokeWidth="1.5" />
                      <circle cx="24" cy="24" r="1.2" fill="#94a3b8" />
                      <circle cx={handleX} cy={handleY} r="3.2" fill="#ef4444" />
                    </svg>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={359}
                    step={1}
                    value={Math.round(gradientAngle)}
                    onChange={(e) => updateGradientAngle(Number(e.target.value))}
                    disabled={disabled}
                    className="w-full accent-indigo-600 disabled:opacity-50"
                  />
                </div>
                <input
                  type="number"
                  min={0}
                  max={359}
                  step={1}
                  value={Math.round(gradientAngle)}
                  onChange={(e) => {
                    const n = Number(e.target.value)
                    if (!Number.isFinite(n)) return
                    updateGradientAngle(n)
                  }}
                  disabled={disabled}
                  className="w-full rounded border border-slate-300 px-2 py-1 text-sm disabled:opacity-50"
                />
              </div>
              <div className="grid grid-cols-[60px_minmax(0,1fr)_72px] items-center gap-2 text-xs text-slate-600">
                <span>起点透明</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={gradientStartOpacity}
                  onChange={(e) => {
                    const n = Number(e.target.value)
                    if (!Number.isFinite(n)) return
                    mergedWrappedOnUpdateTheme(themeId, { overlayGradientStartOpacity: Math.max(0, Math.min(1, n)) })
                  }}
                  disabled={disabled}
                  className="w-full accent-indigo-600 disabled:opacity-50"
                />
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={gradientStartOpacity}
                  onChange={(e) => {
                    const n = Number(e.target.value)
                    if (!Number.isFinite(n)) return
                    mergedWrappedOnUpdateTheme(themeId, { overlayGradientStartOpacity: Math.max(0, Math.min(1, n)) })
                  }}
                  disabled={disabled}
                  className="w-full rounded border border-slate-300 px-2 py-1 text-sm disabled:opacity-50"
                />
              </div>
              <div className="grid grid-cols-[60px_minmax(0,1fr)_72px] items-center gap-2 text-xs text-slate-600">
                <span>终点透明</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={gradientEndOpacity}
                  onChange={(e) => {
                    const n = Number(e.target.value)
                    if (!Number.isFinite(n)) return
                    mergedWrappedOnUpdateTheme(themeId, { overlayGradientEndOpacity: Math.max(0, Math.min(1, n)) })
                  }}
                  disabled={disabled}
                  className="w-full accent-indigo-600 disabled:opacity-50"
                />
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={gradientEndOpacity}
                  onChange={(e) => {
                    const n = Number(e.target.value)
                    if (!Number.isFinite(n)) return
                    mergedWrappedOnUpdateTheme(themeId, { overlayGradientEndOpacity: Math.max(0, Math.min(1, n)) })
                  }}
                  disabled={disabled}
                  className="w-full rounded border border-slate-300 px-2 py-1 text-sm disabled:opacity-50"
                />
              </div>
            </>
          )}
              </>
            )
          })()}
        </div>
      )}

      {(effectivePanelFilter === 'all' || effectivePanelFilter === 'background') && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-slate-700">背景</h4>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-xs text-slate-600 space-y-1">
              <span>背景类型</span>
              <select
                value={theme.backgroundType}
                onChange={(e) => mergedWrappedOnUpdateTheme(themeId, { backgroundType: e.target.value as PopupTheme['backgroundType'] })}
                className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
              >
                <option value="solid">纯色</option>
                <option value="image">图片</option>
              </select>
            </label>
            {theme.backgroundType === 'solid' && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                <span className="shrink-0">背景色</span>
                <PopupThemeColorSwatch
                  value={theme.backgroundColor}
                  onChange={(v, m) => mergedWrappedOnUpdateTheme(themeId, { backgroundColor: v }, m)}
                />
              </div>
            )}
          </div>

          {theme.backgroundType === 'image' && (
            <div className="space-y-2">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {onPickImageFile && (
                  <button
                    type="button"
                    onClick={() => void onPickImageFile()}
                    className="rounded border border-slate-300 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50"
                  >
                    选择单个图片
                  </button>
                )}
                {onPickImageFolder && (
                  <button
                    type="button"
                    onClick={() => void onPickImageFolder()}
                    className="rounded border border-slate-300 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50"
                  >
                    选择图片文件夹（轮播）
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <label className="text-xs text-slate-600 space-y-1">
                  <span>图片来源</span>
                  <select
                    value={theme.imageSourceType ?? 'single'}
                    onChange={(e) => mergedWrappedOnUpdateTheme(themeId, { imageSourceType: e.target.value as 'single' | 'folder' })}
                    className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  >
                    <option value="single">单图</option>
                    <option value="folder">文件夹</option>
                  </select>
                </label>
                {(theme.imageSourceType ?? 'single') === 'folder' && (
                  <>
                    <label className="text-xs text-slate-600 space-y-1">
                      <span>轮播模式</span>
                      <select
                        value={theme.imageFolderPlayMode ?? 'sequence'}
                        onChange={(e) => mergedWrappedOnUpdateTheme(themeId, { imageFolderPlayMode: e.target.value as 'sequence' | 'random' })}
                        className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                      >
                        <option value="sequence">顺序</option>
                        <option value="random">随机</option>
                      </select>
                    </label>
                    <label className="text-xs text-slate-600 space-y-1">
                      <span>切换间隔（秒）</span>
                      <input
                        type="number"
                        min={1}
                        max={3600}
                        value={theme.imageFolderIntervalSec ?? 30}
                        onChange={(e) => mergedWrappedOnUpdateTheme(themeId, { imageFolderIntervalSec: Math.max(1, Math.min(3600, Number(e.target.value) || 1)) })}
                        className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                      />
                    </label>
                    <label className="text-xs text-slate-600 space-y-1">
                      <span>交叠过渡（秒）</span>
                      <input
                        type="number"
                        min={0.5}
                        max={POPUP_FOLDER_CROSSFADE_MAX_SEC}
                        step={0.5}
                        value={theme.imageFolderCrossfadeSec ?? 2}
                        onChange={(e) =>
                          mergedWrappedOnUpdateTheme(themeId, {
                            imageFolderCrossfadeSec: Math.max(
                              0.5,
                              Math.min(POPUP_FOLDER_CROSSFADE_MAX_SEC, Number(e.target.value) || 2),
                            ),
                          })
                        }
                        className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                      />
                    </label>
                  </>
                )}
              </div>
              <p className="text-xs text-slate-500">
                {(theme.imageSourceType ?? 'single') === 'folder'
                  ? `文件夹：${theme.imageFolderPath ?? '未选择'}（共 ${theme.imageFolderFiles?.length ?? 0} 张）`
                  : `当前图片：${theme.imagePath ?? '未选择'}`}
              </p>
              <label className="block text-xs text-slate-600 space-y-1">
                <span>手动路径（可选）</span>
                <input
                  type="text"
                  value={theme.imagePath ?? ''}
                  onChange={(e) => mergedWrappedOnUpdateTheme(themeId, { imagePath: e.target.value, imageSourceType: 'single' })}
                  className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  placeholder="例如：C:\\images\\wallpaper.jpg"
                />
              </label>
              {(() => {
                const bRaw = Math.round(Number(theme.backgroundImageBlurPx))
                const bgBlur = Number.isFinite(bRaw)
                  ? Math.max(0, Math.min(POPUP_BACKGROUND_IMAGE_BLUR_MAX_PX, bRaw))
                  : 0
                const setBlur = (n: number) =>
                  mergedWrappedOnUpdateTheme(themeId, {
                    backgroundImageBlurPx: Math.max(0, Math.min(POPUP_BACKGROUND_IMAGE_BLUR_MAX_PX, Math.round(n))),
                  })
                return (
                  <div className="grid grid-cols-[60px_minmax(0,1fr)_72px] items-center gap-2 text-xs text-slate-600">
                    <span>模糊</span>
                    <input
                      type="range"
                      min={0}
                      max={POPUP_BACKGROUND_IMAGE_BLUR_MAX_PX}
                      step={1}
                      value={bgBlur}
                      onChange={(e) => {
                        const n = Number(e.target.value)
                        if (!Number.isFinite(n)) return
                        setBlur(n)
                      }}
                      className="w-full accent-indigo-600"
                    />
                    <input
                      type="number"
                      min={0}
                      max={POPUP_BACKGROUND_IMAGE_BLUR_MAX_PX}
                      step={1}
                      value={bgBlur}
                      onChange={(e) => {
                        const n = Number(e.target.value)
                        if (!Number.isFinite(n)) return
                        setBlur(n)
                      }}
                      className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                    />
                  </div>
                )
              })()}
            </div>
          )}
        </div>
      )}
          </div>
        )}
      </div>
    </div>
  )
}
