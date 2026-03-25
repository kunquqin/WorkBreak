import type { PopupTheme } from '@/types'

export function invokeThemeFullscreenPreview(theme: PopupTheme): void {
  const api = window.electronAPI?.openThemeEditorFullscreenPreview
  if (!api) {
    window.alert('请在 Electron 应用内使用全屏预览。')
    return
  }
  void (async () => {
    let payload: PopupTheme
    try {
      payload = structuredClone(theme) as PopupTheme
    } catch {
      payload = JSON.parse(JSON.stringify(theme)) as PopupTheme
    }
    const r = await api(payload)
    if (!r.success) window.alert(r.error || '全屏预览打开失败')
  })()
}

export function ThemeFullscreenPreviewGlyph({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
    </svg>
  )
}

type ThemeFullscreenPreviewIconButtonProps = {
  theme: PopupTheme
  /** 工具条：与预览区同宽、右对齐；缩略图：absolute + group-hover 由 className 传入 */
  className?: string
  iconClassName?: string
  title?: string
  /** 用于缩略图格子：避免触发卡片点击/拖拽 */
  stopCardPointer?: boolean
}

export function ThemeFullscreenPreviewIconButton({
  theme,
  className = '',
  iconClassName = 'h-3.5 w-3.5',
  title = '全屏预览（与到点弹窗一致，移动鼠标显示关闭按钮）',
  stopCardPointer = false,
}: ThemeFullscreenPreviewIconButtonProps) {
  return (
    <button
      type="button"
      className={className}
      title={title}
      aria-label="全屏预览当前壁纸"
      onClick={(e) => {
        if (stopCardPointer) {
          e.stopPropagation()
          e.preventDefault()
        }
        invokeThemeFullscreenPreview(theme)
      }}
      onPointerDown={(e) => {
        if (stopCardPointer) e.stopPropagation()
      }}
    >
      <ThemeFullscreenPreviewGlyph className={iconClassName} />
    </button>
  )
}

/** 传入 `ThemePreviewEditor` 的 `toolbarTrailing`，与对齐按钮同一行、靠右 */
export function ThemeFullscreenPreviewToolbarButton({ theme }: { theme: PopupTheme }) {
  return (
    <ThemeFullscreenPreviewIconButton
      theme={theme}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
      iconClassName="h-3.5 w-3.5"
    />
  )
}
