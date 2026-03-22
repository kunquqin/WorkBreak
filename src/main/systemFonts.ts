import { createRequire } from 'node:module'

/** 运行时从 node_modules 加载，勿用静态 import（否则 Vite 会误打包 font-list 子路径） */
const require = createRequire(import.meta.url)
type GetFontsFn = (options?: { disableQuoting?: boolean }) => Promise<string[]>

function getFontsFromModule(): GetFontsFn {
  const mod = require('font-list') as { getFonts: GetFontsFn }
  return mod.getFonts
}

let cache: { fonts: string[]; at: number } | null = null
const CACHE_MS = 120_000

/** 枚举本机已安装字体族名（去重、排序）；带短缓存避免重复调用 PowerShell/VBS。 */
export async function getSystemFontFamilies(): Promise<string[]> {
  const now = Date.now()
  if (cache && now - cache.at < CACHE_MS) return cache.fonts
  const getFonts = getFontsFromModule()
  const raw = await getFonts({ disableQuoting: true })
  const seen = new Set<string>()
  const out: string[] = []
  for (const f of raw) {
    const t = typeof f === 'string' ? f.trim() : String(f).trim()
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  cache = { fonts: out, at: now }
  return out
}

export function clearSystemFontListCache(): void {
  cache = null
}
