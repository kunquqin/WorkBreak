export function toPreviewImageUrl(inputPath?: string): string {
  const raw = (inputPath ?? '').trim()
  if (!raw) return ''

  // Already a URL-like value.
  if (/^(file|https?|data):/i.test(raw)) return raw

  const slashPath = raw.replace(/\\/g, '/')
  if (/^[a-zA-Z]:\//.test(slashPath)) {
    // Windows absolute path: E:/foo/bar.jpg -> file:///E:/foo/bar.jpg
    return `file:///${encodeURI(slashPath)}`
  }

  return encodeURI(slashPath)
}

/** 渲染进程 img/src：禁止对本地盘路径使用 file://（Chromium 会拦截）；须用 resolvePreviewImageUrl 写入的 data: 或 https */
export function isRendererBlockedLocalImagePath(p: string): boolean {
  const s = (p ?? '').trim()
  if (!s) return false
  if (/^file:/i.test(s)) return true
  const slash = s.replace(/\\/g, '/')
  if (/^[a-zA-Z]:\//.test(slash)) return true
  if (slash.startsWith('//')) return true
  if (slash.startsWith('/') && !/^\/\//.test(slash)) return true
  return false
}

import type { PopupTheme } from '../types'
import type { ImageThemeLayer } from '../../../shared/popupThemeLayers'

/** 主题内所有需在预览中 resolve 的本地图片路径（背景 + 图层图片） */
export function collectPopupThemeImagePathsForPreview(theme: PopupTheme): string[] {
  const s = new Set<string>()
  if (theme.backgroundType === 'image') {
    if (theme.imageSourceType !== 'folder') {
      const p = (theme.imagePath ?? '').trim()
      if (p) s.add(p)
    }
    for (const f of theme.imageFolderFiles ?? []) {
      if (typeof f === 'string' && f.trim()) s.add(f.trim())
    }
  }
  for (const L of theme.layers ?? []) {
    if (L.kind === 'image') {
      const p = ((L as ImageThemeLayer).imagePath ?? '').trim()
      if (p) s.add(p)
    }
  }
  return [...s]
}

/**
 * 主题工坊列表缩略图需等待解码的图片路径（文件夹背景仅首张，与 readOnly 预览一致；仅可见装饰图）。
 */
export function collectThemeStudioThumbnailImagePaths(theme: PopupTheme): string[] {
  const out = new Set<string>()
  if (theme.backgroundType === 'image') {
    if (theme.imageSourceType !== 'folder') {
      const p = (theme.imagePath ?? '').trim()
      if (p) out.add(p)
    } else {
      for (const f of theme.imageFolderFiles ?? []) {
        if (typeof f === 'string' && f.trim()) {
          out.add(f.trim())
          break
        }
      }
    }
  }
  for (const L of theme.layers ?? []) {
    if (L.kind !== 'image' || !L.visible) continue
    const p = ((L as ImageThemeLayer).imagePath ?? '').trim()
    if (p) out.add(p)
  }
  return [...out]
}

export function rendererSafePreviewImageUrl(imageKey: string, urlByPath: Record<string, string>): string {
  const key = (imageKey ?? '').trim()
  if (!key) return ''
  const fromMap = urlByPath[key]
  if (fromMap) return fromMap
  if (/^(https?|data):/i.test(key)) return key
  if (isRendererBlockedLocalImagePath(key)) return ''
  return toPreviewImageUrl(key)
}

