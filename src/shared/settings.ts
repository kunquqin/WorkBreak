/**
 * 提醒相关类型与默认值，主进程与渲染进程共用。
 */

import type { PopupThemeLayer } from './popupThemeLayers'
import { ensureThemeLayers } from './popupThemeLayers'

export { ensureThemeLayers } from './popupThemeLayers'
export type { PopupThemeLayer } from './popupThemeLayers'
export {
  POPUP_LAYER_BACKGROUND_ID,
  POPUP_LAYER_OVERLAY_ID,
  POPUP_LAYER_BINDING_CONTENT_ID,
  POPUP_LAYER_BINDING_TIME_ID,
  MAX_TEXT_LAYERS,
  MAX_DECORATION_IMAGE_LAYERS,
} from './popupThemeLayers'

/** 大类下仅允许一种子项：闹钟 / 倒计时 / 秒表（无提醒弹窗，仅界面计时） */
export type CategoryKind = 'alarm' | 'countdown' | 'stopwatch'
export type SubReminderMode = 'fixed' | 'interval' | 'stopwatch'
export type PopupThemeTarget = 'main' | 'rest'

/** 系统内置结束弹窗主题 id（normalize 保证存在，子项默认优先绑定） */
export const SYSTEM_MAIN_POPUP_THEME_ID = 'theme_main_default' as const
/** 系统内置休息弹窗主题 id */
export const SYSTEM_REST_POPUP_THEME_ID = 'theme_rest_default' as const

/**
 * 子项主文案为空时弹窗显示的兜底，与系统默认结束主题的预览文案一致。
 */
export const BUILTIN_MAIN_POPUP_FALLBACK_BODY = '时间到！'

/**
 * 休息弹窗 restContent 为空时的兜底，与系统默认休息主题预览文案一致。
 */
export const BUILTIN_REST_POPUP_FALLBACK_BODY = '休息一下'
export type PopupBackgroundType = 'solid' | 'image'
export type PopupOverlayMode = 'solid' | 'gradient'
export type PopupOverlayGradientDirection =
  | 'leftToRight'
  | 'rightToLeft'
  | 'topToBottom'
  | 'bottomToTop'
  | 'topLeftToBottomRight'
  | 'topRightToBottomLeft'
  | 'bottomLeftToTopRight'
  | 'bottomRightToTopLeft'
  | 'custom'
export type PopupTextAlign = 'left' | 'center' | 'right' | 'start' | 'end' | 'justify'
export type PopupTextVerticalAlign = 'top' | 'middle' | 'bottom'
export type PopupImageSourceType = 'single' | 'folder'
export type PopupFolderPlayMode = 'sequence' | 'random'

/**
 * 单层文字描边 / 阴影（弹窗与预览共用；参数对齐 Keynote 类工具）。
 * 角度：0° 向右，90° 向下（屏幕坐标）。
 */
export interface PopupLayerTextEffects {
  strokeEnabled?: boolean
  /** 描边宽度（px），上限见 popupTextEffects.POPUP_TEXT_STROKE_WIDTH_MAX */
  strokeWidthPx?: number
  strokeColor?: string
  strokeOpacity?: number
  shadowEnabled?: boolean
  shadowColor?: string
  shadowOpacity?: number
  /** 模糊半径（px） */
  shadowBlurPx?: number
  /** 扩散 / 光晕大小（px），与 blur 叠加 */
  shadowSizePx?: number
  /** 阴影偏移距离（px，弹窗逻辑像素） */
  shadowDistancePx?: number
  shadowAngleDeg?: number
}

