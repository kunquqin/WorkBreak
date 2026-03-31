# 喵息（MeowBreak）— Agent 开发指引

本文档为 AI Agent 与开发者提供产品背景、技术约定和实现边界，便于从零协作开发 **喵息 / MeowBreak** 桌面应用。

---

## 1. 产品概览

### 1.1 名称与描述

- **产品名称**：喵息（英文 **MeowBreak**）；仓库目录名可仍为 `01_WorkBreak`。
- **一句话描述**：帮助长期对着电脑工作的打工人，按时收到可配置的多种提醒（吃饭、活动、休息等）的桌面应用。

### 1.2 目标用户与场景

- **主要用户**：长时间坐在电脑前的上班族、自由职业者、程序员。
- **使用场景**：工作日开着电脑时，容易忘记吃饭、久坐不动、连续工作不休息。

### 1.3 要解决的核心问题

- **现有方案**：手机闹钟、系统日历提醒、便利贴。
- **现有方案的问题**：需手动设置、不够智能、易被忽略、与工作流割裂。
- **本产品**：常驻系统托盘，按计划自动提醒，无需每天重新设置。

---

## 2. 功能边界（MVP）

### 2.1 要做（第一版）

1. **可配置提醒**：用户可新增**闹钟**、**倒计时**或**秒表**大类。闹钟/倒计时规则不变：`categoryKind` 为 `alarm` | `countdown`，子项分别为 `mode: 'fixed'` 与 `mode: 'interval'`。**秒表**大类 `categoryKind: 'stopwatch'`，子项为 `mode: 'stopwatch'`（可选标题 `content?: string`、无弹窗、不参与主进程定时器）；运行态与打点列表仅存设置页内存，不落盘。旧配置无 `categoryKind` 时由主进程归一化推断。
2. **系统托盘**：后台静默运行，托盘图标与基础菜单。
3. **设置界面**：可增删改大类与子提醒、管理预设、持久化到本地。

### 2.2 不做（第一版）

- 不做健康数据统计与报表。
- 不做团队协作。
- 不做手机端。
- 不做 AI 智能调度。
- 不做日历系统集成。

### 2.3 参考产品

