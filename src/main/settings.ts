import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import type {
  AppSettings,
  BackgroundImageXYKind,
  CategoryKind,
  ReminderCategory,
  SubReminder,
  PresetPools,
  PopupLayerTextEffects,
  PopupTheme,
  AppEntitlements,
  TextTransform,
  AppThemeSetting,
} from '../shared/settings'
import { isPopupFontFamilyPresetId, sanitizeSystemFontFamilyName } from '../shared/popupThemeFonts'
import {
  genId,
  getDefaultPresetPools,
  getStableDefaultCategories,
  getDefaultPopupThemes,
  getDefaultEntitlements,
  ensureThemeLayers,
  mergeSystemBuiltinPopupThemes,
  isObsoleteMealActivityRestTriad,
  POPUP_BACKGROUND_IMAGE_BLUR_MAX_PX,
  POPUP_FOLDER_CROSSFADE_MAX_SEC,
} from '../shared/settings'
import {
  isVerticalWritingMode,
  normalizePopupTextOrientationMode,
  normalizePopupTextWritingMode,
} from '../shared/popupVerticalText'
import { clampPopupThemeLetterSpacing, clampPopupThemeLineHeight } from '../shared/popupThemeTypographyClamp'

export type { AppSettings, ReminderCategory, SubReminder } from '../shared/settings'

const defaultCategories = getStableDefaultCategories()
const defaultPresetPools = getDefaultPresetPools()
const defaultPopupThemes = getDefaultPopupThemes()
const defaultEntitlements = getDefaultEntitlements()
const legacyReminderContentDefaults = [
  '该休息一下啦',
  '起身活动一下',
  '喝口水，放松肩颈',
  '看看远处，放松眼睛',
  '本轮结束，预备下轮',
]
const legacyRestContentDefaults = [
  '休息一下，深呼吸',
  '离开屏幕，活动颈肩',
  '闭眼放松 30 秒',
  '休息即将结束，准备回来',
]

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

function getDefaultCategoryName(kind: CategoryKind): string {
  return kind === 'alarm' ? '未命名闹钟类型' : kind === 'countdown' ? '未命名倒计时类型' : '未命名秒表类型'
}

