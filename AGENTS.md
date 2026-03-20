# WorkBreak — Agent 开发指引

本文档为 AI Agent 与开发者提供产品背景、技术约定和实现边界，便于从零协作开发 WorkBreak 桌面应用。

---

## 1. 产品概览

### 1.1 名称与描述

- **产品名称**：WorkBreak（工作代号，后续可改）
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
│           ├── components/   # 通用 UI（如 AddSubReminderModal、SegmentProgressBars）
│           ├── stores/       # 状态（后续添加）
│           ├── hooks/        # 自定义 Hooks（后续添加）
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

- **设置**：开发环境（有 `VITE_DEV_SERVER_URL`）写入项目根目录 `workbreak-settings.json`，便于排查；生产环境写入 `app.getPath('userData')/settings.json`。主进程启动时 `app.setName('workbreak')` 保证 userData 路径一致。
- **保存设置**：仅将当前配置写入磁盘（`setSettings`），**不**调用 `restartReminders()`、**不**清除闹钟（fixed）override，因此不会重置任何提醒的起始点或进度。
- **全部重置**：设置页提供「全部重置」按钮，调用主进程 `resetAllReminderProgress()`，将所有**闹钟**子项设为“从当前时刻开始”、所有**倒计时**子项从当前时刻重新排程；使用当前已保存的配置（`getSettings()`）。
- 提醒计划、定时器均在主进程 `reminders.ts`，以主进程为“单一事实来源”；应用启动时由 `startReminders()` 排程。
- **normalizeCategories 保全字段**：`main/settings.ts` 的 `normalizeCategories` 负责反序列化校验；为 `SubReminder` 的每种 mode 分支构造对象时，**必须保留该 mode 的全部字段**（如秒表的 `content`、闹钟的 `weekdaysEnabled`）。否则 auto-save → hydrate 后新加的字段会丢失。

### 4.5 闹钟（mode: fixed）「重置」与起始时间

- **重置**：用户对某条**闹钟**子项点击「重置」时，主进程 `setFixedTimeCountdownOverride(key, item.time)` 会记录该时刻为周期起点（`fixedTimeCycleStartAt.set(key, Date.now())`），并在后续每次 `getReminderCountdowns()` 中返回该**时间戳**作为 `cycleStartAt`（不可用“当前时间”覆盖，否则起始时间会跟着时钟变）。
- **起始时间显示**：列表视图进度条左侧「起始时间」= 该周期的真实起点：有 `cycleStartAt` 时用其格式化为 HH:mm，否则用设定时间 `cd.time`（如 20:00）。不要用 `Date.now()` 作为闹钟子项的起始时间标签。
- **保存后**：保存设置**不**清除 override；仅「全部重置」会按需更新。若需“保存后恢复为按上次设定时间”的语义，再考虑在保存时调用 `clearFixedTimeCountdownOverrides()`（当前未采用）。
- **单次闹钟启动/重置**：`setFixedTimeCountdownOverride` 必须同时清理 `fixedSingleShotState`（否则会持续 `ended=true`）、并清理 fixed 拆分休息相关定时器与去重状态（避免新周期沿用旧周期痕迹）。
- **fixed 拆分休息调度**：休息弹窗与休息结束倒计时采用**绝对时间 setTimeout 预调度**，不依赖“整分钟轮询命中窗口”；并在应用启动与 fixed 启动/重置后立即补一次调度检查，避免秒级分段漏弹窗。
- **单次结束态冻结**：`weekdaysEnabled` 全 false（永不）且已结束时，分段条应保持灰态静止，不再随 `Date.now()` 变化；如需降噪显示，可仅保留休息段标签，隐藏工作段标签。

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

### 4.11 弹窗主题（壁纸）规划约定

- **架构分层**：采用“双层架构”——**系统设置**承载完整主题编辑（背景/遮罩/文字/排版/预设/批量应用），**新建/编辑子项弹窗**仅提供轻量入口（选择主题 + 小预览 + 跳转主题工坊）。
- **数据模型**：主题应作为独立实体管理（建议 `popupThemes`），子项仅绑定主题 id（如 `mainPopupThemeId`、`restPopupThemeId`）；避免将完整样式字段冗余写入每条子项。
- **目标区分**：主弹窗与休息弹窗主题分开管理；休息弹窗入口仅在拆分 `splitCount > 1` 时显示。
- **会员预留**：主题能力须预留 free/pro 门控（如渐变遮罩、文件夹壁纸、文字高级排版），先设计能力开关再逐步接入商业化。

### 4.12 进度沉淀规范（强制执行）

- **每完成一个功能点，必须更新进度文档**：至少同步 `docs/SESSION_HANDOVER.md` 的“本轮改动/决策/下一步”。
- **复杂功能须有专项方案文档**：如弹窗主题，使用单独文档（如 `docs/POPUP_THEME_PLAN.md`）维护范围、状态、决策和待办。
- **新会话可恢复**：交接提示需包含“当前版本号/commit、已完成、进行中、下一步第一条动作”，确保开新对话可无缝继续。

---

## 5. 与 Agent 协作时的注意点

- **先看 AGENTS.md**：实现功能前先对齐本文档中的“要做/不做”和目录结构。
- **MVP 优先**：第一版不实现统计、协作、手机端、AI、日历集成。
- **结构扩展**：新增功能时，组件进 `components/`，页面进 `pages/`，状态/逻辑进 `stores/`、`hooks/`、`utils/`，保持结构清晰。
- **命名**：产品对外名称保持 WorkBreak，代码与资源命名可沿用 `workbreak`/`WorkBreak`，与现有 `package.json` 一致。

---

确认目录与 AGENTS.md 无误后，即可按上述约定开始实现吃饭提醒、活动提醒、休息提醒、托盘与设置界面等 MVP 功能。
