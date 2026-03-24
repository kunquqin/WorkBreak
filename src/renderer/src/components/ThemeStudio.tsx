import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type RefObject,
} from 'react'
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from '@dnd-kit/sortable'
import type { Transform } from '@dnd-kit/utilities'
import { collectPopupThemeImagePathsForPreview } from '../utils/popupThemePreview'
import type { PopupTheme, PopupThemeTarget } from '../types'
import { ThemePreviewEditor, type TextElementKey } from './ThemePreviewEditor'
import { PopupThemeEditorPanel } from './PopupThemeEditorPanel'
import { clonePopupThemeForFork, popupThemeContentEquals } from '../../../shared/popupThemeUtils'
import { addImageDecorationLayer, mergeContentThemePatchIntoBindingTextLayer } from '../../../shared/popupThemeLayers'
import { ensureThemeLayers } from '../../../shared/settings'
import { usePopupThemeEditHistory, type PopupThemeEditUpdateMeta } from '../hooks/usePopupThemeEditHistory'

/** 与设置页大类排序一致：可变高网格项禁用 scale 形变，仅平移 */
function sortableTranslateOnly(t: Transform | null): string | undefined {
  if (!t) return undefined
  const x = t.x ?? 0
  const y = t.y ?? 0
  if (x === 0 && y === 0) return undefined
  return `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`
}

function themeDraftDirty(baseline: PopupTheme, draft: PopupTheme): boolean {
  if ((baseline.name ?? '').trim() !== (draft.name ?? '').trim()) return true
  return !popupThemeContentEquals(baseline, draft)
}

/** 左预览 + 右参数（不含顶栏） */
export type ThemeStudioEditWorkspaceProps = {
  theme: PopupTheme
  surfaceRef: RefObject<HTMLDivElement | null>
  previewViewportWidth: number
  previewImageUrlMap: Record<string, string>
  popupPreviewAspect: '16:9' | '4:3'
  onUpdateTheme: (themeId: string, patch: Partial<PopupTheme>) => void
  replaceThemeFull: (theme: PopupTheme) => void
  selectedElements: TextElementKey[]
  onSelectElements: (keys: TextElementKey[]) => void
  onPickImageFile: () => void | Promise<void>
  onPickImageFolder: () => void | Promise<void>
}

