/**
 * 弹窗主题「日期」绑定层：用 Intl.DateTimeFormat 按用户开关与格式输出，与系统/主题 locale 对齐。
 */
import type { PopupTheme } from './settings'

export type PopupThemeDatePreviewMode = 'live' | 'preview'

/** BCP 47 粗校验，非法则回落 undefined（浏览器/Node 默认 locale） */
function safeLocaleTag(raw: string | undefined): string | undefined {
  const t = raw?.trim()
  if (!t || t.length > 40) return undefined
  if (!/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]+)*$/.test(t)) return undefined
  return t
}

/**
 * @param mode `preview` 且主题设了 `previewDateText` 时返回固定文案（工坊截图稳定）；真弹窗用 `live`。
 */
export function formatPopupThemeDateString(
  theme: PopupTheme,
  at: Date,
  mode: PopupThemeDatePreviewMode = 'live',
): string {
  if (mode === 'preview') {
    const fixed = theme.previewDateText?.trim()
    if (fixed) return fixed
  }

  const locales = safeLocaleTag(theme.dateLocale)

  const showY = theme.dateShowYear !== false
  const showM = theme.dateShowMonth !== false
  const showD = theme.dateShowDay !== false
  const showW = theme.dateShowWeekday !== false

  if (!showY && !showM && !showD && !showW) return ''

  const opts: Intl.DateTimeFormatOptions = {}
  if (showY) {
    opts.year = theme.dateYearFormat === '2-digit' ? '2-digit' : 'numeric'
  }
  if (showM) {
    const mf = theme.dateMonthFormat
    if (mf === 'long') opts.month = 'long'
    else if (mf === 'short') opts.month = 'short'
    else if (mf === '2-digit') opts.month = '2-digit'
    else opts.month = 'numeric'
  }
  if (showD) {
    opts.day = theme.dateDayFormat === '2-digit' ? '2-digit' : 'numeric'
  }
  if (showW) {
    opts.weekday = theme.dateWeekdayFormat === 'long' ? 'long' : 'short'
  }

  try {
    return new Intl.DateTimeFormat(locales, opts).format(at)
  } catch {
    return new Intl.DateTimeFormat(undefined, opts).format(at)
  }
}

/** 应用预设到主题 patch（仅日期相关字段） */
export type PopupThemeDatePresetId = 'locale_zh' | 'locale_en' | 'iso' | 'weekday_only'

export function popupThemeDatePresetPatch(preset: PopupThemeDatePresetId): Partial<PopupTheme> {
  switch (preset) {
    case 'locale_zh':
      return {
        dateLocale: 'zh-CN',
        dateShowYear: true,
        dateShowMonth: true,
        dateShowDay: true,
        dateShowWeekday: true,
        dateYearFormat: 'numeric',
        dateMonthFormat: 'numeric',
        dateDayFormat: 'numeric',
        dateWeekdayFormat: 'short',
      }
    case 'locale_en':
      return {
        dateLocale: 'en-US',
        dateShowYear: true,
        dateShowMonth: true,
        dateShowDay: true,
        dateShowWeekday: true,
        dateYearFormat: 'numeric',
        dateMonthFormat: 'short',
        dateDayFormat: 'numeric',
        dateWeekdayFormat: 'short',
      }
    case 'iso':
      // 使用 en-CA：常见引擎下年月日为 YYYY-MM-DD，且星期名为英文。
      // 勿用 sv-SE：否则用户勾选「星期」时会出现瑞典语（如 tisdag = 星期二）。
      return {
        dateLocale: 'en-CA',
        dateShowYear: true,
        dateShowMonth: true,
        dateShowDay: true,
        dateShowWeekday: false,
        dateYearFormat: 'numeric',
        dateMonthFormat: '2-digit',
        dateDayFormat: '2-digit',
        dateWeekdayFormat: 'short',
      }
    case 'weekday_only':
      return {
        dateShowYear: false,
        dateShowMonth: false,
        dateShowDay: false,
        dateShowWeekday: true,
        dateWeekdayFormat: 'long',
      }
    default:
      return {}
  }
}
