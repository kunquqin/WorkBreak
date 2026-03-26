import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import {
  DndContext,
  DragOverlay,
  type DragCancelEvent,
  type DragEndEvent,
  type DragStartEvent,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { restrictToWindowEdges } from '@dnd-kit/modifiers'
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from '@dnd-kit/sortable'
import type { Transform } from '@dnd-kit/utilities'
import {
  collectPopupThemeImagePathsForPreview,
  collectThemeStudioThumbnailImagePaths,
  rendererSafePreviewImageUrl,
} from '../utils/popupThemePreview'
import {
  ThemeFullscreenPreviewIconButton,
  ThemeFullscreenPreviewToolbarButton,
} from './ThemeFullscreenPreviewControl'
import {
  cloneDefaultPopupThemePreservingIdentity,
  SYSTEM_DESKTOP_POPUP_THEME_ID,
  SYSTEM_MAIN_POPUP_THEME_ID,
  SYSTEM_REST_POPUP_THEME_ID,
  type PopupTheme,
  type PopupThemeTarget,
} from '../types'
import { ThemePreviewEditor, type TextElementKey } from './ThemePreviewEditor'
import { PopupThemeEditorPanel } from './PopupThemeEditorPanel'
import { clonePopupThemeForFork, popupThemeContentEquals } from '../../../shared/popupThemeUtils'
import { addImageDecorationLayer, mergeContentThemePatchIntoBindingTextLayer } from '../../../shared/popupThemeLayers'
import { ensureThemeLayers } from '../../../shared/settings'
import { usePopupThemeEditHistory, type PopupThemeEditUpdateMeta } from '../hooks/usePopupThemeEditHistory'

export type PopupPreviewAspect = '16:9' | '16:10' | '21:9' | '32:9' | '3:2' | '4:3'
export type PopupPreviewAspectPreset = 'system' | PopupPreviewAspect

const POPUP_PREVIEW_ASPECT_RATIO_MAP: Record<PopupPreviewAspect, number> = {
  '16:9': 16 / 9,
  '16:10': 16 / 10,
  '21:9': 21 / 9,
  '32:9': 32 / 9,
  '3:2': 3 / 2,
  '4:3': 4 / 3,
}

function popupPreviewAspectRatio(aspect: PopupPreviewAspect): number {
  return POPUP_PREVIEW_ASPECT_RATIO_MAP[aspect]
}

/** 列表缩略图槽位：主题未指定或纯黑底时的兜底底色，按亮/深色主题自适配。 */
const THEME_STUDIO_THUMB_SLOT_FALLBACK_BG_LIGHT = '#e2e8f0'
const THEME_STUDIO_THUMB_SLOT_FALLBACK_BG_DARK = '#242424'

function getIsDarkModeActive(): boolean {
  if (typeof document === 'undefined') return false
  const root = document.documentElement
  if (root.classList.contains('dark')) return true
  if (root.classList.contains('light')) return false
  if (typeof window !== 'undefined') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  }
  return false
}

function themeStudioThumbSlotBaseBg(theme: Pick<PopupTheme, 'backgroundColor'>, isDarkMode: boolean): string {
  const fallback = isDarkMode ? THEME_STUDIO_THUMB_SLOT_FALLBACK_BG_DARK : THEME_STUDIO_THUMB_SLOT_FALLBACK_BG_LIGHT
  const c = theme.backgroundColor?.trim()
  if (!c) return fallback
  const n = c.replace(/\s/g, '').toLowerCase()
  if (n === '#000' || n === '#000000') return fallback
  return c
}

/** 与设置页大类排序一致：可变高网格项禁用 scale 形变，仅平移 */
function sortableTranslateOnly(t: Transform | null): string | undefined {
  if (!t) return undefined
  const x = t.x ?? 0
  const y = t.y ?? 0
  if (x === 0 && y === 0) return undefined
  return `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`
}

/** 与设置页主题工坊「+休息/结束/桌面壁纸」按钮底色、描边一致；hover 略加深（整张卡 group-hover） */
function themeStudioListCardFooterClasses(target: PopupThemeTarget): {
  footerTone: string
  footerHoverTone: string
  subTone: string
} {
  if (target === 'main') {
    return {
      footerTone: 'border-emerald-300 bg-emerald-100',
      footerHoverTone: 'group-hover:border-emerald-400 group-hover:bg-emerald-200',
      subTone: 'text-emerald-900',
    }
  }
  if (target === 'desktop') {
    return {
      footerTone: 'border-violet-300 bg-violet-100',
      footerHoverTone: 'group-hover:border-violet-400 group-hover:bg-violet-200',
      subTone: 'text-violet-900',
    }
  }
  return {
    footerTone: 'border-blue-300 bg-blue-100',
    footerHoverTone: 'group-hover:border-blue-400 group-hover:bg-blue-200',
    subTone: 'text-blue-900',
  }
}

function isStudioListBuiltinThemeId(id: string): boolean {
  return (
    id === SYSTEM_MAIN_POPUP_THEME_ID ||
    id === SYSTEM_REST_POPUP_THEME_ID ||
    id === SYSTEM_DESKTOP_POPUP_THEME_ID
  )
}

const STUDIO_LIST_MENU_W = 168
const STUDIO_LIST_MENU_CLOSE_MS = 280

type StudioListOverflowMenuProps = {
  onOpen: () => void
  onRename: () => void
  onDuplicate: () => void
  onRemove: () => void
  canDelete: boolean
  deleteDisabledTitle?: string
  /** 菜单开关：用于缩略图角标在弹出层打开时保持可见 */
  onOpenChange?: (open: boolean) => void
}

