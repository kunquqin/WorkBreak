import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react'
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
import type { AppSettings, CategoryKind, PresetPools, ReminderCategory, SubReminder, CountdownItem, PopupTheme } from '../types'
import { getDefaultPresetPools, getStableDefaultCategories, getDefaultPopupThemes, getDefaultEntitlements, genId } from '../types'
import { AddSubReminderModal, type AddSubReminderPayload } from '../components/AddSubReminderModal'
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
import { toPreviewImageUrl } from '../utils/popupThemePreview'
import { buildSplitSchedule } from '../../../shared/splitSchedule'

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
type PopupPreviewAspect = '16:9' | '4:3'
type ThemeSettingsPanelFilter = 'all' | 'text' | 'overlay' | 'background'
type ThemeBatchApplyScope = 'all' | 'selected'
type ThemeBatchApplyCandidate = {
  key: string
  mode: 'fixed' | 'interval'
  categoryName: string
  title: string
  summary: string
  enabled: boolean
}
type ThemeBatchApplyDraft = {
  themeId: string
  target: 'main' | 'rest'
  applyAlarm: boolean
  applyCountdown: boolean
  scope: ThemeBatchApplyScope
  selectedItemKeys: string[]
  applying: boolean
}

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

/** 间隔项显示为 H:MM:SS */
function formatIntervalHms(item: SubReminder & { mode: 'interval' }): string {
  const h = item.intervalHours ?? 0
  const m = item.intervalMinutes
  const s = item.intervalSeconds ?? 0
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function clampByViewport(minPx: number, viewportRatio: number, maxPx: number, viewportWidth: number): number {
  return Math.max(minPx, Math.min(maxPx, viewportWidth * viewportRatio))
}

function getDefaultCategoryName(kind: CategoryKind): string {
  return kind === 'alarm' ? '未命名闹钟类型' : kind === 'countdown' ? '未命名倒计时类型' : '未命名秒表类型'
}

function getDefaultSubTitle(mode: 'fixed' | 'interval' | 'stopwatch'): string {
  return mode === 'fixed' ? '未命名闹钟' : mode === 'interval' ? '未命名倒计时' : '未命名秒表'
}

/** 子项左侧大号时间：闹钟为下次响铃时刻（HH:mm），倒计时尚未启动时为周期 H:MM:SS，运行中为实时剩余 */
function getSubReminderLargeTimeMain(item: SubReminder, cd: CountdownItem | undefined): string {
  if (item.mode === 'stopwatch') return '—'
  if (item.mode === 'fixed') {
    const startLabel = item.startTime ?? item.time
    if (item.enabled === false) return item.time
    if (!cd) return startLabel
    if (cd.fixedState === 'pending') return formatTimeHHmm(cd.windowStartAt ?? cd.nextAt)
    if (cd.ended) return item.time
    return formatTimeHHmm(cd.nextAt)
  }
  const iv = item as SubReminder & { mode: 'interval' }
  if (iv.enabled === false) return formatIntervalHms(iv)
  if (cd?.ended) return formatIntervalHms(iv)
  if (!cd) return formatIntervalHms(iv)
  return formatRemaining(cd.remainingMs)
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
  reminderContentPresets: string[]
  restContentPresets: string[]
  subTitlePresets: PresetPools['subTitle']
  popupThemes: PopupTheme[]
  onOpenThemeStudio?: () => void
  /** @dnd-kit/sortable：仅手柄上 spread，避免 Framer Reorder 在可变高度下与鼠标错位 */
  sortableListeners: DraggableSyntheticListeners
  isSortableDragging: boolean
  repeatDropdown: { categoryIndex: number; itemIndex: number } | null
  setRepeatDropdown: (v: { categoryIndex: number; itemIndex: number } | null) => void
  /** 重置后立即刷新倒计时列表，使界面马上更新 */
  refreshCountdowns?: () => void
  /** 点击时钟/间隔：展开或收起与新建一致的内联表单 */
  expandedEditSub: { categoryId: string; itemId: string } | null
  toggleExpandedEditSub: (categoryId: string, itemId: string) => void
  onConfirmEmbeddedEdit: (categoryId: string, itemId: string, payload: AddSubReminderPayload) => void | Promise<void>
  /** 更新主提醒文案预设（闹钟+倒计时共享） */
  onReminderContentPresetsChange: (presets: string[]) => void
  /** 更新休息弹窗文案预设（独立） */
  onRestContentPresetsChange: (presets: string[]) => void
  /** 更新子项标题预设（按 mode 分池） */
  onSubTitlePresetsChange: (mode: 'fixed' | 'interval' | 'stopwatch', presets: string[]) => void
  /** 立即切换启用状态（并立刻生效） */
  onToggleEnabledNow: (categoryIndex: number, itemIndex: number, enabled: boolean) => void | Promise<void>
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
      <div className="-mx-3 mb-1 flex w-[calc(100%+1.5rem)] min-w-0 items-center gap-2 border-b border-slate-200 px-3 pb-2">
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
                inputClassName="text-left"
              />
            </div>
          ) : (
            <div
              className="flex h-9 w-full cursor-text items-center justify-start rounded pl-2 pr-9 text-sm hover:bg-slate-50"
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
        <button type="button" onClick={() => removeItem(categoryIndex, itemIndex)} className="text-red-600 hover:text-red-700 text-sm shrink-0">
          删除
        </button>
        <div
          className="min-w-[1.5rem] w-6 flex-shrink-0 flex items-center justify-center cursor-grab active:cursor-grabbing select-none"
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

function IoSwitch({ checked, onChange, id }: { checked: boolean; onChange: (v: boolean) => void; id: string }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
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
  setRepeatDropdown: (v: { categoryIndex: number; itemIndex: number } | null) => void
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
  reminderContentPresets,
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
  onReminderContentPresetsChange,
  onRestContentPresetsChange,
  onSubTitlePresetsChange,
  onOpenThemeStudio,
  onToggleEnabledNow,
}: SubReminderRowProps) {
  const countdownKey = `${categoryId}_${item.id}`
  const cd = countdowns.find((c) => c.key === countdownKey)
  const isTimeSettingsExpanded =
    expandedEditSub?.categoryId === categoryId && expandedEditSub?.itemId === item.id
  const largeTimeMain = getSubReminderLargeTimeMain(item, cd)
  const [editingTitle, setEditingTitle] = useState(false)
  const titleEditRef = useRef<HTMLDivElement>(null)
  const [editingContent, setEditingContent] = useState(false)
  const contentEditRef = useRef<HTMLDivElement>(null)
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
    if (!editingContent) return
    const onDown = (e: MouseEvent) => {
      if (contentEditRef.current && !contentEditRef.current.contains(e.target as Node)) {
        setEditingContent(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [editingContent])

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
  const isHmsFormat = largeTimeMain.split(':').length >= 3
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
          <div className="flex flex-nowrap items-center justify-center gap-4">
            <button type="button" onClick={() => removeItem(categoryIndex, itemIndex)} className="text-red-600 hover:text-red-700 text-sm shrink-0">
              删除
            </button>
            <div
              className="min-w-[1.5rem] w-6 flex-shrink-0 flex items-center justify-center cursor-grab active:cursor-grabbing select-none"
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
            contentPresets={reminderContentPresets}
            titlePresets={item.mode === 'fixed' ? subTitlePresets.fixed : subTitlePresets.interval}
            restPresets={restContentPresets}
            popupThemes={popupThemes}
            onClose={() => toggleExpandedEditSub(categoryId, item.id)}
            onConfirm={(payload) => {
              void onConfirmEmbeddedEdit(categoryId, item.id, payload)
            }}
            onContentPresetsChange={onReminderContentPresetsChange}
            onTitlePresetsChange={(presets) => onSubTitlePresetsChange(item.mode, presets)}
            onRestPresetsChange={onRestContentPresetsChange}
            onOpenThemeStudio={onOpenThemeStudio}
          />
        </div>
      ) : (
      <>
      <div className="flex w-full min-w-0 flex-col gap-1.5">
      <div className="-mx-3 mb-1 flex w-[calc(100%+1.5rem)] min-w-0 items-center gap-2 border-b border-slate-200 px-3 pb-2">
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
                inputClassName="text-left"
              />
            </div>
          ) : (
            <div
              className="flex h-9 w-full cursor-text items-center justify-start rounded pl-2 pr-9 text-sm hover:bg-slate-50"
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
        {(item.mode === 'interval' || item.mode === 'fixed') && (
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
        <button type="button" onClick={() => removeItem(categoryIndex, itemIndex)} className="text-red-600 hover:text-red-700 text-sm shrink-0">
          删除
        </button>
        <div
          className="min-w-[1.5rem] w-6 flex-shrink-0 flex items-center justify-center cursor-grab active:cursor-grabbing select-none self-center"
          style={{ touchAction: 'none' }}
          {...sortableListeners}
          title="拖动调整子项顺序"
        >
          <span className="select-none touch-none text-slate-500" aria-hidden>
            ⋮⋮
          </span>
        </div>
      </div>
      <div className="flex w-full min-w-0 items-stretch gap-4">
      {/* 左侧时间独占一列，高度与右侧整块对齐；闹钟为响铃时刻，倒计时为剩余 */}
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
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <div className="flex min-w-0 flex-wrap items-start gap-2">
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <span className="shrink-0 pt-2 text-sm text-slate-500">弹窗文案：</span>
        <div className="relative min-w-0 flex-1">
          {editingContent ? (
            <div
              ref={contentEditRef}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.target === contentEditRef.current?.querySelector('input')) {
                  setEditingContent(false)
                }
              }}
            >
              <PresetTextField
                resetKey={`row-${item.id}`}
                value={item.content}
                onChange={(v) => updateItem(categoryIndex, itemIndex, { content: v })}
                presets={reminderContentPresets}
                onPresetsChange={onReminderContentPresetsChange}
                mainPlaceholder="请输入提醒内容"
                autoFocusInput
                multilineMain
              />
            </div>
          ) : (
            <div
              className="flex w-full cursor-text items-start justify-start rounded px-2 py-1.5 text-sm hover:bg-slate-50"
              onClick={() => setEditingContent(true)}
              title="点击编辑弹窗文案"
            >
              <span className={`whitespace-normal break-words leading-6 ${item.content ? 'text-slate-700' : 'text-slate-300'}`}>
                {item.content || '请输入提醒内容'}
              </span>
            </div>
          )}
        </div>
      </div>
      </div>
      {(item.mode === 'fixed' || item.mode === 'interval') && (
        <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-xs text-slate-500">
            <span className="shrink-0">主弹窗主题</span>
            <select
              value={item.mainPopupThemeId ?? (mainThemeOptions[0]?.id ?? '')}
              onChange={(e) => updateItem(categoryIndex, itemIndex, { mainPopupThemeId: e.target.value })}
              className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
            >
              {mainThemeOptions.map((theme) => (
                <option key={theme.id} value={theme.id}>{theme.name}</option>
              ))}
            </select>
          </label>
          {((item.splitCount ?? 1) > 1) && (
            <label className="flex items-center gap-2 text-xs text-slate-500">
              <span className="shrink-0">休息主题</span>
              <select
                value={item.restPopupThemeId ?? (restThemeOptions[0]?.id ?? '')}
                onChange={(e) => updateItem(categoryIndex, itemIndex, { restPopupThemeId: e.target.value })}
                className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
              >
                {restThemeOptions.map((theme) => (
                  <option key={theme.id} value={theme.id}>{theme.name}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      {cd && (
        <div className="flex min-w-0 w-full flex-col gap-1">
          {/* 进度条上一行：左起始、右结束，均为普通文字（不进入编辑） */}
          {(() => {
            const startTimeLabel = cd.type === 'fixed'
              ? (cd.windowStartAt != null ? formatTimeHHmm(cd.windowStartAt) : (cd.startTime ?? cd.time ?? '—'))
              : (cd.cycleTotalMs != null && cd.cycleTotalMs > 0 ? formatTimeHHmm(cd.nextAt - cd.cycleTotalMs) : '—')
            const endTimeLabel = cd.type === 'fixed'
              ? (cd.windowEndAt != null ? formatTimeHHmm(cd.windowEndAt) : (cd.time ?? formatTimeHHmm(cd.nextAt)))
              : formatTimeHHmm(cd.nextAt)
            return (
              <div className="flex w-full items-center justify-between gap-2">
                <span className="shrink-0 text-sm text-slate-500 tabular-nums">起始 {startTimeLabel}</span>
                <span className="shrink-0 text-sm text-slate-500 tabular-nums">结束 {endTimeLabel}</span>
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
                  const fillClass = seg.type === 'work' ? 'bg-green-500' : 'bg-blue-500'
                  const pendingFillClass = cd.type === 'fixed' && cd.fixedState === 'pending' ? 'bg-violet-500' : fillClass
                  return (
                    <SplitSegmentProgressBar
                      key={i}
                      durationMs={seg.durationMs}
                      elapsedRatio={ratio}
                      fillClass={pendingFillClass}
                      showLabel={!(isFixedSingleEnded && seg.type === 'work')}
                    />
                  )
                })
              }
              return (
                <SingleCycleProgressBar
                  totalDurationMs={totalSpanMs}
                  remainingRatio={progressRatio}
                  fillClass={cd.type === 'fixed' && cd.fixedState === 'pending' ? 'bg-violet-500' : 'bg-green-500'}
                />
              )
            })()}
          </div>
          {/* 进度条下方：沙漏与倒计时随锚点移动，左右夹紧在进度条宽度内，避免与时间列重叠 */}
          {(() => {
            if (isInactive) {
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
  reminderContentPresets: string[]
  restContentPresets: string[]
  subTitlePresets: PresetPools['subTitle']
  popupThemes: PopupTheme[]
  onOpenThemeStudio?: () => void
  getCategoryTitlePresets: (kind: CategoryKind) => string[]
  onCategoryTitlePresetsChange: (kind: CategoryKind, presets: string[]) => void
  onReminderContentPresetsChange: (presets: string[]) => void
  onRestContentPresetsChange: (presets: string[]) => void
  onSubTitlePresetsChange: (mode: 'fixed' | 'interval' | 'stopwatch', presets: string[]) => void
  repeatDropdown: { categoryIndex: number; itemIndex: number } | null
  setRepeatDropdown: (v: { categoryIndex: number; itemIndex: number } | null) => void
  countdowns: CountdownItem[]
  refreshCountdowns?: () => void
  expandedEditSub: { categoryId: string; itemId: string } | null
  toggleExpandedEditSub: (categoryId: string, itemId: string) => void
  onConfirmEmbeddedEdit: (categoryId: string, itemId: string, payload: AddSubReminderPayload) => void | Promise<void>
  addStopwatchItem: (categoryIndex: number) => void
  onToggleEnabledNow: (categoryIndex: number, itemIndex: number, enabled: boolean) => void | Promise<void>
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
    reminderContentPresets,
    restContentPresets,
    subTitlePresets,
    popupThemes,
    onOpenThemeStudio,
    getCategoryTitlePresets,
    onCategoryTitlePresetsChange,
    onReminderContentPresetsChange,
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
  const [editingCategoryTitle, setEditingCategoryTitle] = useState(false)
  const categoryTitleEditRef = useRef<HTMLDivElement>(null)
  const categoryTitle = (cat.name ?? '').trim()
  const defaultCategoryTitle = getDefaultCategoryName(cat.categoryKind)
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
      <div className="p-4 border-b border-slate-100 flex items-center gap-2 flex-nowrap">
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
        <div className="flex items-center gap-2 flex-shrink-0">
          <button type="button" onClick={() => removeCategory(realCi)} className="text-sm text-red-600 hover:text-red-700 whitespace-nowrap">
            删除
          </button>
        </div>
        <div
          className="min-w-[2rem] w-8 flex-shrink-0 flex items-center justify-center min-h-[28px] cursor-grab active:cursor-grabbing select-none"
          style={{ touchAction: 'none' }}
          {...catSortListeners}
          title="拖动调整大类顺序"
        >
          <span className="select-none touch-none text-slate-500" aria-hidden>
            ⋮⋮
          </span>
        </div>
      </div>
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
                    reminderContentPresets={reminderContentPresets}
                    restContentPresets={restContentPresets}
                    subTitlePresets={subTitlePresets}
                    popupThemes={popupThemes}
                    onOpenThemeStudio={onOpenThemeStudio}
                    repeatDropdown={repeatDropdown}
                    setRepeatDropdown={setRepeatDropdown}
                    refreshCountdowns={refreshCountdowns}
                    expandedEditSub={expandedEditSub}
                    toggleExpandedEditSub={toggleExpandedEditSub}
                    onConfirmEmbeddedEdit={onConfirmEmbeddedEdit}
                    onReminderContentPresetsChange={onReminderContentPresetsChange}
                    onRestContentPresetsChange={onRestContentPresetsChange}
                    onSubTitlePresetsChange={onSubTitlePresetsChange}
                    onToggleEnabledNow={onToggleEnabledNow}
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
              contentPresets={reminderContentPresets}
              titlePresets={inlineAddDraft.mode === 'fixed' ? subTitlePresets.fixed : subTitlePresets.interval}
              restPresets={restContentPresets}
              popupThemes={popupThemes}
              onClose={() => onCancelInlineAdd(cat.id)}
              onConfirm={(payload) => {
                void onConfirmInlineAdd(cat.id, payload)
              }}
              onContentPresetsChange={onReminderContentPresetsChange}
              onTitlePresetsChange={(presets) => onSubTitlePresetsChange(inlineAddDraft.mode, presets)}
              onRestPresetsChange={onRestContentPresetsChange}
              onOpenThemeStudio={onOpenThemeStudio}
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
    </div>
  )
}

export function Settings() {
  const [settings, setSettingsState] = useState<AppSettings>(defaultSettings)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'ok' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string>('')
  const [settingsPath, setSettingsPath] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [lastSaveClick, setLastSaveClick] = useState<string>('从未')
  const [presetModal, setPresetModal] = useState<{ categoryIndex: number; itemIndex: number | null } | null>(null)
  const [repeatDropdown, setRepeatDropdown] = useState<{ categoryIndex: number; itemIndex: number } | null>(null)
  const [editingPresetIndex, setEditingPresetIndex] = useState<number | null>(null)
  const [editingPresetValue, setEditingPresetValue] = useState('')
  const [newPresetValue, setNewPresetValue] = useState('')
  const [countdowns, setCountdowns] = useState<CountdownItem[]>([])
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [resettingAll, setResettingAll] = useState(false)
  const [inlineAddDraft, setInlineAddDraft] = useState<{
    categoryId: string
    mode: 'fixed' | 'interval'
    draftKey: string
  } | null>(null)
  const [expandedEditSub, setExpandedEditSub] = useState<{ categoryId: string; itemId: string } | null>(null)
  const [categoryListFilter, setCategoryListFilter] = useState<CategoryListFilter>('all')
  const [popupPreviewAspect, setPopupPreviewAspect] = useState<PopupPreviewAspect>('16:9')
  const [themeSettingsPanelFilterMap, setThemeSettingsPanelFilterMap] = useState<Record<string, ThemeSettingsPanelFilter>>({})
  const [themeBatchApplyDraft, setThemeBatchApplyDraft] = useState<ThemeBatchApplyDraft | null>(null)
  const [previewImageUrlMap, setPreviewImageUrlMap] = useState<Record<string, string>>({})
  const [primaryDisplaySize, setPrimaryDisplaySize] = useState<{ width: number; height: number } | null>(null)
  const listContainerRefsMap = useRef<Record<string, React.RefObject<HTMLDivElement | null>>>({})
  const categoryReorderContainerRef = useRef<HTMLDivElement>(null)
  const popupThemeSectionRef = useRef<HTMLElement>(null)
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

  const applyCategoryListFilter = (f: CategoryListFilter) => {
    setCategoryListFilter(f)
    const cats = reminderCategoriesRef.current
    setRepeatDropdown(null)
    if (presetModal) {
      const c = cats[presetModal.categoryIndex]
      if (c && f !== 'all' && c.categoryKind !== f) {
        setPresetModal(null)
        setEditingPresetIndex(null)
        setNewPresetValue('')
      }
    }
    setInlineAddDraft((d) => {
      if (!d) return null
      const c = cats.find((x) => x.id === d.categoryId)
      if (!c) return null
      if (f !== 'all' && c.categoryKind !== f) return null
      return d
    })
    setExpandedEditSub((e) => {
      if (!e) return null
      const c = cats.find((x) => x.id === e.categoryId)
      if (!c) return null
      if (f !== 'all' && c.categoryKind !== f) return null
      return e
    })
  }
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
      removeCategory(ci)
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
      setLoading(false)
    }).catch((e) => {
      console.error('[WorkBreak] getSettings 失败', e)
      setLoading(false)
    })
    api.getSettingsFilePath().then(setSettingsPath).catch(() => setSettingsPath('(获取失败)'))
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
      new Set(
        (settings.popupThemes ?? [])
          .filter((t) => t.backgroundType === 'image')
          .flatMap((t) => {
            const paths: string[] = []
            if ((t.imagePath ?? '').trim()) paths.push((t.imagePath ?? '').trim())
            if (Array.isArray(t.imageFolderFiles)) {
              paths.push(...t.imageFolderFiles.filter((p) => typeof p === 'string' && p.trim().length > 0))
            }
            return paths
          })
      )
    )
    let disposed = false
    void Promise.all(
      paths.map(async (p) => {
        const r = await api.resolvePreviewImageUrl(p)
        return [p, r.success ? r.url : toPreviewImageUrl(p)] as const
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
    const tick = () => api.getReminderCountdowns().then(setCountdowns).catch(() => setCountdowns([]))
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
        items: c.items.map((it, ii) => (
          ii === itemIndex && (it.mode === 'fixed' || it.mode === 'interval')
            ? ({ ...it, enabled } as SubReminder)
            : it
        )),
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

  const addCategoryOfKind = (kind: CategoryKind) => {
    const newId = genId()
    const newCat: ReminderCategory = {
      id: newId,
      name: getDefaultCategoryName(kind),
      categoryKind: kind,
      presets: [],
      titlePresets: [],
      /** 秒表与闹钟类似：新建大类后立刻有一条可用子项，无需再点「+ 添加秒表」 */
      items: kind === 'stopwatch' ? [{ id: genId(), mode: 'stopwatch', content: getDefaultSubTitle('stopwatch') }] : [],
    }
    setCategories([newCat, ...settings.reminderCategories])
    setPresetModal((pm) => (pm ? { ...pm, categoryIndex: pm.categoryIndex + 1 } : null))
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

  const removeCategory = (categoryIndex: number) => {
    const removedCat = settings.reminderCategories[categoryIndex]
    setCategories(settings.reminderCategories.filter((_, i) => i !== categoryIndex))
    if (presetModal?.categoryIndex === categoryIndex) setPresetModal(null)
    if (presetModal && presetModal.categoryIndex > categoryIndex) setPresetModal({ ...presetModal, categoryIndex: presetModal.categoryIndex - 1 })
    if (repeatDropdown?.categoryIndex === categoryIndex) setRepeatDropdown(null)
    if (repeatDropdown && repeatDropdown.categoryIndex > categoryIndex) setRepeatDropdown({ ...repeatDropdown, categoryIndex: repeatDropdown.categoryIndex - 1 })
    if (removedCat && expandedEditSub?.categoryId === removedCat.id) setExpandedEditSub(null)
    if (removedCat && inlineAddDraft?.categoryId === removedCat.id) setInlineAddDraft(null)
  }

  const moveCategory = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return
    const next = settings.reminderCategories.slice()
    const [removed] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, removed)
    setCategories(next)
    if (presetModal !== null) {
      const idx = presetModal.categoryIndex
      if (idx === fromIndex) setPresetModal({ ...presetModal, categoryIndex: toIndex })
      else if (fromIndex < idx && toIndex >= idx) setPresetModal({ ...presetModal, categoryIndex: idx - 1 })
      else if (fromIndex > idx && toIndex <= idx) setPresetModal({ ...presetModal, categoryIndex: idx + 1 })
    }
    if (repeatDropdown !== null) {
      const idx = repeatDropdown.categoryIndex
      if (idx === fromIndex) setRepeatDropdown({ ...repeatDropdown, categoryIndex: toIndex })
      else if (fromIndex < idx && toIndex >= idx) setRepeatDropdown({ ...repeatDropdown, categoryIndex: idx - 1 })
      else if (fromIndex > idx && toIndex <= idx) setRepeatDropdown({ ...repeatDropdown, categoryIndex: idx + 1 })
    }
  }

  const moveItem = (categoryIndex: number, fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return
    const next = settings.reminderCategories.slice()
    const cat = { ...next[categoryIndex], items: next[categoryIndex].items.slice() }
    const [removed] = cat.items.splice(fromIndex, 1)
    cat.items.splice(toIndex, 0, removed)
    next[categoryIndex] = cat
    setCategories(next)
    if (repeatDropdown?.categoryIndex === categoryIndex) {
      if (repeatDropdown.itemIndex === fromIndex) setRepeatDropdown({ ...repeatDropdown, itemIndex: toIndex })
      else if (fromIndex < repeatDropdown.itemIndex && toIndex >= repeatDropdown.itemIndex) setRepeatDropdown({ ...repeatDropdown, itemIndex: repeatDropdown.itemIndex - 1 })
      else if (fromIndex > repeatDropdown.itemIndex && toIndex <= repeatDropdown.itemIndex) setRepeatDropdown({ ...repeatDropdown, itemIndex: repeatDropdown.itemIndex + 1 })
    }
  }

  /** 将子项从一个大类移动到另一个大类（可同大类，相当于 moveItem） */
  const moveItemToCategory = (fromCi: number, fromIi: number, toCi: number, toIndex: number) => {
    const next = settings.reminderCategories.slice()
    const fromCat = next[fromCi]
    if (!fromCat || fromIi < 0 || fromIi >= fromCat.items.length) return
    const toCat = next[toCi]
    if (!toCat || fromCat.categoryKind !== toCat.categoryKind) return
    const [removed] = fromCat.items.splice(fromIi, 1)
    const toItems = toCi === fromCi ? fromCat.items : toCat.items.slice()
    const insertAt = Math.max(0, Math.min(toIndex, toItems.length))
    toItems.splice(insertAt, 0, removed)
    if (toCi === fromCi) {
      next[fromCi] = { ...fromCat, items: toItems }
    } else {
      next[fromCi] = { ...fromCat, items: fromCat.items }
      next[toCi] = { ...toCat, items: toItems }
    }
    setCategories(next)
    if (repeatDropdown) {
      if (repeatDropdown.categoryIndex === fromCi && repeatDropdown.itemIndex === fromIi) {
        setRepeatDropdown(toCi === fromCi ? { ...repeatDropdown, itemIndex: insertAt } : { categoryIndex: toCi, itemIndex: insertAt })
      } else if (repeatDropdown.categoryIndex === fromCi && fromIi < repeatDropdown.itemIndex) {
        setRepeatDropdown({ ...repeatDropdown, itemIndex: repeatDropdown.itemIndex - 1 })
      } else if (repeatDropdown.categoryIndex === toCi && insertAt <= repeatDropdown.itemIndex) {
        setRepeatDropdown({ ...repeatDropdown, itemIndex: repeatDropdown.itemIndex + 1 })
      }
    }
    if (expandedEditSub && removed.id === expandedEditSub.itemId) {
      setExpandedEditSub({ categoryId: next[toCi].id, itemId: removed.id })
    }
    if (presetModal?.categoryIndex === fromCi && presetModal.itemIndex === fromIi) {
      setPresetModal(toCi === fromCi ? { ...presetModal, itemIndex: insertAt } : { categoryIndex: toCi, itemIndex: insertAt })
    } else if (presetModal?.categoryIndex === fromCi && fromIi < (presetModal.itemIndex ?? 0)) {
      setPresetModal({ ...presetModal, itemIndex: (presetModal.itemIndex ?? 0) - 1 })
    } else if (presetModal?.categoryIndex === toCi && insertAt <= (presetModal.itemIndex ?? 0)) {
      setPresetModal({ ...presetModal, itemIndex: (presetModal.itemIndex ?? 0) + 1 })
    }
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
            content: payload.content || '提醒',
            ...(Array.isArray(payload.weekdaysEnabled) && payload.weekdaysEnabled.length === 7
              ? { weekdaysEnabled: payload.weekdaysEnabled.map(Boolean) }
              : {}),
            ...(resolvedMainThemeId ? { mainPopupThemeId: resolvedMainThemeId } : {}),
            ...(resolvedRestThemeId ? { restPopupThemeId: resolvedRestThemeId } : {}),
            splitCount: payload.splitCount,
            restDurationSeconds: payload.restDurationSeconds,
            restContent: payload.restContent,
          }
        : {
            id: genId(),
            mode: 'interval',
            title: payload.title?.trim() || getDefaultSubTitle('interval'),
            enabled: true,
            intervalHours: payload.intervalHours ?? 0,
            intervalMinutes: payload.intervalMinutes ?? 30,
            intervalSeconds: payload.intervalSeconds ?? 0,
            content: payload.content || '提醒',
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
    const content = payload.content.trim() || '提醒'
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
    const removed = settings.reminderCategories[categoryIndex]?.items[itemIndex]
    const next = settings.reminderCategories.slice()
    const cat = { ...next[categoryIndex], items: next[categoryIndex].items.filter((_, i) => i !== itemIndex) }
    next[categoryIndex] = cat
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
    setExpandedEditSub(null)
  }

  const setPresetPools = (next: PresetPools) => {
    setSettingsState((prev) => ({ ...prev, presetPools: next }))
    setSaveStatus('idle')
    setSaveError('')
  }

  const updatePresetPools = (patch: Partial<PresetPools>) => {
    setPresetPools({ ...settings.presetPools, ...patch })
  }

  const reminderContentPresets = settings.presetPools.reminderContent ?? []
  const restContentPresets = settings.presetPools.restContent ?? []
  const subTitlePresets = settings.presetPools.subTitle ?? getDefaultPresetPools().subTitle
  const popupThemes = settings.popupThemes ?? getDefaultPopupThemes()
  const getFirstThemeIdByTarget = (target: 'main' | 'rest') =>
    popupThemes.find((t) => t.target === target)?.id

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

  const addPopupTheme = (target: 'main' | 'rest') => {
    const newTheme: PopupTheme = {
      id: genId(),
      name: target === 'main' ? '主弹窗主题' : '休息弹窗主题',
      target,
      backgroundType: 'solid',
      backgroundColor: '#000000',
      imageSourceType: 'single',
      overlayEnabled: false,
      overlayColor: '#000000',
      overlayOpacity: 0.45,
      contentColor: '#ffffff',
      timeColor: '#e2e8f0',
      countdownColor: '#ffffff',
      contentFontSize: target === 'main' ? 56 : 40,
      timeFontSize: target === 'main' ? 30 : 24,
      countdownFontSize: 180,
      textAlign: 'center',
      imageFolderPlayMode: 'sequence',
      imageFolderIntervalSec: 30,
    }
    setPopupThemes([newTheme, ...popupThemes])
  }

  const updatePopupTheme = (themeId: string, patch: Partial<PopupTheme>) => {
    setPopupThemes(
      popupThemes.map((t) => (t.id === themeId ? { ...t, ...patch } : t))
    )
  }

  const removePopupTheme = (themeId: string) => {
    const theme = popupThemes.find((t) => t.id === themeId)
    if (!theme) return
    const siblings = popupThemes.filter((t) => t.target === theme.target)
    if (siblings.length <= 1) return
    const fallback = siblings.find((t) => t.id !== themeId)?.id
    const nextThemes = popupThemes.filter((t) => t.id !== themeId)
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

  const applyThemeToAll = (draft: ThemeBatchApplyDraft) => {
    if (!draft.applyAlarm && !draft.applyCountdown) return
    const selectedSet = draft.scope === 'selected' ? new Set(draft.selectedItemKeys) : null
    if (selectedSet && selectedSet.size === 0) return
    const nextCategories = settings.reminderCategories.map((cat) => ({
      ...cat,
      items: cat.items.map((item) => {
        const rowKey = `${cat.id}__${item.id}`
        if (selectedSet && !selectedSet.has(rowKey)) return item
        if (item.mode === 'fixed' && draft.applyAlarm) {
          return draft.target === 'main'
            ? { ...item, mainPopupThemeId: draft.themeId }
            : { ...item, restPopupThemeId: draft.themeId }
        }
        if (item.mode === 'interval' && draft.applyCountdown) {
          return draft.target === 'main'
            ? { ...item, mainPopupThemeId: draft.themeId }
            : { ...item, restPopupThemeId: draft.themeId }
        }
        return item
      }),
    }))
    setSettingsState((prev) => ({ ...prev, reminderCategories: nextCategories }))
    setSaveStatus('idle')
    setSaveError('')
  }
  const getThemeBatchCandidates = (draft: ThemeBatchApplyDraft): ThemeBatchApplyCandidate[] => {
    const list: ThemeBatchApplyCandidate[] = []
    settings.reminderCategories.forEach((cat) => {
      cat.items.forEach((item) => {
        if (item.mode === 'fixed' && draft.applyAlarm) {
          const title = (item.title ?? '').trim() || getDefaultSubTitle('fixed')
          list.push({
            key: `${cat.id}__${item.id}`,
            mode: 'fixed',
            categoryName: (cat.name ?? '').trim() || getDefaultCategoryName(cat.categoryKind),
            title,
            summary: `${item.startTime ?? item.time} → ${item.time}`,
            enabled: item.enabled !== false,
          })
        } else if (item.mode === 'interval' && draft.applyCountdown) {
          const title = (item.title ?? '').trim() || getDefaultSubTitle('interval')
          list.push({
            key: `${cat.id}__${item.id}`,
            mode: 'interval',
            categoryName: (cat.name ?? '').trim() || getDefaultCategoryName(cat.categoryKind),
            title,
            summary: formatIntervalHms(item),
            enabled: item.enabled !== false,
          })
        }
      })
    })
    return list
  }
  const getThemePanelFilter = (themeId: string): ThemeSettingsPanelFilter => themeSettingsPanelFilterMap[themeId] ?? 'all'
  const setThemePanelFilter = (themeId: string, filter: ThemeSettingsPanelFilter) => {
    setThemeSettingsPanelFilterMap((prev) => ({ ...prev, [themeId]: filter }))
  }
  const setReminderContentPresets = (presets: string[]) => updatePresetPools({ reminderContent: presets })
  const setRestContentPresets = (presets: string[]) => updatePresetPools({ restContent: presets })

  const pickThemeImageFile = async (themeId: string) => {
    const api = getApi()
    const result = await api?.pickPopupImageFile?.()
    if (!result || !result.success) return
    updatePopupTheme(themeId, {
      backgroundType: 'image',
      imageSourceType: 'single',
      imagePath: result.path,
      imageFolderPath: undefined,
      imageFolderFiles: undefined,
    })
  }

  const pickThemeImageFolder = async (themeId: string) => {
    const api = getApi()
    const result = await api?.pickPopupImageFolder?.()
    if (!result || !result.success) return
    updatePopupTheme(themeId, {
      backgroundType: 'image',
      imageSourceType: 'folder',
      imageFolderPath: result.folderPath,
      imageFolderFiles: result.files,
      imagePath: result.files[0],
      imageFolderPlayMode: 'sequence',
      imageFolderIntervalSec: 30,
    })
  }

  const applyPresetToItem = (categoryIndex: number, itemIndex: number, text: string) => {
    const it = settings.reminderCategories[categoryIndex]?.items[itemIndex]
    if (it?.mode === 'stopwatch') return
    updateItem(categoryIndex, itemIndex, { content: text })
    if (presetModal) setPresetModal(null)
  }

  const addPreset = (_categoryIndex: number) => {
    const v = newPresetValue.trim()
    if (!v) return
    setReminderContentPresets([...reminderContentPresets, v])
    setNewPresetValue('')
  }

  const deletePreset = (_categoryIndex: number, index: number) => {
    setReminderContentPresets(reminderContentPresets.filter((_, i) => i !== index))
    if (editingPresetIndex === index) setEditingPresetIndex(null)
    else if (editingPresetIndex != null && editingPresetIndex > index) setEditingPresetIndex(editingPresetIndex - 1)
  }

  const startEditPreset = (index: number) => {
    setEditingPresetIndex(index)
    setEditingPresetValue(reminderContentPresets[index] ?? '')
  }

  const saveEditPreset = (_categoryIndex: number) => {
    if (editingPresetIndex == null) return
    const list = reminderContentPresets.slice()
    list[editingPresetIndex] = editingPresetValue.trim() || list[editingPresetIndex]
    setReminderContentPresets(list)
    setEditingPresetIndex(null)
    setEditingPresetValue('')
  }

  const save = async () => {
    setLastSaveClick(new Date().toLocaleTimeString('zh-CN'))
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

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <span className="text-slate-500">加载中…</span>
      </div>
    )
  }

  const isElectron = !!getApi()
  const themeBatchCandidates = themeBatchApplyDraft ? getThemeBatchCandidates(themeBatchApplyDraft) : []
  const themeBatchSelectedSet = themeBatchApplyDraft ? new Set(themeBatchApplyDraft.selectedItemKeys) : new Set<string>()
  const themeBatchSelectedCount =
    themeBatchApplyDraft?.scope === 'selected'
      ? themeBatchCandidates.filter((c) => themeBatchSelectedSet.has(c.key)).length
      : themeBatchCandidates.length
  const themeBatchInvalidSelection =
    !!themeBatchApplyDraft &&
    (themeBatchApplyDraft.scope === 'selected' && themeBatchSelectedCount <= 0)

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="bg-white border-b border-slate-200 px-6 py-4">
        <h1 className="text-xl font-semibold">WorkBreak 设置</h1>
        <p className="text-sm text-slate-500 mt-0.5">可配置的多种提醒类型</p>
        {!isElectron && (
          <div className="mt-2 p-3 bg-amber-100 border border-amber-400 rounded text-amber-800 text-sm">
            <p className="font-medium">当前是浏览器页面，保存无效。</p>
            <p className="mt-1">请用「启动开发环境.bat」打开应用窗口后再保存。</p>
          </div>
        )}
        <div className="mt-3 p-3 bg-slate-100 rounded text-xs space-y-1">
          <p><strong>调试</strong> electronAPI: {isElectron ? '已连接' : '未连接'} | 上次保存: {lastSaveClick} | 状态: {saveStatus}</p>
          {settingsPath && <p>设置文件: {settingsPath}</p>}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        <div
          className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
          role="tablist"
          aria-label="提醒类型筛选"
        >
          {(
            [
              { id: 'all' as const, label: '全部' },
              { id: 'alarm' as const, label: '闹钟' },
              { id: 'countdown' as const, label: '倒计时' },
              { id: 'stopwatch' as const, label: '秒表' },
            ] as const
          ).map(({ id, label }) => {
            const active = categoryListFilter === id
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => applyCategoryListFilter(id)}
                className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-slate-800 text-white shadow-sm'
                    : 'bg-slate-50 text-slate-700 hover:bg-slate-100 border border-transparent'
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
          {(categoryListFilter === 'all' || categoryListFilter === 'alarm') && (
            <button
              type="button"
              onClick={() => addCategoryOfKind('alarm')}
              className="flex-1 rounded-lg border-2 border-dashed border-slate-300 bg-transparent py-3 text-center text-sm text-slate-400 transition-colors hover:border-slate-400 hover:bg-slate-50 hover:text-slate-700"
            >
              + 闹钟类型
            </button>
          )}
          {(categoryListFilter === 'all' || categoryListFilter === 'countdown') && (
            <button
              type="button"
              onClick={() => addCategoryOfKind('countdown')}
              className="flex-1 rounded-lg border-2 border-dashed border-slate-300 bg-transparent py-3 text-center text-sm text-slate-400 transition-colors hover:border-slate-400 hover:bg-slate-50 hover:text-slate-700"
            >
              + 倒计时类型
            </button>
          )}
          {(categoryListFilter === 'all' || categoryListFilter === 'stopwatch') && (
            <button
              type="button"
              onClick={() => addCategoryOfKind('stopwatch')}
              className="flex-1 rounded-lg border-2 border-dashed border-slate-300 bg-transparent py-3 text-center text-sm text-slate-400 transition-colors hover:border-slate-400 hover:bg-slate-50 hover:text-slate-700"
            >
              + 秒表类型
            </button>
          )}
        </div>

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
            setPresetModal(null)
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
                reminderContentPresets={reminderContentPresets}
                restContentPresets={restContentPresets}
                subTitlePresets={subTitlePresets}
                popupThemes={popupThemes}
                onOpenThemeStudio={() => popupThemeSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                getCategoryTitlePresets={getCategoryTitlePresets}
                onCategoryTitlePresetsChange={setCategoryTitlePresets}
                onReminderContentPresetsChange={setReminderContentPresets}
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
              />
              )
            })}
            </div>
          </SortableContext>
        </DndContext>

        <section ref={popupThemeSectionRef} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h3 className="text-base font-semibold text-slate-800">弹窗主题（V1 开发中）</h3>
              <p className="text-xs text-slate-500 mt-1">先提供主题基础字段配置与持久化，后续迭代预览、遮罩渐变和批量应用。</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => addPopupTheme('main')}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
              >
                + 主弹窗主题
              </button>
              <button
                type="button"
                onClick={() => addPopupTheme('rest')}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
              >
                + 休息弹窗主题
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-xs text-slate-500">实时预览比例</p>
            <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5">
              <button
                type="button"
                onClick={() => setPopupPreviewAspect('16:9')}
                className={`rounded px-2 py-1 text-xs transition-colors ${popupPreviewAspect === '16:9' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                16:9
              </button>
              <button
                type="button"
                onClick={() => setPopupPreviewAspect('4:3')}
                className={`rounded px-2 py-1 text-xs transition-colors ${popupPreviewAspect === '4:3' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                4:3
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {popupThemes.map((theme) => {
              const previewViewportWidth = primaryDisplaySize?.width ?? (popupPreviewAspect === '16:9' ? 1920 : 1600)
              const previewRenderMaxWidth = 920
              const previewScale = Math.min(1, previewRenderMaxWidth / Math.max(1, previewViewportWidth))
              const toPreviewPx = (px: number) => Math.max(1, px * previewScale)
              const contentFontMax = Math.max(14, Math.min(120, Math.floor(theme.contentFontSize ?? 56)))
              const timeFontMax = Math.max(10, Math.min(100, Math.floor(theme.timeFontSize ?? 30)))
              const countdownFontMax = Math.max(48, Math.min(280, Math.floor(theme.countdownFontSize ?? 180)))
              const mainLine1FontPx = clampByViewport(20, 0.06, contentFontMax, previewViewportWidth)
              const mainLine2FontPx = clampByViewport(14, 0.03, timeFontMax, previewViewportWidth)
              const mainPaddingPx = Math.min(previewViewportWidth * 0.05, 48)
              const mainLine1MbPx = clampByViewport(16, 0.03, 40, previewViewportWidth)
              const mainLine2MbPx = clampByViewport(32, 0.05, 64, previewViewportWidth)
              const restLine1FontPx = clampByViewport(20, 0.06, contentFontMax, previewViewportWidth)
              const restLine2FontPx = clampByViewport(14, 0.03, timeFontMax, previewViewportWidth)
              const restCountdownFontPx = clampByViewport(80, 0.2, countdownFontMax, previewViewportWidth)
              const restLine1MbPx = clampByViewport(16, 0.03, 40, previewViewportWidth)
              const restLine2MbPx = clampByViewport(24, 0.04, 56, previewViewportWidth)
              const previewAlignItems = theme.textAlign === 'left' ? 'flex-start' : theme.textAlign === 'right' ? 'flex-end' : 'center'
              return (
              <div key={theme.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`inline-flex rounded px-2 py-0.5 text-[11px] font-medium ${theme.target === 'main' ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700'}`}>
                    {theme.target === 'main' ? '主弹窗' : '休息弹窗'}
                  </span>
                  <input
                    type="text"
                    value={theme.name}
                    onChange={(e) => updatePopupTheme(theme.id, { name: e.target.value })}
                    className="flex-1 min-w-[12rem] rounded border border-slate-300 px-2 py-1 text-sm"
                    placeholder="主题名称"
                  />
                  <button
                    type="button"
                    onClick={() => removePopupTheme(theme.id)}
                    className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-40"
                    disabled={popupThemes.filter((t) => t.target === theme.target).length <= 1}
                    title="每个目标至少保留一个主题"
                  >
                    删除
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setThemeBatchApplyDraft({
                        themeId: theme.id,
                        target: theme.target,
                        applyAlarm: true,
                        applyCountdown: true,
                        scope: 'all',
                        selectedItemKeys: [],
                        applying: false,
                      })
                    }
                    className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                    title="将当前主题批量应用到提醒子项"
                  >
                    应用到全部…
                  </button>
                </div>
                <div className="space-y-3">
                  <div className="rounded-md border border-slate-200 bg-white p-2">
                    <div
                      className="relative mx-auto w-full max-w-[920px] overflow-hidden rounded border border-slate-300 bg-black"
                      style={{ aspectRatio: popupPreviewAspect === '16:9' ? '16 / 9' : '4 / 3' }}
                    >
                      <div
                        className="absolute inset-0"
                        style={{
                          background:
                            theme.backgroundType === 'image' && (theme.imagePath || (theme.imageFolderFiles && theme.imageFolderFiles.length > 0))
                              ? `url("${previewImageUrlMap[((theme.imageSourceType === 'folder' ? theme.imageFolderFiles?.[0] : theme.imagePath) ?? '').trim()] || toPreviewImageUrl((theme.imageSourceType === 'folder' ? theme.imageFolderFiles?.[0] : theme.imagePath) ?? '')}") center / cover no-repeat, ${theme.backgroundColor || '#000000'}`
                              : (theme.backgroundColor || '#000000'),
                        }}
                      />
                      <div
                        className="absolute inset-0"
                        style={{
                          background: theme.overlayColor || '#000000',
                          opacity: theme.overlayEnabled ? Math.max(0, Math.min(1, theme.overlayOpacity ?? 0.45)) : 0,
                        }}
                      />
                      <div
                        className="relative z-[1] flex h-full w-full flex-col justify-center gap-2 px-6"
                        style={{ textAlign: theme.textAlign, alignItems: previewAlignItems, padding: `${toPreviewPx(mainPaddingPx)}px` }}
                      >
                        {theme.target === 'main' ? (
                          <>
                            <div
                              style={{
                                color: theme.contentColor,
                                fontSize: `${toPreviewPx(mainLine1FontPx)}px`,
                                lineHeight: 1.35,
                                marginBottom: `${toPreviewPx(mainLine1MbPx)}px`,
                                fontWeight: 600,
                                width: '100%',
                                maxWidth: '96%',
                                whiteSpace: 'pre-wrap',
                              }}
                            >
                              提醒内容
                            </div>
                            <div
                              style={{
                                color: theme.timeColor,
                                fontSize: `${toPreviewPx(mainLine2FontPx)}px`,
                                marginBottom: `${toPreviewPx(mainLine2MbPx)}px`,
                                width: '100%',
                              }}
                            >
                              12:34
                            </div>
                          </>
                        ) : (
                          <>
                            <div
                              style={{
                                color: theme.contentColor,
                                fontSize: `${toPreviewPx(restLine1FontPx)}px`,
                                lineHeight: 1.35,
                                marginBottom: `${toPreviewPx(restLine1MbPx)}px`,
                                fontWeight: 600,
                                width: '100%',
                                maxWidth: '96%',
                                whiteSpace: 'pre-wrap',
                              }}
                            >
                              休息提醒内容
                            </div>
                            <div
                              style={{
                                color: theme.timeColor,
                                fontSize: `${toPreviewPx(restLine2FontPx)}px`,
                                marginBottom: `${toPreviewPx(restLine2MbPx)}px`,
                                width: '100%',
                              }}
                            >
                              12:34
                            </div>
                            <div
                              style={{
                                color: theme.countdownColor,
                                fontSize: `${toPreviewPx(restCountdownFontPx)}px`,
                                lineHeight: 1,
                                fontWeight: 700,
                                width: '100%',
                              }}
                            >
                              5
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3 flex-wrap rounded-md border border-slate-200 bg-white px-3 py-2">
                    <p className="text-xs text-slate-500">参数分页</p>
                    <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5">
                      <button
                        type="button"
                        onClick={() => setThemePanelFilter(theme.id, 'all')}
                        className={`rounded px-2 py-1 text-xs transition-colors ${getThemePanelFilter(theme.id) === 'all' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                      >
                        全部
                      </button>
                      <button
                        type="button"
                        onClick={() => setThemePanelFilter(theme.id, 'text')}
                        className={`rounded px-2 py-1 text-xs transition-colors ${getThemePanelFilter(theme.id) === 'text' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                      >
                        文字
                      </button>
                      <button
                        type="button"
                        onClick={() => setThemePanelFilter(theme.id, 'overlay')}
                        className={`rounded px-2 py-1 text-xs transition-colors ${getThemePanelFilter(theme.id) === 'overlay' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                      >
                        遮罩
                      </button>
                      <button
                        type="button"
                        onClick={() => setThemePanelFilter(theme.id, 'background')}
                        className={`rounded px-2 py-1 text-xs transition-colors ${getThemePanelFilter(theme.id) === 'background' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                      >
                        背景
                      </button>
                    </div>
                  </div>

                  {(getThemePanelFilter(theme.id) === 'all' || getThemePanelFilter(theme.id) === 'text') && (
                  <div className="rounded-md border border-slate-200 bg-white p-3 space-y-2">
                    <h4 className="text-xs font-semibold text-slate-700">文字</h4>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      <label className="text-xs text-slate-600 space-y-1">
                        <span>主文案颜色</span>
                        <input
                          type="color"
                          value={theme.contentColor}
                          onChange={(e) => updatePopupTheme(theme.id, { contentColor: e.target.value })}
                          className="h-8 w-full rounded border border-slate-300 bg-white"
                        />
                      </label>
                      <label className="text-xs text-slate-600 space-y-1">
                        <span>时间颜色</span>
                        <input
                          type="color"
                          value={theme.timeColor}
                          onChange={(e) => updatePopupTheme(theme.id, { timeColor: e.target.value })}
                          className="h-8 w-full rounded border border-slate-300 bg-white"
                        />
                      </label>
                      {theme.target === 'rest' && (
                        <label className="text-xs text-slate-600 space-y-1">
                          <span>倒计时颜色</span>
                          <input
                            type="color"
                            value={theme.countdownColor}
                            onChange={(e) => updatePopupTheme(theme.id, { countdownColor: e.target.value })}
                            className="h-8 w-full rounded border border-slate-300 bg-white"
                          />
                        </label>
                      )}
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      <label className="text-xs text-slate-600 space-y-1">
                        <span>文案字号</span>
                        <input
                          type="number"
                          min={12}
                          max={120}
                          value={theme.contentFontSize}
                          onChange={(e) => updatePopupTheme(theme.id, { contentFontSize: Math.max(12, Math.min(120, Number(e.target.value) || 12)) })}
                          className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                        />
                      </label>
                      <label className="text-xs text-slate-600 space-y-1">
                        <span>时间字号</span>
                        <input
                          type="number"
                          min={10}
                          max={80}
                          value={theme.timeFontSize}
                          onChange={(e) => updatePopupTheme(theme.id, { timeFontSize: Math.max(10, Math.min(80, Number(e.target.value) || 10)) })}
                          className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                        />
                      </label>
                      {theme.target === 'rest' && (
                        <label className="text-xs text-slate-600 space-y-1">
                          <span>倒计时字号</span>
                          <input
                            type="number"
                            min={40}
                            max={260}
                            value={theme.countdownFontSize}
                            onChange={(e) => updatePopupTheme(theme.id, { countdownFontSize: Math.max(40, Math.min(260, Number(e.target.value) || 40)) })}
                            className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                          />
                        </label>
                      )}
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <label className="text-xs text-slate-600 space-y-1">
                        <span>文字对齐</span>
                        <select
                          value={theme.textAlign}
                          onChange={(e) => updatePopupTheme(theme.id, { textAlign: e.target.value as PopupTheme['textAlign'] })}
                          className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                        >
                          <option value="left">左对齐</option>
                          <option value="center">居中</option>
                          <option value="right">右对齐</option>
                        </select>
                      </label>
                    </div>
                  </div>
                  )}

                  {(getThemePanelFilter(theme.id) === 'all' || getThemePanelFilter(theme.id) === 'overlay') && (
                  <div className="rounded-md border border-slate-200 bg-white p-3 space-y-2">
                    <h4 className="text-xs font-semibold text-slate-700">遮罩</h4>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      <label className="inline-flex items-center gap-2 rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700">
                        <input
                          type="checkbox"
                          checked={theme.overlayEnabled}
                          onChange={(e) => updatePopupTheme(theme.id, { overlayEnabled: e.target.checked })}
                        />
                        启用遮罩
                      </label>
                      <label className="text-xs text-slate-600 space-y-1">
                        <span>遮罩颜色</span>
                        <input
                          type="color"
                          value={theme.overlayColor}
                          onChange={(e) => updatePopupTheme(theme.id, { overlayColor: e.target.value })}
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
                          onChange={(e) => updatePopupTheme(theme.id, { overlayOpacity: Math.max(0, Math.min(1, Number(e.target.value) || 0)) })}
                          disabled={!theme.overlayEnabled}
                          className="w-full rounded border border-slate-300 px-2 py-1 text-sm disabled:opacity-50"
                        />
                      </label>
                    </div>
                  </div>
                  )}

                  {(getThemePanelFilter(theme.id) === 'all' || getThemePanelFilter(theme.id) === 'background') && (
                  <div className="rounded-md border border-slate-200 bg-white p-3 space-y-2">
                    <h4 className="text-xs font-semibold text-slate-700">背景</h4>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      <label className="text-xs text-slate-600 space-y-1">
                        <span>背景类型</span>
                        <select
                          value={theme.backgroundType}
                          onChange={(e) => updatePopupTheme(theme.id, { backgroundType: e.target.value as PopupTheme['backgroundType'] })}
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
                            onChange={(e) => updatePopupTheme(theme.id, { backgroundColor: e.target.value })}
                            className="h-8 w-full rounded border border-slate-300 bg-white"
                          />
                        </label>
                      )}
                    </div>

                    {theme.backgroundType === 'image' && (
                      <div className="space-y-2">
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <button
                            type="button"
                            onClick={() => { void pickThemeImageFile(theme.id) }}
                            className="rounded border border-slate-300 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50"
                          >
                            选择单个图片
                          </button>
                          <button
                            type="button"
                            onClick={() => { void pickThemeImageFolder(theme.id) }}
                            className="rounded border border-slate-300 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50"
                          >
                            选择图片文件夹（轮播）
                          </button>
                        </div>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          <label className="text-xs text-slate-600 space-y-1">
                            <span>图片来源</span>
                            <select
                              value={theme.imageSourceType ?? 'single'}
                              onChange={(e) => updatePopupTheme(theme.id, { imageSourceType: e.target.value as 'single' | 'folder' })}
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
                                  onChange={(e) => updatePopupTheme(theme.id, { imageFolderPlayMode: e.target.value as 'sequence' | 'random' })}
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
                                  onChange={(e) => updatePopupTheme(theme.id, { imageFolderIntervalSec: Math.max(1, Math.min(3600, Number(e.target.value) || 1)) })}
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
                            onChange={(e) => updatePopupTheme(theme.id, { imagePath: e.target.value, imageSourceType: 'single' })}
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
            )})}
          </div>
        </section>

        <div className="space-y-3">
          <p className="text-xs text-slate-500 leading-relaxed">
            有修改后约 0.4 秒内会在后台<strong className="text-slate-600">自动写入</strong>本地文件（静默，不闪状态）。下方「立即保存」用于马上落盘；旁边的<strong className="text-slate-600">「已保存」</strong>仅在该按钮成功时出现。
          </p>
          <div className="flex items-center gap-3 flex-wrap">
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
              title="将所有提醒的起始点与进度更新为当前时刻"
            >
              全部重置
            </button>
            {saveStatus === 'ok' && <span className="text-sm font-medium text-green-600">已保存</span>}
            {saveStatus === 'error' && <span className="text-sm font-medium text-red-600">保存失败</span>}
          </div>
          {saveError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">错误：{saveError}</p>}
          {settingsPath && <p className="text-xs text-slate-500">设置文件：<code className="bg-slate-100 px-1 rounded">{settingsPath}</code></p>}
        </div>
      </main>

      {presetModal !== null && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={() => { setPresetModal(null); setEditingPresetIndex(null); setNewPresetValue('') }}
        >
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[80vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-slate-200 flex justify-between items-center">
              <h3 className="font-medium text-slate-800">主弹窗文案预设（闹钟/倒计时共享）</h3>
              <button type="button" className="text-slate-400 hover:text-slate-600 text-xl leading-none" onClick={() => { setPresetModal(null); setEditingPresetIndex(null); setNewPresetValue('') }}>×</button>
            </div>
            <div className="p-4 overflow-auto flex-1">
              <ul className="space-y-2">
                {reminderContentPresets.map((p, i) => (
                  <li key={i} className="flex items-center gap-2 flex-wrap">
                    {editingPresetIndex === i ? (
                      <>
                        <input
                          type="text"
                          value={editingPresetValue}
                          onChange={(e) => setEditingPresetValue(e.target.value)}
                          className="flex-1 min-w-0 rounded border border-slate-300 px-2 py-1 text-sm"
                          autoFocus
                        />
                        <button type="button" className="rounded bg-slate-700 text-white px-2 py-1 text-sm" onClick={() => saveEditPreset(presetModal.categoryIndex)}>保存</button>
                        <button type="button" className="rounded border border-slate-300 px-2 py-1 text-sm" onClick={() => { setEditingPresetIndex(null); setEditingPresetValue('') }}>取消</button>
                      </>
                    ) : (
                      <>
                        <span className="flex-1 min-w-0 text-sm truncate">{p || '(空)'}</span>
                        {presetModal.itemIndex !== null && (
                          <button type="button" className="text-green-600 hover:text-green-700 text-sm" onClick={() => applyPresetToItem(presetModal.categoryIndex, presetModal.itemIndex!, p)}>使用</button>
                        )}
                        <button type="button" className="text-slate-600 hover:text-slate-800 text-sm" onClick={() => startEditPreset(i)}>编辑</button>
                        <button type="button" className="text-red-600 hover:text-red-700 text-sm" onClick={() => deletePreset(presetModal.categoryIndex, i)}>删除</button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex gap-2">
                <input
                  type="text"
                  value={newPresetValue}
                  onChange={(e) => setNewPresetValue(e.target.value)}
                  placeholder="新增预设内容"
                  className="flex-1 rounded border border-slate-300 px-3 py-1.5 text-sm"
                  onKeyDown={(e) => e.key === 'Enter' && addPreset(presetModal.categoryIndex)}
                />
                <button type="button" className="rounded bg-slate-700 text-white px-3 py-1.5 text-sm" onClick={() => addPreset(presetModal.categoryIndex)}>添加</button>
              </div>
            </div>
          </div>
        </div>
      )}

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
      {themeBatchApplyDraft && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => {
            if (themeBatchApplyDraft.applying) return
            setThemeBatchApplyDraft(null)
          }}
        >
          <div className="w-full max-w-2xl rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-slate-200 px-4 py-3">
              <h3 className="text-base font-semibold text-slate-800">
                批量应用{themeBatchApplyDraft.target === 'main' ? '主弹窗' : '休息弹窗'}主题
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                可按类型全量应用，或切换为“自定义选择”按子项精确应用（按 id 生效）。
              </p>
            </div>
            <div className="space-y-3 px-4 py-4 text-sm text-slate-700">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={themeBatchApplyDraft.applyAlarm}
                    onChange={(e) =>
                      setThemeBatchApplyDraft((prev) => (prev ? { ...prev, applyAlarm: e.target.checked } : prev))
                    }
                    disabled={themeBatchApplyDraft.applying}
                  />
                  所有闹钟
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={themeBatchApplyDraft.applyCountdown}
                    onChange={(e) =>
                      setThemeBatchApplyDraft((prev) => (prev ? { ...prev, applyCountdown: e.target.checked } : prev))
                    }
                    disabled={themeBatchApplyDraft.applying}
                  />
                  所有倒计时
                </label>
              </div>
              {!themeBatchApplyDraft.applyAlarm && !themeBatchApplyDraft.applyCountdown && (
                <p className="text-xs text-red-600">请至少选择一个应用范围。</p>
              )}

              <div className="rounded-md border border-slate-200 p-2">
                <div className="mb-2 flex items-center gap-3 text-xs">
                  <label className="inline-flex items-center gap-1.5">
                    <input
                      type="radio"
                      name="batch-scope"
                      checked={themeBatchApplyDraft.scope === 'all'}
                      onChange={() =>
                        setThemeBatchApplyDraft((prev) => (prev ? { ...prev, scope: 'all' } : prev))
                      }
                      disabled={themeBatchApplyDraft.applying}
                    />
                    全部符合条件
                  </label>
                  <label className="inline-flex items-center gap-1.5">
                    <input
                      type="radio"
                      name="batch-scope"
                      checked={themeBatchApplyDraft.scope === 'selected'}
                      onChange={() =>
                        setThemeBatchApplyDraft((prev) => (prev ? { ...prev, scope: 'selected' } : prev))
                      }
                      disabled={themeBatchApplyDraft.applying}
                    />
                    自定义选择
                  </label>
                </div>
                <p className="text-xs text-slate-500">
                  当前候选 {themeBatchCandidates.length} 项，计划应用 {themeBatchSelectedCount} 项
                </p>
              </div>

              {themeBatchApplyDraft.scope === 'selected' && (
                <div className="rounded-md border border-slate-200">
                  <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2">
                    <span className="text-xs text-slate-600">候选子项（仅显示当前类型范围）</span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setThemeBatchApplyDraft((prev) =>
                            prev
                              ? { ...prev, selectedItemKeys: themeBatchCandidates.map((c) => c.key) }
                              : prev
                          )
                        }
                        disabled={themeBatchApplyDraft.applying}
                        className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-white disabled:opacity-50"
                      >
                        全选
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setThemeBatchApplyDraft((prev) =>
                            prev
                              ? { ...prev, selectedItemKeys: [] }
                              : prev
                          )
                        }
                        disabled={themeBatchApplyDraft.applying}
                        className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-white disabled:opacity-50"
                      >
                        清空
                      </button>
                    </div>
                  </div>
                  <div className="max-h-64 overflow-auto p-2 space-y-1">
                    {themeBatchCandidates.length === 0 ? (
                      <p className="px-2 py-1 text-xs text-slate-500">暂无可选子项。</p>
                    ) : (
                      themeBatchCandidates.map((candidate) => (
                        <label
                          key={candidate.key}
                          className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-slate-50"
                        >
                          <input
                            type="checkbox"
                            checked={themeBatchSelectedSet.has(candidate.key)}
                            onChange={(e) =>
                              setThemeBatchApplyDraft((prev) => {
                                if (!prev) return prev
                                const nextSet = new Set(prev.selectedItemKeys)
                                if (e.target.checked) nextSet.add(candidate.key)
                                else nextSet.delete(candidate.key)
                                return { ...prev, selectedItemKeys: Array.from(nextSet) }
                              })
                            }
                            disabled={themeBatchApplyDraft.applying}
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 text-xs">
                              <span className={`rounded px-1.5 py-0.5 ${candidate.mode === 'fixed' ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700'}`}>
                                {candidate.mode === 'fixed' ? '闹钟' : '倒计时'}
                              </span>
                              <span className="truncate text-slate-700">{candidate.categoryName} / {candidate.title}</span>
                              {!candidate.enabled && <span className="text-[11px] text-slate-400">已关闭</span>}
                            </div>
                            <div className="mt-0.5 text-[11px] text-slate-500">{candidate.summary}</div>
                          </div>
                        </label>
                      ))
                    )}
                  </div>
                  {themeBatchInvalidSelection && (
                    <p className="border-t border-slate-200 px-3 py-2 text-xs text-red-600">请至少勾选一个子项。</p>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
              <button
                type="button"
                onClick={() => setThemeBatchApplyDraft(null)}
                disabled={themeBatchApplyDraft.applying}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                disabled={
                  themeBatchApplyDraft.applying ||
                  (!themeBatchApplyDraft.applyAlarm && !themeBatchApplyDraft.applyCountdown) ||
                  themeBatchInvalidSelection
                }
                onClick={() => {
                  const draft = themeBatchApplyDraft
                  if (!draft) return
                  setThemeBatchApplyDraft({ ...draft, applying: true })
                  applyThemeToAll(draft)
                  setThemeBatchApplyDraft(null)
                }}
                className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {themeBatchApplyDraft.applying ? '应用中…' : `确认应用（${themeBatchSelectedCount}）`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
