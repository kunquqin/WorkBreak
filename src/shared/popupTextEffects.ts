/**
 * 弹窗文字描边 / 阴影（与 Keynote 类工具参数对齐），供主进程 HTML 与渲染进程预览共用。
 */
import type { PopupLayerTextEffects, PopupTheme } from './settings'

export const POPUP_TEXT_STROKE_WIDTH_MAX = 24
export const POPUP_TEXT_SHADOW_BLUR_MAX = 80
export const POPUP_TEXT_SHADOW_SIZE_MAX = 48
export const POPUP_TEXT_SHADOW_DISTANCE_MAX = 160

export type TextEffectLayer = 'content' | 'time' | 'countdown'

export function getLayerTextEffects(
  theme: PopupTheme | undefined,
  layer: TextEffectLayer,
): PopupLayerTextEffects | undefined {
  if (!theme) return undefined
  if (layer === 'content') return theme.contentTextEffects
  if (layer === 'time') return theme.timeTextEffects
  return theme.countdownTextEffects
}

/** #RGB / #RRGGBB → rgba() */
export function hexToRgba(hex: string, alpha: number): string {
  let h = hex.replace('#', '').trim()
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const n = parseInt(h, 16)
  if (!Number.isFinite(n) || h.length !== 6) return `rgba(255,255,255,${Math.max(0, Math.min(1, alpha))})`
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  const a = Math.max(0, Math.min(1, alpha))
  return `rgba(${r},${g},${b},${a})`
}

function isHexColor(s: string | undefined): s is string {
  return typeof s === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s.trim())
}

function numOr(v: unknown, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function buildTextShadowValue(e: PopupLayerTextEffects): string {
  const rad = (numOr(e.shadowAngleDeg, 45) * Math.PI) / 180
  const dist = Math.max(0, Math.min(POPUP_TEXT_SHADOW_DISTANCE_MAX, numOr(e.shadowDistancePx, 6)))
  const dx = Math.round(dist * Math.cos(rad) * 1000) / 1000
  const dy = Math.round(dist * Math.sin(rad) * 1000) / 1000
  const blur = Math.max(0, Math.min(POPUP_TEXT_SHADOW_BLUR_MAX, numOr(e.shadowBlurPx, 4)))
  const size = Math.max(0, Math.min(POPUP_TEXT_SHADOW_SIZE_MAX, numOr(e.shadowSizePx, 0)))
  const col = isHexColor(e.shadowColor) ? e.shadowColor : '#000000'
  const op = Math.max(0, Math.min(1, numOr(e.shadowOpacity, 0.45)))
  const rgba = hexToRgba(col, op)
  const effBlur = blur + size * 0.65
  const layers: string[] = [`${dx}px ${dy}px ${effBlur}px ${rgba}`]
  if (size > 0.5) {
    layers.push(`0 0 ${size}px ${hexToRgba(col, op * 0.55)}`)
  }
  return layers.join(', ')
}

/** 写入弹窗内联样式表（分号分隔，末尾带分号） */
export function layerTextEffectsCss(theme: PopupTheme | undefined, layer: TextEffectLayer): string {
  const e = getLayerTextEffects(theme, layer)
  if (!e) return ''
  const parts: string[] = []
  if (e.strokeEnabled === true) {
    const w = Math.max(0, Math.min(POPUP_TEXT_STROKE_WIDTH_MAX, Number(e.strokeWidthPx) || 0))
    if (w > 0) {
      const col = isHexColor(e.strokeColor) ? e.strokeColor : '#000000'
      const op = Math.max(0, Math.min(1, numOr(e.strokeOpacity, 1)))
      parts.push(`-webkit-text-stroke: ${w}px ${hexToRgba(col, op)}`)
      parts.push('paint-order: stroke fill')
    }
  }
  if (e.shadowEnabled === true) {
    const sh = buildTextShadowValue(e)
    if (sh) parts.push(`text-shadow: ${sh}`)
  }
  return parts.length ? `${parts.join('; ')};` : ''
}

/** React 内联 style（与 layerTextEffectsCss 一致） */
export function layerTextEffectsReactStyle(
  theme: PopupTheme | undefined,
  layer: TextEffectLayer,
): Record<string, string | undefined> {
  const e = getLayerTextEffects(theme, layer)
  const out: Record<string, string | undefined> = {}
  if (!e) return out
  if (e.strokeEnabled === true) {
    const w = Math.max(0, Math.min(POPUP_TEXT_STROKE_WIDTH_MAX, Number(e.strokeWidthPx) || 0))
    if (w > 0) {
      const col = isHexColor(e.strokeColor) ? e.strokeColor : '#000000'
      const op = Math.max(0, Math.min(1, numOr(e.strokeOpacity, 1)))
      out.WebkitTextStroke = `${w}px ${hexToRgba(col, op)}`
      out.paintOrder = 'stroke fill'
    }
  }
  if (e.shadowEnabled === true) {
    const sh = buildTextShadowValue(e)
    if (sh) out.textShadow = sh
  }
  return out
}
