export type {
  AppSettings,
  CategoryKind,
  PresetPools,
  ReminderCategory,
  SubReminder,
  CountdownItem,
  PopupTheme,
  PopupThemeTarget,
  AppEntitlements,
  ResetIntervalPayload,
} from '../../shared/settings'

export {
  getStableDefaultCategories,
  getDefaultReminderCategories,
  getDefaultPresetPools,
  getDefaultPopupThemes,
  getDefaultEntitlements,
  genId,
} from '../../shared/settings'
