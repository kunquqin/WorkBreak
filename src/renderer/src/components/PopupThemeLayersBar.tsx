import { useCallback, useMemo, useState, type CSSProperties } from 'react'
import type { Transform } from '@dnd-kit/utilities'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { PopupTheme } from '../types'
import { ensureThemeLayers } from '../../../shared/settings'
import {
  addBackgroundLayer,
  addImageDecorationLayer,
  addOverlayLayer,
  addTextLayer,
  addTimeLayer,
  MAX_DECORATION_IMAGE_LAYERS,
  MAX_TEXT_LAYERS,
  POPUP_LAYER_BACKGROUND_ID,
  POPUP_LAYER_OVERLAY_ID,
  removeThemeLayer,
  setLayerVisibility,
  type PopupThemeLayer,
  type TextThemeLayer,
} from '../../../shared/popupThemeLayers'
import type { TextElementKey } from './ThemePreviewEditor'

function isBindingBodyTextLayer(L: PopupThemeLayer): boolean {
  return L.kind === 'text' && (L as TextThemeLayer).bindsReminderBody === true
}

/** 与 Settings 中 dnd-kit 约定一致：避免 scale 挤压行高 */
function sortableTranslateOnly(t: Transform | null): string | undefined {
  if (!t) return undefined
  const x = t.x ?? 0
  const y = t.y ?? 0
  if (x === 0 && y === 0) return undefined
  return `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`
}

function layerRowLabel(L: PopupThemeLayer): string {
  switch (L.kind) {
    case 'background':
      return '背景'
    case 'overlay':
      return '遮罩'
    case 'bindingTime':
      return '时间'
    case 'text': {
      const t = L as TextThemeLayer
      const hint = t.text?.trim()
        ? ` · ${t.text.trim().slice(0, 12)}${t.text.length > 12 ? '…' : ''}`
        : ''
      return `文本${hint}`
    }
    case 'image':
      return '图片'
    default:
      return L.kind
  }
}

function bindingTextKey(L: PopupThemeLayer): TextElementKey | null {
  if (L.kind === 'bindingTime') return 'time'
  return null
}

function countTextLayers(layers: PopupThemeLayer[]): number {
  return layers.filter((x) => x.kind === 'text').length
}

function countImages(layers: PopupThemeLayer[]): number {
  return layers.filter((x) => x.kind === 'image').length
}

function EyeIcon({ on, className }: { on: boolean; className?: string }) {
  if (on) {
    return (
      <svg
        className={className}
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    )
  }
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  )
}

type SortableLayerRowProps = {
  L: PopupThemeLayer
  readOnly: boolean
  selected: boolean
  onSelectBinding: (key: TextElementKey) => void
  onSelectDeco: (id: string) => void
  onPickStructural: (id: string | null) => void
  onToggleVis: (layerId: string, visible: boolean) => void
  onRemoveLayer: (id: string) => void
  onSelectElements: (keys: TextElementKey[]) => void
  onSelectDecorationLayer: (id: string | null) => void
  onSelectStructuralLayer?: (id: string | null) => void
}

