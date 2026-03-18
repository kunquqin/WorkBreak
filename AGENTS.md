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

1. **可配置提醒**：用户可新增任意提醒类型（如吃饭、活动、休息、护眼、喝水），每类型下可添加多个子提醒；子提醒支持固定时间（如 12:00）或间隔触发（如每 45 分钟）。
2. **系统托盘**：后台静默运行，托盘图标与基础菜单。
3. **设置界面**：可增删改提醒类型与子提醒、管理预设、持久化到本地。

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
│           ├── components/   # 通用 UI 组件（后续添加）
│           ├── stores/       # 状态（后续添加）
│           ├── hooks/        # 自定义 Hooks（后续添加）
│           └── utils/        # 工具函数（后续添加）
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
- 提醒计划、定时器均在主进程 `reminders.ts`，以主进程为“单一事实来源”；设置变更后调用 `restartReminders()` 重新排程。

### 4.5 单实例与启动

- 使用 `app.requestSingleInstanceLock()` 保证只运行一个实例，避免重复点 bat 或 HMR 重建时多开窗口；二次启动时聚焦已有窗口。
- 开发启动：项目根目录双击 `启动开发环境.bat` 或终端执行 `npm run dev`。

### 4.6 设置页拖拽与排序

- **统一用 framer-motion Reorder**：大类列表与子项列表均使用 `Reorder.Group` + `Reorder.Item` + `useDragControls`（手柄拖拽），不再使用 HTML5 拖拽 API 做排序。
- **大类**：主列表为 `Reorder.Group`，每项为 `CategoryCard`（内为 `Reorder.Item`）；`onReorder` 调用 `setCategories`，同时 `setPresetModal(null)`、`setPresetDropdown(null)` 避免重排后索引错位。
- **子项**：每个大类内容区内为 `Reorder.Group`，每行为 `SubReminderRow`（`Reorder.Item`）；子项拖拽约束用 `dragConstraintsRef` 指向该大类列表容器。
- **拖拽时始终在最上层**：子项拖拽时会被下方大类盖住（层叠上下文），因此由父级提升整卡 z-index。`CategoryCard` 用状态 `isChildDragging`，在子项 `onDragStart`/`onDragEnd` 时置 true/false，根 `Reorder.Item` 的 `style.zIndex` 在 `isChildDragging` 时为 1000；大类/子项 `whileDrag` 的 `zIndex` 分别为 1000、9999。

---

## 5. 与 Agent 协作时的注意点

- **先看 AGENTS.md**：实现功能前先对齐本文档中的“要做/不做”和目录结构。
- **MVP 优先**：第一版不实现统计、协作、手机端、AI、日历集成。
- **结构扩展**：新增功能时，组件进 `components/`，页面进 `pages/`，状态/逻辑进 `stores/`、`hooks/`、`utils/`，保持结构清晰。
- **命名**：产品对外名称保持 WorkBreak，代码与资源命名可沿用 `workbreak`/`WorkBreak`，与现有 `package.json` 一致。

---

确认目录与 AGENTS.md 无误后，即可按上述约定开始实现吃饭提醒、活动提醒、休息提醒、托盘与设置界面等 MVP 功能。
