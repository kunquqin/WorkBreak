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
  addBindingContentLayer,
  addDateLayer,
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

/** 图层行单行预览：空白压成空格，便于与外层 truncate 的 CSS 省略号配合（类似 PS 文本图层名） */
function singleLineLayerSnippet(raw: string | undefined): string {
  const s = (raw ?? '').replace(/\s+/g, ' ').trim()
  return s.length > 0 ? s : '（空）'
}

function layerRowLabel(L: PopupThemeLayer, theme: PopupTheme): string {
  switch (L.kind) {
    case 'background':
      return '背景'
    case 'overlay':
      return '遮罩'
    case 'bindingTime':
      return '时间'
    case 'bindingDate':
      return '日期'
    case 'text': {
      const t = L as TextThemeLayer
      if (isBindingBodyTextLayer(L)) {
        /** 绑定层在预览里常改的是根字段，优先用 previewContentText 与界面一致 */
        const src = theme.previewContentText?.trim() ? theme.previewContentText : t.text
        return `主文本 · ${singleLineLayerSnippet(src)}`
      }
      return `文本 · ${singleLineLayerSnippet(t.text)}`
    }
    case 'image':
      return '图片'
    default: {
      const _exhaustive: never = L
      return _exhaustive
    }
  }
}

function bindingTextKey(L: PopupThemeLayer): TextElementKey | null {
  if (L.kind === 'bindingTime') return 'time'
  if (L.kind === 'bindingDate') return 'date'
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
  theme: PopupTheme
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
  theme,
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
        className={`min-w-0 rounded-md border px-2 py-1.5 transition-colors ${
          selected
            ? 'border-sky-400 bg-sky-50 ring-1 ring-sky-200 shadow-none dark:border-sky-500/60 dark:bg-slate-800/95 dark:ring-sky-400/35'
            : `border-slate-200 bg-white ${isDragging ? 'shadow-md' : 'shadow-sm'}`
        } ${isDragging ? 'opacity-90' : ''}`}
      >
        <div className="flex min-w-0 items-center gap-1.5">
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
            title={L.kind === 'text' ? layerRowLabel(L, theme) : undefined}
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
            {layerRowLabel(L, theme)}
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
  /** 图层区折叠状态（可受控） */
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
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
  collapsed: collapsedProp,
  onCollapsedChange,
  selectedStructuralLayerId = null,
  onSelectStructuralLayer,
}: PopupThemeLayersBarProps) {
  const [collapsedUncontrolled, setCollapsedUncontrolled] = useState(false)
  const collapsed = collapsedProp ?? collapsedUncontrolled
  const toggleCollapsed = useCallback(() => {
    const next = !collapsed
    if (onCollapsedChange) onCollapsedChange(next)
    else setCollapsedUncontrolled(next)
  }, [collapsed, onCollapsedChange])

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
  const hasBindingMainText = layers.some((l) => l.kind === 'text' && (l as TextThemeLayer).bindsReminderBody)
  const hasTimeLayer = layers.some((l) => l.kind === 'bindingTime')
  const hasDateLayer = layers.some((l) => l.kind === 'bindingDate')
  const hasBackgroundLayer = layers.some((l) => l.kind === 'background')
  const hasOverlayLayer = layers.some((l) => l.kind === 'overlay')

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
          onClick={toggleCollapsed}
        >
          图层 {collapsed ? '▸' : '▾'}
        </button>
        <div className="flex flex-wrap items-center gap-1.5">
          {!readOnly && (
            <>
              {!hasBindingMainText && (
                <button
                  type="button"
                  title="恢复主文案层（随当前壁纸类型填入默认句）"
                  className="rounded border border-indigo-300 bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-800 hover:bg-indigo-100 dark:border-indigo-500/45 dark:bg-indigo-500/20 dark:text-indigo-200 dark:hover:bg-indigo-500/30"
                  onClick={() => {
                    const patch = addBindingContentLayer(theme)
                    if (patch) {
                      onUpdateTheme(theme.id, patch)
                      onSelectStructuralLayer?.(null)
                      onSelectDecorationLayer(null)
                      onSelectElements(['content'])
                    }
                  }}
                >
                  + 主文本
                </button>
              )}
              {textN < MAX_TEXT_LAYERS && (
                <button
                  type="button"
                  title="添加文本层"
                  className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50"
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
              )}
              {!hasTimeLayer && (
                <button
                  type="button"
                  title="添加时间层"
                  className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50"
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
              )}
              {!hasDateLayer && (
                <button
                  type="button"
                  title="添加日期层（年月日、星期，由系统格式化）"
                  className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50"
                  onClick={() => {
                    const patch = addDateLayer(theme)
                    if (patch?.layers) {
                      onUpdateTheme(theme.id, patch)
                      selectBinding('date')
                    }
                  }}
                >
                  + 日期
                </button>
              )}
              {!!onPickDecoImage && imgN < MAX_DECORATION_IMAGE_LAYERS && (
                <button
                  type="button"
                  title="添加图片层"
                  className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50"
                  onClick={() => void onPickDecoImage?.()}
                >
                  + 图片
                </button>
              )}
              {!hasBackgroundLayer && (
                <button
                  type="button"
                  title="添加背景层（壁纸/纯色）"
                  className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50"
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
              )}
              {!hasOverlayLayer && (
                <button
                  type="button"
                  title="添加遮罩层"
                  className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50"
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
              )}
            </>
          )}
        </div>
      </div>
      {!collapsed && (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-0.5">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={displayLayers.map((l) => l.id)} strategy={verticalListSortingStrategy}>
              <ul className="flex min-w-0 flex-col gap-2 py-0.5">
                {displayLayers.map((L) => {
                  const selected =
                    (L.kind === 'bindingTime' &&
                      selectedElements.includes('time')) ||
                    (L.kind === 'bindingDate' &&
                      selectedElements.includes('date')) ||
                    (isBindingBodyTextLayer(L) &&
                      selectedElements.includes('content')) ||
                    (L.kind === 'text' &&
                      !isBindingBodyTextLayer(L) &&
                      selectedDecorationLayerId === L.id) ||
                    (L.kind === 'image' && selectedDecorationLayerId === L.id) ||
                    ((L.kind === 'background' || L.kind === 'overlay') && selectedStructuralLayerId === L.id)
                  return <SortableLayerRow key={L.id} theme={theme} L={L} selected={selected} {...rowPropsBase} />
                })}
              </ul>
            </SortableContext>
          </DndContext>
        </div>
      )}
    </div>
  )
}