function uniqStrings(input: unknown[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const v of input) {
    if (typeof v !== 'string') continue
    const s = v.trim()
    if (!s || seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
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

/** 将旧版扁平配置转为 reminderCategories（模板为：闹钟两条 fixed + 倒计时一条 interval + 秒表） */
function migrateFromLegacy(legacy: LegacySettings): ReminderCategory[] {
  const cats = getStableDefaultCategories()
  const alarm = cats[0]
  const countdown = cats[1]
  type FixedItem = Extract<SubReminder, { mode: 'fixed' }>
  type IntervalItem = Extract<SubReminder, { mode: 'interval' }>
  if (legacy.breakfastTime != null && alarm.items[0]?.mode === 'fixed') {
    const cur = alarm.items[0] as FixedItem
    alarm.items[0] = {
      ...cur,
      mode: 'fixed',
      time: legacy.breakfastTime,
      content: legacy.breakfastContent ?? cur.content,
    }
  }
  if (legacy.lunchTime != null && alarm.items[1]?.mode === 'fixed') {
    const cur = alarm.items[1] as FixedItem
    alarm.items[1] = {
      ...cur,
      mode: 'fixed',
      time: legacy.lunchTime,
      content: legacy.lunchContent ?? cur.content,
    }
  }
  if (legacy.dinnerTime != null) {
    const template = (alarm.items[0] as FixedItem | undefined) ?? {
      id: genId(),
      mode: 'fixed' as const,
      enabled: false,
      time: '18:00',
      content: '记得吃晚饭～',
    }
    alarm.items.push({
      ...template,
      id: `meal_dinner_${genId().slice(-8)}`,
      title: '晚餐',
      enabled: false,
      startTime: '17:30',
      time: legacy.dinnerTime,
      content: legacy.dinnerContent ?? '记得吃晚饭～',
      weekdaysEnabled: template.weekdaysEnabled,
    })
  }
  if (Array.isArray(legacy.mealPresets)) alarm.presets = legacy.mealPresets

  const hasActivityInterval = typeof legacy.activityIntervalMinutes === 'number'
  const hasWorkRest = typeof legacy.workMinutes === 'number'

  if (hasActivityInterval && countdown.items[0]?.mode === 'interval') {
    const cur = countdown.items[0] as IntervalItem
    countdown.items[0] = {
      ...cur,
      mode: 'interval',
      intervalMinutes: Math.max(1, legacy.activityIntervalMinutes!),
      content: legacy.activityContent ?? cur.content,
      repeatCount: null,
    }
  }
  if (Array.isArray(legacy.activityPresets)) countdown.presets = legacy.activityPresets
  if (Array.isArray(legacy.restPresets)) {
    countdown.presets = uniqStrings([...(countdown.presets ?? []), ...legacy.restPresets])
  }

  if (hasWorkRest) {
    const restContent = legacy.restContent ?? '已经工作一段时间了，休息一下吧～'
    const newItem: IntervalItem = {
      id: `legacy_work_${genId().slice(-8)}`,
      mode: 'interval',
      enabled: false,
      intervalMinutes: Math.max(1, legacy.workMinutes!),
      content: restContent,
      repeatCount: null,
    }
    if (hasActivityInterval) {
      countdown.items.push(newItem)
    } else if (countdown.items[0]?.mode === 'interval') {
      countdown.items[0] = { ...(countdown.items[0] as IntervalItem), ...newItem, id: (countdown.items[0] as IntervalItem).id }
    } else {
      countdown.items.push(newItem)
    }
  }
  return cats
}

function normalizeCategories(cats: unknown): ReminderCategory[] {
  // 缺字段或非数组：按「尚无有效配置」处理，用内置默认（首次安装等）
  if (!Array.isArray(cats)) return defaultCategories
  // 明确传空数组：允许用户清空所有类型，不得替换成默认（否则删光后会「秒恢复」模板）
  if (cats.length === 0) return []
  return cats.map((c) => {
    if (!c || typeof c !== 'object') return defaultCategories[0]
    const o = c as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id : `cat_${Date.now()}`
    const rawName = typeof o.name === 'string' ? o.name : ''
    const presets = Array.isArray(o.presets) ? o.presets.filter((p): p is string => typeof p === 'string') : []
    const titlePresets = Array.isArray(o.titlePresets) ? o.titlePresets.filter((p): p is string => typeof p === 'string') : []
    const rawItems = Array.isArray(o.items) ? (o.items as unknown[]) : []
    const items: SubReminder[] = rawItems
      .map((item): SubReminder | null => {
      if (!item || typeof item !== 'object') return null
      const i = item as Record<string, unknown>
      if (typeof i.id !== 'string') return null
      if (i.mode === 'stopwatch') {
        return { id: i.id, mode: 'stopwatch' as const, ...(typeof i.content === 'string' && i.content ? { content: i.content } : {}) }
      }
      if (typeof i.content !== 'string') return null
      if (i.mode === 'fixed' && typeof (i as { time: unknown }).time === 'string') {
        const fixed = i as {
          startTime?: string
          time: string
          title?: unknown
          mainPopupThemeId?: unknown
          restPopupThemeId?: unknown
          splitCount?: number
          restDurationSeconds?: number
          restContent?: string
          weekdaysEnabled?: unknown
        }
        let weekdaysEnabled: boolean[] | undefined
        if (Array.isArray(fixed.weekdaysEnabled) && fixed.weekdaysEnabled.length === 7) {
          weekdaysEnabled = fixed.weekdaysEnabled.map((x) => Boolean(x))
        }
        return {
          id: i.id,
          mode: 'fixed' as const,
          ...(typeof fixed.title === 'string' && fixed.title ? { title: fixed.title } : {}),
          ...(typeof i.enabled === 'boolean' ? { enabled: i.enabled } : { enabled: true }),
          ...(typeof fixed.startTime === 'string' && fixed.startTime ? { startTime: fixed.startTime } : {}),
          time: fixed.time,
          content: i.content as string,
          ...(typeof fixed.mainPopupThemeId === 'string' && fixed.mainPopupThemeId ? { mainPopupThemeId: fixed.mainPopupThemeId } : {}),
          ...(typeof fixed.restPopupThemeId === 'string' && fixed.restPopupThemeId ? { restPopupThemeId: fixed.restPopupThemeId } : {}),
          splitCount: fixed.splitCount,
          restDurationSeconds: fixed.restDurationSeconds,
          restContent: fixed.restContent,
          ...(weekdaysEnabled ? { weekdaysEnabled } : {}),
          ...(typeof (i as Record<string, unknown>).useNowAsStart === 'boolean' ? { useNowAsStart: (i as Record<string, unknown>).useNowAsStart as boolean } : {}),
        }
      }
      if (i.mode === 'interval' && typeof (i as { intervalMinutes: unknown }).intervalMinutes === 'number') {
        const interval = i as {
          title?: unknown
          intervalMinutes: number
          intervalHours?: number
          intervalSeconds?: number
          repeatCount?: number | null
          splitCount?: number
          restDurationSeconds?: number
          restContent?: string
          mainPopupThemeId?: unknown
          restPopupThemeId?: unknown
        }
        const repeatCount = interval.repeatCount === undefined || interval.repeatCount === null
          ? null
          : Math.max(1, Math.floor(Number(interval.repeatCount)))
        return {
          id: i.id,
          mode: 'interval' as const,
          ...(typeof interval.title === 'string' && interval.title ? { title: interval.title } : {}),
          ...(typeof i.enabled === 'boolean' ? { enabled: i.enabled } : { enabled: true }),
          intervalHours: interval.intervalHours,
          intervalMinutes: interval.intervalMinutes,
          intervalSeconds: interval.intervalSeconds,
          content: i.content as string,
          ...(typeof interval.mainPopupThemeId === 'string' && interval.mainPopupThemeId ? { mainPopupThemeId: interval.mainPopupThemeId } : {}),
          ...(typeof interval.restPopupThemeId === 'string' && interval.restPopupThemeId ? { restPopupThemeId: interval.restPopupThemeId } : {}),
          repeatCount,
          splitCount: interval.splitCount,
          restDurationSeconds: interval.restDurationSeconds,
          restContent: interval.restContent,
        }
      }
      return null
    })
      .filter((x): x is SubReminder => x !== null)

    let categoryKind: CategoryKind =
      o.categoryKind === 'countdown'
        ? 'countdown'
        : o.categoryKind === 'stopwatch'
          ? 'stopwatch'
          : o.categoryKind === 'alarm'
            ? 'alarm'
            : 'alarm'
    if (o.categoryKind !== 'alarm' && o.categoryKind !== 'countdown' && o.categoryKind !== 'stopwatch') {
      const hasStopwatch = items.some((i) => i.mode === 'stopwatch')
      const hasInterval = items.some((i) => i.mode === 'interval')
      const hasFixed = items.some((i) => i.mode === 'fixed')
      if (hasStopwatch && !hasInterval && !hasFixed) categoryKind = 'stopwatch'
      else if (hasInterval && !hasFixed) categoryKind = 'countdown'
      else if (hasFixed && !hasInterval) categoryKind = 'alarm'
      else if (hasInterval && hasFixed) categoryKind = items[0]?.mode === 'interval' ? 'countdown' : 'alarm'
    }
    const filteredItems = items.filter((i) =>
      categoryKind === 'alarm'
        ? i.mode === 'fixed'
        : categoryKind === 'countdown'
          ? i.mode === 'interval'
          : i.mode === 'stopwatch'
    )
    const name = rawName.trim() || getDefaultCategoryName(categoryKind)
    let presetsOut = presets
    if (isObsoleteMealActivityRestTriad(presetsOut)) {
      const tmpl = getStableDefaultCategories().find((x) => x.categoryKind === categoryKind)
      presetsOut = tmpl ? [...tmpl.presets] : []
    }
    return { id, name, categoryKind, presets: presetsOut, titlePresets, items: filteredItems }
  })
}

function normalizePresetPools(raw: unknown, categories: ReminderCategory[]): PresetPools {
  const categoryPresetsLegacy = uniqStrings(categories.flatMap((c) => c.presets ?? []))
  const restPresetsLegacy = uniqStrings(
    categories.flatMap((c) =>
      c.items.flatMap((i) =>
        i.mode === 'fixed' || i.mode === 'interval'
          ? (typeof i.restContent === 'string' && i.restContent.trim() ? [i.restContent] : [])
          : []
      )
    )
  )
  const reminderFromCategories =
    categoryPresetsLegacy.length === 0 || isObsoleteMealActivityRestTriad(categoryPresetsLegacy)
      ? [...defaultPresetPools.reminderContent]
      : categoryPresetsLegacy
  const base = {
    categoryTitle: { ...defaultPresetPools.categoryTitle },
    subTitle: { ...defaultPresetPools.subTitle },
    reminderContent: reminderFromCategories,
    restContent: restPresetsLegacy.length > 0 ? restPresetsLegacy : [...defaultPresetPools.restContent],
  }
  if (!raw || typeof raw !== 'object') return base
  const o = raw as Record<string, unknown>
  const categoryTitle = (o.categoryTitle ?? {}) as Record<string, unknown>
  const subTitle = (o.subTitle ?? {}) as Record<string, unknown>
  const reminderContentRaw = Array.isArray(o.reminderContent) ? uniqStrings(o.reminderContent) : base.reminderContent
  const restContentRaw = Array.isArray(o.restContent) ? uniqStrings(o.restContent) : base.restContent
  const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])
  let reminderContent = sameList(reminderContentRaw, legacyReminderContentDefaults)
      ? [...defaultPresetPools.reminderContent]
      : reminderContentRaw
  if (isObsoleteMealActivityRestTriad(reminderContent)) {
    reminderContent = [...defaultPresetPools.reminderContent]
  }
  const restContent = sameList(restContentRaw, legacyRestContentDefaults)
    ? [...defaultPresetPools.restContent]
    : restContentRaw
  const subFixed = Array.isArray(subTitle.fixed) ? uniqStrings(subTitle.fixed as unknown[]) : base.subTitle.fixed
  const subInterval = Array.isArray(subTitle.interval) ? uniqStrings(subTitle.interval as unknown[]) : base.subTitle.interval
  const subStop = Array.isArray(subTitle.stopwatch) ? uniqStrings(subTitle.stopwatch as unknown[]) : base.subTitle.stopwatch
  return {
    categoryTitle: {
      alarm: Array.isArray(categoryTitle.alarm) ? uniqStrings(categoryTitle.alarm as unknown[]) : base.categoryTitle.alarm,
      countdown: Array.isArray(categoryTitle.countdown) ? uniqStrings(categoryTitle.countdown as unknown[]) : base.categoryTitle.countdown,
      stopwatch: Array.isArray(categoryTitle.stopwatch) ? uniqStrings(categoryTitle.stopwatch as unknown[]) : base.categoryTitle.stopwatch,
    },
    subTitle: {
      fixed: isObsoleteMealActivityRestTriad(subFixed) ? [...defaultPresetPools.subTitle.fixed] : subFixed,
      interval: isObsoleteMealActivityRestTriad(subInterval) ? [...defaultPresetPools.subTitle.interval] : subInterval,
      stopwatch: isObsoleteMealActivityRestTriad(subStop) ? [...defaultPresetPools.subTitle.stopwatch] : subStop,
    },
    reminderContent,
    restContent,
  }
}

function normalizeLayerTextEffects(raw: unknown): PopupLayerTextEffects | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const out: PopupLayerTextEffects = {}
  if (typeof o.strokeEnabled === 'boolean') out.strokeEnabled = o.strokeEnabled
  if (typeof o.shadowEnabled === 'boolean') out.shadowEnabled = o.shadowEnabled
  const strokeW = Number(o.strokeWidthPx)
  if (Number.isFinite(strokeW)) out.strokeWidthPx = Math.max(0, Math.min(24, strokeW))
  if (typeof o.strokeColor === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(o.strokeColor.trim())) {
    out.strokeColor = o.strokeColor.trim()
  }
  const strokeOp = Number(o.strokeOpacity)
  if (Number.isFinite(strokeOp)) out.strokeOpacity = Math.max(0, Math.min(1, strokeOp))
  if (typeof o.shadowColor === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(o.shadowColor.trim())) {
    out.shadowColor = o.shadowColor.trim()
  }
  const shadowOp = Number(o.shadowOpacity)
  if (Number.isFinite(shadowOp)) out.shadowOpacity = Math.max(0, Math.min(1, shadowOp))
  const shadowBlur = Number(o.shadowBlurPx)
  if (Number.isFinite(shadowBlur)) out.shadowBlurPx = Math.max(0, Math.min(80, shadowBlur))
  const shadowSize = Number(o.shadowSizePx)
  if (Number.isFinite(shadowSize)) out.shadowSizePx = Math.max(0, Math.min(48, shadowSize))
  const shadowDist = Number(o.shadowDistancePx)
  if (Number.isFinite(shadowDist)) out.shadowDistancePx = Math.max(0, Math.min(160, shadowDist))
  const shadowAng = Number(o.shadowAngleDeg)
  if (Number.isFinite(shadowAng)) out.shadowAngleDeg = Math.max(-360, Math.min(360, shadowAng))
  return Object.keys(out).length > 0 ? out : undefined
}

