# 会话交接（**当前包版本 `0.0.17`** · 延续 v0.0.10u 主题/图层大改）

> 下一段「粘贴用交接提示」见文末代码块。

## 0.1 文字参数区布局重构（本轮）

- **主题工坊浮动编辑**：第二行仅主题名 + 居中「恢复默认/设为桌面壁纸」+ 右侧取消/保存等；**预览比例** 在 **ThemePreviewEditor** 顶栏 **行内居中**（`toolbarCenter`），全屏预览仍 **最右侧**（`toolbarTrailing`）。

- **主题工坊缩略图性能（本次）**：`ThemePreviewEditor` **`readOnly`** 时不注册 `datePreviewTick`；桌面缩略图时间/日期锚定 `DESKTOP_THUMBNAIL_CLOCK_FROZEN_AT`（本地 2020-06-15 12:00），与编辑态相同 locale 格式化；`readOnly` 下文件夹背景不挂 `FolderBgCrossfade`，只用首张图。`npm run build` 已通过。

- **主题工坊列表切换（本次）**：`IntersectionObserver` 懒挂载缩略图；`themeStudioListMounted` 双 rAF 延后 **`ThemeStudioListView`**。顶栏抽 **`SettingsReminderTabRow` + `React.memo`**（仅随 `categoryListFilter` / `themeStudioOpen` 变），**`flushSync`** 提交关工作室 / 开列表；分页按钮去掉 **`transition-colors`** 免「半选中」错觉。缩略图：**呼吸层叠在预览之上**，与内容 **同步 1s `opacity` 交叉淡化**（避免卸呼吸闪露浅灰）；呼吸加 **brightness** + 更高洗净。`npm run build` 已通过。

- **主题工坊拖拽缩略图（本次）**：**`DragOverlay`** 内 **`ThemeStudioThumbnail`** 增加 **`skipRevealSequence`**：不跑呼吸/渐显与重复 `Image` 预加载（列表已解码）；浮层去掉双 rAF 弹出缩放，改为 **静态 `scale-[1.08]`**，减轻起拖卡顿。`npm run build` 已通过。

- **弹窗主题 · 字间距/行高上限（本次）**：原 **-2～20 px** / **0.8～3** 对全屏大字壁纸偏紧；抽 **`shared/popupThemeTypographyClamp.ts`**（**-10～200 px**、**0.5～8**），`PopupThemeEditorPanel` 滑杆与 **`main/settings` normalize、`popupThemeLayers` 图层解码** 共用，避免 UI 拉满被落盘裁回。`npm run build` 已通过。

- **子项壁纸下拉 · hover 缩略图（本次）**：新增 **`PopupThemeSelectWithHoverPreview`**（自定义列表 + `document.body` 浮层 + **`ThemeStudioThumbnail` `skipRevealSequence`**），替换 **`AddSubReminderModal`** 与子项行内 **休息/结束壁纸** 原生 `<select>`；浮层在指针右下侧并钳制视口。`ThemeStudioThumbnail` 改为 **export**。`npm run build` 已通过。

- **休息弹窗时间层：本段剩余 mm:ss 走表 + 与黑底 5→0 衔接（本次）**：`reminders.showReminder` 对休息主题传入 `restPhaseEndAtMs`；`reminderWindow` 注入 `#wb-rest-remain` 与按整秒排程脚本（与动态桌面时钟同款 tick），显示 `floor((结束时刻-now)/1000)` 格式化为 mm:ss；固定时间拆分休息与间隔倒计时均传入段末时间戳。预览/默认占位：`REST_POPUP_PREVIEW_TIME_TEXT = '00:30'`（`defaultRestTheme`、新建休息壁纸、`mergeSystemBuiltinPopupThemes` 补丁系统休息 id、`ThemePreviewEditor` / 子项休息预览 / 全屏预览 IPC）；结束壁纸仍 HH:mm。`npm run build` 已通过。

- **全屏无框窗去圆角 + 预览直角（本次）**：Windows 11 下 Electron 无框窗默认 `roundedCorners` 会在铺满屏时四角露系统桌面。已为 **动态桌面 `desktopWallpaperPlayer`**、**静态壁纸导出隐藏窗 `desktopWallpaper`**、**提醒全屏窗 `reminderWindow.ensurePopupWindow`** 设 **`roundedCorners: false`**。**`ThemePreviewEditor`** 预览盒 Tailwind 由 **`rounded` 改为 `rounded-none`**，与真全屏观感一致。`npm run build` 已通过。

- **Win32 左上角微缝续修（本次）**：`buildRestEndCountdownHtml` 的 `html, body` 补 **`border-radius:0`**；**`desktopWallpaperPlayer`** 多屏窗与 **`desktopWallpaper`** 静态导出隐藏窗在 **Windows** 对齐 **`thickFrame:false` + `hasShadow:false`**（与 `reminderWindow.win32FramelessEdgeToEdgeOpts` 一致），并补 **`backgroundColor:'#000000'`、`transparent:false`、`focusable:false`** 等，减轻 DWM 角部露底；`reminderWindow` 改用 **`BrowserWindowConstructorOptions` 类型导入**。`npm run build` 已通过。

- **主题背景图：变换 + 样式效果分区（本次）**：`PopupTheme.backgroundImageTransform`（复用 `TextTransform` 形状；x/y 为 `background-position` 百分比，旋转/缩放为整层 `transform`）。参数区在「文件路径」与「模糊」之间增加 **变换**（滑杆+数字，同文字变换）、**样式效果** 小标题 + `PanelDivider` 分隔；预览 `ThemePreviewEditor` 与 `reminderWindow` 单图/文件夹轮播/legacy 无模糊层一致应用。
- **背景图 X/Y 改为平移 %（续）**：原 `background-position` 在 cover 下几乎看不出位移；现改为 `background-position:center` + `translate(tx%,ty%)`，水平/垂直滑杆 -50～50（相对画幅宽高，0=居中）。新增 `backgroundImageXYKind: 'translateCenter'`；旧数据无该字段时仍按 0–100 锚点折合平移。

- **闹钟子项时间滚轮：单击居中数字支持键盘输入（本次）**：`TimePickerModal` 的 `WheelColumn` 在点击**当前_viewport 居中**那一行时进入输入层（遮罩阻断底层滚动）；输入数字实时对齐滚轮与 `onLiveChange`；失焦、点遮罩空白、Enter 用 `pickValue` 确认写回 `onChange`；Esc 回滚到进入编辑前的值并避免 blur 二次提交。

- **子项编辑：休息/结束壁纸保存后回显成系统默认（修复）**：`AddSubReminderModal` 中校验「主题 id 是否在列表中」的 effect 与 hydrate 同帧执行时，读到仍为初始值 `''` 的 state，误判为无效并把 id 改成系统默认，确认写入后子项落盘即为默认。**修复**：仅当对应 target 的选项列表非空**且**当前 id 非空时才做「不在列表则回退默认」；空 id 交由 hydrate 写入，避免覆盖。

- **动态桌面 WorkerW 性能 + 图标层回归修复（本次）**：仍用 **`userData/wb-desk-wallpaper-v1.dll`** 缓存 `WbDesk`。**Attach** 阶段恢复 **120ms + 280ms** sleep（过短易枚举错 WorkerW → 图标被挡）；首次附着失败则 **450ms 后重试一次**。附着成功后 **`resize`/`move` 550ms 防抖** Sync（避免 Chromium 显示后错位；比旧版短防抖少起 PowerShell），并保留 **400ms + 1200ms** 两次定时补同步 + **`display-metrics-changed`**。`npm run build` 已通过。
- **桌面壁纸预览：时间/日期默认（本次）**：新建桌面主题用统一常量 **`DESKTOP_DEFAULT_TIME_DATE_TRANSFORMS`**（`shared/popupThemeLayers.ts`）：时间 **X50 Y46** 字号 **120**、日期 **X50 Y55** 字号 **45**（旋转 0、缩放 1）；**`buildNewDesktopThemePatch`** 落盘；**`ThemePreviewEditor`** / **`PopupThemeEditorPanel`** / **`reminderWindow`** 在 **`target==='desktop'`** 时对缺省变换与字号一致回退。`npm run build` 已通过。
- **主题工坊 · 桌面壁纸类型（本次）**：`PopupThemeTarget` 增加 **`desktop`**（`shared/settings.ts` + `main/settings.ts` normalize 三值，避免落盘被压成 `main`）。主题工坊列表筛选 **桌面壁纸**（浅紫 chip / 卡片底条），浮动编辑顶栏在 **工坊入口** 增加第三 Tab **桌面壁纸**（子项入口仍仅休息/结束）。**「+ 创建壁纸」** 按当前筛选创建对应 `target`（筛选「全部」时默认 **结束**）。**「设为桌面壁纸」** 在 `draft.target === 'desktop'` 时显示于「取消」右侧，**IPC `applyDesktopWallpaper`** 传当前草稿 JSON；**`main/desktopWallpaper.ts`**：文件夹背景导出 **固定首张**；隐藏 **`BrowserWindow`** 铺满 **主显示器 `bounds`**，`buildReminderHtml` + 失败回 **`buildReminderHtmlLegacy`**，`capturePage` → **`userData/wallpaper-export/desktop-wallpaper-*.png`**；**仅 Windows** 用 PowerShell 调 **`SystemParametersInfo`（SPI_SETDESKWALLPAPER）** 设壁纸，非 Windows 返回明确错误文案。`reminderWindow` 导出 **`buildReminderHtml` / `buildReminderHtmlLegacy` / `getPopupTempDir` / `writePopupHtmlToTempFile`** 供导出复用。`ThemePreviewEditor` / `PopupThemeEditorPanel` / `popupThemeLayers` 对 **desktop** 与 **rest** 对齐倒计时层与恢复绑定文案语义。`npm run build` 已通过。

