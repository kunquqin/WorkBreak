/**
 * 弹窗文字字体：按层（主文案 / 时间 / 倒计时）预设或本机族名；旧版全局字段仅作回退。
 */
import type { PopupTheme } from './settings'

export const DEFAULT_POPUP_FONT_PRESET_ID = 'system_yahei'

export type PopupTextFontLayer = 'content' | 'time' | 'date' | 'countdown'

export const POPUP_FONT_FAMILY_OPTIONS: ReadonlyArray<{ id: string; label: string; css: string }> = [
  {
    id: 'system_yahei',
    label: '系统默认（雅黑 + 系统 UI）',
    css: 'system-ui, "Microsoft YaHei", sans-serif',
  },
  {
    id: 'cross_platform_ui',
    label: '跨平台系统 UI（Segoe / 苹方 / 雅黑）',
    css: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  },
  {
    id: 'yahei_first',
    label: '微软雅黑优先',
    css: '"Microsoft YaHei", "PingFang SC", "Heiti SC", system-ui, sans-serif',
  },
  {
    id: 'simsun',
    label: '宋体（SimSun / 华文宋体等）',
    css: 'SimSun, "Songti SC", "STSong", "Noto Serif SC", serif',
  },
  {
    id: 'kaiti',
    label: '楷体',
    css: '"KaiTi", "Kaiti SC", "STKaiti", serif',
  },
  {
    id: 'fangsong',
    label: '仿宋',
    css: '"FangSong", "FangSong_GB2312", "STFangsong", serif',
  },
  {
    id: 'dengxian',
    label: '等线（DengXian）',
    css: '"DengXian", "等线", "Microsoft YaHei", sans-serif',
  },
  {
    id: 'noto_sans_sc',
    label: '思源黑体（Noto Sans SC）',
    css: '"Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei", sans-serif',
  },
]

const PRESET_CSS = new Map(POPUP_FONT_FAMILY_OPTIONS.map((o) => [o.id, o.css]))

export function isPopupFontFamilyPresetId(id: string): boolean {
  return PRESET_CSS.has(id)
}

