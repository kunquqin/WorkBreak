import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { PopupTheme } from '../types'
import { ThemeStudioThumbnail } from './ThemeStudio'

/** 悬浮缩略图宽度（约原 208px 的 2 倍，与视口钳制共用） */
const FLOAT_W = 416
const FLOAT_PAD = 10

function clampFloatPos(clientX: number, clientY: number): { x: number; y: number } {
  const w = typeof window !== 'undefined' ? window.innerWidth : 1200
  const h = typeof window !== 'undefined' ? window.innerHeight : 800
  const rightX = clientX + 14
  let x = Math.min(rightX, w - FLOAT_W - FLOAT_PAD)
  x = Math.max(FLOAT_PAD, x)
  let y = clientY
  y = Math.min(y, h - FLOAT_PAD)
  y = Math.max(FLOAT_PAD, y)
  return { x, y }
}

export type PopupThemeSelectWithHoverPreviewProps = {
  options: PopupTheme[]
  value: string
  onChange: (themeId: string) => void
  previewImageUrlMap: Record<string, string>
  previewViewportWidth: number
  popupPreviewAspect: '16:9' | '16:10' | '21:9' | '32:9' | '3:2' | '4:3'
  /** sm：列表行内 / text-xs；md：子项弹窗 */
  size?: 'sm' | 'md'
  disabled?: boolean
  id?: string
  'aria-label'?: string
}

export function PopupThemeSelectWithHoverPreview({
  options,
  value,
  onChange,
  previewImageUrlMap,
  previewViewportWidth,
  popupPreviewAspect,
  size = 'md',
  disabled = false,
  id,
  'aria-label': ariaLabel,
}: PopupThemeSelectWithHoverPreviewProps) {
  const [open, setOpen] = useState(false)
  const [hoverTheme, setHoverTheme] = useState<PopupTheme | null>(null)
  const [floatPos, setFloatPos] = useState({ x: 0, y: 0 })
  const wrapRef = useRef<HTMLDivElement>(null)

  const selected = options.find((t) => t.id === value) ?? options[0]

  const triggerCls =
    size === 'sm'
      ? 'w-full rounded border border-slate-300 bg-white px-2 py-1 text-left text-xs text-slate-700'
      : 'w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-left text-sm'

  const itemCls =
    size === 'sm'
      ? 'w-full px-2 py-1 text-left text-xs hover:bg-slate-50 hover:font-bold'
      : 'w-full px-2 py-1.5 text-left text-sm hover:bg-slate-50 hover:font-bold'

  useEffect(() => {
    if (!open) {
      setHoverTheme(null)
      return
    }
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const onListPointerMove = useCallback((e: React.PointerEvent<HTMLUListElement>) => {
    setFloatPos(clampFloatPos(e.clientX, e.clientY))
  }, [])

  const onOpenChange = useCallback(() => {
    if (disabled || options.length === 0) return
    setOpen((v) => !v)
  }, [disabled, options.length])

  return (
    <div ref={wrapRef} className="relative min-w-0 flex-1">
      <button
        type="button"
        id={id}
        disabled={disabled || options.length === 0}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={onOpenChange}
        className={`${triggerCls} flex items-center justify-between gap-2 disabled:cursor-not-allowed disabled:opacity-50`}
      >
          <span className="min-w-0 truncate">{(selected?.name ?? value) || '（无）'}</span>
        <span className="shrink-0 text-slate-400" aria-hidden>
          ▾
        </span>
      </button>
      {open && options.length > 0 && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-full z-[60000] mt-1 max-h-60 overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg"
          onPointerMove={onListPointerMove}
          onPointerLeave={() => setHoverTheme(null)}
        >
          {options.map((t) => (
            <li key={t.id} role="option" aria-selected={t.id === value}>
              <button
                type="button"
                className={`${itemCls} ${t.id === value ? 'bg-slate-100 font-medium' : ''}`}
                onClick={() => {
                  onChange(t.id)
                  setOpen(false)
                  setHoverTheme(null)
                }}
                onPointerEnter={() => setHoverTheme(t)}
                onPointerMove={(e) => setFloatPos(clampFloatPos(e.clientX, e.clientY))}
              >
                {t.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {hoverTheme &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[70000] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl ring-1 ring-black/5"
            style={{
              left: floatPos.x,
              top: floatPos.y,
              transform: 'translateY(-50%)',
              width: FLOAT_W,
              maxWidth: 'calc(100vw - 20px)',
            }}
          >
            <ThemeStudioThumbnail
              theme={hoverTheme}
              previewImageUrlMap={previewImageUrlMap}
              previewViewportWidth={previewViewportWidth}
              popupPreviewAspect={popupPreviewAspect}
              skipRevealSequence
            />
          </div>,
          document.body,
        )}
    </div>
  )
}