- **主题工坊列表（本次）**：缩略图卡片底部 **休息→浅蓝底/字**、**结束→浅绿底/字**、**桌面→浅紫底/字**，与顶栏语义一致；**主题名 `font-bold`**；筛选 chip **顺序**为 全部 → 休息 → 结束 → 桌面，且选中态 **蓝/绿/紫** 高亮。`getDefaultPopupThemes` / `mergeSystemBuiltinPopupThemes` 默认 **休息系统主题在前、结束在后**（无强制系统桌面主题）。列表支持 **@dnd-kit `rectSortingStrategy` 拖拽排序**（左侧六点手柄，`onReorderThemes` 写回 `popupThemes`）。`npm run build` 已通过。
- **主题工坊列表 · 重命名与拖拽预览（本次续）**：**重命名**为 **卡片标题行内联 `input`**（菜单「重命名」后原位编辑，**Enter** 保存、**Esc** 取消、**失焦**保存；**trim 为空**则取消不写库）；**`truncate`** 单行溢出省略。设置页 **`onCommitThemeName`** → **`updatePopupTheme(id, { name })`**，已移除独立重命名弹窗。列表卡 **hover 仍不整体缩放**；**拖拽浮层**保留 **双 `requestAnimationFrame` 后 `scale-[1.08]` + 阴影** 与 **`h-full min-h-0`** 布局。**更多操作 ···** 在 **标题行右侧**；**悬停缩略图或标题行** 显示，**离开缩略图+标题区** 隐藏（**菜单打开 / 正在重命名** 时保持）；**悬停三点**打开菜单，定位 **`r.bottom + 1`**。`npm run build` 已通过。
- **预览区拖拽吸附（本次）**：`previewSnapGuidelines` 改为依赖 **`previewContainerWidth/Height` 状态**（`ResizeObserver` + `useLayoutEffect` 同步高），不再在 `useMemo` 内读 `containerRef`（首帧常为 null → 吸附线为空、贴边无磁力）。`Moveable` 补 **`snapHorizontalThreshold` / `snapVerticalThreshold`（14）`**：`react-moveable` 0.56 以二者为准，单独设 `snapThreshold` 已弃用且默认仅 5px 不易感知。
- **主弹窗兜底文案与默认层间距（本次）**：`BUILTIN_MAIN_POPUP_FALLBACK_BODY` / `RESTORE_BINDING_BODY_MAIN` 与预设池「提醒内容」条目改为 **「时间到啦」**；系统默认结束/休息主题、新建用户主题、`ThemePreviewEditor` / 面板「变换」默认、legacy `transformStyle` 回退、装饰默认 y：**主文案 y 36%、时间 y 62%**（原 42/55），**休息倒计时 y 78%**（原 70），**日期 y 65%**（原 58）。`npm run build` 已通过。
- **装饰图片层：操作框贴图边 + 拖拽更顺（本次）**：`contain` 下 **`max-width`/`max-height` 仅写在 `<img>`**（theme 上限换 px 或 %），外层 `inline-block` **不再**设 max-height：避免父盒被 max-height 钳短而子图仍按宽度算出更高、上下溢出，Moveable 量高偏矮。`onLoad` **仅当宽高比偏差 >~1.2%** 时写回 **`textBox*Pct`**。`cover` 仍为定比 div + 满铺。拖拽 **rAF 不刷 state**、松手 **sync**；手势起止 **同步 `transformSyncLockedRef`**。`npm run build` 已通过。
- **横/竖排与直排数字（本次）**：产品约定 **竖排相关能力全免费**（不按会员门控）。`PopupTheme` / `TextThemeLayer` 增加 `writingMode`、`textOrientation`、`combineUprightDigits`；`popupVerticalText.ts` 统一内外层盒与短层 overflow；`reminderWindow` 与 `ThemePreviewEditor` 用内层 `data-wb-text-inner` 承载字距/行高，竖排外层 flex 对齐；`PopupThemeEditorPanel` 绑定层与装饰层「排版」增加排向（横 / 竖 rl / 竖 lr）、字符朝向、直排内数字合并及竖排说明；竖排内 `justify` 按居中。预览 **时间层默认行高**与主进程一致为 **`timeLineHeight ?? 1`**。`npm run build` 已通过。
- **排向 UI 两级（本次）**：面板「排版」中排向改为 **横排 | 竖排**；仅竖排时在**同一行右侧**出现 **列序：左 | 右**（`vertical-lr` / `vertical-rl`）；横排时收起列序。从横排点「竖排」默认写入 `vertical-rl`。`npm run build` 已通过。
- **竖排双击编辑外框压扁（本次）**：根因是编辑态仍用 **`height: textBoxHeightPct%`**，而该百分比在横排时常表示「一行」高度，竖排下列高应对字柱，沿用会导致极扁框 + 截断。主文案曾试 **`height:auto` + `min-height:min-content`**，但会阻碍换列；现主文案与装饰竖排编辑均改为 **确定列高 %**（见上/下条 `verticalEditColumnHeightPct` / `decoVerticalEditColHPct`）+ 内层 **`previewEdit` overflow**。只读仍用落盘 `bh%`。进入竖排编辑时 **`force` 重算** textBox（非 userSized），并用 ref 避免 callback/图层更新导致每帧重复。`npm run build` 已通过。
- **竖排假横向滚动条（本次）**：`writing-mode: vertical-*` 下内层 **`overflow:auto`** 易在块轴（物理水平）因亚像素/与 flex 子项最小尺寸交互误判溢出，出现**底部横向滚动条**。`popupVerticalText` 非 short 内层改为 **`overflow-x:hidden; overflow-y:auto`**，并补 **`min-width/min-height:0`**；真弹窗主文案外层 `textBoxLayoutCss` 在竖排时同步；预览主文案竖排内层 **`min-w-0`**。`npm run build` 已通过。
- **预览自动栏宽/栏高 80% + 横竖切换重算（本次）**：`ThemePreviewEditor` 引入 **`CONTENT_TEXT_AUTO_FIT_MAX_RATIO = 0.8`**：主文案与装饰文本**自动贴合**时宽、高默认不超过预览区 **80%**，超出在框内换行/换列并由内层 **overflow 滚动**；**手动拉框**仍可至 **96%**（`CONTENT_TEXT_BOX_CAP_RATIO`）。**横排 ↔ 竖排**切换时对主文案 **`force` 重算**并清除 `contentTextBoxUserSized`；装饰文本按图层 **`writingMode` 签名**在首帧之后 **`force` 重算**。装饰层补齐 **`applyDecoTextBoxAutoLayoutVertical`** / 竖排 **`snapDecoTextBoxHeightOnly`**。竖排失焦后 **`adjustBindingVerticalEdgeAnchor` / `adjustDecoVerticalEdgeAnchor`** 按列序固定左或右边缘，避免栏宽变化时整块相对列序漂移。`npm run build` 已通过。
- **竖排主文案编辑态外框与 80% 换列（本次）**：编辑态曾与横排共用外层 `height: auto`，父级高度不定，内层 `max-height: 100%` 无法约束列高，列会撑满预览区、文字溢出框；失焦后写回 `textBoxHeightPct` 又正常。已改为 **竖排且非短行绑定层** 外层始终用固定 `height: textBoxHeightPct%`（与只读一致）；尚无 `textBoxHeightPct` 时仅在编辑态加 `max-height: 80%` 画布高兜底。进入竖排内容编辑时 **`useLayoutEffect`** 立即跑一次 `applyContentTextBoxAutoLayout`，尽快写入 `bh`。`npm run build` 已通过。
- **装饰文本竖排编辑换列（本次续）**：与主文案对齐——竖排装饰 **编辑态** 外层用 **`decoVerticalEditColHPct`**（有 `textBoxHeightPct≥8` 时钳在 12–80%，否则整列 80%），内层 `verticalTextInnerDomStyle(..., 'previewEdit')`；**非编辑**竖排仍叠 `overflow: hidden`。避免编辑态 `height:auto` + 内层 `overflow:hidden` 挡块向换列。`npm run build` 已通过。
- **新建装饰文本 Moveable 底边「往下长」动画感（本次）**：`decoTextLayerWritingSig` 的 effect 曾对**每个**装饰层 `applyDecoTextBoxAutoLayout(..., { force: true })`，新建一条会连带旧层多次 `onUpdateTheme` + `ResizeObserver` 跟高，外框像被拉长。改为仅对签名中 **新建或 writingMode 变化** 的 id 做 force 贴盒；`Moveable` 关闭 **`useResizeObserver`**（仍由 `theme.layers` / 显式 `updateRect` 同步）；`index.css` 对 **`.moveable-control-box`** 设 **`transition: none`** 兜底。`npm run build` 已通过。
- **参数区优先编辑文字（方案 A，本次）**：`PopupThemeEditorPanel` 内 `ThemePreviewEditor` 启用 **`panelFirstTextEditing` + `onRequestPanelTextFocus`**：绑定主文案与装饰文本在预览中 **只读**（无画布 `contentEditable`）；**双击**对应层则展开参数区并 **聚焦右侧 textarea**（主文案 / 装饰各一）。主题工坊浮动编辑、子项内嵌小预览 **未改**，仍可走画布双击。`npm run build` 已通过。
- **竖排画布编辑列高过小 / 失焦框错乱（本次）**：横排多行切竖排后只读正常，双击画布编辑若仍沿用横排遗留的较小 `textBoxHeightPct`（如 12% 行高）作列高，列过矮会挤多块向、假横条与 `snap` 写回错乱。新增 **`VERTICAL_EDIT_COLUMN_MIN_HEIGHT_PCT`（28）**：非手动拉框时编辑态列高若合并后低于阈值则改用画布 **80%**；主文案与装饰一致。移除与 `verticalContentEditEntryRef` 重复的 `wasEditingContentVerticalRef` effect；进入竖排编辑的 **force 自动布局** 改为 **双 `requestAnimationFrame`** 后再跑（主文案 + 装饰），避免与编辑态外层样式同帧竞态。`npm run build` 已通过。
- **竖排块向宽度测量被外层窄条夹死（本次）**：竖排结构为「外层 `width:%` + 内层 `data-wb-text-inner`」。测量内层 `max-content`/`scrollWidth` 时外层仍为横排遗留的窄百分比，flex 子项无法横向长出多列，`scrollWidth` 偏小 → 编辑时 Moveable 不随列变宽、失焦写回 `textBoxWidthPct` 后呈长条截断。新增 **`pushVerticalMeasureUnconstrainOuter`**：测量瞬间将外层改为 `width:max-content` + `maxWidth` 像素上限（自动 80% / 手动拉框 96%），再恢复。**主文案** `applyContentTextBoxAutoLayoutVertical` / `snapContentTextBoxHeightOnly`、**装饰** `applyDecoTextBoxAutoLayoutVertical` / `snapDecoTextBoxHeightOnly` 均包裹测量段；并去掉竖排自动布局在「焦点在内层」时的整段跳过，使防抖输入能写回正确块向宽度。`npm run build` 已通过。
- **PopupThemeColorSwatch 受控 input 警告（本次）**：色块用 `value` 但仅用原生 `addEventListener('input')`，React 认为无 `onChange` 的受控字段，控制台警告且在新版下可能表现为只读、连带主题面板交互异常。已改为 **`onChange` + `onBlur` 走 React 事件**，内层仍保留首帧入撤销栈 + rAF 合并 + `skipHistory` 逻辑。`npm run build` 已通过。
- **预览区不再编辑休息倒计时层（本次）**：倒计时由运行时弹窗绘制，已从 `ThemePreviewEditor` 移除休息主题下的倒计时叠加层与 `textLayerPairs` 条目；`PopupThemeEditorPanel` 从 `selectedElements` 剔除残留的 `countdown`（**主/休息**均处理，避免仅选中 `countdown` 时图层栏无行匹配、高亮消失）。**Settings** 用稳定空数组 `EMPTY_THEME_TEXT_SELECTION` 替代未写入 map 时的每帧 `?? []`。**主文案 / 装饰文本编辑**：防抖写回 theme 时焦点仍在编辑区内则跳过写回等（见前文）。`npm run build` 已通过。
- **日期绑定层（本次）**：图层栏 **+ 日期** 添加唯一 `bindingDate` 层；`Intl.DateTimeFormat` 按主题字段输出年月日/星期（可关、可设格式与 BCP 47 locale）；预设「中文常用 / 英文 US / ISO / 仅星期」。预览支持 `previewDateText` 固定串 + 30s 刷新；真弹窗在生成 HTML 时用当前时刻（与静态时间层一致）。涉及 `popupThemeDateFormat.ts`、`reminderWindow` 图层分支、`ThemePreviewEditor` 的 `TextElementKey` 含 `date`、`PopupThemeEditorPanel` 日期区、主进程 `normalize` 补全日期字段。
- **「ISO 风格」出现瑞典语星期 + 日期裁切（本次）**：原 ISO 预设用 **`sv-SE`** 换 YYYY-MM-DD，用户勾选「星期」后星期名为瑞典语（**tisdag = 星期二**）。已改为 **`en-CA`**，星期为英文；面板「ISO 风格」按钮增加 `title` 说明。预览 **`snapShortLayerTightContent`**：① 面板改格式后**无论是否选中日期/时间层**都重算 textBox，避免裁切；② **斜体**层加宽度余量。已存主题若仍为 `sv-SE` 可再点一次 ISO 或改 Locale。
- **拾色器拖动卡顿（本次）**：根因是每次 `input` 都走 `wrappedOnUpdateTheme` → **`structuredClone(整主题)`** 压撤销栈。已增加 **`PopupThemeEditUpdateMeta.skipHistory`**；**`PopupThemeColorSwatch`** 用原生 `input` 监听：首帧正常入栈，拖动中 **`skipHistory` + `requestAnimationFrame` 合并**；`change`/`blur` 收尾刷新。`ThemeStudio` / `PopupThemeEditorPanel` / `ThemePreviewEditor` 类型已兼容第三参可选。
- **旋转后四角缩放锚点错位（本次）**：等比缩放时 `onScale` 用 **`getBoundingClientRect` 的 AABB 四角**当「固定对角」，旋转后 AABB 角≠物体真实角，表现为锚在全局外接矩形上。**修复**：**`getRotatedLocalCornerInContainer`** 用 **`offsetWidth/Height` × scale + rotate** 算真实四角相对容器坐标，再校正 `translate`。
- **编辑文字时「假换行」与 Moveable 高度乱跳（本次）**：**contentEditable** 与 **`display:flex; flex-direction:column`** 叠加时，浏览器插入的 **div/br** 会变成 **flex 子项纵向堆叠**，scrollHeight 虚高；每键 **`applyContentTextBoxAutoLayout` 写回 theme** 又触发重渲染，与旋转/缩放时的 **`updateRect`** 叠加更明显。**修复**：主文案/倒计时/装饰文本 **仅在编辑态** 改为 **`display:block`**；主文案与装饰文本 **`onInput` 对写回 textBox 防抖 ~90ms**（仍每帧 `updateRect`），**blur** 清定时器并照常 snap。
- **时间/日期/主文案改字体或格式后 Moveable 裁切（本次）**：短行层 `textBoxWidthPct` 作 `max-width` 上限时，若字符串变长或度量变宽未重算会裁切。已用 **`contentLayoutSnapSig`** 扩大主文案栏宽同步触发条件；**`dateTimeIntrinsicSig`** + 选中时 **`snapShortLayerTightContent` + `updateRect`**；并在 **`updateRect` 的 `useEffect` 依赖**中补 **`preview*Text`、日期显示/格式、`datePreviewTick`、`previewLabels`、`contentLayoutSnapSig`、`dateTimeIntrinsicSig`** 作双保险。`npm run build` 已通过。
- **浮动编辑顶栏 Tab 顺序（本次）**：**休息壁纸（蓝）** 在左、**结束壁纸（绿）** 在右（`ThemeStudio.tsx` 浮动弹窗 `tablist` 对调 JSX 顺序；`border-l` 分隔线在右侧「结束壁纸」上）。
- **Delete/Backspace 删除图层与图层栏一致（本次）**：`ThemePreviewEditor` 在 `keyboardScope` 内将 **Backspace/Delete** 统一为 **`removeThemeLayers`**（与 `PopupThemeLayersBar` × 同源），可删 **背景/遮罩/主文案绑定层/时间层/装饰文本/装饰图片**；框选多装饰层时一次删净；成功后清空相关选中态。**`popupThemeLayers.ts`** 新增 **`removeThemeLayers`**，单删仍走 **`removeThemeLayer`**。`PopupThemeEditorPanel` 不再单独拦截装饰层删除，避免与预览逻辑重复；**`ThemeStudioEditWorkspace`** 向左栏预览传入 **`selectedStructuralLayerId`** 以便删结构层。`npm run build` 已通过。

- **主题颜色控件 + 背景壁纸模糊（本次）**：新增 **`PopupThemeColorSwatch`**（**高度与面板内常规输入框一致 `h-9`**、默认 **`w-12`**，替代整行 `input[type=color]`）。`PopupThemeEditorPanel` 中 **遮罩纯色** 将 **颜色 + 透明度** 合并为一行（色块 + 滑杆 + 数值）；**渐变** 仅保留紧凑色块行；**文本颜色 / 背景纯色 / 描边与阴影** 等统一小色块，描边与阴影的 **颜色 + 不透明度** 与遮罩透明度同一布局（滑杆 + 72px 数字）。绑定层「颜色 / 时间颜色 / 日期颜色」、装饰文本颜色、**背景色** 改为 **标签与色块同一行 `items-center`**。主题新增 **`backgroundImageBlurPx`**（0–**`POPUP_BACKGROUND_IMAGE_BLUR_MAX_PX`**（100）），背景为 **图片** 时面板提供与透明度同款的 **模糊** 滑杆 + 数字；**`ThemePreviewEditor`** 与 **`reminderWindow`**（图层路径 + **legacy** 模板）对壁纸层使用 **overflow 裁切 + 放大内层 + `filter: blur`**，避免模糊露边。
- **文件夹壁纸轮播 + 交叠过渡（本次）**：原先 HTML 只嵌入**单张**静态图，无定时器故轮播不生效。现 **`folder` + ≥2 张**成功拷贝至弹窗临时目录时生成 **双层 + 内联脚本**：按 **`imageFolderIntervalSec`** 全不透明停留后，用 **`imageFolderCrossfadeSec`**（默认 **2s**，面板「交叠过渡」，normalize **0.5–`POPUP_FOLDER_CROSSFADE_MAX_SEC`**）交叉 **opacity** 切换；**legacy fallback** 传入 **`htmlDir`** 同样可轮播。预览非 **readOnly** 且 **≥2** 个已解析 URL 时 **`FolderBgCrossfade`** 对齐真弹窗节奏。

- **右侧文字编辑区重排（易用性）**：`PopupThemeEditorPanel` 的「文字」区从“分块切换 + 多段表单”改为更扁平结构：每层（文本/时间）仅保留一行字体控件，信息层次更清晰，操作路径更短。
- **字体来源融合到同一弹出列表**：`SystemFontFamilyPicker` 新增 `mode`/`presetOptions` 能力，弹出列表顶部可切换 **「预设组合」/「本机已安装」**；无需再在面板中来回切 tab。预设项与本机字体都在同一交互入口中完成选择。
- **字号改为「滑杆 + 数字输入」并排**：`PopupThemeEditorPanel` 中「文本字号/时间字号」改为左滑杆（快速微调）+ 右数字输入（精确输入）组合，满足快速调节与精细控制两类场景。
- **兼容性**：保留原有字段写入语义（preset 仍清 system，system 仍清 preset），`npm run build` 已通过。
- **进一步收敛（本次续调）**：字体区左侧标题文案调整为「字体 / 时间字体」；移除字体选择区外层边框卡片；去掉「重新扫描本机字体」按钮，改为进入面板后后台静默预热本机字体列表（切到本机模式仍可即时复用缓存）。
- **文字面板二次精简（本次）**：移除「文本内容」标签与同步提示文案；字号提前到颜色上方并改为「字号」；新增「样式」行（字重 + B/U/I）；「当前选中层 · 排版」改为「排版」并去掉蓝底框、层名提示与尾注；「位置与变换」去掉文字区域宽高与清除按钮及层名提示。另补充 `PopupTheme` 的 `content/time/countdown` 斜体与下划线字段，预览与真弹窗渲染链路已同步支持。
- **文字面板三次收口（本次）**：去掉文本框下方冗余「字体」分组标题，字体行左标签改为常规字重并与其余表单标签一致；字体选择行与字号/颜色等控件对齐同一左右边界。删除上方「文字对齐（全局默认）」重复项，仅保留下方排版对齐；「随全局」选项移除，对齐按钮改为图标三态（左/中/右）。「样式 · 描边与阴影」改为「效果」，并将「文字描边/文字阴影」简化为「描边/阴影」，缩小区块间距；「位置与变换」更名为「变换」，移除右上文本/时间手动切换。
- **字号行宽度修正（本次）**：字号控件从三列网格中抽离为独占整行布局（`60px 标签 + 1fr 滑杆 + 72px 输入框`），避免滑杆被压短；与上方文本输入框保持同一左右边界。
- **菜单撤销/重做打通（本次）**：主进程新增应用菜单 `Edit -> Undo/Redo`，分别下发 `menu-edit-undo` / `menu-edit-redo` 到渲染进程；`PopupThemeEditorPanel` 通过 preload 订阅并接入同一历史栈。快捷键统一为 `Ctrl+Z` 撤销、`Ctrl+Y` 重做（去掉 `Ctrl+Shift+Z`）。面板顶部“撤销/重做”按钮区已移除。
- **右侧参数区外层壳精简（本次）**：`文字`、`遮罩`、`背景`区块去掉外层白卡嵌套，仅保留标题和控件内容。
- **遮罩参数区 UI（本次）**：`启用遮罩` 去掉外层描边卡片；`遮罩颜色`/`遮罩透明度（0-1）` 改为 **颜色** / **透明度** 各占独立一行；透明度为 **左滑杆 + 右数字输入**（与字号行同网格 `60px + 1fr + 72px`），`step` 0.01，值仍钳制 0–1。
- **遮罩渐变（本次）**：主题新增 `overlayMode`（纯色/渐变）、`overlayGradientDirection`（8 方向）与 `overlayGradientStartOpacity/EndOpacity`（0–1）；`PopupThemeEditorPanel` 在遮罩区增加模式、方向、起终点透明度控件（均为滑杆+输入）；`ThemePreviewEditor` 与 `main/reminderWindow` 统一按同一方向映射渲染 `linear-gradient`，旧主题默认回落 `solid + overlayOpacity`。
- **遮罩方向「预设 + 自定义角度」联动（本次）**：新增 `overlayGradientAngleDeg` 与 `overlayGradientDirection: 'custom'`；遮罩方向支持预设下拉 + 表盘 + 角度输入三者同步。选预设会自动写入对应角度（如左→右=90°）；拖表盘/改角度时若命中预设角度自动回切预设，否则方向切到「自定义」，预览与真弹窗统一按角度渲染 `linear-gradient(<deg>, ...)`。
- **遮罩角度表盘交互修正（本次）**：将角度盘改为固定 `SVG` 真圆（`aspect-square`），避免容器压缩成椭圆；红色拖拽点改为圆周坐标定位（按角度计算 `cx/cy`），并抽出统一 pointer 坐标换算函数，解决拖动时指针偏离。
- **文本层编辑态统一（本次）**：`ThemePreviewEditor` 移除“装饰文本层进入编辑态时清空 Moveable 目标”的分支。现在绑定文案层（如“时间到！”）与新增文本层在双击编辑时都保留同一套 Moveable 操作组件，避免出现“只有蓝紫描边编辑框、无操作组件”的不一致（子项编辑弹窗同样生效）。
- **新增文本层与绑定文本层交互再统一（本次）**：修复装饰文本层缩放后字号不跟随（`finalizeScaleBakesFontSize` 对装饰文本改为“烘焙字号并将 transform.scale 归 1”，与绑定层一致）；双击进入编辑时把选择与 `setEditing*` 放入同一 `flushSync`，并立即设置 `moveableTargets`，减少操作组件出现延迟；去掉编辑态额外彩色 ring，仅保留 Moveable 轮廓，避免“粗色描边”观感。
- **装饰文本编辑范围/贴边能力补齐（本次）**：`ThemePreviewEditor` 的 `resizableForTextBounds` 扩展到装饰文本编辑态（不再只限 content/time/countdown）；`finalizeResize` 新增 `data-deco-layer-id` 分支，将拉框后的像素宽高回写到装饰文本 `transform.textBoxWidthPct/HeightPct`；装饰文本失焦后新增 `snapDecorationTextBoxTight`（未手动拉框时自动贴字收紧），使“新增文本”与默认绑定文案层在编辑范围与退出贴边上表现一致。
- **装饰文本编辑 + Moveable 把手（本次）**：根因是 `moveableChromePointerDownRef` 的捕获监听只在 `editingTextKey` 时注册，装饰文本编辑时点 resize 会先 blur 且 `relatedTarget` 常落在预览外的 Moveable 节点，原逻辑 `container.contains` 也拦掉了标记 → 误判退出编辑。现改为 `editingTextKey || editingDecoLayerId` 均注册，且命中 Moveable 控件即置位（不再要求点在预览容器内）；`isThemePreviewMoveableChrome` 补充 `.moveable-control`/`.moveable-line`。装饰文本层样式与绑定主文案一致：无 `textBox` 时用 `width:max-content` + `maxWidth:96%`，有 `textBox` 时用百分比宽高，避免操作框远大于文字；`moveableKey` 在装饰文本进入拉框模式时切 `box` 以稳定切换 resizable。
- **新增文本默认大框根因修复（本次）**：`shared/popupThemeLayers.ts` 的 `defaultFreeTextTransform` 之前默认写了 `textBoxWidthPct:40 / textBoxHeightPct:12`，导致新建文本天然是固定框，表现为“操作组件始终一样大、缩放/编辑后又像回到默认框”。现改为仅 `{ x:50, y:42, rotation:0, scale:1 }`（不预置 textBox），默认走贴字模式；仅在用户手动拉框后才持久化 `textBox*Pct`。
- **装饰文本与绑定文案几何一致性（本次）**：`ThemePreviewEditor` 中装饰文本渲染宽度语义改为与 `renderTextLayerForKey(content)` 完全一致（仅在存在 `textBoxWidthPct` 时定宽；否则仅 `maxWidth:96%`），消除“同字号下操作框边距不一致”。同时修复装饰文本 `onScaleEnd` 松手位移：改为与绑定层相同的“视觉包围盒中心 → x/y 百分比”回写，并按容器 offset 尺寸反推 `translate`（`scale` 归 1），避免松手后再次跳位。
- **装饰层缩放手松再跳位（本次根因）**：`recomputeDecoStyleTransformsFromTheme` 曾采用「仅填补尚未写入的 id」合并策略；`finalizeScaleBakesFontSize` 松手时先用旧 `offsetWidth` 写入 `decoStyleTransformById`，主题已更新字号后 DOM 变宽，但后续 recompute 无法覆盖该 id → 表现为一帧后文本相对框偏移。现改为与主文案一致：`{ ...prev, ...next }` 始终用当前测量尺寸从 theme x/y 回写 translate；拖拽/缩放中仍由 `transformSyncLockedRef` 短路，避免与 Moveable 冲突。
- **装饰文本栏宽 = 绑定主文案「时间到！」同套规则（本次）**：`ThemePreviewEditor` 用 `applyDecoTextBoxAutoLayout` / `snapDecoTextBoxHeightOnly` 复刻主文案的 **60% 内联锁宽 + 96% 上限**、编辑中 **`onInput` 实时更新栏宽/高**、失焦双 rAF 收紧；`finalizeResize` 装饰分支写入 **`contentTextBoxUserSized: true`**（与主文案拉框语义一致）。移除仅 96% 测量的旧 `snapDecorationTextBoxTight`。**`reminderWindow.renderLayerFragment`** 装饰文本 div 补 **`box-sizing:border-box` + `padding:3px`**，与绑定主文案层度量对齐。
- **面板调字号后 Moveable 外框不跟（修复）**：`ThemePreviewEditor` 同步 `updateRect` 的 effect 未依赖 **`theme.layers`**，装饰文本字号只写图层时根字段不变 → 不触发刷新。已加入 **`theme.layers`** 并用 **双 `requestAnimationFrame`** 再 `updateRect`，布局完成后再量。
- **图层栏文本行标签 PS 风格（本次）**：绑定主文案显示 **「主文本 · 内容预览」**，装饰文本 **「文本 · 内容预览」**；内容随编辑更新，**不换行**、过长由行内 **`truncate` + CSS 省略号**截断；主文案预览优先 **`previewContentText`** 与预览/根字段一致；悬停 **title** 显示完整单行预览；列表/行容器补 **`min-w-0`** 保证省略号生效。
- **装饰文本默认字号/落点 + 面板与主文案对齐 + 取消选中微偏移 + 主文案可恢复（本次）**：新建装饰文本默认 **字号 150**、**y:42%**；`TextThemeLayer` 增加 **`fontItalic` / `textUnderline`**，预览与真弹窗输出；装饰层 **效果区** 与主文案同为描边/阴影全参数；去掉预览层 **`willChange`** 随选中切换以减轻亚像素跳变；**`addBindingContentLayer`** + 图层栏 **「+ 主文本」**（无绑定主文案层时显示，按 `theme.target` 写入「时间到！」/「休息一下」并同步根字段，恢复后按钮隐藏）。
- **浮动编辑弹窗再精简（本次）**：移除顶部「选择该壁纸用于…」提示、移除预览区上方「预览态：仅…」说明；图层栏去掉底部「自上而下…」提示与右侧「隐藏栏」，仅保留图层标题小三角折叠。图层新增按钮在达到上限时改为**隐藏而非仅置灰**（删除后自动恢复显示）。右侧属性参数区新增独立折叠按钮（`属性 ▾/▸`）。
- **折叠语义修正（本次）**：图层区与属性区从“仅内容折叠”改为“面板级折叠”。图层折叠后外层面板不再保留固定高度空白（收缩为标题行），属性折叠后下半区不再占满剩余空间。仅在两区都展开时显示中间拖拽分隔条；`PopupThemeLayersBar` 增加 `collapsed/onCollapsedChange` 受控折叠接口供父层统一控制面板高度。
- **图层管理区视觉收口（本次）**：图层管理区外层去掉浅色背景与描边，改为白底无外边框，避免与下方卡片边框叠出“双层描边”。图层行选中态去掉 `ring` 风格，改为与闹钟子项一致的轻量样式（`border-slate-300 + bg-slate-50`）。
- **图层选中高亮与新建层层级（本次）**：图层行选中背景色进一步对齐子项卡片拖拽高亮（`bg-[rgb(241_245_249)]`）；新增文本/时间/图片层改为默认插入到图层数组末尾（预览与真弹窗的最高 z 顶层），不再默认落在背景上方、遮罩下方。
- **装饰文本层参数面板升级（本次）**：`PopupThemeEditorPanel` 中“新增文本层（装饰文本）”由旧简版改为完整参数区：文本内容、字体（预设/本机一体下拉）、字号（滑杆+输入）、颜色、样式（字重 + B）、排版（对齐图标、字间距、行高）、效果（描边/阴影开关）、变换（X/Y/旋转/缩放 + 重置）。并在装饰文本选中时隐藏通用「排版/变换」提示区，避免与上方装饰专用参数重复。
- **弹窗内容来源改为主题优先（本次）**：主进程 `reminderWindow.ts` 取消“提醒项正文注入到绑定文本层”的渲染行为。图层模式下，绑定文本层直接渲染其 `tl.text`；legacy 模式下正文优先取 `theme.previewContentText` / 绑定层 `text`，仅在缺失时回退到调用方 `body`。时间数字仍保持系统实时注入（`timeStr`），时间样式继续由主题控制。
- **子项文案语义去耦（本次）**：`AddSubReminderModal` 取消“切主题把示例文案回灌到子项 `content/restContent`”与对应同步 effect；小预览双击改字改为直接 `updatePopupTheme(..., { previewContentText })` 写入主题库。子项提交 payload 中 `content/restContent` 仅保留兼容兜底常量，不再承载主题文案来源；UI 提示同步改为“文本改动写入当前主题库”。
- **主题工坊打开崩溃修复（本次）**：修复 `ThemePreviewEditor` 在 `readOnly`（工坊列表缩略图）下触发的 `Maximum update depth exceeded`。根因是 `useLayoutEffect` 的只读分支每轮都调用 `setMoveableTargets`，在缩略图批量挂载时形成嵌套更新。现改为只读分支直接 `return`，不再维护 Moveable 目标状态；构建与 lint 已通过。
- **应用菜单恢复完整分组（本次）**：`main/index.ts` 的 `installAppMenu` 从仅 `Edit` 恢复为 `File / Edit / View / Window / Help`（macOS 额外 App 菜单）。保留自定义 `Undo(Ctrl/Cmd+Z)` 与 `Redo(Ctrl/Cmd+Y)` IPC 绑定，同时补回 `Cut/Copy/Paste/Select All`、刷新/开发者工具、窗口与关于项。
- **主题缩略图进入编辑再次崩溃（本次）**：修复 `ThemePreviewEditor` 中 `moveableRef.updateRect()` 导致的嵌套更新循环。将该同步从 `useLayoutEffect` 改为 `useEffect + requestAnimationFrame`，并增加 `moveableTargets.length` 保护；依赖中将 `selectedElements` 引用改为稳定签名 `selectedElementsSig`，避免数组引用抖动触发无穷更新。
- **主题工坊打开时报 TDZ（本次）**：修复 `ReferenceError: Cannot access 'moveableTargets' before initialization`。根因是上条修复把 `updateRect` 的 effect 放在 `moveableTargets` 声明之前，依赖数组提前访问变量触发运行时错误。现已将该 effect 下移到 `moveableTargets` 声明之后；构建与 lint 通过。

## 0. 图层删除 / 持久化 / 真弹窗字号（本轮修复）

- **本机字体列表加载不出/乱码（修复）**：① **`createRequire`** 多候选 **`package.json`** + 缓存 **`resolvedGetFonts`**。② **Electron 主进程下 `font-list` 仍常返回空**：其 Windows 实现经 **`child_process.exec` + `cmd`** 调 PowerShell，stdout 可能始终为空且无抛错。**修复**：**`win32` 优先**用 **`execFile(powershell.exe, ['-EncodedCommand', …])`** 直接跑与 **`font-list` 相同的 WPF 枚举脚本**（不经 cmd）；PowerShell 失败再回退 **`font-list`**。③ **渲染进程**：**`theme.id` 变化时 `setSystemFonts(null)`** 与异步 IPC 回写竞态，可出现 **控制台 count 正确但下拉恒空**；已移除该重置，并增加 **`sharedSystemFontFamilies` 模块缓存** + **`useState` 初始从缓存恢复**。④ **主题工坊 / 子项弹窗全屏层 `z-index` 约 20万～25万**，**`SystemFontFamilyPicker`** 的 **`createPortal` 列表曾用 `z-[10001]`**，列表实际画在遮罩**下面**，表现为「只有占位、展开也没字」；已改为 **`zIndex: 280000/280001`**。⑤ **中文乱码**：PowerShell 输出经宿主编码链路会污染 Unicode；改为脚本端把每个字体名输出为 **Base64(UTF-16LE)**，Node 端再解码，确保多语种名称稳定显示。

- **真弹窗与预览严重不一致（根因：内联 style 双引号）**：图层路径用 **`style="…font-family: system-ui, \"Microsoft YaHei\"…"`** 时，CSS 里 **带双引号的字体栈**（及 **`url(\"data:…\")`**）会 **提前结束 HTML 属性**，后续 **font-size / color / transform** 全部不进 DOM → 只剩 **`body` 默认白字小字**、位置错乱。**`reminderWindow.renderLayerFragment`** 已对整条内联 CSS 做 **`escapeInlineStyleForHtmlAttribute`（`"`→`&quot;`，`&`→`&amp;`）**。**`buildReminderHtmlLegacy`** 字体写在 **`<style>`** 里，不受此问题影响。

- **真弹窗与预览严重不一致（再修）**：磁盘 **`layers: []`** 时 **`ensureThemeLayers` 保留空栈**，图层路径几乎不渲染绑定文案，易出现「全屏只有系统小字/布局飘」；**`buildReminderHtml`** 在空栈时改走 **`buildReminderHtmlLegacy`**（读根字段）。**`safeFontPx`** 防止 **`contentFontSize` 等非数字** 导致 `font-size` 整条失效。**`transformStyle`** 对 x/y/rotation 做有限值钳制。**`.stage`** 改为 **`position:fixed; inset:0`**，**`html,body`** 补 **`margin:0; min-height:100%`**；**`BrowserWindow`** **`webPreferences.zoomFactor: 1`**。

- **休息弹窗误显 `m:ss` + 预览/真弹窗字号倒挂（修复）**：移除 **`renderRestCountdownOverlayHtml`**（休息中段主题页不再叠倒计时；与 **`showRestEndCountdownPopup`** 分工一致）。**`main/settings.normalize`** 缺省 **`contentFontSize`/`timeFontSize`** 改为 **180/100**（原为 56/30 导致主文案极小、时间相对巨大）。**`bindingBodyTextFromTheme`** 缺省主文案字号 **180**。**`syncThemeRootFromBindingTextLayer`**：层快照为旧缺省 **56** 且根字号更大时不再覆盖根。**图层路径**绑定主文案/时间层补 **`padding:3px`**，时间层补 **`display:flex;align-items:center;justify-content:*`** 与 **`ThemePreviewEditor`** 对齐。

- **系统默认弹窗主题（v0.0.12+）**：`shared/settings.ts` 导出 **`SYSTEM_MAIN_POPUP_THEME_ID` / `SYSTEM_REST_POPUP_THEME_ID`**、**`BUILTIN_MAIN_POPUP_FALLBACK_BODY`（「时间到！」）**、**`BUILTIN_REST_POPUP_FALLBACK_BODY`（「休息一下」）**；内置主题 **`previewContentText`** 与兜底一致。**`mergeSystemBuiltinPopupThemes`**：`normalizePopupThemes` 在 **`[]` / 全无效项** 时仍补回两条；用户列表缺任一条系统 id 时插入快照。**`reminders.resolvePopupThemeById`**：无效子项 id 后优先 **系统默认 id**，再 **同 target 首条**。**设置页**：删除主题后 **`mergeSystemBuiltinPopupThemes`**；子项回退 id 无兄弟时用系统 id；**`appendPopupTheme` / `addPopupTheme`** 合并内置；下拉缺省 **`getDefaultPopupThemeIdForTarget`**。**新建子项**与 **`AddSubReminderModal`** 默认绑定系统 id；主进程 **`|| '提醒'`** 一律改为 **`BUILTIN_MAIN_POPUP_FALLBACK_BODY`**。

- **主题工坊浮动编辑（v0.0.12 续）**：「+ 创建壁纸」带 **`isNewDraft`**；关闭且未 **`onClose({ saved: true })`** 时 **`removePopupTheme`**，放弃新建不再留列表缩略图；**另存为**从草稿切到新 id 时丢弃旧草稿 id。**顶栏**右侧顺序：**取消 | 保存 | 另存为 | 删除**；移除 **「应用到全部…」** 及设置页批量应用弹窗与相关 state。**`ThemePreviewEditor`**：时间层恢复可点选；**双 `requestAnimationFrame` 延后 `dragStart`** 以等待 Moveable 挂目标；预览根 **`data-theme-preview-root`**；点 **背景** 同步 **`selectedStructuralLayer`**；装饰层 mousedown 清结构选中。**`ThemeStudioEditWorkspace`**：网格 **`tabIndex={-1}`** + 预览列 **`onMouseDownCapture`** 聚焦，使 **Ctrl+Z / Ctrl+Shift+Z** 在预览区生效。**Delete/Backspace 删图层**现由 **`ThemePreviewEditor`** 统一处理（与图层栏 × 同源，见 0.1 首条）；**`usePopupThemeEditHistory`** 默认栈深 **20**（可传 `editHistoryMaxSteps`）。

- **`normalizePopupThemeLayersFromRaw`**：去掉「把 `migrateLegacyLayerStack` 中缺失的固定层再拼进用户数组」的逻辑，用户删除的背景/遮罩等不会在下次 normalize 被补回；**非空 raw 但解析后列表为空**时仍回退整套默认栈（防坏 JSON）。
- **`main/settings.normalizePopupThemes`**：只要 **`Array.isArray(o.layers)` 就写入 `layers`（**含 `length===0`**），避免空栈未落盘 → 读回 `undefined` → 再走 migrate 导致「删了又回来了」。
- **`sanitizeLayer`（绑定主文案 `text`）**：缺省 **`fontSize`/颜色/transform/排版** 等与 **`bindingBodyTextFromTheme(theme)`** 对齐，避免旧逻辑 **`|| 28`** + **`syncThemeRootFromBindingTextLayer`** 把根上正确大字覆盖成小字 → **真弹窗主文案过小**。
- **`removeThemeLayer`**：`theme.layers == null` 时用 **`migrateLegacyLayerStack(theme)`** 作为当前列表再过滤，删除对「仅有根字段、尚未带 layers 的主题」也生效。
- **`addBackgroundLayer` / `addOverlayLayer`** + **`PopupThemeLayersBar`** 工具栏 **「+ 背景」「+ 遮罩」**（各至多 1，已存在则禁用）。
- **`reminderWindow.renderLayerFragment`**：绑定主文案层 **`fontSize` 额外回退 `theme.contentFontSize ?? 56`**，双保险。
- **绑定主文案真弹窗与预览同源（续）**：`renderLayerFragment` 对 **`bindsReminderBody`** 的整段样式（字号/颜色/字重/transform/字间距/行高/对齐/描边阴影）改为与 **`ThemePreviewEditor.renderTextLayerForKey('content')` 一致，一律读 **主题根字段** `content*`，不再用图层 `tl.fontSize`/`tl.transform` 渲染，避免 JSON 里图层与根字段不一致时出现「子项/工坊预览正常、全屏弹窗字极小」。
- **主题工坊预览文案**：`ThemeStudioEditWorkspace` / **`ThemeStudioThumbnail`** 不再传入强行带「提醒」的 **`previewLabels`**，改由 **`getDisplayText` 走 `theme.previewContentText` / `previewTimeText`** 再回落到画布占位，避免盖住主题内已保存的示例文案。
- **子项编辑 vs 工坊保存后文案**：`AddSubReminderModal` 的表单 hydrate **`useEffect` 已去掉对 `popupThemes` 的依赖**（否则 `replacePopupTheme` 后整表重灌会把 `content` 又写回 `sourceItem.content`，子项预览永远停在旧句）。并增加 **`mainThemeSampleSigRef` / `restThemeSampleSigRef`** + effect：当前绑定主题的 **`previewContentText` 变化时 `setContent` / `setRestContent`**（需 `themeEditorContext`）。到点弹窗仍读磁盘上的子项 `content`，用户需在子项点 **「更新」** 落盘。
- **真弹窗仍像「未套主题」**：`reminderWindow` — ① **`transform` 的 `scale` 钳制到 0.1–5**（异常小数避免全屏字极小）；图片层同步钳制。② **去掉弹窗 HTML 的 viewport meta**（减少 Electron 全屏下偶发缩放观感）。③ **`loadFile` 失败时的 fallback** 改为 **`buildReminderHtmlLegacy` 且仍传 `ensureThemeLayers(theme)`**，不再 `theme: undefined`（避免回退成无字号主题）。④ 绑定主文案 / 时间 / 休息叠层倒计时 **字号下限**（16 / 14 / 24 px）防坏 JSON。

## 1. 本轮已完成（v0.0.10u）

### 主题预览文字编辑 + Moveable（续）
- **`ThemePreviewEditor`**：编辑态仍保留 Moveable 外框；点预览空白 **`mousedown`/`click`** 对 `contentEditable` **`blur()`** 退出编辑。
- **`justExitedTextEditRef`**：仅在**点击容器/背景触发 blur** 前置位，用于吞掉紧随其后的 **`click`**，避免误执行 **`onSelectElements([])`** 清掉选中；**`onBlur` / Esc** 不设此标记，保证 Esc 后再点空白仍可取消选中。`useLayoutEffect` 的 **`updateRect`** 依赖增加 **`editingTextKey`**。
- **文字框左右外扩 + 预览边界（v0.0.10x）**：原 **`maxWidth` 与 `width` 同为 `textBoxWidthPct%`**，CSS 会锁死最大宽度，只能往里收不能外拉；改为 **`maxWidth: 100%`**（相对预览黑底容器），**高度**侧去掉冗余 **`minHeight`**，配 **`maxHeight: 100%`**。**`Moveable`** 增加 **`bounds: { position: 'css', left/top/right/bottom: 0 }`** 与 **`snapContainer={containerRef}`**，拖动/缩放/拉框约束在画幅内。**`reminderWindow.textBoxLayoutCss`** 与预览一致（`max-width: 100%` / `max-height: 100%`）。
- **预览态 vs 编辑态 + 编辑时不误退出（v0.0.10y）**：**`resizable`（调 textBox）仅在文字编辑态**（单选且 `selected[0]===editingTextKey`）；**预览态**只用 **`scalable` 等比缩放**整块。编辑态点击 **Moveable**（**`.moveable-control-box`**）时 **`contentEditable` 会 blur**：用 **`pointerdown` 捕获** + **`onBlur` 判断 `relatedTarget`/ref** 保持编辑、**`focus()`** 拉回，**不提交**；仍仅**点预览空白 / Esc** 等真正失焦才提交并 **`setEditingTextKey(null)`**。**`moveableKey`** 增加 **`box|tf`** 后缀以便切换把手组。
- **缩放=改字号 + 仅四角等比 + 退出编辑贴齐（v0.0.10z）**：**`onScaleEnd` / `onScaleGroupEnd`** 走 **`finalizeScaleBakesFontSize`**：按相对缩放比更新 **`contentFontSize` / `timeFontSize` / `countdownFontSize`**，**`TextTransform.scale` 重置为 1**；**`onScaleStart`** 补 **`takeSnapshots()`**。**预览非编辑态** **`renderDirections` 仅四角**，去掉四边中点，避免误触非等比。**字号上限放宽**：预览与 **`PopupThemeEditorPanel`**、**`main/settings` normalize**、**`reminderWindow`** 统一 **1–8000**（防异常 JSON 仍 cap）。**退出文字编辑**后 **`snapTextBoxToTightContent`**（`max-content` 测量 + 对称 padding）收紧 **`textBox*Pct`**。**`parseTransformValues`** 支持 **`scale(sx, sy)`** 取几何均值。**文字层 padding** 改为对称 **`toPreviewPx(3)`**。
- **缩放后 textBox 与字号同步（v0.0.10z-2）**：烘焙字号后若 **`textBoxWidthPct`/`HeightPct` 不变**，像素框不变、字变大 → **`overflow:auto` 滚动条与底部截断**。缩放松手时 **对已有 textBox 百分比同步乘同一 `ratio`**；**无固定 textBox** 时再 **`snapTextBoxToTightContent`**。**`snapTextBoxToTightContent`** 测量前 **`overflow: visible`**，取 **`max(offset*, scroll*)`**，避免在已有滚动/裁切下测小。
- **拖动缩放过程等比（v0.0.10z-3）**：Moveable 在 **`onScale`/`onScaleGroup`** 中可能短暂输出 **`scale(sx,sy)` 且 sx≠sy**，字会像被横向拉长；松手后烘焙用几何均值又像「恢复」。增加 **`forceUniformScaleInFullTransform`**，每帧把 **`scale(...)`** 规范为 **`√(sx·sy)`** 的单一 scale；**不设**顶层 **`keepRatio`**，以免编辑态 **`resizable` 拉框**也被迫等比。
- **缩放后换行/滚动条 + 缩放时左上角稳定（v0.0.10z-4）**：缩放松手后 **始终**再 **`snapTextBoxToTightContent`**（双 rAF）；**`textBox*Pct` 乘 ratio** 时加 **+0.5% / +0.3%** 容差；**`snapTextBoxToTightContent`** 结果也略加宽加高。**非编辑态**有固定高度时 **`overflow: visible`**，避免预览里假滚动条。**单选角点缩放**：**`scalePinBoxRef`** 记录起始 **AABB 左上角**，每帧 **`applyMoveableFrame`** 后再量一次并二次修正 **translate**，使操作框左上角相对黑底容器不漂移（打组缩放清 pin）。
- **缩放松手后文字再跳一下（v0.0.10z-5）**：**`finalizeScaleBakesFontSize`** 若仍用 **`translateToThemePercent`**（基于烘焙前 **offset 尺寸**）写 **theme x/y**，随后 **字号 + textBox** 更新导致 **`recomputeStyleTransformsFromTheme`** 用 **新 w/h** 重算 **tx/ty**，与旧语义不一致 → 松手后位移。**修复**：松手瞬间用 **`getBoundingClientRect()`** 取元素 **视觉 AABB 中心**相对预览容器的 **百分比** 写入 **x/y**（与「中心在 x%/y%」模型一致）；**立即**再用同一公式 **`tx = cW*x/100 - wLay/2`** 写 **scale=1** 的 transform，与后续 recompute 对齐。
- **缩放松手仍跳（v0.0.10z-6）**：**x/y 分母**改为 **`container.offsetWidth/Height`**，与 **recompute** 一致（避免与 **`getBoundingClientRect().width`** 亚像素差）。**双帧 `snapTextBoxToTightContent`**：在已按比例更新 **`textBox*Pct`** 时**不再** tight snap（否则会改框宽，左/顶对齐下文字相对框漂移）；仅 **`updateRect`**；无固定 textBox 时仍 snap。
- **缩放松手字号微抖（v0.0.10z-7）**：松手烘焙曾写入 **三位小数字号**，预览用 **`Math.floor`**、持久化 **`clampThemeFont` 亦 floor**，与「去掉 scale 后的目标字号」不一致 → 轻微跳变。**修复**：预览 **`contentFontPx`/`time`/`countdown`** 改为 **`Math.round` + cap 8000**；**`finalizeScaleBakesFontSize`** 以与预览相同的 **整数基准 px × ratio** 再 **`Math.round`** 写回主题，**不再**写小数。
- **缩放锚点 + Ctrl（v0.0.10z-8）**：单选四角缩放默认锁定 **AABB 左上角**（与既有 pin 一致）；缩放过程中按住 **Ctrl** 改为锁定 **AABB 中心**（「沿中心缩放」/ transform origin 语义）；松键时用当前几何 **重设锚点**，避免切换时跳变。说明文案已写入预览区提示。
- **多行文案 + textBox 错乱（v0.0.10z-9）**：**`snapTextBoxToTightContent`** 曾用 **`width: max-content`** 测量，长段被拉成单行 → **`scrollHeight` 仅一行** → **`textBoxHeightPct` 过小**，退出编辑后换行与预览不一致（甚至像「变回超长单行」）。**修复**：按主题 **`textBoxWidthPct`**（或当前 `offsetWidth`）设**固定测量宽度**再读 **`scrollHeight`**。**编辑态**有 `textBoxHeightPct` 时改为 **`minHeight` + `height:auto` + `overflow:visible`**，避免固定 `height:%` + `overflow:auto` 把多行截成单行滚动。**外部 `previewLabels` 变更**且非编辑时 **rAF 后 snap**（经 ref 调用，避免依赖 `getTransform` 死循环）；编辑中 **`onInput` → `updateRect`** 同步 Moveable 外框。
- **退出编辑横向撑满（v0.0.10z-10）**：snap 曾用 **`w = max(scrollW, measureWpx)`** 写回 **`textBoxWidthPct`**，`scrollWidth` 偶发大于内容可视宽 → 宽度被推到接近 **100%**。**修复**：已有 **`textBoxWidthPct`** 时 snap **只更新 `textBoxHeightPct`**（宽由拉框/用户定）；无宽度字段时仍算 **`wPct`** 且 **`min(..., cw*0.96)`** 封顶。外部文案 **useLayoutEffect** 用 **`editingTextKeyRef`** 判断编辑态并**去掉**对 **`editingTextKey` 的依赖**，减少与 blur 双 snap 叠加。
- **退出编辑外框仍过宽（v0.0.10z-11）**：z-10「只改高」导致短文仍占旧宽框。**修复**：**`snapTextBoxToTightContent`** 改回**同时**写 **`textBoxWidthPct`/`HeightPct`**，用**两阶段测量**：① `max-content` + **`maxWidth: 96%` 画布** 得 **`wIntrinsic`**（封顶，避免再撑满）；② 固定 **`width: wIntrinsic`** 后量 **`scrollHeight`** 得高度（多行正确）。
- **子项主题预览时间可编辑（v0.0.10z-12）**：**`PopupThemeEditorPanel`** 曾 **`editableTextKeys ?? ['content','time','countdown']`**，在有 **`onLiveTextCommit`** 时仍强制三层可编辑，覆盖 **`ThemePreviewEditor`**「有 live 仅 content」约定。**修复**：未显式传 **`editableTextKeys`** 时，有 **`onLiveTextCommit`** 则 **`undefined`**（仅主文案可双击）；无 live 时仍为三层（主题工坊写 **`preview*`**）。
- **保存后预览乱换行（v0.0.10z-13）**：**`textBoxWidthPct`** 过窄时 **`overflow-wrap:anywhere`** 会把短中文/「12:00」拆成多行，与编辑态（框较松或 nowrap 观感）不一致。**修复**：**`snapTextBoxToTightContent`** 按**最长行字数 × 预览字号**设 **`minWpx`**（时间/倒计时再设字宽下限），再写回百分比；**`ThemePreviewEditor`** 对 **time/countdown** 用 **`white-space:nowrap`**；**`reminderWindow.textBoxLayoutCss`** 增 **`layer`** 参数，**content** 仍 **pre-wrap**，**time/countdown** **nowrap** 与预览一致。
- **全屏编辑 vs 小窗换行不一致 + 预览闪烁（v0.0.10z-14）**：**`textBoxWidthPct`** 为相对**当前预览盒**宽度；舍入略紧 + **`overflow-wrap:anywhere`** 会在窄窗把「叫我醒来」拆字换行。**修复**：主文案改 **`overflow-wrap:break-word` + `word-break:keep-all`**（预览与 **`reminderWindow`** content 一致）；**snap** 主文案 **min 宽/百分比**再放宽，并对 theme 已有 **textBox** 作 **ε 跳过**避免无意义 **`updateTransform`**。**ResizeObserver** 只观察**容器**、**50ms debounce** 再 **recompute**，去掉对文字层的观察以打断 snap↔尺寸抖动环；**外部文案 snap 的 effect** 去掉对**字号**依赖，减少周期性写入。
- **小窗提醒内容每秒抖（v0.0.10z-15）**：**`AddSubReminderModal`** **`setInterval(1s)`** 更新 **`previewLabels.time`**；原 **snap 的 useLayoutEffect** 依赖 **`previewLabels?.time`**，每秒 **rAF + snap + `Moveable.updateRect()`**，主文案外框跟着抖。**修复**：**`liveSnapLabelSig`** 仅拼接 **`effectiveEditableKeys` 所含层**的文案（子项仅 **content** 时不含 **time**），使 **sig** 在时钟走时不变、effect 不重复跑；无选中时不再 **`updateRect()`**。
- **主文案栏宽 60% + 失焦只增高（v0.0.10z-16）**：仅 **content** 适用自动栏宽：**`max-content`** 测得单行固有宽 **≤ 画布 60%** 时栏宽贴字；超出则栏宽锁 **60%** 并换行；**Moveable 拉框**或面板填宽高后 **`contentTextBoxUserSized: true`**，宽度不再随字数自动变，可拉至约 **96%**。**失焦**在**当前宽度**下只更新 **`textBoxHeightPct`**。**时间/倒计时**默认主题带固定 **`textBox*Pct`**，**liveSnap** 不再因时钟触发；无框时编辑结束才 **tight** 一次。**`normalizeTextTransform` / `reminderWindow` / `finalizeResize`** 栏宽上限 **96%**。
- **小窗预览又抖（v0.0.10z-17）**：**`effectiveEditableKeys`** 曾依赖 **`onLiveTextCommit` 引用**与内联 **`editableTextKeys` 数组**，父组件每秒渲染（时钟）→ **新引用** → **`liveSnap` useLayoutEffect** 每帧跑。**修复**：**`hasLiveTextCommit` 布尔** + **`editableKeysSig`（排序拼接）** 作 **useMemo** 依赖；默认 **`['content']` / 三层** 用**模块级常量数组**。
- **四角缩放锚对角（v0.0.10z-18）**：单选 **Scalable** 时根据 Moveable **`direction`**（所拖角）锁定**对角**在预览容器内像素位置，每帧用 **`getBoxCornerInContainer` + translate 修正**；**Ctrl** 仍切**中心**锚点，松键按 **`scaleDirectionForPinRef`** 恢复对角。**`fixedCornerFromScaleDirection`**：se→tl、nw→br、ne→bl、sw→tr。
- **时间/倒计时操作框边距（v0.0.10z-19）**：默认 **`textBox*Pct`** 收紧（主时间 11×8%、休息 12×9%、倒计时 14×20%）；**`snapShortLayerTightContent`** 时间与倒计时共用 **`0.58em` 估宽 + 对称 `pad2`**，去掉 7em/5em 分叉；预览层 **`display:flex` + `alignItems:center`** 在固定高百分比内垂直居中。
- **时间/倒计时 Moveable 贴字宽（v0.0.10z-20）**：根因是 **`width: textBoxWidthPct%`** 把层撑成条，操作框不贴「12:00」。新增 **`shortLayerTextBoxLockWidth`**：`false`/缺省为 **`width:max-content`**，`textBoxWidthPct` 仅 **`max-width` 上限**；预览 **四边拉框** **`finalizeResize`** 写 **`shortLayerTextBoxLockWidth:true`** 恢复定宽条。**`reminderWindow.textBoxLayoutCss`** 与预览一致；默认主题时间/倒计时去掉默认 **width%**，只保留高度带。
- **时间/倒计时误出滚动条（v0.0.10z-21）**：固定 **`height:%` + `overflow:auto`** 在单行 **nowrap** 下仍会出纵向滚动条（编辑态与弹窗）。**`textBoxLayoutCss`** 对 **time/countdown** 改为 **`overflow:hidden`**，**content** 仍 **auto**；**ThemePreviewEditor** 短层有 **`textBoxHeightPct`** 时 **`overflow:hidden`**。
- **撤销/重做 + 方向键微调 + 描边阴影（v0.0.10z-22）**：
  - **`usePopupThemeEditHistory`**：每次 **`onUpdateTheme`** 前 **`structuredClone`** 压栈（默认上限 20，可由 **`editHistoryMaxSteps`** 调整），**`replaceThemeFull`** 恢复整主题；**`PopupThemeEditorPanel`** 必传 **`replaceThemeFull`**（设置页 **`replacePopupTheme`**，子项内联 **`setThemeFullscreen` 整 draft**）。
  - **快捷键**：焦点在面板内且**非** `input/textarea/select/contenteditable` 时 **Ctrl+Z** 撤销、**Ctrl+Shift+Z** 重做；参数行增加「撤销 / 重做」按钮。
  - **`ThemePreviewEditor`**：**方向键**在相同焦点规则下对**选中层**按预览逻辑像素 **±1** 平移（`translate` 增量 + 与 **`translateToThemePercent`** 一致的写回）；多选一次 **`onUpdateTheme` 合并 patch**；**`keyboardScopeRef`** 默认面板根（参数区也可触发）。
  - **数据模型**：**`PopupLayerTextEffects`**（`shared/settings.ts`）挂 **`contentTextEffects` / `timeTextEffects` / `countdownTextEffects`**；**`shared/popupTextEffects.ts`** 输出 **`layerTextEffectsCss` / `layerTextEffectsReactStyle`**（描边 **`-webkit-text-stroke` + `paint-order`**；阴影 **距离+角度→offset**、**模糊**、**扩散** 叠一层光晕近似 Keynote）。
  - **UI**：**「当前选中层 · 描边与阴影」**（文字/全部分页）；**`main/settings` normalize** 与 **`reminderWindow`** 已接真弹窗。
- **弹窗字体（v0.0.10z-23 / z-24）**：**`popupFontFamilyPreset`**（预设栈）+ **`popupFontFamilySystem`**（本机族名）。**`font-list`** 在主进程枚举字体，IPC **`getSystemFontFamilies`** / **`clearSystemFontListCache`**；Vite 将 **`font-list` external** 出主包。主题工坊「文字」：**预设组合** | **本机已安装**（`SystemFontFamilyPicker`、重新扫描）；**`resolvePopupFontFamilyCss`** 本机名非空时 `"族名", "Microsoft YaHei", system-ui, sans-serif`，否则预设；**`sanitizeSystemFontFamilyName`** 防 CSS 注入。
- **子项详细主题：保存 vs 另存为（v0.0.10z-28）**：去掉「自动按引用数决定替换或 fork」。改为 **保存**＝`replacePopupTheme` 覆盖当前 id，点保存前 **`confirm`** 提示覆盖及另有 N 条引用时一并更新；**另存为**＝`clonePopupThemeForFork` + `appendPopupTheme`，本条 `main/restPopupThemeId` 切到新 id。无改动点「保存」仍仅收起详细区。
- **子项详细主题保存（v0.0.10z-27）**：`popupThemeContentEquals` 忽略 `name`，曾导致仅改名或误判无改动时「保存」直接关掉且不写入；改为 **`themeFullscreenDraftDirty`**（含名称比较）。**Fork** 时 `clonePopupThemeForFork(draft,'')` 避免名称再叠「（副本）」；空名时按独占替换 / 另存分支回落。**`appendPopupTheme`** 改为 **新主题插列表前部**，主题工坊与下拉更容易看到刚保存项。详细编辑区增加 **主题名称** 输入框与说明。
- **子项弹窗：主/休息文案入口（v0.0.10z-26）**：新建/编辑闹钟、倒计时时**去掉独立「内容」输入框**（主结束弹窗、拆分时的休息弹窗）；文案在**小预览 / 详细主题**里双击主文案编辑，**仅写入当前子项** `content` / `restContent`。**切换主题**时把该主题 `previewContentText` 载入本条（无则「提醒」/「休息一下」）；默认主题在 `shared/settings` 中补 **`previewContentText`**。`contentPresets` / `restPresets` 相关 props 改为可选（设置页仍可传，组件内暂不用）。
- **本机字体列表 + 预览图（v0.0.10z-25）**：分层字体仍共用一份 **`systemFonts`** 列表；**弃用 `datalist`**（Chromium 会按当前输入值过滤建议，已填完整族名时只剩一条，且无法限制下拉高度）。改为 **`SystemFontFamilyPicker`**：手填 +「浏览」打开 **`fixed` 浮层**，列表区 **`max-height: min(40vh,280px)` + `overflow-y-auto`**，顶栏筛选。**`ThemePreviewEditor`** 背景用 **`rendererSafePreviewImageUrl`**，本地路径在 IPC 写入 map 前**不**生成 **`file://`**，避免控制台 **`Not allowed to load local resource`**；**`hasBgImage && !url` 时仅铺底色**。**`Settings` / `AddSubReminderModal`**：`resolvePreviewImageUrl` 失败时映射为 **`''`** 而非 `file://`。

### 子项弹窗：非全屏详细编辑 + 小预览交互
- **`AddSubReminderModal`**：去掉 **`createPortal` 全屏**；未展开时 **`ThemePreviewEditor`**（`previewLabels` + `onLiveTextCommit` 仅 **`content`** 回写 `setContent` / `setRestContent`）；**「编辑主题」** 在同卡下方内联 **`PopupThemeEditorPanel`**（`max-h-[min(75vh,680px)]` + 滚动），再点 **「收起详细设置」** 调用 `tryCancelThemeFullscreen`（有改动确认）。**详细编辑时**：`popupThemeLayoutClass` 改为单栏 **`flex` 全宽**，**隐藏另一侧**弹窗卡片（`showRestPopupCard` / `showMainPopupCard`）；**弹窗设置**区块 `max-w-5xl` 与 modal 对齐；双弹窗时顶部灰色说明「另一侧已暂时隐藏」。
- **`PopupThemeEditorPanel` / `ThemePreviewEditor`**：**当前选中层 · 排版**（随全局 / 左中右、字间距、行高）；主进程 **`reminderWindow.ts`** 分层 `text-align` / `letter-spacing` / `line-height`。
- **类型**：`ThemePreviewEditor` 的 Moveable 回调目标放宽为 **`HTMLElement | SVGElement`** 并过滤；`moveableTargets` 谓词改为 **`HTMLDivElement`**；删除 **`Settings.tsx`** 未使用的 **`moveCategory` / `moveItem` / `moveItemToCategory`**（排序已用 `arrayMove` 内联）；**`PopupThemeEditorPanel`** 去掉无用 **`React` import**。
- **预览比例（v0.0.10v）**：`ThemePreviewEditor` 的 **`previewScale`** 改为 **`实测预览容器宽度 / previewViewportWidth`**（上限 1），未测量前仍用 `920/vw` 兜底；修复子项窄栏/展开编辑时文字按固定 920 参考缩放导致**过大、位置观感不对**的问题。
- **主题编辑文字与文字框（v0.0.10w）**：`TextTransform` 增加 **`textBoxWidthPct` / `textBoxHeightPct`**；`reminderWindow` 与预览一致；Moveable **`resizable`**（四边+四角，`keepRatio: false`）与 **`scalable: { keepRatio: true }`** 并存；`PopupTheme` 增加 **`previewContentText` / `previewTimeText` / `previewCountdownText`**（工坊写回；真实弹窗仍用提醒数据）。`PopupThemeEditorPanel` 透传 **`previewLabels` + `onLiveTextCommit`**；子项展开编辑时主文案回写表单，时间/倒计时可写回 draft 的 preview*；**`getDisplayText`** 优先主题内自定义时间/倒计时再回落到 `previewLabels`。
- 文档：`docs/POPUP_THEME_PLAN.md` 2.2、V1.5 双击项已更新。

### 弹窗主题 · 图层 V1（v0.0.11+，首轮落地）
- **数据**：`src/shared/popupThemeLayers.ts`（迁移旧栈、`sanitizeLayer`、装饰 `textEffects`）；**不**再使用 **`bindingCountdown` 图层类型**，历史 JSON 中该条在 **`sanitizeLayer` 丢弃**；`shared/settings` 等导出图层常量。
- **主进程**：`reminderWindow` 按 **`ensureThemeLayers`** 的 z 序输出片段；装饰 **图片层** 复制到临时 HTML 目录用相对 `url()`。**休息中段**不再在主题页叠 `m:ss` 倒计时（已移除 `renderRestCountdownOverlayHtml` / `countdownStr`）；**最后 N 秒**仍仅 **`showRestEndCountdownPopup`** 黑底大字页。
- **编辑 UI**：`PopupThemeLayersBar`（显隐、折叠、排序、+ 文本/图片）；`PopupThemeEditorPanel` / `ThemeStudioEditWorkspace` 联动选中层；**`ThemePreviewEditor`** 按 layers 渲染绑定层与装饰层、**休息主题**在栈顶后追加倒计时预览层；Moveable/方向键支持装饰层；点绑定文案时 **`onSelectDecorationLayer(null)`** 与装饰互斥；**`ThemeStudioThumbnail`** 的 **`previewLabels`** 含休息 **`countdown`**。
- **构建**：`vite.config.ts` 为 preload 的 **`build.lib`** 补 **`entry`**，满足当前 Vite 类型中 **`LibraryOptions.entry` 必填**（`npm run build` 通过）。

### 文本层统一 + 预览去倒计时（v0.0.11 续）
- **`ThemePreviewEditor`**：去掉休息主题预览里多余的 **`countdown`** 叠加层；图层 **`kind: 'text'`**（`bindsReminderBody` 走主文案 `content` ref，否则走装饰 Moveable）；装饰变换写回仍用 **`updateDecorationLayer`**。
- **`PopupThemeLayersBar`**：收尾 **`removeThemeLayer` / `addTextLayer` / `addTimeLayer` / `MAX_TEXT_LAYERS`**；点击 **「文本层（提醒）」** 选中 **`content`**（与预览 `contentRef` 一致），自由文本层仍用 **`selectedDecorationLayerId`**。
- **`PopupThemeEditorPanel`**：**`mergedWrappedOnUpdateTheme`**（`mergeContentThemePatchIntoBindingTextLayer`）保证改根 **`content*`** 时同步绑定文本层；**仅选时间**时只显示时间相关字体/颜色/字重等，**仅选主文案**时只显示主文案侧；自由 **文本层** 用 **`updateTextLayer`**，标题改为「文本层 · 属性」。
- **`addTimeLayer`**：任 **`bindingTime`** 已存在即不可再加（不限定固定 id）。
- **真弹窗 / 工坊对齐（v0.0.11 修复）**：遮罩 **`opacity` 与 `overlayEnabled` 一致**；**壁纸**优先 **`copyFileSync` 到 HTML 同目录** 用 **`url('./…')`**，失败再回退 **`getBackgroundStyle`**（减轻超大 **data:** 内嵌导致 **`loadFile` 失败 → 整页纯黑**）。**`ThemePreviewEditor`**：**`getTargetRef('countdown')`** 与 **`textLayerPairs`**；**补充文本**双击 **`contentEditable`** + **`updateDecorationLayer` 写回 `text`**。**`PopupThemeEditorPanel`**：单选 **content / time / countdown**（预览内点倒计时）时 **`onPanelFilterChange('text')`**。

### 悬浮卡片编辑主题（本轮）
- **主题工坊列表**仍占主内容区；点缩略图或「+ 主题」改为打开 **全屏遮罩 + 固定居中卡片**（左预览右参数 6:4），列表仍在背后，关闭卡片回到列表。
- **闹钟/倒计时内联「编辑主题」**同样打开该悬浮卡片（**不**再整页跳转）；顶栏 **绿底「结束弹窗」/ 蓝底「休息弹窗」** + 副标题「闹钟/倒计时编辑中」；**取消 / 保存 / 另存为** 仅作用于主题草稿，**关闭后回到子项表单**（子项未保存改动不要求确认即可打开主题编辑）。
- **另存为（子项）**：fork 新主题并 **`popupThemeRemotePatch`** 写回当前内联表单的 `main/restPopupThemeId`。
- **`ThemeStudioEditWorkspace`**：预览+Panel 共用块；**`ThemeStudioFloatingEditor`** 内 **本地 `draft`**，选图走 IPC 只改草稿，点保存再 `replacePopupTheme`。

### 主题工坊 UI（浮动编辑弹窗 / 列表首页）
- **16:9 / 4:3** 仅出现在**主题编辑浮动弹窗**工具栏（与主题名称同排），用于预览画幅；列表首页仅标题「主题工坊」，已去掉「关闭工坊」（用顶栏「全部」等退出工坊）。
- 浮动弹窗 **固定尺寸**：约 `w-[min(96vw,1960px)]` × `h-[min(92dvh,1100px)]`；内部分栏 **7fr : 3fr**（预览约 70%），左侧 **无额外灰卡包裹**；**`ThemePreviewEditor`** 在工坊左栏使用 **`previewWidthMode="fill"`**、**`outerChrome="none"`**，黑底画幅 **随左栏全宽**，`previewScale` 仍按实测宽 / `previewViewportWidth`；子项/设置卡等默认仍为 capped + 白卡外框。

### 预览主文案 snap / 时间层编辑
- **liveSnap** `useLayoutEffect` 去掉对 **`selectedElements.length`** 的依赖；触发信号为 **`contentSnapLabelSig`**（仅主文案相关），**不把** time/countdown 的 preview* 并入同一 sig，避免时间走表、改倒计时或操作短层时误跑 **`syncContentPreviewTextBox`** → 主文案框「多一行」、操作框底边异常延伸。
- **时间、倒计时**：预览内均**不可双击编辑**（`onMouseDownCapture` 硬拦 + 默认可编辑层仅 **`content`**；Panel 默认 **`['content']`**）。失焦写回主文案去掉 **contentEditable 尾部 `\n`**；**`syncContentPreviewTextBox`** 若 **`editingTextKeyRef` 非空则 return**。

### 主题工坊列表缩略图与编辑预览对齐
- **`ThemeStudioThumbnail`** 不再用手写背景+固定 `text-xs`/`10px` 字；改为复用 **`ThemePreviewEditor`**（`readOnly` + `showToolbar={false}`），与悬浮编辑/参数区共用 **`previewViewportWidth`**、**`popupPreviewAspect`** 及主题内字号、变换、遮罩、分层样式，缩略图与最终结果 1:1 比例一致。
- **缩略图与弹窗 1:1 排版**：列表槽位外包 **`ResizeObserver`**，内层按 **`previewViewportWidth` × 16:9（或 4:3）** 固定逻辑像素渲染 **`ThemePreviewEditor`**（**`fixedPreviewPixelSize`**，黑底与弹窗同分辨率），再 **`transform: translateX(-50%) scale(slotW/vw)`** 顶中缩放落入槽位；换行/百分比栏宽与真实弹窗一致，不再靠 `max-content` 近似。
- **`ThemePreviewEditor`** 新增 **`readOnly`**（禁编辑/拖拽/Moveable/框选/方向键）、**`showToolbar`**（隐藏说明条与对齐栏）。

### 设置页：主题工坊与列表切换宽度对齐
- **`index.css`**：`html { scrollbar-gutter: stable; }`，减轻整页滚动与工坊内嵌滚动切换时滚动条出现/消失导致的**可用内容区宽度**变化。
- **`Settings.tsx`**：**主题工坊**单独保留外层白卡（`rounded-xl border … p-4`）；提醒列表（大类卡片）**不再**外包一层白卡，仅 `flex flex-col gap-6`，避免与 `CategoryCard` 重复嵌套。顶栏类型筛选条 **`box-border w-full min-w-0`**。**主题工坊**视图下隐藏底部「立即保存 / 全部重置 / 自动保存说明 / 设置路径」；已移除列表页底部「弹窗主题」引导卡。

### 主题工坊整页编辑替代子项内联 Panel（历史，已由「悬浮卡片」承接）
- **`AddSubReminderModal`**：无内联全屏 Panel；**`baselinePayloadJsonRef`** 仍可用于子项其它判脏逻辑。
- **`Settings`**：**`themeStudioNav`** 仅 **`list | null`**；编辑态为 **`floatingThemeEdit`** + **`ThemeStudioFloatingEditor`**。

## 2. 历史（v0.0.10t：子项全屏 Portal 编辑主题 + Panel 复用）

- **`PopupThemeEditorPanel`** 复用至设置页与子项；fork/原地保存规则不变。**v0.0.10u** 起子项侧改为内联展开，不再全屏 Portal。

## 3. 历史（v0.0.10s：启动时预览变换错乱）

### （v0.0.10s）启动/重启后预览文字变换错乱，点一下才正常
- **原因**：首帧 **`useLayoutEffect`** 在预览容器或文字层 **`offsetWidth/Height` 仍为 0**（aspect-ratio、字体未就绪）时用错误尺寸算 **`tx/ty` 写入 `styleTransformByKey`** 并固定；后续尺寸变化未触发重算，直至点击重渲染。
- **修复**：**`recomputeStyleTransformsFromTheme`**：容器与每层文字尺寸均有效才写入；**双 `requestAnimationFrame`** 补算；**`ResizeObserver`** 监听预览容器与各文字层；**`document.fonts.ready`** 后再算一次；拖拽锁用 **`transformSyncLockedRef`** 供异步回调读取。

## 4. 历史（v0.0.10r）

### 多选时「重置为默认位置」只生效第一个
- **修复**：**`Settings.tsx`** 弹窗主题「位置与变换」中，**`onClick`** 对 **`getThemeSelectedElements` 的全部 `sels`** 各写 **`contentTransform` / `timeTransform` / `countdownTransform`** 默认值，**一次 `updatePopupTheme`** 合并 patch；多选时按钮文案为 **「将全部选中项重置为默认位置」**。

## 5. 历史（v0.0.10q）

### 变换松手瞬间轻微往右下偏移
- **原因**：**`finalizeElement`** 用 **`getBoundingClientRect` 的 AABB 中心** 换算 `x/y`，有 **旋转/缩放** 时与 **`useLayoutEffect` 里用的「布局中心」**（`translate + offsetWidth/2`）不是同一几何点；再用 **`.toFixed(2)` 的百分比反算 `tx/ty`**，与 Moveable 最终 **`translate` 亚像素不一致** → 松手跳一下。
- **修复**：新增 **`translateToThemePercent`**，与 **`tx = cW*(x/100)-w/2` 严格互逆**；**`finalizeElement`** 从当前 **`transform` 解析 `translateX/Y`**，**`theme` 用互逆公式**，**`buildTransform` 直接用解析值**（不经百分比回算）。**多选对齐**写回 theme 同样改为 **`translateToThemePercent`**。删除已无调用的 **`centerToPercent`**。

## 6. 历史（v0.0.10p）

### 预览区内操作仍卡顿 / 外框慢半拍
- **原因**：每次指针事件都 **`setState`（mergeStyleTransforms）+ 同步 `updateRect()`**，一帧内多次触发整组件重渲染与布局，和 Moveable 内部抢主线程。
- **修复**：**`applyMoveableFrame`** 仍**立即**写 **`element.style.transform`**；**`styleTransformByKey` 与 `updateRect`** 通过 **`pendingMoveablePatchRef` + `requestAnimationFrame` 每帧最多合并一次**；各 **`on*Start`** 调用 **`resetMoveableVisualPipeline`**，**`on*End`** 先 **`flushMoveableVisual('sync')`** 再 **`finalizeElement`**。选中层加 **`will-change: transform`** 促合成层。

## 7. 历史（v0.0.10o）

### Moveable 外框滞后 / 改参数不更新
- **原因**：目标 `transform` 或尺寸变化后未通知 Moveable 重算控制框。
- **修复**：每次 **`applyMoveableFrame`** 写入 DOM 后调用 **`moveableRef.current.updateRect()`**；开启 **`useResizeObserver`**；**`useLayoutEffect`** 在字号/字重/对齐/视口等与排版相关依赖变化且非拖拽锁定时再 **`updateRect()`**。

### 多选对齐错误
- **原因**：旧实现把 **`TextTransform.x/y`（中心点百分比）** 当「左/右/顶/底」对齐，与视觉边界无关。
- **修复**：用 **`getBoundingClientRect()`** 相对预览容器算各层 **AABB**，按选区包络做 **左/右/水平居中/顶/底/垂直居中**（与 Figma 等一致）；用 **`translate` 增量**移动；写回 theme 见 **v0.0.10q**（**`translateToThemePercent`**）。

## 8. 历史（v0.0.10n）

### 打组仍「各转各的」（续）
- **补充原因**：子事件里 **`afterTransform` 有时与 `transform` 相同**（都只有 `rotate`/`scale`），**带像素的轨道平移**实际在 **`drag.transform`**（或 `drag.afterTransform`）。
- **修复**：**`pickMoveableCssTransform`** 顺序：若 **`afterTransform !== transform` 且含 `translate(...px)` / `translate3d(...)`** → 用 `afterTransform`；否则若 **`drag.transform` 含 px 平移** → 用之；再回退 `afterTransform` / `transform`。并扩展 **`parseTransformValues`** 支持 **`translate3d`**，便于 finalize 读回位置。
- **清理**：删除未使用的 **`applyShiftSnap`**（旋转吸附已由 **`snapRotateInFullTransform`** 承担）。

## 9. 历史（v0.0.10m）

### 打组旋转/缩放与 afterTransform
- Moveable 子事件里 **`transform` 常为片段**；早期修复为统一走 **`pickMoveableCssTransform`** + **`snapRotateInFullTransform`**。

## 10. 历史（v0.0.10l）

### 白屏：`popupThemes.map is not a function`
- **原因**：v0.0.10k 把 `updatePopupTheme` 改成了 `setPopupThemes((prev) => prev.map(...))`，但 **`setPopupThemes` 的签名是 `(nextThemes: PopupTheme[]) => void`**，内部直接 `popupThemes: nextThemes`，会把 **整个 updater 函数** 存进 `settings.popupThemes`，下一帧渲染 `popupThemes.map` 即崩。
- **修复**：`updatePopupTheme` 改为 **`setSettingsState((prev) => ({ ...prev, popupThemes: themes.map(...) }))`**，在 **settings 一级** 做函数式更新；并 **`Array.isArray(settings.popupThemes)`** 兜底，避免脏数据再崩。

### （v0.0.10k）打组松手后「回正 / 只保留一个对象」——真正根因
- **不是 Moveable 不成熟**，而是 **`updatePopupTheme` 用了闭包里的 `popupThemes`**。
- 打组 `on*GroupEnd` 里连续调用多次 `finalizeElement` → 多次 `onUpdateTheme(themeId, { contentTransform })`、`{ timeTransform }`…  
  每次 `setPopupThemes(popupThemes.map(...))` 读到的都是**同一次渲染时的旧 theme**，后一次 patch 会**盖掉前一次**，最终只有**最后一个字段**写进 state，其它字层的变换丢失 → 看起来像「回正」。
- **正确做法**：在 **`setSettingsState` 的 `prev` 上** 对 `popupThemes` 做 `map` 合并（见上节 v0.0.10l），**不要**把函数传给 `setPopupThemes`。

### 按下即拖（不必先点一下再拖）
- 在文字层 **`onMouseDown`**（非 Shift）里：`flushSync(() => onSelectElements([key]))` 立刻选中并提交 DOM，再 **`moveableRef.current.dragStart(nativeEvent)`**（react-moveable 官方 API）。
- 多选已包含当前字块时：不改编选，直接 `dragStart`。
- **Shift** 仍走原 `onClick` 多选逻辑，`onMouseDown` 里对 Shift 提前 return。

### 涉及文件
- `src/renderer/src/pages/Settings.tsx` — `updatePopupTheme` 函数式 setState  
- `src/renderer/src/components/ThemePreviewEditor.tsx` — `moveableRef`、`flushSync`、`scheduleDragStart`、`handleTextPointerDown`

## 11. 版本信息

- **当前 package 版本**：**`0.0.17`**（见根目录 `package.json`；git tag 以你本地打标为准）
- **内容概览**：主题工坊「+ 创建壁纸」、浮动编辑顶栏 **休息壁纸（蓝）/ 结束壁纸（绿）**（左→右）切换 `target`；子项「编辑主题」**锁定用途**；休息主题预览含 **content + time + countdown（绑定层）**；**休息结束最后几秒**仍固定黑底（`buildRestEndCountdownHtml`），与主题图层硬切；`ThemeStudioFloatingEditor` 保留 **`bannerMain`** 别名避免 HMR 残留 `ReferenceError`
- **图层 V1**：数据 + 主进程按序渲染 + 工坊/Panel 图层栏与预览 Moveable 已接（见 **§1 · 弹窗主题 · 图层 V1**）；**待办**：全链路手测、`AddSubReminderModal` 小预览是否需显式传图层相关 props、`POPUP_THEME_PLAN` 里程碑勾选与 V1.5 浮动工具栏等

### 新建主题：预览双击与右侧文案输入「无反应」（修复）

- **原因**：① **时间**绑定层 z 序在主文案之上，重叠区域双击落在时间层，该层对双击不进入 `contentEditable`；② 浮动工坊默认 **`selectedElements` 为空**，`PopupThemeEditorPanel` 的 **`showContentColumn`** 为 false，**「主文案内容」textarea 与主文案字体块不渲染**，易被误认为输入坏了。
- **曾用修复**：时间层一度 **`pointer-events: none`** 未选中时穿透；现改回**始终可点**以支持单击选中时间，并与 **延后 `dragStart`** 配合避免 Moveable 未就绪；**`ThemeStudioFloatingEditor`** 对每个 **`themeId` 仅一次**：若当前无选中则默认 **`setSelectedElements(id, ['content'])`**。
- **涉及文件**：`src/renderer/src/components/ThemePreviewEditor.tsx`、`ThemeStudio.tsx`

### 主题删除：不再强制每种 target 保留 1 条

- **`removePopupTheme`**：去掉「同 target 仅 1 条则禁止删」；删后 **`mergeSystemBuiltinPopupThemes`** 保证 **`theme_main_default` / `theme_rest_default`** 仍在列表中；子项若曾绑定被删 id，回退为**同 target 另一条**，无则写 **系统默认 id**（`SYSTEM_*_POPUP_THEME_ID`）。
- **浮动工坊「删除」**：`canDeleteTheme` 恒为可删（`disabled` 仅当显式 `canDeleteTheme === false`）。
- **`normalizePopupThemes`（主进程）**：**`[]` 或解析后无有效项** 时经 **`mergeSystemBuiltinPopupThemes`** 补回两条系统默认；非空列表缺任一条系统 id 时亦插入内置快照。

### 新建主题默认字号 + 时间层操作框贴字边

- **默认字号**：新建主题与内置默认主题 `contentFontSize: 180`、`timeFontSize: 100`（`addPopupTheme`、`getDefaultPopupThemes`）；预览/弹窗无字段时的回退与 `reminderWindow` legacy 一致改为 180/100。
- **时间层**：默认 `timeTransform` 不再带 `textBoxHeightPct`；预览里时间层 `height: auto` + `max-height`（有 `textBoxHeightPct` 时作上限）、`lineHeight: 1`，避免固定 `height: n%` 导致 Moveable 上下留白过大。真弹窗 `textBoxLayoutCss` 对 time/countdown：`height: auto; max-height: …%`。

### 结束 / 休息壁纸：编辑侧文案与默认参数统一

- **产品**：主题工坊内两种壁纸**同一套**编辑能力与默认排版/字号；区别仅为 `target`（子项关联结束弹窗 vs 休息弹窗）及顶栏切换。图层栏**文本**统一显示为「文本」（不再区分「文本层（提醒）」）；面板侧「主文案」类用语改为「文本」。
- **默认主题**：`getDefaultPopupThemes` 中休息默认与结束默认对齐同一套 `content*`/`time*` 字号与 transform（休息仍保留 `countdownTransform`）；**系统默认** `previewContentText` 为 **`BUILTIN_MAIN_POPUP_FALLBACK_BODY` / `BUILTIN_REST_POPUP_FALLBACK_BODY`**（「时间到！」/「休息一下」），与子项空文案时主进程兜底一致；**用户新建**主题 `addPopupTheme` 按 target 带相同两套兜底示例句之一。
- **代码**：`ThemePreviewEditor` 导出 `DEFAULT_LAYER_TRANSFORMS`，`DEFAULT_TRANSFORMS.main/rest` 指向同一引用；`getTransform` 回退不再依赖 `theme.target`。

### 主题工坊：缩略图可见但点击不进入编辑（本轮修复）

- **现象**：列表缩略图点击偶发无响应，未进入 `ThemeStudioFloatingEditor`。
- **处理**：`ThemeStudioListView` 的卡片外层由原生 `<button>` 改为 `div role="button"`，补齐 `tabIndex` + `Enter/Space` 键盘触发，规避缩略图内部复杂节点导致的点击事件兼容问题。
- **涉及文件**：`src/renderer/src/components/ThemeStudio.tsx`

### 主题工坊进入编辑时报 `Maximum update depth exceeded`（本轮修复）

- **报错点**：`ThemePreviewEditor.tsx`，`moveableTargets` 同步逻辑内的 `setMoveableTargets`（原 `useLayoutEffect`）。
- **原因**：在 layout 阶段反复触发目标同步，导致 commit-layout 周期内连续 `setState`，最终触发 React 嵌套更新上限。
- **处理**：将该段改为 `useEffect`，并增加“无选中元素时直接归零目标”的短路分支，避免 layout 阶段循环更新。
- **涉及文件**：`src/renderer/src/components/ThemePreviewEditor.tsx`

### 子项新建/编辑弹窗：新增文本层在小预览不可选中/变换（本轮修复）

- **现象**：在 `AddSubReminderModal` 的结束/休息预览里，新增文本层点击后无法进入选中态，不能拖拽/变换。
- **原因**：`ThemePreviewEditor` 的装饰层选中态依赖 `selectedDecorationLayerId/onSelectDecorationLayer`；子项小预览此前仅传了 `selectedElements/onSelectElements`，未接装饰层选中回调，导致点击文本装饰层后选中状态不生效。
- **处理**：为主/休息两个小预览分别新增装饰层选中 state，并透传给 `ThemePreviewEditor`；切换主题时同步清空对应选中态，避免旧层 id 残留。
- **涉及文件**：`src/renderer/src/components/AddSubReminderModal.tsx`

### 子项小预览：装饰文本编辑后点空白“回跳复位”（本轮修复）

- **现象**：新增文本层拖拽/编辑后，点空白触发 blur，文本会闪跳并回到旧位置。
- **原因**：装饰文本层 `onBlur` 仅回写 `text`，使用了旧 `theme` 快照生成 `layers` patch，可能覆盖刚写入的最新 transform。
- **处理**：在装饰文本 `onBlur` 提交时，同时从当前 DOM transform 解析并回写 `transform`（x/y/rotation/scale），确保 blur 提交不丢失位置。
- **涉及文件**：`src/renderer/src/components/ThemePreviewEditor.tsx`

### 子项小预览：拖拽/旋转/缩放结束后点空白仍复位（补充修复）

- **现象**：完成变换后即使视觉位置正确，点击空白后仍会回到旧位置。
- **原因**：Moveable 的 `*End` 回调在部分手势/浏览器时机下 `isDrag` 可能为 false，导致 `finalizeElement/finalizeScaleBakesFontSize/finalizeResize` 未执行，最终 transform 未持久化到 theme。
- **处理**：`onDragEnd/onRotateEnd/onScaleEnd/onDragGroupEnd/onRotateGroupEnd/onScaleGroupEnd/onResizeEnd` 统一改为无条件 finalize（目标存在即提交），不再依赖 `isDrag`。
- **涉及文件**：`src/renderer/src/components/ThemePreviewEditor.tsx`

### 子项编辑重进后主题下拉显示回默认（本轮修复）

- **现象**：子项已绑定 `main/rest` 非默认主题，更新后再次进入编辑，UI 显示却回到默认主题；但到点弹窗仍按已绑定主题触发。
- **根因**：
  1) `AddSubReminderModal` 的 hydrate effect 依赖只看 `sourceItem.id`，同一子项 id 下主题 id 变更不触发回填；
  2) 随后“兜底校验”effect 发现当前 state 不在 options 时会回退默认，覆盖了应显示的已绑定主题。