function SortableLayerRow({
  L,
  readOnly,
  selected,
  onSelectBinding,
  onSelectDeco,
  onPickStructural,
  onToggleVis,
  onRemoveLayer,
  onSelectElements,
  onSelectDecorationLayer,
  onSelectStructuralLayer,
}: SortableLayerRowProps) {
  const bind = bindingTextKey(L)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: L.id,
    disabled: readOnly,
    animateLayoutChanges: () => false,
    transition: { duration: 200, easing: 'cubic-bezier(0.22, 0.65, 0.28, 1)' },
  })
  const style: CSSProperties = {
    transform: sortableTranslateOnly(transform),
    transition,
    position: 'relative',
    zIndex: isDragging ? 10000 : undefined,
  }

  return (
    <li ref={setNodeRef} style={style} className="list-none">
      <div
        className={`rounded-md border border-slate-200 bg-white px-2 py-1.5 shadow-sm ${
          selected ? 'ring-1 ring-indigo-400 ring-offset-1' : ''
        } ${isDragging ? 'opacity-90 shadow-md' : ''}`}
      >
        <div className="flex items-center gap-1.5">
          {!readOnly && (
            <button
              type="button"
              className="touch-none shrink-0 cursor-grab rounded p-0.5 text-slate-400 hover:bg-slate-100 active:cursor-grabbing"
              title="拖动排序"
              aria-label="拖动排序"
              {...attributes}
              {...listeners}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-slate-400" aria-hidden>
                <circle cx="9" cy="8" r="1.5" />
                <circle cx="15" cy="8" r="1.5" />
                <circle cx="9" cy="12" r="1.5" />
                <circle cx="15" cy="12" r="1.5" />
                <circle cx="9" cy="16" r="1.5" />
                <circle cx="15" cy="16" r="1.5" />
              </svg>
            </button>
          )}
          <button
            type="button"
            title={L.visible ? '点击隐藏该层' : '点击显示该层'}
            aria-label={L.visible ? '隐藏该层' : '显示该层'}
            disabled={readOnly}
            className="shrink-0 rounded p-0.5 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
            onClick={() => onToggleVis(L.id, !L.visible)}
          >
            <EyeIcon on={L.visible} className={L.visible ? '' : 'text-slate-400'} />
          </button>
          <button
            type="button"
            className="min-w-0 flex-1 truncate text-left text-[11px] text-slate-800"
            onClick={() => {
              if (L.kind === 'text') {
                if (isBindingBodyTextLayer(L)) {
                  onSelectStructuralLayer?.(null)
                  onSelectDecorationLayer(null)
                  onSelectElements(['content'])
                } else {
                  onSelectDeco(L.id)
                }
                return
              }
              if (bind != null) onSelectBinding(bind)
              else if (L.kind === 'image') onSelectDeco(L.id)
              else if (L.kind === 'background' || L.kind === 'overlay') {
                onPickStructural(L.id)
              } else {
                onPickStructural(null)
              }
            }}
          >
            {layerRowLabel(L)}
          </button>
          {!readOnly && (
            <button
              type="button"
              title="删除该层"
              className="shrink-0 rounded px-1 text-red-600 hover:bg-red-50"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
                onRemoveLayer(L.id)
              }}
            >
              ×
            </button>
          )}
        </div>
      </div>
    </li>
  )
}

export type PopupThemeLayersBarProps = {
  theme: PopupTheme
  onUpdateTheme: (themeId: string, patch: Partial<PopupTheme>) => void
  selectedElements: TextElementKey[]
  onSelectElements: (keys: TextElementKey[]) => void
  selectedDecorationLayerId: string | null
  onSelectDecorationLayer: (id: string | null) => void
  /** 选图后写入「装饰图片层」；与背景选图分离 */
  onPickDecoImage?: () => void | Promise<void>
  readOnly?: boolean
  /** 外层分区高度内占满并内部滚动 */
  className?: string
  /** 列表区域与工具栏整体隐藏（由父级控制以便调整分栏布局） */
  railHidden?: boolean
  onRailHiddenChange?: (hidden: boolean) => void
  /** 当前选中的结构层（背景 / 遮罩）id，用于行高亮 */
  selectedStructuralLayerId?: string | null
  /** 在图层栏选中背景或遮罩 */
  onSelectStructuralLayer?: (id: string | null) => void
}

