import React, {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useMemo,
  useCallback,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type SetStateAction,
} from 'react'
import { createPortal, flushSync } from 'react-dom'
import {
  DndContext,
  type DragEndEvent,
  type DraggableSyntheticListeners,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { Transform } from '@dnd-kit/utilities'
// Framer Motion Reorder 已移除——其 layout 投影系统在混合类型列表中
// 会导致兄弟卡片位置不随内容高度变化而更新（秒表打点后下方卡重叠）。
// 大类排序现统一使用 @dnd-kit/sortable。
import type {
  AppSettings,
  CategoryKind,
  PresetPools,
  ReminderCategory,
  SubReminder,
  CountdownItem,
  PopupTheme,
  PopupThemeTarget,
  AppThemeSetting,
} from '../types'
import {
  getDefaultPresetPools,
  getStableDefaultCategories,
  getDefaultPopupThemes,
  getDefaultEntitlements,
  genId,
  BUILTIN_MAIN_POPUP_FALLBACK_BODY,
  BUILTIN_REST_POPUP_FALLBACK_BODY,
  mergeSystemBuiltinPopupThemes,
  getDefaultPopupThemeIdForTarget,
  MAIN_REST_LAYOUT_DEFAULTS,
  SYSTEM_MAIN_POPUP_THEME_ID,
  SYSTEM_REST_POPUP_THEME_ID,
  SYSTEM_DESKTOP_POPUP_THEME_ID,
  REST_POPUP_PREVIEW_TIME_TEXT,
} from '../types'
import {
  AddSubReminderModal,
  type AddSubReminderPayload,
  type OpenThemeStudioEditFromSubitemArgs,
  type SubReminderModalThemeEditorContext,
} from '../components/AddSubReminderModal'
import { PresetTextField } from '../components/PresetTextField'
import { WeekdayRepeatControl } from '../components/WeekdayRepeatControl'
import { SplitSegmentProgressBar, SingleCycleProgressBar } from '../components/SegmentProgressBars'
import {
  emptyStopwatch,
  formatStopwatchDisplay,
  getStopwatchElapsedMs,
  stopwatchLap,
  stopwatchRemoveLap,
  stopwatchToggleRunning,
  type StopwatchRuntime,
} from '../utils/stopwatchUtils'
import { type TextElementKey } from '../components/ThemePreviewEditor'
import { ThemeStudioListView, ThemeStudioFloatingEditor, type ThemeStudioFloatingSource } from '../components/ThemeStudio'
import { PopupThemeSelectWithHoverPreview } from '../components/PopupThemeSelectWithHoverPreview'
import { buildSplitSchedule } from '../../../shared/splitSchedule'
import { collectPopupThemeImagePathsForPreview } from '../utils/popupThemePreview'
import {
  buildNewDesktopThemePatch,
  mergeContentThemePatchIntoBindingTextLayer,
} from '../../../shared/popupThemeLayers'
import { clonePopupThemeForFork } from '../../../shared/popupThemeUtils'
import { ThemeToggle } from '../components/ThemeToggle'
import { applyAppThemeClass } from '../utils/appThemeUtils'

/** 每次使用时读取，避免模块加载时 preload 尚未注入 */
function getApi() {
  return window.electronAPI
}

const defaultSettings: AppSettings = {
  reminderCategories: getStableDefaultCategories(),
  presetPools: getDefaultPresetPools(),
  popupThemes: getDefaultPopupThemes(),
  entitlements: getDefaultEntitlements(),
}

/** 列表筛选：全部 / 仅闹钟大类 / 仅倒计时大类 */
type CategoryListFilter = 'all' | 'alarm' | 'countdown' | 'stopwatch'
type PopupPreviewAspect = '16:9' | '16:10' | '21:9' | '32:9' | '3:2' | '4:3'
type PopupPreviewAspectPreset = 'system' | PopupPreviewAspect

const POPUP_PREVIEW_ASPECT_RATIO_MAP: Record<PopupPreviewAspect, number> = {
  '16:9': 16 / 9,
  '16:10': 16 / 10,
  '21:9': 21 / 9,
  '32:9': 32 / 9,
  '3:2': 3 / 2,
  '4:3': 4 / 3,
}

function nearestPopupPreviewAspectFromDisplay(width: number, height: number): PopupPreviewAspect {
  const ratio = width > 0 && height > 0 ? width / height : 16 / 9
  let best: PopupPreviewAspect = '16:9'
  let diff = Number.POSITIVE_INFINITY
  for (const key of Object.keys(POPUP_PREVIEW_ASPECT_RATIO_MAP) as PopupPreviewAspect[]) {
    const d = Math.abs(POPUP_PREVIEW_ASPECT_RATIO_MAP[key] - ratio)
    if (d < diff) {
      diff = d
      best = key
    }
  }
  return best
}

/** 与下方主内容的状态更新隔离，避免主题工坊缩略图 / 预览图 map 刷新时整块重渲让顶栏看起来「卡在中间态」 */
const SettingsReminderTabRow = React.memo(function SettingsReminderTabRow({
  categoryListFilter,
  themeStudioOpen,
  onCategory,
  onStudio,
}: {
  categoryListFilter: CategoryListFilter
  themeStudioOpen: boolean
  onCategory: (f: CategoryListFilter) => void
  onStudio: () => void
}) {
  return (
    <div className="box-border flex w-full min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="提醒类型筛选">
        {(
          [
            { id: 'all' as const, label: '全部' },
            { id: 'alarm' as const, label: '闹钟' },
            { id: 'countdown' as const, label: '倒计时' },
            { id: 'stopwatch' as const, label: '秒表' },
          ] as const
        ).map(({ id, label }) => {
          const active = !themeStudioOpen && categoryListFilter === id
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onCategory(id)}
              className={`rounded-md px-4 py-2 text-sm font-medium ${
                active
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'border border-transparent bg-slate-50 text-slate-700 hover:bg-slate-100'
              }`}
            >
              {label}
            </button>
          )
        })}
      </div>
      <button
        type="button"
        role="tab"
        aria-selected={themeStudioOpen}
        onClick={onStudio}
        className={`shrink-0 rounded-md px-3 py-2 text-sm font-medium ${
          themeStudioOpen
            ? 'bg-slate-800 text-white shadow-sm'
            : 'border border-slate-300 bg-white text-slate-800 shadow-sm hover:bg-slate-50'
        }`}
      >
        主题工坊
      </button>
    </div>
  )
})

/**
 * dnd-kit sortable 在「布局动画」时会用 useDerivedTransform 加 scaleX/scaleY（旧包围盒/新包围盒），
 * 可变高度子项在拖过另一行时会被纵向拉长或压扁；只保留平移即可保持卡片固有高度。
 */
function sortableTranslateOnly(t: Transform | null): string | undefined {
  if (!t) return undefined
  const x = t.x ?? 0
  const y = t.y ?? 0
  if (x === 0 && y === 0) return undefined
  return `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`
}

/** 在「非全部」筛选下拖拽大类后，把可见顺序合并回完整列表（保持被隐藏大类的相对位置） */
function mergeVisibleCategoryOrder(full: ReminderCategory[], newVisibleOrder: ReminderCategory[]): ReminderCategory[] {
  const visibleIds = new Set(newVisibleOrder.map((c) => c.id))
  let vi = 0
  return full.map((item) => (visibleIds.has(item.id) ? newVisibleOrder[vi++]! : item))
}