- **处理**：
  1) hydrate effect 依赖补全到 `sourceItem.mainPopupThemeId/restPopupThemeId` 及关键字段；
  2) 兜底校验 effect 在 `variant='edit'` 下优先对齐 `sourceItem` 已绑定主题，仅当源主题不存在时才回退默认。
- **涉及文件**：`src/renderer/src/components/AddSubReminderModal.tsx`

### 对齐能力扩展（本轮新增）

- **新增横向对齐**：在原 `left/center/right` 基础上补齐 `start/end/justify`（主题根字段、分层字段、编辑面板、预览、真实弹窗渲染全部打通）。
- **新增纵向对齐**：新增 `top/middle/bottom`（全局 + content/time/countdown 分层 + 装饰文本层），用于文本框内部竖向排版对齐。
- **数据模型**：
  - `PopupTheme`: `textVerticalAlign`、`content/time/countdownTextVerticalAlign`
  - `TextThemeLayer`: `textVerticalAlign`
- **渲染策略**：
  - 预览侧与主进程弹窗侧统一：文本层采用 `display:flex`，横向对齐继续用 `text-align/justify-content`，纵向对齐映射到 `justify-content`（多行）或 `align-items`（单行 time）。
  - `justify` 在单行层/短层下按左起（`flex-start`）处理，避免单行拉伸异常。
