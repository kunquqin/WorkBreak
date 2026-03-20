import { useState, useEffect, type CSSProperties } from 'react'
import type { PopupTheme, SubReminder } from '../types'
import { WheelColumn, parseTimeHHmm, formatHHmm, WHEEL_VIEW_H } from './TimePickerModal'
import { StaticSplitPreviewSegment, StaticSinglePreviewBar } from './SegmentProgressBars'
import { PresetTextField } from './PresetTextField'
import { WeekdayRepeatControl } from './WeekdayRepeatControl'
import { ALL_WEEKDAYS_ENABLED } from '../utils/weekdayRepeatUtils'
import { RepeatCountPicker } from './RepeatCountPicker'
import { toPreviewImageUrl } from '../utils/popupThemePreview'
import { buildSplitSchedule } from '../../../shared/splitSchedule'

function hmsToSeconds(h: number, m: number, s: number): number {
  return Math.max(0, h * 3600 + m * 60 + s)
}

/** 本机当前时分（新建闹钟时默认对齐「此刻」，便于对照系统时间微调） */
function getLocalHoursMinutes(): { h: number; m: number } {
  const d = new Date()
  return { h: d.getHours(), m: d.getMinutes() }
}

function addOneHour(h: number, m: number): { h: number; m: number } {
  const total = (h * 60 + m + 60) % (24 * 60)
  return { h: Math.floor(total / 60), m: total % 60 }
}

function addMinutes(h: number, m: number, minutes: number): { h: number; m: number } {
  const total = (((h * 60 + m + minutes) % (24 * 60)) + (24 * 60)) % (24 * 60)
  return { h: Math.floor(total / 60), m: total % 60 }
}

/** 首次渲染时的时分范围：编辑用条目起止，新建固定闹钟默认「当前到一小时后」 */
function getInitialFixedRangeHM(
  variant: 'create' | 'edit',
  mode: 'fixed' | 'interval',
  sourceItem?: SubReminder
): { startH: number; startM: number; endH: number; endM: number } {
  if (variant === 'edit' && sourceItem?.mode === 'fixed') {
    const end = parseTimeHHmm(sourceItem.time)
    const start = sourceItem.startTime ? parseTimeHHmm(sourceItem.startTime) : end
    return { startH: start.h, startM: start.m, endH: end.h, endM: end.m }
  }
  if (mode === 'fixed') {
    const now = getLocalHoursMinutes()
    const end = addOneHour(now.h, now.m)
    return { startH: now.h, startM: now.m, endH: end.h, endM: end.m }
  }
  return { startH: 12, startM: 0, endH: 12, endM: 0 }
}

function getFixedWindowDurationMs(startH: number, startM: number, endH: number, endM: number): number {
  const startMin = startH * 60 + startM
  const endMin = endH * 60 + endM
  if (startMin === endMin) return 0
  const delta = endMin > startMin ? (endMin - startMin) : (24 * 60 - startMin + endMin)
  return delta * 60 * 1000
}

export type AddSubReminderPayload = {
  mode: 'fixed' | 'interval'
  title?: string
  startTime?: string
  time?: string
  mainPopupThemeId?: string
  restPopupThemeId?: string
  /** 闹钟：与 Date.getDay() 一致，长度 7 */
  weekdaysEnabled?: boolean[]
  intervalHours?: number
  intervalMinutes?: number
  intervalSeconds?: number
  content: string
  repeatCount?: number | null
  splitCount?: number
  restDurationSeconds?: number
  restContent?: string
}

export type AddSubReminderModalProps = {
  open: boolean
  mode: 'fixed' | 'interval'
  contentPresets: string[]
  titlePresets: string[]
  restPresets: string[]
  popupThemes: PopupTheme[]
  onClose: () => void
  onConfirm: (payload: AddSubReminderPayload) => void
  /** 更新主提醒文案预设（闹钟+倒计时共享） */
  onContentPresetsChange: (presets: string[]) => void
  /** 更新子项标题预设（按 mode 分池） */
  onTitlePresetsChange: (presets: string[]) => void
  /** 更新休息弹窗文案预设（与主提醒文案隔离） */
  onRestPresetsChange: (presets: string[]) => void
  /** 编辑已有子项：与新建界面相同，底部为「更新」 */
  variant?: 'create' | 'edit'
  /** variant=edit 时必填，用于载入初始值 */
  sourceItem?: SubReminder
  /** 内联在列表子项/大类内：无遮罩；默认 modal 全屏弹窗 */
  layout?: 'modal' | 'embedded'
  /** 内联时用于重置表单（如每次打开不同草稿） */
  formInstanceKey?: string
  /** 跳转到设置页主题工坊（可选） */
  onOpenThemeStudio?: () => void
}

