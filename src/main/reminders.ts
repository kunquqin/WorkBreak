import { getSettings, setSettings } from './settings'
import type { ReminderCategory, SubReminder } from './settings'
import type { ResetIntervalPayload, PopupTheme } from '../shared/settings'
import { showReminderPopup, showRestEndCountdownPopup } from './reminderWindow'
import { buildSplitSchedule } from '../shared/splitSchedule'

const REMINDER_LOG = true
function reminderLog(...args: unknown[]) {
  if (REMINDER_LOG) console.log('[WorkBreak][Reminder]', ...args)
}

function autoDisableByKey(key: string) {
  const s = getSettings()
  for (const cat of s.reminderCategories) {
    for (const item of cat.items) {
      if (`${cat.id}_${item.id}` === key && item.mode !== 'stopwatch' && item.enabled !== false) {
        item.enabled = false
        setSettings({ reminderCategories: s.reminderCategories })
        reminderLog('自动关闭已结束子项', { key })
        return
      }
    }
  }
}

let fixedMinuteTimeout: ReturnType<typeof setTimeout> | null = null
const intervalTimerKeys: string[] = []
const intervalTimeouts = new Map<string, ReturnType<typeof setTimeout>>()
interface IntervalCompletedState {
  completedAt: number
  repeatCount: number
  firedCount: number
  splitCount: number
  segmentDurationMs: number
  workDurationsMs: number[]
  restDurationMs: number
  cycleTotalMs: number
}
interface IntervalState {
  startTime: number
  firedCount: number
  intervalMs: number
  repeatCount: number | null
  categoryName: string
  content: string
  /** 拆分份数，1 表示不拆分 */
  splitCount: number
  /** 每段工作时长（毫秒） */
  segmentDurationMs: number
  /** 每段工作时长列表（支持余数分配） */
  workDurationsMs: number[]
  /** 中间休息时长（毫秒），0 表示无 */
  restDurationMs: number
  /** 整轮总时长（工作+休息） */
  cycleTotalMs: number
  /** 休息弹窗文案 */
  restContent: string
  mainPopupThemeId?: string
  restPopupThemeId?: string
  /** 当前阶段 work | rest */
  phase: 'work' | 'rest'
  /** 当前阶段索引 */
  phaseIndex: number
  /** 当前阶段开始时间戳 */
  phaseStartTime: number
}
const intervalState = new Map<string, IntervalState>()
const intervalCompletedState = new Map<string, IntervalCompletedState>()
/** 休息结束倒计时弹窗的 setTimeout 句柄，随休息段生命周期清理 */
const restEndCountdownTimeouts = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * fixed 单次触发（weekdaysEnabled 全 false）状态
 * 语义：允许触发“下一次”一次后自动停止，不再进入下一周期。
 */
const fixedSingleShotState = new Map<
  string,
  { signature: string; fired: boolean; stoppedAtMs: number | null }
>()
/** fixed 拆分休息弹窗去重：同一周期同一休息段仅触发一次 */
const fixedRestBreakState = new Map<
  string,
  { signature: string; firedBreakIndexes: Set<number>; countdownFiredIndexes: Set<number> }
>()
/** fixed 休息开始弹窗的 setTimeout 句柄 */
const fixedRestBreakTimeouts = new Map<string, ReturnType<typeof setTimeout>>()
/** fixed 休息结束倒计时的 setTimeout 句柄 */
const fixedRestEndCountdownTimeouts = new Map<string, ReturnType<typeof setTimeout>>()
/** 新建/重置时记录精确毫秒起点，用于进度条消除秒级偏差 */
const fixedPreciseStartAt = new Map<string, number>()

function resolvePopupThemeById(themeId: string | undefined, target: 'main' | 'rest'): PopupTheme | undefined {
  const s = getSettings()
  const all = s.popupThemes ?? []
  if (themeId) {
    const matched = all.find((t) => t.id === themeId)
    if (matched) return matched
  }
  return all.find((t) => t.target === target)
}

function showReminder(title: string, body: string, theme?: PopupTheme) {
  const now = new Date()
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  reminderLog('弹窗', { title, bodyPreview: (body || '').slice(0, 40), timeStr })
  showReminderPopup({ title, body, timeStr, ...(theme ? { theme } : {}) })
}

function parseTimeHHmm(hhmm: string): { h: number; m: number } {
  const [h, m] = hhmm.split(':').map(Number)
  return { h: h ?? 0, m: m ?? 0 }
}

function isSameMinute(now: Date, h: number, m: number): boolean {
  return now.getHours() === h && now.getMinutes() === m
}

function isValidTimeHHmm(hhmm: string | undefined): hhmm is string {
  if (!hhmm) return false
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(hhmm.trim())
  if (!m) return false
  const h = Number(m[1])
  const mm = Number(m[2])
  return Number.isFinite(h) && Number.isFinite(mm) && h >= 0 && h <= 23 && mm >= 0 && mm <= 59
}

function getWindowDurationMs(startTime: string, endTime: string): number {
  const s = parseTimeHHmm(startTime)
  const e = parseTimeHHmm(endTime)
  const sMin = s.h * 60 + s.m
  const eMin = e.h * 60 + e.m
  if (sMin === eMin) return 0
  const deltaMin = eMin > sMin ? (eMin - sMin) : (24 * 60 - sMin + eMin)
  return deltaMin * 60 * 1000
}

function getStartDayEnabled(weekdaysEnabled: boolean[] | undefined, startDay: number): boolean {
  if (!Array.isArray(weekdaysEnabled) || weekdaysEnabled.length !== 7) return true
  return Boolean(weekdaysEnabled[startDay])
}

