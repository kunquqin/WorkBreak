# 会话交接（v0.0.10u：子项内联主题编辑 + 小预览双击 + 分层字间距/行高）

> 下一段「粘贴用交接提示」见文末代码块。

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
  - **`usePopupThemeEditHistory`**：每次 **`onUpdateTheme`** 前 **`structuredClone`** 压栈（上限 80），**`replaceThemeFull`** 恢复整主题；**`PopupThemeEditorPanel`** 必传 **`replaceThemeFull`**（设置页 **`replacePopupTheme`**，子项内联 **`setThemeFullscreen` 整 draft**）。
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

- **版本**：`v0.0.10z-22`（主题撤销重做、方向键微调、分层描边/阴影 + 弹窗/预览一致）；**补充**：设置页 `scrollbar-gutter` + 工坊/列表主内容区盒模型对齐

---

## 12. 新会话开头可粘贴的交接提示

```
【WorkBreak — 新会话交接（v0.0.10z-22）】

请先读 AGENTS.md（重点 **4.11–4.14**，含 4.13 下「主文案栏宽 / 短层 / effectiveEditableKeys / 四角缩放」补充）与 docs/SESSION_HANDOVER.md、docs/POPUP_THEME_PLAN.md。主题预览易错点见 .cursor/rules/theme-preview-editor.mdc。

当前状态（本会话相关）：
- v0.0.10z-22：主题编辑 **撤销/重做**（`usePopupThemeEditHistory` + `replaceThemeFull`）；**方向键 1px** 微调选中层；**分层描边/阴影**（`PopupLayerTextEffects` + `popupTextEffects.ts`，弹窗 HTML 与预览一致）
- 设置页：`html` **scrollbar-gutter: stable**；**仅主题工坊**有外层白卡，提醒列表无外包大卡片；顶栏 tab 区 **w-full/min-w-0**；**工坊视图不展示**提醒列表页脚；已删列表底「弹窗主题」卡
- v0.0.10z-21：时间/倒计时固定高度 → overflow:hidden（弹窗+预览），去掉单行误显示滚动条
- v0.0.10z-20：`shortLayerTextBoxLockWidth`；时间/倒计时默认 max-content 贴字，`textBoxWidthPct` 作 max-width 上限；拉框后锁定定宽；reminderWindow 与 ThemePreviewEditor 一致
- v0.0.10z-18：四角等比缩放锚点为**所拖角的对角**；Ctrl=中心；`scaleDirectionForPinRef` + `fixedCornerFromScaleDirection`
- v0.0.10z-17：`effectiveEditableKeys` 勿依赖内联 `onLiveTextCommit`；`hasLiveTextCommit` + `editableKeysSig` + 模块常量数组
- v0.0.10z-16：主文案 60% 自动栏宽、`contentTextBoxUserSized`、失焦只增高；栏宽 cap 96%
- 更早：子项内联 Panel、fork/replace、预览比例 ResizeObserver 等见 SESSION_HANDOVER §1

关键约定：
- 子项保存主题：独占 replace，有他项引用且内容变 → fork + append + 改绑定 id
- setPopupThemes 只接收数组；合并用 setSettingsState
- 每完成功能必须更新 SESSION_HANDOVER.md

建议下一步：
1. 选中态浮动工具栏（颜色/字号快捷调节，见 POPUP_THEME_PLAN V1.5）
2. 子项小预览-only 场景是否也要撤销栈（当前仅完整 Panel 有历史）
```
