import { useRef, useCallback, useEffect, useState } from 'react'
import type { PopupTheme } from '../types'

const MAX_HISTORY = 80

/**
 * 主题编辑撤销 / 重做：在每次 `onUpdateTheme` 前压入当前主题快照，`replaceThemeFull` 恢复整主题。
 * 通过 ref 持有最新的 `onUpdateTheme` / `replaceThemeFull`，避免子项弹窗等内联函数导致闭包过期。
 */
export function usePopupThemeEditHistory(
  theme: PopupTheme,
  onUpdateTheme: (themeId: string, patch: Partial<PopupTheme>) => void,
  replaceThemeFull: (next: PopupTheme) => void,
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

  const pushPast = useCallback(() => {
    const snap = structuredClone(themeRef.current)
    pastRef.current.push(snap)
    if (pastRef.current.length > MAX_HISTORY) pastRef.current.shift()
  }, [])

  const wrappedOnUpdateTheme = useCallback(
    (themeId: string, patch: Partial<PopupTheme>) => {
      if (themeId !== theme.id) {
        onUpdateRef.current(themeId, patch)
        return
      }
      if (!skipRef.current) {
        pushPast()
        futureRef.current = []
      }
      onUpdateRef.current(themeId, patch)
      bump()
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