function getFixedSingleShotSignature(startTime: string, endTime: string, weekdaysEnabled: boolean[] | undefined): string {
  const wd = Array.isArray(weekdaysEnabled) && weekdaysEnabled.length === 7
    ? weekdaysEnabled.map((x) => (x ? '1' : '0')).join('')
    : 'no-mask'
  return `single|${startTime}|${endTime}|${wd}`
}

type FixedWindowState = 'pending' | 'running' | 'ended'
type FixedWindowContext = {
  state: FixedWindowState
  windowStartAt: number
  windowEndAt: number
  nextAt: number
  remainingMs: number
  singleShot: boolean
}

function toDayStart(ms: number): Date {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)
}

function getWindowStartAtByOffset(dayStartMs: number, dayOffset: number, startTime: string): number {
  const { h, m } = parseTimeHHmm(startTime)
  const d = new Date(dayStartMs)
  d.setDate(d.getDate() + dayOffset)
  d.setHours(h, m, 0, 0)
  return d.getTime()
}

function getFixedWindowContext(
  key: string,
  startTime: string,
  endTime: string,
  weekdaysEnabled: boolean[] | undefined,
  nowMs: number,
): FixedWindowContext {
  const durationMs = Math.max(1, getWindowDurationMs(startTime, endTime))
  const hasMask = Array.isArray(weekdaysEnabled) && weekdaysEnabled.length === 7
  const anyOn = hasMask ? weekdaysEnabled.some(Boolean) : true
  const singleShot = hasMask && !anyOn
  const dayStart = toDayStart(nowMs).getTime()
  const signature = getFixedSingleShotSignature(startTime, endTime, weekdaysEnabled)

  if (singleShot) {
    const st = fixedSingleShotState.get(key)
    if (st && st.signature === signature && st.fired) {
      const stopped = st.stoppedAtMs ?? nowMs
      return {
        state: 'ended',
        windowStartAt: stopped,
        windowEndAt: stopped,
        nextAt: stopped,
        remainingMs: 0,
        singleShot: true,
      }
    }
    const startToday = getWindowStartAtByOffset(dayStart, 0, startTime)
    const startYesterday = getWindowStartAtByOffset(dayStart, -1, startTime)
    const endToday = startToday + durationMs
    const endYesterday = startYesterday + durationMs
    if (nowMs >= startToday && nowMs < endToday) {
      return {
        state: 'running',
        windowStartAt: startToday,
        windowEndAt: endToday,
        nextAt: endToday,
        remainingMs: Math.max(0, endToday - nowMs),
        singleShot: true,
      }
    }
    if (nowMs >= startYesterday && nowMs < endYesterday) {
      return {
        state: 'running',
        windowStartAt: startYesterday,
        windowEndAt: endYesterday,
        nextAt: endYesterday,
        remainingMs: Math.max(0, endYesterday - nowMs),
        singleShot: true,
      }
    }
    let nextStart = startToday
    if (nowMs >= endToday) nextStart = getWindowStartAtByOffset(dayStart, 1, startTime)
    const nextEnd = nextStart + durationMs
    return {
      state: 'pending',
      windowStartAt: nextStart,
      windowEndAt: nextEnd,
      nextAt: nextEnd,
      remainingMs: Math.max(0, nextEnd - nowMs),
      singleShot: true,
    }
  }

  const runningCandidates = [-1, 0]
    .map((offset) => {
      const startAt = getWindowStartAtByOffset(dayStart, offset, startTime)
      const day = new Date(startAt).getDay()
      if (!getStartDayEnabled(weekdaysEnabled, day)) return null
      const endAt = startAt + durationMs
      if (nowMs >= startAt && nowMs < endAt) return { startAt, endAt }
      return null
    })
    .filter((x): x is { startAt: number; endAt: number } => x !== null)
    .sort((a, b) => b.startAt - a.startAt)
  if (runningCandidates.length > 0) {
    const cur = runningCandidates[0]
    return {
      state: 'running',
      windowStartAt: cur.startAt,
      windowEndAt: cur.endAt,
      nextAt: cur.endAt,
      remainingMs: Math.max(0, cur.endAt - nowMs),
      singleShot: false,
    }
  }

  for (let dayOffset = 0; dayOffset < 370; dayOffset++) {
    const startAt = getWindowStartAtByOffset(dayStart, dayOffset, startTime)
    if (startAt <= nowMs) continue
    const day = new Date(startAt).getDay()
    if (!getStartDayEnabled(weekdaysEnabled, day)) continue
    const endAt = startAt + durationMs
    return {
      state: 'pending',
      windowStartAt: startAt,
      windowEndAt: endAt,
      nextAt: endAt,
      remainingMs: Math.max(0, endAt - nowMs),
      singleShot: false,
    }
  }

  const fallbackStart = getWindowStartAtByOffset(dayStart, 1, startTime)
  const fallbackEnd = fallbackStart + durationMs
  return {
    state: 'pending',
    windowStartAt: fallbackStart,
    windowEndAt: fallbackEnd,
    nextAt: fallbackEnd,
    remainingMs: Math.max(0, fallbackEnd - nowMs),
    singleShot: false,
  }
}