export function ThemeStudioEditWorkspace({
  theme,
  surfaceRef,
  previewViewportWidth,
  previewImageUrlMap,
  popupPreviewAspect,
  onUpdateTheme,
  replaceThemeFull,
  selectedElements,
  onSelectElements,
  onPickImageFile,
  onPickImageFolder,
}: ThemeStudioEditWorkspaceProps) {
  const [selectedDecorationLayerId, setSelectedDecorationLayerId] = useState<string | null>(null)
  const [selectedStructuralLayerId, setSelectedStructuralLayerId] = useState<string | null>(null)
  useEffect(() => {
    setSelectedDecorationLayerId(null)
    setSelectedStructuralLayerId(null)
  }, [theme.id])

  const { wrappedOnUpdateTheme, undo, redo, canUndo, canRedo, historyRev } = usePopupThemeEditHistory(
    theme,
    onUpdateTheme,
    replaceThemeFull,
    20,
  )
  const mergedWrappedOnUpdateTheme = useCallback(
    (id: string, patch: Partial<PopupTheme>, meta?: PopupThemeEditUpdateMeta) => {
      if (id !== theme.id) {
        wrappedOnUpdateTheme(id, patch)
        return
      }
      const layerSync = mergeContentThemePatchIntoBindingTextLayer(theme, patch)
      wrappedOnUpdateTheme(id, layerSync ? { ...patch, ...layerSync } : patch, meta)
    },
    [theme.id, theme, wrappedOnUpdateTheme],
  )

  const delegatedEditHistory = useMemo(
    () => ({ undo, redo, canUndo, canRedo }),
    [undo, redo, canUndo, canRedo, historyRev],
  )

  /** 不传 previewLabels：由 ThemePreviewEditor 按 theme.preview* 与占位标签回落，避免 `pl` 强行写死「提醒」盖住主题内已保存的示例文案 */
  const handlePickDecoImage = useCallback(() => {
    void (async () => {
      const api = window.electronAPI
      const r = await api?.pickPopupImageFile?.()
      if (!r?.success) return
      const layers = ensureThemeLayers(theme).layers ?? []
      const oldIds = new Set(layers.map((l) => l.id))
      const patch = addImageDecorationLayer(theme, r.path)
      if (!patch?.layers) return
      mergedWrappedOnUpdateTheme(theme.id, patch)
      const added = patch.layers.find((l) => l.kind === 'image' && !oldIds.has(l.id))
      if (added) setSelectedDecorationLayerId(added.id)
    })()
  }, [mergedWrappedOnUpdateTheme, theme])

  return (
    <div
      ref={surfaceRef as RefObject<HTMLDivElement>}
      tabIndex={-1}
      className="grid min-h-0 h-full min-w-0 flex-1 grid-cols-1 gap-4 outline-none focus:outline-none lg:grid-cols-[7fr_3fr] lg:items-stretch"
    >
      <div
        className="flex min-h-[min(200px,40vh)] min-w-0 flex-col lg:min-h-0"
        onMouseDownCapture={(e) => {
          const t = e.target as HTMLElement
          if (t.closest('input, textarea, select, [contenteditable="true"]')) return
          if (!t.closest('[data-theme-preview-root]')) return
          surfaceRef.current?.focus({ preventScroll: true })
        }}
      >
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto overflow-x-hidden px-1 pb-2 pt-1">
          <div className="w-full min-w-0 shrink-0">
            <ThemePreviewEditor
              theme={theme}
              onUpdateTheme={mergedWrappedOnUpdateTheme}
              keyboardScopeRef={surfaceRef as RefObject<HTMLDivElement>}
              previewViewportWidth={previewViewportWidth}
              previewImageUrlMap={previewImageUrlMap}
              popupPreviewAspect={popupPreviewAspect}
              selectedElements={selectedElements}
              onSelectElements={onSelectElements}
              selectedDecorationLayerId={selectedDecorationLayerId}
              onSelectDecorationLayer={setSelectedDecorationLayerId}
              onSelectStructuralLayer={setSelectedStructuralLayerId}
              selectedStructuralLayerId={selectedStructuralLayerId}
              previewWidthMode="fill"
              outerChrome="none"
            />
          </div>
        </div>
      </div>
      <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white lg:min-h-0">
        <PopupThemeEditorPanel
          className="min-h-0 flex-1"
          theme={theme}
          onUpdateTheme={onUpdateTheme}
          replaceThemeFull={replaceThemeFull}
          delegatedMergedOnUpdateTheme={mergedWrappedOnUpdateTheme}
          delegatedEditHistory={delegatedEditHistory}
          previewViewportWidth={previewViewportWidth}
          previewImageUrlMap={previewImageUrlMap}
          popupPreviewAspect={popupPreviewAspect}
          selectedElements={selectedElements}
          onSelectElements={onSelectElements}
          selectedDecorationLayerId={selectedDecorationLayerId}
          onSelectDecorationLayer={setSelectedDecorationLayerId}
          selectedStructuralLayerId={selectedStructuralLayerId}
          onSelectStructuralLayer={setSelectedStructuralLayerId}
          onPickDecoImage={handlePickDecoImage}
          onPickImageFile={onPickImageFile}
          onPickImageFolder={onPickImageFolder}
          previewPlacement="hidden"
          editorSurfaceRef={surfaceRef as RefObject<HTMLDivElement>}
        />
      </div>
    </div>
  )
}

export type ThemeStudioReturnTarget =
  | { kind: 'list' }
  | { kind: 'subitem'; categoryId: string; itemId: string }

export type ThemeStudioThumbnailProps = {
  theme: PopupTheme
  previewImageUrlMap: Record<string, string>
  previewViewportWidth: number
  popupPreviewAspect: '16:9' | '4:3'
}