/** 文字元素空间变换（百分比定位 + 旋转 + 缩放 + 可选文字框尺寸） */
export interface TextTransform {
  /** 水平位置，容器宽度百分比（0=左边, 50=居中, 100=右边） */
  x: number
  /** 垂直位置，容器高度百分比（0=顶部, 50=居中, 100=底部） */
  y: number
  /** 旋转角度（度） */
  rotation: number
  /** 缩放倍率（1=原始大小） */
  scale: number
  /**
   * 文字块占弹窗内容区宽度百分比（约 5～96）；缺省时不固定宽，由内容与 max-width 限制。
   * 预览区用 Moveable 四边/四角拉伸调节，文字在框内换行自适应。
   * **时间/倒计时**：未设 `shortLayerTextBoxLockWidth` 时宽度随文字（`width:max-content`），本字段仅作 **`max-width` 上限**；锁定后与本字段组成定宽 `width:…%`（与真实弹窗一致）。
   */
  textBoxWidthPct?: number
  /** 文字块占弹窗内容区高度百分比（约 3～100）；缺省时高度随内容。 */
  textBoxHeightPct?: number
  /**
   * 仅 **time / countdown** 使用：`true` 时 `textBoxWidthPct` 为定宽；缺省/false 时横向贴字宽，`textBoxWidthPct` 仅限制最大宽度（便于 Moveable 外框贴合「12:00」等单行）。
   */
  shortLayerTextBoxLockWidth?: boolean
  /**
   * 仅主文案 content 使用：用户用预览四边拉框（或面板里填了宽高）后为 true，
   * 此后宽度不再随字数自动「贴边/60%」变化，失焦只自动增高；缺省/false 为自动栏宽模式。
   */
  contentTextBoxUserSized?: boolean
}

export function defaultTextTransform(): TextTransform {
  return { x: 50, y: 50, rotation: 0, scale: 1 }
}

export interface PopupTheme {
  id: string
  name: string
  /** 主题结构版本，便于未来多图层等扩展迁移；缺省按 1；含图层栈时为 2 */
  formatVersion?: number
  /**
   * 弹窗绘制顺序：数组从底到顶（后者覆盖前者）。
   * 缺省时由 ensureThemeLayers 从旧字段推导。
   */
  layers?: PopupThemeLayer[]
  target: PopupThemeTarget
  backgroundType: PopupBackgroundType
  backgroundColor: string
  imageSourceType?: PopupImageSourceType
  imagePath?: string
  imageFolderPath?: string
  imageFolderFiles?: string[]
  imageFolderPlayMode?: PopupFolderPlayMode
  imageFolderIntervalSec?: number
  overlayEnabled: boolean
  overlayColor: string
  overlayOpacity: number
  overlayMode?: PopupOverlayMode
  overlayGradientDirection?: PopupOverlayGradientDirection
  overlayGradientAngleDeg?: number
  overlayGradientStartOpacity?: number
  overlayGradientEndOpacity?: number
  contentColor: string
  timeColor: string
  countdownColor: string
  contentFontSize: number
  timeFontSize: number
  countdownFontSize: number
  /**
   * @deprecated 旧版全局字体；无分层字段时 `resolvePopupFontFamilyCss` 仍作回退。
   */
  popupFontFamilyPreset?: string
  /** @deprecated 旧版全局本机字体名 */
  popupFontFamilySystem?: string
  /** 主文案：字体预设 id */
  contentFontFamilyPreset?: string
  /** 主文案：本机字体族名 */
  contentFontFamilySystem?: string
  timeFontFamilyPreset?: string
  timeFontFamilySystem?: string
  countdownFontFamilyPreset?: string
  countdownFontFamilySystem?: string
  textAlign: PopupTextAlign
  /** 全局文字垂直对齐；缺省回落到 middle */
  textVerticalAlign?: PopupTextVerticalAlign
  /** 字重 (100-900) */
  contentFontWeight?: number
  timeFontWeight?: number
  countdownFontWeight?: number
  /** 斜体 */
  contentFontItalic?: boolean
  timeFontItalic?: boolean
  countdownFontItalic?: boolean
  /** 下划线 */
  contentUnderline?: boolean
  timeUnderline?: boolean
  countdownUnderline?: boolean
  /** 提醒内容文字空间变换（可选，undefined 时使用传统 flex 布局） */
  contentTransform?: TextTransform
  /** 时间文字空间变换 */
  timeTransform?: TextTransform
  /** 倒计时数字空间变换（仅休息弹窗） */
  countdownTransform?: TextTransform
  /** 各文字层独立对齐；缺省回落到 textAlign */
  contentTextAlign?: PopupTextAlign
  timeTextAlign?: PopupTextAlign
  countdownTextAlign?: PopupTextAlign
  /** 各文字层独立垂直对齐；缺省回落到 textVerticalAlign */
  contentTextVerticalAlign?: PopupTextVerticalAlign
  timeTextVerticalAlign?: PopupTextVerticalAlign
  countdownTextVerticalAlign?: PopupTextVerticalAlign
  /** 字间距（px），约 -2～20 */
  contentLetterSpacing?: number
  timeLetterSpacing?: number
  countdownLetterSpacing?: number
  /** 行高（无单位倍数），如 1.35 */
  contentLineHeight?: number
  timeLineHeight?: number
  countdownLineHeight?: number
  /**
   * 主题工坊/预览用占位文案（真实弹窗仍用提醒子项的 content / 时间等；仅无子项上下文时用于预览与编辑）。
   */
  previewContentText?: string
  previewTimeText?: string
  previewCountdownText?: string
  /** 主文案描边/阴影 */
  contentTextEffects?: PopupLayerTextEffects
  timeTextEffects?: PopupLayerTextEffects
  countdownTextEffects?: PopupLayerTextEffects
}