/** 到整分时检查所有固定时间子提醒（支持起始/结束时间窗口与跨天） */
function runFixedTimeCheck() {
  const s = getSettings()
  const now = new Date()
  const nowMs = now.getTime()
  for (const cat of s.reminderCategories) {
    for (const item of cat.items) {
      if (item.mode !== 'fixed') continue
      if (item.enabled === false) continue
      const key = `${cat.id}_${item.id}`
      const endTime = isValidTimeHHmm(item.time) ? item.time : '00:00'
      const startTime = isValidTimeHHmm(item.startTime) ? item.startTime : endTime
      const durationMs = getWindowDurationMs(startTime, endTime)
      if (durationMs <= 0) continue
      const context = getFixedWindowContext(key, startTime, endTime, item.weekdaysEnabled, nowMs)

      // fixed 拆分休息段弹窗：到达每段工作结束点时触发一次休息提示
      const splitCount = Math.max(1, Math.min(10, item.splitCount ?? 1))
      const restDurationMs = Math.max(0, item.restDurationSeconds ?? 0) * 1000
      if (context.state !== 'ended' && splitCount > 1 && restDurationMs > 0) {
        const cycleStartAt = context.windowStartAt
        const cycleSpanMs = Math.max(1, context.windowEndAt - context.windowStartAt)
        const plan = buildSplitSchedule(cycleSpanMs, splitCount, restDurationMs)
        if (plan.workDurationsMs.length <= 1) continue
        const cycleSignature = `fixed-rest|${startTime}|${endTime}|${splitCount}|${restDurationMs}|${cycleStartAt}`
        const prev = fixedRestBreakState.get(key)
        if (!prev || prev.signature !== cycleSignature) {
          clearFixedRestTimersByKey(key)
          fixedRestBreakState.set(key, { signature: cycleSignature, firedBreakIndexes: new Set<number>(), countdownFiredIndexes: new Set<number>() })
        }
        const cur = fixedRestBreakState.get(key)!
        const restSec = Math.round(restDurationMs / 1000)
        const countdownSec = Math.min(5, restSec)
        let workAccMs = 0
        for (let i = 0; i < plan.workDurationsMs.length - 1; i++) {
          workAccMs += plan.workDurationsMs[i]
          const restStartMs = workAccMs + i * restDurationMs
          const restStartAt = cycleStartAt + restStartMs
          const restEndAt = restStartAt + restDurationMs
          const timeoutKey = `${key}_${i}`

          const fireRestBreak = () => {
            const latest = fixedRestBreakState.get(key)
            if (!latest || latest.signature !== cycleSignature || latest.firedBreakIndexes.has(i)) return
            reminderLog('固定时间·休息段弹窗', { key, phaseIndex: i })
              showReminder(cat.name, item.restContent ?? '休息一下', resolvePopupThemeById(item.restPopupThemeId, 'rest'))
            latest.firedBreakIndexes.add(i)
          }
          if (!cur.firedBreakIndexes.has(i)) {
            if (nowMs >= restStartAt && nowMs < restEndAt) {
              fireRestBreak()
              const t = fixedRestBreakTimeouts.get(timeoutKey)
              if (t) {
                clearTimeout(t)
                fixedRestBreakTimeouts.delete(timeoutKey)
              }
            } else if (nowMs < restStartAt) {
              if (!fixedRestBreakTimeouts.has(timeoutKey)) {
                const t = setTimeout(() => {
                  fireRestBreak()
                  fixedRestBreakTimeouts.delete(timeoutKey)
                }, restStartAt - nowMs)
                fixedRestBreakTimeouts.set(timeoutKey, t)
              }
            } else {
              cur.firedBreakIndexes.add(i)
            }
          }

          if (countdownSec >= 1 && !cur.countdownFiredIndexes.has(i)) {
            const countdownAt = restEndAt - countdownSec * 1000
            const fireRestCountdown = () => {
              const latest = fixedRestBreakState.get(key)
              if (!latest || latest.signature !== cycleSignature || latest.countdownFiredIndexes.has(i)) return
              reminderLog('固定时间·休息结束倒计时', { key, phaseIndex: i, countdownSec })
              showRestEndCountdownPopup(countdownSec)
              latest.countdownFiredIndexes.add(i)
            }
            if (nowMs >= countdownAt && nowMs < restEndAt) {
              fireRestCountdown()
              const t = fixedRestEndCountdownTimeouts.get(timeoutKey)
              if (t) {
                clearTimeout(t)
                fixedRestEndCountdownTimeouts.delete(timeoutKey)
              }
            } else if (nowMs < countdownAt) {
              if (!fixedRestEndCountdownTimeouts.has(timeoutKey)) {
                const t = setTimeout(() => {
                  fireRestCountdown()
                  fixedRestEndCountdownTimeouts.delete(timeoutKey)
                }, countdownAt - nowMs)
                fixedRestEndCountdownTimeouts.set(timeoutKey, t)
              }
            } else {
              cur.countdownFiredIndexes.add(i)
            }
          }
        }
      } else {
        fixedRestBreakState.delete(key)
        clearFixedRestTimersByKey(key)
      }

      const endDate = new Date(context.windowEndAt)
      if (!isSameMinute(now, endDate.getHours(), endDate.getMinutes())) continue
      if (context.state === 'ended') continue
      if (context.singleShot) {
        const signature = getFixedSingleShotSignature(startTime, endTime, item.weekdaysEnabled)
        const st = fixedSingleShotState.get(key)
        if (st?.signature === signature && st.fired) continue
        fixedSingleShotState.set(key, { signature, fired: true, stoppedAtMs: nowMs })
        reminderLog('固定时间（单次）整分触发', { key, startTime, endTime, cat: cat.name })
        autoDisableByKey(key)
      } else {
        reminderLog('固定时间整分触发', { key, startTime, endTime, cat: cat.name })
      }
      showReminder(cat.name, item.content || '提醒', resolvePopupThemeById(item.mainPopupThemeId, 'main'))
    }
  }
}

/** 单条整分对齐的 timeout 链，覆盖所有 fixed 项 */
function scheduleFixedTimeReminders() {
  if (fixedMinuteTimeout) {
    clearTimeout(fixedMinuteTimeout)
    fixedMinuteTimeout = null
  }
  function runAtNextMinute() {
    const now = new Date()
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes() + 1, 0, 0)
    const ms = next.getTime() - now.getTime()
    fixedMinuteTimeout = setTimeout(() => {
      runFixedTimeCheck()
      runAtNextMinute()
    }, Math.max(0, ms))
  }
  runFixedTimeCheck()
  runAtNextMinute()
}

