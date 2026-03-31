# 喵息（MeowBreak）项目 — Git + GitHub 版本管理流程

## 一、一次性准备（本机 + GitHub）

### 1. 本机安装并配置 Git（若尚未做过）

- 下载安装：<https://git-scm.com/download/win>
- 配置用户名和邮箱（用于提交记录）：
  ```bash
  git config --global user.name "你的名字或昵称"
  git config --global user.email "你的邮箱（建议用 GitHub 账号邮箱）"
  ```

### 2. GitHub 账号与仓库

- 注册/登录：<https://github.com>
- 在 GitHub 网页上 **New repository** 新建一个空仓库（仓库名可与项目代号一致，例如 `WorkBreak`），**不要**勾选 “Add a README”等，保持空仓库。

---

## 二、在当前项目里启用 Git 并推到 GitHub

在项目根目录（`01_WorkBreak`）打开终端，按顺序执行：

```bash
# 1. 初始化为 Git 仓库
git init

# 2. 查看当前状态（应看到未跟踪的文件，且无 node_modules、out 等）
git status

# 3. 添加所有文件（.gitignore 会自动排除 node_modules、out 等）
git add .

# 4. 第一次提交
git commit -m "chore: 初始化喵息 MeowBreak 项目（Electron + React + TS + Tailwind）"

# 5. 把默认分支命名为 main（可选，GitHub 默认主分支名）
git branch -M main

# 6. 添加远程仓库（把 YOUR_USERNAME 和 YOUR_REPO 换成你的 GitHub 用户名和仓库名）
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git

# 7. 推送到 GitHub
git push -u origin main
```

若 GitHub 仓库是私有的，第 7 步会提示登录；可用浏览器登录或配置 Personal Access Token。

---

## 三、日常开发流程（推荐）

### 做功能 / 修 bug 时

```bash
# 1. 拉取最新（多人协作或换电脑时先做）
git pull

# 2. 改代码、保存……

# 3. 看改了哪些文件
git status
git diff

# 4. 只提交想提交的（或全部）
git add .                    # 全部
# 或
git add src/main/index.ts    # 只加某个文件

# 5. 提交到本地
git commit -m "feat: 简短描述你做了什么"

# 6. 推送到 GitHub
git push
```

### 提交信息建议（第一行简短说明）

- `feat: 新功能描述`
- `fix: 修复了某某问题`
- `chore: 配置/依赖/脚本等杂项`
- `docs: 只改文档`

---

## 四、发布版本（打 tag，如 v0.0.1）

当完成一个阶段（如「基础功能完成」）时，可以打一个**标签**，方便以后回看或发布。

**完整流程示例（以 v0.0.1 基础功能完成为例）：**

```bash
# 1. 确认当前没有未保存的修改，或先提交掉
git status

# 2. 如有新改动，先加入并提交
git add .
git commit -m "chore: v0.0.1 基础功能完成

- 吃饭/活动/休息提醒
- 系统托盘与设置页
- 设置持久化（开发环境项目根 workbreak-settings.json）
- 单实例锁、preload 手写 CommonJS"

# 3. 打标签（可选但推荐）
git tag -a v0.0.1 -m "v0.0.1 基础功能完成：提醒、托盘、设置、持久化"

# 4. 推送到远程（含标签）
git push
git push origin v0.0.1
```

**提交信息（commit message）建议：**

- 第一行：简短总结，如 `chore: v0.0.1 基础功能完成`
- 空一行后：可写几条要点（做了什么），便于以后看历史时一目了然

**标签信息（tag message）：** 用 `-m "..."` 写一句版本说明即可。

---

## 五、常用命令速查

| 操作           | 命令 |
|----------------|------|
| 查看状态       | `git status` |
| 查看提交历史   | `git log --oneline` |
| 拉取远程更新   | `git pull` |
| 推送到远程     | `git push` |
| 撤销未提交修改 | `git checkout -- 文件名` 或 `git restore 文件名` |
| 查看远程地址   | `git remote -v` |

---

## 六、说明

- 仓库里已包含 `.gitignore`，会忽略 `node_modules/`、`out/`、`workbreak-settings.json` 等，不会把这些提交上去。
- 第一次 `git push` 前，请把上面第 6 步里的 `YOUR_USERNAME/YOUR_REPO` 换成你在 GitHub 上创建的仓库地址。
