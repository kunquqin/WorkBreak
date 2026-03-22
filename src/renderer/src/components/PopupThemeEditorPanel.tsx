import { useRef, useEffect, useState, useCallback, useMemo, type RefObject } from 'react'
import { ThemePreviewEditor, type TextElementKey } from './ThemePreviewEditor'
import type { PopupLayerTextEffects, PopupTheme, TextTransform } from '../types'
import { usePopupThemeEditHistory } from '../hooks/usePopupThemeEditHistory'
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
import { PopupThemeLayersBar } from './PopupThemeLayersBar'
import type { ImageThemeLayer, TextThemeLayer } from '../../../shared/popupThemeLayers'
import {
  POPUP_LAYER_BACKGROUND_ID,
  POPUP_LAYER_OVERLAY_ID,
  mergeContentThemePatchIntoBindingTextLayer,
  themePatchFromBindingTextLayer,
  updateDecorationLayer,
  updateTextLayer,
} from '../../../shared/popupThemeLayers'

function layerTypographyKeys(sel: TextElementKey): {
  align: 'contentTextAlign' | 'timeTextAlign' | 'countdownTextAlign'
  letterSpacing: 'contentLetterSpacing' | 'timeLetterSpacing' | 'countdownLetterSpacing'
  lineHeight: 'contentLineHeight' | 'timeLineHeight' | 'countdownLineHeight'
} {
  if (sel === 'content') return { align: 'contentTextAlign', letterSpacing: 'contentLetterSpacing', lineHeight: 'contentLineHeight' }
  if (sel === 'time') return { align: 'timeTextAlign', letterSpacing: 'timeLetterSpacing', lineHeight: 'timeLineHeight' }
  return { align: 'countdownTextAlign', letterSpacing: 'countdownLetterSpacing', lineHeight: 'countdownLineHeight' }
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

function layerEffectsKey(sel: TextElementKey): 'contentTextEffects' | 'timeTextEffects' | 'countdownTextEffects' {
  if (sel === 'content') return 'contentTextEffects'
  if (sel === 'time') return 'timeTextEffects'
  return 'countdownTextEffects'
}

export type ThemeSettingsPanelFilter = 'all' | 'text' | 'overlay' | 'background'

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
}

/**
 * 弹窗主题完整编辑区：预览 + 参数区（按图层选中自动切换可见块）。
 * 设置页与子项全屏编辑器共用。
 */