export interface AppEntitlements {
  popupThemeLevel: 'free' | 'pro'
}

/** 拆分与中间休息（闹钟、倒计时均可选） */
export interface SplitRestOptions {
  /** 拆成几份，默认 1 表示不拆分 */
  splitCount?: number
  /** 中间休息时长（秒），0 表示无休息 */
  restDurationSeconds?: number
  /** 休息时弹窗文案 */
  restContent?: string
}

/** 子提醒：闹钟 / 倒计时 / 秒表（无 content、无提醒） */
export type SubReminder =
  | ({
      id: string
      mode: 'fixed'
      /** 子项标题（仅用于列表展示） */
      title?: string
      /** 开关状态：true=启用，false=关闭 */
      enabled?: boolean
      /** 起始时间（HH:mm）；缺省时兼容旧配置，按旧单时间语义回退 */
      startTime?: string
      /** 结束时间（HH:mm） */
      time: string
      content: string
      /** 与 Date.getDay() 一致：0=周日…6=周六；缺省表示每天均重复（兼容旧配置） */
      weekdaysEnabled?: boolean[]
      /** 主弹窗主题 id */
      mainPopupThemeId?: string
      /** 休息弹窗主题 id（拆分>1时生效） */
      restPopupThemeId?: string
      /** 新建时"当前时间"开关状态：true=起始时间跟随当前时间 */
      useNowAsStart?: boolean
    } & SplitRestOptions)
  | ({ id: string; mode: 'interval'; title?: string; enabled?: boolean; intervalHours?: number; intervalMinutes: number; intervalSeconds?: number; content: string; repeatCount: number | null; mainPopupThemeId?: string; restPopupThemeId?: string } & SplitRestOptions)
  | { id: string; mode: 'stopwatch'; content?: string }

/** 提醒类型（用户可增删），下含多个子提醒；categoryKind 决定仅闹钟或仅倒计时子项 */
export interface ReminderCategory {
  id: string
  name: string
  /** 闹钟仅 fixed；倒计时仅 interval；秒表仅 stopwatch */
  categoryKind: CategoryKind
  /** 弹窗文案预设 */
  presets: string[]
  /** 标题预设 */
  titlePresets: string[]
  items: SubReminder[]
}

export interface AppSettings {
  reminderCategories: ReminderCategory[]
  presetPools: PresetPools
  popupThemes: PopupTheme[]
  entitlements: AppEntitlements
}