export function AddSubReminderModal({
  open,
  mode,
  contentPresets,
  titlePresets,
  restPresets,
  popupThemes,
  onClose,
  onConfirm,
  onContentPresetsChange,
  onTitlePresetsChange,
  onRestPresetsChange,
  variant = 'create',
  sourceItem,
  layout = 'modal',
  formInstanceKey = '',
  onOpenThemeStudio,
}: AddSubReminderModalProps) {
  const getDefaultTitle = (m: 'fixed' | 'interval') => (m === 'fixed' ? '未命名闹钟' : '未命名倒计时')
  const [startH, setStartH] = useState(() => getInitialFixedRangeHM(variant, mode, sourceItem).startH)
  const [startM, setStartM] = useState(() => getInitialFixedRangeHM(variant, mode, sourceItem).startM)
  const [endH, setEndH] = useState(() => getInitialFixedRangeHM(variant, mode, sourceItem).endH)
  const [endM, setEndM] = useState(() => getInitialFixedRangeHM(variant, mode, sourceItem).endM)
  const [startHPreview, setStartHPreview] = useState(() => getInitialFixedRangeHM(variant, mode, sourceItem).startH)
  const [startMPreview, setStartMPreview] = useState(() => getInitialFixedRangeHM(variant, mode, sourceItem).startM)
  const [endHPreview, setEndHPreview] = useState(() => getInitialFixedRangeHM(variant, mode, sourceItem).endH)
  const [endMPreview, setEndMPreview] = useState(() => getInitialFixedRangeHM(variant, mode, sourceItem).endM)

  const [intervalHours, setIntervalHours] = useState(0)
  const [intervalMinutes, setIntervalMinutes] = useState(30)
  const [intervalSeconds, setIntervalSeconds] = useState(0)

  const [title, setTitle] = useState(getDefaultTitle(mode))
  const [content, setContent] = useState('')
  const [splitCount, setSplitCount] = useState(1)
  const [restH, setRestH] = useState(0)
  const [restM, setRestM] = useState(0)
  const [restS, setRestS] = useState(0)
  const [restContent, setRestContent] = useState('休息一下')
  const [splitErr, setSplitErr] = useState<string | null>(null)
  const [fixedRangeErr, setFixedRangeErr] = useState<string | null>(null)
  const [mainPopupThemeId, setMainPopupThemeId] = useState('')
  const [restPopupThemeId, setRestPopupThemeId] = useState('')
  const [weekdaysEnabled, setWeekdaysEnabled] = useState<boolean[]>(() => Array(7).fill(false))
  const [repeatCount, setRepeatCount] = useState<number | null>(1)
  const mainThemeOptions = popupThemes.filter((t) => t.target === 'main')
  const restThemeOptions = popupThemes.filter((t) => t.target === 'rest')
  const defaultMainThemeId = mainThemeOptions[0]?.id ?? ''
  const defaultRestThemeId = restThemeOptions[0]?.id ?? ''
  const [previewImageUrlMap, setPreviewImageUrlMap] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!open) return
    if (variant === 'edit' && sourceItem) {
      if (sourceItem.mode === 'stopwatch') return
      setTitle((sourceItem.title ?? '').trim() || getDefaultTitle(sourceItem.mode))
      setContent(sourceItem.content)
      setSplitCount(sourceItem.splitCount ?? 1)
      const rsec = sourceItem.restDurationSeconds ?? 0
      const rh = Math.floor(rsec / 3600)
      const rm = Math.floor((rsec % 3600) / 60)
      const rs = rsec % 60
      setRestH(rh)
      setRestM(rm)
      setRestS(rs)
      setRestContent(sourceItem.restContent ?? '休息一下')
      if (sourceItem.mode === 'fixed' || sourceItem.mode === 'interval') {
        setMainPopupThemeId(sourceItem.mainPopupThemeId ?? defaultMainThemeId)
        setRestPopupThemeId(sourceItem.restPopupThemeId ?? defaultRestThemeId)
      }
      if (sourceItem.mode === 'fixed') {
        const { h: eh, m: em } = parseTimeHHmm(sourceItem.time)
        const { h: sh, m: sm } = sourceItem.startTime ? parseTimeHHmm(sourceItem.startTime) : { h: eh, m: em }
        setStartH(sh)
        setStartM(sm)
        setEndH(eh)
        setEndM(em)
        setStartHPreview(sh)
        setStartMPreview(sm)
        setEndHPreview(eh)
        setEndMPreview(em)
        setWeekdaysEnabled(
          Array.isArray(sourceItem.weekdaysEnabled) && sourceItem.weekdaysEnabled.length === 7
            ? sourceItem.weekdaysEnabled.map(Boolean)
            : [...ALL_WEEKDAYS_ENABLED]
        )
      } else if (sourceItem.mode === 'interval') {
        setIntervalHours(sourceItem.intervalHours ?? 0)
        setIntervalMinutes(sourceItem.intervalMinutes)
        setIntervalSeconds(sourceItem.intervalSeconds ?? 0)
        setRepeatCount(sourceItem.repeatCount ?? null)
      }
      setSplitErr(null)
      setFixedRangeErr(null)
      return
    }
    if (mode === 'fixed') {
      const now = getLocalHoursMinutes()
      const end = addOneHour(now.h, now.m)
      setStartH(now.h)
      setStartM(now.m)
      setEndH(end.h)
      setEndM(end.m)
      setStartHPreview(now.h)
      setStartMPreview(now.m)
      setEndHPreview(end.h)
      setEndMPreview(end.m)
    } else {
      setIntervalHours(0)
      setIntervalMinutes(30)
      setIntervalSeconds(0)
      setRepeatCount(1)
    }
    setTitle(getDefaultTitle(mode))
    setContent('')
    setWeekdaysEnabled(Array(7).fill(false))
    setSplitCount(1)
    setRestH(0)
    setRestM(0)
    setRestS(0)
    setRestContent('休息一下')
    setMainPopupThemeId(defaultMainThemeId)
    setRestPopupThemeId(defaultRestThemeId)
    setSplitErr(null)
    setFixedRangeErr(null)
  }, [open, mode, variant, sourceItem?.id, formInstanceKey, layout, defaultMainThemeId, defaultRestThemeId])

  useEffect(() => {
    if (!open) return
    if (!mainThemeOptions.some((t) => t.id === mainPopupThemeId)) {
      setMainPopupThemeId(defaultMainThemeId)
    }
    if (!restThemeOptions.some((t) => t.id === restPopupThemeId)) {
      setRestPopupThemeId(defaultRestThemeId)
    }
  }, [open, mainPopupThemeId, restPopupThemeId, mainThemeOptions, restThemeOptions, defaultMainThemeId, defaultRestThemeId])

  useEffect(() => {
    if (!open) return
    const api = window.electronAPI
    if (!api?.resolvePreviewImageUrl) return
    const paths = Array.from(
      new Set(
        popupThemes
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
  }, [open, popupThemes])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const splitN = Math.max(1, Math.min(10, splitCount))
  const intervalTotalMs = (intervalHours * 3600 + intervalMinutes * 60 + intervalSeconds) * 1000
  const fixedWindowMs = getFixedWindowDurationMs(startHPreview, startMPreview, endHPreview, endMPreview)
  const totalSpanMs =
    mode === 'fixed'
      ? fixedWindowMs
      : intervalTotalMs
  const restSec = hmsToSeconds(restH, restM, restS)
  const restMs = splitN > 1 ? restSec * 1000 : 0
  const splitPlan = buildSplitSchedule(totalSpanMs, splitN, restMs)

  useEffect(() => {
    if (!open) return
    if (mode !== 'fixed') {
      setFixedRangeErr(null)
      return
    }
    const sameMinute = startHPreview === endHPreview && startMPreview === endMPreview
    setFixedRangeErr(sameMinute ? '起始时间与结束时间不能相同。' : null)
  }, [open, mode, startHPreview, startMPreview, endHPreview, endMPreview])

  useEffect(() => {
    if (!open) return
    if (splitN <= 1) {
      setSplitErr(null)
      return
    }
    if (!splitPlan.valid) {
      setSplitErr('总时长不足以容纳拆分休息，请减少拆分份数或缩短休息时长。')
      return
    }
    if (mode === 'interval' && splitPlan.workDurationsMs.some((d) => d < 1000)) {
      setSplitErr('每段工作时长至少 1 秒，请减少拆分份数或缩短休息时长。')
      return
    }
    setSplitErr(null)
  }, [open, splitN, splitPlan, mode])

  if (!open) return null

  const applyRest = (rh: number, rm: number, rs: number) => {
    const nextRestMs = (splitN > 1 ? hmsToSeconds(rh, rm, rs) : 0) * 1000
    const previewPlan = buildSplitSchedule(totalSpanMs, splitN, nextRestMs)
    if (!previewPlan.valid) {
      setSplitErr('总时长不足以容纳拆分休息，请减少拆分份数或缩短休息时长。')
      return
    }
    if (mode === 'interval' && previewPlan.workDurationsMs.some((d) => d < 1000)) {
      setSplitErr('每段工作时长至少 1 秒，请减少拆分份数或缩短休息时长。')
      return
    }
    setSplitErr(null)
  }

  const handleRestChange = (rh: number, rm: number, rs: number) => {
    setRestH(rh)
    setRestM(rm)
    setRestS(rs)
    applyRest(rh, rm, rs)
  }

  const resetStartToNow = () => {
    const now = getLocalHoursMinutes()
    let nextEnd = { h: endHPreview, m: endMPreview }
    if (now.h === nextEnd.h && now.m === nextEnd.m) {
      nextEnd = addMinutes(now.h, now.m, 1)
    }
    setStartH(now.h)
    setStartM(now.m)
    setStartHPreview(now.h)
    setStartMPreview(now.m)
    setEndH(nextEnd.h)
    setEndM(nextEnd.m)
    setEndHPreview(nextEnd.h)
    setEndMPreview(nextEnd.m)
  }

  const resetEndToNowPlusOneMinute = () => {
    const now = getLocalHoursMinutes()
    let nextEnd = addMinutes(now.h, now.m, 1)
    if (nextEnd.h === startHPreview && nextEnd.m === startMPreview) {
      nextEnd = addMinutes(nextEnd.h, nextEnd.m, 1)
    }
    setEndH(nextEnd.h)
    setEndM(nextEnd.m)
    setEndHPreview(nextEnd.h)
    setEndMPreview(nextEnd.m)
  }

  const useSplit = splitN > 1 && splitPlan.valid && splitPlan.segments.length > 1
  const segments = useSplit ? splitPlan.segments : []

  const handleStart = () => {
    if (mode === 'fixed' && fixedRangeErr) return
    const totalRestSec = splitN > 1 ? hmsToSeconds(restH, restM, restS) : 0
    const confirmPlan = buildSplitSchedule(totalSpanMs, splitN, totalRestSec * 1000)
    if (!confirmPlan.valid) {
      setSplitErr('总时长不足以容纳拆分休息，请减少拆分份数或缩短休息时长。')
      return
    }
    if (mode === 'interval' && confirmPlan.workDurationsMs.some((d) => d < 1000)) {
      setSplitErr('每段工作时长至少 1 秒，请减少拆分份数或缩短休息时长。')
      return
    }
    if (mode === 'fixed') {
      const startTime = formatHHmm(startHPreview, startMPreview)
      const endTime = formatHHmm(endHPreview, endMPreview)
      onConfirm({
        mode: 'fixed',
        title: title.trim() || getDefaultTitle('fixed'),
        startTime,
        time: endTime,
        ...(mainPopupThemeId ? { mainPopupThemeId } : {}),
        ...(restPopupThemeId ? { restPopupThemeId } : {}),
        weekdaysEnabled: weekdaysEnabled.slice(),
        content: content.trim() || '提醒',
        splitCount: splitN,
        restDurationSeconds: splitN > 1 && totalRestSec ? totalRestSec : undefined,
        restContent: splitN > 1 ? restContent.trim() || undefined : undefined,
      })
    } else {
      onConfirm({
        mode: 'interval',
        title: title.trim() || getDefaultTitle('interval'),
        ...(mainPopupThemeId ? { mainPopupThemeId } : {}),
        ...(restPopupThemeId ? { restPopupThemeId } : {}),
        intervalHours,
        intervalMinutes,
        intervalSeconds,
        content: content.trim() || '提醒',
        repeatCount,
        splitCount: splitN,
        restDurationSeconds: splitN > 1 && totalRestSec ? totalRestSec : undefined,
        restContent: splitN > 1 ? restContent.trim() || undefined : undefined,
      })
    }
  }

  const presetResetKey = `${open}-${layout}-${formInstanceKey}-${mode}-${variant}-${sourceItem?.id ?? 'new'}`

  const modalTitle =
    mode === 'fixed'
      ? variant === 'edit'
        ? '编辑闹钟提醒'
        : '新建闹钟提醒'
      : variant === 'edit'
        ? '编辑倒计时提醒'
        : '新建倒计时提醒'

  const timeSectionTitle = mode === 'fixed' ? '闹钟设置' : '倒计时'
  const sectionHeadingClass = 'text-sm font-medium text-slate-600 mb-4 w-full text-center'
  const formBodyClass = 'flex flex-col gap-12 overflow-visible mx-auto w-full max-w-xl items-center px-4 py-6 sm:px-6 sm:py-8'

  const formScroll = (
        <div className={formBodyClass}>
          {/* 1. 闹钟设置 / 倒计时 */}
          <section className="w-full">
            <h4 className={sectionHeadingClass}>标题</h4>
            <div className="w-full">
              <PresetTextField
                key={`title-${presetResetKey}`}
                resetKey={`title-${presetResetKey}`}
                value={title}
                onChange={setTitle}
                presets={titlePresets}
                onPresetsChange={onTitlePresetsChange}
                mainPlaceholder="请输入标题"
                autoFocusInput
              />
            </div>
          </section>

          {/* 2. 闹钟设置 / 倒计时 */}
          <section className="flex w-full flex-col items-center">
            <h4 className={sectionHeadingClass}>{timeSectionTitle}</h4>
            {mode === 'fixed' ? (
              <div className="flex w-full flex-col items-center gap-4">
                <div className="grid w-full max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="flex flex-col items-center gap-2">
                    <span className="text-xs font-medium text-slate-500">起始时间</span>
                    <div className="rounded-lg border border-slate-200 px-3 py-2">
                      <div className="inline-grid grid-cols-[auto_min-content_auto] items-end justify-items-center gap-x-2 sm:gap-x-3">
                        <span className="row-start-1 col-start-1 -translate-y-1 text-center text-xs font-medium text-slate-500">时</span>
                        <span className="row-start-1 col-start-3 -translate-y-1 text-center text-xs font-medium text-slate-500">分</span>
                        <div className="row-start-2 col-start-1 justify-self-center">
                          <WheelColumn label="" min={0} max={23} value={startH} onChange={setStartH} onLiveChange={setStartHPreview} />
                        </div>
                        <div
                          className="row-start-2 col-start-2 flex items-center justify-center select-none text-2xl font-semibold text-slate-900"
                          style={{ height: WHEEL_VIEW_H }}
                          aria-hidden
                        >
                          :
                        </div>
                        <div className="row-start-2 col-start-3 justify-self-center">
                          <WheelColumn label="" min={0} max={59} value={startM} onChange={setStartM} onLiveChange={setStartMPreview} />
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={resetStartToNow}
                      className="mt-1 inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                      title="复位到当前时间"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <polyline points="1 4 1 10 7 10" />
                        <path d="M3.51 15a9 9 0 1 0 .49-9" />
                      </svg>
                      复位
                    </button>
                  </div>
                  <div className="flex flex-col items-center gap-2">
                    <span className="text-xs font-medium text-slate-500">结束时间</span>
                    <div className="rounded-lg border border-slate-200 px-3 py-2">
                      <div className="inline-grid grid-cols-[auto_min-content_auto] items-end justify-items-center gap-x-2 sm:gap-x-3">
                        <span className="row-start-1 col-start-1 -translate-y-1 text-center text-xs font-medium text-slate-500">时</span>
                        <span className="row-start-1 col-start-3 -translate-y-1 text-center text-xs font-medium text-slate-500">分</span>
                        <div className="row-start-2 col-start-1 justify-self-center">
                          <WheelColumn label="" min={0} max={23} value={endH} onChange={setEndH} onLiveChange={setEndHPreview} />
                        </div>
                        <div
                          className="row-start-2 col-start-2 flex items-center justify-center select-none text-2xl font-semibold text-slate-900"
                          style={{ height: WHEEL_VIEW_H }}
                          aria-hidden
                        >
                          :
                        </div>
                        <div className="row-start-2 col-start-3 justify-self-center">
                          <WheelColumn label="" min={0} max={59} value={endM} onChange={setEndM} onLiveChange={setEndMPreview} />
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={resetEndToNowPlusOneMinute}
                      className="mt-1 inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                      title="复位到当前时间后 1 分钟"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <polyline points="1 4 1 10 7 10" />
                        <path d="M3.51 15a9 9 0 1 0 .49-9" />
                      </svg>
                      复位
                    </button>
                  </div>
                </div>
                {fixedRangeErr ? (
                  <p className="w-full text-center text-xs text-red-600">{fixedRangeErr}</p>
                ) : (
                  <p className="w-full text-center text-xs text-slate-400">
                    {startHPreview * 60 + startMPreview > endHPreview * 60 + endMPreview ? '该时间范围将跨天（次日结束）。' : '同日时间范围。'}
                  </p>
                )}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2 justify-center w-full">
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={intervalHours}
                  onChange={(e) => setIntervalHours(Math.max(0, Math.min(23, parseInt(e.target.value, 10) || 0)))}
                  className="w-12 rounded border border-slate-300 px-1.5 py-1.5 text-sm text-right"
                />
                <span className="text-slate-500 text-sm">时</span>
                <input
                  type="number"
                  min={0}
                  max={59}
                  value={intervalMinutes}
                  onChange={(e) => setIntervalMinutes(Math.max(0, Math.min(59, parseInt(e.target.value, 10) || 0)))}
                  className="w-12 rounded border border-slate-300 px-1.5 py-1.5 text-sm text-right"
                />
                <span className="text-slate-500 text-sm">分</span>
                <input
                  type="number"
                  min={0}
                  max={59}
                  value={intervalSeconds}
                  onChange={(e) => setIntervalSeconds(Math.max(0, Math.min(59, parseInt(e.target.value, 10) || 0)))}
                  className="w-12 rounded border border-slate-300 px-1.5 py-1.5 text-sm text-right"
                />
                <span className="text-slate-500 text-sm">秒</span>
              </div>
            )}
            {mode === 'fixed' ? (
              <p className="mt-4 w-full text-center text-xs text-slate-400">滚轮、拖拽或点击选择闹钟起始与结束时间。</p>
            ) : (
              <p className="mt-4 w-full text-center text-xs text-slate-400">请填写倒计时的时、分、秒（到点再次触发）。</p>
            )}
          </section>

          {/* 3. 提醒内容（含预设） */}
          <section className="w-full">
            <h4 className={sectionHeadingClass}>提醒内容</h4>
            <div className="flex flex-wrap items-start gap-3 w-full">
              <div className="flex-1 min-w-[12rem]">
                <PresetTextField
                  key={`content-${presetResetKey}`}
                  resetKey={presetResetKey}
                  value={content}
                  onChange={setContent}
                  presets={contentPresets}
                  onPresetsChange={onContentPresetsChange}
                  mainPlaceholder="请输入提醒内容"
                  multilineMain
                />
              </div>

              {mode === 'fixed' && (
                <div className="shrink-0 self-start">
                  <WeekdayRepeatControl
                    weekdaysEnabled={weekdaysEnabled}
                    onChange={setWeekdaysEnabled}
                  />
                </div>
              )}

              {mode === 'interval' && (
                <div className="shrink-0 self-start">
                  <RepeatCountPicker value={repeatCount} onChange={setRepeatCount} />
                </div>
              )}
            </div>
          </section>

          {/* 4. 拆分预览（静态条；保存/开始后的列表进度另算） */}
          <section className="w-full">
            <h4 className={sectionHeadingClass}>弹窗主题</h4>
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-slate-600 shrink-0">主弹窗主题</span>
                <select
                  value={mainPopupThemeId}
                  onChange={(e) => setMainPopupThemeId(e.target.value)}
                  className="min-w-[12rem] flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm"
                >
                  {mainThemeOptions.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                {onOpenThemeStudio && (
                  <button
                    type="button"
                    onClick={onOpenThemeStudio}
                    className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                  >
                    主题工坊
                  </button>
                )}
              </div>
              <div className="relative h-24 w-full overflow-hidden rounded border border-slate-200">
                {(() => {
                  const th = mainThemeOptions.find((t) => t.id === mainPopupThemeId)
                  const rawPath = ((th?.imageSourceType === 'folder' ? th?.imageFolderFiles?.[0] : th?.imagePath) ?? '').trim()
                  const imageUrl = previewImageUrlMap[rawPath] || toPreviewImageUrl(rawPath)
                  const alignItems: CSSProperties['alignItems'] =
                    th?.textAlign === 'left' ? 'flex-start' : th?.textAlign === 'right' ? 'flex-end' : 'center'
                  const bg = th?.backgroundType === 'image' && th?.imagePath
                    ? `url("${imageUrl}") center / cover no-repeat, ${th.backgroundColor || '#000'}`
                    : (th?.backgroundColor || '#000')
                  return (
                    <>
                      <div className="absolute inset-0" style={{ background: bg }} />
                      <div
                        className="absolute inset-0"
                        style={{
                          background: th?.overlayColor || '#000',
                          opacity: th?.overlayEnabled ? (th?.overlayOpacity ?? 0.45) : 0,
                        }}
                      />
                      <div
                        className="relative z-[1] flex h-full flex-col justify-center px-3"
                        style={{ textAlign: (th?.textAlign ?? 'center') as CSSProperties['textAlign'], alignItems }}
                      >
                        <div style={{ color: th?.contentColor || '#fff', fontSize: Math.min(20, th?.contentFontSize ?? 18), lineHeight: 1.25, width: '100%' }}>
                          {content.trim() || '提醒内容预览'}
                        </div>
                        <div style={{ color: th?.timeColor || '#e2e8f0', fontSize: Math.min(14, th?.timeFontSize ?? 12), width: '100%' }}>
                          12:34
                        </div>
                      </div>
                    </>
                  )
                })()}
              </div>

              {splitN > 1 && (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-slate-600 shrink-0">休息弹窗主题</span>
                    <select
                      value={restPopupThemeId}
                      onChange={(e) => setRestPopupThemeId(e.target.value)}
                      className="min-w-[12rem] flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm"
                    >
                      {restThemeOptions.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                    {onOpenThemeStudio && (
                      <button
                        type="button"
                        onClick={onOpenThemeStudio}
                        className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                      >
                        主题工坊
                      </button>
                    )}
                  </div>
                  <div className="relative h-24 w-full overflow-hidden rounded border border-slate-200">
                    {(() => {
                      const th = restThemeOptions.find((t) => t.id === restPopupThemeId)
                      const rawPath = ((th?.imageSourceType === 'folder' ? th?.imageFolderFiles?.[0] : th?.imagePath) ?? '').trim()
                      const imageUrl = previewImageUrlMap[rawPath] || toPreviewImageUrl(rawPath)
                      const alignItems: CSSProperties['alignItems'] =
                        th?.textAlign === 'left' ? 'flex-start' : th?.textAlign === 'right' ? 'flex-end' : 'center'
                      const bg = th?.backgroundType === 'image' && th?.imagePath
                        ? `url("${imageUrl}") center / cover no-repeat, ${th.backgroundColor || '#000'}`
                        : (th?.backgroundColor || '#000')
                      return (
                        <>
                          <div className="absolute inset-0" style={{ background: bg }} />
                          <div
                            className="absolute inset-0"
                            style={{
                              background: th?.overlayColor || '#000',
                              opacity: th?.overlayEnabled ? (th?.overlayOpacity ?? 0.45) : 0,
                            }}
                          />
                          <div
                            className="relative z-[1] flex h-full flex-col justify-center px-3"
                            style={{ textAlign: (th?.textAlign ?? 'center') as CSSProperties['textAlign'], alignItems }}
                          >
                            <div style={{ color: th?.contentColor || '#fff', fontSize: Math.min(20, th?.contentFontSize ?? 18), lineHeight: 1.25, width: '100%' }}>
                              {restContent.trim() || '休息一下'}
                            </div>
                            <div style={{ color: th?.timeColor || '#e2e8f0', fontSize: Math.min(14, th?.timeFontSize ?? 12), width: '100%' }}>
                              12:34
                            </div>
                            <div style={{ color: th?.countdownColor || '#fff', fontSize: Math.min(20, th?.countdownFontSize ?? 18), fontWeight: 700, width: '100%' }}>
                              5
                            </div>
                          </div>
                        </>
                      )
                    })()}
                  </div>
                </>
              )}
            </div>
          </section>

          {/* 5. 拆分预览（静态条；保存/开始后的列表进度另算） */}
          <section className="w-full">
            <h4 className={sectionHeadingClass}>拆分预览</h4>
            <div className="w-full flex items-center gap-1.5 flex-wrap min-h-[1rem]">
              {useSplit && segments.length > 0 ? (
                segments.map((seg, i) => (
                  <StaticSplitPreviewSegment
                    key={i}
                    durationMs={seg.durationMs}
                    fillClass={seg.type === 'work' ? 'bg-green-500' : 'bg-blue-500'}
                  />
                ))
              ) : (
                <StaticSinglePreviewBar totalDurationMs={Math.max(0, totalSpanMs)} />
              )}
            </div>
          </section>

          {/* 6. 拆分配置 */}
          <section className="w-full">
            <h4 className={sectionHeadingClass}>拆分配置</h4>
            <div className="flex w-full flex-col items-center space-y-5">
              <div className="flex items-center justify-center gap-2">
                <span className="shrink-0 text-sm text-slate-600">拆分</span>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={splitCount}
                  onChange={(e) => setSplitCount(Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1)))}
                  className="w-16 rounded border border-slate-300 px-2 py-1 text-center text-sm"
                />
                <span className="shrink-0 text-sm text-slate-600">份</span>
              </div>
              {splitN > 1 && (
                <>
                  <div className="flex w-full flex-col items-center gap-2">
                    <span className="text-center text-sm text-slate-600">休息时长</span>
                    <div className="flex flex-wrap items-center justify-center gap-1.5">
                      <input
                        type="number"
                        min={0}
                        max={23}
                        value={restH}
                        onChange={(e) => handleRestChange(Math.max(0, Math.min(23, parseInt(e.target.value, 10) || 0)), restM, restS)}
                        className="w-14 rounded border border-slate-300 px-2 py-1 text-center text-sm"
                      />
                      <span className="text-sm text-slate-500">时</span>
                      <input
                        type="number"
                        min={0}
                        max={59}
                        value={restM}
                        onChange={(e) => handleRestChange(restH, Math.max(0, Math.min(59, parseInt(e.target.value, 10) || 0)), restS)}
                        className="w-14 rounded border border-slate-300 px-2 py-1 text-center text-sm"
                      />
                      <span className="text-sm text-slate-500">分</span>
                      <input
                        type="number"
                        min={0}
                        max={59}
                        value={restS}
                        onChange={(e) => handleRestChange(restH, restM, Math.max(0, Math.min(59, parseInt(e.target.value, 10) || 0)))}
                        className="w-14 rounded border border-slate-300 px-2 py-1 text-center text-sm"
                      />
                      <span className="text-sm text-slate-500">秒</span>
                    </div>
                  </div>
                  <div className="flex w-full flex-col items-center gap-2">
                    <span className="text-center text-sm text-slate-600">休息弹窗文案</span>
                    <div className="w-full">
                      <PresetTextField
                        key={`rest-${presetResetKey}`}
                        resetKey={presetResetKey}
                        value={restContent}
                        onChange={setRestContent}
                        presets={restPresets}
                        onPresetsChange={onRestPresetsChange}
                        mainPlaceholder="请输入休息提示语"
                        multilineMain
                      />
                    </div>
                  </div>
                </>
              )}
              {splitErr && <p className="text-center text-xs text-red-600">{splitErr}</p>}
            </div>
          </section>
        </div>
  )

  const formFooter = (
        <div className="flex w-full shrink-0 flex-col items-center gap-4 border-t border-slate-200 bg-slate-50 px-4 py-4">
          <p className="text-xs text-slate-400 text-center w-full">
            {variant === 'edit' ? '点击更新后立即生效。' : '点击开始后立即生效。'}
          </p>
          <div className="flex justify-center gap-3 w-full">
            <button
              type="button"
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 min-w-[88px]"
              onClick={onClose}
            >
              取消
            </button>
            <button
              type="button"
              disabled={mode === 'fixed' && !!fixedRangeErr}
              className="rounded-lg bg-slate-800 text-white px-4 py-2 text-sm font-medium hover:bg-slate-700 min-w-[88px] disabled:cursor-not-allowed disabled:opacity-50"
              onClick={handleStart}
            >
              {variant === 'edit' ? '更新' : '开始'}
            </button>
          </div>
        </div>
  )

  if (layout === 'embedded') {
    return (
      <div className="flex w-full flex-col overflow-visible rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="shrink-0 border-b border-slate-200 bg-slate-50/95 px-4 py-2.5 text-center text-sm font-medium text-slate-800">{modalTitle}</div>
        <div className="flex flex-col overflow-visible">
          {formScroll}
          {formFooter}
        </div>
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 z-[200000] flex items-start justify-center overflow-y-auto bg-black/40 p-4 py-8"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-5xl flex-col overflow-visible rounded-xl bg-white shadow-xl"
        style={{ maxWidth: 'min(1024px, 100vw - 2rem)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative flex min-h-[48px] items-center justify-center border-b border-slate-200 px-4 py-3">
          <h3 className="w-full text-center font-medium text-slate-800 px-10">{modalTitle}</h3>
          <button
            type="button"
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-xl leading-none text-slate-400 hover:text-slate-600"
            onClick={onClose}
            aria-label="关闭"
          >
            ×
          </button>
        </div>
        {formScroll}
        {formFooter}
      </div>
    </div>
  )
}