- **涉及文件**：
  - `src/shared/settings.ts`
  - `src/shared/popupThemeLayers.ts`
  - `src/main/settings.ts`
  - `src/main/reminderWindow.ts`
  - `src/renderer/src/components/ThemePreviewEditor.tsx`
  - `src/renderer/src/components/PopupThemeEditorPanel.tsx`

### 预览区框选上限修复（本轮新增）

- **现象**：主题编辑预览区框选时最多只能选中 2 个文本对象（仅 content/time）。
- **根因**：框选命中逻辑仅遍历 `textLayerPairs`（`content/time`），未纳入装饰文本层。
- **处理**：
  1) 框选命中增加装饰文本层（`kind='text' && !bindsReminderBody`）；
  2) 新增 `marqueeDecorationLayerIds`，用于承载框选到的多装饰层；
  3) Moveable 目标合并为「选中的绑定层 + 框选装饰层」，实现不限数量组选择/组拖拽；
  4) 单击切换到单选时会清空该框选缓存，避免状态残留。
- **涉及文件**：`src/renderer/src/components/ThemePreviewEditor.tsx`

### 预览区操作范围：去掉硬边界卡边（本轮新增）

- **需求**：移除拖拽/旋转/缩放时“贴边即卡住”的硬限制；保留吸附线；不新增“回画布”按钮。
- **处理**：`ThemePreviewEditor` 的 Moveable 配置移除 `bounds`（原 `previewMoveableBounds`），保留 `snappable/snapDirections/elementGuidelines/snapContainer`。
- **结果**：对象可越界操作，吸附线仍正常；交互不再被硬边界截断。
- **涉及文件**：`src/renderer/src/components/ThemePreviewEditor.tsx`