function clearRestEndCountdown(key: string) {
  const t = restEndCountdownTimeouts.get(key)
  if (t) clearTimeout(t)
  restEndCountdownTimeouts.delete(key)
}

function getWorkDurationMs(st: IntervalState, phaseIndex: number): number {
  if (phaseIndex < 0) return 0
  return st.workDurationsMs[phaseIndex] ?? st.segmentDurationMs
}

/**
 * 休息结束前弹出倒计时弹窗。
 * countdownSec = min(5, restDurationSec)，在休息段最后 countdownSec 秒时触发。
 */
function scheduleRestEndCountdown(key: string, restDurationMs: number) {
  clearRestEndCountdown(key)
  const restSec = Math.round(restDurationMs / 1000)
  if (restSec < 1) return
  const countdownSec = Math.min(5, restSec)
  const delayMs = restDurationMs - countdownSec * 1000
  const fireCountdown = () => {
    reminderLog('休息结束倒计时弹窗', { key, countdownSec })
    showRestEndCountdownPopup(countdownSec)
    restEndCountdownTimeouts.delete(key)
  }
  if (delayMs <= 0) {
    fireCountdown()
    return
  }
  const t = setTimeout(fireCountdown, delayMs)
  restEndCountdownTimeouts.set(key, t)
}

function scheduleNextPhase(key: string) {
  const st = intervalState.get(key)
  if (!st) return
  const now = Date.now()

  if (st.phase === 'work') {
    if (st.phaseIndex < st.splitCount - 1) {
      // 本段工作结束，进入休息（若休息>0）
      if (st.restDurationMs > 0) {
        reminderLog('间隔·休息段弹窗', { key, phaseIndex: st.phaseIndex })
        showReminder(st.categoryName, st.restContent || '休息一下', resolvePopupThemeById(st.restPopupThemeId, 'rest'))
        st.phase = 'rest'
        st.phaseStartTime = now
        const t = setTimeout(() => scheduleNextPhase(key), st.restDurationMs)
        intervalTimeouts.set(key, t)
        scheduleRestEndCountdown(key, st.restDurationMs)
      } else {
        st.phaseIndex++
        st.phaseStartTime = now
        const nextWorkMs = getWorkDurationMs(st, st.phaseIndex)
        const t = setTimeout(() => scheduleNextPhase(key), nextWorkMs)
        intervalTimeouts.set(key, t)
      }
      return
    }
    // 最后一段工作结束 → 主提醒，新一轮
    reminderLog('间隔·主提醒', {
      key,
      firedCount: st.firedCount + 1,
      nextSegmentMs: st.segmentDurationMs,
      intervalMs: st.intervalMs,
    })
    showReminder(st.categoryName, st.content, resolvePopupThemeById(st.mainPopupThemeId, 'main'))
    st.firedCount++
    st.startTime = now
    st.phaseIndex = 0
    st.phase = 'work'
    st.phaseStartTime = now
    if (st.repeatCount !== null && st.firedCount >= st.repeatCount) {
      intervalCompletedState.set(key, {
        completedAt: now,
        repeatCount: st.repeatCount,
        firedCount: st.firedCount,
        splitCount: st.splitCount,
        segmentDurationMs: st.segmentDurationMs,
        workDurationsMs: st.workDurationsMs.slice(),
        restDurationMs: st.restDurationMs,
        cycleTotalMs: st.cycleTotalMs,
      })
      const t = intervalTimeouts.get(key)
      if (t) clearTimeout(t)
      intervalTimeouts.delete(key)
      intervalState.delete(key)
      const i = intervalTimerKeys.indexOf(key)
      if (i >= 0) intervalTimerKeys.splice(i, 1)
      autoDisableByKey(key)
      return
    }
    const firstWorkMs = getWorkDurationMs(st, 0)
    const t = setTimeout(() => scheduleNextPhase(key), firstWorkMs)
    intervalTimeouts.set(key, t)
    return
  }

  // phase === 'rest' 结束，进入下一段工作
  clearRestEndCountdown(key)
  st.phase = 'work'
  st.phaseIndex++
  st.phaseStartTime = now
  const workMs = getWorkDurationMs(st, st.phaseIndex)
  const t = setTimeout(() => scheduleNextPhase(key), workMs)
  intervalTimeouts.set(key, t)
}

/** 从旧 state 计算本周期内已过时间（毫秒） */
function getElapsedInCycle(st: IntervalState, now: number): number {
  const elapsedBeforePhase = (() => {
    let acc = 0
    for (let i = 0; i < st.phaseIndex; i++) {
      acc += getWorkDurationMs(st, i)
      if (st.restDurationMs > 0) acc += st.restDurationMs
    }
    return acc
  })()
  if (st.phase === 'work') {
    return elapsedBeforePhase + (now - st.phaseStartTime)
  }
  return elapsedBeforePhase + getWorkDurationMs(st, st.phaseIndex) + (now - st.phaseStartTime)
}