function normalizeTextTransform(raw: unknown): TextTransform | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const x = Number(o.x)
  const y = Number(o.y)
  const rotation = Number(o.rotation)
  const scale = Number(o.scale)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined
  const out: TextTransform = {
    x: Math.max(0, Math.min(100, x)),
    y: Math.max(0, Math.min(100, y)),
    rotation: Number.isFinite(rotation) ? rotation % 360 : 0,
    scale: Number.isFinite(scale) ? Math.max(0.1, Math.min(5, scale)) : 1,
  }
  const wp = Number(o.textBoxWidthPct)
  const hp = Number(o.textBoxHeightPct)
  if (Number.isFinite(wp)) out.textBoxWidthPct = Math.max(5, Math.min(96, wp))
  if (Number.isFinite(hp)) out.textBoxHeightPct = Math.max(3, Math.min(100, hp))
  if (o.contentTextBoxUserSized === true) out.contentTextBoxUserSized = true
  if (o.shortLayerTextBoxLockWidth === true) out.shortLayerTextBoxLockWidth = true
  return out
}

function normalizeBackgroundImageTransform(
  raw: unknown,
  xyKind: BackgroundImageXYKind | undefined,
): TextTransform | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const rotNum = Number(o.rotation)
  const scNum = Number(o.scale)
  const rotation = Number.isFinite(rotNum) ? rotNum % 360 : 0
  const scale = Number.isFinite(scNum) ? Math.max(0.1, Math.min(5, scNum)) : 1

  if (xyKind === 'translateCenter') {
    const xNum = Number(o.x)
    const yNum = Number(o.y)
    const x = Number.isFinite(xNum) ? Math.max(-50, Math.min(50, xNum)) : 0
    const y = Number.isFinite(yNum) ? Math.max(-50, Math.min(50, yNum)) : 0
    if (x === 0 && y === 0 && rotation === 0 && Math.abs(scale - 1) < 1e-9) return undefined
    return { x, y, rotation, scale }
  }

  const t = normalizeTextTransform({
    x: o.x !== undefined && o.x !== null ? o.x : 50,
    y: o.y !== undefined && o.y !== null ? o.y : 50,
    rotation: o.rotation,
    scale: o.scale,
  })
  if (!t) return undefined
  if (
    t.x === 50 &&
    t.y === 50 &&
    t.rotation === 0 &&
    Math.abs(t.scale - 1) < 1e-9
  ) {
    return undefined
  }
  return { x: t.x, y: t.y, rotation: t.rotation, scale: t.scale }
}