export function PopupThemeEditorPanel({
  theme,
  onUpdateTheme,
  replaceThemeFull,
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
}: PopupThemeEditorPanelProps) {
  const themeId = theme.id
  const layoutContainerRef = useRef<HTMLDivElement>(null)
  const undoScopeRef: RefObject<HTMLElement | null> = editorSurfaceRef ?? layoutContainerRef
  const [layersRailHidden, setLayersRailHidden] = useState(false)
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
  const { wrappedOnUpdateTheme, undo, redo, canUndo, canRedo } = usePopupThemeEditHistory(
    theme,
    onUpdateTheme,
    replaceThemeFull,
  )

  const mergedWrappedOnUpdateTheme = useCallback(
    (id: string, patch: Partial<PopupTheme>) => {
      if (id !== themeId) {
        wrappedOnUpdateTheme(id, patch)
        return
      }
      const layerSync = mergeContentThemePatchIntoBindingTextLayer(theme, patch)
      wrappedOnUpdateTheme(id, layerSync ? { ...patch, ...layerSync } : patch)
    },
    [themeId, theme, wrappedOnUpdateTheme],
  )

  const [fontUiMode, setFontUiMode] = useState<Record<PopupTextFontLayer, 'preset' | 'system'>>(() => ({
    content: popupFontLayerUsesSystemTab(theme, 'content') ? 'system' : 'preset',
    time: popupFontLayerUsesSystemTab(theme, 'time') ? 'system' : 'preset',
    countdown: popupFontLayerUsesSystemTab(theme, 'countdown') ? 'system' : 'preset',
  }))
  useEffect(() => {
    setFontUiMode({
      content: popupFontLayerUsesSystemTab(theme, 'content') ? 'system' : 'preset',
      time: popupFontLayerUsesSystemTab(theme, 'time') ? 'system' : 'preset',
      countdown: popupFontLayerUsesSystemTab(theme, 'countdown') ? 'system' : 'preset',
    })
  }, [
    theme.id,
    theme.contentFontFamilySystem,
    theme.timeFontFamilySystem,
    theme.countdownFontFamilySystem,
    theme.popupFontFamilySystem,
    theme.contentFontFamilyPreset,
    theme.timeFontFamilyPreset,
    theme.countdownFontFamilyPreset,
    theme.popupFontFamilyPreset,
  ])

  const [systemFonts, setSystemFonts] = useState<string[] | null>(null)
  const [fontsLoading, setFontsLoading] = useState(false)
  const loadSystemFonts = useCallback(async (forceRefresh: boolean) => {
    const api = window.electronAPI
    if (!api?.getSystemFontFamilies) return
    setFontsLoading(true)
    try {
      if (forceRefresh && api.clearSystemFontListCache) await api.clearSystemFontListCache()
      const r = await api.getSystemFontFamilies()
      if (r.success) setSystemFonts(r.fonts)
      else setSystemFonts([])
    } catch {
      setSystemFonts([])
    } finally {
      setFontsLoading(false)
    }
  }, [])

  useEffect(() => {
    setSystemFonts(null)
  }, [theme.id])

  const needsSystemFontList = fontUiMode.content === 'system' || fontUiMode.time === 'system'
  useEffect(() => {
    if (!needsSystemFontList) return
    if (systemFonts !== null || fontsLoading) return
    if (!window.electronAPI?.getSystemFontFamilies) return
    void loadSystemFonts(false)
  }, [needsSystemFontList, systemFonts, fontsLoading, loadSystemFonts])

  const fontLayers: { layer: PopupTextFontLayer; title: string }[] = [
    { layer: 'content', title: '文本' },
    { layer: 'time', title: '时间' },
  ]

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      if (e.key.toLowerCase() !== 'z') return
      const t = e.target as HTMLElement | null
      if (!t?.closest) return
      if (t.closest('input, textarea, select, [contenteditable="true"]')) return
      if (!undoScopeRef.current?.contains(t)) return
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
    }
    document.addEventListener('keydown', fn, true)
    return () => document.removeEventListener('keydown', fn, true)
  }, [undo, redo, undoScopeRef])

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
      (selectedElements[0] === 'content' || selectedElements[0] === 'time')
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
  const showBothFontColumns = !hidePrimaryTextForms && selectedElements.length >= 2
  const showContentColumn = !hidePrimaryTextForms && (contentOnlySelection || showBothFontColumns)
  const showTimeColumn = !hidePrimaryTextForms && (timeOnlySelection || showBothFontColumns)
  const showIdleTextHint =
    !hidePrimaryTextForms &&
    selectedElements.length === 0 &&
    selectedStructuralLayerId == null &&
    decoLayer == null

  return (
    <div
      ref={layoutContainerRef}
      className={`flex min-h-0 flex-1 flex-col overflow-hidden ${className ?? ''}`}
      data-popup-theme-editor-panel
    >
      <div
        className={
          layersRailHidden
            ? 'shrink-0 border-b border-slate-200 bg-white px-2 py-1'
            : 'flex min-h-0 shrink-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-slate-50/95 px-2 py-2'
        }
        style={layersRailHidden ? undefined : { height: layersPanelHeight, minHeight: 96 }}
      >
        <PopupThemeLayersBar
          theme={theme}
          onUpdateTheme={mergedWrappedOnUpdateTheme}
          selectedElements={selectedElements}
          onSelectElements={onSelectElements}
          selectedDecorationLayerId={selectedDecorationLayerId}
          onSelectDecorationLayer={onSelectDecorationLayer}
          onPickDecoImage={onPickDecoImage}
          railHidden={layersRailHidden}
          onRailHiddenChange={setLayersRailHidden}
          className={layersRailHidden ? '' : 'min-h-0 flex-1'}
          selectedStructuralLayerId={selectedStructuralLayerId}
          onSelectStructuralLayer={onSelectStructuralLayer}
        />
      </div>
      {!layersRailHidden && (
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
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
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
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 py-2">
      <div className="flex flex-wrap items-center justify-end gap-2 rounded-md border border-slate-200 bg-white px-3 py-2">
        <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5">
          <button
            type="button"
            title="撤销 Ctrl+Z"
            disabled={!canUndo}
            onClick={() => undo()}
            className={`rounded px-2 py-1 text-xs transition-colors ${canUndo ? 'text-slate-700 hover:bg-slate-100' : 'text-slate-300 cursor-not-allowed'}`}
          >
            撤销
          </button>
          <button
            type="button"
            title="重做 Ctrl+Shift+Z"
            disabled={!canRedo}
            onClick={() => redo()}
            className={`rounded px-2 py-1 text-xs transition-colors ${canRedo ? 'text-slate-700 hover:bg-slate-100' : 'text-slate-300 cursor-not-allowed'}`}
          >
            重做
          </button>
        </div>
      </div>
      {(effectivePanelFilter === 'all' || effectivePanelFilter === 'text') &&
        decoLayer &&
        decoLayer.kind === 'text' &&
        !(decoLayer as TextThemeLayer).bindsReminderBody &&
        (() => {
          const td = decoLayer as TextThemeLayer
          const pushDeco = (patch: Partial<TextThemeLayer>) => {
            const p = updateTextLayer(theme, td.id, patch)
            if (p) mergedWrappedOnUpdateTheme(themeId, p)
          }
          return (
            <div className="rounded-md border border-teal-200 bg-teal-50/40 p-3 space-y-2">
              <h4 className="text-xs font-semibold text-teal-900">文本 · 属性</h4>
            <label className="block space-y-1 text-xs text-slate-600">
              <span>层内文字</span>
              <textarea
                rows={4}
                value={td.text ?? ''}
                onChange={(e) => pushDeco({ text: e.target.value.slice(0, 2000) })}
                className="w-full resize-y rounded border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="space-y-1 text-xs text-slate-600">
                <span>颜色</span>
                <input
                  type="color"
                  value={/^#[0-9a-fA-F]{3,6}$/.test((td.color ?? '#fff').trim()) ? td.color! : '#ffffff'}
                  onChange={(e) => pushDeco({ color: e.target.value })}
                  className="h-9 w-full rounded border border-slate-300 bg-white"
                />
              </label>
              <label className="space-y-1 text-xs text-slate-600">
                <span>字号</span>
                <input
                  type="number"
                  min={1}
                  max={8000}
                  value={td.fontSize ?? 28}
                  onChange={(e) => {
                    const n = Math.floor(Number(e.target.value))
                    if (!Number.isFinite(n)) return
                    pushDeco({ fontSize: Math.max(1, Math.min(8000, n)) })
                  }}
                  className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                />
              </label>
            </div>
            <label className="block space-y-1 text-xs text-slate-600">
              <span>对齐</span>
              <select
                value={td.textAlign ?? ''}
                onChange={(e) => {
                  const v = e.target.value
                  pushDeco({
                    textAlign: v === '' ? undefined : (v as 'left' | 'center' | 'right'),
                  })
                }}
                className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
              >
                <option value="">随全局</option>
                <option value="left">左对齐</option>
                <option value="center">居中</option>
                <option value="right">右对齐</option>
              </select>
            </label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="space-y-1 text-xs text-slate-600">
                <span>字间距（px）</span>
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
              <label className="space-y-1 text-xs text-slate-600">
                <span>行高</span>
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
            <label className="block space-y-1 text-xs text-slate-600">
              <span>字重</span>
              <select
                value={td.fontWeight ?? 500}
                onChange={(e) => pushDeco({ fontWeight: Number(e.target.value) })}
                className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
              >
                {[400, 500, 600, 700, 800].map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </label>
              <p className="text-[10px] text-slate-500">位置、旋转与缩放请在左侧预览中拖拽。</p>
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
        <div className="rounded-md border border-slate-200 bg-white p-3 space-y-2">
          <h4 className="text-xs font-semibold text-slate-700">文字</h4>
          {showIdleTextHint && (
            <p className="text-[11px] text-slate-600 leading-relaxed">
              在图层栏选择「文本」或「时间」后再编辑对应字体与颜色；未选层时不改动根字体参数。
            </p>
          )}
          {showContentColumn && (
            <label className="block space-y-1 text-xs text-slate-600">
              <span>文本内容</span>
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
              <p className="text-[10px] leading-snug text-slate-500">
                {onLiveTextCommit
                  ? '写入主题并同步绑定文本层；与子项表单联动时亦更新本条文案。'
                  : '写入主题并同步绑定文本层；与左侧预览双击编辑互通。'}
              </p>
            </label>
          )}
          <div className="space-y-3 rounded-md border border-slate-100 bg-slate-50/80 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-medium text-slate-700">
                {showContentColumn && showTimeColumn
                  ? '弹窗字体（文本 / 时间 各自独立）'
                  : showTimeColumn
                    ? '时间 · 字体'
                    : '文本 · 字体'}
              </p>
              <button
                type="button"
                disabled={fontsLoading || !window.electronAPI?.getSystemFontFamilies}
                onClick={() => void loadSystemFonts(true)}
                className="shrink-0 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {fontsLoading ? '读取字体中…' : '重新扫描本机字体'}
              </button>
            </div>
            {!window.electronAPI?.getSystemFontFamilies && (
              <p className="text-[11px] text-amber-700">当前环境非 Electron，无法枚举本机字体。</p>
            )}
            {fontLayers
              .filter(
                ({ layer }) =>
                  (layer === 'content' && showContentColumn) || (layer === 'time' && showTimeColumn),
              )
              .map(({ layer, title }) => (
              <div key={layer} className="space-y-2 rounded-md border border-white/90 bg-white/70 p-2">
                <p className="text-[11px] font-semibold text-slate-700">{title}</p>
                <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setFontUiMode((m) => ({ ...m, [layer]: 'preset' }))
                      const p: Partial<PopupTheme> =
                        layer === 'content'
                          ? { contentFontFamilySystem: undefined }
                          : layer === 'time'
                            ? { timeFontFamilySystem: undefined }
                            : { countdownFontFamilySystem: undefined }
                      mergedWrappedOnUpdateTheme(themeId, p)
                    }}
                    className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                      fontUiMode[layer] === 'preset' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    预设组合
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFontUiMode((m) => ({ ...m, [layer]: 'system' }))
                      void loadSystemFonts(false)
                    }}
                    className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                      fontUiMode[layer] === 'system' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    本机已安装
                  </button>
                </div>
                {fontUiMode[layer] === 'preset' ? (
                  <label className="block text-[11px] text-slate-600 space-y-1">
                    <span>内置字体栈</span>
                    <select
                      value={popupFontPresetSelectValue(theme, layer)}
                      onChange={(e) => {
                        const v = e.target.value
                        const presetVal = v === DEFAULT_POPUP_FONT_PRESET_ID ? undefined : v
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
                        } else {
                          mergedWrappedOnUpdateTheme(themeId, {
                            countdownFontFamilyPreset: presetVal,
                            countdownFontFamilySystem: undefined,
                          })
                        }
                      }}
                      className="w-full max-w-xl rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
                    >
                      {POPUP_FONT_FAMILY_OPTIONS.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <div className="space-y-1 max-w-xl">
                    <p className="text-[10px] text-slate-500">点击输入区或右侧箭头展开列表，列表内以该字体显示名称；各层字体互不影响。</p>
                    <SystemFontFamilyPicker
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
                        } else {
                          mergedWrappedOnUpdateTheme(themeId, {
                            countdownFontFamilySystem: sys,
                            countdownFontFamilyPreset: undefined,
                          })
                        }
                      }}
                    />
                  </div>
                )}
              </div>
            ))}
            {window.electronAPI?.getSystemFontFamilies && systemFonts !== null && systemFonts.length === 0 && !fontsLoading && (
              <p className="text-[11px] text-amber-700">未读到字体列表，可点「重新扫描」或直接在输入框填写字体全名。</p>
            )}
          </div>
          {(showContentColumn || showTimeColumn) && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {showContentColumn && (
                <label className="text-xs text-slate-600 space-y-1">
                  <span>文本颜色</span>
                  <input
                    type="color"
                    value={theme.contentColor}
                    onChange={(e) => mergedWrappedOnUpdateTheme(themeId, { contentColor: e.target.value })}
                    className="h-8 w-full rounded border border-slate-300 bg-white"
                  />
                </label>
              )}
              {showTimeColumn && (
                <label className="text-xs text-slate-600 space-y-1">
                  <span>时间颜色</span>
                  <input
                    type="color"
                    value={theme.timeColor}
                    onChange={(e) => mergedWrappedOnUpdateTheme(themeId, { timeColor: e.target.value })}
                    className="h-8 w-full rounded border border-slate-300 bg-white"
                  />
                </label>
              )}
            </div>
          )}
          {(showContentColumn || showTimeColumn) && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {showContentColumn && (
                <label className="text-xs text-slate-600 space-y-1">
                  <span>文本字号</span>
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
                </label>
              )}
              {showTimeColumn && (
                <label className="text-xs text-slate-600 space-y-1">
                  <span>时间字号</span>
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
                </label>
              )}
            </div>
          )}
          {(showContentColumn || showTimeColumn || showIdleTextHint) && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="text-xs text-slate-600 space-y-1">
                <span>文字对齐（全局默认）</span>
                <select
                  value={theme.textAlign}
                  onChange={(e) =>
                    mergedWrappedOnUpdateTheme(themeId, { textAlign: e.target.value as PopupTheme['textAlign'] })
                  }
                  className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                >
                  <option value="left">左对齐</option>
                  <option value="center">居中</option>
                  <option value="right">右对齐</option>
                </select>
              </label>
            </div>
          )}
          {(showContentColumn || showTimeColumn) && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {showContentColumn && (
                <label className="text-xs text-slate-600 space-y-1">
                  <span>文本字重</span>
                  <select
                    value={theme.contentFontWeight ?? 600}
                    onChange={(e) => mergedWrappedOnUpdateTheme(themeId, { contentFontWeight: Number(e.target.value) })}
                    className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  >
                    <option value={100}>100 Thin</option>
                    <option value={200}>200 Extra Light</option>
                    <option value={300}>300 Light</option>
                    <option value={400}>400 Normal</option>
                    <option value={500}>500 Medium</option>
                    <option value={600}>600 Semi Bold</option>
                    <option value={700}>700 Bold</option>
                    <option value={800}>800 Extra Bold</option>
                    <option value={900}>900 Black</option>
                  </select>
                </label>
              )}
              {showTimeColumn && (
                <label className="text-xs text-slate-600 space-y-1">
                  <span>时间字重</span>
                  <select
                    value={theme.timeFontWeight ?? 400}
                    onChange={(e) => mergedWrappedOnUpdateTheme(themeId, { timeFontWeight: Number(e.target.value) })}
                    className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  >
                    <option value={100}>100 Thin</option>
                    <option value={200}>200 Extra Light</option>
                    <option value={300}>300 Light</option>
                    <option value={400}>400 Normal</option>
                    <option value={500}>500 Medium</option>
                    <option value={600}>600 Semi Bold</option>
                    <option value={700}>700 Bold</option>
                    <option value={800}>800 Extra Bold</option>
                    <option value={900}>900 Black</option>
                  </select>
                </label>
              )}
            </div>
          )}

          <div className="rounded-md border border-indigo-100 bg-indigo-50/50 p-3 space-y-2">
            <h5 className="text-xs font-semibold text-slate-700">当前选中层 · 排版</h5>
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
                const { align, letterSpacing, lineHeight } = layerTypographyKeys(sel)
                const layerName = sel === 'content' ? '文本' : sel === 'time' ? '时间' : '倒计时'
                const inheritAlign = ''
                const curAlign = (theme[align] as string | undefined) ?? inheritAlign
                const lsVal = theme[letterSpacing]
                const lhDefault = sel === 'countdown' ? 1 : 1.35
                const lhVal = theme[lineHeight] ?? lhDefault
                return (
                  <div className="space-y-2">
                    <p className="text-[11px] text-indigo-600">
                      层：{layerName}
                      {selectedElements.length >= 2 ? `（多选时以下仅针对「${layerName}」）` : ''}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] text-slate-500 shrink-0">对齐</span>
                      <div className="inline-flex rounded border border-slate-300 bg-white p-0.5">
                        {(['', 'left', 'center', 'right'] as const).map((v) => (
                          <button
                            key={v || 'inherit'}
                            type="button"
                            onClick={() =>
                              mergedWrappedOnUpdateTheme(themeId, {
                                [align]: (v === '' ? undefined : v) as PopupTheme[typeof align],
                              })
                            }
                            className={`rounded px-2 py-0.5 text-[11px] ${
                              (v === '' && !theme[align]) || v === curAlign
                                ? 'bg-slate-800 text-white'
                                : 'text-slate-600 hover:bg-slate-100'
                            }`}
                          >
                            {v === '' ? '随全局' : v === 'left' ? '左' : v === 'center' ? '中' : '右'}
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
                        <span>行高（{sel === 'countdown' ? '倒计时建议 1～1.4' : '建议 1.1～2'})</span>
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
                    <p className="text-[10px] text-slate-400">字间距 0、行高按默认即可与经典弹窗观感一致。</p>
                  </div>
                )
              })()
            )}
          </div>

          {selectedElements.length > 0 && (effectivePanelFilter === 'all' || effectivePanelFilter === 'text') && (
            <div className="rounded-md border border-amber-100 bg-amber-50/40 p-3 space-y-2">
              <h5 className="text-xs font-semibold text-slate-700">当前选中层 · 描边与阴影</h5>
              {(() => {
                const sel = selectedElements[0]
                const layerName = sel === 'content' ? '文本' : sel === 'time' ? '时间' : '倒计时'
                const ek = layerEffectsKey(sel)
                const e: PopupLayerTextEffects = theme[ek] ?? {}
                const patchFx = (p: Partial<PopupLayerTextEffects>) =>
                  mergedWrappedOnUpdateTheme(themeId, { [ek]: { ...e, ...p } } as Partial<PopupTheme>)
                return (
                  <div className="space-y-3">
                    <p className="text-[11px] text-amber-800/90">
                      层：{layerName}
                      {selectedElements.length >= 2 ? `（多选时以下仅针对「${layerName}」）` : ''}；弹窗内为逻辑像素，与预览比例一致。
                    </p>
                    <div className="space-y-2 rounded border border-white/80 bg-white/60 p-2">
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
                        文字描边
                      </label>
                      {e.strokeEnabled === true && (
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                          <label className="text-[11px] text-slate-600 space-y-0.5">
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
                              className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                            />
                          </label>
                          <label className="text-[11px] text-slate-600 space-y-0.5">
                            <span>颜色</span>
                            <input
                              type="color"
                              value={/^#[0-9a-fA-F]{3,6}$/.test((e.strokeColor ?? '#000').trim()) ? (e.strokeColor ?? '#000000') : '#000000'}
                              onChange={(ev) => patchFx({ strokeColor: ev.target.value })}
                              className="h-8 w-full rounded border border-slate-300 bg-white"
                            />
                          </label>
                          <label className="text-[11px] text-slate-600 space-y-0.5">
                            <span>不透明度（0–1）</span>
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
                              className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                            />
                          </label>
                        </div>
                      )}
                    </div>
                    <div className="space-y-2 rounded border border-white/80 bg-white/60 p-2">
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
                        文字阴影
                      </label>
                      {e.shadowEnabled === true && (
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          <label className="text-[11px] text-slate-600 space-y-0.5">
                            <span>颜色</span>
                            <input
                              type="color"
                              value={/^#[0-9a-fA-F]{3,6}$/.test((e.shadowColor ?? '#000').trim()) ? (e.shadowColor ?? '#000000') : '#000000'}
                              onChange={(ev) => patchFx({ shadowColor: ev.target.value })}
                              className="h-8 w-full rounded border border-slate-300 bg-white"
                            />
                          </label>
                          <label className="text-[11px] text-slate-600 space-y-0.5">
                            <span>不透明度（0–1）</span>
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
                              className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                            />
                          </label>
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
                      )}
                    </div>
                  </div>
                )
              })()}
            </div>
          )}

          <div className="border-t border-slate-100 pt-2 mt-1 space-y-2">
            <div className="flex items-center justify-between">
              <h5 className="text-xs font-semibold text-slate-700">位置与变换</h5>
              <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5">
                {(['content', 'time'] as const).map((elKey) => {
                  const active = selectedElements.includes(elKey)
                  return (
                    <button
                      key={elKey}
                      type="button"
                      onClick={() => {
                        if (active) onSelectElements(selectedElements.filter((k) => k !== elKey))
                        else onSelectElements([...selectedElements, elKey])
                      }}
                      className={`rounded px-2 py-0.5 text-[11px] transition-colors ${active ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                    >
                      {elKey === 'content' ? '文本' : '时间'}
                    </button>
                  )
                })}
              </div>
            </div>
            {(() => {
              const sel = selectedElements[0]
              if (!sel) return <p className="text-[11px] text-slate-400">点击预览区文字或上方按钮选中元素</p>
              const tField = sel === 'content' ? 'contentTransform' : sel === 'time' ? 'timeTransform' : 'countdownTransform'
              const defaults: Record<string, Record<TextElementKey, TextTransform>> = {
                main: {
                  content: { x: 50, y: 42, rotation: 0, scale: 1 },
                  time: { x: 50, y: 55, rotation: 0, scale: 1 },
                  countdown: { x: 50, y: 70, rotation: 0, scale: 1 },
                },
                rest: {
                  content: { x: 50, y: 42, rotation: 0, scale: 1 },
                  time: { x: 50, y: 55, rotation: 0, scale: 1 },
                  countdown: { x: 50, y: 70, rotation: 0, scale: 1 },
                },
              }
              const def = defaults[theme.target]?.[sel] ?? { x: 50, y: 50, rotation: 0, scale: 1 }
              const t: TextTransform = (theme[tField as keyof PopupTheme] as TextTransform | undefined) ?? def
              const update = (patch: Partial<TextTransform>) => mergedWrappedOnUpdateTheme(themeId, { [tField]: { ...t, ...patch } })
              return (
                <div className="space-y-2">
                  <p className="text-[11px] text-indigo-500">
                    {sel === 'content' ? '文本' : sel === 'time' ? '时间' : '倒计时'}
                    {selectedElements.length >= 2 ? ` (+ ${selectedElements.length - 1} 个)` : ''}
                  </p>
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
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <label className="text-[11px] text-slate-600 space-y-0.5 sm:col-span-2">
                      <span>
                        {sel === 'content'
                          ? '文字区域宽度（占弹窗宽 %，空=自动；自动模式≤60% 贴字、超出锁 60%）'
                          : '文字区域宽度（占弹窗宽 %，空=完全随字宽；有值=最大不超过该%；预览里四边拉宽后会锁定为定宽条）'}
                      </span>
                      <input
                        type="number"
                        min={5}
                        max={96}
                        step={0.5}
                        value={t.textBoxWidthPct ?? ''}
                        placeholder="自动"
                        onChange={(e) => {
                          const v = e.target.value.trim()
                          if (v === '') {
                            const { textBoxWidthPct: _w, contentTextBoxUserSized: _cu, shortLayerTextBoxLockWidth: _sl, ...rest } = t
                            mergedWrappedOnUpdateTheme(themeId, { [tField]: rest as TextTransform })
                            return
                          }
                          const n = Number(v)
                          if (!Number.isFinite(n)) return
                          const w = Math.max(5, Math.min(96, n))
                          update(
                            sel === 'content'
                              ? { textBoxWidthPct: w, contentTextBoxUserSized: true }
                              : { textBoxWidthPct: w, shortLayerTextBoxLockWidth: false },
                          )
                        }}
                        className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                      />
                    </label>
                    <label className="text-[11px] text-slate-600 space-y-0.5 sm:col-span-2">
                      <span>文字区域高度（占弹窗高 %，空=自动）</span>
                      <input
                        type="number"
                        min={3}
                        max={100}
                        step={0.5}
                        value={t.textBoxHeightPct ?? ''}
                        placeholder="自动"
                        onChange={(e) => {
                          const v = e.target.value.trim()
                          if (v === '') {
                            const { textBoxHeightPct: _h, contentTextBoxUserSized: _cu, ...rest } = t
                            mergedWrappedOnUpdateTheme(themeId, { [tField]: rest as TextTransform })
                            return
                          }
                          const n = Number(v)
                          if (!Number.isFinite(n)) return
                          const h = Math.max(3, Math.min(100, n))
                          update(sel === 'content' ? { textBoxHeightPct: h, contentTextBoxUserSized: true } : { textBoxHeightPct: h })
                        }}
                        className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const { textBoxWidthPct: _w, textBoxHeightPct: _h, contentTextBoxUserSized: _cu, shortLayerTextBoxLockWidth: _sl, ...rest } = t
                      mergedWrappedOnUpdateTheme(themeId, { [tField]: rest as TextTransform })
                    }}
                    className="text-[11px] text-slate-500 hover:text-slate-700"
                  >
                    清除固定文字区域（恢复随内容伸缩）
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const patch: Partial<PopupTheme> = {}
                      for (const k of selectedElements) {
                        const field = k === 'content' ? 'contentTransform' : k === 'time' ? 'timeTransform' : 'countdownTransform'
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
        </div>
      )}

      {(effectivePanelFilter === 'all' || effectivePanelFilter === 'overlay') && (
        <div className="rounded-md border border-slate-200 bg-white p-3 space-y-2">
          <h4 className="text-xs font-semibold text-slate-700">遮罩</h4>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <label className="inline-flex items-center gap-2 rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={theme.overlayEnabled}
                onChange={(e) => mergedWrappedOnUpdateTheme(themeId, { overlayEnabled: e.target.checked })}
              />
              启用遮罩
            </label>
            <label className="text-xs text-slate-600 space-y-1">
              <span>遮罩颜色</span>
              <input
                type="color"
                value={theme.overlayColor}
                onChange={(e) => mergedWrappedOnUpdateTheme(themeId, { overlayColor: e.target.value })}
                disabled={!theme.overlayEnabled}
                className="h-8 w-full rounded border border-slate-300 bg-white disabled:opacity-50"
              />
            </label>
            <label className="text-xs text-slate-600 space-y-1">
              <span>遮罩透明度（0-1）</span>
              <input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={theme.overlayOpacity}
                onChange={(e) => mergedWrappedOnUpdateTheme(themeId, { overlayOpacity: Math.max(0, Math.min(1, Number(e.target.value) || 0)) })}
                disabled={!theme.overlayEnabled}
                className="w-full rounded border border-slate-300 px-2 py-1 text-sm disabled:opacity-50"
              />
            </label>
          </div>
        </div>
      )}

      {(effectivePanelFilter === 'all' || effectivePanelFilter === 'background') && (
        <div className="rounded-md border border-slate-200 bg-white p-3 space-y-2">
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
              <label className="text-xs text-slate-600 space-y-1">
                <span>背景色</span>
                <input
                  type="color"
                  value={theme.backgroundColor}
                  onChange={(e) => mergedWrappedOnUpdateTheme(themeId, { backgroundColor: e.target.value })}
                  className="h-8 w-full rounded border border-slate-300 bg-white"
                />
              </label>
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
            </div>
          )}
        </div>
      )}
        </div>
      </div>
    </div>
  )
}