/** 根据已过时间推算应处的 phase、phaseIndex、phaseStartTime，并返回当前阶段剩余 ms */
function placeElapsedInNewCycle(
  elapsedMs: number,
  workDurationsMs: number[],
  restDurationMs: number,
  now: number
): { phase: 'work' | 'rest'; phaseIndex: number; phaseStartTime: number; remainingInPhaseMs: number } {
  let acc = 0
  for (let i = 0; i < workDurationsMs.length; i++) {
    const workMs = workDurationsMs[i]
    if (elapsedMs < acc + workMs) {
      const elapsedInPhase = elapsedMs - acc
      return {
        phase: 'work',
        phaseIndex: i,
        phaseStartTime: now - elapsedInPhase,
        remainingInPhaseMs: workMs - elapsedInPhase,
      }
    }
    acc += workMs
    if (restDurationMs > 0) {
      if (elapsedMs < acc + restDurationMs) {
        const elapsedInPhase = elapsedMs - acc
        return {
          phase: 'rest',
          phaseIndex: i,
          phaseStartTime: now - elapsedInPhase,
          remainingInPhaseMs: restDurationMs - elapsedInPhase,
        }
      }
      acc += restDurationMs
    }
  }
  return {
    phase: 'work',
    phaseIndex: 0,
    phaseStartTime: now,
    remainingInPhaseMs: workDurationsMs[0] ?? 0,
  }
}

function scheduleIntervalReminders() {
  const now = Date.now()
  const prevState = new Map(intervalState)
  for (const key of intervalTimerKeys) {
    const t = intervalTimeouts.get(key)
    if (t) clearTimeout(t)
    intervalTimeouts.delete(key)
    intervalState.delete(key)
  }
  intervalTimerKeys.length = 0

  const s = getSettings()
  for (const cat of s.reminderCategories) {
    for (const item of cat.items) {
      if (item.mode !== 'interval') continue
      if (item.enabled === false) {
        intervalCompletedState.delete(`${cat.id}_${item.id}`)
        continue
      }
      const h = item.intervalHours ?? 0
      const m = item.intervalMinutes ?? 0
      const sec = item.intervalSeconds ?? 0
      const totalSec = Math.max(1, h * 3600 + m * 60 + sec)
      const intervalMs = totalSec * 1000
      const repeatCount = item.repeatCount ?? null
      const splitCount = Math.max(1, Math.min(10, item.splitCount ?? 1))
      const restSec = Math.max(0, item.restDurationSeconds ?? 0)
      const restDurationMs = restSec * 1000
      const plan = buildSplitSchedule(intervalMs, splitCount, restDurationMs)
      const effectiveSplitCount = plan.workDurationsMs.length
      const effectiveRestMs = effectiveSplitCount > 1 ? restDurationMs : 0
      const segmentDurationMs = plan.workDurationsMs[0] ?? intervalMs
      const key = `${cat.id}_${item.id}`
      intervalCompletedState.delete(key)
      const oldSt = prevState.get(key)
      const newCycleTotalMs = plan.cycleTotalMs
      let phase: 'work' | 'rest' = 'work'
      let phaseIndex = 0
      let phaseStartTime = now
      let timeoutMs = segmentDurationMs
      if (oldSt && oldSt.intervalMs === intervalMs) {
        const oldElapsed = getElapsedInCycle(oldSt, now)
        const newElapsed = Math.min(oldElapsed, newCycleTotalMs)
        const placed = placeElapsedInNewCycle(newElapsed, plan.workDurationsMs, effectiveRestMs, now)
        phase = placed.phase
        phaseIndex = placed.phaseIndex
        phaseStartTime = placed.phaseStartTime
        timeoutMs = Math.max(0, Math.floor(placed.remainingInPhaseMs))
      }
      const state: IntervalState = {
        startTime: now,
        firedCount: oldSt?.firedCount ?? 0,
        intervalMs,
        repeatCount,
        categoryName: cat.name,
        content: item.content || '提醒',
        mainPopupThemeId: item.mainPopupThemeId,
        restPopupThemeId: item.restPopupThemeId,
        splitCount: effectiveSplitCount,
        segmentDurationMs,
        workDurationsMs: plan.workDurationsMs.slice(),
        restDurationMs: effectiveRestMs,
        cycleTotalMs: plan.cycleTotalMs,
        restContent: item.restContent ?? '休息一下',
        phase,
        phaseIndex,
        phaseStartTime,
      }
      intervalState.set(key, state)
      const timer = setTimeout(() => scheduleNextPhase(key), timeoutMs)
      intervalTimeouts.set(key, timer)
      intervalTimerKeys.push(key)
    }
  }
}

export function startReminders() {
  scheduleFixedTimeReminders()
  scheduleIntervalReminders()
  // 立即执行一次：用于补齐 fixed 拆分休息段的秒级预调度，避免首次整分前漏掉休息弹窗。
  runFixedTimeCheck()
}

export function stopReminders() {
  if (fixedMinuteTimeout) {
    clearTimeout(fixedMinuteTimeout)
    fixedMinuteTimeout = null
  }
  for (const key of intervalTimerKeys) {
    const t = intervalTimeouts.get(key)
    if (t) clearTimeout(t)
  }
  intervalTimeouts.clear()
  for (const t of restEndCountdownTimeouts.values()) clearTimeout(t)
  restEndCountdownTimeouts.clear()
  for (const t of fixedRestBreakTimeouts.values()) clearTimeout(t)
  fixedRestBreakTimeouts.clear()
  for (const t of fixedRestEndCountdownTimeouts.values()) clearTimeout(t)
  fixedRestEndCountdownTimeouts.clear()
  intervalState.clear()
  intervalCompletedState.clear()
  intervalTimerKeys.length = 0
}

export function restartReminders() {
  stopReminders()
  startReminders()
}

function removeIntervalTimerByKey(key: string): void {
  const t = intervalTimeouts.get(key)
  if (t) clearTimeout(t)
  intervalTimeouts.delete(key)
  clearRestEndCountdown(key)
  intervalState.delete(key)
  intervalCompletedState.delete(key)
  const i = intervalTimerKeys.indexOf(key)
  if (i >= 0) intervalTimerKeys.splice(i, 1)
}