### 预览区“按下即拖”卡顿优化（本轮新增）

- **现象**：鼠标放到对象上按住拖动会“卡一下”，常常需要先点选一次再拖动；主题工坊与子项弹窗预览均存在。
- **根因**：拖拽启动被双 `requestAnimationFrame` 延后，且依赖后续 effect 同步 Moveable 目标，导致首次按下时机错过。
- **处理**：
  1) 文本层/装饰层 `onMouseDown` 改为“选中后立即 `scheduleDragStart`”，去掉双 rAF 延迟；
  2) 在选中切换时同步 `setMoveableTargets([当前目标])`，减少首次拖拽等待 Moveable 目标刷新的窗口。
- **结果**：按住对象可直接拖拽，减少“先点后拖”的顿挫。
- **涉及文件**：`src/renderer/src/components/ThemePreviewEditor.tsx`

### 预览区内联编辑与 Moveable 冲突（本轮修复）

- **现象**：双击进入主文案/装饰文本编辑后无法输入、再点无反应、编辑态下一拖整块移动；休息/结束/桌面 Tab 切换后偶发同类问题。
- **根因**：内联编辑时 Moveable 仍开启拖拽/旋转/等比缩放抢指针；双击第一下会 `scheduleDragStart` 误开拖拽；切换 `theme.target` / `theme.id` 后编辑态未清导致焦点挂在已卸载节点。
- **处理**：
  1) `editingTextKey` 或 `editingDecoLayerId` 非空时关闭 Moveable `draggable` / `rotatable` / `scalable`（保留 `resizable` 供拉栏宽）；
  2) 可内联编辑的绑定层：首次单击仅选中、不 `scheduleDragStart`，已是唯一选中同一层时再允许按下拖拽；
  3) 装饰文本层同样「首次选中不启拖、再次按下再启拖」；
  4) `useEffect([theme.target, theme.id])` 清空两处编辑态。