export interface PresetPools {
  /** 大类标题预设：按闹钟/倒计时/秒表分池，互不相通 */
  categoryTitle: Record<CategoryKind, string[]>
  /** 子项标题预设：按闹钟/倒计时/秒表分池，互不相通 */
  subTitle: Record<SubReminderMode, string[]>
  /** 主弹窗文案预设：闹钟 + 倒计时共享 */
  reminderContent: string[]
  /** 休息弹窗文案预设：拆分休息共享，且与主弹窗文案隔离 */
  restContent: string[]
}

/** 重置进度时由渲染进程传入的当前间隔配置（可与磁盘不一致），主进程优先使用 */
export interface ResetIntervalPayload {
  categoryName: string
  content: string
  mainPopupThemeId?: string
  restPopupThemeId?: string
  intervalHours?: number
  intervalMinutes: number
  intervalSeconds?: number
  repeatCount: number | null
  splitCount?: number
  restDurationSeconds?: number
  restContent?: string
}

/** 设置页倒计时展示用，由主进程 getReminderCountdowns 返回。拆分时附带 phase 信息用于多段进度条。 */
export interface CountdownItem {
  key: string
  type: 'fixed' | 'interval'
  nextAt: number
  remainingMs: number
  /** 固定时间窗口状态：未开始/运行中/已结束（单次） */
  fixedState?: 'pending' | 'running' | 'ended'
  /** 固定时间窗口实例起点时间戳（用于显示与进度计算） */
  windowStartAt?: number
  /** 固定时间窗口实例终点时间戳（用于显示与进度计算） */
  windowEndAt?: number
  /** 当前周期已结束（如 fixed 单次已触发、interval 达到重复次数） */
  ended?: boolean
  /** 固定时间配置起始 HH:mm（可选） */
  startTime?: string
  time?: string
  repeatCount?: number | null
  firedCount?: number
  /** 拆分份数，>1 时有多段进度 */
  splitCount?: number
  /** 每段工作时长（毫秒） */
  segmentDurationMs?: number
  /** 每段工作时长列表（毫秒），支持“总时长扣除休息后均分”产生的不等长段 */
  workDurationsMs?: number[]
  /** 中间休息时长（毫秒），0 不显示蓝条 */
  restDurationMs?: number
  /** 当前阶段 work | rest */
  currentPhase?: 'work' | 'rest'
  /** 当前阶段索引（工作 0..splitCount-1，休息 0..splitCount-2） */
  phaseIndex?: number
  /** 当前阶段已过时间（毫秒） */
  phaseElapsedMs?: number
  /** 当前阶段总时长（毫秒） */
  phaseTotalMs?: number
  /** 整轮总时长（毫秒），用于进度条总长 */
  cycleTotalMs?: number
  /** 仅工作段剩余时间（毫秒），不含休息；用于倒计时显示，与用户设置的「倒计时」一致 */
  workRemainingMs?: number
  /** 本周期起始时间戳；固定时间在「重置」后由主进程设为当前时刻，用于进度条/沙漏从新起点计算 */
  cycleStartAt?: number
  /** 是否为"当前时间"启动模式 */
  useNowAsStart?: boolean
  /** 是否有每周重复（非单次） */
  hasWeeklyRepeat?: boolean
}