const noopThemeUpdate = (_id: string, _patch: Partial<PopupTheme>) => {}
const noopSelectElements = (_keys: TextElementKey[]) => {}

function ThemeStudioThumbnail({
  theme,
  previewImageUrlMap,
  previewViewportWidth,
  popupPreviewAspect,
}: ThemeStudioThumbnailProps) {
  const slotRef = useRef<HTMLDivElement>(null)
  const [slotW, setSlotW] = useState(0)

  const vw = Math.max(1, Math.round(previewViewportWidth))
  const ar = popupPreviewAspect === '16:9' ? 16 / 9 : 4 / 3
  const vh = Math.max(1, Math.round(vw / ar))

  useLayoutEffect(() => {
    const el = slotRef.current
    if (!el) return
    const read = () => {
      const w = Math.round(el.getBoundingClientRect().width)
      if (w > 0) setSlotW((p) => (p === w ? p : w))
    }
    read()
    const ro = new ResizeObserver(() => read())
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const scale = slotW > 0 ? slotW / vw : 1

  return (
    <div
      ref={slotRef}
      className="relative w-full overflow-hidden bg-black"
      style={{
        aspectRatio: popupPreviewAspect === '16:9' ? '16 / 9' : '4 / 3',
      }}
    >
      {slotW > 0 && (
        <div
          className="absolute left-1/2 top-0"
          style={{
            width: vw,
            height: vh,
            transform: `translateX(-50%) scale(${scale})`,
            transformOrigin: 'top center',
            willChange: 'transform',
          }}
        >
          <ThemePreviewEditor
            theme={theme}
            readOnly
            showToolbar={false}
            fixedPreviewPixelSize={{ width: vw, height: vh }}
            onUpdateTheme={noopThemeUpdate}
            previewViewportWidth={previewViewportWidth}
            previewImageUrlMap={previewImageUrlMap}
            popupPreviewAspect={popupPreviewAspect}
            selectedElements={[]}
            onSelectElements={noopSelectElements}
          />
        </div>
      )}
    </div>
  )
}

function ThemeStudioSortGrip() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-slate-400" aria-hidden>
      <circle cx="9" cy="6" r="1.5" />
      <circle cx="15" cy="6" r="1.5" />
      <circle cx="9" cy="12" r="1.5" />
      <circle cx="15" cy="12" r="1.5" />
      <circle cx="9" cy="18" r="1.5" />
      <circle cx="15" cy="18" r="1.5" />
    </svg>
  )
}

type SortableThemeStudioCardProps = {
  theme: PopupTheme
  previewImageUrlMap: Record<string, string>
  previewViewportWidth: number
  popupPreviewAspect: '16:9' | '4:3'
  onOpenEdit: (themeId: string) => void
}

function SortableThemeStudioCard({
  theme: t,
  previewImageUrlMap,
  previewViewportWidth,
  popupPreviewAspect,
  onOpenEdit,
}: SortableThemeStudioCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: t.id,
    animateLayoutChanges: () => false,
  })
  const dragStyle: CSSProperties = {
    transform: sortableTranslateOnly(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
  }
  const isMain = t.target === 'main'
  const footerTone = isMain
    ? 'border-emerald-100 bg-emerald-50/90'
    : 'border-sky-100 bg-sky-50/90'
  const subTone = isMain ? 'text-emerald-800' : 'text-sky-800'

  const open = () => onOpenEdit(t.id)
  const onThumbKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      open()
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={dragStyle}
      className={`group flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-left shadow-sm transition-shadow hover:border-slate-300 hover:shadow-md ${
        isDragging ? 'opacity-95 shadow-lg ring-2 ring-slate-300' : ''
      }`}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={open}
        onKeyDown={onThumbKey}
        className="min-h-0 shrink-0 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-400"
      >
        <ThemeStudioThumbnail
          theme={t}
          previewImageUrlMap={previewImageUrlMap}
          previewViewportWidth={previewViewportWidth}
          popupPreviewAspect={popupPreviewAspect}
        />
      </div>
      <div className={`flex items-start gap-1 border-t p-2.5 ${footerTone}`}>
        <button
          type="button"
          className="mt-0.5 shrink-0 touch-none rounded p-0.5 text-slate-500 hover:bg-black/5 active:cursor-grabbing cursor-grab"
          aria-label="拖动排序"
          {...listeners}
          {...attributes}
          onClick={(e) => e.stopPropagation()}
        >
          <ThemeStudioSortGrip />
        </button>
        <div
          role="button"
          tabIndex={0}
          className="min-w-0 flex-1 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-slate-400 rounded-sm"
          onClick={open}
          onKeyDown={onThumbKey}
        >
          <p className="truncate text-sm font-bold text-slate-900">{t.name || t.id}</p>
          <p className={`text-[11px] font-medium ${subTone}`}>{isMain ? '结束壁纸' : '休息壁纸'}</p>
        </div>
      </div>
    </div>
  )
}

