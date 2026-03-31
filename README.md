# 喵息（MeowBreak）

帮助打工人按时吃饭、起身活动和休息的桌面提醒应用。  
**中文名：喵息** · **英文名：MeowBreak**

> 说明：npm 包名、`app.setName`、用户数据目录等仍使用 `workbreak` 等技术标识，与已安装版本共用路径兼容；安装包与界面展示名为 **MeowBreak / 喵息**。

## 技术栈

- Electron + React 18 + TypeScript + Tailwind CSS
- Vite + vite-plugin-electron

## 开发

```bash
npm install
npm run dev
```

## 构建与运行

```bash
npm run build
npm run start
```

## Windows 安装包（electron-builder）

```bash
npm run build:win
```

产物默认输出到 `release/`（如 `MeowBreak-0.1.0-Setup.exe`、便携版等）。

## 若双击「启动开发环境.bat」被 Windows 拦截（拒绝访问）

Windows 可能因安全策略阻止运行该批处理文件（例如提示“无法打开这些文件”或“Internet 安全设置阻止”），可任选其一：

1. **解除封锁**：在资源管理器中右键 `启动开发环境.bat` → **属性** → 若底部有“安全”相关说明，勾选 **解除封锁** → 确定，再重新双击运行。
2. **改用命令行**：在项目根目录打开 CMD 或 PowerShell，执行：`npm run dev`。

## 文档

- **AGENTS.md**：产品说明、MVP 范围、目录结构及开发约定（面向 AI Agent 与开发者）