function genId(): string {
  return `id_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

const defaultMealPresets = ['记得吃早餐哦～', '该吃午饭啦，休息一下～', '记得吃晚饭～', '按时吃饭，身体棒棒']
const defaultActivityPresets = ['坐太久啦，站起来动一动、看看远处吧～', '活动一下，伸个懒腰吧', '喝杯水，走一走']
const defaultRestPresets = ['已经工作一段时间了，休息一下吧～', '休息一下，眼睛看看远处', '喝杯水再继续']

export function getDefaultPresetPools(): PresetPools {
  return {
    categoryTitle: {
      alarm: ['用餐提醒', '作息提醒', '通勤提醒'],
      countdown: ['久坐活动', '专注节奏', '健康打卡'],
      stopwatch: ['专注计时', '任务计时', '训练计时'],
    },
    subTitle: {
      fixed: ['早餐', '午餐', '晚餐', '下班准备', '睡前放松'],
      interval: ['喝水', '起身活动', '远眺护眼', '专注一轮', '复盘整理'],
      stopwatch: ['代码冲刺', '会议计时', '阅读计时', '训练组间', '自定义计时'],
    },
    reminderContent: [
      '起床',
      '上班',
      '下班',
      '吃饭',
      '睡觉',
      '时间到',
    ],
    restContent: [
      '休息一下',
      '起来走走',
      '活动身子',
      '放松眼睛',
      '伸个懒腰',
    ],
  }
}

function defaultMainTheme(): PopupTheme {
  return {
    id: SYSTEM_MAIN_POPUP_THEME_ID,
    name: '结束壁纸默认',
    formatVersion: 1,
    target: 'main',
    previewContentText: BUILTIN_MAIN_POPUP_FALLBACK_BODY,
    backgroundType: 'solid',
    backgroundColor: '#000000',
    overlayEnabled: false,
    overlayColor: '#000000',
    overlayOpacity: 0.45,
    overlayMode: 'solid',
    overlayGradientDirection: 'leftToRight',
    overlayGradientAngleDeg: 90,
    overlayGradientStartOpacity: 0.7,
    overlayGradientEndOpacity: 0,
    contentColor: '#ffffff',
    timeColor: '#e2e8f0',
    countdownColor: '#ffffff',
    contentFontSize: 180,
    timeFontSize: 100,
    countdownFontSize: 180,
    textAlign: 'center',
    contentTransform: { x: 50, y: 42, rotation: 0, scale: 1 },
    /** 时间单行高度随字，不设 textBoxHeightPct，与预览 Moveable 贴边一致 */
    timeTransform: { x: 50, y: 55, rotation: 0, scale: 1 },
  }
}

function defaultRestTheme(): PopupTheme {
  return {
    id: SYSTEM_REST_POPUP_THEME_ID,
    name: '休息壁纸默认',
    formatVersion: 1,
    target: 'rest',
    previewContentText: BUILTIN_REST_POPUP_FALLBACK_BODY,
    backgroundType: 'solid',
    backgroundColor: '#000000',
    overlayEnabled: false,
    overlayColor: '#000000',
    overlayOpacity: 0.45,
    overlayMode: 'solid',
    overlayGradientDirection: 'leftToRight',
    overlayGradientAngleDeg: 90,
    overlayGradientStartOpacity: 0.7,
    overlayGradientEndOpacity: 0,
    contentColor: '#ffffff',
    timeColor: '#e2e8f0',
    countdownColor: '#ffffff',
    contentFontSize: 180,
    timeFontSize: 100,
    countdownFontSize: 180,
    textAlign: 'center',
    contentTransform: { x: 50, y: 42, rotation: 0, scale: 1 },
    timeTransform: { x: 50, y: 55, rotation: 0, scale: 1 },
    countdownTransform: { x: 50, y: 70, rotation: 0, scale: 1, textBoxHeightPct: 20 },
  }
}

export function getDefaultPopupThemes(): PopupTheme[] {
  return [ensureThemeLayers(defaultMainTheme()), ensureThemeLayers(defaultRestTheme())]
}

/**
 * 保证 `theme_main_default` / `theme_rest_default` 各至少存在一条（缺则插入内置快照）。
 * 用于主进程 normalize 与设置页删除主题后的本地列表修复。
 */
export function mergeSystemBuiltinPopupThemes(themes: PopupTheme[]): PopupTheme[] {
  const defaults = getDefaultPopupThemes()
  const mainSnap = defaults.find((t) => t.id === SYSTEM_MAIN_POPUP_THEME_ID)
  const restSnap = defaults.find((t) => t.id === SYSTEM_REST_POPUP_THEME_ID)
  if (!mainSnap || !restSnap) return themes.length > 0 ? themes : defaults
  const hasMain = themes.some((t) => t.id === SYSTEM_MAIN_POPUP_THEME_ID)
  const hasRest = themes.some((t) => t.id === SYSTEM_REST_POPUP_THEME_ID)
  let next = [...themes]
  if (!hasMain) next = [mainSnap, ...next]
  if (!hasRest) {
    const mainIdx = next.findIndex((t) => t.id === SYSTEM_MAIN_POPUP_THEME_ID)
    if (mainIdx >= 0) next.splice(mainIdx + 1, 0, restSnap)
    else next.push(restSnap)
  }
  return next
}

/** 新建子项 / 下拉缺省时：优先系统默认 id，否则同 target 首条，否则仍返回系统 id（待 normalize 补主题）。 */
export function getDefaultPopupThemeIdForTarget(themes: PopupTheme[], target: PopupThemeTarget): string {
  const systemId = target === 'main' ? SYSTEM_MAIN_POPUP_THEME_ID : SYSTEM_REST_POPUP_THEME_ID
  if (themes.some((t) => t.id === systemId)) return systemId
  return themes.find((t) => t.target === target)?.id ?? systemId
}

export function getDefaultEntitlements(): AppEntitlements {
  return { popupThemeLevel: 'free' }
}

/** 默认提醒分类（对应原吃饭/活动/休息） */
export function getDefaultReminderCategories(): ReminderCategory[] {
  return [
    {
      id: genId(),
      name: '吃饭',
      categoryKind: 'alarm',
      presets: [...defaultMealPresets],
      titlePresets: [],
      items: [
        { id: genId(), mode: 'fixed', enabled: true, time: '08:00', content: defaultMealPresets[0] },
        { id: genId(), mode: 'fixed', enabled: true, time: '12:00', content: defaultMealPresets[1] },
        { id: genId(), mode: 'fixed', enabled: true, time: '18:00', content: defaultMealPresets[2] },
      ],
    },
    {
      id: genId(),
      name: '活动',
      categoryKind: 'countdown',
      presets: [...defaultActivityPresets],
      titlePresets: [],
      items: [
        { id: genId(), mode: 'interval', enabled: true, intervalMinutes: 45, content: defaultActivityPresets[0], repeatCount: null },
      ],
    },
    {
      id: genId(),
      name: '休息',
      categoryKind: 'countdown',
      presets: [...defaultRestPresets],
      titlePresets: [],
      items: [
        { id: genId(), mode: 'interval', enabled: true, intervalMinutes: 25, content: defaultRestPresets[0], repeatCount: null },
      ],
    },
  ]
}

/** 生成稳定默认值（用于迁移或空配置），id 用固定前缀便于测试 */
export function getStableDefaultCategories(): ReminderCategory[] {
  return [
    {
      id: 'cat_meal',
      name: '吃饭',
      categoryKind: 'alarm',
      presets: [...defaultMealPresets],
      titlePresets: [],
      items: [
        { id: 'meal_breakfast', mode: 'fixed', enabled: true, time: '08:00', content: defaultMealPresets[0] },
        { id: 'meal_lunch', mode: 'fixed', enabled: true, time: '12:00', content: defaultMealPresets[1] },
        { id: 'meal_dinner', mode: 'fixed', enabled: true, time: '18:00', content: defaultMealPresets[2] },
      ],
    },
    {
      id: 'cat_activity',
      name: '活动',
      categoryKind: 'countdown',
      presets: [...defaultActivityPresets],
      titlePresets: [],
      items: [
        { id: 'activity_1', mode: 'interval', enabled: true, intervalMinutes: 45, content: defaultActivityPresets[0], repeatCount: null },
      ],
    },
    {
      id: 'cat_rest',
      name: '休息',
      categoryKind: 'countdown',
      presets: [...defaultRestPresets],
      titlePresets: [],
      items: [
        { id: 'rest_1', mode: 'interval', enabled: true, intervalMinutes: 25, content: defaultRestPresets[0], repeatCount: null },
      ],
    },
  ]
}

export { genId }