export type ThemeStudioListViewProps = {
  themes: PopupTheme[]
  previewImageUrlMap: Record<string, string>
  previewViewportWidth: number
  popupPreviewAspect: '16:9' | '4:3'
  onOpenEdit: (themeId: string) => void
  /** 打开浮动编辑弹窗；在弹窗内选择结束/休息壁纸类型 */
  onAddTheme: () => void
  /** 拖拽调整 `popupThemes` 顺序（与筛选无关：按 id 在全量列表中移动） */
  onReorderThemes: (next: PopupTheme[]) => void
}

export function ThemeStudioListView({
  themes,
  previewImageUrlMap,
  previewViewportWidth,
  popupPreviewAspect,
  onOpenEdit,
  onAddTheme,
  onReorderThemes,
}: ThemeStudioListViewProps) {
  const [filter, setFilter] = useState<'all' | 'main' | 'rest'>('all')
  const filtered = useMemo(() => {
    if (filter === 'all') return themes
    return themes.filter((t) => t.target === filter)
  }, [themes, filter])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const activeId = String(active.id)
    const overId = String(over.id)
    const oldFull = themes.findIndex((t) => t.id === activeId)
    const newFull = themes.findIndex((t) => t.id === overId)
    if (oldFull < 0 || newFull < 0) return
    onReorderThemes(arrayMove(themes, oldFull, newFull))
  }

  const chip = (id: typeof filter, label: string) => {
    const active = filter === id
    let activeCls = 'bg-slate-800 text-white'
    let inactiveCls = 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
    if (id === 'rest') {
      activeCls = 'bg-blue-600 text-white shadow-sm'
      inactiveCls = 'bg-white text-blue-900 ring-1 ring-blue-200 hover:bg-blue-50/80'
    } else if (id === 'main') {
      activeCls = 'bg-emerald-600 text-white shadow-sm'
      inactiveCls = 'bg-white text-emerald-900 ring-1 ring-emerald-200 hover:bg-emerald-50/80'
    }
    return (
      <button
        key={id}
        type="button"
        onClick={() => setFilter(id)}
        className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${active ? activeCls : inactiveCls}`}
      >
        {label}
      </button>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {chip('all', '全部')}
          {chip('rest', '休息壁纸')}
          {chip('main', '结束壁纸')}
        </div>
        <button
          type="button"
          onClick={() => onAddTheme()}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          + 创建壁纸
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={filtered.map((t) => t.id)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filtered.map((t) => (
                <SortableThemeStudioCard
                  key={t.id}
                  theme={t}
                  previewImageUrlMap={previewImageUrlMap}
                  previewViewportWidth={previewViewportWidth}
                  popupPreviewAspect={popupPreviewAspect}
                  onOpenEdit={onOpenEdit}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
        {filtered.length === 0 && (
          <p className="py-12 text-center text-sm text-slate-500">当前筛选下没有主题。</p>
        )}
      </div>
    </div>
  )
}

export type ThemeStudioEditViewProps = {
  theme: PopupTheme
  previewViewportWidth: number
  previewImageUrlMap: Record<string, string>
  popupPreviewAspect: '16:9' | '4:3'
  onUpdateTheme: (themeId: string, patch: Partial<PopupTheme>) => void
  replaceThemeFull: (theme: PopupTheme) => void
  selectedElements: TextElementKey[]
  onSelectElements: (keys: TextElementKey[]) => void
  onPickImageFile: () => void | Promise<void>
  onPickImageFolder: () => void | Promise<void>
  onBack: () => void
  onDuplicateTheme: () => void
  onDeleteTheme?: () => void
  canDelete?: boolean
  deleteDisabledTitle?: string
}

export function ThemeStudioEditView({
  theme,
  previewViewportWidth,
  previewImageUrlMap,
  popupPreviewAspect,
  onUpdateTheme,
  replaceThemeFull,
  selectedElements,
  onSelectElements,
  onPickImageFile,
  onPickImageFolder,
  onBack,
  onDuplicateTheme,
  onDeleteTheme,
  canDelete,
  deleteDisabledTitle,
}: ThemeStudioEditViewProps) {
  const surfaceRef = useRef<HTMLDivElement>(null)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="shrink-0 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50"
          >
            ← 返回
          </button>
          <span className="text-sm font-semibold text-slate-800">编辑主题</span>
          <input
            type="text"
            value={theme.name}
            onChange={(e) => onUpdateTheme(theme.id, { name: e.target.value })}
            className="min-w-[10rem] max-w-md flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
            placeholder="主题名称"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onDuplicateTheme}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50"
          >
            另存为新主题
          </button>
          {onDeleteTheme && (
            <button
              type="button"
              onClick={onDeleteTheme}
              disabled={canDelete === false}
              title={deleteDisabledTitle}
              className="rounded-md border border-red-200 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              删除
            </button>
          )}
        </div>
      </div>
      <ThemeStudioEditWorkspace
        theme={theme}
        surfaceRef={surfaceRef}
        previewViewportWidth={previewViewportWidth}
        previewImageUrlMap={previewImageUrlMap}
        popupPreviewAspect={popupPreviewAspect}
        onUpdateTheme={onUpdateTheme}
        replaceThemeFull={replaceThemeFull}
        selectedElements={selectedElements}
        onSelectElements={onSelectElements}
        onPickImageFile={onPickImageFile}
        onPickImageFolder={onPickImageFolder}
      />
    </div>
  )
}

export type ThemeStudioFloatingSource =
  | { kind: 'studio-list' }
  | { kind: 'subitem'; categoryId: string; itemAnchor: string; popupTarget: 'main' | 'rest' }

export type ThemeStudioFloatingEditorProps = {
  themes: PopupTheme[]
  themeId: string
  source: ThemeStudioFloatingSource
  /** `saved: true` 表示已保存或确认保留主题；未传或 false 时由设置页决定是否丢弃新建草稿 */
  onClose: (opts?: { saved?: boolean }) => void
  /** 列表内「另存为」后改为编辑新主题 */
  onSwitchEditingThemeId?: (newId: string) => void
  /** 子项「另存为」后把新 id 交给设置页写回表单 */
  onAfterForkRebindSubitem?: (newThemeId: string) => void
  previewViewportWidth: number
  previewImageUrlMap: Record<string, string>
  popupPreviewAspect: '16:9' | '4:3'
  /** 浮动编辑工具栏内切换预览画幅（16:9 / 4:3） */
  onPopupPreviewAspectChange?: (aspect: '16:9' | '4:3') => void
  getSelectedElements: (id: string) => TextElementKey[]
  setSelectedElements: (id: string, els: TextElementKey[]) => void
  replacePopupTheme: (theme: PopupTheme) => void
  appendPopupTheme: (theme: PopupTheme) => void
  countPopupThemeReferences: (themeId: string, exclude?: { categoryId: string; itemId: string } | null) => number
  themeRefExclude: { categoryId: string; itemId: string } | null
  onDeleteTheme?: () => void
  canDeleteTheme?: boolean
  deleteDisabledTitle?: string
  /** 列表「+ 创建壁纸」进入的草稿：仅保留保存/取消，不显示「另存为」（尚无库内母题可 fork） */
  isNewDraft?: boolean
}

export function ThemeStudioFloatingEditor({
  themes,
  themeId,
  source,
  onClose,
  onSwitchEditingThemeId,
  onAfterForkRebindSubitem,
  previewViewportWidth,
  previewImageUrlMap,
  popupPreviewAspect,
  onPopupPreviewAspectChange,
  getSelectedElements,
  setSelectedElements,
  replacePopupTheme,
  appendPopupTheme,
  countPopupThemeReferences,
  themeRefExclude,
  onDeleteTheme,
  canDeleteTheme,
  deleteDisabledTitle,
  isNewDraft = false,
}: ThemeStudioFloatingEditorProps) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const baselineRef = useRef<PopupTheme | null>(null)
  const themesRef = useRef(themes)
  themesRef.current = themes
  const [draft, setDraft] = useState<PopupTheme | null>(null)
  const [draftImageUrlMap, setDraftImageUrlMap] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!draft) {
      setDraftImageUrlMap({})
      return
    }
    const api = window.electronAPI?.resolvePreviewImageUrl
    if (!api) return
    const paths = collectPopupThemeImagePathsForPreview(draft)
    if (paths.length === 0) {
      setDraftImageUrlMap({})
      return
    }
    let disposed = false
    void Promise.all(
      paths.map(async (p) => {
        const r = await api(p)
        return [p, r.success ? r.url : ''] as const
      }),
    ).then((entries) => {
      if (!disposed) setDraftImageUrlMap(Object.fromEntries(entries))
    })
    return () => {
      disposed = true
    }
  }, [draft])

  const mergedFloatingPreviewMap = useMemo(
    () => ({ ...previewImageUrlMap, ...draftImageUrlMap }),
    [previewImageUrlMap, draftImageUrlMap],
  )

  const tryCloseStable = useCallback(() => {
    const d = draft
    const b = baselineRef.current
    if (!d || !b) {
      onClose()
      return
    }
    if (themeDraftDirty(b, d) && !window.confirm('放弃对主题的修改？')) return
    onClose()
  }, [draft, onClose])

  useLayoutEffect(() => {
    const t = themesRef.current.find((x) => x.id === themeId)
    if (!t) {
      setDraft(null)
      baselineRef.current = null
      return
    }
    const c = structuredClone(t) as PopupTheme
    setDraft(c)
    baselineRef.current = structuredClone(t) as PopupTheme
  }, [themeId])

  /**
   * 首次进入某主题：无有效绑定层选中时默认主文案；若仅有已废弃的 `countdown` 选中须剔除，否则图层栏无行匹配、看起来像「从没选中」。
   */
  const bindingAutoSelectRef = useRef(new Set<string>())
  useLayoutEffect(() => {
    if (!themeId) return
    if (bindingAutoSelectRef.current.has(themeId)) return
    const cur = getSelectedElements(themeId)
    const withoutCountdown = cur.filter((k) => k !== 'countdown')
    if (withoutCountdown.length > 0) {
      if (withoutCountdown.length !== cur.length) setSelectedElements(themeId, withoutCountdown)
      bindingAutoSelectRef.current.add(themeId)
      return
    }
    setSelectedElements(themeId, ['content'])
    bindingAutoSelectRef.current.add(themeId)
  }, [themeId, getSelectedElements, setSelectedElements])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      tryCloseStable()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tryCloseStable])

  const tResolved = themes.find((x) => x.id === themeId)
  if (!tResolved) {
    return (
      <div
        className="fixed inset-0 z-[250000] flex items-center justify-center bg-black/70 p-4 backdrop-blur-md"
        role="presentation"
        onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      >
        <div className="flex flex-col items-center gap-3 rounded-lg bg-white px-6 py-4 text-sm text-slate-600 shadow-xl">
          <p>未找到该主题。</p>
          <button
            type="button"
            className="rounded-md border border-slate-300 px-3 py-1 text-xs"
            onClick={() => onClose()}
          >
            关闭
          </button>
        </div>
      </div>
    )
  }

  if (!draft || draft.id !== themeId) {
    return (
      <div
        className="fixed inset-0 z-[250000] flex items-center justify-center bg-black/70 p-4 backdrop-blur-md"
        role="presentation"
      >
        <div className="text-sm text-white drop-shadow-sm">加载中…</div>
      </div>
    )
  }

  const baseline = baselineRef.current
  const targetLocked = source.kind === 'subitem'
  /** 子项入口：展示与入口卡片一致；工坊入口：随草稿 target 切换 */
  const selectedTarget: PopupThemeTarget =
    source.kind === 'subitem' ? source.popupTarget : draft.target
  /** 与旧版顶栏逻辑一致；避免 HMR/合并残留对 `bannerMain` 的引用时报未定义 */
  const bannerMain = selectedTarget === 'main'
  const updateDraft = (_id: string, patch: Partial<PopupTheme>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d))
  }
  const replaceDraftFull = (t: PopupTheme) => {
    setDraft(t)
  }

  const handleSave = () => {
    if (!baseline) return
    if (!themeDraftDirty(baseline, draft)) {
      onClose({ saved: true })
      return
    }
    const otherRefs = countPopupThemeReferences(baseline.id, themeRefExclude)
    const nameResolved = (draft.name ?? '').trim() || baseline.name
    const baseLabel = (baseline.name ?? '').trim() || baseline.id
    const msg =
      otherRefs > 0
        ? `保存将覆盖主题库中的「${baseLabel}」。另有 ${otherRefs} 条提醒也在使用该主题，将一并使用当前编辑后的样式。是否确认保存？`
        : `保存将覆盖主题库中的「${baseLabel}」。是否确认保存？`
    if (!window.confirm(msg)) return
    const toSave: PopupTheme = { ...draft, id: baseline.id, name: nameResolved }
    replacePopupTheme(toSave)
    baselineRef.current = structuredClone(toSave) as PopupTheme
    onClose({ saved: true })
  }

  const handleSaveAs = () => {
    const nameTrim = (draft.name ?? '').trim()
    const baseName = (baseline?.name ?? '').trim() || '主题'
    const nameResolved = nameTrim || `${baseName}（副本）`
    const draftToFork: PopupTheme = { ...draft, id: baseline?.id ?? draft.id, name: nameResolved }
    const forked = clonePopupThemeForFork(draftToFork, '')
    appendPopupTheme(forked)
    if (source.kind === 'subitem') {
      onAfterForkRebindSubitem?.(forked.id)
      onClose({ saved: true })
      return
    }
    onSwitchEditingThemeId?.(forked.id)
  }

  const isStudioList = source.kind === 'studio-list'

  const setWallpaperTarget = (target: PopupThemeTarget) => {
    if (targetLocked) return
    updateDraft(draft.id, { target })
  }

  return (
    <div
      className="fixed inset-0 z-[250000] flex items-center justify-center bg-black/70 p-2 sm:p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label={bannerMain ? '编辑结束壁纸主题' : '编辑休息壁纸主题'}
      onMouseDown={(e) => e.target === e.currentTarget && tryCloseStable()}
    >
      <div
        className="flex h-[min(92dvh,1100px)] w-[min(96vw,1960px)] flex-col overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-[0_25px_80px_-12px_rgba(0,0,0,0.45)] sm:rounded-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-slate-200 bg-white">
          <div className="flex" role="tablist" aria-label="壁纸用途">
            <button
              type="button"
              role="tab"
              aria-selected={selectedTarget === 'rest'}
              disabled={source.kind === 'subitem' && source.popupTarget !== 'rest'}
              onClick={() => setWallpaperTarget('rest')}
              className={`min-h-[44px] flex-1 px-3 py-2.5 text-sm font-semibold transition-colors ${
                selectedTarget === 'rest'
                  ? 'bg-blue-500 text-white'
                  : source.kind === 'subitem'
                    ? 'cursor-not-allowed bg-slate-100 text-slate-400'
                    : 'bg-blue-50 text-blue-900 hover:bg-blue-100'
              }`}
            >
              休息壁纸
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={selectedTarget === 'main'}
              disabled={source.kind === 'subitem' && source.popupTarget !== 'main'}
              onClick={() => setWallpaperTarget('main')}
              className={`min-h-[44px] flex-1 border-l border-slate-200 px-3 py-2.5 text-sm font-semibold transition-colors ${
                selectedTarget === 'main'
                  ? 'bg-green-500 text-white'
                  : source.kind === 'subitem'
                    ? 'cursor-not-allowed bg-slate-100 text-slate-400'
                    : 'bg-green-50 text-green-800 hover:bg-green-100'
              }`}
            >
              结束壁纸
            </button>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-slate-600">主题名称</span>
            <input
              type="text"
              value={draft.name}
              onChange={(e) => updateDraft(draft.id, { name: e.target.value })}
              className="min-w-[8rem] max-w-[14rem] flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-sm"
              placeholder="主题名称"
            />
            {onPopupPreviewAspectChange && (
              <>
                <span className="hidden text-xs text-slate-500 sm:inline">预览比例</span>
                <div className="inline-flex shrink-0 rounded-md border border-slate-300 bg-white p-0.5">
                  <button
                    type="button"
                    onClick={() => onPopupPreviewAspectChange('16:9')}
                    className={`rounded px-2 py-1 text-xs ${popupPreviewAspect === '16:9' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
                  >
                    16:9
                  </button>
                  <button
                    type="button"
                    onClick={() => onPopupPreviewAspectChange('4:3')}
                    className={`rounded px-2 py-1 text-xs ${popupPreviewAspect === '4:3' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
                  >
                    4:3
                  </button>
                </div>
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={tryCloseStable}
              className="shrink-0 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
            >
              保存
            </button>
            {!isNewDraft && (
              <button
                type="button"
                onClick={handleSaveAs}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                另存为
              </button>
            )}
            {isStudioList && onDeleteTheme && (
              <button
                type="button"
                onClick={onDeleteTheme}
                disabled={canDeleteTheme === false}
                title={deleteDisabledTitle}
                className="rounded-md border border-red-200 px-2.5 py-1.5 text-xs text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                删除
              </button>
            )}
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3 pt-2">
          <ThemeStudioEditWorkspace
            theme={draft}
            surfaceRef={surfaceRef}
            previewViewportWidth={previewViewportWidth}
            previewImageUrlMap={mergedFloatingPreviewMap}
            popupPreviewAspect={popupPreviewAspect}
            onUpdateTheme={updateDraft}
            replaceThemeFull={replaceDraftFull}
            selectedElements={getSelectedElements(draft.id)}
            onSelectElements={(els) => setSelectedElements(draft.id, els)}
            onPickImageFile={() => {
              void (async () => {
                const api = window.electronAPI
                const r = await api?.pickPopupImageFile?.()
                if (!r?.success) return
                updateDraft(draft.id, {
                  backgroundType: 'image',
                  imageSourceType: 'single',
                  imagePath: r.path,
                  imageFolderPath: undefined,
                  imageFolderFiles: undefined,
                })
              })()
            }}
            onPickImageFolder={() => {
              void (async () => {
                const api = window.electronAPI
                const r = await api?.pickPopupImageFolder?.()
                if (!r?.success) return
                updateDraft(draft.id, {
                  backgroundType: 'image',
                  imageSourceType: 'folder',
                  imageFolderPath: r.folderPath,
                  imageFolderFiles: r.files,
                  imagePath: r.files[0],
                  imageFolderPlayMode: 'sequence',
                  imageFolderIntervalSec: 30,
                })
              })()
            }}
          />
        </div>
      </div>
    </div>
  )
}