function buildIntervalPayload(cat: ReminderCategory, item: SubReminder & { mode: 'interval' }): ResetIntervalPayload {
  return {
    categoryName: cat.name,
    content: item.content || '提醒',
    mainPopupThemeId: item.mainPopupThemeId,
    restPopupThemeId: item.restPopupThemeId,
    intervalHours: item.intervalHours,
    intervalMinutes: item.intervalMinutes,
    intervalSeconds: item.intervalSeconds,
    repeatCount: item.repeatCount ?? null,
    splitCount: item.splitCount,
    restDurationSeconds: item.restDurationSeconds,
    restContent: item.restContent,
  }
}

/** 与「仅改文案」区分：这些变了必须按新配置重排 setTimeout */
function intervalTimingSignature(item: SubReminder & { mode: 'interval' }): string {
  const h = item.intervalHours ?? 0
  const m = item.intervalMinutes ?? 0
  const s = item.intervalSeconds ?? 0
  const split = Math.max(1, Math.min(10, item.splitCount ?? 1))
  const rest = Math.max(0, item.restDurationSeconds ?? 0)
  return `${h}|${m}|${s}|${split}|${rest}`
}

/**
 * setSettings 写入磁盘后调用：让内存中的倒计时候选与配置一致。
 * 自动保存不会调 restartReminders；若用户已把间隔从 1 分钟改成 15 分钟，此处会 reset 该条，避免仍按旧间隔每分钟弹窗。
 */
export function syncIntervalTimersAfterSettingsChange(
  prevCategories: ReminderCategory[],
  nextCategories: ReminderCategory[],
): void {
  const prevMap = new Map<string, { cat: ReminderCategory; item: SubReminder & { mode: 'interval' } }>()
  for (const cat of prevCategories) {
    for (const item of cat.items) {
      if (item.mode !== 'interval') continue
      prevMap.set(`${cat.id}_${item.id}`, { cat, item: item as SubReminder & { mode: 'interval' } })
    }
  }
  const nextKeys = new Set<string>()
  for (const cat of nextCategories) {
    for (const item of cat.items) {
      if (item.mode !== 'interval') continue
      const iv = item as SubReminder & { mode: 'interval' }
      const key = `${cat.id}_${item.id}`
      nextKeys.add(key)
      const prevEntry = prevMap.get(key)
      if (!prevEntry) {
        reminderLog('syncInterval: 新子项', { key })
        if (iv.enabled === false) {
          removeIntervalTimerByKey(key)
          continue
        }
        resetReminderProgress(key, buildIntervalPayload(cat, iv))
        continue
      }
      const prevEnabled = prevEntry.item.enabled !== false
      const nextEnabled = iv.enabled !== false
      if (!nextEnabled) {
        removeIntervalTimerByKey(key)
        continue
      }
      if (!prevEnabled && nextEnabled) {
        resetReminderProgress(key, buildIntervalPayload(cat, iv))
        continue
      }
      if (intervalTimingSignature(prevEntry.item) !== intervalTimingSignature(iv)) {
        reminderLog('syncInterval: 时长/拆分变更，重排', {
          key,
          prev: intervalTimingSignature(prevEntry.item),
          next: intervalTimingSignature(iv),
        })
        resetReminderProgress(key, buildIntervalPayload(cat, iv))
        continue
      }
      const st = intervalState.get(key)
      if (st) {
        st.content = iv.content || '提醒'
        st.categoryName = cat.name
        st.repeatCount = iv.repeatCount ?? null
        st.restContent = iv.restContent ?? '休息一下'
        st.mainPopupThemeId = iv.mainPopupThemeId
        st.restPopupThemeId = iv.restPopupThemeId
      }
    }
  }
  for (const key of [...intervalTimerKeys]) {
    if (nextKeys.has(key)) continue
    reminderLog('syncInterval: 删除子项，清定时器', { key })
    removeIntervalTimerByKey(key)
  }
}

/** 重置指定间隔提醒的进度（仅此一条）。若传入 payload 则用当前界面配置，否则从磁盘 getSettings 读取 */
export function resetReminderProgress(key: string, payload?: ResetIntervalPayload): void {
  removeIntervalTimerByKey(key)

  let h: number, m: number, sec: number, repeatCount: number | null, categoryName: string, content: string, splitCount: number, restSec: number, restContent: string, mainPopupThemeId: string | undefined, restPopupThemeId: string | undefined
  if (payload) {
    h = payload.intervalHours ?? 0
    m = payload.intervalMinutes ?? 0
    sec = payload.intervalSeconds ?? 0
    repeatCount = payload.repeatCount ?? null
    categoryName = payload.categoryName
    content = payload.content || '提醒'
    mainPopupThemeId = payload.mainPopupThemeId
    restPopupThemeId = payload.restPopupThemeId
    splitCount = Math.max(1, Math.min(10, payload.splitCount ?? 1))
    restSec = Math.max(0, payload.restDurationSeconds ?? 0)
    restContent = payload.restContent ?? '休息一下'
  } else {
    const s = getSettings()
    let cat: (typeof s.reminderCategories)[0] | undefined
    let item: (typeof s.reminderCategories)[0]['items'][0] | undefined
    for (const c of s.reminderCategories) {
      for (const it of c.items) {
        if (`${c.id}_${it.id}` === key) {
          cat = c
          item = it
          break
        }
      }
      if (item) break
    }
    if (!cat || !item || item.mode !== 'interval') return
    const itemInterval = item.mode === 'interval' ? item : null
    if (!itemInterval) return
    h = itemInterval.intervalHours ?? 0
    m = itemInterval.intervalMinutes ?? 0
    sec = itemInterval.intervalSeconds ?? 0
    repeatCount = itemInterval.repeatCount ?? null
    categoryName = cat.name
    content = itemInterval.content || '提醒'
    mainPopupThemeId = itemInterval.mainPopupThemeId
    restPopupThemeId = itemInterval.restPopupThemeId
    splitCount = Math.max(1, Math.min(10, itemInterval.splitCount ?? 1))
    restSec = Math.max(0, itemInterval.restDurationSeconds ?? 0)
    restContent = itemInterval.restContent ?? '休息一下'
  }

  const totalSec = Math.max(1, h * 3600 + m * 60 + sec)
  const intervalMs = totalSec * 1000
  const restDurationMs = restSec * 1000
  const plan = buildSplitSchedule(intervalMs, splitCount, restDurationMs)
  const effectiveSplitCount = plan.workDurationsMs.length
  const effectiveRestMs = effectiveSplitCount > 1 ? restDurationMs : 0
  const segmentDurationMs = plan.workDurationsMs[0] ?? intervalMs
  const now = Date.now()
  const newSt: IntervalState = {
    startTime: now,
    firedCount: 0,
    intervalMs,
    repeatCount,
    categoryName,
    content,
    mainPopupThemeId,
    restPopupThemeId,
    splitCount: effectiveSplitCount,
    segmentDurationMs,
    workDurationsMs: plan.workDurationsMs.slice(),
    restDurationMs: effectiveRestMs,
    cycleTotalMs: plan.cycleTotalMs,
    restContent,
    phase: 'work',
    phaseIndex: 0,
    phaseStartTime: now,
  }
  intervalState.set(key, newSt)
  const timer = setTimeout(() => scheduleNextPhase(key), segmentDurationMs)
  intervalTimeouts.set(key, timer)
  intervalTimerKeys.push(key)
}

