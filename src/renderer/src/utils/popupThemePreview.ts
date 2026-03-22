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

export function rendererSafePreviewImageUrl(imageKey: string, urlByPath: Record<string, string>): string {
  const key = (imageKey ?? '').trim()
  if (!key) return ''
  const fromMap = urlByPath[key]
  if (fromMap) return fromMap
  if (/^(https?|data):/i.test(key)) return key
  if (isRendererBlockedLocalImagePath(key)) return ''
  return toPreviewImageUrl(key)
}

