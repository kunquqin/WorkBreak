import type { PopupTheme } from '../../../shared/settings'
import {
  SYSTEM_MAIN_POPUP_THEME_ID,
  SYSTEM_REST_POPUP_THEME_ID,
  SYSTEM_DESKTOP_POPUP_THEME_ID,
} from '../../../shared/settings'
import type { AppThemeSetting } from '../../../shared/settings'

/** 深色模式下系统内置主题的背景色（柔和黑替代纯黑） */
const DARK_MODE_BG_OVERRIDE: Record<string, string> = {
  [SYSTEM_MAIN_POPUP_THEME_ID]: '#1e1e1e',
  [SYSTEM_REST_POPUP_THEME_ID]: '#1e1e1e',
  [SYSTEM_DESKTOP_POPUP_THEME_ID]: '#1e1e1e',
}

/** 深色模式下系统内置主题的文字颜色（柔和白替代纯白） */
const DARK_MODE_TEXT_OVERRIDE: Record<string, string> = {
  [SYSTEM_MAIN_POPUP_THEME_ID]: '#f5f5f5',
  [SYSTEM_REST_POPUP_THEME_ID]: '#f5f5f5',
  [SYSTEM_DESKTOP_POPUP_THEME_ID]: '#f5f5f5',
}

/**
 * 根据当前 appTheme，对系统内置主题做运行时背景色覆盖。
 * 不修改 theme 对象本身，只返回覆盖后的副本（用于渲染）。
 */
export function resolveEffectiveTheme(
  theme: PopupTheme,
  appTheme: AppThemeSetting | undefined,
): PopupTheme {
  if (appTheme === 'dark') {
    const bgOverride = DARK_MODE_BG_OVERRIDE[theme.id]
    const textOverride = DARK_MODE_TEXT_OVERRIDE[theme.id]
    if (bgOverride || textOverride) {
      return {
        ...theme,
        backgroundColor: bgOverride ?? theme.backgroundColor,
        contentColor: textOverride ?? theme.contentColor,
        timeColor: textOverride ?? theme.timeColor,
        dateColor: textOverride ?? theme.dateColor,
        countdownColor: textOverride ?? theme.countdownColor,
      }
    }
  }
  return theme
}

/** 判断当前是否应使用深色模式（考虑 system 模式） */
export function shouldUseDarkMode(appTheme: AppThemeSetting | undefined): boolean {
  if (appTheme === 'dark') return true
  if (appTheme === 'light') return false
  // system
  if (typeof window !== 'undefined') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  }
  return false
}

/** 应用主题 class 到 document.documentElement */
export function applyAppThemeClass(appTheme: AppThemeSetting | undefined): void {
  if (typeof document === 'undefined') return
  document.documentElement.classList.remove('light', 'dark')
  if (appTheme === 'dark') {
    document.documentElement.classList.add('dark')
  } else if (appTheme === 'light') {
    document.documentElement.classList.add('light')
  }
  // 'system' 不添加 class，依赖 @media (prefers-color-scheme: dark)
}
