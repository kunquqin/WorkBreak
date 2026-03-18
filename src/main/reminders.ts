import { getSettings } from './settings'
import { showReminderPopup } from './reminderWindow'

let fixedMinuteTimeout: ReturnType<typeof setTimeout> | null = null
const intervalTimerKeys: string[] = []
const intervalTimers = new Map<string, ReturnType<typeof setInterval>>()
interface IntervalState {
  startTime: number
  firedCount: number
  intervalMs: number
  repeatCount: number | null
  categoryName: string
  content: string
}
const intervalState = new Map<string, IntervalState>()

function showReminder(title: string, body: string) {
  const now = new Date()
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  showReminderPopup({ title, body, timeStr })
}

function parseTimeHHmm(hhmm: string): { h: number; m: number } {
  const [h, m] = hhmm.split(':').map(Number)
  return { h: h ?? 0, m: m ?? 0 }
}

function isSameMinute(now: Date, h: number, m: number): boolean {
  return now.getHours() === h && now.getMinutes() === m
}

/** 到整分时检查所有固定时间子提醒 */
function runFixedTimeCheck() {
  const s = getSettings()
  const now = new Date()
  for (const cat of s.reminderCategories) {
    for (const item of cat.items) {
      if (item.mode !== 'fixed') continue
      const { h, m } = parseTimeHHmm(item.time)
      if (isSameMinute(now, h, m)) {
        showReminder(cat.name, item.content || '提醒')
      }
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

function scheduleIntervalReminders() {
  for (const key of intervalTimerKeys) {
    const t = intervalTimers.get(key)
    if (t) clearInterval(t)
    intervalTimers.delete(key)
    intervalState.delete(key)
  }
  intervalTimerKeys.length = 0

  const s = getSettings()
  const now = Date.now()
  for (const cat of s.reminderCategories) {
    for (const item of cat.items) {
      if (item.mode !== 'interval') continue
      const h = item.intervalHours ?? 0
      const m = item.intervalMinutes ?? 0
      const s = item.intervalSeconds ?? 0
      const totalSec = Math.max(1, h * 3600 + m * 60 + s)
      const intervalMs = totalSec * 1000
      const repeatCount = item.repeatCount ?? null
      const key = `${cat.id}_${item.id}`
      const state: IntervalState = {
        startTime: now,
        firedCount: 0,
        intervalMs,
        repeatCount,
        categoryName: cat.name,
        content: item.content || '提醒',
      }
      intervalState.set(key, state)
      const timer = setInterval(() => {
        const st = intervalState.get(key)
        if (!st) return
        showReminder(st.categoryName, st.content)
        st.firedCount++
        st.startTime = Date.now()
        if (st.repeatCount !== null && st.firedCount >= st.repeatCount) {
          clearInterval(intervalTimers.get(key)!)
          intervalTimers.delete(key)
          intervalState.delete(key)
          const i = intervalTimerKeys.indexOf(key)
          if (i >= 0) intervalTimerKeys.splice(i, 1)
        }
      }, intervalMs)
      intervalTimers.set(key, timer)
      intervalTimerKeys.push(key)
    }
  }
}

export function startReminders() {
  scheduleFixedTimeReminders()
  scheduleIntervalReminders()
}

export function stopReminders() {
  if (fixedMinuteTimeout) {
    clearTimeout(fixedMinuteTimeout)
    fixedMinuteTimeout = null
  }
  for (const key of intervalTimerKeys) {
    const t = intervalTimers.get(key)
    if (t) clearInterval(t)
  }
  intervalTimers.clear()
  intervalState.clear()
  intervalTimerKeys.length = 0
}

export function restartReminders() {
  stopReminders()
  startReminders()
}

/** 固定时间：计算下次触发的时刻（今天或明天 HH:mm） */
function getNextFixedTime(timeStr: string): number {
  const { h, m } = parseTimeHHmm(timeStr)
  const now = new Date()
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0)
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1)
  return next.getTime()
}

import type { CountdownItem } from '../shared/settings'

export type { CountdownItem }

export function getReminderCountdowns(): CountdownItem[] {
  const result: CountdownItem[] = []
  const now = Date.now()
  const s = getSettings()

  for (const cat of s.reminderCategories) {
    for (const item of cat.items) {
      const key = `${cat.id}_${item.id}`
      if (item.mode === 'fixed') {
        const nextAt = getNextFixedTime(item.time)
        result.push({ key, type: 'fixed', nextAt, remainingMs: Math.max(0, nextAt - now), time: item.time })
      } else {
        const st = intervalState.get(key)
        if (!st) {
          result.push({ key, type: 'interval', nextAt: now, remainingMs: 0, repeatCount: item.repeatCount, firedCount: 0 })
          continue
        }
        const nextAt = st.startTime + st.intervalMs
        const remainingMs = Math.max(0, nextAt - now)
        result.push({ key, type: 'interval', nextAt, remainingMs, repeatCount: st.repeatCount, firedCount: st.firedCount })
      }
    }
  }
  return result
}