export function PopupThemeLayersBar({
  theme,
  onUpdateTheme,
  selectedElements,
  onSelectElements,
  selectedDecorationLayerId,
  onSelectDecorationLayer,
  onPickDecoImage,
  readOnly = false,
  className = '',
  railHidden: railHiddenProp,
  onRailHiddenChange,
  selectedStructuralLayerId = null,
  onSelectStructuralLayer,
}: PopupThemeLayersBarProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [railHiddenUncontrolled, setRailHiddenUncontrolled] = useState(false)
  const railHidden = railHiddenProp ?? railHiddenUncontrolled
  const setRailHidden = onRailHiddenChange ?? setRailHiddenUncontrolled

  const layers = useMemo(() => ensureThemeLayers(theme).layers ?? [], [theme])
  /** 列表自上而下：前景（z 大）→ 背景（z 小），与存储顺序相反 */
  const displayLayers = useMemo(() => [...layers].reverse(), [layers])

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  )

  const selectBinding = useCallback(
    (key: TextElementKey) => {
      onSelectStructuralLayer?.(null)
      onSelectDecorationLayer(null)
      onSelectElements([key])
    },
    [onSelectDecorationLayer, onSelectElements, onSelectStructuralLayer],
  )

  const selectDeco = useCallback(
    (id: string) => {
      onSelectStructuralLayer?.(null)
      onSelectElements([])
      onSelectDecorationLayer(id)
    },
    [onSelectDecorationLayer, onSelectElements, onSelectStructuralLayer],
  )

  const pickStructural = useCallback(
    (id: string | null) => {
      onSelectElements([])
      onSelectDecorationLayer(null)
      onSelectStructuralLayer?.(id)
    },
    [onSelectDecorationLayer, onSelectElements, onSelectStructuralLayer],
  )

  const toggleVis = useCallback(
    (layerId: string, visible: boolean) => {
      onUpdateTheme(theme.id, setLayerVisibility(theme, layerId, visible))
    },
    [onUpdateTheme, theme],
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return
      const ids = displayLayers.map((l) => l.id)
      const oldIndex = ids.indexOf(String(active.id))
      const newIndex = ids.indexOf(String(over.id))
      if (oldIndex < 0 || newIndex < 0) return
      const newDisplay = arrayMove(displayLayers, oldIndex, newIndex)
      const newStorage = [...newDisplay].reverse()
      onUpdateTheme(theme.id, { layers: newStorage })
    },
    [displayLayers, onUpdateTheme, theme.id],
  )

  const removeLayerRow = useCallback(
    (layerId: string) => {
      const patch = removeThemeLayer(theme, layerId)
      if (patch) {
        onUpdateTheme(theme.id, patch)
        if (selectedDecorationLayerId === layerId) onSelectDecorationLayer(null)
        if (selectedStructuralLayerId === layerId) onSelectStructuralLayer?.(null)
      }
    },
    [onUpdateTheme, theme, selectedDecorationLayerId, onSelectDecorationLayer, selectedStructuralLayerId, onSelectStructuralLayer],
  )

  const textN = countTextLayers(layers)
  const imgN = countImages(layers)
  const hasTimeLayer = layers.some((l) => l.kind === 'bindingTime')
  const hasBackgroundLayer = layers.some((l) => l.kind === 'background')
  const hasOverlayLayer = layers.some((l) => l.kind === 'overlay')

  if (railHidden) {
    return (
      <div className={`flex justify-end ${className}`}>
        <button
          type="button"
          className="text-[11px] text-indigo-600 hover:underline"
          onClick={() => setRailHidden(false)}
        >
          显示图层列表
        </button>
      </div>
    )
  }

  const rowPropsBase = {
    readOnly,
    onSelectBinding: selectBinding,
    onSelectDeco: selectDeco,
    onPickStructural: pickStructural,
    onToggleVis: toggleVis,
    onRemoveLayer: removeLayerRow,
    onSelectElements,
    onSelectDecorationLayer,
    onSelectStructuralLayer,
  }

  return (
    <div className={`flex min-h-0 flex-1 flex-col ${className}`}>
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 shrink-0">
        <button
          type="button"
          className="text-xs font-medium text-slate-700 hover:text-slate-900"
          onClick={() => setCollapsed((c) => !c)}
        >
          图层 {collapsed ? '▸' : '▾'}
        </button>
        <div className="flex flex-wrap items-center gap-1.5">
          {!readOnly && (
            <>
              <button
                type="button"
                disabled={textN >= MAX_TEXT_LAYERS}
                title={textN >= MAX_TEXT_LAYERS ? `文本最多 ${MAX_TEXT_LAYERS} 个` : '添加文本层'}
                className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => {
                  const oldIds = new Set(layers.map((l) => l.id))
                  const patch = addTextLayer(theme, false)
                  if (patch?.layers) {
                    onUpdateTheme(theme.id, patch)
                    const added = patch.layers.find((l) => l.kind === 'text' && !oldIds.has(l.id))
                    if (added) selectDeco(added.id)
                  }
                }}
              >
                + 文本
              </button>
              <button
                type="button"
                disabled={hasTimeLayer}
                title={hasTimeLayer ? '时间层最多 1 个' : '添加时间层'}
                className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => {
                  const patch = addTimeLayer(theme)
                  if (patch?.layers) {
                    onUpdateTheme(theme.id, patch)
                    selectBinding('time')
                  }
                }}
              >
                + 时间
              </button>
              <button
                type="button"
                disabled={!onPickDecoImage || imgN >= MAX_DECORATION_IMAGE_LAYERS}
                title={
                  !onPickDecoImage
                    ? '当前环境未提供选图'
                    : imgN >= MAX_DECORATION_IMAGE_LAYERS
                      ? `图片层最多 ${MAX_DECORATION_IMAGE_LAYERS} 个`
                      : '添加图片层'
                }
                className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => void onPickDecoImage?.()}
              >
                + 图片
              </button>
              <button
                type="button"
                disabled={hasBackgroundLayer}
                title={hasBackgroundLayer ? '已有背景层' : '添加背景层（壁纸/纯色）'}
                className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => {
                  const patch = addBackgroundLayer(theme)
                  if (patch) {
                    onUpdateTheme(theme.id, patch)
                    pickStructural(POPUP_LAYER_BACKGROUND_ID)
                  }
                }}
              >
                + 背景
              </button>
              <button
                type="button"
                disabled={hasOverlayLayer}
                title={hasOverlayLayer ? '已有遮罩层' : '添加遮罩层'}
                className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => {
                  const patch = addOverlayLayer(theme)
                  if (patch) {
                    onUpdateTheme(theme.id, patch)
                    pickStructural(POPUP_LAYER_OVERLAY_ID)
                  }
                }}
              >
                + 遮罩
              </button>
            </>
          )}
          <button
            type="button"
            className="text-[11px] text-slate-500 hover:text-slate-700"
            onClick={() => setRailHidden(true)}
          >
            隐藏栏
          </button>
        </div>
      </div>
      {!collapsed && (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-0.5">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={displayLayers.map((l) => l.id)} strategy={verticalListSortingStrategy}>
              <ul className="flex flex-col gap-2 py-0.5">
                {displayLayers.map((L) => {
                  const selected =
                    (L.kind === 'bindingTime' &&
                      selectedElements.length === 1 &&
                      selectedElements[0] === 'time') ||
                    (isBindingBodyTextLayer(L) &&
                      selectedElements.length === 1 &&
                      selectedElements[0] === 'content') ||
                    (L.kind === 'text' &&
                      !isBindingBodyTextLayer(L) &&
                      selectedDecorationLayerId === L.id) ||
                    (L.kind === 'image' && selectedDecorationLayerId === L.id) ||
                    ((L.kind === 'background' || L.kind === 'overlay') && selectedStructuralLayerId === L.id)
                  return <SortableLayerRow key={L.id} L={L} selected={selected} {...rowPropsBase} />
                })}
              </ul>
            </SortableContext>
          </DndContext>
        </div>
      )}
      <p className="mt-1 shrink-0 text-[10px] leading-snug text-slate-500">
        自上而下：越靠上越靠前。各层可删；删空则弹窗黑底。文本 {textN}/{MAX_TEXT_LAYERS}，时间至多 1，图片 {imgN}/
        {MAX_DECORATION_IMAGE_LAYERS}。
      </p>
    </div>
  )
}