- **涉及文件**：`src/renderer/src/components/ThemePreviewEditor.tsx`

### 子项弹窗主题下拉与预览不一致（本轮修复）

- **根因**：`AddSubReminderModal` 中曾用 `useEffect` 在「当前选中的主题 id ≠ sourceItem 绑定 id」时强行写回 `sourceItem`，用户在下拉框里换休息/结束主题后立刻被覆盖，预览仍显示旧主题。
- **处理**：同一 effect 仅保留「当前 id 不在主题列表里则回退默认」；初始绑定仍由打开时的 hydrate effect 负责。
- **涉及文件**：`src/renderer/src/components/AddSubReminderModal.tsx`

### 主题工坊浮动编辑顶栏名称输入异常（本轮缓解）

- **现象**：新建/编辑时顶栏「主题名称」偶发点击无反应、输入延迟；可能与预览区控件层叠或焦点在 `surface` 上有关。
- **处理**：浮动卡片 `relative`；Tab 与名称行 `z-[60] isolate`，预览工作区 `z-0`；新建草稿名称框 `autoFocus`；`PopupThemeEditorPanel` 撤销快捷键与 `ThemePreviewEditor` 方向键/删层快捷键增加对 `document.activeElement` 是否在 `input/textarea/select/contenteditable` 的判断（与 `e.target` 双保险）。
- **涉及文件**：`ThemeStudio.tsx`、`PopupThemeEditorPanel.tsx`、`ThemePreviewEditor.tsx`