function formatRemaining(remainingMs: number): string {
  const s = Math.max(0, Math.floor(remainingMs / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${m}:${String(sec).padStart(2, '0')}`
}

/** 时间戳或 Date 格式化为 HH:mm，用于起止时间标签 */
function formatTimeHHmm(ts: number | Date): string {
  const d = typeof ts === 'number' ? new Date(ts) : ts
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 本地实时走表用 HH:mm:ss（「当前时间」模式待启动/已结束时左侧开始） */
function formatTimeHms(ts: number | Date): string {
  const d = typeof ts === 'number' ? new Date(ts) : ts
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

function formatTimeWithDay(ts: number | undefined, fallbackHHmm: string | undefined, label: '开始' | '结束'): string {
  if (ts != null) {
    const d = new Date(ts)
    const now = new Date()
    const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    const isTomorrow = d.getDate() !== now.getDate() || d.getMonth() !== now.getMonth() || d.getFullYear() !== now.getFullYear()
    return isTomorrow ? `明天${label} ${hhmm}` : `${label} ${hhmm}`
  }
  return fallbackHHmm ? `${label} ${fallbackHHmm}` : `${label} —`
}

/** 间隔项显示为 H:MM:SS */
function formatIntervalHms(item: SubReminder & { mode: 'interval' }): string {
  const h = item.intervalHours ?? 0
  const m = item.intervalMinutes
  const s = item.intervalSeconds ?? 0
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// clampByViewport 已移至 ThemePreviewEditor 组件内部

function getDefaultCategoryName(kind: CategoryKind): string {
  return kind === 'alarm' ? '未命名闹钟类型' : kind === 'countdown' ? '未命名倒计时类型' : '未命名秒表类型'
}

function getDefaultSubTitle(mode: 'fixed' | 'interval' | 'stopwatch'): string {
  return mode === 'fixed' ? '未命名闹钟' : mode === 'interval' ? '未命名倒计时' : '未命名秒表'
}

function isTimedSubReminder(item: SubReminder): item is Extract<SubReminder, { mode: 'fixed' | 'interval' }> {
  return item.mode === 'fixed' || item.mode === 'interval'
}

/** 删除确认弹窗用展示名 */
function subReminderConfirmLabel(item: SubReminder): string {
  const t = (isTimedSubReminder(item) ? (item.title ?? '') : '').trim()
  if (t) return t
  return getDefaultSubTitle(item.mode)
}

/** 倒计时/秒表：左侧大号时间（闹钟 fixed 另用双侧开始/结束，不走此函数） */
function getSubReminderLargeTimeMain(item: SubReminder, cd: CountdownItem | undefined): string {
  if (item.mode === 'stopwatch') return '—'
  if (item.mode === 'fixed') return '—'
  const iv = item as SubReminder & { mode: 'interval' }
  if (iv.enabled === false) return formatIntervalHms(iv)
  if (cd?.ended) return formatIntervalHms(iv)
  if (!cd) return formatIntervalHms(iv)
  return formatRemaining(cd.remainingMs)
}

function normalizeHHmmFromSetting(s: string | undefined): string {
  if (!s) return '—'
  const m = s.match(/^(\d{1,2}):(\d{2})/)
  if (!m) return s.slice(0, 5)
  const h = Math.min(23, Math.max(0, parseInt(m[1]!, 10) || 0))
  return `${String(h).padStart(2, '0')}:${m[2]}`
}

/** 闹钟左右大块：顶行「开始/明天开始」「结束/明天结束」，下行 HH:mm（与旧进度条上 formatTimeWithDay 语义一致） */
function getFixedAlarmTimeBlock(
  item: SubReminder & { mode: 'fixed' },
  cd: CountdownItem | undefined,
  which: 'start' | 'end',
  opts?: { liveWallClockMs?: number },
): { caption: string; timeLine: string } {
  const label: '开始' | '结束' = which === 'start' ? '开始' : '结束'
  if (which === 'start') {
    if (opts?.liveWallClockMs != null) {
      return { caption: label, timeLine: formatTimeHms(opts.liveWallClockMs) }
    }
    const ts = cd?.type === 'fixed' ? cd.windowStartAt : undefined
    const fallbackStr =
      cd?.type === 'fixed' && cd.startTime
        ? cd.startTime
        : (item.startTime ?? item.time)
    return fixedAlarmCaptionAndHHmm(label, ts, fallbackStr)
  }
  const ts = cd?.type === 'fixed' ? cd.windowEndAt : undefined
  const fallbackStr = cd?.type === 'fixed' && cd.time ? cd.time : item.time
  return fixedAlarmCaptionAndHHmm(label, ts, fallbackStr)
}

function fixedAlarmCaptionAndHHmm(
  label: '开始' | '结束',
  ts: number | undefined,
  fallbackHHmm: string | undefined,
): { caption: string; timeLine: string } {
  if (ts != null) {
    const d = new Date(ts)
    const now = new Date()
    const isTomorrow =
      d.getDate() !== now.getDate() ||
      d.getMonth() !== now.getMonth() ||
      d.getFullYear() !== now.getFullYear()
    return {
      caption: isTomorrow ? `明天${label}` : label,
      timeLine: formatTimeHHmm(d),
    }
  }
  return {
    caption: label,
    timeLine: normalizeHHmmFromSetting(fallbackHHmm),
  }
}

/** 时间漏斗图标，用于倒计时区域 */
function HourglassIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 4h12M6 20h12M6 4l6 8 6-8M6 20l6-8 6 8" />
    </svg>
  )
}

/**
 * 沙漏+文字跟随进度锚点横向移动；锚点在中间时用 translate 居中对齐进度点，
 * 靠近左右端时夹紧在进度条容器内，避免与左侧时间列重叠或超出右边界。
 */
function ClampedProgressFloater({
  anchorPercent,
  label,
}: {
  anchorPercent: number
  label: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const floaterRef = useRef<HTMLDivElement>(null)
  const [leftPx, setLeftPx] = useState<number | null>(null)

  const updatePosition = useCallback(() => {
    const c = containerRef.current
    const f = floaterRef.current
    if (!c || !f) return
    const cw = c.getBoundingClientRect().width
    const fw = f.getBoundingClientRect().width
    if (cw <= 0 || fw <= 0) return
    const p = Math.max(0, Math.min(100, anchorPercent))
    const idealCenterPx = (p / 100) * cw
    if (fw >= cw) {
      setLeftPx(cw / 2)
      return
    }
    const half = fw / 2
    setLeftPx(Math.max(half, Math.min(idealCenterPx, cw - half)))
  }, [anchorPercent])

  useLayoutEffect(() => {
    updatePosition()
  }, [updatePosition, label])

  useEffect(() => {
    const c = containerRef.current
    if (!c) return
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(() => updatePosition())
    })
    ro.observe(c)
    const f = floaterRef.current
    if (f) ro.observe(f)
    return () => ro.disconnect()
  }, [updatePosition])

  return (
    <div ref={containerRef} className="relative h-6 min-h-[1.5rem] w-full">
      <div
        ref={floaterRef}
        className="absolute top-0 flex items-center gap-1.5 whitespace-nowrap text-sm text-slate-600 transition-[left] duration-300 ease-out"
        style={{
          left: leftPx != null ? `${leftPx}px` : `${Math.max(0, Math.min(100, anchorPercent))}%`,
          transform: 'translateX(-50%)',
        }}
      >
        <HourglassIcon className="shrink-0 text-slate-500" />
        <span className="tabular-nums">{label}</span>
      </div>
    </div>
  )
}

type SubReminderRowProps = {
  item: SubReminder
  categoryIndex: number
  itemIndex: number
  categoryId: string
  categoryName: string
  countdowns: CountdownItem[]
  updateItem: (ci: number, ii: number, patch: Partial<SubReminder>) => void
  removeItem: (ci: number, ii: number) => void
  restContentPresets: string[]
  subTitlePresets: PresetPools['subTitle']
  popupThemes: PopupTheme[]
  onOpenThemeStudioList?: () => void
  onOpenThemeStudioEdit?: (args: OpenThemeStudioEditFromSubitemArgs) => void
  /** @dnd-kit/sortable：仅手柄上 spread，避免 Framer Reorder 在可变高度下与鼠标错位 */
  sortableListeners: DraggableSyntheticListeners
  isSortableDragging: boolean
  repeatDropdown: { categoryIndex: number; itemIndex: number } | null
  setRepeatDropdown: Dispatch<SetStateAction<{ categoryIndex: number; itemIndex: number } | null>>
  /** 重置后立即刷新倒计时列表，使界面马上更新 */
  refreshCountdowns?: () => void
  /** 点击时钟/间隔：展开或收起与新建一致的内联表单 */
  expandedEditSub: { categoryId: string; itemId: string } | null
  toggleExpandedEditSub: (categoryId: string, itemId: string) => void
  onConfirmEmbeddedEdit: (categoryId: string, itemId: string, payload: AddSubReminderPayload) => void | Promise<void>
  /** 更新休息壁纸预览相关预设（内联弹窗） */
  onRestContentPresetsChange: (presets: string[]) => void
  /** 更新子项标题预设（按 mode 分池） */
  onSubTitlePresetsChange: (mode: 'fixed' | 'interval' | 'stopwatch', presets: string[]) => void
  /** 立即切换启用状态（并立刻生效） */
  onToggleEnabledNow: (categoryIndex: number, itemIndex: number, enabled: boolean) => void | Promise<void>
  /** 子项弹窗内全屏编辑主题（与主题工坊能力一致） */
  subReminderThemeEditor: SubReminderModalThemeEditorContext | null
  popupThemeRemotePatch: {
    categoryId: string
    anchor: string
    mainPopupThemeId?: string
    restPopupThemeId?: string
  } | null
  onConsumePopupThemeRemotePatch: () => void
  previewImageUrlMap: Record<string, string>
  previewViewportWidth: number
  popupPreviewAspect: PopupPreviewAspect
}

/** 秒表子项：状态仅在各自组件内，避免全局 Map 键冲突导致多表互相清空 */
function StopwatchReminderRow({
  item,
  categoryIndex,
  itemIndex,
  sortableListeners,
  isSortableDragging,
  removeItem,
  updateItem,
  titlePresets,
  onTitlePresetsChange,
}: {
  item: SubReminder & { mode: 'stopwatch' }
  categoryIndex: number
  itemIndex: number
  sortableListeners: DraggableSyntheticListeners
  isSortableDragging: boolean
  removeItem: (ci: number, ii: number) => void
  updateItem: (ci: number, ii: number, patch: Partial<SubReminder>) => void
  titlePresets: string[]
  onTitlePresetsChange: (presets: string[]) => void
}) {
  const MAX_LAPS = 200
  const [swState, setSwState] = useState<StopwatchRuntime>(() => emptyStopwatch())
  const [editingTitle, setEditingTitle] = useState(false)
  const [rowHeaderHot, setRowHeaderHot] = useState(false)
  const [rowOverflowMenuOpen, setRowOverflowMenuOpen] = useState(false)
  const rowActionChromeVisible = rowHeaderHot || rowOverflowMenuOpen
  const [lapsExpanded, setLapsExpanded] = useState(true)
  const [lapLimitTipVisible, setLapLimitTipVisible] = useState(false)
  const [selectedLapIds, setSelectedLapIds] = useState<Set<string>>(() => new Set())
  const [showSelectedOnly, setShowSelectedOnly] = useState(false)
  const [dragSelectValue, setDragSelectValue] = useState<boolean | null>(null)
  const ignoreNextSelectClickRef = useRef(false)
  const [copyTipVisible, setCopyTipVisible] = useState(false)
  const [lapsScrollbarWidth, setLapsScrollbarWidth] = useState(0)
  const lapLimitTipTimerRef = useRef<number | null>(null)
  const copyTipTimerRef = useRef<number | null>(null)
  const titleEditRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!editingTitle) return
    const onDown = (e: MouseEvent) => {
      if (titleEditRef.current && !titleEditRef.current.contains(e.target as Node)) {
        setEditingTitle(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [editingTitle])
  useEffect(() => {
    return () => {
      if (lapLimitTipTimerRef.current) window.clearTimeout(lapLimitTipTimerRef.current)
      if (copyTipTimerRef.current) window.clearTimeout(copyTipTimerRef.current)
    }
  }, [])
  useEffect(() => {
    if (dragSelectValue === null) return
    const onUp = () => {
      setDragSelectValue(null)
      setTimeout(() => {
        ignoreNextSelectClickRef.current = false
      }, 0)
    }
    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [dragSelectValue])
  useEffect(() => {
    if (!editingTitle) return
    const el = titleEditRef.current?.querySelector('input')
    if (el) el.focus()
  }, [editingTitle])
  const [, setDisplayTick] = useState(0)
  useEffect(() => {
    if (!swState.running) return
    const id = window.setInterval(() => setDisplayTick((n) => n + 1), 50)
    return () => window.clearInterval(id)
  }, [swState.running])

  const elapsedMs = getStopwatchElapsedMs(swState)
  const canReset = !swState.running && (swState.accumulatedMs > 0 || swState.laps.length > 0)
  const lapsLen = swState.laps.length
  const selectedCount = selectedLapIds.size
  const allSelected = lapsLen > 0 && selectedCount === lapsLen
  const someSelected = selectedCount > 0 && selectedCount < lapsLen
  const displayedLaps = showSelectedOnly
    ? swState.laps.filter((lap) => selectedLapIds.has(lap.id))
    : swState.laps

  useEffect(() => {
    const validIds = new Set(swState.laps.map((lap) => lap.id))
    let changed = false
    const next = new Set<string>()
    for (const id of selectedLapIds) {
      if (validIds.has(id)) next.add(id)
      else changed = true
    }
    if (changed) setSelectedLapIds(next)
    if (showSelectedOnly && next.size === 0) setShowSelectedOnly(false)
  }, [swState.laps, selectedLapIds, showSelectedOnly])
  const showLapLimitTip = () => {
    if (lapLimitTipTimerRef.current) window.clearTimeout(lapLimitTipTimerRef.current)
    setLapLimitTipVisible(true)
    lapLimitTipTimerRef.current = window.setTimeout(() => {
      setLapLimitTipVisible(false)
      lapLimitTipTimerRef.current = null
    }, 1400)
  }
  const handleLap = () => {
    if (swState.laps.length >= MAX_LAPS) {
      showLapLimitTip()
      return
    }
    setSwState((s) => stopwatchLap(s))
  }
  /** 新打点插在列表顶部，保持滚条在顶以看到最新一条；避免浏览器在内层滚动容器上算锚点牵连整页 */
  const lapsScrollRef = useRef<HTMLUListElement>(null)
  useLayoutEffect(() => {
    if (lapsLen === 0) return
    const el = lapsScrollRef.current
    if (el) el.scrollTop = 0
  }, [lapsLen])
  useEffect(() => {
    if (!lapsExpanded) {
      setLapsScrollbarWidth(0)
      return
    }
    const el = lapsScrollRef.current
    if (!el) return
    const updateScrollbarWidth = () => {
      const width = Math.max(0, el.offsetWidth - el.clientWidth)
      setLapsScrollbarWidth(width)
    }
    updateScrollbarWidth()
    const ro = new ResizeObserver(() => updateScrollbarWidth())
    ro.observe(el)
    return () => ro.disconnect()
  }, [lapsExpanded, lapsLen, displayedLaps.length])
  const toggleLapSelected = (id: string) => {
    setSelectedLapIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const setLapSelected = (id: string, value: boolean) => {
    setSelectedLapIds((prev) => {
      const has = prev.has(id)
      if ((has && value) || (!has && !value)) return prev
      const next = new Set(prev)
      if (value) next.add(id)
      else next.delete(id)
      return next
    })
  }
  const startDragSelect = (id: string, e: React.MouseEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const nextValue = !selectedLapIds.has(id)
    setLapSelected(id, nextValue)
    setDragSelectValue(nextValue)
    ignoreNextSelectClickRef.current = true
  }
  const dragSelect = (id: string) => {
    if (dragSelectValue === null) return
    setLapSelected(id, dragSelectValue)
  }
  const handleSelectClick = (id: string, e: React.MouseEvent<HTMLButtonElement>) => {
    if (ignoreNextSelectClickRef.current) {
      e.preventDefault()
      e.stopPropagation()
      return
    }
    toggleLapSelected(id)
  }
  const handleSelectAll = () => {
    if (allSelected) {
      setSelectedLapIds(new Set())
      setShowSelectedOnly(false)
      return
    }
    setSelectedLapIds(new Set(swState.laps.map((lap) => lap.id)))
  }
  const copySelectedLaps = async () => {
    const lines = swState.laps
      .filter((lap) => selectedLapIds.has(lap.id))
      .map((lap) => `计次${lap.lapIndex} 分段${formatStopwatchDisplay(lap.splitMs)} 累计${formatStopwatchDisplay(lap.totalMs)}`)
    if (lines.length === 0) return
    const text = lines.join('\n')
    try {
      await navigator.clipboard.writeText(text)
      if (copyTipTimerRef.current) window.clearTimeout(copyTipTimerRef.current)
      setCopyTipVisible(true)
      copyTipTimerRef.current = window.setTimeout(() => {
        setCopyTipVisible(false)
        copyTipTimerRef.current = null
      }, 1200)
    } catch {
      // ignore
    }
  }
  const deleteSelectedLaps = () => {
    if (selectedLapIds.size === 0) return
    setSwState((s) => {
      let next = s
      for (const id of selectedLapIds) {
        next = stopwatchRemoveLap(next, id)
      }
      return next
    })
    setSelectedLapIds(new Set())
    setShowSelectedOnly(false)
  }

  return (
    <div
      className={`flex min-h-0 min-w-0 flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 transition-[box-shadow,transform] ${
        isSortableDragging
          ? 'scale-[1.02] shadow-[0_4px_16px_-2px_rgba(0,0,0,0.08)] bg-[rgb(241_245_249)]'
          : ''
      }`}
    >
      {/* 标题行：左拖拽手柄 | 标题输入框 | 删除 | 右拖拽手柄 */}
      <div
        className="-mx-3 mb-1 flex w-[calc(100%+1.5rem)] min-w-0 items-center gap-2 border-b border-slate-200 px-3 pb-2"
        onMouseEnter={() => setRowHeaderHot(true)}
        onMouseLeave={() => {
          requestAnimationFrame(() => {
            if (!rowOverflowMenuOpen) setRowHeaderHot(false)
          })
        }}
      >
        <div className="relative flex min-w-0 flex-1">
          {editingTitle ? (
            <div
              ref={titleEditRef}
              className="w-full"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.target === titleEditRef.current?.querySelector('input')) {
                  setEditingTitle(false)
                }
              }}
            >
              <PresetTextField
                resetKey={`row-sw-${item.id}`}
                value={item.content ?? ''}
                onChange={(v) => updateItem(categoryIndex, itemIndex, { content: v })}
                presets={titlePresets}
                onPresetsChange={onTitlePresetsChange}
                mainPlaceholder="请输入秒表标题"
                inputClassName="text-left font-bold"
              />
            </div>
          ) : (
            <div
              className="flex h-9 w-full cursor-text items-center justify-start rounded pl-2 pr-9 text-sm font-bold hover:bg-slate-50"
              onClick={() => setEditingTitle(true)}
              title="点击编辑标题"
            >
              {item.content ? (
                <span className="truncate text-slate-700">{item.content}</span>
              ) : (
                <span className="truncate text-slate-300">{getDefaultSubTitle('stopwatch')}</span>
              )}
            </div>
          )}
        </div>
        <div
          className={`shrink-0 transition-opacity duration-150 ${
            rowActionChromeVisible ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          <SubReminderOverflowMenu
            menuId={`subitem-overflow-sw-${item.id}`}
            onRemove={() => removeItem(categoryIndex, itemIndex)}
            onOpenChange={setRowOverflowMenuOpen}
          />
        </div>
        <div
          className={`min-w-[1.5rem] w-6 flex-shrink-0 flex items-center justify-center cursor-grab active:cursor-grabbing select-none transition-opacity duration-150 ${
            rowActionChromeVisible ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
          }`}
          style={{ touchAction: 'none' }}
          {...sortableListeners}
          title="拖动调整子项顺序"
        >
          <span className="select-none touch-none text-slate-500" aria-hidden>
            ⋮⋮
          </span>
        </div>
      </div>
      {/* 时间显示 */}
      <div
        className="flex w-full justify-center py-4 sm:py-5"
        aria-label={`秒表 ${formatStopwatchDisplay(elapsedMs)}`}
      >
        <span className="text-center text-4xl font-bold tabular-nums leading-none tracking-tight text-slate-900 sm:text-5xl md:text-6xl">
          {formatStopwatchDisplay(elapsedMs)}
        </span>
      </div>
      <div className="flex w-full flex-wrap items-center justify-center gap-3 pt-2 sm:pt-3">
        <button
          type="button"
          onClick={() => setSwState((s) => stopwatchToggleRunning(s))}
          className="min-w-[5.5rem] rounded-lg bg-slate-800 px-5 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          {swState.running ? '停止' : '启动'}
        </button>
        {swState.running ? (
          <button
            type="button"
            onClick={handleLap}
            className="min-w-[5.5rem] rounded-lg border border-slate-300 bg-white px-5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            打点
          </button>
        ) : (
          <button
            type="button"
            disabled={!canReset}
            onClick={() => setSwState(emptyStopwatch())}
            className="min-w-[5.5rem] rounded-lg border border-slate-300 bg-white px-5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            复位
          </button>
        )}
      </div>
      <div className="mt-1 flex min-w-0 flex-col gap-2 sm:mt-2">
        {swState.laps.length > 0 ? (
          <div
            className={`relative min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white text-xs ${isSortableDragging ? 'pointer-events-none' : ''}`}
          >
            {lapLimitTipVisible && (
              <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
                <div className="rounded bg-slate-900/95 px-3 py-1.5 text-xs text-white shadow-lg">
                  最多支持 200 次打点
                </div>
              </div>
            )}
            {copyTipVisible && (
              <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
                <div className="rounded bg-slate-900/95 px-3 py-1.5 text-xs text-white shadow-lg">
                  已复制选中打点
                </div>
              </div>
            )}
            {selectedCount > 0 && (
              <div className="flex items-center justify-end gap-2 border-b border-slate-100 bg-slate-50 px-4 py-1.5">
                <button
                  type="button"
                  className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-800"
                  onClick={() => void copySelectedLaps()}
                  title="复制选中记录"
                >
                  复制
                </button>
                <button
                  type="button"
                  className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-800"
                  onClick={() => setShowSelectedOnly((v) => !v)}
                  title={showSelectedOnly ? '显示全部记录' : '仅显示选中记录'}
                >
                  {showSelectedOnly ? '显示全部' : '独显'}
                </button>
                <button
                  type="button"
                  className="rounded border border-red-200 bg-red-50 px-2 py-0.5 text-xs text-red-600 transition-colors hover:bg-red-100 hover:text-red-700"
                  onClick={deleteSelectedLaps}
                  title="删除选中记录"
                >
                  删除
                </button>
              </div>
            )}
            <div
              className="grid grid-cols-[3rem_6.5rem_6.5rem_1fr_4.5rem_4rem] items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-1.5 font-medium text-slate-500 tabular-nums"
              style={{ paddingRight: `${16 + lapsScrollbarWidth}px` }}
            >
              <span className="text-center">计次</span>
              <span className="text-center">分段</span>
              <span className="text-center">累计</span>
              <span />
              <div className="flex items-center justify-center gap-2">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={allSelected}
                  className={`rounded px-2 py-0.5 text-xs transition-colors hover:bg-slate-200 ${
                    someSelected ? 'text-slate-700' : 'text-slate-600'
                  }`}
                  onClick={handleSelectAll}
                  title={allSelected ? '取消全选' : '全选'}
                >
                  {allSelected ? '取消全选' : '全选'}
                </button>
              </div>
              <button
                type="button"
                className="justify-self-end rounded px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-200 hover:text-slate-800"
                onClick={() => setLapsExpanded((v) => !v)}
                title={lapsExpanded ? '收起打点列表' : '展开打点列表'}
              >
                {lapsExpanded ? '收起' : '展开'}
              </button>
            </div>
            {lapsExpanded && (
              <ul
                ref={lapsScrollRef}
                className="max-h-80 min-h-0 overflow-y-auto overflow-x-hidden [overflow-anchor:none]"
              >
                {displayedLaps.map((lap) => (
                  <li
                    key={lap.id}
                    className="group grid grid-cols-[3rem_6.5rem_6.5rem_1fr_4.5rem_4rem] items-center gap-2 border-b border-slate-100 px-4 py-1.5 tabular-nums text-slate-800 hover:bg-slate-50 last:border-b-0"
                  >
                    <span className="text-center text-sm font-semibold">{lap.lapIndex}</span>
                    <span className="text-center text-base font-bold">{formatStopwatchDisplay(lap.splitMs)}</span>
                    <span className="text-base font-bold text-center">{formatStopwatchDisplay(lap.totalMs)}</span>
                    <span />
                    <div className="flex justify-center">
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={selectedLapIds.has(lap.id)}
                        className={`h-4 w-4 rounded-full transition-colors ${
                          selectedLapIds.has(lap.id)
                            ? 'bg-emerald-500'
                            : 'border border-slate-400 bg-white hover:border-slate-500'
                        }`}
                        onMouseDown={(e) => startDragSelect(lap.id, e)}
                        onMouseEnter={() => dragSelect(lap.id)}
                        onClick={(e) => handleSelectClick(lap.id, e)}
                        title="选择此条记录"
                      />
                    </div>
                    <span />
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** 重复图标：圆形双箭头循环，置于输入框内左侧 */
function RepeatArrowsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  )
}

function IoSwitch({
  checked,
  onChange,
  id,
  ariaLabel,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  id: string
  ariaLabel?: string
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-200 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 ${
        checked ? 'bg-green-500' : 'bg-slate-300'
      }`}
      title={checked ? '已开启' : '已关闭'}
    >
      <span
        className={`pointer-events-none absolute top-[2px] left-[2px] h-[18px] w-[18px] rounded-full bg-white shadow-md transition-transform duration-200 ease-out ${
          checked ? 'translate-x-[16px]' : 'translate-x-0'
        }`}
      />
    </button>
  )
}

/** 重复次数：一体化边框，左图标 / 中次数 / 右下拉（hover 显）；默认无限(∞)，点击输入框可改数字；下拉为 ∞、1–10 快捷 */
function RepeatControl({
  categoryIndex,
  itemIndex,
  repeatCount,
  updateItem,
  repeatDropdown,
  setRepeatDropdown,
}: {
  categoryIndex: number
  itemIndex: number
  repeatCount: number | null
  updateItem: (ci: number, ii: number, patch: Partial<SubReminder>) => void
  repeatDropdown: { categoryIndex: number; itemIndex: number } | null
  setRepeatDropdown: Dispatch<SetStateAction<{ categoryIndex: number; itemIndex: number } | null>>
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [repeatInputFocused, setRepeatInputFocused] = useState(false)
  const [repeatDraft, setRepeatDraft] = useState('')
  const isRepeatOpen = repeatDropdown?.categoryIndex === categoryIndex && repeatDropdown?.itemIndex === itemIndex

  useEffect(() => {
    if (!isRepeatOpen) return
    const onMouseDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setRepeatDropdown(null)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [isRepeatOpen, setRepeatDropdown])

  /** 从下拉等外部变更时，若仍聚焦在输入框，同步草稿 */
  useEffect(() => {
    if (!repeatInputFocused) return
    setRepeatDraft(repeatCount === null ? '' : String(repeatCount))
  }, [repeatCount, repeatInputFocused])

  const close = () => setRepeatDropdown(null)

  const repeatDisplayValue = repeatInputFocused
    ? repeatDraft
    : repeatCount === null
      ? '∞'
      : String(repeatCount)

  const commitRepeatFromDraft = (rawDigits: string) => {
    if (rawDigits === '') {
      updateItem(categoryIndex, itemIndex, { repeatCount: null })
      return
    }
    const n = Math.max(1, Math.min(999, parseInt(rawDigits, 10) || 1))
    updateItem(categoryIndex, itemIndex, { repeatCount: n })
  }

  return (
    <div ref={wrapRef} className="relative flex shrink-0 group">
      {/* 总宽固定：左图标 + 中间定宽数字区 + 右三角，避免换数字时宽度跳动 */}
      <div className="flex h-8 w-[5.25rem] shrink-0 items-stretch rounded border border-slate-300 bg-white">
        <span className="flex w-6 shrink-0 items-center justify-center text-slate-500 pointer-events-none" title="重复次数">
          <RepeatArrowsIcon className="scale-90" />
        </span>
        <div className="flex w-9 shrink-0 items-center justify-center overflow-hidden px-0.5">
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={3}
            readOnly={!repeatInputFocused && repeatCount === null}
            title={repeatCount === null && !repeatInputFocused ? '点击输入数字；无限重复' : '重复次数'}
            value={repeatDisplayValue}
            onFocus={() => {
              setRepeatInputFocused(true)
              setRepeatDraft(repeatCount === null ? '' : String(repeatCount))
            }}
            onBlur={(e) => {
              setRepeatInputFocused(false)
              const raw = (e.target as HTMLInputElement).value.replace(/\D/g, '')
              commitRepeatFromDraft(raw)
              setRepeatDraft('')
            }}
            onChange={(e) => {
              const raw = e.target.value.replace(/\D/g, '')
              setRepeatDraft(raw)
              commitRepeatFromDraft(raw)
            }}
            className="box-border h-full w-full cursor-text border-0 bg-transparent py-0 text-center text-sm leading-5 tabular-nums outline-none ring-0 focus:ring-0"
            aria-label="重复次数"
          />
        </div>
        <button
          type="button"
          onClick={() => setRepeatDropdown(isRepeatOpen ? null : { categoryIndex, itemIndex })}
          className={`flex w-6 shrink-0 items-center justify-center text-slate-400 transition-opacity duration-200 ease-out hover:text-slate-600 focus:outline-none ${isRepeatOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
          title="重复选项"
          aria-label="重复选项"
          aria-expanded={isRepeatOpen}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform duration-200 ${isRepeatOpen ? 'rotate-180' : ''}`}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>
      {isRepeatOpen && (
        <div className="absolute left-0 top-full z-20 mt-1 flex min-w-full w-max flex-col rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left text-base leading-none hover:bg-slate-100"
            onClick={() => {
              updateItem(categoryIndex, itemIndex, { repeatCount: null })
              close()
            }}
            aria-label="无限重复"
            title="无限重复"
          >
            ∞
          </button>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
            <button
              key={n}
              type="button"
              className="block w-full px-3 py-1.5 text-left text-sm tabular-nums hover:bg-slate-100"
              onClick={() => {
                updateItem(categoryIndex, itemIndex, { repeatCount: n })
                close()
              }}
            >
              {n}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function SubReminderRow({
  item,
  categoryIndex,
  itemIndex,
  categoryId,
  categoryName,
  countdowns,
  updateItem,
  removeItem,
  restContentPresets,
  subTitlePresets,
  popupThemes,
  sortableListeners,
  isSortableDragging,
  repeatDropdown,
  setRepeatDropdown,
  refreshCountdowns,
  expandedEditSub,
  toggleExpandedEditSub,
  onConfirmEmbeddedEdit,
  onRestContentPresetsChange,
  onSubTitlePresetsChange,
  onOpenThemeStudioList,
  onOpenThemeStudioEdit,
  onToggleEnabledNow,
  subReminderThemeEditor,
  popupThemeRemotePatch,
  onConsumePopupThemeRemotePatch,
  previewImageUrlMap,
  previewViewportWidth,
  popupPreviewAspect,
}: SubReminderRowProps) {
  const countdownKey = `${categoryId}_${item.id}`
  const cd = countdowns.find((c) => c.key === countdownKey)
  const isTimeSettingsExpanded =
    expandedEditSub?.categoryId === categoryId && expandedEditSub?.itemId === item.id
  const largeTimeMain = getSubReminderLargeTimeMain(item, cd)
  const [editingTitle, setEditingTitle] = useState(false)
  const [rowHeaderHot, setRowHeaderHot] = useState(false)
  const [rowOverflowMenuOpen, setRowOverflowMenuOpen] = useState(false)
  const rowActionChromeVisible = rowHeaderHot || rowOverflowMenuOpen
  const titleEditRef = useRef<HTMLDivElement>(null)
  const rowTitle = (item.mode === 'fixed' || item.mode === 'interval') ? ((item.title ?? '').trim()) : ''
  const mainThemeOptions = popupThemes.filter((t) => t.target === 'main')
  const restThemeOptions = popupThemes.filter((t) => t.target === 'rest')

  useEffect(() => {
    if (!editingTitle) return
    const onDown = (e: MouseEvent) => {
      if (titleEditRef.current && !titleEditRef.current.contains(e.target as Node)) {
        setEditingTitle(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [editingTitle])

  useEffect(() => {
    if (!editingTitle) return
    const el = titleEditRef.current?.querySelector('input')
    if (el) el.focus()
  }, [editingTitle])

  if (item.mode === 'stopwatch') {
    return (
      <StopwatchReminderRow
        item={item}
        categoryIndex={categoryIndex}
        itemIndex={itemIndex}
        sortableListeners={sortableListeners}
        isSortableDragging={isSortableDragging}
        removeItem={removeItem}
        updateItem={updateItem}
        titlePresets={subTitlePresets.stopwatch}
        onTitlePresetsChange={(presets) => onSubTitlePresetsChange('stopwatch', presets)}
      />
    )
  }

  /** 已结束标记（单次闹钟结束或倒计时重复次数用完） */
  const isEnded = cd?.ended === true
  const isEnabled = item.mode === 'fixed' || item.mode === 'interval' ? item.enabled !== false : true
  const primaryActionLabel = !isEnabled ? '已关闭' : (isEnded ? '启动' : '重置')
  const isFixedSingleShot = item.mode === 'fixed' && Array.isArray(item.weekdaysEnabled) && item.weekdaysEnabled.length === 7 && !item.weekdaysEnabled.some(Boolean)
  const isFixedSingleEnded = item.mode === 'fixed' && isFixedSingleShot && isEnded

  const isInactive = isEnded || !isEnabled
  /** 进度条剩余比例 0~1；结束/关闭后为 0（不再填充绿色）。固定时间重置后以 cycleStartAt 为起点算本周期 */
  const progressRatio = (() => {
    if (!cd) return 1
    if (isInactive) return 0
    if (cd.type === 'fixed') {
      if (cd.fixedState === 'pending') return 1
      if (cd.remainingMs <= 0) return 1
      if (cd.windowStartAt != null && cd.windowEndAt != null) {
        const cycleTotalMs = cd.windowEndAt - cd.windowStartAt
        if (cycleTotalMs <= 0) return 1
        return Math.min(1, cd.remainingMs / cycleTotalMs)
      }
      const totalMs = 24 * 3600 * 1000
      return Math.min(1, cd.remainingMs / totalMs)
    }
    if (item.mode !== 'interval') return 1
    const splitN = item.splitCount ?? 1
    const totalIntervalMs = ((item.intervalHours ?? 0) * 3600 + item.intervalMinutes * 60 + (item.intervalSeconds ?? 0)) * 1000
    const plan = buildSplitSchedule(totalIntervalMs, splitN, (item.restDurationSeconds ?? 0) * 1000)
    const cycleTotalMs = plan.cycleTotalMs
    if (cycleTotalMs <= 0) return 1
    if (cd.remainingMs <= 0) return 1
    if (cd.repeatCount != null && cd.firedCount != null && cd.firedCount >= cd.repeatCount) return 0
    if (splitN <= 1) return Math.min(1, cd.remainingMs / cycleTotalMs)
    if (cd.cycleTotalMs != null && cd.cycleTotalMs > 0) {
      return Math.min(1, cd.remainingMs / cd.cycleTotalMs)
    }
    const elapsedInInterval = Math.max(0, cycleTotalMs - cd.remainingMs)
    const elapsedInCycle = Math.min(cycleTotalMs, elapsedInInterval)
    return Math.min(1, (cycleTotalMs - elapsedInCycle) / cycleTotalMs)
  })()
  const fixedItem = item.mode === 'fixed' ? item : null
  /** 「当前时间」模式：未开始或已结束待下一轮时，左侧开始为实时走表，非日程上的下一窗格时间 */
  const fixedStartUsesLiveWall =
    fixedItem != null &&
    fixedItem.useNowAsStart === true &&
    cd != null &&
    cd.type === 'fixed' &&
    (cd.fixedState === 'pending' || cd.ended === true)
  const [, setLiveWallTick] = useState(0)
  useEffect(() => {
    if (!fixedStartUsesLiveWall) return
    const id = window.setInterval(() => setLiveWallTick((t) => t + 1), 1000)
    return () => window.clearInterval(id)
  }, [fixedStartUsesLiveWall])
  const fixedStartBlock = fixedItem
    ? getFixedAlarmTimeBlock(
        fixedItem,
        cd,
        'start',
        fixedStartUsesLiveWall ? { liveWallClockMs: Date.now() } : undefined,
      )
    : null
  const fixedEndBlock = fixedItem ? getFixedAlarmTimeBlock(fixedItem, cd, 'end') : null
  const fixedStartBlockSafe = fixedStartBlock ?? { caption: '开始', timeLine: '—' }
  const fixedEndBlockSafe = fixedEndBlock ?? { caption: '结束', timeLine: '—' }
  const isHmsFormat = largeTimeMain.split(':').length >= 3 || fixedStartUsesLiveWall
  const timeFontClass = isHmsFormat ? 'text-4xl sm:text-5xl' : 'text-5xl sm:text-6xl'

  return (
    <div
      className={`relative flex flex-col gap-1.5 rounded-lg border border-slate-200 bg-slate-50 p-3 transition-[box-shadow,transform] ${
        isSortableDragging
          ? 'scale-[1.02] shadow-[0_4px_16px_-2px_rgba(0,0,0,0.08)] bg-[rgb(241_245_249)]'
          : ''
      }`}
    >
      {isTimeSettingsExpanded ? (
        <div className="flex w-full min-w-0 flex-col gap-2">
          <div
            className="flex flex-nowrap items-center justify-end gap-2"
            onMouseEnter={() => setRowHeaderHot(true)}
            onMouseLeave={() => {
              requestAnimationFrame(() => {
                if (!rowOverflowMenuOpen) setRowHeaderHot(false)
              })
            }}
          >
            <div
              className={`shrink-0 transition-opacity duration-150 ${
                rowActionChromeVisible ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
              }`}
            >
              <SubReminderOverflowMenu
                menuId={`subitem-overflow-edit-${item.id}`}
                onRemove={() => removeItem(categoryIndex, itemIndex)}
                onOpenChange={setRowOverflowMenuOpen}
              />
            </div>
            <div
              className={`min-w-[1.5rem] w-6 flex-shrink-0 flex items-center justify-center cursor-grab active:cursor-grabbing select-none transition-opacity duration-150 ${
                rowActionChromeVisible ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
              }`}
              style={{ touchAction: 'none' }}
              {...sortableListeners}
              title="拖动调整子项顺序"
            >
              <span className="select-none touch-none text-slate-500" aria-hidden>
                ⋮⋮
              </span>
            </div>
          </div>
          <AddSubReminderModal
            open
            layout="embedded"
            formInstanceKey={`edit-embedded-${item.id}`}
            variant="edit"
            mode={item.mode}
            sourceItem={item}
            titlePresets={item.mode === 'fixed' ? subTitlePresets.fixed : subTitlePresets.interval}
            restPresets={restContentPresets}
            popupThemes={popupThemes}
            onClose={() => toggleExpandedEditSub(categoryId, item.id)}
            onConfirm={(payload) => {
              void onConfirmEmbeddedEdit(categoryId, item.id, payload)
            }}
            onTitlePresetsChange={(presets) => onSubTitlePresetsChange(item.mode, presets)}
            onRestPresetsChange={onRestContentPresetsChange}
            onOpenThemeStudioList={onOpenThemeStudioList}
            onOpenThemeStudioEdit={onOpenThemeStudioEdit}
            embeddedThemeStudioContext={{ categoryId, anchor: item.id }}
            themeEditorContext={subReminderThemeEditor ?? undefined}
            popupThemeRemotePatch={popupThemeRemotePatch}
            onConsumePopupThemeRemotePatch={onConsumePopupThemeRemotePatch}
          />
        </div>
      ) : (
      <>
      <div className="flex w-full min-w-0 flex-col gap-1.5">
      <div
        className="-mx-3 mb-1 flex w-[calc(100%+1.5rem)] min-w-0 items-center gap-2 border-b border-slate-200 px-3 pb-2"
        onMouseEnter={() => setRowHeaderHot(true)}
        onMouseLeave={() => {
          requestAnimationFrame(() => {
            if (!rowOverflowMenuOpen) setRowHeaderHot(false)
          })
        }}
      >
        <div className="relative flex min-w-0 flex-1">
          {editingTitle ? (
            <div
              ref={titleEditRef}
              className="w-full"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.target === titleEditRef.current?.querySelector('input')) {
                  setEditingTitle(false)
                }
              }}
            >
              <PresetTextField
                resetKey={`row-title-${item.id}`}
                value={rowTitle}
                onChange={(v) => updateItem(categoryIndex, itemIndex, { title: v } as Partial<SubReminder>)}
                presets={item.mode === 'fixed' ? subTitlePresets.fixed : subTitlePresets.interval}
                onPresetsChange={(presets) => onSubTitlePresetsChange(item.mode, presets)}
                mainPlaceholder="请输入标题"
                inputClassName="text-left font-bold"
              />
            </div>
          ) : (
            <div
              className="flex h-9 w-full cursor-text items-center justify-start rounded pl-2 pr-9 text-sm font-bold hover:bg-slate-50"
              onClick={() => setEditingTitle(true)}
              title="点击编辑标题"
            >
              {rowTitle ? (
                <span className="truncate text-slate-700">{rowTitle}</span>
              ) : (
                <span className="truncate text-slate-300">{getDefaultSubTitle(item.mode)}</span>
              )}
            </div>
          )}
        </div>
        {item.mode === 'fixed' && (
          <WeekdayRepeatControl
            weekdaysEnabled={item.weekdaysEnabled}
            onChange={(next) => updateItem(categoryIndex, itemIndex, { weekdaysEnabled: next })}
          />
        )}
        {item.mode === 'interval' && (
          <RepeatControl
            categoryIndex={categoryIndex}
            itemIndex={itemIndex}
            repeatCount={item.repeatCount}
            updateItem={updateItem}
            repeatDropdown={repeatDropdown}
            setRepeatDropdown={setRepeatDropdown}
          />
        )}
        {(item.mode === 'interval' || item.mode === 'fixed') && (
          <IoSwitch
            id={`enable-${categoryId}-${item.id}`}
            checked={isEnabled}
            onChange={(next) => {
              void onToggleEnabledNow(categoryIndex, itemIndex, next)
            }}
          />
        )}
        {(item.mode === 'interval' || (item.mode === 'fixed' && item.useNowAsStart === true)) && (
          <button
            type="button"
            disabled={!isEnabled}
            onClick={() => {
              if (!isEnabled) return
              if (item.mode === 'interval') {
                const payload = {
                  categoryName,
                  content: item.content,
                  mainPopupThemeId: item.mainPopupThemeId,
                  restPopupThemeId: item.restPopupThemeId,
                  intervalHours: item.intervalHours,
                  intervalMinutes: item.intervalMinutes,
                  intervalSeconds: item.intervalSeconds,
                  repeatCount: item.repeatCount,
                  splitCount: item.splitCount,
                  restDurationSeconds: item.restDurationSeconds,
                  restContent: item.restContent,
                }
                getApi()?.resetReminderProgress?.(countdownKey, payload)?.then(() => refreshCountdowns?.())
              } else if (item.mode === 'fixed') {
                getApi()?.setFixedTimeCountdownOverride?.(countdownKey, item.time)?.then(() => {
                  return refreshCountdowns?.() ?? Promise.resolve()
                })
              }
            }}
            className="text-slate-600 hover:text-slate-800 text-sm shrink-0 disabled:cursor-not-allowed disabled:opacity-40"
            title={!isEnabled
              ? '当前子项已关闭，请先打开开关'
              : item.mode === 'interval'
                ? (isEnded ? '按当前配置开始新一轮倒计时' : '重置进度，从当前时刻重新倒计时（使用当前界面上的时间与拆分配置）')
                : (isEnded ? '按当前闹钟时间范围开始新一轮' : '按当前闹钟时间范围重新计算下一轮')}
          >
            {primaryActionLabel}
          </button>
        )}
        <div
          className={`shrink-0 transition-opacity duration-150 ${
            rowActionChromeVisible ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          <SubReminderOverflowMenu
            menuId={`subitem-overflow-${item.id}`}
            onRemove={() => removeItem(categoryIndex, itemIndex)}
            onOpenChange={setRowOverflowMenuOpen}
          />
        </div>
        <div
          className={`min-w-[1.5rem] w-6 flex-shrink-0 flex items-center justify-center cursor-grab active:cursor-grabbing select-none self-center transition-opacity duration-150 ${
            rowActionChromeVisible ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
          }`}
          style={{ touchAction: 'none' }}
          {...sortableListeners}
          title="拖动调整子项顺序"
        >
          <span className="select-none touch-none text-slate-500" aria-hidden>
            ⋮⋮
          </span>
        </div>
      </div>
      <div className="flex w-full min-w-0 items-stretch gap-3 sm:gap-4">
      {item.mode === 'fixed' ? (
        <button
          type="button"
          onClick={() => toggleExpandedEditSub(categoryId, item.id)}
          className="group flex min-w-[6.5rem] shrink-0 flex-col items-center justify-center self-stretch rounded-lg border border-slate-200 bg-slate-900 px-3 py-2 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 sm:min-w-[7.5rem]"
          title="编辑开始时间、结束时间与拆分"
          aria-label={`编辑${fixedStartBlockSafe.caption} ${fixedStartBlockSafe.timeLine}`}
        >
          <span className="max-w-[5.5rem] text-center text-[10px] font-medium leading-tight text-white/70">
            {fixedStartBlockSafe.caption}
          </span>
          <span
            className={`mt-1 text-center font-bold tabular-nums leading-none tracking-tight text-white ${timeFontClass}`}
          >
            {fixedStartBlockSafe.timeLine}
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => toggleExpandedEditSub(categoryId, item.id)}
          className="group flex min-w-[8rem] shrink-0 flex-col items-center justify-center self-stretch rounded-lg border border-slate-200 bg-slate-900 px-4 py-2 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 sm:min-w-[8.5rem]"
          title="编辑时间与拆分"
          aria-label={`编辑时间，${largeTimeMain}`}
        >
          <span
            className={`text-center font-bold tabular-nums leading-none tracking-tight text-white ${timeFontClass}`}
          >
            {largeTimeMain}
          </span>
        </button>
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5 self-stretch">
      {(item.mode === 'fixed' || item.mode === 'interval') && (
        <div className="grid shrink-0 grid-cols-1 gap-2 sm:grid-cols-2">
          {((item.splitCount ?? 1) > 1) && (
            <label className="flex items-center gap-2 text-xs text-slate-500">
              <span className="shrink-0">休息壁纸</span>
              <PopupThemeSelectWithHoverPreview
                size="sm"
                options={restThemeOptions}
                value={item.restPopupThemeId ?? getDefaultPopupThemeIdForTarget(popupThemes, 'rest')}
                onChange={(id) => updateItem(categoryIndex, itemIndex, { restPopupThemeId: id })}
                previewImageUrlMap={previewImageUrlMap}
                previewViewportWidth={previewViewportWidth}
                popupPreviewAspect={popupPreviewAspect}
                aria-label="选择休息壁纸"
              />
            </label>
          )}
          <label className="flex items-center gap-2 text-xs text-slate-500">
            <span className="shrink-0">结束壁纸</span>
            <PopupThemeSelectWithHoverPreview
              size="sm"
              options={mainThemeOptions}
              value={item.mainPopupThemeId ?? getDefaultPopupThemeIdForTarget(popupThemes, 'main')}
              onChange={(id) => updateItem(categoryIndex, itemIndex, { mainPopupThemeId: id })}
              previewImageUrlMap={previewImageUrlMap}
              previewViewportWidth={previewViewportWidth}
              popupPreviewAspect={popupPreviewAspect}
              aria-label="选择结束壁纸"
            />
          </label>
        </div>
      )}
      {cd && (
        <div
          className={`flex min-w-0 w-full flex-col gap-1 ${
            item.mode === 'fixed' ? 'mt-4 min-h-0 flex-1 justify-end' : ''
          }`}
        >
          {/* 倒计时：进度条上一行左开始、右结束；闹钟已合并到左右大块时间顶行 */}
          {item.mode === 'interval' &&
            (() => {
              const startTs =
                cd.cycleTotalMs != null && cd.cycleTotalMs > 0 ? cd.nextAt - cd.cycleTotalMs : undefined
              const endTs = cd.nextAt
              return (
                <div className="flex w-full items-center justify-between gap-2">
                  <span className="shrink-0 text-sm text-slate-500 tabular-nums">
                    {formatTimeWithDay(startTs, '—', '开始')}
                  </span>
                  <span className="shrink-0 text-sm text-slate-500 tabular-nums">
                    {formatTimeWithDay(endTs, undefined, '结束')}
                  </span>
                </div>
              )
            })()}
          {/* 同一行上多个独立进度条（每段工作/休息各一条） */}
          <div className="w-full flex items-center gap-1.5 flex-wrap">
            {(() => {
              const splitN = item.splitCount ?? 1
              const restSec = item.restDurationSeconds ?? 0
              const restMs = restSec * 1000
              const DAY_MS = 24 * 3600 * 1000
              const now = Date.now()
              const totalSpanMs = item.mode === 'interval'
                ? ((item.intervalHours ?? 0) * 3600 + item.intervalMinutes * 60 + (item.intervalSeconds ?? 0)) * 1000
                : (cd.type === 'fixed'
                    ? (
                        cd.windowStartAt != null && cd.windowEndAt != null
                          ? Math.max(1, cd.windowEndAt - cd.windowStartAt)
                          : DAY_MS
                      )
                    : (cd.remainingMs > 0 ? cd.remainingMs : 0))
              const splitPlan = buildSplitSchedule(totalSpanMs, splitN, restMs)
              const cycleTotalMs = splitPlan.cycleTotalMs
              const useSplit = splitN > 1 && splitPlan.valid && splitPlan.segments.length > 1
              const elapsedInCycle = (() => {
                if (isInactive) return cycleTotalMs
                if (cd.type === 'fixed' && cd.fixedState === 'pending') return 0
                if (cd.type === 'fixed' && splitN > 1) {
                  if (cd.windowStartAt != null) {
                    return Math.max(0, Math.min(cycleTotalMs, now - cd.windowStartAt))
                  }
                  const elapsedInDay = Math.max(0, DAY_MS - cd.remainingMs)
                  return Math.max(0, Math.min(cycleTotalMs, elapsedInDay))
                }
                if (cd.cycleTotalMs != null && cd.cycleTotalMs > 0) {
                  return Math.max(0, Math.min(cycleTotalMs, cycleTotalMs - cd.remainingMs))
                }
                return Math.max(0, Math.min(cycleTotalMs, cycleTotalMs - cd.remainingMs))
              })()

              if (useSplit) {
                let offset = 0
                return splitPlan.segments.map((seg, i) => {
                  const start = offset
                  offset += seg.durationMs
                  const end = offset
                  let elapsedInSeg: number
                  if (elapsedInCycle >= end) elapsedInSeg = seg.durationMs
                  else if (elapsedInCycle <= start) elapsedInSeg = 0
                  else elapsedInSeg = elapsedInCycle - start
                  const ratio = seg.durationMs > 0 ? elapsedInSeg / seg.durationMs : 0
                  const segColor = seg.type === 'work' ? 'bg-green-500' : 'bg-blue-500'
                  const pendingFillClass = cd.type === 'fixed' && cd.fixedState === 'pending' ? 'bg-violet-500' : segColor
                  const pendingOrInactiveHover =
                    isInactive || (cd.type === 'fixed' && cd.fixedState === 'pending')
                  return (
                    <SplitSegmentProgressBar
                      key={i}
                      durationMs={seg.durationMs}
                      elapsedRatio={ratio}
                      fillClass={pendingFillClass}
                      showLabel={!(isFixedSingleEnded && seg.type === 'work')}
                      hoverFillClass={pendingOrInactiveHover ? segColor : undefined}
                    />
                  )
                })
              }
              const singlePendingHover =
                isInactive || (cd.type === 'fixed' && cd.fixedState === 'pending')
              return (
                <SingleCycleProgressBar
                  totalDurationMs={totalSpanMs}
                  remainingRatio={progressRatio}
                  fillClass={cd.type === 'fixed' && cd.fixedState === 'pending' ? 'bg-violet-500' : 'bg-green-500'}
                  hoverFillClass={singlePendingHover ? 'bg-green-500' : undefined}
                />
              )
            })()}
          </div>
          {/* 进度条下方：沙漏与倒计时随锚点移动，左右夹紧在进度条宽度内，避免与时间列重叠 */}
          {(() => {
            if (isInactive) {
              if (cd.ended) {
                return (
                  <ClampedProgressFloater
                    anchorPercent={0}
                    label="待启动"
                  />
                )
              }
              return (
                <ClampedProgressFloater
                  anchorPercent={100}
                  label="0:00"
                />
              )
            }
            if (cd.type === 'fixed' && cd.fixedState === 'pending') {
              return (
                <ClampedProgressFloater
                  anchorPercent={0}
                  label="未开始"
                />
              )
            }
            const splitN = item.splitCount ?? 1
            const DAY_MS = 24 * 3600 * 1000
            const now = Date.now()
            const hourglassLeftPercent = cd.type === 'fixed' && splitN > 1 && cd.remainingMs > 0
              ? (() => {
                  const restMs = (item.restDurationSeconds ?? 0) * 1000
                  if (cd.windowStartAt != null && cd.windowEndAt != null) {
                    const totalSpanMs = Math.max(1, cd.windowEndAt - cd.windowStartAt)
                    const cycleTotalMs = buildSplitSchedule(totalSpanMs, splitN, restMs).cycleTotalMs
                    const elapsedInCycle = Math.max(0, Math.min(cycleTotalMs, now - cd.windowStartAt))
                    return cycleTotalMs > 0 ? (elapsedInCycle / cycleTotalMs) * 100 : 0
                  }
                  const cycleTotalMs = buildSplitSchedule(DAY_MS, splitN, restMs).cycleTotalMs
                  const elapsedInCycle = Math.max(0, Math.min(cycleTotalMs, DAY_MS - cd.remainingMs))
                  return cycleTotalMs > 0 ? (elapsedInCycle / cycleTotalMs) * 100 : 0
                })()
              : (1 - progressRatio) * 100
            return (
              <ClampedProgressFloater
                anchorPercent={hourglassLeftPercent}
                label={formatRemaining(cd.remainingMs)}
              />
            )
          })()}
        </div>
      )}
      </div>
      {item.mode === 'fixed' ? (
        <button
          type="button"
          onClick={() => toggleExpandedEditSub(categoryId, item.id)}
          className="group flex min-w-[6.5rem] shrink-0 flex-col items-center justify-center self-stretch rounded-lg border border-slate-200 bg-slate-900 px-3 py-2 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 sm:min-w-[7.5rem]"
          title="编辑开始时间、结束时间与拆分"
          aria-label={`编辑${fixedEndBlockSafe.caption} ${fixedEndBlockSafe.timeLine}`}
        >
          <span className="max-w-[5.5rem] text-center text-[10px] font-medium leading-tight text-white/70">
            {fixedEndBlockSafe.caption}
          </span>
          <span
            className={`mt-1 text-center font-bold tabular-nums leading-none tracking-tight text-white ${timeFontClass}`}
          >
            {fixedEndBlockSafe.timeLine}
          </span>
        </button>
      ) : null}
      </div>
      </div>
      </>
      )}
    </div>
  )
}

/** 子项排序用 dnd-kit（可变高度下与鼠标一致）；Framer Reorder 在交换 DOM 时易与 drag 偏移错位 */
function SortableSubReminderItem({
  id,
  item,
  itemIndex,
  cat,
  realCi,
  ...rowProps
}: {
  id: string
  item: SubReminder
  itemIndex: number
  cat: ReminderCategory
  realCi: number
} & Omit<
  SubReminderRowProps,
  'item' | 'itemIndex' | 'categoryIndex' | 'categoryId' | 'categoryName' | 'sortableListeners' | 'isSortableDragging'
>) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    /** 避免 useDerivedTransform 在排序过程中注入 scale，导致矮/高卡片互拖时被拉高或压扁 */
    animateLayoutChanges: () => false,
    transition: {
      duration: 320,
      easing: 'cubic-bezier(0.22, 0.65, 0.28, 1)',
    },
  })
  const style: React.CSSProperties = {
    transform: sortableTranslateOnly(transform),
    transition,
    position: 'relative',
    zIndex: isDragging ? 99999 : undefined,
  }
  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <SubReminderRow
        item={item}
        categoryIndex={realCi}
        itemIndex={itemIndex}
        categoryId={cat.id}
        categoryName={cat.name}
        sortableListeners={listeners}
        isSortableDragging={isDragging}
        {...rowProps}
      />
    </div>
  )
}

const CATEGORY_CARD_OVERFLOW_MENU_CLOSE_MS = 280

/** 与主题工坊缩略图一致：hover 三点展开浮层，总开关 + 删除大类 */
function CategoryCardOverflowMenu({
  catId,
  showMasterSwitch,
  categoryAllEnabled,
  onToggleCategoryAll,
  onRemoveCategory,
  onOpenChange,
}: {
  catId: string
  showMasterSwitch: boolean
  categoryAllEnabled: boolean
  onToggleCategoryAll: (enabled: boolean) => void
  onRemoveCategory: () => void
  onOpenChange?: (open: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const closeTimerRef = useRef<number | null>(null)

  const emitOpen = useCallback(
    (next: boolean) => {
      onOpenChange?.(next)
      setOpen(next)
    },
    [onOpenChange],
  )

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  const scheduleClose = useCallback(() => {
    clearCloseTimer()
    closeTimerRef.current = window.setTimeout(() => emitOpen(false), CATEGORY_CARD_OVERFLOW_MENU_CLOSE_MS)
  }, [clearCloseTimer, emitOpen])

  const [coords, setCoords] = useState({ top: 0, left: 0 })

  const measureAndSetCoords = useCallback(() => {
    const el = btnRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const margin = 8
    const triggerCenterX = r.left + r.width / 2
    const menuEl = menuRef.current
    const menuW = menuEl?.getBoundingClientRect().width ?? (showMasterSwitch ? 56 : 44)
    const halfW = menuW / 2
    const anchorX = Math.max(margin + halfW, Math.min(triggerCenterX, window.innerWidth - margin - halfW))

    const estH = showMasterSwitch ? 88 : 44
    const menuH = menuEl?.getBoundingClientRect().height ?? estH
    let top = r.bottom + 1
    if (top + menuH > window.innerHeight - margin) {
      top = Math.max(margin, r.top - menuH - 1)
    }
    setCoords({ top, left: anchorX })
  }, [showMasterSwitch])

  useLayoutEffect(() => {
    if (!open) return
    measureAndSetCoords()
    const onReposition = () => measureAndSetCoords()
    window.addEventListener('scroll', onReposition, true)
    window.addEventListener('resize', onReposition)
    return () => {
      window.removeEventListener('scroll', onReposition, true)
      window.removeEventListener('resize', onReposition)
    }
  }, [open, measureAndSetCoords])

  useEffect(() => {
    if (!open) return
    const onDocDown = (e: globalThis.MouseEvent) => {
      const n = e.target as Node
      if (btnRef.current?.contains(n) || menuRef.current?.contains(n)) return
      emitOpen(false)
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [open, emitOpen])

  useEffect(() => {
    if (!open) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') emitOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, emitOpen])

  const run = (fn: () => void) => {
    clearCloseTimer()
    emitOpen(false)
    fn()
  }

  const onTriggerClick = (e: ReactMouseEvent) => {
    e.stopPropagation()
    setOpen((v) => {
      const next = !v
      onOpenChange?.(next)
      if (next) queueMicrotask(() => measureAndSetCoords())
      return next
    })
  }

  const menu =
    open &&
    createPortal(
      <div
        ref={menuRef}
        role="menu"
        className="fixed z-[300000] w-max min-w-0 flex flex-col items-center rounded-md border border-slate-200 bg-white py-1 pl-2 pr-2 shadow-lg"
        style={{ top: coords.top, left: coords.left, transform: 'translateX(-50%)' }}
        onMouseEnter={clearCloseTimer}
        onMouseLeave={scheduleClose}
      >
        {showMasterSwitch ? (
          <div
            role="presentation"
            className="flex w-full items-center justify-center py-1.5"
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <IoSwitch
              id={`cat-all-menu-${catId}`}
              checked={categoryAllEnabled}
              onChange={(next) => {
                clearCloseTimer()
                emitOpen(false)
                onToggleCategoryAll(next)
              }}
              ariaLabel="本类全部闹钟与倒计时开关"
            />
          </div>
        ) : null}
        <button
          type="button"
          role="menuitem"
          className="block w-full whitespace-nowrap px-2 py-1.5 text-center text-sm text-red-600 transition-colors hover:text-red-700 focus:outline-none focus-visible:bg-slate-50"
          onClick={() => run(onRemoveCategory)}
        >
          删除
        </button>
      </div>,
      document.body,
    )

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="flex h-8 w-8 shrink-0 items-center justify-center border-0 bg-transparent p-0 text-slate-500 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-400"
        aria-haspopup="menu"
        aria-expanded={open}
        title="更多操作"
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onTriggerClick}
      >
        <span className="flex items-center gap-0.5" aria-hidden>
          <span className="h-1 w-1 rounded-full bg-current" />
          <span className="h-1 w-1 rounded-full bg-current" />
          <span className="h-1 w-1 rounded-full bg-current" />
        </span>
      </button>
      {menu}
    </>
  )
}

/** 子项右侧三点菜单：仅点击弹出删除项（与大类交互一致） */
function SubReminderOverflowMenu({
  menuId,
  onRemove,
  onOpenChange,
}: {
  menuId: string
  onRemove: () => void
  onOpenChange?: (open: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [coords, setCoords] = useState({ top: 0, left: 0 })

  const emitOpen = useCallback(
    (next: boolean) => {
      onOpenChange?.(next)
      setOpen(next)
    },
    [onOpenChange],
  )

  const measureAndSetCoords = useCallback(() => {
    const el = btnRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const margin = 8
    const triggerCenterX = r.left + r.width / 2
    const menuEl = menuRef.current
    const menuW = menuEl?.getBoundingClientRect().width ?? 56
    const halfW = menuW / 2
    const anchorX = Math.max(margin + halfW, Math.min(triggerCenterX, window.innerWidth - margin - halfW))
    const menuH = menuEl?.getBoundingClientRect().height ?? 44
    let top = r.bottom + 1
    if (top + menuH > window.innerHeight - margin) {
      top = Math.max(margin, r.top - menuH - 1)
    }
    setCoords({ top, left: anchorX })
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    measureAndSetCoords()
    const onReposition = () => measureAndSetCoords()
    window.addEventListener('scroll', onReposition, true)
    window.addEventListener('resize', onReposition)
    return () => {
      window.removeEventListener('scroll', onReposition, true)
      window.removeEventListener('resize', onReposition)
    }
  }, [open, measureAndSetCoords])

  useEffect(() => {
    if (!open) return
    const onDocDown = (e: globalThis.MouseEvent) => {
      const n = e.target as Node
      if (btnRef.current?.contains(n) || menuRef.current?.contains(n)) return
      emitOpen(false)
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [open, emitOpen])

  useEffect(() => {
    if (!open) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') emitOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, emitOpen])

  const menu =
    open &&
    createPortal(
      <div
        ref={menuRef}
        role="menu"
        className="fixed z-[300000] w-max min-w-0 flex flex-col items-center rounded-md border border-slate-200 bg-white py-1 pl-2 pr-2 shadow-lg"
        style={{ top: coords.top, left: coords.left, transform: 'translateX(-50%)' }}
      >
        <button
          type="button"
          role="menuitem"
          className="block w-full whitespace-nowrap px-2 py-1.5 text-center text-sm text-red-600 transition-colors hover:text-red-700 focus:outline-none focus-visible:bg-slate-50"
          onClick={() => {
            emitOpen(false)
            onRemove()
          }}
        >
          删除
        </button>
      </div>,
      document.body,
    )

  return (
    <>
      <button
        ref={btnRef}
        id={menuId}
        type="button"
        className="flex h-8 w-8 shrink-0 items-center justify-center border-0 bg-transparent p-0 text-slate-500 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-400"
        aria-haspopup="menu"
        aria-expanded={open}
        title="更多操作"
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => {
            const next = !v
            onOpenChange?.(next)
            if (next) queueMicrotask(() => measureAndSetCoords())
            return next
          })
        }}
      >
        <span className="flex items-center gap-0.5" aria-hidden>
          <span className="h-1 w-1 rounded-full bg-current" />
          <span className="h-1 w-1 rounded-full bg-current" />
          <span className="h-1 w-1 rounded-full bg-current" />
        </span>
      </button>
      {menu}
    </>
  )
}

type CategoryCardProps = {
  cat: ReminderCategory
  realCi: number
  updateCategory: (ci: number, patch: Partial<ReminderCategory>) => void
  removeCategory: (ci: number) => void
  inlineAddDraft: { categoryId: string; mode: 'fixed' | 'interval'; draftKey: string } | null
  onOpenInlineAdd: (categoryIndex: number) => void
  onCancelInlineAdd: (categoryId: string) => void
  onConfirmInlineAdd: (categoryId: string, payload: AddSubReminderPayload) => void | Promise<void>
  listContainerRefsMap: React.MutableRefObject<Record<string, React.RefObject<HTMLDivElement | null>>>
  setCategoryItems: (ci: number, items: SubReminder[]) => void
  updateItem: (ci: number, ii: number, patch: Partial<SubReminder>) => void
  removeItem: (ci: number, ii: number) => void
  restContentPresets: string[]
  subTitlePresets: PresetPools['subTitle']
  popupThemes: PopupTheme[]
  onOpenThemeStudioList?: () => void
  onOpenThemeStudioEdit?: (args: OpenThemeStudioEditFromSubitemArgs) => void
  getCategoryTitlePresets: (kind: CategoryKind) => string[]
  onCategoryTitlePresetsChange: (kind: CategoryKind, presets: string[]) => void
  onRestContentPresetsChange: (presets: string[]) => void
  onSubTitlePresetsChange: (mode: 'fixed' | 'interval' | 'stopwatch', presets: string[]) => void
  repeatDropdown: { categoryIndex: number; itemIndex: number } | null
  setRepeatDropdown: Dispatch<SetStateAction<{ categoryIndex: number; itemIndex: number } | null>>
  countdowns: CountdownItem[]
  refreshCountdowns?: () => void
  expandedEditSub: { categoryId: string; itemId: string } | null
  toggleExpandedEditSub: (categoryId: string, itemId: string) => void
  onConfirmEmbeddedEdit: (categoryId: string, itemId: string, payload: AddSubReminderPayload) => void | Promise<void>
  addStopwatchItem: (categoryIndex: number) => void
  onToggleEnabledNow: (categoryIndex: number, itemIndex: number, enabled: boolean) => void | Promise<void>
  onToggleCategoryAllEnabled: (categoryIndex: number, enabled: boolean) => void | Promise<void>
  subReminderThemeEditor: SubReminderModalThemeEditorContext | null
  popupThemeRemotePatch: {
    categoryId: string
    anchor: string
    mainPopupThemeId?: string
    restPopupThemeId?: string
  } | null
  onConsumePopupThemeRemotePatch: () => void
  previewImageUrlMap: Record<string, string>
  previewViewportWidth: number
  popupPreviewAspect: PopupPreviewAspect
}

function CategoryCard(props: CategoryCardProps) {
  const {
    cat,
    realCi,
    updateCategory,
    removeCategory,
    inlineAddDraft,
    onOpenInlineAdd,
    onCancelInlineAdd,
    onConfirmInlineAdd,
    listContainerRefsMap,
    setCategoryItems,
    updateItem,
    removeItem,
    restContentPresets,
    subTitlePresets,
    popupThemes,
    onOpenThemeStudioList,
    onOpenThemeStudioEdit,
    getCategoryTitlePresets,
    onCategoryTitlePresetsChange,
    onRestContentPresetsChange,
    onSubTitlePresetsChange,
    repeatDropdown,
    setRepeatDropdown,
    countdowns,
    refreshCountdowns,
    expandedEditSub,
    toggleExpandedEditSub,
    onConfirmEmbeddedEdit,
    addStopwatchItem,
    onToggleEnabledNow,
    onToggleCategoryAllEnabled,
    subReminderThemeEditor,
    popupThemeRemotePatch,
    onConsumePopupThemeRemotePatch,
    previewImageUrlMap,
    previewViewportWidth,
    popupPreviewAspect,
  } = props
  const {
    attributes: catSortAttrs,
    listeners: catSortListeners,
    setNodeRef: catSortRef,
    transform: catSortTransform,
    transition: catSortTransition,
    isDragging: isCatDragging,
  } = useSortable({
    id: cat.id,
    animateLayoutChanges: () => false,
    transition: { duration: 200, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' },
  })
  const subItemSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  )
  const [isChildDragging, setIsChildDragging] = useState(false)
  const [sublistCollapsed, setSublistCollapsed] = useState(false)
  const [categoryHeaderHot, setCategoryHeaderHot] = useState(false)
  const [categoryOverflowMenuOpen, setCategoryOverflowMenuOpen] = useState(false)
  const categoryOverflowMenuOpenRef = useRef(false)
  const syncCategoryOverflowMenuOpen = useCallback((v: boolean) => {
    categoryOverflowMenuOpenRef.current = v
    setCategoryOverflowMenuOpen(v)
  }, [])
  const [editingCategoryTitle, setEditingCategoryTitle] = useState(false)
  const categoryTitleEditRef = useRef<HTMLDivElement>(null)
  const categoryTitle = (cat.name ?? '').trim()
  const defaultCategoryTitle = getDefaultCategoryName(cat.categoryKind)
  const toggleableSubItems = cat.items.filter((it) => it.mode === 'fixed' || it.mode === 'interval')
  const categoryAllEnabled =
    toggleableSubItems.length > 0 && toggleableSubItems.every((it) => it.enabled !== false)
  const categoryOverflowChromeVisible = categoryHeaderHot || categoryOverflowMenuOpen
  const finalizeCategoryTitleEdit = useCallback(() => {
    const nextName = categoryTitle || defaultCategoryTitle
    if (nextName !== cat.name) updateCategory(realCi, { name: nextName })
    setEditingCategoryTitle(false)
  }, [categoryTitle, defaultCategoryTitle, cat.name, updateCategory, realCi])

  useEffect(() => {
    if (!editingCategoryTitle) return
    const onDown = (e: MouseEvent) => {
      if (categoryTitleEditRef.current && !categoryTitleEditRef.current.contains(e.target as Node)) {
        finalizeCategoryTitleEdit()
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [editingCategoryTitle, finalizeCategoryTitleEdit])

  let listRef = listContainerRefsMap.current[cat.id]
  if (!listRef) {
    listRef = { current: null }
    listContainerRefsMap.current[cat.id] = listRef
  }
  const catStyle: React.CSSProperties = {
    transform: sortableTranslateOnly(catSortTransform),
    transition: catSortTransition,
    position: 'relative',
    zIndex: isCatDragging || isChildDragging ? 10000 : undefined,
    boxShadow: isCatDragging ? '0 4px 16px -2px rgba(0,0,0,0.08)' : undefined,
  }
  return (
    <div
      ref={catSortRef}
      style={catStyle}
      className={`bg-white rounded-lg border border-slate-200 overflow-visible transition-shadow duration-200${isCatDragging ? ' scale-[1.02]' : ''}`}
      {...catSortAttrs}
    >
      <div
        className="flex flex-nowrap items-center gap-2 border-b border-slate-100 p-4"
        onMouseEnter={() => setCategoryHeaderHot(true)}
        onMouseLeave={() => {
          requestAnimationFrame(() => {
            if (!categoryOverflowMenuOpenRef.current) setCategoryHeaderHot(false)
          })
        }}
      >
        <div className="relative flex min-w-0 flex-1">
          {editingCategoryTitle ? (
            <div
              ref={categoryTitleEditRef}
              className="w-full"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.target === categoryTitleEditRef.current?.querySelector('input')) {
                  finalizeCategoryTitleEdit()
                }
              }}
            >
              <PresetTextField
                resetKey={`cat-title-${cat.id}`}
                value={categoryTitle}
                onChange={(v) => updateCategory(realCi, { name: v })}
                presets={getCategoryTitlePresets(cat.categoryKind)}
                onPresetsChange={(presets) => onCategoryTitlePresetsChange(cat.categoryKind, presets)}
                mainPlaceholder={defaultCategoryTitle}
                inputClassName="text-left font-semibold"
                autoFocusInput
              />
            </div>
          ) : (
            <div
              className="flex h-9 w-full cursor-text items-center justify-start rounded pl-2 pr-9 text-sm font-semibold hover:bg-slate-50"
              onClick={() => setEditingCategoryTitle(true)}
              title="点击编辑类型标题"
            >
              {categoryTitle ? (
                <span className="truncate text-slate-800">{categoryTitle}</span>
              ) : (
                <span className="truncate text-slate-300">{defaultCategoryTitle}</span>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <div
            className={`shrink-0 transition-opacity duration-150 ${
              categoryOverflowChromeVisible ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
            }`}
          >
            <CategoryCardOverflowMenu
              catId={cat.id}
              showMasterSwitch={toggleableSubItems.length > 0}
              categoryAllEnabled={categoryAllEnabled}
              onToggleCategoryAll={(next) => void onToggleCategoryAllEnabled(realCi, next)}
              onRemoveCategory={() => removeCategory(realCi)}
              onOpenChange={syncCategoryOverflowMenuOpen}
            />
          </div>
          <div
            className={`shrink-0 transition-opacity duration-150 ${
              categoryOverflowChromeVisible ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
            }`}
          >
            <button
              type="button"
              onClick={() => {
                setSublistCollapsed((prev) => {
                  if (!prev) setRepeatDropdown((rd) => (rd?.categoryIndex === realCi ? null : rd))
                  return !prev
                })
              }}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
              aria-expanded={!sublistCollapsed}
              aria-label={sublistCollapsed ? '展开子项' : '收起子项'}
              title={sublistCollapsed ? '展开子项' : '收起子项'}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`transition-transform duration-200 ${sublistCollapsed ? '-rotate-90' : ''}`}
                aria-hidden
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
          </div>
        </div>
        <div
          className={`min-w-[2rem] w-8 flex-shrink-0 flex items-center justify-center min-h-[28px] cursor-grab active:cursor-grabbing select-none transition-opacity duration-150 ${
            categoryOverflowChromeVisible ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
          }`}
          style={{ touchAction: 'none' }}
          {...catSortListeners}
          title="拖动调整大类顺序"
        >
          <span className="select-none touch-none text-slate-500" aria-hidden>
            ⋮⋮
          </span>
        </div>
      </div>
      {!sublistCollapsed ? (
      <div className="p-4 space-y-3">
        <div ref={listRef as React.LegacyRef<HTMLDivElement>} className="min-h-0 overflow-visible">
          <DndContext
            sensors={subItemSensors}
            collisionDetection={closestCenter}
            onDragStart={() => setIsChildDragging(true)}
            onDragEnd={(e: DragEndEvent) => {
              setIsChildDragging(false)
              const { active, over } = e
              if (!over || active.id === over.id) return
              const oldIndex = cat.items.findIndex((i) => i.id === active.id)
              const newIndex = cat.items.findIndex((i) => i.id === over.id)
              if (oldIndex !== -1 && newIndex !== -1) {
                setCategoryItems(realCi, arrayMove(cat.items, oldIndex, newIndex))
              }
            }}
          >
            <SortableContext items={cat.items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              <div className="relative space-y-3">
                {cat.items.map((item, itemIndex) => (
                  <SortableSubReminderItem
                    key={`${cat.id}-${item.id}`}
                    id={item.id}
                    item={item}
                    itemIndex={itemIndex}
                    cat={cat}
                    realCi={realCi}
                    countdowns={countdowns}
                    updateItem={updateItem}
                    removeItem={removeItem}
                    restContentPresets={restContentPresets}
                    subTitlePresets={subTitlePresets}
                    popupThemes={popupThemes}
                    onOpenThemeStudioList={onOpenThemeStudioList}
                    onOpenThemeStudioEdit={onOpenThemeStudioEdit}
                    repeatDropdown={repeatDropdown}
                    setRepeatDropdown={setRepeatDropdown}
                    refreshCountdowns={refreshCountdowns}
                    expandedEditSub={expandedEditSub}
                    toggleExpandedEditSub={toggleExpandedEditSub}
                    onConfirmEmbeddedEdit={onConfirmEmbeddedEdit}
                    onRestContentPresetsChange={onRestContentPresetsChange}
                    onSubTitlePresetsChange={onSubTitlePresetsChange}
                    onToggleEnabledNow={onToggleEnabledNow}
                    subReminderThemeEditor={subReminderThemeEditor}
                    popupThemeRemotePatch={popupThemeRemotePatch}
                    onConsumePopupThemeRemotePatch={onConsumePopupThemeRemotePatch}
                    previewImageUrlMap={previewImageUrlMap}
                    previewViewportWidth={previewViewportWidth}
                    popupPreviewAspect={popupPreviewAspect}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
        {inlineAddDraft?.categoryId === cat.id && cat.categoryKind !== 'stopwatch' && (
          <div className="mt-3 min-w-0">
            <AddSubReminderModal
              key={inlineAddDraft.draftKey}
              open
              layout="embedded"
              formInstanceKey={inlineAddDraft.draftKey}
              mode={inlineAddDraft.mode}
              titlePresets={inlineAddDraft.mode === 'fixed' ? subTitlePresets.fixed : subTitlePresets.interval}
              restPresets={restContentPresets}
              popupThemes={popupThemes}
              onClose={() => onCancelInlineAdd(cat.id)}
              onConfirm={(payload) => {
                void onConfirmInlineAdd(cat.id, payload)
              }}
              onTitlePresetsChange={(presets) => onSubTitlePresetsChange(inlineAddDraft.mode, presets)}
              onRestPresetsChange={onRestContentPresetsChange}
              onOpenThemeStudioList={onOpenThemeStudioList}
              onOpenThemeStudioEdit={onOpenThemeStudioEdit}
              embeddedThemeStudioContext={{ categoryId: cat.id, anchor: inlineAddDraft.draftKey }}
              themeEditorContext={subReminderThemeEditor ?? undefined}
              popupThemeRemotePatch={popupThemeRemotePatch}
              onConsumePopupThemeRemotePatch={onConsumePopupThemeRemotePatch}
            />
          </div>
        )}
        {/* 底部添加区：默认仅浅色文字，hover 时再出现矩形背景 */}
        <div className="flex w-full flex-col gap-1.5">
          <div className="flex w-full flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() =>
                cat.categoryKind === 'stopwatch' ? addStopwatchItem(realCi) : onOpenInlineAdd(realCi)
              }
              className="w-full rounded-lg border border-transparent bg-transparent px-3 py-2 text-sm text-slate-400 transition-colors hover:border-slate-200 hover:bg-slate-50 hover:text-slate-700"
            >
              {cat.categoryKind === 'alarm'
                ? '+ 添加闹钟'
                : cat.categoryKind === 'countdown'
                  ? '+ 添加倒计时'
                  : '+ 添加秒表'}
            </button>
          </div>
        </div>
      </div>
      ) : null}
    </div>
  )
}

/** 未写入 map 的主题选中态：勿每帧 `?? []` 新建数组，否则右侧面板 layout effect 依赖抖动 */
const EMPTY_THEME_TEXT_SELECTION: TextElementKey[] = []

export function Settings() {
  const [settings, setSettingsState] = useState<AppSettings>(defaultSettings)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'ok' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [repeatDropdown, setRepeatDropdown] = useState<{ categoryIndex: number; itemIndex: number } | null>(null)
  const [countdowns, setCountdowns] = useState<CountdownItem[]>([])
  const [appTheme, setAppThemeState] = useState<AppThemeSetting>('system')
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [resettingAll, setResettingAll] = useState(false)
  const [inlineAddDraft, setInlineAddDraft] = useState<{
    categoryId: string
    mode: 'fixed' | 'interval'
    draftKey: string
  } | null>(null)
  const [expandedEditSub, setExpandedEditSub] = useState<{ categoryId: string; itemId: string } | null>(null)
  const [categoryListFilter, setCategoryListFilter] = useState<CategoryListFilter>('all')
  const [popupPreviewAspectPreset, setPopupPreviewAspectPreset] = useState<PopupPreviewAspectPreset>('system')
  const [previewImageUrlMap, setPreviewImageUrlMap] = useState<Record<string, string>>({})
  const [primaryDisplaySize, setPrimaryDisplaySize] = useState<{ width: number; height: number } | null>(null)
  const popupPreviewAspect: PopupPreviewAspect = useMemo(() => {
    if (popupPreviewAspectPreset !== 'system') return popupPreviewAspectPreset
    if (primaryDisplaySize?.width && primaryDisplaySize?.height) {
      return nearestPopupPreviewAspectFromDisplay(primaryDisplaySize.width, primaryDisplaySize.height)
    }
    return '16:9'
  }, [popupPreviewAspectPreset, primaryDisplaySize?.width, primaryDisplaySize?.height])
  type ThemeStudioNav = null | { view: 'list' }
  const [themeStudioNav, setThemeStudioNav] = useState<ThemeStudioNav>(null)
  /** 与导航分开提交：避免首帧同步挂载整页 ThemeStudioListView 阻塞绘制，导致顶部分页按钮看似「等缩略图后才变」 */
  const [themeStudioListMounted, setThemeStudioListMounted] = useState(false)
  const [floatingThemeEdit, setFloatingThemeEdit] = useState<
    null | { themeId: string; source: ThemeStudioFloatingSource; isNewDraft?: boolean }
  >(null)
  const [popupThemeRemotePatch, setPopupThemeRemotePatch] = useState<null | {
    categoryId: string
    anchor: string
    mainPopupThemeId?: string
    restPopupThemeId?: string
  }>(null)
  const [themeSelectedElementsMap, setThemeSelectedElementsMap] = useState<Record<string, TextElementKey[]>>({})
  const getThemeSelectedElements = useCallback(
    (themeId: string): TextElementKey[] =>
      themeSelectedElementsMap[themeId] ?? EMPTY_THEME_TEXT_SELECTION,
    [themeSelectedElementsMap],
  )
  const setThemeSelectedElements = useCallback((themeId: string, els: TextElementKey[]) => {
    setThemeSelectedElementsMap((prev) => ({ ...prev, [themeId]: els }))
  }, [])
  const listContainerRefsMap = useRef<Record<string, React.RefObject<HTMLDivElement | null>>>({})
  const categoryReorderContainerRef = useRef<HTMLDivElement>(null)
  const categorySensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))
  /** 与界面一致，供弹窗确认与防抖落盘读取，避免闭包/磁盘快照错位 */
  const reminderCategoriesRef = useRef(settings.reminderCategories)
  const presetPoolsRef = useRef(settings.presetPools)
  const popupThemesRef = useRef(settings.popupThemes)
  reminderCategoriesRef.current = settings.reminderCategories
  presetPoolsRef.current = settings.presetPools
  popupThemesRef.current = settings.popupThemes
  const filteredReminderCategories = useMemo(() => {
    if (categoryListFilter === 'all') return settings.reminderCategories
    return settings.reminderCategories.filter((c) => c.categoryKind === categoryListFilter)
  }, [settings.reminderCategories, categoryListFilter])

  const applyCategoryListFilter = useCallback((f: CategoryListFilter) => {
    flushSync(() => {
      setThemeStudioNav(null)
      setThemeStudioListMounted(false)
    })
    setCategoryListFilter(f)
    const cats = reminderCategoriesRef.current
    setRepeatDropdown(null)
    setInlineAddDraft((d) => {
      if (!d) return null
      const c = cats.find((x) => x.id === d.categoryId)
      if (!c) return null
      if (f !== 'all' && c.categoryKind !== f) {
        if (c.items.length === 0) {
          setCategories(cats.filter((x) => x.id !== d.categoryId))
        }
        return null
      }
      return d
    })
    setExpandedEditSub((e) => {
      if (!e) return null
      const c = cats.find((x) => x.id === e.categoryId)
      if (!c) return null
      if (f !== 'all' && c.categoryKind !== f) return null
      return e
    })
  }, [])

  useEffect(() => {
    if (!themeStudioNav) {
      setThemeStudioListMounted(false)
      return
    }
    setThemeStudioListMounted(false)
    let cancelled = false
    const r1 = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!cancelled) setThemeStudioListMounted(true)
      })
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(r1)
    }
  }, [themeStudioNav])

  const openThemeStudioList = useCallback(() => {
    flushSync(() => {
      setThemeStudioNav({ view: 'list' })
      setThemeStudioListMounted(false)
    })
  }, [])

  const autoSaveGen = useRef(0)
  const skipNextAutoSave = useRef(true)
  /** 落盘成功后 setState 会换新引用，避免再次触发自动保存 effect 形成死循环 */
  const suppressAutoSaveAfterHydrateRef = useRef(false)

  const toggleExpandedEditSub = (categoryId: string, itemId: string) => {
    setExpandedEditSub((prev) => (prev?.categoryId === categoryId && prev?.itemId === itemId ? null : { categoryId, itemId }))
    setInlineAddDraft(null)
  }

  /** 取消内联新建：若该大类仍无任何子项则删除大类（如底部新建的空白类型） */
  const cancelInlineAddForCategory = (categoryId: string) => {
    const cats = reminderCategoriesRef.current
    const ci = cats.findIndex((c) => c.id === categoryId)
    if (ci >= 0 && cats[ci].items.length === 0) {
      removeCategory(ci, true)
    }
    setInlineAddDraft((d) => (d?.categoryId === categoryId ? null : d))
  }

  useEffect(() => {
    const api = getApi()
    if (!api) {
      console.warn('[WorkBreak] window.electronAPI 不存在。请用「启动开发环境.bat」打开应用窗口，不要用浏览器打开 localhost')
      setLoading(false)
      return
    }
    api.getSettings().then((s) => {
      setSettingsState(s)
      const theme = s.appTheme ?? 'system'
      setAppThemeState(theme)
      applyAppThemeClass(theme)
      setLoading(false)
    }).catch((e) => {
      console.error('[WorkBreak] getSettings 失败', e)
      setLoading(false)
    })
    api.getPrimaryDisplaySize?.().then(setPrimaryDisplaySize).catch(() => setPrimaryDisplaySize(null))
  }, [])

  /** 仅在用户改列表/子项后防抖写盘；成功后 hydrate 状态不触发下一轮（见 suppressAutoSaveAfterHydrateRef） */
  useEffect(() => {
    if (loading) return
    const api = getApi()
    if (!api?.setSettings) return
    if (suppressAutoSaveAfterHydrateRef.current) {
      suppressAutoSaveAfterHydrateRef.current = false
      return
    }
    if (skipNextAutoSave.current) {
      skipNextAutoSave.current = false
      return
    }
    autoSaveGen.current += 1
    const gen = autoSaveGen.current
    const t = window.setTimeout(async () => {
      try {
        setSaveError('')
        const categoriesSnapshot = reminderCategoriesRef.current
        const presetPoolsSnapshot = presetPoolsRef.current
        const popupThemesSnapshot = popupThemesRef.current
        const result = await api.setSettings({
          reminderCategories: categoriesSnapshot,
          presetPools: presetPoolsSnapshot,
          popupThemes: popupThemesSnapshot,
        })
        if (gen !== autoSaveGen.current) return
        if (result.success) {
          suppressAutoSaveAfterHydrateRef.current = true
          setSettingsState(result.data)
        } else {
          setSaveError(result.error)
          setSaveStatus('error')
        }
      } catch (e) {
        if (gen !== autoSaveGen.current) return
        setSaveError(e instanceof Error ? e.message : String(e))
        setSaveStatus('error')
      }
    }, 400)
    return () => window.clearTimeout(t)
  }, [settings.reminderCategories, settings.presetPools, settings.popupThemes, loading])

  useEffect(() => {
    if (loading) return
    const api = getApi()
    if (!api?.resolvePreviewImageUrl) return
    const paths = Array.from(
      new Set((settings.popupThemes ?? []).flatMap((t) => collectPopupThemeImagePathsForPreview(t))),
    )
    let disposed = false
    void Promise.all(
      paths.map(async (p) => {
        const r = await api.resolvePreviewImageUrl(p)
        return [p, r.success ? r.url : ''] as const
      })
    ).then((entries) => {
      if (disposed) return
      setPreviewImageUrlMap(Object.fromEntries(entries))
    })
    return () => { disposed = true }
  }, [loading, settings.popupThemes])

  useEffect(() => {
    const api = getApi()
    if (!api?.getReminderCountdowns) return
    const tick = () => api.getReminderCountdowns().then((cds) => {
      setCountdowns(cds)
      const cats = reminderCategoriesRef.current
      let needSync = false
      for (const cd of cds) {
        if (!cd.ended) continue
        for (const cat of cats) {
          for (const item of cat.items) {
            if (`${cat.id}_${item.id}` === cd.key && item.mode !== 'stopwatch' && item.enabled !== false) {
              needSync = true
              break
            }
          }
          if (needSync) break
        }
        if (needSync) break
      }
      if (needSync) {
        api.getSettings?.().then((data: AppSettings) => {
          suppressAutoSaveAfterHydrateRef.current = true
          setSettingsState(data)
        }).catch(() => {})
      }
    }).catch(() => setCountdowns([]))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [settings.reminderCategories])

  const setCategories = (next: ReminderCategory[]) => {
    setSettingsState((prev) => ({ ...prev, reminderCategories: next }))
    setSaveStatus('idle')
    setSaveError('')
  }

  const updateCategory = (categoryIndex: number, patch: Partial<ReminderCategory>) => {
    const next = settings.reminderCategories.slice()
    next[categoryIndex] = { ...next[categoryIndex], ...patch }
    setCategories(next)
  }

  /** 切换应用主题并持久化 */
  const handleAppThemeChange = useCallback(async (theme: AppThemeSetting) => {
    setAppThemeState(theme)
    applyAppThemeClass(theme)
    const api = getApi()
    if (api?.setSettings) {
      await api.setSettings({ appTheme: theme })
    }
  }, [])

  const updateItem = (categoryIndex: number, itemIndex: number, patch: Partial<SubReminder>) => {
    const next = settings.reminderCategories.slice()
    const cat = { ...next[categoryIndex], items: next[categoryIndex].items.slice() }
    cat.items[itemIndex] = { ...cat.items[itemIndex], ...patch } as SubReminder
    next[categoryIndex] = cat
    setCategories(next)
  }

  const toggleReminderEnabledNow = async (categoryIndex: number, itemIndex: number, enabled: boolean) => {
    const api = getApi()
    const cats = reminderCategoriesRef.current
    const cat = cats[categoryIndex]
    const item = cat?.items[itemIndex]
    if (!cat || !item || (item.mode !== 'fixed' && item.mode !== 'interval')) return
    const nextCategories = cats.map((c, ci) => {
      if (ci !== categoryIndex) return c
      return {
        ...c,
        items: c.items.map((it, ii) => {
          if (ii !== itemIndex || (it.mode !== 'fixed' && it.mode !== 'interval')) return it
          if (enabled && it.mode === 'fixed' && it.useNowAsStart === true) {
            const now = new Date()
            const hh = String(now.getHours()).padStart(2, '0')
            const mm = String(now.getMinutes()).padStart(2, '0')
            return { ...it, enabled, startTime: `${hh}:${mm}` } as SubReminder
          }
          return { ...it, enabled } as SubReminder
        }),
      }
    })
    if (!api?.setSettings) {
      setCategories(nextCategories)
      return
    }
    try {
      const result = await api.setSettings({ reminderCategories: nextCategories })
      if (!result.success) {
        setSaveError(result.error)
        setSaveStatus('error')
        return
      }
      suppressAutoSaveAfterHydrateRef.current = true
      setSettingsState(result.data)
      const nextCat = result.data.reminderCategories[categoryIndex]
      const nextItem = nextCat?.items[itemIndex]
      if (enabled && nextCat && nextItem && (nextItem.mode === 'fixed' || nextItem.mode === 'interval')) {
        const key = `${nextCat.id}_${nextItem.id}`
        if (nextItem.mode === 'interval') {
          const payload = {
            categoryName: nextCat.name,
            content: nextItem.content,
            mainPopupThemeId: nextItem.mainPopupThemeId,
            restPopupThemeId: nextItem.restPopupThemeId,
            intervalHours: nextItem.intervalHours,
            intervalMinutes: nextItem.intervalMinutes,
            intervalSeconds: nextItem.intervalSeconds,
            repeatCount: nextItem.repeatCount,
            splitCount: nextItem.splitCount,
            restDurationSeconds: nextItem.restDurationSeconds,
            restContent: nextItem.restContent,
          }
          await api.resetReminderProgress?.(key, payload)
        } else {
          await api.setFixedTimeCountdownOverride?.(key, nextItem.time)
        }
      }
      const cds = await api.getReminderCountdowns?.()
      if (cds) setCountdowns(cds)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
      setSaveStatus('error')
    }
  }

  /** 大类总开关：同时开启/关闭本类下全部闹钟、倒计时子项（秒表类无开关，不显示） */
  const toggleCategoryAllEnabledNow = async (categoryIndex: number, enabled: boolean) => {
    const api = getApi()
    const cats = reminderCategoriesRef.current
    const cat = cats[categoryIndex]
    if (!cat) return
    const hasTogglable = cat.items.some((it) => it.mode === 'fixed' || it.mode === 'interval')
    if (!hasTogglable) return

    const now = new Date()
    const snapStart = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

    const nextCategories = cats.map((c, ci) => {
      if (ci !== categoryIndex) return c
      return {
        ...c,
        items: c.items.map((it) => {
          if (it.mode !== 'fixed' && it.mode !== 'interval') return it
          if (!enabled) return { ...it, enabled: false } as SubReminder
          if (it.mode === 'fixed' && it.useNowAsStart === true) {
            return { ...it, enabled: true, startTime: snapStart } as SubReminder
          }
          return { ...it, enabled: true } as SubReminder
        }),
      }
    })

    if (!api?.setSettings) {
      setCategories(nextCategories)
      return
    }
    try {
      const result = await api.setSettings({ reminderCategories: nextCategories })
      if (!result.success) {
        setSaveError(result.error)
        setSaveStatus('error')
        return
      }
      suppressAutoSaveAfterHydrateRef.current = true
      setSettingsState(result.data)
      const updatedCat = result.data.reminderCategories[categoryIndex]
      if (enabled && updatedCat) {
        for (let ii = 0; ii < updatedCat.items.length; ii++) {
          const prevItem = cat.items[ii]
          const nextItem = updatedCat.items[ii]
          if (!isTimedSubReminder(prevItem) || !isTimedSubReminder(nextItem)) continue
          if (prevItem.enabled !== false || nextItem.enabled === false) continue
          const key = `${updatedCat.id}_${nextItem.id}`
          if (nextItem.mode === 'interval') {
            const payload = {
              categoryName: updatedCat.name,
              content: nextItem.content,
              mainPopupThemeId: nextItem.mainPopupThemeId,
              restPopupThemeId: nextItem.restPopupThemeId,
              intervalHours: nextItem.intervalHours,
              intervalMinutes: nextItem.intervalMinutes,
              intervalSeconds: nextItem.intervalSeconds,
              repeatCount: nextItem.repeatCount,
              splitCount: nextItem.splitCount,
              restDurationSeconds: nextItem.restDurationSeconds,
              restContent: nextItem.restContent,
            }
            await api.resetReminderProgress?.(key, payload)
          } else {
            await api.setFixedTimeCountdownOverride?.(key, nextItem.time)
          }
        }
      }
      const cds = await api.getReminderCountdowns?.()
      if (cds) setCountdowns(cds)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
      setSaveStatus('error')
    }
  }

  const addCategoryOfKind = (kind: CategoryKind) => {
    let cats = settings.reminderCategories
    if (inlineAddDraft) {
      const abandoned = cats.find((c) => c.id === inlineAddDraft.categoryId)
      if (abandoned && abandoned.items.length === 0) {
        cats = cats.filter((c) => c.id !== inlineAddDraft.categoryId)
      }
    }
    const newId = genId()
    const newCat: ReminderCategory = {
      id: newId,
      name: getDefaultCategoryName(kind),
      categoryKind: kind,
      presets: [],
      titlePresets: [],
      items: kind === 'stopwatch' ? [{ id: genId(), mode: 'stopwatch', content: getDefaultSubTitle('stopwatch') }] : [],
    }
    setCategories([newCat, ...cats])
    setRepeatDropdown((rd) => (rd ? { ...rd, categoryIndex: rd.categoryIndex + 1 } : null))
    setExpandedEditSub(null)
    setInlineAddDraft(
      kind === 'stopwatch'
        ? null
        : {
            categoryId: newId,
            mode: kind === 'alarm' ? 'fixed' : 'interval',
            draftKey: genId(),
          }
    )
  }

  const addStopwatchItem = (categoryIndex: number) => {
    const cat = settings.reminderCategories[categoryIndex]
    if (!cat || cat.categoryKind !== 'stopwatch') return
    const newItem: SubReminder = { id: genId(), mode: 'stopwatch', content: getDefaultSubTitle('stopwatch') }
    const next = settings.reminderCategories.slice()
    next[categoryIndex] = { ...cat, items: [...cat.items, newItem] }
    setCategories(next)
  }

  const removeCategory = (categoryIndex: number, skipConfirm = false) => {
    const cat = settings.reminderCategories[categoryIndex]
    if (!cat) return
    if (!skipConfirm) {
      const name = (cat.name ?? '').trim() || getDefaultCategoryName(cat.categoryKind)
      const n = cat.items.length
      if (
        !window.confirm(
          `确定删除大类「${name}」及其下 ${n} 个子项吗？\n删除后无法恢复。`,
        )
      ) {
        return
      }
    }
    const removedCat = cat
    setCategories(settings.reminderCategories.filter((_, i) => i !== categoryIndex))
    if (repeatDropdown?.categoryIndex === categoryIndex) setRepeatDropdown(null)
    if (repeatDropdown && repeatDropdown.categoryIndex > categoryIndex) setRepeatDropdown({ ...repeatDropdown, categoryIndex: repeatDropdown.categoryIndex - 1 })
    if (removedCat && expandedEditSub?.categoryId === removedCat.id) setExpandedEditSub(null)
    if (removedCat && inlineAddDraft?.categoryId === removedCat.id) setInlineAddDraft(null)
  }

  const handleAddSubReminderConfirm = async (categoryId: string, payload: AddSubReminderPayload) => {
    const api = getApi()
    if (!api?.setSettings) return
    const defaultMainThemeId = getFirstThemeIdByTarget('main')
    const defaultRestThemeId = getFirstThemeIdByTarget('rest')
    const resolvedMainThemeId = payload.mainPopupThemeId || defaultMainThemeId
    const resolvedRestThemeId = payload.restPopupThemeId || defaultRestThemeId
    const newItem: SubReminder =
      payload.mode === 'fixed'
        ? {
            id: genId(),
            mode: 'fixed',
            title: payload.title?.trim() || getDefaultSubTitle('fixed'),
            enabled: true,
            startTime: payload.startTime ?? payload.time ?? '12:00',
            time: payload.time ?? '12:00',
            content: payload.content || BUILTIN_MAIN_POPUP_FALLBACK_BODY,
            ...(Array.isArray(payload.weekdaysEnabled) && payload.weekdaysEnabled.length === 7
              ? { weekdaysEnabled: payload.weekdaysEnabled.map(Boolean) }
              : {}),
            ...(resolvedMainThemeId ? { mainPopupThemeId: resolvedMainThemeId } : {}),
            ...(resolvedRestThemeId ? { restPopupThemeId: resolvedRestThemeId } : {}),
            splitCount: payload.splitCount,
            restDurationSeconds: payload.restDurationSeconds,
            restContent: payload.restContent,
            useNowAsStart: payload.useNowAsStart === true,
          }
        : {
            id: genId(),
            mode: 'interval',
            title: payload.title?.trim() || getDefaultSubTitle('interval'),
            enabled: true,
            intervalHours: payload.intervalHours ?? 0,
            intervalMinutes: payload.intervalMinutes ?? 30,
            intervalSeconds: payload.intervalSeconds ?? 0,
            content: payload.content || BUILTIN_MAIN_POPUP_FALLBACK_BODY,
            repeatCount: payload.repeatCount ?? null,
            ...(resolvedMainThemeId ? { mainPopupThemeId: resolvedMainThemeId } : {}),
            ...(resolvedRestThemeId ? { restPopupThemeId: resolvedRestThemeId } : {}),
            splitCount: payload.splitCount,
            restDurationSeconds: payload.restDurationSeconds,
            restContent: payload.restContent,
          }
    try {
      const cats = reminderCategoriesRef.current
      const ci = cats.findIndex((c) => c.id === categoryId)
      if (ci < 0) return
      const cat = cats[ci]
      if (
        (payload.mode === 'fixed' && cat.categoryKind !== 'alarm') ||
        (payload.mode === 'interval' && cat.categoryKind !== 'countdown')
      ) {
        setInlineAddDraft(null)
        return
      }
      const nextCategories = cats.map((c, i) => (i !== ci ? c : { ...c, items: [...c.items, newItem] }))
      const result = await api.setSettings({ reminderCategories: nextCategories })
      if (!result.success) {
        setSaveError(result.error)
        setSaveStatus('error')
        return
      }
      suppressAutoSaveAfterHydrateRef.current = true
      setSettingsState(result.data)
      if (payload.mode === 'fixed') {
        const key = `${cat.id}_${newItem.id}`
        await api.setFixedTimeCountdownOverride?.(key, payload.time ?? '12:00')
      }
      const cds = await api.getReminderCountdowns?.()
      if (cds) setCountdowns(cds)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
      setSaveStatus('error')
    } finally {
      setInlineAddDraft(null)
    }
  }

  const handleEditSubReminderConfirm = async (categoryId: string, itemId: string, payload: AddSubReminderPayload) => {
    const api = getApi()
    if (!api?.setSettings) return
    const splitN = Math.max(1, Math.min(10, payload.splitCount ?? 1))
    const content = payload.content.trim() || BUILTIN_MAIN_POPUP_FALLBACK_BODY
    const titleForFixed = payload.title?.trim() || getDefaultSubTitle('fixed')
    const titleForInterval = payload.title?.trim() || getDefaultSubTitle('interval')
    try {
      const cats = reminderCategoriesRef.current
      const eci = cats.findIndex((c) => c.id === categoryId)
      if (eci < 0) return
      const diskCat = cats[eci]
      const eii = diskCat.items.findIndex((it) => it.id === itemId)
      if (eii < 0) return
      const existing = diskCat.items[eii]
      if (existing.mode !== payload.mode) return
      if (
        (payload.mode === 'fixed' && diskCat.categoryKind !== 'alarm') ||
        (payload.mode === 'interval' && diskCat.categoryKind !== 'countdown')
      ) {
        return
      }

      let updated: SubReminder
      if (payload.mode === 'fixed') {
        const nextWd =
          Array.isArray(payload.weekdaysEnabled) && payload.weekdaysEnabled.length === 7
            ? payload.weekdaysEnabled.map(Boolean)
            : existing.mode === 'fixed'
              ? existing.weekdaysEnabled
              : undefined
        const base = {
          id: existing.id,
          mode: 'fixed' as const,
          title: titleForFixed,
          ...(existing.mode === 'fixed' ? { enabled: existing.enabled !== false } : { enabled: true }),
          startTime: payload.startTime ?? payload.time!,
          time: payload.time!,
          content,
          ...((payload.mainPopupThemeId || (existing.mode === 'fixed' ? existing.mainPopupThemeId : undefined))
            ? { mainPopupThemeId: payload.mainPopupThemeId || (existing.mode === 'fixed' ? existing.mainPopupThemeId : undefined) }
            : {}),
          ...((payload.restPopupThemeId || (existing.mode === 'fixed' ? existing.restPopupThemeId : undefined))
            ? { restPopupThemeId: payload.restPopupThemeId || (existing.mode === 'fixed' ? existing.restPopupThemeId : undefined) }
            : {}),
          ...(nextWd !== undefined ? { weekdaysEnabled: nextWd } : {}),
          useNowAsStart: payload.useNowAsStart === true,
        }
        updated =
          splitN <= 1
            ? { ...base, splitCount: 1 }
            : {
                ...base,
                splitCount: splitN,
                restDurationSeconds: payload.restDurationSeconds ?? 0,
                restContent: payload.restContent,
              }
      } else {
        const base = {
          id: existing.id,
          mode: 'interval' as const,
          title: titleForInterval,
          ...(existing.mode === 'interval' ? { enabled: existing.enabled !== false } : { enabled: true }),
          intervalHours: payload.intervalHours ?? 0,
          intervalMinutes: payload.intervalMinutes ?? 30,
          intervalSeconds: payload.intervalSeconds ?? 0,
          content,
          ...((payload.mainPopupThemeId || (existing.mode === 'interval' ? existing.mainPopupThemeId : undefined))
            ? { mainPopupThemeId: payload.mainPopupThemeId || (existing.mode === 'interval' ? existing.mainPopupThemeId : undefined) }
            : {}),
          ...((payload.restPopupThemeId || (existing.mode === 'interval' ? existing.restPopupThemeId : undefined))
            ? { restPopupThemeId: payload.restPopupThemeId || (existing.mode === 'interval' ? existing.restPopupThemeId : undefined) }
            : {}),
          repeatCount: payload.repeatCount ?? (existing.mode === 'interval' ? existing.repeatCount : null),
        }
        updated =
          splitN <= 1
            ? { ...base, splitCount: 1 }
            : {
                ...base,
                splitCount: splitN,
                restDurationSeconds: payload.restDurationSeconds ?? 0,
                restContent: payload.restContent,
              }
      }

      const nextCategories = cats.map((c, ci) =>
        ci !== eci ? c : { ...c, items: c.items.map((it, ii) => (ii === eii ? updated : it)) }
      )
      const result = await api.setSettings({ reminderCategories: nextCategories })
      if (!result.success) {
        setSaveError(result.error)
        setSaveStatus('error')
        return
      }
      suppressAutoSaveAfterHydrateRef.current = true
      setSettingsState(result.data)
      if (payload.mode === 'fixed') {
        const key = `${diskCat.id}_${existing.id}`
        await api.setFixedTimeCountdownOverride?.(key, payload.time!)
      }
      const cds = await api.getReminderCountdowns?.()
      if (cds) setCountdowns(cds)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
      setSaveStatus('error')
    } finally {
      setExpandedEditSub(null)
    }
  }

  const removeItem = (categoryIndex: number, itemIndex: number) => {
    const cat = settings.reminderCategories[categoryIndex]
    const removed = cat?.items[itemIndex]
    if (!cat || !removed) return
    const label = subReminderConfirmLabel(removed)
    if (!window.confirm(`确定删除子项「${label}」吗？\n删除后无法恢复。`)) return
    const next = settings.reminderCategories.slice()
    const patchedCat = { ...next[categoryIndex], items: next[categoryIndex].items.filter((_, i) => i !== itemIndex) }
    next[categoryIndex] = patchedCat
    setCategories(next)
    if (repeatDropdown?.categoryIndex === categoryIndex && repeatDropdown.itemIndex === itemIndex) setRepeatDropdown(null)
    if (repeatDropdown?.categoryIndex === categoryIndex && repeatDropdown.itemIndex > itemIndex) setRepeatDropdown({ ...repeatDropdown, itemIndex: repeatDropdown.itemIndex - 1 })
    if (removed && expandedEditSub?.itemId === removed.id) setExpandedEditSub(null)
  }

  const setCategoryItems = (categoryIndex: number, items: SubReminder[]) => {
    const next = settings.reminderCategories.slice()
    next[categoryIndex] = { ...next[categoryIndex], items }
    setCategories(next)
    setRepeatDropdown(null)
    setExpandedEditSub((prev) => {
      if (!prev) return null
      if (items.some((it) => it.id === prev.itemId)) return prev
      return null
    })
  }

  const setPresetPools = (next: PresetPools) => {
    setSettingsState((prev) => ({ ...prev, presetPools: next }))
    setSaveStatus('idle')
    setSaveError('')
  }

  const updatePresetPools = (patch: Partial<PresetPools>) => {
    setPresetPools({ ...settings.presetPools, ...patch })
  }

  const restContentPresets = settings.presetPools.restContent ?? []
  const subTitlePresets = settings.presetPools.subTitle ?? getDefaultPresetPools().subTitle
  const popupThemes = Array.isArray(settings.popupThemes) ? settings.popupThemes : getDefaultPopupThemes()
  const getFirstThemeIdByTarget = (target: PopupThemeTarget) =>
    getDefaultPopupThemeIdForTarget(popupThemes, target)

  const getCategoryTitlePresets = (kind: CategoryKind) => settings.presetPools.categoryTitle?.[kind] ?? []
  const setCategoryTitlePresets = (kind: CategoryKind, presets: string[]) => {
    const nextCategoryTitle = { ...(settings.presetPools.categoryTitle ?? getDefaultPresetPools().categoryTitle), [kind]: presets }
    updatePresetPools({ categoryTitle: nextCategoryTitle })
  }
  const setSubTitlePresetsByMode = (mode: 'fixed' | 'interval' | 'stopwatch', presets: string[]) => {
    const nextSubTitle = { ...(settings.presetPools.subTitle ?? getDefaultPresetPools().subTitle), [mode]: presets }
    updatePresetPools({ subTitle: nextSubTitle })
  }

  const setPopupThemes = (nextThemes: PopupTheme[]) => {
    setSettingsState((prev) => ({ ...prev, popupThemes: nextThemes }))
    setSaveStatus('idle')
    setSaveError('')
  }

  const addPopupTheme = (target: PopupThemeTarget): string => {
    const id = genId()
    const defaultName =
      target === 'main' ? '未命名结束壁纸' : target === 'rest' ? '未命名休息壁纸' : '未命名桌面壁纸'
    const defaultPreview =
      target === 'main'
        ? BUILTIN_MAIN_POPUP_FALLBACK_BODY
        : BUILTIN_REST_POPUP_FALLBACK_BODY
    const newTheme: PopupTheme = {
      id,
      name: defaultName,
      target,
      previewContentText: defaultPreview,
      backgroundType: 'solid',
      backgroundColor: '#000000',
      imageSourceType: 'single',
      overlayEnabled: false,
      overlayColor: '#000000',
      overlayOpacity: 0.45,
      contentColor: '#ffffff',
      contentFontSize: 180,
      timeColor: '#ffffff',
      timeTransform: { x: 50, y: 62, rotation: 0, scale: 1 },
      timeFontSize: 100,
      countdownColor: '#ffffff',
      countdownFontSize: 180,
      textAlign: 'center',
      imageFolderPlayMode: 'sequence',
      imageFolderIntervalSec: 30,
      formatVersion: target === 'desktop' ? 2 : 1,
      ...(target === 'main' || target === 'rest' ? MAIN_REST_LAYOUT_DEFAULTS : {}),
      ...(target === 'desktop'
        ? {
            timeColor: '#ffffff',
            timeTransform: { x: 50, y: 62, rotation: 0, scale: 1 },
            timeFontSize: 100,
          }
        : {}),
      ...(target === 'rest' || target === 'desktop'
        ? { countdownTransform: { x: 50, y: 78, rotation: 0, scale: 1, textBoxHeightPct: 20 } }
        : {}),
      ...(target === 'rest' ? { previewTimeText: REST_POPUP_PREVIEW_TIME_TEXT } : {}),
    }
    if (target === 'desktop') {
      Object.assign(newTheme, buildNewDesktopThemePatch(newTheme))
      newTheme.previewContentText = ''
      newTheme.formatVersion = 2
    }
    setPopupThemes(mergeSystemBuiltinPopupThemes([newTheme, ...popupThemes]))
    return id
  }

  const appendPopupTheme = useCallback((theme: PopupTheme) => {
    setSettingsState((prev) => {
      const list = Array.isArray(prev.popupThemes) ? prev.popupThemes : getDefaultPopupThemes()
      return {
        ...prev,
        // 新主题插到前面，与「添加主题」一致，设置页主题工坊与下拉框更容易看到刚保存的项
        popupThemes: mergeSystemBuiltinPopupThemes([theme, ...list]),
      }
    })
    setSaveStatus('idle')
    setSaveError('')
  }, [])

  const replacePopupTheme = useCallback((theme: PopupTheme) => {
    setSettingsState((prev) => {
      const themes = Array.isArray(prev.popupThemes) ? prev.popupThemes : getDefaultPopupThemes()
      return {
        ...prev,
        popupThemes: themes.map((t) => (t.id === theme.id ? { ...theme } : t)),
      }
    })
    setSaveStatus('idle')
    setSaveError('')
  }, [])

  const countPopupThemeReferences = useCallback(
    (themeId: string, exclude?: { categoryId: string; itemId: string } | null) => {
      let n = 0
      for (const cat of settings.reminderCategories) {
        for (const item of cat.items) {
          if (item.mode !== 'fixed' && item.mode !== 'interval') continue
          if (exclude && cat.id === exclude.categoryId && item.id === exclude.itemId) continue
          if (item.mainPopupThemeId === themeId) n++
          if (item.restPopupThemeId === themeId) n++
        }
      }
      return n
    },
    [settings.reminderCategories],
  )

  /** 函数式更新 prev.popupThemes：打组松手会连续 patch 多个字段，闭包里的数组会互相覆盖。注意不能传给 setPopupThemes(函数)，setPopupThemes 只接受数组，否则会整段把函数写进 state → .map 崩溃 */
  const updatePopupTheme = useCallback((themeId: string, patch: Partial<PopupTheme>) => {
    setSettingsState((prev) => {
      const themes = Array.isArray(prev.popupThemes) ? prev.popupThemes : getDefaultPopupThemes()
      return {
        ...prev,
        popupThemes: themes.map((t) => {
          if (t.id !== themeId) return t
          /**
           * 关键：绑定文本层与根字段 content* / contentTransform 必须同步。
           * 否则 ThemePreviewEditor 的 ensureThemeLayers 会从旧 binding layer 回写根字段，造成拖拽后点空白复位。
           */
          const layerSync =
            patch.layers === undefined
              ? mergeContentThemePatchIntoBindingTextLayer(t, patch)
              : undefined
          return { ...t, ...patch, ...(layerSync ?? {}) }
        }),
      }
    })
    setSaveStatus('idle')
    setSaveError('')
  }, [])

  const previewViewportWidthStudio = primaryDisplaySize?.width ?? 1920

  const subReminderThemeEditor = useMemo<SubReminderModalThemeEditorContext>(
    () => ({
      appendPopupTheme,
      replacePopupTheme,
      countPopupThemeReferences,
      updatePopupTheme,
      previewViewportWidth: previewViewportWidthStudio,
      popupPreviewAspect,
    }),
    [appendPopupTheme, replacePopupTheme, countPopupThemeReferences, updatePopupTheme, previewViewportWidthStudio, popupPreviewAspect],
  )

  const removePopupTheme = (themeId: string) => {
    const theme = popupThemes.find((t) => t.id === themeId)
    if (!theme) return
    const siblings = popupThemes.filter((t) => t.target === theme.target)
    const fallback =
      theme.target === 'desktop'
        ? (siblings.find((t) => t.id !== themeId)?.id ?? SYSTEM_DESKTOP_POPUP_THEME_ID)
        : siblings.find((t) => t.id !== themeId)?.id ??
          (theme.target === 'main' ? SYSTEM_MAIN_POPUP_THEME_ID : SYSTEM_REST_POPUP_THEME_ID)
    const nextThemes = mergeSystemBuiltinPopupThemes(popupThemes.filter((t) => t.id !== themeId))
    const nextCategories = settings.reminderCategories.map((cat) => ({
      ...cat,
      items: cat.items.map((item) => {
        if (item.mode !== 'fixed' && item.mode !== 'interval') return item
        if (item.mainPopupThemeId === themeId) {
          return { ...item, mainPopupThemeId: fallback }
        }
        if (item.restPopupThemeId === themeId) {
          return { ...item, restPopupThemeId: fallback }
        }
        return item
      }),
    }))
    setSettingsState((prev) => ({ ...prev, popupThemes: nextThemes, reminderCategories: nextCategories }))
    setSaveStatus('idle')
    setSaveError('')
  }

  const setRestContentPresets = (presets: string[]) => updatePresetPools({ restContent: presets })

  const save = async () => {
    const api = getApi()
    if (!api) {
      setSaveError('未检测到 Electron API。请用「启动开发环境.bat」打开应用窗口。')
      setSaveStatus('error')
      return
    }
    setSaveStatus('saving')
    setSaveError('')
    try {
      const result = await api.setSettings(settings)
      if (result.success) {
        suppressAutoSaveAfterHydrateRef.current = true
        setSettingsState(result.data)
        setSaveStatus('ok')
        setTimeout(() => setSaveStatus('idle'), 3000)
      } else {
        setSaveError(result.error)
        setSaveStatus('error')
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
      setSaveStatus('error')
    }
  }

  useEffect(() => {
    if (!floatingThemeEdit) return
    if (popupThemes.some((t) => t.id === floatingThemeEdit.themeId)) return
    setFloatingThemeEdit(null)
  }, [floatingThemeEdit, popupThemes])

  const floatingThemeRefExclude = useMemo(() => {
    if (floatingThemeEdit?.source.kind !== 'subitem') return null
    const { categoryId, itemAnchor } = floatingThemeEdit.source
    const cat = settings.reminderCategories.find((c) => c.id === categoryId)
    if (!cat?.items.some((i) => i.id === itemAnchor)) return null
    return { categoryId, itemId: itemAnchor }
  }, [floatingThemeEdit, settings.reminderCategories])

  const openThemeStudioEditFromSubitem = useCallback((args: OpenThemeStudioEditFromSubitemArgs) => {
    setFloatingThemeEdit({
      themeId: args.themeId,
      source: {
        kind: 'subitem',
        categoryId: args.categoryId,
        itemAnchor: args.itemAnchor,
        popupTarget: args.popupTarget,
      },
    })
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <span className="text-slate-500">加载中…</span>
      </div>
    )
  }

  const isElectron = !!getApi()
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">WorkBreak</h1>
          <ThemeToggle value={appTheme} onChange={handleAppThemeChange} />
        </div>
        {!isElectron && (
          <div className="mt-2 p-3 bg-amber-100 border border-amber-400 rounded text-amber-800 text-sm">
            <p className="font-medium">当前是浏览器页面，保存无效。</p>
            <p className="mt-1">请用「启动开发环境.bat」打开应用窗口后再保存。</p>
          </div>
        )}
      </header>

      <main className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-col space-y-6 px-4 py-4 sm:px-6 sm:py-6">
        <SettingsReminderTabRow
          categoryListFilter={categoryListFilter}
          themeStudioOpen={Boolean(themeStudioNav)}
          onCategory={applyCategoryListFilter}
          onStudio={openThemeStudioList}
        />

        {themeStudioNav ? (
          <div className="box-border flex min-h-[calc(100vh-280px)] w-full min-w-0 flex-1 flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <h2 className="text-lg font-semibold text-slate-800">主题工坊</h2>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const id = addPopupTheme('rest')
                    setFloatingThemeEdit({ themeId: id, source: { kind: 'studio-list' }, isNewDraft: true })
                  }}
                  className="rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-medium text-blue-900 hover:bg-blue-100"
                >
                  +休息壁纸
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const id = addPopupTheme('main')
                    setFloatingThemeEdit({ themeId: id, source: { kind: 'studio-list' }, isNewDraft: true })
                  }}
                  className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-900 hover:bg-emerald-100"
                >
                  +结束壁纸
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const id = addPopupTheme('desktop')
                    setFloatingThemeEdit({ themeId: id, source: { kind: 'studio-list' }, isNewDraft: true })
                  }}
                  className="rounded-md border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-xs font-medium text-violet-900 hover:bg-violet-100"
                >
                  +桌面壁纸
                </button>
              </div>
            </div>
            {themeStudioListMounted ? (
              <ThemeStudioListView
                themes={popupThemes}
                previewImageUrlMap={previewImageUrlMap}
                previewViewportWidth={previewViewportWidthStudio}
                popupPreviewAspect={popupPreviewAspect}
                onOpenEdit={(id) => setFloatingThemeEdit({ themeId: id, source: { kind: 'studio-list' } })}
                onCommitThemeName={(themeId, name) => updatePopupTheme(themeId, { name })}
                onDuplicateTheme={(themeId) => {
                  const th = popupThemes.find((x) => x.id === themeId)
                  if (!th) return
                  appendPopupTheme(clonePopupThemeForFork(th, '（副本）'))
                }}
                onRemoveTheme={(themeId) => {
                  if (!window.confirm('确定删除该壁纸？使用中的子项将自动切换到同类型的其他壁纸。')) return
                  setFloatingThemeEdit((prev) => (prev?.themeId === themeId ? null : prev))
                  removePopupTheme(themeId)
                }}
                onReorderThemes={setPopupThemes}
              />
            ) : (
              <div
                className="flex min-h-[min(480px,calc(100vh-360px))] flex-1 flex-col rounded-lg border border-dashed border-slate-100 bg-slate-50/30"
                aria-busy="true"
                aria-label="加载主题列表"
              />
            )}
          </div>
        ) : (
        <div className="box-border flex min-h-0 w-full min-w-0 flex-1 flex-col gap-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
          {(categoryListFilter === 'all' || categoryListFilter === 'alarm') && (
            <button
              type="button"
              onClick={() => addCategoryOfKind('alarm')}
              className="wb-add-type-btn flex-1 rounded-lg border-2 border-dashed border-slate-300 bg-transparent py-3 text-center text-sm text-slate-400 transition-colors hover:border-slate-400 hover:bg-slate-50 hover:text-slate-700"
            >
              + 闹钟类型
            </button>
          )}
          {(categoryListFilter === 'all' || categoryListFilter === 'countdown') && (
            <button
              type="button"
              onClick={() => addCategoryOfKind('countdown')}
              className="wb-add-type-btn flex-1 rounded-lg border-2 border-dashed border-slate-300 bg-transparent py-3 text-center text-sm text-slate-400 transition-colors hover:border-slate-400 hover:bg-slate-50 hover:text-slate-700"
            >
              + 倒计时类型
            </button>
          )}
          {(categoryListFilter === 'all' || categoryListFilter === 'stopwatch') && (
            <button
              type="button"
              onClick={() => addCategoryOfKind('stopwatch')}
              className="wb-add-type-btn flex-1 rounded-lg border-2 border-dashed border-slate-300 bg-transparent py-3 text-center text-sm text-slate-400 transition-colors hover:border-slate-400 hover:bg-slate-50 hover:text-slate-700"
            >
              + 秒表类型
            </button>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={save}
              disabled={saveStatus === 'saving'}
              className="rounded-lg bg-slate-800 text-white px-4 py-2 text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
            >
              {saveStatus === 'saving' ? '保存中…' : '立即保存'}
            </button>
            <button
              type="button"
              onClick={() => setShowResetConfirm(true)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              title="将所有提醒的开始点与进度更新为当前时刻"
            >
              全部重置
            </button>
            {saveStatus === 'ok' && <span className="text-sm font-medium text-green-600">已保存</span>}
            {saveStatus === 'error' && <span className="text-sm font-medium text-red-600">保存失败</span>}
          </div>
        </div>
        {saveError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">错误：{saveError}</p>}

        <DndContext
          sensors={categorySensors}
          collisionDetection={closestCenter}
          onDragEnd={(event: DragEndEvent) => {
            const { active, over } = event
            if (!over || active.id === over.id) return
            const filtered = filteredReminderCategories
            const oldIdx = filtered.findIndex((c) => c.id === active.id)
            const newIdx = filtered.findIndex((c) => c.id === over.id)
            if (oldIdx === -1 || newIdx === -1) return
            const newOrder = arrayMove(filtered, oldIdx, newIdx)
            const merged = categoryListFilter === 'all' ? newOrder : mergeVisibleCategoryOrder(settings.reminderCategories, newOrder)
            setCategories(merged)
            setRepeatDropdown(null)
            setExpandedEditSub(null)
            setInlineAddDraft(null)
          }}
        >
          <SortableContext items={filteredReminderCategories.map((c) => c.id)} strategy={verticalListSortingStrategy}>
            <div ref={categoryReorderContainerRef} className="space-y-6">
            {filteredReminderCategories.map((cat) => {
              const realCi = settings.reminderCategories.findIndex((c) => c.id === cat.id)
              if (realCi < 0) return null
              return (
              <CategoryCard
                key={cat.id}
                cat={cat}
                realCi={realCi}
                updateCategory={updateCategory}
                removeCategory={removeCategory}
                inlineAddDraft={inlineAddDraft}
                onOpenInlineAdd={(ci) => {
                  const c = settings.reminderCategories[ci]
                  if (!c || c.categoryKind === 'stopwatch') return
                  if (inlineAddDraft && inlineAddDraft.categoryId !== c.id) {
                    const abandoned = settings.reminderCategories.find((x) => x.id === inlineAddDraft.categoryId)
                    if (abandoned && abandoned.items.length === 0) {
                      setCategories(settings.reminderCategories.filter((x) => x.id !== inlineAddDraft.categoryId))
                    }
                  }
                  setExpandedEditSub(null)
                  setInlineAddDraft({
                    categoryId: c.id,
                    mode: c.categoryKind === 'alarm' ? 'fixed' : 'interval',
                    draftKey: genId(),
                  })
                }}
                onCancelInlineAdd={cancelInlineAddForCategory}
                onConfirmInlineAdd={(cid, payload) => handleAddSubReminderConfirm(cid, payload)}
                listContainerRefsMap={listContainerRefsMap}
                setCategoryItems={setCategoryItems}
                updateItem={updateItem}
                removeItem={removeItem}
                restContentPresets={restContentPresets}
                subTitlePresets={subTitlePresets}
                popupThemes={popupThemes}
                onOpenThemeStudioList={openThemeStudioList}
                onOpenThemeStudioEdit={openThemeStudioEditFromSubitem}
                getCategoryTitlePresets={getCategoryTitlePresets}
                onCategoryTitlePresetsChange={setCategoryTitlePresets}
                onRestContentPresetsChange={setRestContentPresets}
                onSubTitlePresetsChange={setSubTitlePresetsByMode}
                repeatDropdown={repeatDropdown}
                setRepeatDropdown={setRepeatDropdown}
                countdowns={countdowns}
                refreshCountdowns={() => getApi()?.getReminderCountdowns?.().then(setCountdowns)}
                expandedEditSub={expandedEditSub}
                toggleExpandedEditSub={toggleExpandedEditSub}
                onConfirmEmbeddedEdit={(cid, iid, payload) => handleEditSubReminderConfirm(cid, iid, payload)}
                addStopwatchItem={addStopwatchItem}
                onToggleEnabledNow={(ci, ii, enabled) => void toggleReminderEnabledNow(ci, ii, enabled)}
                onToggleCategoryAllEnabled={(ci, enabled) => void toggleCategoryAllEnabledNow(ci, enabled)}
                subReminderThemeEditor={subReminderThemeEditor}
                popupThemeRemotePatch={popupThemeRemotePatch}
                onConsumePopupThemeRemotePatch={() => setPopupThemeRemotePatch(null)}
                previewImageUrlMap={previewImageUrlMap}
                previewViewportWidth={previewViewportWidthStudio}
                popupPreviewAspect={popupPreviewAspect}
              />
              )
            })}
            </div>
          </SortableContext>
        </DndContext>

        </div>
        )}

      </main>

      {showResetConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => {
            if (resettingAll) return
            setShowResetConfirm(false)
          }}
        >
          <div
            className="w-full max-w-md rounded-xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-slate-200 px-4 py-3">
              <h3 className="text-base font-semibold text-slate-800">确认全部重置</h3>
            </div>
            <div className="px-4 py-4 text-sm leading-6 text-slate-600">
              此操作会将所有闹钟/倒计时的当前进度重置为“从现在开始”。配置内容不会被删除。
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
              <button
                type="button"
                onClick={() => setShowResetConfirm(false)}
                disabled={resettingAll}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    setResettingAll(true)
                    await getApi()?.resetAllReminderProgress?.()
                    const cds = await getApi()?.getReminderCountdowns?.()
                    if (cds) setCountdowns(cds)
                    setShowResetConfirm(false)
                  } finally {
                    setResettingAll(false)
                  }
                }}
                disabled={resettingAll}
                className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {resettingAll ? '重置中…' : '确认重置'}
              </button>
            </div>
          </div>
        </div>
      )}
      {floatingThemeEdit &&
        (() => {
          const fe = floatingThemeEdit
          const th = popupThemes.find((t) => t.id === fe.themeId)
          const previewViewportWidth = primaryDisplaySize?.width ?? 1920
          if (!th) return null
          const canDeleteFloating =
            fe.source.kind === 'studio-list' &&
            fe.themeId !== SYSTEM_MAIN_POPUP_THEME_ID &&
            fe.themeId !== SYSTEM_REST_POPUP_THEME_ID &&
            fe.themeId !== SYSTEM_DESKTOP_POPUP_THEME_ID
          return (
            <ThemeStudioFloatingEditor
              themes={popupThemes}
              themeId={fe.themeId}
              source={fe.source}
              isNewDraft={fe.isNewDraft === true}
              onClose={(opts) => {
                if (!opts?.saved && fe.isNewDraft) {
                  removePopupTheme(fe.themeId)
                }
                setFloatingThemeEdit(null)
              }}
              onSwitchEditingThemeId={(newId) => {
                setFloatingThemeEdit((prev) => {
                  if (!prev) return null
                  if (prev.isNewDraft && prev.themeId !== newId) {
                    removePopupTheme(prev.themeId)
                    return { ...prev, themeId: newId, isNewDraft: false }
                  }
                  return { ...prev, themeId: newId }
                })
              }}
              onAfterForkRebindSubitem={
                fe.source.kind === 'subitem'
                  ? (newThemeId) => {
                      if (fe.source.kind !== 'subitem') return
                      const s = fe.source
                      setPopupThemeRemotePatch({
                        categoryId: s.categoryId,
                        anchor: s.itemAnchor,
                        ...(s.popupTarget === 'main'
                          ? { mainPopupThemeId: newThemeId }
                          : { restPopupThemeId: newThemeId }),
                      })
                    }
                  : undefined
              }
              previewViewportWidth={previewViewportWidth}
              previewImageUrlMap={previewImageUrlMap}
              popupPreviewAspect={popupPreviewAspect}
              popupPreviewAspectPreset={popupPreviewAspectPreset}
              onPopupPreviewAspectChange={setPopupPreviewAspectPreset}
              getSelectedElements={getThemeSelectedElements}
              setSelectedElements={setThemeSelectedElements}
              replacePopupTheme={replacePopupTheme}
              appendPopupTheme={appendPopupTheme}
              countPopupThemeReferences={countPopupThemeReferences}
              themeRefExclude={floatingThemeRefExclude}
              onDeleteTheme={
                fe.source.kind === 'studio-list'
                  ? () => {
                      removePopupTheme(fe.themeId)
                      setFloatingThemeEdit(null)
                    }
                  : undefined
              }
              canDeleteTheme={canDeleteFloating}
            />
          )
        })()}
    </div>
  )
}
