/**
 * 弹窗主题：克隆、fork、比较（主进程与渲染进程可共用）
 */
import type { PopupTheme } from './settings'

export function generatePopupThemeId(): string {
  return `theme-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/** 深拷贝并生成新 id，用于子项内「编辑主题」保存时另存，避免改写共享主题 */
export function clonePopupThemeForFork(source: PopupTheme, nameSuffix = '（副本）'): PopupTheme {
  const raw = JSON.parse(JSON.stringify(source)) as PopupTheme
  return {
    ...raw,
    id: generatePopupThemeId(),
    name: `${source.name}${nameSuffix}`,
    formatVersion: raw.formatVersion ?? 1,
  }
}

/** 用于判断全屏编辑后是否需写入新主题（忽略 id / name） */
export function popupThemeContentEquals(a: PopupTheme, b: PopupTheme): boolean {
  const strip = (t: PopupTheme) => {
    const { id: _i, name: _n, ...rest } = t
    return JSON.stringify(rest)
  }
  return strip(a) === strip(b)
}