/** 持久化前清洗：去危险字符、限长；与主进程 normalize 一致 */
export function sanitizeSystemFontFamilyName(raw: string): string {
  return raw
    .trim()
    .slice(0, 200)
    .replace(/["\\;\r\n{}<>]/g, '')
    .trim()
}

function quoteFontFamilyForCss(name: string): string {
  const s = sanitizeSystemFontFamilyName(name)
  if (!s) return ''
  const esc = s.replace(/"/g, "'")
  return `"${esc}"`
}

function resolvePresetCss(presetId: string | undefined): string {
  if (presetId && PRESET_CSS.has(presetId)) return PRESET_CSS.get(presetId)!
  return PRESET_CSS.get(DEFAULT_POPUP_FONT_PRESET_ID)!
}

function stackWithSystemFont(quotedName: string): string {
  return `${quotedName}, "Microsoft YaHei", system-ui, sans-serif`
}

/** 列表项内用该族名渲染预览（与弹窗 resolve 栈一致） */
export function systemFontListPreviewStackCss(raw: string): string {
  const q = quoteFontFamilyForCss(sanitizeSystemFontFamilyName(raw))
  if (!q) return `"Microsoft YaHei", system-ui, sans-serif`
  return stackWithSystemFont(q)
}

/** 该层是否已有自己的 preset/system（无则 content/time 可回退旧全局 popupFont*） */
export function hasLayerOwnPopupFont(theme: PopupTheme | undefined, layer: PopupTextFontLayer): boolean {
  if (!theme) return false
  if (layer === 'content') {
    return Boolean(theme.contentFontFamilyPreset || theme.contentFontFamilySystem?.trim())
  }
  if (layer === 'time') {
    return Boolean(theme.timeFontFamilyPreset || theme.timeFontFamilySystem?.trim())
  }
  if (layer === 'date') {
    return Boolean(theme.dateFontFamilyPreset || theme.dateFontFamilySystem?.trim())
  }
  return Boolean(theme.countdownFontFamilyPreset || theme.countdownFontFamilySystem?.trim())
}

function layerSystemRaw(theme: PopupTheme | undefined, layer: PopupTextFontLayer): string | undefined {
  if (!theme) return undefined
  if (layer === 'content') return theme.contentFontFamilySystem?.trim()
  if (layer === 'time') return theme.timeFontFamilySystem?.trim()
  if (layer === 'date') return theme.dateFontFamilySystem?.trim()
  return theme.countdownFontFamilySystem?.trim()
}

function layerPresetRaw(theme: PopupTheme | undefined, layer: PopupTextFontLayer): string | undefined {
  if (!theme) return undefined
  if (layer === 'content') return theme.contentFontFamilyPreset
  if (layer === 'time') return theme.timeFontFamilyPreset
  if (layer === 'date') return theme.dateFontFamilyPreset
  return theme.countdownFontFamilyPreset
}

/**
 * 弹窗 HTML / 预览用某层 `font-family`。
 * 优先该层 system → 该层 preset →（仅 content/time）旧全局 → 默认预设。
 */
export function resolvePopupFontFamilyCss(
  theme: PopupTheme | undefined,
  layer: PopupTextFontLayer,
): string {
  const sys = layerSystemRaw(theme, layer)
  if (sys) {
    const q = quoteFontFamilyForCss(sys)
    if (q) return stackWithSystemFont(q)
  }
  const preset = layerPresetRaw(theme, layer)
  if (preset && PRESET_CSS.has(preset)) return PRESET_CSS.get(preset)!

  if (!hasLayerOwnPopupFont(theme, layer)) {
    const legacySys = theme?.popupFontFamilySystem?.trim()
    if (legacySys && (layer === 'content' || layer === 'time' || layer === 'date')) {
      const q = quoteFontFamilyForCss(legacySys)
      if (q) return stackWithSystemFont(q)
    }
    const legacyPreset = layer === 'countdown' ? undefined : theme?.popupFontFamilyPreset
    if (legacyPreset && PRESET_CSS.has(legacyPreset)) return PRESET_CSS.get(legacyPreset)!
  }

  return resolvePresetCss(undefined)
}

/** 装饰文本层：仅有 preset/system 字段，无 theme 分层回退 */
export function resolveDecoFontFamilyCss(presetId?: string, systemName?: string): string {
  const sys = systemName?.trim()
  if (sys) {
    const q = quoteFontFamilyForCss(sys)
    if (q) return stackWithSystemFont(q)
  }
  if (presetId && PRESET_CSS.has(presetId)) return PRESET_CSS.get(presetId)!
  return resolvePresetCss(undefined)
}

/** 面板里「预设」下拉的 value：分层优先，否则旧全局（仅当该层尚未有自己的分层字段） */
export function popupFontPresetSelectValue(theme: PopupTheme, layer: PopupTextFontLayer): string {
  const own = layerPresetRaw(theme, layer)
  if (own && PRESET_CSS.has(own)) return own
  if (layer !== 'countdown' && !hasLayerOwnPopupFont(theme, layer)) {
    const g = theme.popupFontFamilyPreset
    if (g && PRESET_CSS.has(g)) return g
  }
  return DEFAULT_POPUP_FONT_PRESET_ID
}

/** 面板里本机字体输入框受控值 */
export function popupFontSystemInputValue(theme: PopupTheme, layer: PopupTextFontLayer): string {
  const own = layerSystemRaw(theme, layer)
  if (own) return own
  if (layer !== 'countdown' && !hasLayerOwnPopupFont(theme, layer)) {
    return theme.popupFontFamilySystem ?? ''
  }
  return ''
}

/** 某层「本机」页签是否激活 */
export function popupFontLayerUsesSystemTab(theme: PopupTheme, layer: PopupTextFontLayer): boolean {
  if (layerSystemRaw(theme, layer)) return true
  if (layer === 'countdown') return false
  if (hasLayerOwnPopupFont(theme, layer)) return false
  return Boolean(theme.popupFontFamilySystem?.trim())
}
