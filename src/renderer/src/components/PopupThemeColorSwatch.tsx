import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type ChangeEvent,
  type CSSProperties,
} from 'react'
import type { PopupThemeEditUpdateMeta } from '../hooks/usePopupThemeEditHistory'

function safeHexColor(raw: string | undefined, fallback: string): string {
  const t = (raw ?? '').trim()
  return /^#[0-9a-fA-F]{3}$/.test(t) || /^#[0-9a-fA-F]{6}$/.test(t) ? t : fallback
}

export type PopupThemeColorSwatchProps = {
  value: string | undefined
  /** 第二参：`skipHistory: true` 时不压撤销栈（拾色器连续 input）；首帧为 false 保证一次可撤销 */
  onChange: (hex: string, meta?: PopupThemeEditUpdateMeta) => void
  disabled?: boolean
  /** 追加 class；默认高度与面板内 `px-2 py-1 text-sm` 输入框一致（h-9），宽度紧凑 */
  className?: string
  style?: CSSProperties
}

/**
 * 主题编辑器统一色块。拾色器拖动会高频触发变更：用 rAF 合并更新，并对撤销栈首帧压快照、后续 `skipHistory`，
 * 避免每帧 `structuredClone(整主题)` 导致卡顿。
 *
 * 须使用 React `onChange`（不可仅用原生 `addEventListener`）：否则 `value` 受控时 React 会警告并可能按只读处理。
 */
export function PopupThemeColorSwatch({
  value,
  onChange,
  disabled,
  className = '',
  style,
}: PopupThemeColorSwatchProps) {
  const safe = safeHexColor(value, '#ffffff')
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  /** 本会话是否已发过「带历史」的首帧（同一拾色器会话内后续均为 skipHistory） */
  const sessionCommittedRef = useRef(false)
  const rafRef = useRef(0)
  const pendingHexRef = useRef<string | null>(null)
  const lastPropHexRef = useRef(value)

  useLayoutEffect(() => {
    if (value !== lastPropHexRef.current) {
      lastPropHexRef.current = value
      sessionCommittedRef.current = false
    }
  }, [value])

  const flushPending = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
    const pv = pendingHexRef.current
    pendingHexRef.current = null
    if (pv != null && sessionCommittedRef.current) {
      onChangeRef.current(pv, { skipHistory: true })
    }
  }, [])

  const endSession = useCallback(() => {
    flushPending()
    sessionCommittedRef.current = false
  }, [flushPending])

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      if (disabled) return
      const v = e.target.value
      if (!sessionCommittedRef.current) {
        sessionCommittedRef.current = true
        onChangeRef.current(v, { skipHistory: false })
        return
      }
      pendingHexRef.current = v
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = 0
          const pv = pendingHexRef.current
          pendingHexRef.current = null
          if (pv != null) {
            onChangeRef.current(pv, { skipHistory: true })
          }
        })
      }
    },
    [disabled],
  )

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
      pendingHexRef.current = null
    }
  }, [])

  return (
    <div
      className={`relative h-9 w-12 max-w-full shrink-0 overflow-hidden rounded border border-slate-300 bg-white ${disabled ? 'pointer-events-none opacity-50' : ''} ${className}`.trim()}
      style={style}
    >
      <input
        type="color"
        value={safe}
        onChange={handleChange}
        onBlur={endSession}
        disabled={disabled}
        className="absolute inset-0 box-border h-full w-full cursor-pointer border-0 p-0 [color-scheme:light]"
        aria-label="选择颜色"
      />
    </div>
  )
}