import type { CountdownItem } from '../shared/settings'

export type { CountdownItem }

function clearFixedRestEndCountdownTimeoutsByKey(key: string): void {
  const prefix = `${key}_`
  for (const [timeoutKey, timer] of fixedRestEndCountdownTimeouts.entries()) {
    if (!timeoutKey.startsWith(prefix)) continue
    clearTimeout(timer)
    fixedRestEndCountdownTimeouts.delete(timeoutKey)
  }
}

function clearFixedRestBreakTimeoutsByKey(key: string): void {
  const prefix = `${key}_`
  for (const [timeoutKey, timer] of fixedRestBreakTimeouts.entries()) {
    if (!timeoutKey.startsWith(prefix)) continue
    clearTimeout(timer)
    fixedRestBreakTimeouts.delete(timeoutKey)
  }
}

function clearFixedRestTimersByKey(key: string): void {
  clearFixedRestBreakTimeoutsByKey(key)
  clearFixedRestEndCountdownTimeoutsByKey(key)
}

/** 固定时间「启动/重置」：重置单次结束态，并按当前配置重新建立窗口调度。 */
export function setFixedTimeCountdownOverride(key: string, _time: string): void {
  fixedSingleShotState.delete(key)
  fixedRestBreakState.delete(key)
  clearFixedRestTimersByKey(key)
  fixedPreciseStartAt.set(key, Date.now())
  runFixedTimeCheck()
}

/** 保持兼容：当前固定时间不再使用覆盖倒计时，仅清理运行态缓存。 */
export function clearFixedTimeCountdownOverrides(): void {
  fixedSingleShotState.clear()
  fixedRestBreakState.clear()
  fixedPreciseStartAt.clear()
  for (const t of fixedRestBreakTimeouts.values()) clearTimeout(t)
  fixedRestBreakTimeouts.clear()
  for (const t of fixedRestEndCountdownTimeouts.values()) clearTimeout(t)
  fixedRestEndCountdownTimeouts.clear()
}

/** 全部重置：将所有固定时间的周期起点与所有间隔的进度更新为「从当前时刻开始」，使用当前 getSettings 的配置 */
export function resetAllReminderProgress(): void {
  const s = getSettings()
  for (const cat of s.reminderCategories) {
    for (const item of cat.items) {
      const key = `${cat.id}_${item.id}`
      if (item.mode === 'fixed') {
        setFixedTimeCountdownOverride(key, item.time)
      } else if (item.mode === 'interval') {
        const payload: ResetIntervalPayload = {
          categoryName: cat.name,
          content: item.content || '提醒',
          mainPopupThemeId: item.mainPopupThemeId,
          restPopupThemeId: item.restPopupThemeId,
          intervalHours: item.intervalHours,
          intervalMinutes: item.intervalMinutes,
          intervalSeconds: item.intervalSeconds,
          repeatCount: item.repeatCount ?? null,
          splitCount: item.splitCount,
          restDurationSeconds: item.restDurationSeconds,
          restContent: item.restContent,
        }
        resetReminderProgress(key, payload)
      }
    }
  }
}

