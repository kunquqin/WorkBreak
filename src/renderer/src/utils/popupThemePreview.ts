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

