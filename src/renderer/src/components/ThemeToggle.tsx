import { useCallback } from 'react'
import type { AppThemeSetting } from '../../../shared/settings'

export type { AppThemeSetting }

interface ThemeToggleProps {
  value: AppThemeSetting
  onChange: (theme: AppThemeSetting) => void
}

const SunIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="5" />
    <line x1="12" y1="1" x2="12" y2="3" />
    <line x1="12" y1="21" x2="12" y2="23" />
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
    <line x1="1" y1="12" x2="3" y2="12" />
    <line x1="21" y1="12" x2="23" y2="12" />
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
  </svg>
)

const MoonIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
)

const SystemIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  </svg>
)

const ICONS: Record<AppThemeSetting, React.ReactNode> = {
  light: <SunIcon />,
  dark: <MoonIcon />,
  system: <SystemIcon />,
}

const LABELS: Record<AppThemeSetting, string> = {
  light: '浅色',
  dark: '深色',
  system: '跟随系统',
}

export function ThemeToggle({ value, onChange }: ThemeToggleProps) {
  const cycle = useCallback(() => {
    const order: AppThemeSetting[] = ['light', 'dark', 'system']
    const idx = order.indexOf(value)
    onChange(order[(idx + 1) % order.length])
  }, [value, onChange])

  return (
    <button
      type="button"
      onClick={cycle}
      title={LABELS[value]}
      className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium border
                 border-slate-300 bg-white text-slate-700
                 hover:bg-slate-50 hover:border-slate-400
                 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200
                 dark:hover:bg-slate-700 dark:hover:border-slate-500
                 transition-colors cursor-pointer"
    >
      {ICONS[value]}
      <span className="hidden sm:inline text-xs">{LABELS[value]}</span>
    </button>
  )
}