- 类似 [Stretchly](https://github.com/hovancik/stretchly)（开源休息提醒），在此基础上增加**吃饭提醒**和**更友好的设置界面**。

---

## 3. 技术栈与目录结构

### 3.1 技术栈

- **运行时**：Electron（优先支持 Windows，未来兼容 macOS）。
- **前端**：React 18 + TypeScript。
- **样式**：Tailwind CSS。
- **构建**：Vite + vite-plugin-electron。

### 3.2 目录结构

```
01_WorkBreak/
├── AGENTS.md                 # 本文件：产品与开发指引
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tsconfig.node.json
├── tailwind.config.js
├── postcss.config.js
├── .gitignore
│
├── src/
│   ├── main/                 # Electron 主进程
│   │   ├── index.ts          # 入口：窗口、托盘、IPC、单实例锁
│   │   ├── settings.ts       # 设置读写与持久化
│   │   ├── reminders.ts      # 可配置提醒的定时与弹窗触发
│   │   ├── reminderWindow.ts # 弹窗窗口创建、主题渲染、临时 HTML 生成
│   │   └── tray.ts           # 托盘图标与菜单
│   ├── preload/              # 预加载脚本（主进程与渲染进程桥接）
│   │   ├── index.ts          # 源码（Vite 可构建，当前未用于加载）
│   │   └── preload.cjs       # 手写 CommonJS，供 Electron 加载（项目 "type":"module" 下 .js 会被当 ESM）
│   ├── shared/               # 主进程与渲染进程共用类型与默认值（如 settings.ts）
│   └── renderer/             # React 渲染进程（前端）
│       ├── index.html
│       └── src/
│           ├── main.tsx      # React 入口
│           ├── App.tsx       # 根组件
│           ├── index.css     # 全局样式（Tailwind 入口）
│           ├── vite-env.d.ts # 类型声明（含 window.electronAPI）
│           ├── types.ts      # 类型与默认值（可引用 src/shared）
│           ├── pages/        # 页面级组件（如 Settings.tsx）
│           ├── components/   # 通用 UI（如 AddSubReminderModal、SegmentProgressBars、PopupThemeColorSwatch）
│           ├── hooks/        # 如 usePopupThemeEditHistory（主题编辑撤销 / skipHistory）
│           ├── stores/       # 状态（后续添加）
│           └── utils/        # 工具（如 durationFormat、stopwatchUtils）
│
└── out/                      # 构建产物（git 忽略）
    ├── main/
    ├── preload/
    └── renderer/
```

### 3.3 脚本约定

- `npm run dev`：启动 Vite 开发服务器 + Electron，带 HMR。
- `npm run build`：构建主进程 + 预加载 + 渲染进程到 `out/`。
- `npm run start`：使用已构建产物运行 Electron（需先 `npm run build`）。

---

## 4. 开发约定

### 4.1 代码与风格

- 使用 **TypeScript**，开启严格模式；渲染进程与主进程均写 TS。
- 组件与页面使用 **函数组件 + Hooks**，优先 `named export` 便于按需引用。
- 样式以 **Tailwind** 为主，必要时配合 `index.css` 中的少量自定义类。
- 路径别名：`@/` 指向 `src/renderer/src/`，用于 `import '@/components/...'` 等。

### 4.2 跨进程通信

- 仅通过 **preload** 暴露能力给渲染进程；使用 `contextBridge.exposeInMainWorld`，不直接暴露 `require('electron')`。
- **Preload 必须为 CommonJS**：因 `package.json` 含 `"type":"module"`，Electron 用 `require()` 加载 preload，故使用手写 `src/preload/preload.cjs`；开发时主进程从源码加载 `resolve(__dirname, '../../src/preload/preload.cjs')`。
- 在 `src/renderer/src/vite-env.d.ts` 中为 `window.electronAPI` 等扩展类型，保持类型安全。

### 4.3 平台兼容

- 优先保证 **Windows** 行为正确；涉及路径、托盘、通知时考虑 **macOS** 差异（如 `process.platform === 'darwin'`），避免写死 Windows 逻辑，为后续兼容留口子。

### 4.4 状态与持久化

- **设置**：开发环境（有 `VITE_DEV_SERVER_URL`）写入项目根目录 `workbreak-settings.json`，便于排查；同时将 `app.setPath('userData')` 指到仓库内 `.electron-user-data/`，避免与已安装版共用 `%APPDATA%\workbreak` 导致 Chromium 缓存锁/0x5 秒退。生产环境写入 `app.getPath('userData')/settings.json`。主进程启动时 `app.setName('workbreak')` 保证正式包 userData 路径一致。
- **保存设置**：仅将当前配置写入磁盘（`setSettings`），**不**调用 `restartReminders()`、**不**清除闹钟（fixed）override，因此不会重置任何提醒的起始点或进度。
- **全部重置**：设置页提供「全部重置」按钮，调用主进程 `resetAllReminderProgress()`，将所有**闹钟**子项设为“从当前时刻开始”、所有**倒计时**子项从当前时刻重新排程；使用当前已保存的配置（`getSettings()`）。
- 提醒计划、定时器均在主进程 `reminders.ts`，以主进程为“单一事实来源”；应用启动时由 `startReminders()` 排程。
- **normalizeCategories 保全字段**：`main/settings.ts` 的 `normalizeCategories` 负责反序列化校验；为 `SubReminder` 的每种 mode 分支构造对象时，**必须保留该 mode 的全部字段**（如秒表的 `content`、闹钟的 `weekdaysEnabled`）。否则 auto-save → hydrate 后新加的字段会丢失。

### 4.5 闹钟（mode: fixed）「重置」与开始时间

- **重置**：用户对某条**闹钟**子项点击「重置」时，主进程 `setFixedTimeCountdownOverride(key, item.time)` 会记录该时刻为周期起点（`fixedTimeCycleStartAt.set(key, Date.now())`），并在后续每次 `getReminderCountdowns()` 中返回该**时间戳**作为 `cycleStartAt`（不可用“当前时间”覆盖，否则起始时间会跟着时钟变）。
- **起始时间显示**：列表视图进度条左侧「起始时间」= 该周期的真实起点：有 `cycleStartAt` 时用其格式化为 HH:mm，否则用设定时间 `cd.time`（如 20:00）。不要用 `Date.now()` 作为闹钟子项的起始时间标签。
- **保存后**：保存设置**不**清除 override；仅「全部重置」会按需更新。若需“保存后恢复为按上次设定时间”的语义，再考虑在保存时调用 `clearFixedTimeCountdownOverrides()`（当前未采用）。
- **单次闹钟启动/重置**：`setFixedTimeCountdownOverride` 必须同时清理 `fixedSingleShotState`（否则会持续 `ended=true`）、并清理 fixed 拆分休息相关定时器与去重状态（避免新周期沿用旧周期痕迹）。
- **fixed 拆分休息调度**：休息弹窗与休息结束倒计时采用**绝对时间 setTimeout 预调度**，不依赖“整分钟轮询命中窗口”；并在应用启动与 fixed 启动/重置后立即补一次调度检查，避免秒级分段漏弹窗。
- **单次结束态冻结**：`weekdaysEnabled` 全 false（永不）且已结束时，分段条应保持灰态静止，不再随 `Date.now()` 变化；如需降噪显示，可仅保留休息段标签，隐藏工作段标签。
- **useNowAsStart 开关**：闹钟子项 `useNowAsStart?: boolean`。开启时起始时间跟随系统时间实时更新，确认时以 `Date.now()` 毫秒精度为起点（`fixedPreciseStartAt`）；关闭时用户自定义起止时间范围。编辑态从 `sourceItem.useNowAsStart` 恢复。
- **重置按钮条件显示**：仅在 `useNowAsStart=true` 时显示（倒计时始终显示）。自定义时间范围下隐藏，避免用户误以为"从当前时间启动"。
- **单次结束自动关闭**：主进程 `autoDisableByKey()` 在单次闹钟/倒计时结束后自动 `enabled=false` 并持久化。渲染进程在 polling `useEffect` 中检测到 `cd.ended` + 本地 `enabled` 不一致时，主动 `getSettings()` 刷新。
- **结束态漏斗**：`cd.ended` 时漏斗归位至起点（`anchorPercent=0`），显示"待启动"；手动关闭（`!isEnabled && !cd.ended`）漏斗在终点显示"0:00"。
- **跨天时间标签**：进度条起止时间统一使用 `formatTimeWithDay(ts, fallback, '开始'|'结束')`，当天不加前缀（"开始 HH:mm"），跨天显示"明天开始/明天结束"。开关开启/关闭均一致。
- **禁用态时间戳推算**：`getReminderCountdowns` 中，禁用项的 `windowStartAt`/`windowEndAt` 必须返回有效时间戳（非 null），且当时间窗口已过去时 +24h 推到明天，确保前端 `formatTimeWithDay` 始终走时间戳分支而非 fallback。
- **文案规范**：UI 中统一使用"开始"（非"起始"）、"结束"。

### 4.6 单实例与启动

- 使用 `app.requestSingleInstanceLock()` 保证只运行一个实例，避免重复点 bat 或 HMR 重建时多开窗口；二次启动时聚焦已有窗口。
- 开发启动：项目根目录双击 `启动开发环境.bat` 或终端执行 `npm run dev`。

### 4.7 设置页拖拽与排序

- **大类与子项均用 `@dnd-kit/sortable`**：大类（`CategoryCard`）和子项（`SortableSubReminderItem`）均使用 `DndContext` + `SortableContext` + `useSortable`，手柄上挂 `listeners`。**不再使用 Framer Motion `Reorder`**——Framer 的 FLIP 布局投影在动态高度变化时（如秒表打点区展开）会导致兄弟卡片位置不更新、出现重叠。
- **dnd-kit 可变高度**：`useSortable` 默认的 layout 动画会用 `useDerivedTransform` 注入 **scaleY**（旧/新测量框高度比），拖过另一行时矮卡片会被拉高、高卡片会被压扁；大类与子项侧均已设 **`animateLayoutChanges: () => false`**，且样式 **`transform` 只用 `translate3d`**（`sortableTranslateOnly`），不写 `scale`，避免内容被拉伸。
- **子项 UI**：内层仍为 `SubReminderRow` / `StopwatchReminderRow`（秒表状态仍行内 `useState`）。大类分 `categoryKind`（闹钟 / 倒计时 / 秒表），子项不得跨 kind 移动（`moveItemToCategory` 需同 kind）。
- **拖拽时始终在最上层**：`CategoryCard` 用 `isChildDragging`，在子项 `DndContext` 的 `onDragStart`/`onDragEnd` 切换整卡 `zIndex`（10000）；子项列表容器 `overflow-visible`，避免裁剪。

### 4.8 秒表（设置页）

- **标题**：秒表子项顶部有可选标题（`content?: string`），采用 **点击编辑** 交互：非编辑态显示纯文本（居中），点击进入 `PresetTextField`（支持预设），失焦或 Enter 退出编辑态并自动保存。非编辑态 padding 需与 `PresetTextField` input 的 `pl-2 pr-9` 一致，避免模式切换时文字偏移。
- **状态**：每条秒表子项在 **`StopwatchReminderRow`** 内用 **`useState`** 存 `StopwatchRuntime`，**不要**用全局 `Record<key, …>` 映射多条秒表（易因 id/键冲突或 React 复用导致「复位一条清空多条」）。运行中显示可用 `setInterval` ~50ms，仅在该行 `running` 时启用。
- **逻辑**：`src/renderer/src/utils/stopwatchUtils.ts`（`emptyStopwatch`、`stopwatchLap`、`stopwatchRemoveLap`、显示格式化等）；删除单条打点后按时间重算计次与分段。
- **打点列表**：约 10 条可见用 `max-h-80` + 内部滚动；**dnd-kit 拖拽**时对内层滚动区可在 **`isSortableDragging`** 下 **`pointer-events-none`**，避免抢指针。长页可在 `index.css` 等对根滚动设 **`overflow-anchor: none`**，减轻动态增高时的视口跳动。

### 4.9 倒计时进度条上的时段文案（SegmentProgressBars）

- **组件**：`src/renderer/src/components/SegmentProgressBars.tsx`（`SplitSegmentProgressBar`、`SingleCycleProgressBar` 及弹窗内静态预览条）。
- **截断与气泡**：条上标签使用 `truncate`；若测量为 **`scrollWidth > clientWidth`**（`ResizeObserver`），hover **整条**进度条时在**水平居中、条上方**显示与条同色（**绿**/工作、**蓝**/休息）的**白字气泡**，尖角朝下指向条；**未截断则不显示气泡**。
- **结构**：气泡父级与带 `overflow-hidden` 的圆角条**分层**（外层 `group`、内层条形容器），避免气泡被裁切；**不要**对 sortable 包裹误用会引入 **scaleY** 的整段 `transform`（参见 4.7 dnd-kit 条）。
- **可控标签显示**：`SplitSegmentProgressBar` 支持按段控制是否显示标签（`showLabel`），用于结束灰态降低干扰。

### 4.10 设置页关键交互

- **全部重置需二次确认**：`Settings` 页「全部重置」为谨慎操作，必须先弹确认框；仅在用户点击「确认重置」后才调用 `resetAllReminderProgress()`。

### 4.11 弹窗主题（壁纸）约定

- **架构分层**：**系统设置 · 主题工坊**与**子项新建/编辑**共用 **`PopupThemeEditorPanel`**（内为 `ThemePreviewEditor` + 分页表单，与设置页单卡一致）。子项侧默认仍为**下拉选主题 + 小预览 + 跳转主题工坊**；**未展开详细编辑时**小预览用 **`ThemePreviewEditor`**（双击可改主文案 `content` 并回写表单项，拖拽/旋转/缩放即时 `updatePopupTheme`）。**「编辑主题」**在**同一表单卡片下方内联展开**详细 Panel（非 `document.body` Portal，可 `max-height` 滚动）；再点可收起（有未保存改动时确认）。**保存到主题库**时若内容相对打开快照有变：`countPopupThemeReferences`（可排除当前子项）为 0 则 **`replacePopupTheme`**，否则 **`clonePopupThemeForFork` + `appendPopupTheme`** 并改写子项 `mainPopupThemeId` / `restPopupThemeId`。无实质改动则仅关闭详细区。
- **数据模型**：主题为独立实体 `popupThemes: PopupTheme[]`（`shared/settings.ts`），子项仅绑定主题 id（`mainPopupThemeId`、`restPopupThemeId`）；避免将完整样式字段冗余写入每条子项。
- **目标区分**：主弹窗与休息弹窗主题分开管理；休息弹窗入口仅在拆分 `splitCount > 1` 时显示。
- **会员预留**：`AppEntitlements.popupThemeLevel` 区分 `'free' | 'pro'`；门控能力如渐变遮罩、文件夹壁纸、文字高级排版，先设计开关再接商业化。
- **批量应用**：以子项 `id` 为唯一标识构建候选列表，支持"全部符合条件/自定义选择"两种模式，至少选一条。

### 4.12 弹窗渲染约定（reminderWindow.ts）

- **临时 HTML 文件加载**：弹窗 HTML 写入 `os.tmpdir()` 下的临时 `.html` 文件，用 `BrowserWindow.loadFile()` 加载。**不要**用 `loadURL('data:text/html,...')`——大图片 base64 内嵌会超出 Chromium URL 长度限制，导致弹窗白屏。
- **出错回退**：`loadFile` 失败时自动回退到无主题（纯黑背景）的临时 HTML，确保弹窗始终弹出。
- **并发串行化**：多个弹窗（休息/结束）可能同时触发，但 `BrowserWindow` 是单例，并发 `loadFile` 会崩溃。使用 `popupChain`（Promise 链）+ `popupSeq`（序号）串行化所有 `loadFile` 操作；`closeReminderPopupIfAny` 递增 `popupSeq` 使排队中的加载失效。
- **弹窗内容精简**：主弹窗仅显示"提醒内容 + 时间"；休息弹窗仅显示"休息提醒 + 时间"（由主题排版决定可见层）。**休息段最后 N 秒**单独为固定黑底倒计时页（「休息即将结束」+ 数字），**不**沿用休息主题图层。
- **关闭按钮**：右上角黑色圆底白色 SVG 细线 X（`stroke-width` 控制粗细），鼠标移动时显示、静止 2 秒后隐藏；支持 `Esc` 键关闭。**不要**用"知道了"大按钮。
- **文字尺寸**：使用显式像素值（如 `${contentFont}px`），不使用 CSS `clamp()`，保证渲染确定性与预览一致性。
- **文字定位**：使用 `TextTransform` 百分比绝对定位（`left: x%; top: y%; transform: translate(-50%, -50%) rotate() scale()`），主进程 `transformStyle()` 辅助函数生成 CSS。无 transform 字段时使用默认位置（主弹窗 legacy：内容 y=36%、时间 y=62%；休息弹窗 legacy 同主/时间间距，倒计时约 y=78%；图层栈以主题字段为准）。
- **休息弹窗 tick 动画**：使用独立 CSS `scale` 属性（非 `transform`），避免覆盖定位 transform。Electron 28+ / Chromium 120+ 支持。

### 4.13 弹窗主题预览（ThemePreviewEditor / PopupThemeEditorPanel）

- **预览组件**：`ThemePreviewEditor.tsx`（Moveable + 预览区 + 可选双击内联编辑）。**完整参数区**：`PopupThemeEditorPanel.tsx`（预览 + 分页「全部/文字/遮罩/背景」+ 与设置页一致的表单；**「当前选中层 · 排版」**：随全局/左中右、字间距、行高，对应 `PopupTheme` 分层字段并由 **`reminderWindow.ts`** 输出 CSS）。**设置页主题工坊**与子项弹窗内联详细编辑共用该 Panel。
- **1:1 缩放映射**：预览区必须与实际全屏弹窗保持视觉一致。`previewViewportWidth` 取自主屏逻辑宽（如 `primaryDisplaySize.width`）；**`ThemePreviewEditor` 用 ResizeObserver 测量预览盒实际宽度**，`previewScale = min(1, 实测宽 / previewViewportWidth)`，再经 `toPreviewPx` 映射字号/字距/内边距。**禁止**用固定参考宽（如常数 920）代替实测宽，否则窄预览栏会出现文字过大、与全屏弹窗比例不一致。
- **图片预览**：渲染进程无法直接访问 `file://` 协议（Vite 开发服务器为 `http://`），须通过 IPC `resolvePreviewImageUrl` 让主进程读取本地图片并返回 `data:image/` base64 URL。缓存在 `previewImageUrlMap` 避免重复读取。
- **本机字体列表（SystemFontFamilyPicker）**：列表用 `createPortal(document.body)` 渲染时，**z-index 必须高于当前全屏编辑容器**（ThemeStudio / 子项弹窗可达 20万+）；否则会出现“已拉到字体但下拉看起来为空”。建议使用明确常量并留出安全余量。
- **Windows 字体枚举编码**：主进程通过 PowerShell 枚举字体名时，输出链路可能污染 Unicode。建议脚本端输出 **Base64(UTF-16LE)**，Node 端再解码，保证中文及多语种字体名稳定显示。
- **预览不显示关闭按钮**：预览区是只读展示，关闭按钮无实际意义，不渲染。
- **参数分页**：每张主题卡有独立的分页状态（全部/文字/遮罩/背景），存储在 `themeSettingsPanelFilterMap: Record<themeId, FilterType>` 中，切换一张不影响其他。
- **可视化编辑**：`react-moveable` 提供拖拽 / 旋转 / 缩放 / 对齐参考线。拖拽时直接操作 DOM（`target.style.left/top`）保证 60fps，松手后 commit 百分比到 React state。
- **对齐参考线**：容器 25%/50%/75% 水平 + 垂直线，加元素间相互对齐（`elementGuidelines`）。
- **选中联动**：`themeSelectedElementMap: Record<themeId, TextElementKey | null>` 存储每张主题卡的选中元素；预览区点击选中 / 空白取消；参数面板「位置与变换」区同步高亮与数值编辑。
- **主文案 content 栏宽（`TextTransform` + ThemePreviewEditor）**：仅 **content** 适用「≤ 画布约 **60%** 时横向贴字、超出则锁 **60%** 换行」的自动栏宽；**`contentTextBoxUserSized`** 为 true 时（预览四边拉框或面板填宽高）宽度不再随字数自动变，可拉至约 **96%**；**失焦**在**当前宽度**下只自动增高（`textBoxHeightPct`）。**`textBoxWidthPct` 上限 96%**（normalize / 弹窗 / 预览一致）。
- **时间 / 倒计时「短层」**：**`shortLayerTextBoxLockWidth`**（`shared/settings.ts` / `main/settings.ts` normalize）。**未锁定**：`width: max-content`，**`textBoxWidthPct` 仅作 `max-width` 上限**（Moveable 外框贴「12:00」等单行）；**预览四边拉框** `finalizeResize` 后置 **`shortLayerTextBoxLockWidth: true`** 恢复百分比**定宽条**。**`reminderWindow.textBoxLayoutCss`** 与 **`ThemePreviewEditor`** 样式须同步。固定 **`height: %`** 时 **time/countdown 用 `overflow: hidden`**，**content** 仍 **`overflow: auto`**（避免 Windows/Chromium 在 **nowrap** 下单行误出纵向滚动条）。
- **`effectiveEditableKeys` 稳定化**：**不要**把父组件**内联**的 **`onLiveTextCommit` 函数引用**放进 `useMemo` 依赖（子项每秒因时钟重渲染 → 新引用 → `liveSnap` 等 effect 误触发抖动）。用 **`Boolean(onLiveTextCommit)`** + 显式 **`editableTextKeys` 签名串**（排序 `join`）；默认 **`['content']` / 全层** 数组用**模块级常量**，避免每帧 `new []`。
- **单选四角等比缩放锚点**：拖某角则锁定**对角**在预览容器内的像素位置（Moveable **`direction`** → **`fixedCornerFromScaleDirection`**，每帧修正 `translate`）；**`scaleDirectionForPinRef`** 供 Ctrl 切换中心后再松键时恢复对角语义；**Ctrl** 仍锁定 **元素 AABB 中心**（与形心一致）。**旋转后**「对角」须按 **物体本地四角** 计算：**`getRotatedLocalCornerInContainer`**（`offsetWidth/Height`×`scale` + `rotate` 映射到容器坐标）；**禁止**仅用 **`getBoundingClientRect` 的轴对齐外接矩形四角** 当固定点，否则锚点会像贴在全局外框上。
- **日期绑定层与短行裁切**：时间/日期层 `textBoxWidthPct` 在未锁宽时常作 **`max-width` 上限**；改 **格式、locale、字体、斜体** 后须触发 **`snapShortLayerTightContent`** 与 **`Moveable.updateRect`**（`dateTimeIntrinsicSig`、`contentLayoutSnapSig` 等）；面板改日期时 **勿** 仅当「当前选中日期层」才 snap（否则未选中会裁切）。**ISO 风格**预设 locale 为 **`en-CA`**（`shared/popupThemeDateFormat.ts`），**勿用 `sv-SE`**，否则勾选「星期」会出现瑞典语星期名。
- **contentEditable 与 flex 列布局**：主文案 / 倒计时 / 装饰文本在 **非编辑态** 可用 **`display:flex` + `flex-direction:column`** 做垂直对齐；**进入编辑态** 须改为 **`display:block`**（或外层 flex、内层单独可编辑块），否则 Chromium 在可编辑区内插入的 **div/br** 会变成 **flex 子项纵向堆叠**，出现「未换行却空行」、**`scrollHeight` 虚高**、Moveable 外框忽高忽低。输入时写回 **`textBox*Pct`** 可 **短防抖**（如 `TEXT_EDIT_LAYOUT_DEBOUNCE_MS`），**`blur` 时清定时器并做一次 snap**；卸载时清理定时器。
- **主题色与拾色器性能**：统一用 **`PopupThemeColorSwatch`**（默认 **`h-9`/`w-12`**，与输入框同高）；拾色器连续 `input` 时通过 **`PopupThemeEditUpdateMeta.skipHistory`**（`usePopupThemeEditHistory`）避免每帧 **`structuredClone(整主题)`** 压撤销栈，并在色块内用 **rAF 合并**；**`mergedWrappedOnUpdateTheme` / `ThemePreviewEditor` 的 `onUpdateTheme`** 第三参 **`meta?`** 可选、须向下透传。

### 4.14 进度沉淀规范（强制执行）

- **每完成一个功能点，必须更新进度文档**：至少同步 `docs/SESSION_HANDOVER.md` 的“本轮改动/决策/下一步”。
- **复杂功能须有专项方案文档**：如弹窗主题，使用单独文档（如 `docs/POPUP_THEME_PLAN.md`）维护范围、状态、决策和待办。
- **新会话可恢复**：交接提示需包含“当前版本号/commit、已完成、进行中、下一步第一条动作”，确保开新对话可无缝继续。

### 4.15 弹窗主题 · 图层/对象管理（v1 规格，待实现）

> 详细范围、顺序规则与扩展位见 **`docs/POPUP_THEME_PLAN.md`**（「图层对象管理 V1」）。实现时需同步改 **`shared/settings.ts` + `main/settings.ts` normalize**、**`reminderWindow.ts` 按序输出 HTML**、**`ThemePreviewEditor` / `PopupThemeEditorPanel` / `ThemeStudioFloatingEditor`**。

- **对象列表（图层栏）**：置于参数区上方（或约定位置）；可 **显示/隐藏**、**折叠**；支持 **调整顺序**，顺序即全屏弹窗内 **z-index / 绘制顺序**（预览与主进程一致）。
- **绑定层（系统层，永存）**：**主提醒文案**、**时间** — **不可删除**；可 **显示/隐藏**，状态 **持久化并影响真实弹窗**。内容仍由提醒逻辑注入（非装饰文案池）。**休息弹窗剩余时长**用主题 **`countdownTransform` / `countdownFontSize` 等** 排版，**不**作为 `layers` 数组里的独立图层类型；主进程与预览在 **已排序图层之后** 叠加绘制，避免与装饰层混排进栈。
- **补充文本层**：仅用于排版装饰，与绑定层无关；首期最多 **5** 个，可增删（在上限内）。
- **图片层**：首期最多 **5** 个（如 PNG 表情）；路径/资源与现有图片背景、IPC 预览策略对齐。
- **遮罩 / 背景**：各 **最多 1** 个；纳入同一套图层模型，与旧「遮罩/背景」分页能力合并到「选中对象 → 属性面板」。
- **隐藏语义**：隐藏 = **不参与绘制**（非半透明挖洞）；**全部层均隐藏**（含绑定层）时，真实弹窗 **兜底为纯黑背景**（`#000`）。
- **首期不做**：编辑界面各面板 **自由拖拽 Docking**；仅图层栏显隐 + 折叠 + 排序。
- **主题工坊 vs 子项编辑**：**「+ 创建壁纸」** 在浮动编辑内用 **休息壁纸（蓝）/ 结束壁纸（绿）**（顶栏左→右）切换 `target`；从闹钟/倒计时 **「编辑主题」** 进入时 **锁定用途**，不可在弹窗内切换类型（见已实现 `ThemeStudioFloatingSource`）。
- **休息段最后几秒倒计时**：与休息主题 **硬切**，固定黑底大字倒计时（**不**走主题壁纸/遮罩/可编辑层）；见 `reminderWindow.buildRestEndCountdownHtml`。

### 4.16 ThemeStudio 浮动编辑 · 重构注意

- 重命名或删除 **`ThemeStudioFloatingEditor`** 内用于 JSX 的变量（如曾用 **`bannerMain`**）时，须 **全文搜索** 该标识符，避免 **HMR 半更新** 或漏改导致 **`ReferenceError: xxx is not defined`**。若需兼容「派生状态」，保留 **`const xxx = selectedTarget === 'main'`** 等与 **`selectedTarget`/`draft`** 同步的一行定义。

---

## 5. 与 Agent 协作时的注意点

- **先看 AGENTS.md**：实现功能前先对齐本文档中的“要做/不做”和目录结构。
- **MVP 优先**：第一版不实现统计、协作、手机端、AI、日历集成。
- **结构扩展**：新增功能时，组件进 `components/`，页面进 `pages/`，状态/逻辑进 `stores/`、`hooks/`、`utils/`，保持结构清晰。
- **命名**：产品对外名称 **喵息 / MeowBreak**；`package.json` 的 `name`、`app.setName('workbreak')`、`appId` 等为路径与用户数据兼容可继续沿用 `workbreak`。

---

确认目录与 AGENTS.md 无误后，即可按上述约定开始实现吃饭提醒、活动提醒、休息提醒、托盘与设置界面等 MVP 功能。
