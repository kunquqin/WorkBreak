/**
 * 弹窗主题「日期」绑定层：用 Intl 按 locale 组合年/月/日/星期，与主进程、预览共用。
 */
import type { PopupTheme } from './settings'

function normalizeLocaleTag(raw: string | undefined): string | undefined {
  if (!raw?.trim()) return undefined
  return raw.trim().replace(/_/g, '-').slice(0, 40)
}

/**
 * 根据主题开关与格式选项生成单行日期文案；全部关闭时返回空串。
 * @param systemLocale 主进程可传 `app.getLocale()`（如 zh_CN → 由调用方替换为 zh-CN）；渲染进程可传 `navigator.language`
 */
export function formatPopupThemeDateLine(theme: PopupTheme, date: Date, systemLocale?: string): string {
  const locale = normalizeLocaleTag(theme.dateLocale) ?? normalizeLocaleTag(systemLocale) ?? undefined

  const showY = theme.dateShowYear !== false
  const showM = theme.dateShowMonth !== false
  const showD = theme.dateShowDay !== false
  const showW = theme.dateShowWeekday !== false

  if (!showY && !showM && !showD && !showW) return ''

  const yStyle: Intl.DateTimeFormatOptions['year'] =
    theme.dateYearFormat === '2-digit' ? '2-digit' : 'numeric'

  const mRaw = theme.dateMonthFormat
  const mStyle: Intl.DateTimeFormatOptions['month'] =
    mRaw === 'numeric' || mRaw === '2-digit' || mRaw === 'short' || mRaw === 'long' ? mRaw : 'long'

  const dStyle: Intl.DateTimeFormatOptions['day'] =
    theme.dateDayFormat === '2-digit' ? '2-digit' : 'numeric'

  const wStyle: Intl.DateTimeFormatOptions['weekday'] =
    theme.dateWeekdayFormat === 'short' ? 'short' : 'long'

  const opts: Intl.DateTimeFormatOptions = {}
  if (showY) opts.year = yStyle
  if (showM) opts.month = mStyle
  if (showD) opts.day = dStyle
  if (showW) opts.weekday = wStyle

  try {
    return new Intl.DateTimeFormat(locale, opts).format(date)
  } catch {
    return new Intl.DateTimeFormat(undefined, opts).format(date)
  }
}