export function getReminderCountdowns(): CountdownItem[] {
  const result: CountdownItem[] = []
  const now = Date.now()
  const s = getSettings()

  for (const cat of s.reminderCategories) {
    for (const item of cat.items) {
      const key = `${cat.id}_${item.id}`
      if (item.mode === 'fixed') {
        const endTime = isValidTimeHHmm(item.time) ? item.time : '00:00'
        const startTime = isValidTimeHHmm(item.startTime) ? item.startTime : endTime
        const durationMs = getWindowDurationMs(startTime, endTime)
        if (item.enabled === false || durationMs <= 0) {
          const hasWeekly = Array.isArray(item.weekdaysEnabled) && item.weekdaysEnabled.some(Boolean)
          if (item.useNowAsStart === true && item.enabled === false) {
            const e = parseTimeHHmm(endTime)
            const base = new Date(now)
            base.setHours(e.h, e.m, 0, 0)
            let we = base.getTime()
            if (we <= now) we += 24 * 3600 * 1000
            result.push({
              key,
              type: 'fixed',
              nextAt: now,
              remainingMs: 0,
              ended: true,
              fixedState: 'ended',
              time: endTime,
              startTime,
              windowStartAt: now,
              windowEndAt: we,
              useNowAsStart: true,
              hasWeeklyRepeat: hasWeekly,
            })
          } else {
            const s = parseTimeHHmm(startTime)
            const e = parseTimeHHmm(endTime)
            const base = new Date(now)
            base.setHours(s.h, s.m, 0, 0)
            let ws = base.getTime()
            base.setHours(e.h, e.m, 0, 0)
            let we = base.getTime()
            if (we <= ws) we += 24 * 3600 * 1000
            if (we <= now) { ws += 24 * 3600 * 1000; we += 24 * 3600 * 1000 }
            result.push({
              key,
              type: 'fixed',
              nextAt: now,
              remainingMs: 0,
              ended: true,
              fixedState: 'ended',
              time: endTime,
              startTime,
              windowStartAt: ws,
              windowEndAt: we,
              useNowAsStart: false,
              hasWeeklyRepeat: hasWeekly,
            })
          }
          continue
        }
        const context = getFixedWindowContext(key, startTime, endTime, item.weekdaysEnabled, now)
        let effectiveWindowStart = context.windowStartAt
        const preciseStart = fixedPreciseStartAt.get(key)
        if (preciseStart && context.state === 'running' && preciseStart >= context.windowStartAt && preciseStart <= context.windowEndAt) {
          effectiveWindowStart = preciseStart
        } else if (preciseStart && context.state !== 'running') {
          fixedPreciseStartAt.delete(key)
        }
        const hasWeeklyRepeat = Array.isArray(item.weekdaysEnabled) && item.weekdaysEnabled.some(Boolean)
        const base: CountdownItem = {
          key,
          type: 'fixed',
          nextAt: context.nextAt,
          remainingMs: context.remainingMs,
          ended: context.state === 'ended',
          fixedState: context.state,
          time: endTime,
          startTime,
          windowStartAt: effectiveWindowStart,
          windowEndAt: context.windowEndAt,
          cycleStartAt: effectiveWindowStart,
          useNowAsStart: item.useNowAsStart === true,
          hasWeeklyRepeat,
        }
        result.push(base)
      } else if (item.mode === 'interval') {
        if (item.enabled === false) {
          result.push({
            key,
            type: 'interval',
            nextAt: now,
            remainingMs: 0,
            ended: true,
            workRemainingMs: 0,
            repeatCount: item.repeatCount,
            firedCount: 0,
            splitCount: item.splitCount,
          })
          continue
        }
        const st = intervalState.get(key)
        if (!st) {
          const completed = intervalCompletedState.get(key)
          if (completed) {
            result.push({
              key,
              type: 'interval',
              nextAt: completed.completedAt,
              remainingMs: 0,
              ended: true,
              workRemainingMs: 0,
              repeatCount: completed.repeatCount,
              firedCount: completed.firedCount,
              splitCount: completed.splitCount,
              segmentDurationMs: completed.segmentDurationMs,
              workDurationsMs: completed.workDurationsMs.slice(),
              restDurationMs: completed.restDurationMs,
              currentPhase: 'work',
              phaseIndex: Math.max(0, completed.splitCount - 1),
              phaseElapsedMs: completed.segmentDurationMs,
              phaseTotalMs: completed.segmentDurationMs,
              cycleTotalMs: completed.cycleTotalMs,
            })
          } else {
            result.push({ key, type: 'interval', nextAt: now, remainingMs: 0, repeatCount: item.repeatCount, firedCount: 0 })
          }
          continue
        }
        const phaseElapsedMs = now - st.phaseStartTime
        const phaseTotalMs = st.phase === 'work' ? getWorkDurationMs(st, st.phaseIndex) : st.restDurationMs
        const remainingInPhase = Math.max(0, phaseTotalMs - phaseElapsedMs)
        let remainingMs = remainingInPhase
        if (st.phase === 'work') {
          for (let i = st.phaseIndex + 1; i < st.splitCount; i++) {
            remainingMs += st.restDurationMs + getWorkDurationMs(st, i)
          }
        } else {
          remainingMs += getWorkDurationMs(st, st.phaseIndex + 1)
          for (let i = st.phaseIndex + 2; i < st.splitCount; i++) {
            remainingMs += st.restDurationMs + getWorkDurationMs(st, i)
          }
        }
        const cycleTotalMs = st.cycleTotalMs
        const nextAt = now + remainingMs
        // 仅工作段剩余（不含休息），与用户设置的「倒计时」一致，用于界面大数字显示
        let workRemainingMs: number
        if (st.phase === 'work') {
          workRemainingMs = remainingInPhase
          for (let i = st.phaseIndex + 1; i < st.splitCount; i++) {
            workRemainingMs += getWorkDurationMs(st, i)
          }
        } else {
          workRemainingMs = 0
          for (let i = st.phaseIndex + 1; i < st.splitCount; i++) {
            workRemainingMs += getWorkDurationMs(st, i)
          }
        }
        result.push({
          key,
          type: 'interval',
          nextAt,
          remainingMs,
          workRemainingMs,
          repeatCount: st.repeatCount,
          firedCount: st.firedCount,
          splitCount: st.splitCount,
          segmentDurationMs: st.segmentDurationMs,
          workDurationsMs: st.workDurationsMs.slice(),
          restDurationMs: st.restDurationMs,
          currentPhase: st.phase,
          phaseIndex: st.phaseIndex,
          phaseElapsedMs,
          phaseTotalMs,
          cycleTotalMs,
        })
      }
      /* mode === 'stopwatch'：无倒计时、无弹窗 */
    }
  }
  return result
}
