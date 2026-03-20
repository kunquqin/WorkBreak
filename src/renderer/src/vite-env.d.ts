/// <reference types="vite/client" />

import type { AppSettings, CountdownItem } from './types'

declare global {
  interface Window {
    electronAPI?: {
      platform: string
      getSettings: () => Promise<AppSettings>
      getSettingsFilePath: () => Promise<string>
      setSettings: (settings: Partial<AppSettings>) => Promise<
        { success: true; data: AppSettings } | { success: false; error: string }
      >
      showMainWindow: () => void
      getPrimaryDisplaySize: () => Promise<{ width: number; height: number }>
      getReminderCountdowns: () => Promise<CountdownItem[]>
      resetReminderProgress: (key: string, payload?: import('./types').ResetIntervalPayload) => Promise<void>
      setFixedTimeCountdownOverride: (key: string, time: string) => Promise<void>
      resetAllReminderProgress: () => Promise<void>
      restartReminders: () => Promise<void>
      resolvePreviewImageUrl: (imagePath: string) => Promise<
        { success: true; url: string } | { success: false; error: string }
      >
      pickPopupImageFile: () => Promise<
        { success: true; path: string } | { success: false; error: string }
      >
      pickPopupImageFolder: () => Promise<
        { success: true; folderPath: string; files: string[] } | { success: false; error: string }
      >
    }
  }
}

export {}
