import { useRef, useCallback, useEffect, useState } from 'react'
import type { PopupTheme } from '../types'

const DEFAULT_MAX_HISTORY = 20

/** 传给 `wrappedOnUpdateTheme` 第三参：高频 UI（如拾色器拖动）可 `skipHistory` 避免每帧整主题 structuredClone */
export type PopupThemeEditUpdateMeta = {
  skipHistory?: boolean
}

/**
 * 主题编辑撤销 / 重做：在每次 `onUpdateTheme` 前压入当前主题快照，`replaceThemeFull` 恢复整主题。
 * 通过 ref 持有最新的 `onUpdateTheme` / `replaceThemeFull`，避免子项弹窗等内联函数导致闭包过期。
 */
export function usePopupThemeEditHistory(
  theme: PopupTheme,
  onUpdateTheme: (themeId: string, patch: Partial<PopupTheme>) => void,
  replaceThemeFull: (next: PopupTheme) => void,
  /** 每步为整主题 structuredClone；默认 20 步控制内存 */
  maxHistory: number = DEFAULT_MAX_HISTORY,
) {
  const themeRef = useRef(theme)
  themeRef.current = theme
  const onUpdateRef = useRef(onUpdateTheme)
  onUpdateRef.current = onUpdateTheme
  const replaceFullRef = useRef(replaceThemeFull)
  replaceFullRef.current = replaceThemeFull

  const pastRef = useRef<PopupTheme[]>([])
  const futureRef = useRef<PopupTheme[]>([])
  const skipRef = useRef(false)
  const [rev, setRev] = useState(0)
  const bump = useCallback(() => setRev((r) => r + 1), [])

  useEffect(() => {
    pastRef.current = []
    futureRef.current = []
    bump()
  }, [theme.id, bump])

  const maxRef = useRef(maxHistory)
  maxRef.current = maxHistory

  const pushPast = useCallback(() => {
    const snap = structuredClone(themeRef.current)
    pastRef.current.push(snap)
    const cap = Math.max(1, maxRef.current)
    if (pastRef.current.length > cap) pastRef.current.shift()
  }, [])

  const wrappedOnUpdateTheme = useCallback(
    (themeId: string, patch: Partial<PopupTheme>, meta?: PopupThemeEditUpdateMeta) => {
      if (themeId !== theme.id) {
        onUpdateRef.current(themeId, patch)
        return
      }
      if (!skipRef.current) {
        if (!meta?.skipHistory) {
          pushPast()
        }
        futureRef.current = []
      }
      onUpdateRef.current(themeId, patch)
      if (!meta?.skipHistory) bump()
    },
    [theme.id, pushPast, bump],
  )

  const undo = useCallback(() => {
    if (pastRef.current.length === 0) return
    skipRef.current = true
    const prev = pastRef.current.pop()!
    futureRef.current.push(structuredClone(themeRef.current))
    replaceFullRef.current(prev)
    queueMicrotask(() => {
      skipRef.current = false
    })
    bump()
  }, [bump])

  const redo = useCallback(() => {
    if (futureRef.current.length === 0) return
    skipRef.current = true
    const next = futureRef.current.pop()!
    pastRef.current.push(structuredClone(themeRef.current))
    replaceFullRef.current(next)
    queueMicrotask(() => {
      skipRef.current = false
    })
    bump()
  }, [bump])

  const canUndo = pastRef.current.length > 0
  const canRedo = futureRef.current.length > 0

  return {
    wrappedOnUpdateTheme,
    undo,
    redo,
    canUndo,
    canRedo,
    /** 供依赖：按钮 disabled 随栈变化刷新 */
    historyRev: rev,
  }
}