function StudioListOverflowMenu({
  onOpen,
  onRename,
  onDuplicate,
  onRemove,
  canDelete,
  deleteDisabledTitle,
  onOpenChange,
}: StudioListOverflowMenuProps) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const emitOpen = useCallback(
    (next: boolean) => {
      onOpenChange?.(next)
      setOpen(next)
    },
    [onOpenChange],
  )

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  const scheduleClose = useCallback(() => {
    clearCloseTimer()
    closeTimerRef.current = window.setTimeout(() => emitOpen(false), STUDIO_LIST_MENU_CLOSE_MS)
  }, [clearCloseTimer, emitOpen])

  const [coords, setCoords] = useState({ top: 0, left: 0 })

  const measureAndSetCoords = useCallback(() => {
    const el = btnRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const margin = 8
    let left = r.right - STUDIO_LIST_MENU_W
    left = Math.max(margin, Math.min(left, window.innerWidth - STUDIO_LIST_MENU_W - margin))
    const estH = 200
    let top = r.bottom + 1
    if (top + estH > window.innerHeight - margin) {
      top = Math.max(margin, r.top - estH - 1)
    }
    setCoords({ top, left })
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    measureAndSetCoords()
    const onReposition = () => measureAndSetCoords()
    window.addEventListener('scroll', onReposition, true)
    window.addEventListener('resize', onReposition)
    return () => {
      window.removeEventListener('scroll', onReposition, true)
      window.removeEventListener('resize', onReposition)
    }
  }, [open, measureAndSetCoords])

  useEffect(() => {
    if (!open) return
    const onDocDown = (e: globalThis.MouseEvent) => {
      const n = e.target as Node
      if (btnRef.current?.contains(n) || menuRef.current?.contains(n)) return
      emitOpen(false)
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [open, emitOpen])

  useEffect(() => {
    if (!open) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') emitOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, emitOpen])

  const itemCls =
    'block w-full px-3 py-2 text-left text-sm text-slate-800 transition-colors hover:bg-slate-50 focus:bg-slate-50 focus:outline-none'

  const run = (fn: () => void) => {
    clearCloseTimer()
    emitOpen(false)
    fn()
  }

  const onTriggerClick = (e: ReactMouseEvent) => {
    e.stopPropagation()
    setOpen((v) => {
      const next = !v
      onOpenChange?.(next)
      if (next) queueMicrotask(() => measureAndSetCoords())
      return next
    })
  }

  const menu =
    open &&
    createPortal(
      <div
        ref={menuRef}
        role="menu"
        className="fixed z-[300000] w-[168px] rounded-md border border-slate-200 bg-white py-1 shadow-lg"
        style={{ top: coords.top, left: coords.left }}
        onMouseEnter={clearCloseTimer}
        onMouseLeave={scheduleClose}
      >
        <button type="button" role="menuitem" className={itemCls} onClick={() => run(onOpen)}>
          打开
        </button>
        <button type="button" role="menuitem" className={itemCls} onClick={() => run(onRename)}>
          重命名
        </button>
        <button type="button" role="menuitem" className={itemCls} onClick={() => run(onDuplicate)}>
          创建副本
        </button>
        <button
          type="button"
          role="menuitem"
          disabled={!canDelete}
          title={deleteDisabledTitle}
          className={`${itemCls} disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent ${
            canDelete ? 'text-red-600 hover:bg-red-50 focus:bg-red-50' : 'text-slate-400'
          }`}
          onClick={() => {
            if (!canDelete) return
            run(onRemove)
          }}
        >
          删除壁纸
        </button>
      </div>,
      document.body,
    )

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="flex h-6 w-6 shrink-0 items-center justify-center border-0 bg-transparent p-0 text-slate-500 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-400"
        aria-haspopup="menu"
        aria-expanded={open}
        title="更多操作"
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onTriggerClick}
        onMouseEnter={() => {
          clearCloseTimer()
          onOpenChange?.(true)
          setOpen(true)
          queueMicrotask(() => measureAndSetCoords())
        }}
        onMouseLeave={scheduleClose}
      >
        <span className="flex items-center gap-0.5" aria-hidden>
          <span className="h-1 w-1 rounded-full bg-current" />
          <span className="h-1 w-1 rounded-full bg-current" />
          <span className="h-1 w-1 rounded-full bg-current" />
        </span>
      </button>
      {menu}
    </>
  )
}

/** 捕获阶段聚焦，避免 Electron/父级 stopPropagation 叠加导致首击进不了输入框 */
function focusInputOnPointerDownCapture(e: ReactPointerEvent<HTMLInputElement>) {
  if (e.button !== 0) return
  e.currentTarget.focus({ preventScroll: true })
}

function themeDraftDirty(baseline: PopupTheme, draft: PopupTheme): boolean {
  if ((baseline.name ?? '').trim() !== (draft.name ?? '').trim()) return true
  return !popupThemeContentEquals(baseline, draft)
}

/** 左预览 + 右参数（不含顶栏） */
export type ThemeStudioEditWorkspaceProps = {
  theme: PopupTheme
  surfaceRef: RefObject<HTMLDivElement | null>
  previewViewportWidth: number
  previewImageUrlMap: Record<string, string>
  popupPreviewAspect: PopupPreviewAspect
  popupPreviewAspectPreset?: PopupPreviewAspectPreset
  /** 有则显示在预览区顶栏、全屏按钮左侧 */
  onPopupPreviewAspectChange?: (aspect: PopupPreviewAspectPreset) => void
  onUpdateTheme: (themeId: string, patch: Partial<PopupTheme>) => void
  replaceThemeFull: (theme: PopupTheme) => void
  selectedElements: TextElementKey[]
  onSelectElements: (keys: TextElementKey[]) => void
  onPickImageFile: () => void | Promise<void>
  onPickImageFolder: () => void | Promise<void>
  editHistoryResetSignal?: number
}

export function ThemeStudioEditWorkspace({
  theme,
  surfaceRef,
  previewViewportWidth,
  previewImageUrlMap,
  popupPreviewAspect,
  popupPreviewAspectPreset = 'system',
  onPopupPreviewAspectChange,
  onUpdateTheme,
  replaceThemeFull,
  selectedElements,
  onSelectElements,
  onPickImageFile,
  onPickImageFolder,
  editHistoryResetSignal = 0,
}: ThemeStudioEditWorkspaceProps) {
  const [selectedDecorationLayerId, setSelectedDecorationLayerId] = useState<string | null>(null)
  const [selectedStructuralLayerId, setSelectedStructuralLayerId] = useState<string | null>(null)
  const [snapEnabled, setSnapEnabled] = useState(true)
  useEffect(() => {
    setSelectedDecorationLayerId(null)
    setSelectedStructuralLayerId(null)
  }, [theme.id, editHistoryResetSignal])

  const { wrappedOnUpdateTheme, undo, redo, canUndo, canRedo, historyRev } = usePopupThemeEditHistory(
    theme,
    onUpdateTheme,
    replaceThemeFull,
    20,
    editHistoryResetSignal,
  )
  const mergedWrappedOnUpdateTheme = useCallback(
    (id: string, patch: Partial<PopupTheme>, meta?: PopupThemeEditUpdateMeta) => {
      if (id !== theme.id) {
        wrappedOnUpdateTheme(id, patch)
        return
      }
      const layerSync = mergeContentThemePatchIntoBindingTextLayer(theme, patch)
      wrappedOnUpdateTheme(id, layerSync ? { ...patch, ...layerSync } : patch, meta)
    },
    [theme.id, theme, wrappedOnUpdateTheme],
  )

  const delegatedEditHistory = useMemo(
    () => ({ undo, redo, canUndo, canRedo }),
    [undo, redo, canUndo, canRedo, historyRev],
  )

  /** 不传 previewLabels：由 ThemePreviewEditor 按 theme.preview* 与占位标签回落，避免 `pl` 强行写死「提醒」盖住主题内已保存的示例文案 */
  const handlePickDecoImage = useCallback(() => {
    void (async () => {
      const api = window.electronAPI
      const r = await api?.pickPopupImageFile?.()
      if (!r?.success) return
      const layers = ensureThemeLayers(theme).layers ?? []
      const oldIds = new Set(layers.map((l) => l.id))
      const patch = addImageDecorationLayer(theme, r.path)
      if (!patch?.layers) return
      mergedWrappedOnUpdateTheme(theme.id, patch)
      const added = patch.layers.find((l) => l.kind === 'image' && !oldIds.has(l.id))
      if (added) setSelectedDecorationLayerId(added.id)
    })()
  }, [mergedWrappedOnUpdateTheme, theme])

  return (
    <div
      ref={surfaceRef as RefObject<HTMLDivElement>}
      tabIndex={-1}
      className="grid min-h-0 h-full min-w-0 flex-1 grid-cols-1 gap-4 outline-none focus:outline-none lg:grid-cols-[7fr_3fr] lg:items-stretch"
    >
      <div
        className="flex min-h-[min(200px,40vh)] min-w-0 flex-col lg:min-h-0"
        onMouseDownCapture={(e) => {
          const t = e.target as HTMLElement
          if (t.closest('input, textarea, select, [contenteditable="true"]')) return
          if (!t.closest('[data-theme-preview-root]')) return
          surfaceRef.current?.focus({ preventScroll: true })
        }}
      >
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden px-1 pb-2 pt-1">
          <div className="flex h-full w-full min-h-0 min-w-0 items-center justify-center">
            <ThemePreviewEditor
              theme={theme}
              onUpdateTheme={mergedWrappedOnUpdateTheme}
              keyboardScopeRef={surfaceRef as RefObject<HTMLDivElement>}
              previewViewportWidth={previewViewportWidth}
              previewImageUrlMap={previewImageUrlMap}
              popupPreviewAspect={popupPreviewAspect}
              selectedElements={selectedElements}
              onSelectElements={onSelectElements}
              selectedDecorationLayerId={selectedDecorationLayerId}
              onSelectDecorationLayer={setSelectedDecorationLayerId}
              onSelectStructuralLayer={setSelectedStructuralLayerId}
              selectedStructuralLayerId={selectedStructuralLayerId}
              previewWidthMode="fill"
              outerChrome="none"
              snapEnabled={snapEnabled}
              toolbarCenter={
                onPopupPreviewAspectChange ? (
                  <div className="flex items-center gap-2">
                    <span className="hidden text-xs text-slate-500 sm:inline">预览比例</span>
                    <select
                      value={popupPreviewAspectPreset}
                      onChange={(e) => onPopupPreviewAspectChange(e.target.value as PopupPreviewAspectPreset)}
                      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                      title="选择预览比例"
                    >
                      <option value="system">跟随系统（{popupPreviewAspect}）</option>
                      <option value="16:9">16:9</option>
                      <option value="16:10">16:10</option>
                      <option value="21:9">21:9</option>
                      <option value="32:9">32:9</option>
                      <option value="3:2">3:2</option>
                      <option value="4:3">4:3</option>
                    </select>
                  </div>
                ) : undefined
              }
              toolbarTrailing={
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setSnapEnabled((v) => !v)}
                    title={snapEnabled ? '自动吸附：开（点击关闭）' : '自动吸附：关（点击开启）'}
                    className={`inline-flex h-7 items-center gap-1 rounded border px-2 text-xs transition-colors ${
                      snapEnabled
                        ? 'border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:border-indigo-500/45 dark:bg-indigo-500/20 dark:text-indigo-200 dark:hover:bg-indigo-500/30'
                        : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700/70 dark:hover:text-slate-100'
                    }`}
                  >
                    <span aria-hidden className="text-[11px]">
                      ◈
                    </span>
                    <span>吸附</span>
                  </button>
                  <ThemeFullscreenPreviewToolbarButton theme={theme} />
                </div>
              }
            />
          </div>
        </div>
      </div>
      <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white lg:min-h-0">
        <PopupThemeEditorPanel
          className="min-h-0 flex-1"
          theme={theme}
          onUpdateTheme={onUpdateTheme}
          replaceThemeFull={replaceThemeFull}
          delegatedMergedOnUpdateTheme={mergedWrappedOnUpdateTheme}
          delegatedEditHistory={delegatedEditHistory}
          previewViewportWidth={previewViewportWidth}
          previewImageUrlMap={previewImageUrlMap}
          popupPreviewAspect={popupPreviewAspect}
          selectedElements={selectedElements}
          onSelectElements={onSelectElements}
          selectedDecorationLayerId={selectedDecorationLayerId}
          onSelectDecorationLayer={setSelectedDecorationLayerId}
          selectedStructuralLayerId={selectedStructuralLayerId}
          onSelectStructuralLayer={setSelectedStructuralLayerId}
          onPickDecoImage={handlePickDecoImage}
          onPickImageFile={onPickImageFile}
          onPickImageFolder={onPickImageFolder}
          previewPlacement="hidden"
          editorSurfaceRef={surfaceRef as RefObject<HTMLDivElement>}
        />
      </div>
    </div>
  )
}

