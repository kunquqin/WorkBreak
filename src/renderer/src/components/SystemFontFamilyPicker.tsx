import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { systemFontListPreviewStackCss } from '../../../shared/popupThemeFonts'

type DropPos = { top: number; left: number; width: number }

/** 仅列表区域限高，避免整页被原生 datalist 撑出屏外 */
const LIST_SCROLL_MAX_CSS = 'min(40vh, 280px)'

/**
 * 必须高于全屏编辑层，否则列表渲染在 document.body 上仍会被压在遮罩下面「像没数据」。
 * ThemeStudio z-[250000]、AddSubReminderModal z-[200000]
 */
const PORTAL_Z_BACKDROP = 280_000
const PORTAL_Z_LIST = 280_001

export type SystemFontFamilyPickerProps = {
  value: string
  onChange: (next: string) => void
  /** null = 尚未拉取；[] = 已拉取但为空 */
  fonts: string[] | null
  fontsLoading?: boolean
  mode?: 'preset' | 'system'
  onModeChange?: (next: 'preset' | 'system') => void
  presetOptions?: ReadonlyArray<{ id: string; label: string; css?: string }>
  presetValue?: string
  onPresetChange?: (presetId: string) => void
  placeholder?: string
  disabled?: boolean
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`}
      aria-hidden
    >
      <path d="M3.5 5.25L7 8.75l3.5-3.5" />
    </svg>
  )
}

/**
 * 本机字体：整行可点展开；右侧小三角表示开/合；列表项用对应 font-family 渲染名称便于辨认。
 */
export function SystemFontFamilyPicker({
  value,
  onChange,
  fonts,
  fontsLoading = false,
  mode = 'system',
  onModeChange,
  presetOptions,
  presetValue,
  onPresetChange,
  placeholder = '例如：Consolas',
  disabled = false,
}: SystemFontFamilyPickerProps) {
  const anchorRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [listFilter, setListFilter] = useState('')
  const [pos, setPos] = useState<DropPos | null>(null)

  const updatePos = useCallback(() => {
    const el = anchorRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({
      top: r.bottom + 4,
      left: r.left,
      width: Math.max(260, r.width),
    })
  }, [])

  const openPicker = useCallback(() => {
    if (disabled) return
    updatePos()
    setOpen(true)
  }, [disabled, updatePos])

  useLayoutEffect(() => {
    if (!open) return
    updatePos()
    const onScroll = () => updatePos()
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open, updatePos])

  useEffect(() => {
    if (!open) return
    setListFilter('')
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const filteredSystemFonts = useMemo(() => {
    const list = fonts ?? []
    const q = listFilter.trim().toLowerCase()
    if (!q) return list
    return list.filter((f) => f.toLowerCase().includes(q))
  }, [fonts, listFilter])
  const filteredPresetOptions = useMemo(() => {
    const list = presetOptions ?? []
    const q = listFilter.trim().toLowerCase()
    if (!q) return list
    return list.filter((item) => item.label.toLowerCase().includes(q) || item.id.toLowerCase().includes(q))
  }, [presetOptions, listFilter])

  const handleRowClick = () => {
    if (disabled) return
    if (!open) openPicker()
  }

  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (disabled) return
    if (open) setOpen(false)
    else openPicker()
  }
  const displayValue = useMemo(() => {
    if (mode === 'preset') {
      const hit = (presetOptions ?? []).find((item) => item.id === presetValue)
      return hit?.label ?? ''
    }
    return value
  }, [mode, presetOptions, presetValue, value])

  const portal =
    open &&
    pos &&
    createPortal(
      <>
        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          className="fixed inset-0 cursor-default bg-transparent"
          style={{ zIndex: PORTAL_Z_BACKDROP }}
          onClick={() => setOpen(false)}
        />
        <div
          role="listbox"
          className="fixed flex flex-col rounded-md border border-slate-200 bg-white text-left shadow-lg"
          style={{
            top: pos.top,
            left: pos.left,
            width: pos.width,
            zIndex: PORTAL_Z_LIST,
          }}
        >
          {onModeChange && presetOptions && presetOptions.length > 0 && (
            <div className="shrink-0 border-b border-slate-100 p-1.5">
              <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5">
                <button
                  type="button"
                  onClick={() => onModeChange('preset')}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                    mode === 'preset' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  预设组合
                </button>
                <button
                  type="button"
                  onClick={() => onModeChange('system')}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                    mode === 'system' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  本机已安装
                </button>
              </div>
            </div>
          )}
          <div className="shrink-0 border-b border-slate-100 p-1.5">
            <input
              type="search"
              autoFocus
              value={listFilter}
              onChange={(e) => setListFilter(e.target.value)}
              placeholder={mode === 'preset' ? '筛选预设名称…' : '筛选字体名…'}
              className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 outline-none focus:border-slate-400"
            />
          </div>
          <div
            className="overflow-y-auto overflow-x-hidden overscroll-contain py-1"
            style={{ maxHeight: LIST_SCROLL_MAX_CSS }}
          >
            {mode === 'preset' ? (
              <>
                {(presetOptions == null || presetOptions.length === 0) && (
                  <p className="px-2 py-2 text-xs text-amber-700">暂无预设字体组合。</p>
                )}
                {filteredPresetOptions.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    className={`block w-full truncate px-2.5 py-2 text-left text-sm leading-snug hover:bg-slate-100 ${
                      presetValue === item.id ? 'bg-slate-100 text-slate-900' : 'text-slate-800'
                    }`}
                    style={item.css ? { fontFamily: item.css } : undefined}
                    title={item.label}
                    onClick={() => {
                      onPresetChange?.(item.id)
                      setOpen(false)
                    }}
                  >
                    {item.label}
                  </button>
                ))}
                {presetOptions != null && presetOptions.length > 0 && filteredPresetOptions.length === 0 && (
                  <p className="px-2 py-2 text-xs text-slate-500">无匹配预设，可调整筛选词。</p>
                )}
              </>
            ) : (
              <>
                {fontsLoading && fonts === null && (
                  <p className="px-2 py-2 text-xs text-slate-500">正在读取本机字体…</p>
                )}
                {!fontsLoading && fonts !== null && fonts.length === 0 && (
                  <p className="px-2 py-2 text-xs text-amber-700">未读到字体列表，可直接在上方输入框填写字体全名。</p>
                )}
                {filteredSystemFonts.map((f) => (
                  <button
                    key={f}
                    type="button"
                    role="option"
                    className="block w-full truncate px-2.5 py-2 text-left text-[15px] leading-snug text-slate-900 hover:bg-slate-100"
                    style={{ fontFamily: systemFontListPreviewStackCss(f) }}
                    title={f}
                    onClick={() => {
                      onChange(f)
                      setOpen(false)
                    }}
                  >
                    {f}
                  </button>
                ))}
                {fonts != null && fonts.length > 0 && filteredSystemFonts.length === 0 && (
                  <p className="px-2 py-2 text-xs text-slate-500">无匹配项，可缩小筛选或手填。</p>
                )}
              </>
            )}
          </div>
        </div>
      </>,
      document.body,
    )

  return (
    <div
      ref={anchorRef}
      role="combobox"
      aria-expanded={open}
      aria-haspopup="listbox"
      className={`flex min-h-[38px] items-stretch rounded-md border border-slate-300 bg-white transition-colors ${
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:border-slate-400'
      }`}
      onClick={handleRowClick}
    >
      <input
        type="text"
        disabled={disabled}
        value={displayValue}
        onChange={(e) => {
          if (mode === 'preset') return
          onChange(e.target.value.trim())
        }}
        placeholder={mode === 'preset' ? '选择预设组合…' : placeholder}
        readOnly={mode === 'preset'}
        className={`min-w-0 flex-1 border-0 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:ring-0 disabled:cursor-not-allowed ${
          mode === 'preset' ? 'cursor-pointer' : 'cursor-text'
        }`}
      />
      <button
        type="button"
        tabIndex={-1}
        data-font-picker-chevron
        disabled={disabled}
        title={open ? '收起' : '展开字体列表'}
        aria-label={open ? '收起字体列表' : '展开字体列表'}
        className="flex shrink-0 items-center justify-center border-l border-slate-200 px-2.5 text-slate-500 hover:bg-slate-50 disabled:pointer-events-none"
        onClick={handleChevronClick}
      >
        <ChevronIcon open={open} />
      </button>
      {portal}
    </div>
  )
}