### 主题工坊列表缩略图拖拽（本轮）

- **需求**：缩略图勿拖出视口引发横向滚动条；拖拽时与子项类似的轻微放大、松手恢复；拖拽跟随勿被列表 `overflow` 裁切；去掉六点手柄，按住缩略图拖拽、点击进入编辑。
- **处理**：`@dnd-kit/modifiers` 的 `restrictToWindowEdges`；`DragOverlay` 内层无 ring 描边，仅与列表一致的 `border`；`scale` 过渡约 300ms、长尾缓出；**`dropAnimation={null}`**；`useSortable` **680ms · cubic-bezier(0.22,1,0.32,1)**，松手后占位卡 **opacity 0.6s** 淡入；列表内项拖拽中 `opacity: 0`；列表容器 `overflow-x-hidden`；`listeners`+`attributes` 仅绑缩略图，`PointerSensor` `distance: 8`。
- **依赖**：`@dnd-kit/modifiers@^9`
- **涉及文件**：`ThemeStudio.tsx`、`package.json`

---

## 12. 新会话开头可粘贴的交接提示

```
【WorkBreak — 新会话交接（package **0.0.17** · 图层 V1 已接主链路）】

请先读：
- AGENTS.md：**4.11–4.16**（含 4.15 图层 V1 规格、4.16 ThemeStudio 重构注意、4.12 休息结束倒计时与主弹窗图层说明）
- docs/POPUP_THEME_PLAN.md：**「图层对象管理 V1」** 整节 + §8 里程碑
- docs/SESSION_HANDOVER.md §1「图层 V1」与 §11
- .cursor/rules/theme-preview-editor.mdc（预览易错点）
- .cursor/rules/theme-studio-floating-editor.mdc（浮动编辑 / 勿留未定义变量）

当前仓库状态：
- **图层 V1 主链路已落地**：`popupThemeLayers` 迁移、`reminderWindow` 按 layers 渲染、休息 **`countdownStr`**、工坊 **图层栏** + **ThemePreviewEditor** 按 z 序与装饰 Moveable；**`npm run build`** 已通过（preload **`lib.entry`** 已补）

**下一步（建议）**：
1. 手测：主文案 / 时间 / 日期 / 装饰 / 休息主题倒计时在 **横排与竖排** 下的编辑、失焦 snap、Moveable 外框与 **真弹窗** 一致；`justify` 在竖排表现
2. 手测：**删除图层 → 保存 → 重启**，确认空栈与「+ 背景/遮罩」恢复；真弹窗主文案字号与工坊一致
3. 手测：图层顺序与真弹窗 z 序、休息弹窗倒计时绑定层、大图装饰临时目录加载
4. 核对 **子项小预览**（`AddSubReminderModal`）是否需传入图层栏相关 props（当前多为可选）
5. 更新 **POPUP_THEME_PLAN** 里程碑勾选；可选 **V1.5** 选中态浮动工具栏

图层 V1 产品结论（必须遵守）：
1. **文本层 / 时间层**：各层可 **增删**；**时间层** 至多 **1**；**主文案绑定** 文本层与根字段 **`content*`** 双向同步（`mergeContentThemePatchIntoBindingTextLayer` / `themePatchFromBindingTextLayer`）。**休息段最后几秒** 仍为固定黑底页，**不**在主题预览里叠倒计时层。
2. **文本层**（含绑定）合计上限 **`MAX_TEXT_LAYERS`（10）**；**图片** 最多 **5**；**遮罩、背景** 各最多 **1**
3. **隐藏** = 不绘制；**所有层都隐藏** → 弹窗 **纯黑背景 #000**
4. **图层顺序** = 真实弹窗 z 序；图层栏 **显示/隐藏 + 折叠 + 排序**；**不做**面板 Docking
5. **休息段最后几秒** 固定黑底倒计时页，**不**进主题图层
```