export type ThemeStudioReturnTarget =
  | { kind: 'list' }
  | { kind: 'subitem'; categoryId: string; itemId: string }

export type ThemeStudioThumbnailProps = {
  theme: PopupTheme
  previewImageUrlMap: Record<string, string>
  previewViewportWidth: number
  popupPreviewAspect: PopupPreviewAspect
  /**
   * dnd-kit DragOverlay 会挂第二份缩略图：列表里已解码过，跳过呼吸/渐显与重复 Image 预加载，避免拖拽时再演一遍动画。
   */
  skipRevealSequence?: boolean
}

const noopThemeUpdate = (_id: string, _patch: Partial<PopupTheme>) => {}
const noopSelectElements = (_keys: TextElementKey[]) => {}

export function ThemeStudioThumbnail({
  theme,
  previewImageUrlMap,
  previewViewportWidth,
  popupPreviewAspect,
  skipRevealSequence = false,
}: ThemeStudioThumbnailProps) {
  const [isDarkModeActive, setIsDarkModeActive] = useState<boolean>(() => getIsDarkModeActive())
  const slotRef = useRef<HTMLDivElement>(null)
  const [slotRect, setSlotRect] = useState({ w: 0, h: 0 })
  const [previewRevealed, setPreviewRevealed] = useState(skipRevealSequence)

  const vw = Math.max(1, Math.round(previewViewportWidth))
  const vh = Math.max(1, Math.round(vw / popupPreviewAspectRatio(popupPreviewAspect)))

  useLayoutEffect(() => {
    const el = slotRef.current
    if (!el) return
    const read = () => {
      const r = el.getBoundingClientRect()
      const w = r.width
      const h = r.height
      if (w <= 0 || h <= 0) return
      setSlotRect((p) => (p.w === w && p.h === h ? p : { w, h }))
    }
    read()
    const ro = new ResizeObserver(() => read())
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const thumbUrlSig = useMemo(() => {
    return collectThemeStudioThumbnailImagePaths(theme)
      .map((p) => rendererSafePreviewImageUrl(p, previewImageUrlMap))
      .join('\x1e')
  }, [theme, previewImageUrlMap])

  useEffect(() => {
    if (skipRevealSequence) return
    if (slotRect.w <= 0) return
    let cancelled = false
    setPreviewRevealed(false)
    const paths = collectThemeStudioThumbnailImagePaths(theme)
    const urls = paths
      .map((p) => rendererSafePreviewImageUrl(p, previewImageUrlMap))
      .filter((u) => Boolean(u))
    const waitDecode = urls.map(
      (u) =>
        new Promise<void>((resolve) => {
          const im = new Image()
          im.onload = () => resolve()
          im.onerror = () => resolve()
          im.src = u
        }),
    )
    Promise.all(waitDecode).then(() => {
      if (cancelled) return
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!cancelled) setPreviewRevealed(true)
        })
      })
    })
    return () => {
      cancelled = true
    }
  }, [theme.id, thumbUrlSig, slotRect.w, skipRevealSequence])

  /**
   * 槽位用实测宽高做 cover 缩放，并略放大（1.02）盖住亚像素缝；顶对齐避免裁掉预览顶部文案区。
   */
  const coverScale =
    slotRect.w > 0 && vh > 0
      ? Math.max(slotRect.w / vw, slotRect.h / vh) * 1.02
      : 1

  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const sync = () => setIsDarkModeActive(getIsDarkModeActive())
    sync()
    media.addEventListener('change', sync)
    const mo = new MutationObserver(sync)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => {
      media.removeEventListener('change', sync)
      mo.disconnect()
    }
  }, [])

  const slotBg = themeStudioThumbSlotBaseBg(theme, isDarkModeActive)
  /** 渐显 1s 与呼吸层同步淡出，避免「先卸呼吸 → 露纯色底 → 再显图」的闪一下 */
  const revealTransition = skipRevealSequence ? 'none' : 'opacity 1s ease-out'
  const contentOpacity = skipRevealSequence ? 1 : previewRevealed ? 1 : 0
  const washOpacity = skipRevealSequence ? 0 : previewRevealed ? 0 : 1

  return (
    <div
      ref={slotRef}
      className="relative w-full overflow-hidden"
      style={{
        aspectRatio: `${popupPreviewAspectRatio(popupPreviewAspect)}`,
        backgroundColor: slotBg,
      }}
    >
      {slotRect.w > 0 && (
        <>
          <div
            className="absolute left-1/2 top-0 z-[1] [backface-visibility:hidden]"
            style={{
              width: vw,
              height: vh,
              transform: `translate3d(-50%, 0, 0) scale(${coverScale})`,
              transformOrigin: 'top center',
              willChange: skipRevealSequence ? 'transform' : 'transform, opacity',
              opacity: contentOpacity,
              transition: revealTransition,
            }}
          >
            <ThemePreviewEditor
              theme={theme}
              readOnly
              showToolbar={false}
              fixedPreviewPixelSize={{ width: vw, height: vh }}
              onUpdateTheme={noopThemeUpdate}
              previewViewportWidth={previewViewportWidth}
              previewImageUrlMap={previewImageUrlMap}
              popupPreviewAspect={popupPreviewAspect}
              selectedElements={[]}
              onSelectElements={noopSelectElements}
              readOnlyCanvasFallbackBg={
                isDarkModeActive ? THEME_STUDIO_THUMB_SLOT_FALLBACK_BG_DARK : THEME_STUDIO_THUMB_SLOT_FALLBACK_BG_LIGHT
              }
            />
          </div>
          {!skipRevealSequence ? (
            <div
              className="pointer-events-none absolute inset-0 z-[2]"
              style={{
                opacity: washOpacity,
                transition: revealTransition,
              }}
              aria-hidden
            >
              <div
                className={`absolute inset-0 ${
                  isDarkModeActive ? 'theme-studio-thumb-breathe-wash-dark' : 'theme-studio-thumb-breathe-wash'
                }`}
              />
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

type SortableThemeStudioCardProps = {
  theme: PopupTheme
  previewImageUrlMap: Record<string, string>
  previewViewportWidth: number
  popupPreviewAspect: PopupPreviewAspect
  /** 主题工坊列表滚动容器，供缩略图懒挂载 IntersectionObserver 使用 */
  listScrollRoot: HTMLDivElement | null
  onOpenEdit: (themeId: string) => void
  onCommitThemeName: (themeId: string, name: string) => void
  onDuplicateTheme: (themeId: string) => void
  onRemoveTheme: (themeId: string) => void
  deskLive: { active: boolean; themeId: string | null }
  deskBusyId: string | null
  onToggleDesktopWallpaper: (theme: PopupTheme) => void | Promise<void>
}

/**
 * 拖拽浮层内容：须铺满 DragOverlay 外层（dnd-kit 已按源卡片量好 width/height）。
 * 之前写死 w-72，网格列更宽时浮层比列表里的卡片窄，会像「变小」。
 */
function ThemeStudioDragOverlayCard({
  theme: t,
  previewImageUrlMap,
  previewViewportWidth,
  popupPreviewAspect,
}: {
  theme: PopupTheme
  previewImageUrlMap: Record<string, string>
  previewViewportWidth: number
  popupPreviewAspect: PopupPreviewAspect
}) {
  const { footerTone, subTone } = themeStudioListCardFooterClasses(t.target)
  const subLabel =
    t.target === 'main' ? '结束壁纸' : t.target === 'desktop' ? '桌面壁纸' : '休息壁纸'

  return (
    <div className="pointer-events-none box-border flex h-full min-h-0 w-full overflow-visible">
      <div
        className="box-border flex h-full min-h-0 w-full max-w-full origin-center scale-[1.08] transform flex-col overflow-visible rounded-xl border-0 bg-white text-left shadow-[0_20px_50px_-14px_rgba(15,23,42,0.16)] will-change-transform"
      >
        <div className="min-h-0 w-full shrink-0 overflow-hidden rounded-t-xl">
          <ThemeStudioThumbnail
            theme={t}
            previewImageUrlMap={previewImageUrlMap}
            previewViewportWidth={previewViewportWidth}
            popupPreviewAspect={popupPreviewAspect}
            skipRevealSequence
          />
        </div>
        <div className={`flex min-h-0 flex-1 flex-col rounded-b-xl p-2.5 ${footerTone}`}>
          <p className="truncate text-sm font-bold text-slate-900">{t.name || t.id}</p>
          <p className={`mt-0.5 text-[11px] font-medium ${subTone}`}>{subLabel}</p>
        </div>
      </div>
    </div>
  )
}

function SortableThemeStudioCard({
  theme: t,
  previewImageUrlMap,
  previewViewportWidth,
  popupPreviewAspect,
  listScrollRoot,
  onOpenEdit,
  onCommitThemeName,
  onDuplicateTheme,
  onRemoveTheme,
  deskLive,
  deskBusyId,
  onToggleDesktopWallpaper,
}: SortableThemeStudioCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: t.id,
    /** 主题网格：较长时长 + 长尾缓出，落版更柔 */
    animateLayoutChanges: () => false,
    transition: {
      duration: 680,
      easing: 'cubic-bezier(0.22, 1, 0.32, 1)',
    },
  })
  const settleEase = 'cubic-bezier(0.22, 1, 0.36, 1)'
  const baseT = typeof transition === 'string' ? transition : undefined
  const dragStyle: CSSProperties = {
    transform: sortableTranslateOnly(transform),
    transition: isDragging
      ? [baseT, 'opacity 0.12s ease-out'].filter(Boolean).join(', ')
      : [baseT, `opacity 0.6s ${settleEase}`].filter(Boolean).join(', '),
    opacity: isDragging ? 0 : 1,
    zIndex: isDragging ? 50 : undefined,
  }
  const { footerTone, footerHoverTone, subTone } = themeStudioListCardFooterClasses(t.target)
  const subLabel =
    t.target === 'main' ? '结束壁纸' : t.target === 'desktop' ? '桌面壁纸' : '休息壁纸'

  const electronDesk = Boolean(window.electronAPI?.getDesktopLiveWallpaperState)
  const isDesktopLiveThis = t.target === 'desktop' && deskLive.active && deskLive.themeId === t.id
  const builtinTheme = isStudioListBuiltinThemeId(t.id)

  /** 热区：缩略图 + 标题行（不含副标题行），便于从图移到右侧 ···；离开该热区即隐藏（菜单打开时保持） */
  const [studioThumbHeaderHot, setStudioThumbHeaderHot] = useState(false)
  const [studioMenuOpen, setStudioMenuOpen] = useState(false)
  const studioMenuOpenRef = useRef(false)
  const syncStudioMenuOpen = useCallback((v: boolean) => {
    studioMenuOpenRef.current = v
    setStudioMenuOpen(v)
  }, [])
  const [titleRenaming, setTitleRenaming] = useState(false)
  const [renameDraft, setRenameDraft] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)
  const skipRenameBlurRef = useRef(false)

  /** 三点菜单与桌面「设为壁纸」共用：热区为整张卡；菜单展开或改名中保持显示 */
  const titleMenuChromeVisible = studioThumbHeaderHot || studioMenuOpen || titleRenaming
  /** 桌面壁纸按钮：未在播时与菜单同显隐；在播时始终显示「关闭」 */
  const desktopWallpaperBtnVisible =
    isDesktopLiveThis || titleMenuChromeVisible || deskBusyId === t.id

  const open = () => onOpenEdit(t.id)
  const onThumbKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      open()
    }
  }

  useEffect(() => {
    setTitleRenaming(false)
  }, [t.id])

  useLayoutEffect(() => {
    if (!titleRenaming) return
    const el = renameInputRef.current
    if (!el) return
    el.focus()
    el.select()
  }, [titleRenaming])

  const startTitleRename = useCallback(() => {
    setRenameDraft(t.name ?? '')
    setTitleRenaming(true)
  }, [t.name])

  const endTitleRenameBlur = useCallback(() => {
    if (skipRenameBlurRef.current) {
      skipRenameBlurRef.current = false
      return
    }
    const s = renameDraft.trim()
    if (!s) {
      setTitleRenaming(false)
      return
    }
    const prev = (t.name ?? '').trim()
    if (s !== prev) onCommitThemeName(t.id, s)
    setTitleRenaming(false)
  }, [renameDraft, t.id, t.name, onCommitThemeName])

  const onRenameDraftKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      skipRenameBlurRef.current = true
      const s = renameDraft.trim()
      if (s) {
        const prev = (t.name ?? '').trim()
        if (s !== prev) onCommitThemeName(t.id, s)
      }
      setTitleRenaming(false)
      requestAnimationFrame(() => {
        skipRenameBlurRef.current = false
      })
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      skipRenameBlurRef.current = true
      setTitleRenaming(false)
      requestAnimationFrame(() => {
        skipRenameBlurRef.current = false
      })
    }
  }

  const isDesktopListCard = t.target === 'desktop'
  const thumbObserveRef = useRef<HTMLDivElement>(null)
  const [thumbPreviewMounted, setThumbPreviewMounted] = useState(false)
  useEffect(() => {
    if (thumbPreviewMounted) return
    if (!listScrollRoot) return
    const el = thumbObserveRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setThumbPreviewMounted(true)
            io.disconnect()
            return
          }
        }
      },
      {
        root: listScrollRoot,
        rootMargin: '160px 0px 280px 0px',
        threshold: 0,
      },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [thumbPreviewMounted, listScrollRoot, t.id])

  const cardHotHandlers = {
    onMouseEnter: () => setStudioThumbHeaderHot(true),
    onMouseLeave: () => {
      requestAnimationFrame(() => {
        if (!studioMenuOpenRef.current) setStudioThumbHeaderHot(false)
      })
    },
  } as const

  return (
    <div ref={setNodeRef} style={dragStyle} className="w-full min-h-0 self-start">
      <div
        className="group flex w-full flex-col overflow-visible rounded-xl border-0 bg-white text-left shadow-none transition-shadow duration-200 ease-out hover:shadow-[0_10px_36px_-12px_rgba(15,23,42,0.11)] [backface-visibility:hidden]"
        {...(isDesktopListCard ? cardHotHandlers : {})}
      >
        <div
          className="flex min-h-0 w-full flex-col overflow-visible"
          {...(!isDesktopListCard ? cardHotHandlers : {})}
        >
          <div
            ref={thumbObserveRef}
            className="group/thumbslot relative w-full shrink-0 overflow-hidden rounded-t-xl"
          >
            <div
              {...listeners}
              {...attributes}
              role="button"
              tabIndex={0}
              aria-label="拖动排序，点击进入编辑"
              onClick={open}
              onKeyDown={onThumbKey}
                className="w-full cursor-pointer touch-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-400"
            >
              {thumbPreviewMounted ? (
                <ThemeStudioThumbnail
                  theme={t}
                  previewImageUrlMap={previewImageUrlMap}
                  previewViewportWidth={previewViewportWidth}
                  popupPreviewAspect={popupPreviewAspect}
                />
              ) : (
                <div
                  className="relative w-full"
                  style={{
                    aspectRatio: `${popupPreviewAspectRatio(popupPreviewAspect)}`,
                    backgroundColor: themeStudioThumbSlotBaseBg(t, getIsDarkModeActive()),
                  }}
                >
                  <div
                    className={`pointer-events-none absolute inset-0 ${
                      getIsDarkModeActive() ? 'theme-studio-thumb-breathe-wash-dark' : 'theme-studio-thumb-breathe-wash'
                    }`}
                    aria-hidden
                  />
                </div>
              )}
            </div>
            <ThemeFullscreenPreviewIconButton
              theme={t}
              stopCardPointer
              title="全屏预览"
              className="pointer-events-none absolute right-1 top-1 z-20 inline-flex h-6 w-6 items-center justify-center rounded-md bg-black/50 text-white opacity-0 transition-opacity duration-150 hover:bg-black/60 group-hover/thumbslot:pointer-events-auto group-hover/thumbslot:opacity-100 focus-visible:pointer-events-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:opacity-100"
              iconClassName="h-3 w-3"
            />
          </div>
          <div
            className={`shrink-0 px-2.5 pb-0 pt-2.5 transition-colors duration-200 ${footerTone} ${footerHoverTone}`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-0.5">
                {titleRenaming ? (
                  <input
                    ref={renameInputRef}
                    type="text"
                    aria-label="壁纸名称"
                    className="min-w-0 flex-1 truncate rounded-sm border-0 bg-white/90 py-0.5 pl-0.5 pr-1 text-sm font-bold text-slate-900 shadow-none outline-none ring-1 ring-slate-300/90 focus:ring-slate-400"
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    onKeyDown={onRenameDraftKeyDown}
                    onBlur={endTitleRenameBlur}
                  />
                ) : (
                  <div
                    role="button"
                    tabIndex={0}
                    className="min-w-0 flex-1 cursor-pointer truncate rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                    onClick={open}
                    onKeyDown={onThumbKey}
                  >
                    <p className="truncate text-sm font-bold text-slate-900">{t.name || t.id}</p>
                  </div>
                )}
                <div
                  className={`shrink-0 transition-opacity duration-150 ${
                    titleMenuChromeVisible
                      ? 'pointer-events-auto opacity-100'
                      : 'pointer-events-none opacity-0'
                  }`}
                >
                  <StudioListOverflowMenu
                    onOpen={open}
                    onRename={startTitleRename}
                    onDuplicate={() => onDuplicateTheme(t.id)}
                    onRemove={() => onRemoveTheme(t.id)}
                    canDelete={!builtinTheme}
                    deleteDisabledTitle={builtinTheme ? '内置壁纸不可删除' : undefined}
                    onOpenChange={syncStudioMenuOpen}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
        <div
          className={`shrink-0 rounded-b-xl px-2.5 pb-2.5 pt-0 transition-colors duration-200 ${footerTone} ${footerHoverTone}`}
        >
          <div className="min-w-0 flex-1">
            <div className="mt-0.5 flex min-w-0 items-center justify-between gap-2">
              <div
                role="button"
                tabIndex={0}
                className="min-w-0 flex-1 cursor-pointer rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                onClick={open}
                onKeyDown={onThumbKey}
              >
                <p className={`truncate text-left text-[11px] font-medium ${subTone}`}>{subLabel}</p>
              </div>
              {t.target === 'desktop' && electronDesk && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    void onToggleDesktopWallpaper(t)
                  }}
                  disabled={deskBusyId === t.id}
                  className={`shrink-0 whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] font-semibold transition-[color,background-color,opacity,border-color] duration-150 disabled:cursor-wait disabled:opacity-50 ${
                    desktopWallpaperBtnVisible
                      ? 'pointer-events-auto opacity-100'
                      : 'pointer-events-none opacity-0'
                  } ${
                    isDesktopLiveThis
                      ? 'border-red-200 bg-red-50 text-red-800 hover:bg-red-100'
                      : 'border-violet-200 bg-white text-violet-800 hover:bg-violet-50'
                  }`}
                >
                  {isDesktopLiveThis ? '关闭桌面壁纸' : '设为桌面壁纸'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export type ThemeStudioListViewProps = {
  themes: PopupTheme[]
  previewImageUrlMap: Record<string, string>
  previewViewportWidth: number
  popupPreviewAspect: PopupPreviewAspect
  onOpenEdit: (themeId: string) => void
  onCommitThemeName: (themeId: string, name: string) => void
  onDuplicateTheme: (themeId: string) => void
  onRemoveTheme: (themeId: string) => void
  /** 拖拽调整 `popupThemes` 顺序（与筛选无关：按 id 在全量列表中移动） */
  onReorderThemes: (next: PopupTheme[]) => void
}

export function ThemeStudioListView({
  themes,
  previewImageUrlMap,
  previewViewportWidth,
  popupPreviewAspect,
  onOpenEdit,
  onCommitThemeName,
  onDuplicateTheme,
  onRemoveTheme,
  onReorderThemes,
}: ThemeStudioListViewProps) {
  const [studioListScrollEl, setStudioListScrollEl] = useState<HTMLDivElement | null>(null)
  const [filter, setFilter] = useState<'all' | 'main' | 'rest' | 'desktop'>('all')
  const [deskLive, setDeskLive] = useState<{ active: boolean; themeId: string | null }>({
    active: false,
    themeId: null,
  })
  const [deskBusyId, setDeskBusyId] = useState<string | null>(null)

  const refreshDeskLive = useCallback(async () => {
    const api = window.electronAPI?.getDesktopLiveWallpaperState
    if (!api) {
      setDeskLive({ active: false, themeId: null })
      return
    }
    setDeskLive(await api())
  }, [])

  useEffect(() => {
    void refreshDeskLive()
    const id = window.setInterval(() => void refreshDeskLive(), 2000)
    return () => clearInterval(id)
  }, [refreshDeskLive])

  const toggleDesktopWallpaperFromList = useCallback(
    async (t: PopupTheme) => {
      const api = window.electronAPI
      if (
        !api?.getDesktopLiveWallpaperState ||
        !api?.startDesktopLiveWallpaper ||
        !api?.stopDesktopLiveWallpaper ||
        !api?.waitDesktopLiveWallpaperApplyDone
      ) {
        window.alert('请在 Electron 应用内使用此功能。')
        return
      }
      setDeskBusyId(t.id)
      try {
        const st = await api.getDesktopLiveWallpaperState()
        if (st.active && st.themeId === t.id) {
          await api.stopDesktopLiveWallpaper()
        } else {
          const r = await api.startDesktopLiveWallpaper(structuredClone(t) as PopupTheme)
          if ('pending' in r && r.pending) {
            const done = await api.waitDesktopLiveWallpaperApplyDone(r.requestId)
            if (!done.success) window.alert(done.error || '设置失败')
          } else if (!r.success) {
            window.alert(r.error || '设置失败')
          }
        }
        await refreshDeskLive()
      } finally {
        setDeskBusyId(null)
      }
    },
    [refreshDeskLive],
  )

  const filtered = useMemo(() => {
    if (filter === 'all') return themes
    return themes.filter((t) => t.target === filter)
  }, [themes, filter])

  const [activeDragTheme, setActiveDragTheme] = useState<PopupTheme | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const onDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id)
    const t = themes.find((x) => x.id === id)
    setActiveDragTheme(t ?? null)
  }

  const clearDragOverlay = () => setActiveDragTheme(null)

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    clearDragOverlay()
    if (!over || active.id === over.id) return
    const activeId = String(active.id)
    const overId = String(over.id)
    const oldFull = themes.findIndex((t) => t.id === activeId)
    const newFull = themes.findIndex((t) => t.id === overId)
    if (oldFull < 0 || newFull < 0) return
    onReorderThemes(arrayMove(themes, oldFull, newFull))
  }

  const onDragCancel = (_event: DragCancelEvent) => {
    clearDragOverlay()
  }

  const chip = (id: typeof filter, label: string) => {
    const active = filter === id
    let activeCls = 'bg-slate-800 text-white'
    let inactiveCls = 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
    if (id === 'rest') {
      activeCls = 'bg-blue-600 text-white shadow-sm'
      inactiveCls = 'bg-white text-blue-900 ring-1 ring-blue-200 hover:bg-blue-50/80'
    } else if (id === 'main') {
      activeCls = 'bg-emerald-600 text-white shadow-sm'
      inactiveCls = 'bg-white text-emerald-900 ring-1 ring-emerald-200 hover:bg-emerald-50/80'
    } else if (id === 'desktop') {
      activeCls = 'bg-violet-500 text-white shadow-sm'
      inactiveCls = 'bg-white text-violet-900 ring-1 ring-violet-200 hover:bg-violet-50/80'
    }
    return (
      <button
        key={id}
        type="button"
        onClick={() => setFilter(id)}
        className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${active ? activeCls : inactiveCls}`}
      >
        {label}
      </button>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {chip('all', '全部')}
        {chip('rest', '休息壁纸')}
        {chip('main', '结束壁纸')}
        {chip('desktop', '桌面壁纸')}
      </div>
      <div
        ref={setStudioListScrollEl}
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain p-3"
      >
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToWindowEdges]}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={onDragCancel}
        >
          <SortableContext items={filtered.map((t) => t.id)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filtered.map((t) => (
                <SortableThemeStudioCard
                  key={t.id}
                  theme={t}
                  previewImageUrlMap={previewImageUrlMap}
                  previewViewportWidth={previewViewportWidth}
                  popupPreviewAspect={popupPreviewAspect}
                  listScrollRoot={studioListScrollEl}
                  onOpenEdit={onOpenEdit}
                  onCommitThemeName={onCommitThemeName}
                  onDuplicateTheme={onDuplicateTheme}
                  onRemoveTheme={onRemoveTheme}
                  deskLive={deskLive}
                  deskBusyId={deskBusyId}
                  onToggleDesktopWallpaper={toggleDesktopWallpaperFromList}
                />
              ))}
            </div>
          </SortableContext>
          {/* 不做「飞回槽位」的 dropAnimation；松手即消失，落版仅靠 Sortable 的 transition（同子项） */}
          <DragOverlay className="overflow-visible" style={{ overflow: 'visible' }} dropAnimation={null}>
            {activeDragTheme ? (
              <ThemeStudioDragOverlayCard
                theme={activeDragTheme}
                previewImageUrlMap={previewImageUrlMap}
                previewViewportWidth={previewViewportWidth}
                popupPreviewAspect={popupPreviewAspect}
              />
            ) : null}
          </DragOverlay>
        </DndContext>
        {filtered.length === 0 && (
          <p className="py-12 text-center text-sm text-slate-500">当前筛选下没有主题。</p>
        )}
      </div>
    </div>
  )
}

export type ThemeStudioEditViewProps = {
  theme: PopupTheme
  previewViewportWidth: number
  previewImageUrlMap: Record<string, string>
  popupPreviewAspect: PopupPreviewAspect
  onUpdateTheme: (themeId: string, patch: Partial<PopupTheme>) => void
  replaceThemeFull: (theme: PopupTheme) => void
  selectedElements: TextElementKey[]
  onSelectElements: (keys: TextElementKey[]) => void
  onPickImageFile: () => void | Promise<void>
  onPickImageFolder: () => void | Promise<void>
  onBack: () => void
  onDuplicateTheme: () => void
  onDeleteTheme?: () => void
  canDelete?: boolean
  deleteDisabledTitle?: string
}

export function ThemeStudioEditView({
  theme,
  previewViewportWidth,
  previewImageUrlMap,
  popupPreviewAspect,
  onUpdateTheme,
  replaceThemeFull,
  selectedElements,
  onSelectElements,
  onPickImageFile,
  onPickImageFolder,
  onBack,
  onDuplicateTheme,
  onDeleteTheme,
  canDelete,
  deleteDisabledTitle,
}: ThemeStudioEditViewProps) {
  const surfaceRef = useRef<HTMLDivElement>(null)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="relative z-20 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="shrink-0 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50"
          >
            ← 返回
          </button>
          <span className="text-sm font-semibold text-slate-800">编辑主题</span>
          <input
            type="text"
            value={theme.name}
            onChange={(e) => onUpdateTheme(theme.id, { name: e.target.value })}
            onPointerDownCapture={focusInputOnPointerDownCapture}
            className="min-w-[10rem] max-w-md flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
            placeholder="主题名称"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onDuplicateTheme}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50"
          >
            另存为新主题
          </button>
          {onDeleteTheme && (
            <button
              type="button"
              onClick={onDeleteTheme}
              disabled={canDelete === false}
              title={deleteDisabledTitle}
              className="rounded-md border border-red-200 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              删除
            </button>
          )}
        </div>
      </div>
      <ThemeStudioEditWorkspace
        theme={theme}
        surfaceRef={surfaceRef}
        previewViewportWidth={previewViewportWidth}
        previewImageUrlMap={previewImageUrlMap}
        popupPreviewAspect={popupPreviewAspect}
        onUpdateTheme={onUpdateTheme}
        replaceThemeFull={replaceThemeFull}
        selectedElements={selectedElements}
        onSelectElements={onSelectElements}
        onPickImageFile={onPickImageFile}
        onPickImageFolder={onPickImageFolder}
      />
    </div>
  )
}

export type ThemeStudioFloatingSource =
  | { kind: 'studio-list' }
  | { kind: 'subitem'; categoryId: string; itemAnchor: string; popupTarget: 'main' | 'rest' }

export type ThemeStudioFloatingEditorProps = {
  themes: PopupTheme[]
  themeId: string
  source: ThemeStudioFloatingSource
  /** `saved: true` 表示已保存或确认保留主题；未传或 false 时由设置页决定是否丢弃新建草稿 */
  onClose: (opts?: { saved?: boolean }) => void
  /** 列表内「另存为」后改为编辑新主题 */
  onSwitchEditingThemeId?: (newId: string) => void
  /** 子项「另存为」后把新 id 交给设置页写回表单 */
  onAfterForkRebindSubitem?: (newThemeId: string) => void
  previewViewportWidth: number
  previewImageUrlMap: Record<string, string>
  popupPreviewAspect: PopupPreviewAspect
  popupPreviewAspectPreset?: PopupPreviewAspectPreset
  /** 浮动编辑工具栏内切换预览画幅（16:9 / 4:3） */
  onPopupPreviewAspectChange?: (aspect: PopupPreviewAspectPreset) => void
  getSelectedElements: (id: string) => TextElementKey[]
  setSelectedElements: (id: string, els: TextElementKey[]) => void
  replacePopupTheme: (theme: PopupTheme) => void
  appendPopupTheme: (theme: PopupTheme) => void
  countPopupThemeReferences: (themeId: string, exclude?: { categoryId: string; itemId: string } | null) => number
  themeRefExclude: { categoryId: string; itemId: string } | null
  onDeleteTheme?: () => void
  canDeleteTheme?: boolean
  deleteDisabledTitle?: string
  /** 主题工坊「创建 * 壁纸」进入的草稿：仅保留保存/取消，不显示「另存为」（尚无库内母题可 fork） */
  isNewDraft?: boolean
}

export function ThemeStudioFloatingEditor({
  themes,
  themeId,
  source,
  onClose,
  onSwitchEditingThemeId,
  onAfterForkRebindSubitem,
  previewViewportWidth,
  previewImageUrlMap,
  popupPreviewAspect,
  popupPreviewAspectPreset = 'system',
  onPopupPreviewAspectChange,
  getSelectedElements,
  setSelectedElements,
  replacePopupTheme,
  appendPopupTheme,
  countPopupThemeReferences,
  themeRefExclude,
  onDeleteTheme,
  canDeleteTheme,
  deleteDisabledTitle,
  isNewDraft = false,
}: ThemeStudioFloatingEditorProps) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const baselineRef = useRef<PopupTheme | null>(null)
  const themesRef = useRef(themes)
  themesRef.current = themes
  const [draft, setDraft] = useState<PopupTheme | null>(null)
  const [editHistoryResetSignal, setEditHistoryResetSignal] = useState(0)
  const [draftImageUrlMap, setDraftImageUrlMap] = useState<Record<string, string>>({})
  const [applyingWallpaper, setApplyingWallpaper] = useState(false)
  const [deskLive, setDeskLive] = useState<{ active: boolean; themeId: string | null }>({
    active: false,
    themeId: null,
  })

  const refreshDeskLiveFloating = useCallback(async () => {
    const api = window.electronAPI?.getDesktopLiveWallpaperState
    if (!api) {
      setDeskLive({ active: false, themeId: null })
      return
    }
    setDeskLive(await api())
  }, [])

  useEffect(() => {
    void refreshDeskLiveFloating()
    const id = window.setInterval(() => void refreshDeskLiveFloating(), 2000)
    return () => clearInterval(id)
  }, [refreshDeskLiveFloating])

  useEffect(() => {
    if (!draft) {
      setDraftImageUrlMap({})
      return
    }
    const api = window.electronAPI?.resolvePreviewImageUrl
    if (!api) return
    const paths = collectPopupThemeImagePathsForPreview(draft)
    if (paths.length === 0) {
      setDraftImageUrlMap({})
      return
    }
    let disposed = false
    void Promise.all(
      paths.map(async (p) => {
        const r = await api(p)
        return [p, r.success ? r.url : ''] as const
      }),
    ).then((entries) => {
      if (!disposed) setDraftImageUrlMap(Object.fromEntries(entries))
    })
    return () => {
      disposed = true
    }
  }, [draft])

  const mergedFloatingPreviewMap = useMemo(
    () => ({ ...previewImageUrlMap, ...draftImageUrlMap }),
    [previewImageUrlMap, draftImageUrlMap],
  )

  const tryCloseStable = useCallback(() => {
    const d = draft
    const b = baselineRef.current
    if (!d || !b) {
      onClose()
      return
    }
    if (themeDraftDirty(b, d) && !window.confirm('放弃对主题的修改？')) return
    onClose()
  }, [draft, onClose])

  const handleRestoreDefault = useCallback(() => {
    if (!draft) return
    const tgt = draft.target
    const label = tgt === 'main' ? '结束' : tgt === 'desktop' ? '桌面' : '休息'
    if (
      !window.confirm(
        `确定将当前壁纸恢复为「${label}」类型的内置默认样式吗？\n\n所有自定义图层、装饰及参数将被清空，仅保留当前主题名称与 ID。需点击「保存」后才会写入主题库。`,
      )
    )
      return
    const next = cloneDefaultPopupThemePreservingIdentity({
      id: draft.id,
      name: draft.name ?? '',
      target: tgt,
    })
    setDraft(next)
    setEditHistoryResetSignal((n) => n + 1)
    setSelectedElements(themeId, tgt === 'desktop' ? ['time'] : ['content'])
  }, [draft, themeId, setSelectedElements])

  useLayoutEffect(() => {
    const t = themesRef.current.find((x) => x.id === themeId)
    if (!t) {
      setDraft(null)
      baselineRef.current = null
      return
    }
    const c = structuredClone(t) as PopupTheme
    setDraft(c)
    baselineRef.current = structuredClone(t) as PopupTheme
  }, [themeId])

  /**
   * 首次进入某主题：无有效绑定层选中时默认主文案；若仅有已废弃的 `countdown` 选中须剔除，否则图层栏无行匹配、看起来像「从没选中」。
   */
  const bindingAutoSelectRef = useRef(new Set<string>())
  useLayoutEffect(() => {
    if (!themeId) return
    if (!draft || draft.id !== themeId) return
    if (bindingAutoSelectRef.current.has(themeId)) return
    const cur = getSelectedElements(themeId)
    const withoutCountdown = cur.filter((k) => k !== 'countdown')
    if (withoutCountdown.length > 0) {
      if (withoutCountdown.length !== cur.length) setSelectedElements(themeId, withoutCountdown)
      bindingAutoSelectRef.current.add(themeId)
      return
    }
    setSelectedElements(themeId, [draft.target === 'desktop' ? 'time' : 'content'])
    bindingAutoSelectRef.current.add(themeId)
  }, [themeId, draft, getSelectedElements, setSelectedElements])

  useLayoutEffect(() => {
    if (!draft || draft.id !== themeId) return
    if (typeof document !== 'undefined' && document.hasFocus()) return
    void window.electronAPI?.focusMainWebContents?.()
  }, [draft?.id, themeId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      tryCloseStable()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tryCloseStable])

  useEffect(() => {
    // 锁定页面滚动，避免弹窗滚动时带动后面的设置页。
    const html = document.documentElement
    const body = document.body
    const prevHtmlOverflow = html.style.overflow
    const prevBodyOverflow = body.style.overflow
    const prevHtmlOverscroll = html.style.overscrollBehavior
    const prevBodyOverscroll = body.style.overscrollBehavior
    html.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    html.style.overscrollBehavior = 'none'
    body.style.overscrollBehavior = 'none'
    return () => {
      html.style.overflow = prevHtmlOverflow
      body.style.overflow = prevBodyOverflow
      html.style.overscrollBehavior = prevHtmlOverscroll
      body.style.overscrollBehavior = prevBodyOverscroll
    }
  }, [])

  const handleToggleDesktopWallpaperFloating = useCallback(async () => {
    const d = draft
    if (!d || d.target !== 'desktop') return
    const api = window.electronAPI
    if (
      !api?.getDesktopLiveWallpaperState ||
      !api?.startDesktopLiveWallpaper ||
      !api?.stopDesktopLiveWallpaper ||
      !api?.waitDesktopLiveWallpaperApplyDone
    ) {
      window.alert('请在 Electron 应用内使用此功能。')
      return
    }
    setApplyingWallpaper(true)
    try {
      const st = await api.getDesktopLiveWallpaperState()
      if (st.active && st.themeId === d.id) {
        await api.stopDesktopLiveWallpaper()
      } else {
        const r = await api.startDesktopLiveWallpaper(structuredClone(d) as PopupTheme)
        if ('pending' in r && r.pending) {
          const done = await api.waitDesktopLiveWallpaperApplyDone(r.requestId)
          if (!done.success) window.alert(done.error || '设置失败')
        } else if (!r.success) {
          window.alert(r.error || '设置失败')
        }
      }
      await refreshDeskLiveFloating()
    } finally {
      setApplyingWallpaper(false)
    }
  }, [draft, refreshDeskLiveFloating])

  const tResolved = themes.find((x) => x.id === themeId)
  if (!tResolved) {
    return (
      <div
        className="fixed inset-0 z-[250000] flex items-center justify-center bg-black/70 p-4 backdrop-blur-md"
        role="presentation"
        onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      >
        <div className="flex flex-col items-center gap-3 rounded-lg bg-white px-6 py-4 text-sm text-slate-600 shadow-xl">
          <p>未找到该主题。</p>
          <button
            type="button"
            className="rounded-md border border-slate-300 px-3 py-1 text-xs"
            onClick={() => onClose()}
          >
            关闭
          </button>
        </div>
      </div>
    )
  }

  if (!draft || draft.id !== themeId) {
    return (
      <div
        className="fixed inset-0 z-[250000] flex items-center justify-center bg-black/70 p-4 backdrop-blur-md"
        role="presentation"
      >
        <div className="text-sm text-white drop-shadow-sm">加载中…</div>
      </div>
    )
  }

  const baseline = baselineRef.current
  const floatingIsDesktopLive =
    draft.target === 'desktop' && deskLive.active && deskLive.themeId === draft.id
  /** 工坊列表/子项均不在编辑内切换用途：表头仅展示当前类型（子项用入口类型，列表用主题自身 target） */
  const headerTarget: PopupThemeTarget =
    source.kind === 'subitem' ? source.popupTarget : draft.target
  const editorAriaLabel =
    headerTarget === 'main'
      ? '编辑结束壁纸主题'
      : headerTarget === 'desktop'
        ? '编辑桌面壁纸主题'
        : '编辑休息壁纸主题'

  const updateDraft = (_id: string, patch: Partial<PopupTheme>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d))
  }
  const replaceDraftFull = (t: PopupTheme) => {
    setDraft(t)
  }

  const handleSave = () => {
    if (!baseline) return
    if (!themeDraftDirty(baseline, draft)) {
      onClose({ saved: true })
      return
    }
    const otherRefs = countPopupThemeReferences(baseline.id, themeRefExclude)
    const nameResolved = (draft.name ?? '').trim() || baseline.name
    const baseLabel = (baseline.name ?? '').trim() || baseline.id
    const msg =
      otherRefs > 0
        ? `保存将覆盖主题库中的「${baseLabel}」。另有 ${otherRefs} 条提醒也在使用该主题，将一并使用当前编辑后的样式。是否确认保存？`
        : `保存将覆盖主题库中的「${baseLabel}」。是否确认保存？`
    if (!window.confirm(msg)) return
    const toSave: PopupTheme = { ...draft, id: baseline.id, name: nameResolved }
    replacePopupTheme(toSave)
    baselineRef.current = structuredClone(toSave) as PopupTheme
    onClose({ saved: true })
  }

  const handleSaveAs = () => {
    const nameTrim = (draft.name ?? '').trim()
    const baseName = (baseline?.name ?? '').trim() || '主题'
    const nameResolved = nameTrim || `${baseName}（副本）`
    const draftToFork: PopupTheme = { ...draft, id: baseline?.id ?? draft.id, name: nameResolved }
    const forked = clonePopupThemeForFork(draftToFork, '')
    appendPopupTheme(forked)
    if (source.kind === 'subitem') {
      onAfterForkRebindSubitem?.(forked.id)
      onClose({ saved: true })
      return
    }
    onSwitchEditingThemeId?.(forked.id)
  }

  const isStudioList = source.kind === 'studio-list'

  const headerBannerClass =
    headerTarget === 'main'
      ? 'bg-green-500 text-white'
      : headerTarget === 'desktop'
        ? 'bg-violet-500 text-white'
        : 'bg-blue-500 text-white'
  const headerBannerLabel =
    headerTarget === 'main' ? '结束壁纸' : headerTarget === 'desktop' ? '桌面壁纸' : '休息壁纸'

  return (
    <div
      className="fixed inset-0 z-[250000] flex items-center justify-center bg-black/70 p-2 sm:p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label={editorAriaLabel}
      onMouseDown={(e) => e.target === e.currentTarget && tryCloseStable()}
    >
      <div
        className="relative flex h-[min(92dvh,1100px)] w-[min(96vw,1960px)] flex-col overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-[0_25px_80px_-12px_rgba(0,0,0,0.45)] sm:rounded-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className={`relative z-[60] isolate flex min-h-[44px] shrink-0 items-center justify-center border-b border-slate-200 px-3 py-2.5 text-sm font-semibold ${headerBannerClass}`}
          role="status"
          aria-label={editorAriaLabel}
        >
          {headerBannerLabel}
        </div>
        <div className="relative z-[60] isolate flex min-w-0 shrink-0 items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
          <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-slate-600">主题名称</span>
            <input
              type="text"
              value={draft.name}
              autoFocus={isNewDraft}
              onChange={(e) => updateDraft(draft.id, { name: e.target.value })}
              onPointerDownCapture={focusInputOnPointerDownCapture}
              className="min-w-[8rem] max-w-[14rem] flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-sm"
              placeholder="主题名称"
            />
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 justify-center px-1">
            <div className="inline-flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={handleRestoreDefault}
                className="shrink-0 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-700/80 dark:bg-amber-900/30 dark:text-amber-200 dark:hover:bg-amber-900/45"
              >
                恢复默认
              </button>
              {draft.target === 'desktop' && (
                <button
                  type="button"
                  onClick={() => void handleToggleDesktopWallpaperFloating()}
                  disabled={applyingWallpaper}
                  title={
                    floatingIsDesktopLive
                      ? '关闭动态桌面壁纸窗口并恢复桌面'
                      : '将当前编辑效果设为主显示器动态桌面壁纸（Windows）'
                  }
                  className={`shrink-0 rounded-md border px-3 py-1.5 text-xs font-medium disabled:cursor-wait disabled:opacity-60 ${
                    floatingIsDesktopLive
                      ? 'border-red-200 bg-red-50 text-red-800 hover:bg-red-100'
                      : 'border-violet-300 bg-violet-50 text-violet-900 hover:bg-violet-100'
                  }`}
                >
                  {applyingWallpaper ? '处理中…' : floatingIsDesktopLive ? '关闭桌面壁纸' : '设为桌面壁纸'}
                </button>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={tryCloseStable}
              className="shrink-0 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
            >
              保存
            </button>
            {!isNewDraft && (
              <button
                type="button"
                onClick={handleSaveAs}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                另存为
              </button>
            )}
            {isStudioList && onDeleteTheme && (
              <button
                type="button"
                onClick={onDeleteTheme}
                disabled={canDeleteTheme === false}
                title={deleteDisabledTitle}
                className="rounded-md border border-red-200 px-2.5 py-1.5 text-xs text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                删除
              </button>
            )}
          </div>
        </div>
        <div className="relative z-0 flex min-h-0 flex-1 flex-col overflow-hidden p-3 pt-2">
          <ThemeStudioEditWorkspace
            theme={draft}
            surfaceRef={surfaceRef}
            previewViewportWidth={previewViewportWidth}
            previewImageUrlMap={mergedFloatingPreviewMap}
            popupPreviewAspect={popupPreviewAspect}
            popupPreviewAspectPreset={popupPreviewAspectPreset}
            onPopupPreviewAspectChange={onPopupPreviewAspectChange}
            onUpdateTheme={updateDraft}
            replaceThemeFull={replaceDraftFull}
            editHistoryResetSignal={editHistoryResetSignal}
            selectedElements={getSelectedElements(draft.id)}
            onSelectElements={(els) => setSelectedElements(draft.id, els)}
            onPickImageFile={() => {
              void (async () => {
                const api = window.electronAPI
                const r = await api?.pickPopupImageFile?.()
                if (!r?.success) return
                updateDraft(draft.id, {
                  backgroundType: 'image',
                  imageSourceType: 'single',
                  imagePath: r.path,
                  imageFolderPath: undefined,
                  imageFolderFiles: undefined,
                })
              })()
            }}
            onPickImageFolder={() => {
              void (async () => {
                const api = window.electronAPI
                const r = await api?.pickPopupImageFolder?.()
                if (!r?.success) return
                updateDraft(draft.id, {
                  backgroundType: 'image',
                  imageSourceType: 'folder',
                  imageFolderPath: r.folderPath,
                  imageFolderFiles: r.files,
                  imagePath: undefined,
                  imageFolderPlayMode: 'sequence',
                  imageFolderIntervalSec: 30,
                })
              })()
            }}
          />
        </div>
      </div>
    </div>
  )
}