function normalizePopupThemes(raw: unknown): PopupTheme[] {
  if (!Array.isArray(raw)) return mergeSystemBuiltinPopupThemes([])
  if (raw.length === 0) return mergeSystemBuiltinPopupThemes([])
  const out: PopupTheme[] = raw
    .map((x): PopupTheme | null => {
      if (!x || typeof x !== 'object') return null
      const o = x as Record<string, unknown>
      const id = typeof o.id === 'string' && o.id.trim() ? o.id : `theme_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim() : '未命名主题'
      const target =
        o.target === 'rest' ? 'rest' : o.target === 'desktop' ? 'desktop' : 'main'
      const backgroundType = o.backgroundType === 'image' ? 'image' : 'solid'
      const backgroundColor = typeof o.backgroundColor === 'string' && o.backgroundColor ? o.backgroundColor : '#000000'
      const imageSourceType = o.imageSourceType === 'folder' ? 'folder' : 'single'
      const imagePath = typeof o.imagePath === 'string' && o.imagePath.trim() ? o.imagePath : undefined
      const imageFolderPath = typeof o.imageFolderPath === 'string' && o.imageFolderPath.trim() ? o.imageFolderPath : undefined
      const imageFolderFiles = Array.isArray(o.imageFolderFiles)
        ? o.imageFolderFiles.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
        : undefined
      const imageFolderPlayMode = o.imageFolderPlayMode === 'random' ? 'random' : 'sequence'
      const imageFolderIntervalSecNum = Number(o.imageFolderIntervalSec)
      const imageFolderIntervalSec = Number.isFinite(imageFolderIntervalSecNum)
        ? Math.max(1, Math.min(3600, Math.floor(imageFolderIntervalSecNum)))
        : 30
      const imageFolderCrossfadeSecNum = Number(o.imageFolderCrossfadeSec)
      const imageFolderCrossfadeSec = Number.isFinite(imageFolderCrossfadeSecNum)
        ? Math.max(0.5, Math.min(POPUP_FOLDER_CROSSFADE_MAX_SEC, imageFolderCrossfadeSecNum))
        : 2
      const backgroundImageBlurPxNum = Number(o.backgroundImageBlurPx)
      const backgroundImageBlurPx = Number.isFinite(backgroundImageBlurPxNum)
        ? Math.max(0, Math.min(POPUP_BACKGROUND_IMAGE_BLUR_MAX_PX, Math.round(backgroundImageBlurPxNum)))
        : 0
      const backgroundImageXYKind: BackgroundImageXYKind | undefined =
        o.backgroundImageXYKind === 'translateCenter' ? 'translateCenter' : undefined
      const backgroundImageTransform = normalizeBackgroundImageTransform(
        o.backgroundImageTransform,
        backgroundImageXYKind,
      )
      const effectiveBackgroundImageXYKind: BackgroundImageXYKind | undefined =
        backgroundImageTransform && backgroundImageXYKind === 'translateCenter'
          ? 'translateCenter'
          : undefined
      const overlayEnabled = typeof o.overlayEnabled === 'boolean' ? o.overlayEnabled : false
      const overlayColor = typeof o.overlayColor === 'string' && o.overlayColor ? o.overlayColor : '#000000'
      const overlayOpacityNum = Number(o.overlayOpacity)
      const overlayOpacity = Number.isFinite(overlayOpacityNum) ? Math.max(0, Math.min(1, overlayOpacityNum)) : 0.45
      const overlayMode = o.overlayMode === 'gradient' ? 'gradient' : 'solid'
      const overlayGradientDirection =
        o.overlayGradientDirection === 'rightToLeft' ||
        o.overlayGradientDirection === 'topToBottom' ||
        o.overlayGradientDirection === 'bottomToTop' ||
        o.overlayGradientDirection === 'topLeftToBottomRight' ||
        o.overlayGradientDirection === 'topRightToBottomLeft' ||
        o.overlayGradientDirection === 'bottomLeftToTopRight' ||
        o.overlayGradientDirection === 'bottomRightToTopLeft' ||
        o.overlayGradientDirection === 'custom'
          ? o.overlayGradientDirection
          : 'leftToRight'
      const overlayGradientAngleDegNum = Number(o.overlayGradientAngleDeg)
      const overlayGradientAngleDeg = Number.isFinite(overlayGradientAngleDegNum)
        ? ((overlayGradientAngleDegNum % 360) + 360) % 360
        : (
          overlayGradientDirection === 'rightToLeft' ? 270
            : overlayGradientDirection === 'topToBottom' ? 180
              : overlayGradientDirection === 'bottomToTop' ? 0
                : overlayGradientDirection === 'topLeftToBottomRight' ? 135
                  : overlayGradientDirection === 'topRightToBottomLeft' ? 225
                    : overlayGradientDirection === 'bottomLeftToTopRight' ? 45
                      : overlayGradientDirection === 'bottomRightToTopLeft' ? 315
                        : 90
        )
      const overlayGradientStartOpacityNum = Number(o.overlayGradientStartOpacity)
      const overlayGradientStartOpacity = Number.isFinite(overlayGradientStartOpacityNum)
        ? Math.max(0, Math.min(1, overlayGradientStartOpacityNum))
        : 0.7
      const overlayGradientEndOpacityNum = Number(o.overlayGradientEndOpacity)
      const overlayGradientEndOpacity = Number.isFinite(overlayGradientEndOpacityNum)
        ? Math.max(0, Math.min(1, overlayGradientEndOpacityNum))
        : 0
      let overlayGradientRangePct: number | undefined
      if (o.overlayGradientRangePct !== undefined && o.overlayGradientRangePct !== null) {
        const rn = Number(o.overlayGradientRangePct)
        if (Number.isFinite(rn)) overlayGradientRangePct = Math.max(1, Math.min(100, Math.round(rn)))
      }
      const contentColor = typeof o.contentColor === 'string' && o.contentColor ? o.contentColor : '#ffffff'
      const timeColor = typeof o.timeColor === 'string' && o.timeColor ? o.timeColor : '#ffffff'
      const dateColor = typeof o.dateColor === 'string' && o.dateColor ? o.dateColor : '#e2e8f0'
      const countdownColor = typeof o.countdownColor === 'string' && o.countdownColor ? o.countdownColor : '#ffffff'
      const textFillOpacity = (v: unknown): number | undefined => {
        const n = Number(v)
        if (!Number.isFinite(n)) return undefined
        const c = Math.max(0, Math.min(1, n))
        return c >= 1 ? undefined : c
      }
      const contentTextOpacity = textFillOpacity(o.contentTextOpacity)
      const timeTextOpacity = textFillOpacity(o.timeTextOpacity)
      const dateTextOpacity = textFillOpacity(o.dateTextOpacity)
      const countdownTextOpacity = textFillOpacity(o.countdownTextOpacity)
      const clampThemeFont = (raw: unknown, fallback: number) => {
        const n = Math.floor(Number(raw))
        const v = Number.isFinite(n) ? n : fallback
        return Math.max(1, Math.min(8000, v))
      }
      const contentFontSize = clampThemeFont(o.contentFontSize, 180)
      const timeFontSize = clampThemeFont(o.timeFontSize, 100)
      const dateFontSize = clampThemeFont(o.dateFontSize, 72)
      const countdownFontSize = clampThemeFont(o.countdownFontSize, 180)
      const textAlign =
        o.textAlign === 'left' ||
        o.textAlign === 'right' ||
        o.textAlign === 'start' ||
        o.textAlign === 'end' ||
        o.textAlign === 'justify'
          ? o.textAlign
          : 'center'
      const textVerticalAlign =
        o.textVerticalAlign === 'top' || o.textVerticalAlign === 'middle' || o.textVerticalAlign === 'bottom'
          ? o.textVerticalAlign
          : undefined
      const contentFontWeightNum = Number(o.contentFontWeight)
      const contentFontWeight = Number.isFinite(contentFontWeightNum) ? Math.max(100, Math.min(900, Math.round(contentFontWeightNum / 100) * 100)) : undefined
      const timeFontWeightNum = Number(o.timeFontWeight)
      const timeFontWeight = Number.isFinite(timeFontWeightNum) ? Math.max(100, Math.min(900, Math.round(timeFontWeightNum / 100) * 100)) : undefined
      const dateFontWeightNum = Number(o.dateFontWeight)
      const dateFontWeight = Number.isFinite(dateFontWeightNum) ? Math.max(100, Math.min(900, Math.round(dateFontWeightNum / 100) * 100)) : undefined
      const countdownFontWeightNum = Number(o.countdownFontWeight)
      const countdownFontWeight = Number.isFinite(countdownFontWeightNum) ? Math.max(100, Math.min(900, Math.round(countdownFontWeightNum / 100) * 100)) : undefined
      const contentFontItalic = o.contentFontItalic === true ? true : undefined
      const timeFontItalic = o.timeFontItalic === true ? true : undefined
      const dateFontItalic = o.dateFontItalic === true ? true : undefined
      const countdownFontItalic = o.countdownFontItalic === true ? true : undefined
      const contentUnderline = o.contentUnderline === true ? true : undefined
      const timeUnderline = o.timeUnderline === true ? true : undefined
      const dateUnderline = o.dateUnderline === true ? true : undefined
      const countdownUnderline = o.countdownUnderline === true ? true : undefined
      const contentTransform = normalizeTextTransform(o.contentTransform)
      const timeTransform = normalizeTextTransform(o.timeTransform)
      const dateTransform = normalizeTextTransform(o.dateTransform)
      const countdownTransform = normalizeTextTransform(o.countdownTransform)
      const alignOrUndef = (v: unknown): 'left' | 'center' | 'right' | 'start' | 'end' | 'justify' | undefined =>
        v === 'left' || v === 'right' || v === 'center' || v === 'start' || v === 'end' || v === 'justify' ? v : undefined
      const verticalAlignOrUndef = (v: unknown): 'top' | 'middle' | 'bottom' | undefined =>
        v === 'top' || v === 'middle' || v === 'bottom' ? v : undefined
      const contentTextAlign = alignOrUndef(o.contentTextAlign)
      const timeTextAlign = alignOrUndef(o.timeTextAlign)
      const countdownTextAlign = alignOrUndef(o.countdownTextAlign)
      const contentTextVerticalAlign = verticalAlignOrUndef(o.contentTextVerticalAlign)
      const timeTextVerticalAlign = verticalAlignOrUndef(o.timeTextVerticalAlign)
      const countdownTextVerticalAlign = verticalAlignOrUndef(o.countdownTextVerticalAlign)
      const letter = (v: unknown) => {
        const n = Number(v)
        return Number.isFinite(n) ? clampPopupThemeLetterSpacing(n) : undefined
      }
      const lh = (v: unknown) => {
        const n = Number(v)
        return Number.isFinite(n) ? clampPopupThemeLineHeight(n) : undefined
      }
      const contentLetterSpacing = letter(o.contentLetterSpacing)
      const timeLetterSpacing = letter(o.timeLetterSpacing)
      const countdownLetterSpacing = letter(o.countdownLetterSpacing)
      const contentLineHeight = lh(o.contentLineHeight)
      const timeLineHeight = lh(o.timeLineHeight)
      const countdownLineHeight = lh(o.countdownLineHeight)
      const formatVersionNum = Number(o.formatVersion)
      const formatVersion = Number.isFinite(formatVersionNum) && formatVersionNum >= 1 ? Math.floor(formatVersionNum) : undefined
      const previewStr = (v: unknown, maxLen: number): string | undefined => {
        if (typeof v !== 'string') return undefined
        const t = v.trim().slice(0, maxLen)
        return t.length > 0 ? t : undefined
      }
      const previewContentText = previewStr(o.previewContentText, 2000)
      const previewTimeText = previewStr(o.previewTimeText, 80)
      const previewDateText = previewStr(o.previewDateText, 120)
      const previewCountdownText = previewStr(o.previewCountdownText, 80)
      const contentTextEffects = normalizeLayerTextEffects(o.contentTextEffects)
      const timeTextEffects = normalizeLayerTextEffects(o.timeTextEffects)
      const countdownTextEffects = normalizeLayerTextEffects(o.countdownTextEffects)
      const pfpRaw = typeof o.popupFontFamilyPreset === 'string' ? o.popupFontFamilyPreset.trim() : ''
      const popupFontFamilyPreset = pfpRaw && isPopupFontFamilyPresetId(pfpRaw) ? pfpRaw : undefined
      const sysSan = typeof o.popupFontFamilySystem === 'string' ? sanitizeSystemFontFamilyName(o.popupFontFamilySystem) : ''
      const popupFontFamilySystem = sysSan.length > 0 ? sysSan : undefined
      const layerPreset = (raw: unknown) => {
        const t = typeof raw === 'string' ? raw.trim() : ''
        return t && isPopupFontFamilyPresetId(t) ? t : undefined
      }
      const layerSys = (raw: unknown) => {
        const s = typeof raw === 'string' ? sanitizeSystemFontFamilyName(raw) : ''
        return s.length > 0 ? s : undefined
      }
      const contentFontFamilyPreset = layerPreset(o.contentFontFamilyPreset)
      const contentFontFamilySystem = layerSys(o.contentFontFamilySystem)
      const timeFontFamilyPreset = layerPreset(o.timeFontFamilyPreset)
      const timeFontFamilySystem = layerSys(o.timeFontFamilySystem)
      const dateFontFamilyPreset = layerPreset(o.dateFontFamilyPreset)
      const dateFontFamilySystem = layerSys(o.dateFontFamilySystem)
      const countdownFontFamilyPreset = layerPreset(o.countdownFontFamilyPreset)
      const countdownFontFamilySystem = layerSys(o.countdownFontFamilySystem)
      const dateTextAlign = alignOrUndef(o.dateTextAlign)
      const dateTextVerticalAlign = verticalAlignOrUndef(o.dateTextVerticalAlign)
      const dateLetterSpacing = letter(o.dateLetterSpacing)
      const dateLineHeight = lh(o.dateLineHeight)
      const contentWritingMode = normalizePopupTextWritingMode(o.contentWritingMode)
      const timeWmRaw = normalizePopupTextWritingMode(o.timeWritingMode)
      const dateWmRaw = normalizePopupTextWritingMode(o.dateWritingMode)
      /** 时间/日期不开放竖排：落盘时丢弃 vertical-rl / vertical-lr */
      const timeWritingMode =
        timeWmRaw && isVerticalWritingMode(timeWmRaw) ? undefined : timeWmRaw
      const dateWritingMode = dateWmRaw && isVerticalWritingMode(dateWmRaw) ? undefined : dateWmRaw
      const countdownWritingMode = normalizePopupTextWritingMode(o.countdownWritingMode)
      const contentTextOrientation = normalizePopupTextOrientationMode(o.contentTextOrientation)
      const timeTextOrientation = normalizePopupTextOrientationMode(o.timeTextOrientation)
      const dateTextOrientation = normalizePopupTextOrientationMode(o.dateTextOrientation)
      const countdownTextOrientation = normalizePopupTextOrientationMode(o.countdownTextOrientation)
      const contentCombineUprightDigits =
        o.contentCombineUprightDigits === true ? true : o.contentCombineUprightDigits === false ? false : undefined
      const timeCombineUprightDigits =
        o.timeCombineUprightDigits === true ? true : o.timeCombineUprightDigits === false ? false : undefined
      const dateCombineUprightDigits =
        o.dateCombineUprightDigits === true ? true : o.dateCombineUprightDigits === false ? false : undefined
      const countdownCombineUprightDigits =
        o.countdownCombineUprightDigits === true ? true : o.countdownCombineUprightDigits === false ? false : undefined
      const dateTextEffects = normalizeLayerTextEffects(o.dateTextEffects)
      const dateShowYear = o.dateShowYear === false ? false : undefined
      const dateShowMonth = o.dateShowMonth === false ? false : undefined
      const dateShowDay = o.dateShowDay === false ? false : undefined
      const dateShowWeekday = o.dateShowWeekday === false ? false : undefined
      const dateYearFormat = o.dateYearFormat === '2-digit' ? '2-digit' : o.dateYearFormat === 'numeric' ? 'numeric' : undefined
      const dateMonthFormat =
        o.dateMonthFormat === 'long' || o.dateMonthFormat === 'short' || o.dateMonthFormat === '2-digit' || o.dateMonthFormat === 'numeric'
          ? o.dateMonthFormat
          : undefined
      const dateDayFormat = o.dateDayFormat === '2-digit' ? '2-digit' : o.dateDayFormat === 'numeric' ? 'numeric' : undefined
      const dateWeekdayFormat = o.dateWeekdayFormat === 'long' ? 'long' : o.dateWeekdayFormat === 'short' ? 'short' : undefined
      const dateLocaleRaw = typeof o.dateLocale === 'string' ? o.dateLocale.trim().slice(0, 40) : ''
      const dateLocale =
        dateLocaleRaw && /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]+)*$/.test(dateLocaleRaw) ? dateLocaleRaw : undefined
      const base: PopupTheme = {
        id,
        name,
        ...(formatVersion !== undefined ? { formatVersion } : {}),
        target,
        backgroundType,
        backgroundColor,
        imageSourceType,
        ...(imagePath ? { imagePath } : {}),
        ...(imageFolderPath ? { imageFolderPath } : {}),
        ...(imageFolderFiles && imageFolderFiles.length > 0 ? { imageFolderFiles } : {}),
        imageFolderPlayMode,
        imageFolderIntervalSec,
        ...(imageFolderCrossfadeSec !== 2 ? { imageFolderCrossfadeSec } : {}),
        ...(backgroundImageBlurPx > 0 ? { backgroundImageBlurPx } : {}),
        ...(backgroundImageTransform ? { backgroundImageTransform } : {}),
        ...(effectiveBackgroundImageXYKind ? { backgroundImageXYKind: effectiveBackgroundImageXYKind } : {}),
        overlayEnabled,
        overlayColor,
        overlayOpacity,
        overlayMode,
        overlayGradientDirection,
        overlayGradientAngleDeg,
        overlayGradientStartOpacity,
        ...(overlayGradientRangePct !== undefined ? { overlayGradientRangePct } : {}),
        overlayGradientEndOpacity,
        contentColor,
        timeColor,
        dateColor,
        countdownColor,
        ...(contentTextOpacity !== undefined ? { contentTextOpacity } : {}),
        ...(timeTextOpacity !== undefined ? { timeTextOpacity } : {}),
        ...(dateTextOpacity !== undefined ? { dateTextOpacity } : {}),
        ...(countdownTextOpacity !== undefined ? { countdownTextOpacity } : {}),
        contentFontSize,
        timeFontSize,
        dateFontSize,
        countdownFontSize,
        textAlign,
        ...(textVerticalAlign ? { textVerticalAlign } : {}),
        ...(contentFontWeight !== undefined ? { contentFontWeight } : {}),
        ...(timeFontWeight !== undefined ? { timeFontWeight } : {}),
        ...(dateFontWeight !== undefined ? { dateFontWeight } : {}),
        ...(countdownFontWeight !== undefined ? { countdownFontWeight } : {}),
        ...(contentFontItalic ? { contentFontItalic: true } : {}),
        ...(timeFontItalic ? { timeFontItalic: true } : {}),
        ...(dateFontItalic ? { dateFontItalic: true } : {}),
        ...(countdownFontItalic ? { countdownFontItalic: true } : {}),
        ...(contentUnderline ? { contentUnderline: true } : {}),
        ...(timeUnderline ? { timeUnderline: true } : {}),
        ...(dateUnderline ? { dateUnderline: true } : {}),
        ...(countdownUnderline ? { countdownUnderline: true } : {}),
        ...(contentTransform ? { contentTransform } : {}),
        ...(timeTransform ? { timeTransform } : {}),
        ...(dateTransform ? { dateTransform } : {}),
        ...(countdownTransform ? { countdownTransform } : {}),
        ...(contentTextAlign ? { contentTextAlign } : {}),
        ...(timeTextAlign ? { timeTextAlign } : {}),
        ...(dateTextAlign ? { dateTextAlign } : {}),
        ...(countdownTextAlign ? { countdownTextAlign } : {}),
        ...(contentTextVerticalAlign ? { contentTextVerticalAlign } : {}),
        ...(timeTextVerticalAlign ? { timeTextVerticalAlign } : {}),
        ...(dateTextVerticalAlign ? { dateTextVerticalAlign } : {}),
        ...(countdownTextVerticalAlign ? { countdownTextVerticalAlign } : {}),
        ...(contentLetterSpacing !== undefined ? { contentLetterSpacing } : {}),
        ...(timeLetterSpacing !== undefined ? { timeLetterSpacing } : {}),
        ...(dateLetterSpacing !== undefined ? { dateLetterSpacing } : {}),
        ...(countdownLetterSpacing !== undefined ? { countdownLetterSpacing } : {}),
        ...(contentLineHeight !== undefined ? { contentLineHeight } : {}),
        ...(timeLineHeight !== undefined ? { timeLineHeight } : {}),
        ...(dateLineHeight !== undefined ? { dateLineHeight } : {}),
        ...(countdownLineHeight !== undefined ? { countdownLineHeight } : {}),
        ...(contentWritingMode ? { contentWritingMode } : {}),
        ...(timeWritingMode ? { timeWritingMode } : {}),
        ...(dateWritingMode ? { dateWritingMode } : {}),
        ...(countdownWritingMode ? { countdownWritingMode } : {}),
        ...(contentTextOrientation ? { contentTextOrientation } : {}),
        ...(timeTextOrientation ? { timeTextOrientation } : {}),
        ...(dateTextOrientation ? { dateTextOrientation } : {}),
        ...(countdownTextOrientation ? { countdownTextOrientation } : {}),
        ...(contentCombineUprightDigits !== undefined ? { contentCombineUprightDigits } : {}),
        ...(timeCombineUprightDigits !== undefined ? { timeCombineUprightDigits } : {}),
        ...(dateCombineUprightDigits !== undefined ? { dateCombineUprightDigits } : {}),
        ...(countdownCombineUprightDigits !== undefined ? { countdownCombineUprightDigits } : {}),
        ...(previewContentText ? { previewContentText } : {}),
        ...(previewTimeText ? { previewTimeText } : {}),
        ...(previewDateText ? { previewDateText } : {}),
        ...(previewCountdownText ? { previewCountdownText } : {}),
        ...(contentTextEffects ? { contentTextEffects } : {}),
        ...(timeTextEffects ? { timeTextEffects } : {}),
        ...(dateTextEffects ? { dateTextEffects } : {}),
        ...(countdownTextEffects ? { countdownTextEffects } : {}),
        ...(popupFontFamilyPreset ? { popupFontFamilyPreset } : {}),
        ...(popupFontFamilySystem ? { popupFontFamilySystem } : {}),
        ...(contentFontFamilyPreset ? { contentFontFamilyPreset } : {}),
        ...(contentFontFamilySystem ? { contentFontFamilySystem } : {}),
        ...(timeFontFamilyPreset ? { timeFontFamilyPreset } : {}),
        ...(timeFontFamilySystem ? { timeFontFamilySystem } : {}),
        ...(dateFontFamilyPreset ? { dateFontFamilyPreset } : {}),
        ...(dateFontFamilySystem ? { dateFontFamilySystem } : {}),
        ...(countdownFontFamilyPreset ? { countdownFontFamilyPreset } : {}),
        ...(countdownFontFamilySystem ? { countdownFontFamilySystem } : {}),
        ...(dateShowYear === false ? { dateShowYear: false } : {}),
        ...(dateShowMonth === false ? { dateShowMonth: false } : {}),
        ...(dateShowDay === false ? { dateShowDay: false } : {}),
        ...(dateShowWeekday === false ? { dateShowWeekday: false } : {}),
        ...(dateYearFormat ? { dateYearFormat } : {}),
        ...(dateMonthFormat ? { dateMonthFormat } : {}),
        ...(dateDayFormat ? { dateDayFormat } : {}),
        ...(dateWeekdayFormat ? { dateWeekdayFormat } : {}),
        ...(dateLocale ? { dateLocale } : {}),
        /** 含空数组也必须落盘，否则读回 undefined 会再走 migrate 导致「删掉的层又回来了」 */
        ...(Array.isArray(o.layers) ? { layers: o.layers as PopupTheme['layers'] } : {}),
      }
      return ensureThemeLayers(base)
    })
    .filter((x): x is PopupTheme => x !== null)
  return mergeSystemBuiltinPopupThemes(out.length > 0 ? out : [])
}

function normalizeEntitlements(raw: unknown): AppEntitlements {
  if (!raw || typeof raw !== 'object') return { ...defaultEntitlements }
  const o = raw as Record<string, unknown>
  return {
    popupThemeLevel: o.popupThemeLevel === 'pro' ? 'pro' : 'free',
  }
}

const SETTINGS_LOCATION_OVERRIDE_BASENAME = 'settings-file-location.json'

/** 开发时写到项目根目录，便于确认；正式用 userData。不含「自定义路径」覆盖。 */
function getDefaultSettingsPathOnly(): string {
  const isDev = !!process.env.VITE_DEV_SERVER_URL
  if (isDev) {
    return join(process.cwd(), 'workbreak-settings.json')
  }
  return join(app.getPath('userData'), 'settings.json')
}

function getSettingsLocationOverridePath(): string {
  return join(app.getPath('userData'), SETTINGS_LOCATION_OVERRIDE_BASENAME)
}

function readResolvedSettingsDataFilePath(): string {
  const overrideFile = getSettingsLocationOverridePath()
  try {
    if (!existsSync(overrideFile)) return getDefaultSettingsPathOnly()
    const raw = JSON.parse(readFileSync(overrideFile, 'utf-8')) as Record<string, unknown>
    const p = raw.settingsFile
    if (typeof p !== 'string' || !p.trim()) return getDefaultSettingsPathOnly()
    const resolved = resolve(p.trim())
    if (!resolved) return getDefaultSettingsPathOnly()
    if (resolve(overrideFile) === resolved) return getDefaultSettingsPathOnly()
    return resolved
  } catch {
    return getDefaultSettingsPathOnly()
  }
}

function writeSettingsLocationOverride(targetSettingsFile: string): void {
  const abs = resolve(targetSettingsFile.trim())
  const overrideFile = getSettingsLocationOverridePath()
  const dir = dirname(overrideFile)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(overrideFile, JSON.stringify({ settingsFile: abs }, null, 2), 'utf-8')
}

function clearSettingsLocationOverrideFile(): void {
  const overrideFile = getSettingsLocationOverridePath()
  try {
    if (existsSync(overrideFile)) unlinkSync(overrideFile)
  } catch {
    /* ignore */
  }
}

/** 实际读写的配置文件绝对路径（可能为用户自定义） */
function getSettingsPath(): string {
  return readResolvedSettingsDataFilePath()
}

export function getSettingsFilePath(): string {
  return getSettingsPath()
}

/** 未应用自定义路径时的默认配置文件绝对路径 */
export function getDefaultSettingsFilePath(): string {
  return getDefaultSettingsPathOnly()
}

export function getSettingsPathMeta(): {
  currentPath: string
  defaultPath: string
  isCustom: boolean
} {
  const defaultPath = getDefaultSettingsPathOnly()
  const currentPath = readResolvedSettingsDataFilePath()
  return {
    currentPath,
    defaultPath,
    isCustom: resolve(currentPath) !== resolve(defaultPath),
  }
}

/**
 * 将当前内存中的完整设置写入目标路径，并记录为后续使用的配置文件。
 * 若目标已存在将被覆盖（由渲染进程确认）。
 */
export function saveCurrentSettingsToCustomPath(
  targetPath: string,
): { success: true } | { success: false; error: string } {
  try {
    const resolved = resolve(targetPath.trim())
    if (!resolved.toLowerCase().endsWith('.json')) {
      return { success: false, error: '请选择 .json 文件路径' }
    }
    if (resolve(getSettingsLocationOverridePath()) === resolved) {
      return { success: false, error: '不能使用应用内部路径文件' }
    }
    const current = getSettings()
    const dir = dirname(resolved)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(resolved, JSON.stringify(current, null, 2), 'utf-8')
    writeSettingsLocationOverride(resolved)
    return { success: true }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * 仅将配置文件指向已有文件（不覆盖内容）；下次 getSettings 从该文件读取。
 */
export function pointSettingsToExistingFile(
  targetPath: string,
): { success: true } | { success: false; error: string } {
  try {
    const resolved = resolve(targetPath.trim())
    if (resolve(getSettingsLocationOverridePath()) === resolved) {
      return { success: false, error: '不能使用应用内部路径文件' }
    }
    if (!existsSync(resolved)) return { success: false, error: '文件不存在' }
    const raw = readFileSync(resolved, 'utf-8')
    const data = JSON.parse(raw) as Record<string, unknown>
    if (!data || typeof data !== 'object') return { success: false, error: '不是有效的 JSON' }
    if (!Array.isArray(data.reminderCategories) && !hasLegacyFields(data)) {
      return { success: false, error: '缺少有效提醒配置字段' }
    }
    writeSettingsLocationOverride(resolved)
    return { success: true }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * 将当前配置写回默认路径并删除自定义指向；之后使用默认路径。
 */
export function resetSettingsFileToDefaultLocation(): { success: true } | { success: false; error: string } {
  try {
    const currentPath = readResolvedSettingsDataFilePath()
    const defaultPath = getDefaultSettingsPathOnly()
    const current = getSettings()
    const defDir = dirname(defaultPath)
    if (!existsSync(defDir)) mkdirSync(defDir, { recursive: true })
    writeFileSync(defaultPath, JSON.stringify(current, null, 2), 'utf-8')
    clearSettingsLocationOverrideFile()
    if (resolve(currentPath) !== resolve(defaultPath) && existsSync(currentPath)) {
      /* 保留用户原自定义文件不删除，仅不再引用 */
    }
    return { success: true }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function getSettings(): AppSettings {
  const path = getSettingsPath()
  if (!existsSync(path)) {
    if (process.env.VITE_DEV_SERVER_URL) console.log('[WorkBreak] 设置文件不存在，使用默认值。路径:', path)
    return {
      reminderCategories: defaultCategories,
      presetPools: defaultPresetPools,
      popupThemes: defaultPopupThemes,
      entitlements: defaultEntitlements,
      appTheme: 'system',
      launchAtLogin: false,
      forcedRestMode: false,
      desktopLiveWallpaperThemeId: undefined,
    }
  }
  try {
    const raw = readFileSync(path, 'utf-8')
    const data = JSON.parse(raw) as Record<string, unknown>
    if (hasLegacyFields(data) && (!Array.isArray(data.reminderCategories) || data.reminderCategories.length === 0)) {
      const migrated = migrateFromLegacy(data)
      const popupThemesM = normalizePopupThemes(data.popupThemes)
      const next: AppSettings = {
        reminderCategories: migrated,
        presetPools: normalizePresetPools(data.presetPools, migrated),
        popupThemes: popupThemesM,
        entitlements: normalizeEntitlements(data.entitlements),
        appTheme: normalizeAppTheme(data.appTheme),
        launchAtLogin: normalizeLaunchAtLogin(data.launchAtLogin),
        forcedRestMode: normalizeForcedRestMode(data.forcedRestMode),
        desktopLiveWallpaperThemeId: normalizePersistedDesktopWallpaperThemeId(data.desktopLiveWallpaperThemeId, popupThemesM),
      }
      const dir = dirname(path)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(path, JSON.stringify(next, null, 2), 'utf-8')
      if (process.env.VITE_DEV_SERVER_URL) console.log('[WorkBreak] 已迁移旧配置为新结构:', path)
      return next
    }
    const normalizedCategories = normalizeCategories(data.reminderCategories)
    const popupThemesNorm = normalizePopupThemes(data.popupThemes)
    const out: AppSettings = {
      reminderCategories: normalizedCategories,
      presetPools: normalizePresetPools(data.presetPools, normalizedCategories),
      popupThemes: popupThemesNorm,
      entitlements: normalizeEntitlements(data.entitlements),
      appTheme: normalizeAppTheme(data.appTheme),
      launchAtLogin: normalizeLaunchAtLogin(data.launchAtLogin),
      forcedRestMode: normalizeForcedRestMode(data.forcedRestMode),
      desktopLiveWallpaperThemeId: normalizePersistedDesktopWallpaperThemeId(data.desktopLiveWallpaperThemeId, popupThemesNorm),
    }
    if (process.env.VITE_DEV_SERVER_URL) console.log('[WorkBreak] 已读取设置:', path)
    return out
  } catch (e) {
    if (process.env.VITE_DEV_SERVER_URL) console.warn('[WorkBreak] 读取设置失败', e)
    return {
      reminderCategories: defaultCategories,
      presetPools: defaultPresetPools,
      popupThemes: defaultPopupThemes,
      entitlements: defaultEntitlements,
      appTheme: 'system',
      launchAtLogin: false,
      forcedRestMode: false,
      desktopLiveWallpaperThemeId: undefined,
    }
  }
}

/** 仅保留仍存在于主题库且 target 为 desktop 的 id */
function normalizePersistedDesktopWallpaperThemeId(
  raw: unknown,
  themes: PopupTheme[],
): string | undefined {
  if (typeof raw !== 'string') return undefined
  const s = raw.trim()
  if (!s) return undefined
  return themes.some((t) => t.id === s && t.target === 'desktop') ? s : undefined
}

function resolveNextDesktopLiveWallpaperThemeId(
  partial: unknown,
  currentId: string | undefined,
  themes: PopupTheme[],
): string | undefined {
  if (partial !== undefined) {
    if (partial === null) return undefined
    if (typeof partial !== 'string') return undefined
    const s = partial.trim()
    if (!s) return undefined
    return themes.some((t) => t.id === s && t.target === 'desktop') ? s : undefined
  }
  return normalizePersistedDesktopWallpaperThemeId(currentId, themes)
}

/** 规范化 appTheme 字段 */
function normalizeAppTheme(value: unknown): AppThemeSetting {
  if (value === 'light' || value === 'dark' || value === 'system') return value
  return 'system'
}

function normalizeLaunchAtLogin(value: unknown): boolean {
  return value === true
}

function normalizeForcedRestMode(value: unknown): boolean {
  return value === true
}

/**
 * 将「开机自启动」同步到操作系统登录项。
 * 开发模式 `app.isPackaged === false` 时跳过，避免把 Electron 可执行文件写入系统启动项。
 */
export function applyLaunchAtLoginFromSettings(settings: AppSettings): void {
  const enabled = Boolean(settings.launchAtLogin)
  if (!app.isPackaged) return
  try {
    if (process.platform === 'darwin') {
      app.setLoginItemSettings({
        openAtLogin: enabled,
        path: process.execPath,
        openAsHidden: enabled,
      })
    } else if (process.platform === 'win32') {
      app.setLoginItemSettings({
        openAtLogin: enabled,
        path: process.execPath,
        args: enabled ? ['--workbreak-boot-tray'] : [],
      })
    } else {
      app.setLoginItemSettings({
        openAtLogin: enabled,
        path: process.execPath,
      })
    }
  } catch (e) {
    console.warn('[WorkBreak] setLoginItemSettings 失败', e)
  }
}

export function setSettings(
  settings: Partial<AppSettings> & { desktopLiveWallpaperThemeId?: string | null },
): AppSettings {
  const current = getSettings()
  const nextReminderCategories =
    settings.reminderCategories !== undefined
      ? normalizeCategories(settings.reminderCategories)
      : current.reminderCategories
  const nextPopupThemes =
    settings.popupThemes !== undefined ? normalizePopupThemes(settings.popupThemes) : current.popupThemes
  const next: AppSettings = {
    reminderCategories: nextReminderCategories,
    presetPools:
      settings.presetPools !== undefined
        ? normalizePresetPools(settings.presetPools, nextReminderCategories)
        : current.presetPools,
    popupThemes: nextPopupThemes,
    entitlements: settings.entitlements !== undefined ? normalizeEntitlements(settings.entitlements) : current.entitlements,
    appTheme: settings.appTheme !== undefined ? normalizeAppTheme(settings.appTheme) : current.appTheme,
    launchAtLogin:
      settings.launchAtLogin !== undefined
        ? normalizeLaunchAtLogin(settings.launchAtLogin)
        : normalizeLaunchAtLogin(current.launchAtLogin),
    forcedRestMode:
      settings.forcedRestMode !== undefined
        ? normalizeForcedRestMode(settings.forcedRestMode)
        : normalizeForcedRestMode(current.forcedRestMode),
    desktopLiveWallpaperThemeId: resolveNextDesktopLiveWallpaperThemeId(
      settings.desktopLiveWallpaperThemeId,
      current.desktopLiveWallpaperThemeId,
      nextPopupThemes,
    ),
  }
  const path = getSettingsPath()
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(path, JSON.stringify(next, null, 2), 'utf-8')
  if (settings.launchAtLogin !== undefined) {
    applyLaunchAtLoginFromSettings(next)
  }
  return next
}
