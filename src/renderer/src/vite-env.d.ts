/// <reference types="vite/client" />

import type { AppSettings, CountdownItem, PopupTheme } from './types'

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
      /** 主窗口已显示但页面未跟前台时补偿聚焦，避免首击无法进入输入框 */
      focusMainWebContents: () => void
      /** 主题工坊/编辑：与到点弹窗相同 HTML 的全屏预览 */
      openThemeEditorFullscreenPreview: (
        theme: PopupTheme,
      ) => Promise<{ success: true } | { success: false; error: string }>
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
      /** 根据文件夹路径枚举壁纸文件（与选择文件夹对话框规则一致） */
      listPopupImageFolderFiles: (folderPath: string) => Promise<
        { success: true; files: string[] } | { success: false; error: string }
      >
      getSystemFontFamilies: () => Promise<
        { success: true; fonts: string[] } | { success: false; fonts: string[]; error: string }
      >
      clearSystemFontListCache: () => Promise<void>
      startDesktopLiveWallpaper: (
        theme: PopupTheme,
      ) => Promise<
        | { success: true }
        | { success: false; error: string }
        | { pending: true; requestId: number }
      >
      /** 与 `start` 返回的 `requestId` 配对，过滤乱序/过期的完成事件 */
      waitDesktopLiveWallpaperApplyDone: (
        requestId: number,
      ) => Promise<{ success: true } | { success: false; error: string }>
      stopDesktopLiveWallpaper: () => Promise<{ success: true }>;
      isDesktopLiveWallpaperActive: () => Promise<boolean>;
      getDesktopLiveWallpaperState: () => Promise<{ active: boolean; themeId: string | null }>;
      onMenuUndo?: (cb: () => void) => () => void
      onMenuRedo?: (cb: () => void) => () => void
    }
  }
}

export {}
