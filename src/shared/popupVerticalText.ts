/**
 * 主文案 / 装饰文本 / 绑定层：竖排（writing-mode）与真弹窗、预览共用的 CSS 与校验。
 */
import type { PopupTextAlign, PopupTextOrientationMode, PopupTextWritingMode } from './settings'

export const WB_TEXT_INNER = 'data-wb-text-inner'

export function normalizePopupTextWritingMode(raw: unknown): PopupTextWritingMode | undefined {
  if (raw === 'horizontal-tb' || raw === 'vertical-rl' || raw === 'vertical-lr') return raw
  return undefined
}

export function normalizePopupTextOrientationMode(raw: unknown): PopupTextOrientationMode | undefined {
  if (raw === 'mixed' || raw === 'upright' || raw === 'sideways') return raw
  return undefined
}

export function isVerticalWritingMode(wm: PopupTextWritingMode | undefined): boolean {
  return wm === 'vertical-rl' || wm === 'vertical-lr'
}

/** 竖排内层不用 justify（浏览器支持差），统一按居中处理 */
export function textAlignForVerticalInner(align: PopupTextAlign): PopupTextAlign {
  return align === 'justify' ? 'center' : align
}

/** flex 主轴为 column 时：justify = 屏垂直方向（上/中/下） */
export function flexJustifyFromVerticalScreen(vertical: 'top' | 'middle' | 'bottom'): string {
  if (vertical === 'top') return 'flex-start'
  if (vertical === 'bottom') return 'flex-end'
  return 'center'
}

/** flex 主轴为 column 时：align-items = 屏水平方向（左/中/右） */
export function flexAlignItemsFromTextAlign(align: PopupTextAlign): string {
  if (align === 'justify') return 'stretch'
  if (align === 'left' || align === 'start') return 'flex-start'
  if (align === 'right' || align === 'end') return 'flex-end'
  return 'center'
}

export type VerticalInnerBoxOpts = {
  writingMode: PopupTextWritingMode
  textOrientation: PopupTextOrientationMode | undefined
  combineUpright: boolean | undefined
  textAlign: PopupTextAlign
  letterSpacingPx: number
  lineHeight: number
}

export type VerticalInnerLayoutMode = 'popup' | 'previewEdit'

/**
 * 竖排时内层承载 writing-mode / 字距 / 行高 / 对齐；外层仅 flex 定位 + 字号色等继承。
 * shortLayer：时间/日期/倒计时等，与 textBoxLayoutCss 一致用 overflow:hidden，避免假滚动条。
 * 非 short：弹窗/只读预览用 `overflow-x:hidden; overflow-y:auto`，减轻块轴假横向条。
 * **预览内编辑**：块轴需能长出**下一列**，`overflow-x` 改为 visible（否则像「不能自动换列」）。
 */
export function verticalTextInnerBoxCss(opts: VerticalInnerBoxOpts, shortLayer: boolean): string {
  const ori = opts.textOrientation ?? 'mixed'
  const combine = opts.combineUpright ? 'text-combine-upright: all;' : ''
  const overflowPair = shortLayer ? 'overflow: hidden;' : 'overflow-x: hidden; overflow-y: auto;'
  return [
    'display: block;',
    'box-sizing: border-box;',
    'min-width: 0;',
    'min-height: 0;',
    'max-width: 100%;',
    'max-height: 100%;',
    overflowPair,
    `writing-mode: ${opts.writingMode};`,
    `text-orientation: ${ori};`,
    combine,
    `text-align: ${opts.textAlign};`,
    `letter-spacing: ${opts.letterSpacingPx}px;`,
    `line-height: ${opts.lineHeight};`,
    'white-space: pre-wrap;',
    'word-wrap: break-word;',
    'overflow-wrap: break-word;',
    'word-break: keep-all;',
  ].join(' ')
}

/** 供 ThemePreviewEditor 等渲染进程作 `style={...}`，避免 shared 依赖 react */
export function verticalTextInnerDomStyle(
  opts: VerticalInnerBoxOpts,
  shortLayer: boolean,
  layout: VerticalInnerLayoutMode = 'popup',
): Record<string, string | number> {
  const ta = opts.textAlign
  const ori = opts.textOrientation ?? 'mixed'
  const overflowNonShort =
    layout === 'previewEdit'
      ? ({ overflowX: 'visible' as const, overflowY: 'auto' as const } as const)
      : ({ overflowX: 'hidden' as const, overflowY: 'auto' as const } as const)
  const base: Record<string, string | number> = {
    display: 'block',
    boxSizing: 'border-box',
    minWidth: 0,
    minHeight: 0,
    maxWidth: '100%',
    maxHeight: '100%',
    ...(shortLayer ? { overflow: 'hidden' as const } : overflowNonShort),
    writingMode: opts.writingMode,
    textOrientation: ori,
    textAlign: ta,
    letterSpacing: `${opts.letterSpacingPx}px`,
    lineHeight: opts.lineHeight,
    whiteSpace: 'pre-wrap',
    wordWrap: 'break-word',
    overflowWrap: 'break-word',
    wordBreak: 'keep-all',
  }
  if (opts.combineUpright) base.textCombineUpright = 'all'
  return base
}
