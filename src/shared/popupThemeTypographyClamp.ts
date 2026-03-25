/**
 * 弹窗/壁纸主题：字间距（px，与 CSS letter-spacing 一致）、行高（无单位倍数，与 CSS line-height 一致）。
 * 面板滑杆与 normalize 共用，避免 UI 与落盘后被主进程裁回导致「拉满才动一点点」。
 */
export const POPUP_THEME_LETTER_SPACING_MIN = -10
export const POPUP_THEME_LETTER_SPACING_MAX = 200

export const POPUP_THEME_LINE_HEIGHT_MIN = 0.5
export const POPUP_THEME_LINE_HEIGHT_MAX = 8

export function clampPopupThemeLetterSpacing(n: number): number {
  return Math.max(POPUP_THEME_LETTER_SPACING_MIN, Math.min(POPUP_THEME_LETTER_SPACING_MAX, n))
}

export function clampPopupThemeLineHeight(n: number): number {
  return Math.max(POPUP_THEME_LINE_HEIGHT_MIN, Math.min(POPUP_THEME_LINE_HEIGHT_MAX, n))
}
