import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import type { AppSettings, ReminderCategory, SubReminder } from '../shared/settings'
import { getStableDefaultCategories } from '../shared/settings'

export type { AppSettings, ReminderCategory, SubReminder } from '../shared/settings'

const defaultCategories = getStableDefaultCategories()

/** 旧版扁平设置（仅用于迁移检测与读取） */
interface LegacySettings {
  breakfastTime?: string
  lunchTime?: string
  dinnerTime?: string
  activityIntervalMinutes?: number
  workMinutes?: number
  breakMinutes?: number
  breakfastContent?: string
  lunchContent?: string
  dinnerContent?: string
  activityContent?: string
  restContent?: string
  mealPresets?: string[]
  activityPresets?: string[]
  restPresets?: string[]
}

function hasLegacyFields(data: unknown): data is LegacySettings {
  if (!data || typeof data !== 'object') return false
  const o = data as Record<string, unknown>
  return (
    typeof o.breakfastTime === 'string' ||
    typeof o.activityIntervalMinutes === 'number' ||
    typeof o.workMinutes === 'number'
  )
}

/** 将旧版扁平配置转为 reminderCategories */
function migrateFromLegacy(legacy: LegacySettings): ReminderCategory[] {
  const cats = getStableDefaultCategories()
  const meal = cats[0]
  const activity = cats[1]
  const rest = cats[2]
  if (legacy.breakfastTime != null) meal.items[0] = { ...meal.items[0], mode: 'fixed', time: legacy.breakfastTime, content: legacy.breakfastContent ?? meal.items[0].content }
  if (legacy.lunchTime != null) meal.items[1] = { ...meal.items[1], mode: 'fixed', time: legacy.lunchTime, content: legacy.lunchContent ?? meal.items[1].content }
  if (legacy.dinnerTime != null) meal.items[2] = { ...meal.items[2], mode: 'fixed', time: legacy.dinnerTime, content: legacy.dinnerContent ?? meal.items[2].content }
  if (Array.isArray(legacy.mealPresets)) meal.presets = legacy.mealPresets
  if (typeof legacy.activityIntervalMinutes === 'number') activity.items[0] = { ...activity.items[0], mode: 'interval', intervalMinutes: Math.max(1, legacy.activityIntervalMinutes), content: legacy.activityContent ?? activity.items[0].content, repeatCount: null }
  if (Array.isArray(legacy.activityPresets)) activity.presets = legacy.activityPresets
  if (typeof legacy.workMinutes === 'number') rest.items[0] = { ...rest.items[0], mode: 'interval', intervalMinutes: Math.max(1, legacy.workMinutes), content: legacy.restContent ?? rest.items[0].content, repeatCount: null }
  if (Array.isArray(legacy.restPresets)) rest.presets = legacy.restPresets
  return cats
}

function normalizeCategories(cats: unknown): ReminderCategory[] {
  if (!Array.isArray(cats) || cats.length === 0) return defaultCategories
  return cats.map((c) => {
    if (!c || typeof c !== 'object') return defaultCategories[0]
    const o = c as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id : `cat_${Date.now()}`
    const name = typeof o.name === 'string' ? o.name : '未命名'
    const presets = Array.isArray(o.presets) ? o.presets.filter((p): p is string => typeof p === 'string') : []
    const rawItems = Array.isArray(o.items) ? (o.items as unknown[]) : []
    const items: SubReminder[] = rawItems.map((item) => {
      if (!item || typeof item !== 'object') return null
      const i = item as Record<string, unknown>
      if (typeof i.id !== 'string' || typeof i.content !== 'string') return null
      if (i.mode === 'fixed' && typeof (i as { time: unknown }).time === 'string') {
        return { id: i.id, mode: 'fixed' as const, time: (i as { time: string }).time, content: i.content as string }
      }
      if (i.mode === 'interval' && typeof (i as { intervalMinutes: unknown }).intervalMinutes === 'number') {
        const interval = i as { intervalMinutes: number; intervalHours?: number; intervalSeconds?: number; repeatCount?: number | null }
        const repeatCount = interval.repeatCount === undefined || interval.repeatCount === null
          ? null
          : Math.max(1, Math.floor(Number(interval.repeatCount)))
        return {
          id: i.id,
          mode: 'interval' as const,
          intervalHours: interval.intervalHours,
          intervalMinutes: interval.intervalMinutes,
          intervalSeconds: interval.intervalSeconds,
          content: i.content as string,
          repeatCount,
        }
      }
      return null
    }).filter((x): x is SubReminder => x !== null)
    return { id, name, presets, items }
  })
}

/** 开发时写到项目根目录，便于确认；正式用 userData */
function getSettingsPath(): string {
  const isDev = !!process.env.VITE_DEV_SERVER_URL
  if (isDev) {
    return join(process.cwd(), 'workbreak-settings.json')
  }
  return join(app.getPath('userData'), 'settings.json')
}

export function getSettingsFilePath(): string {
  return getSettingsPath()
}

export function getSettings(): AppSettings {
  const path = getSettingsPath()
  if (!existsSync(path)) {
    if (process.env.VITE_DEV_SERVER_URL) console.log('[WorkBreak] 设置文件不存在，使用默认值。路径:', path)
    return { reminderCategories: defaultCategories }
  }
  try {
    const raw = readFileSync(path, 'utf-8')
    const data = JSON.parse(raw) as Record<string, unknown>
    if (hasLegacyFields(data) && (!Array.isArray(data.reminderCategories) || data.reminderCategories.length === 0)) {
      const migrated = migrateFromLegacy(data)
      const next: AppSettings = { reminderCategories: migrated }
      const dir = dirname(path)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(path, JSON.stringify(next, null, 2), 'utf-8')
      if (process.env.VITE_DEV_SERVER_URL) console.log('[WorkBreak] 已迁移旧配置为新结构:', path)
      return next
    }
    const out: AppSettings = {
      reminderCategories: normalizeCategories(data.reminderCategories),
    }
    if (process.env.VITE_DEV_SERVER_URL) console.log('[WorkBreak] 已读取设置:', path)
    return out
  } catch (e) {
    if (process.env.VITE_DEV_SERVER_URL) console.warn('[WorkBreak] 读取设置失败', e)
    return { reminderCategories: defaultCategories }
  }
}

export function setSettings(settings: Partial<AppSettings>): AppSettings {
  const current = getSettings()
  const next: AppSettings = {
    reminderCategories: settings.reminderCategories !== undefined
      ? normalizeCategories(settings.reminderCategories)
      : current.reminderCategories,
  }
  const path = getSettingsPath()
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(path, JSON.stringify(next, null, 2), 'utf-8')
  return next
}
