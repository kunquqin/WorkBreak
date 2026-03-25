import { BrowserWindow, screen, app, type BrowserWindowConstructorOptions } from 'electron'
import { execFile, spawn } from 'node:child_process'
import { appendFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareThemeForDesktopWallpaper, writeDesktopWallpaperHtmlFiles } from './desktopWallpaper'
import { rebuildTrayMenu } from './tray'
import type { PopupTheme } from '../shared/settings'

let liveWallpaperWins: BrowserWindow[] = []
let stoppingWallpaper = false
let displayHooked = false
/** WorkerW 几何补同步：resize/move 长防抖，避免 Chromium 显示后错位盖住图标区；不设短防抖以免狂起 PowerShell */
let workerWResyncTimer: ReturnType<typeof setTimeout> | null = null
const WORKER_W_RESYNC_DEBOUNCE_MS = 550
/** 已成功挂到 WorkerW（图标下方壁纸层）；此时勿再用 Electron 按屏幕坐标 setBounds */
let liveWallpaperAttachedToWorkerW = false
/** 当前动态桌面使用的主题 id（用于 UI 切换「设为 / 关闭」） */
let activeDesktopLiveThemeId: string | null = null

/** 动态壁纸诊断：写入 userData/desktop-wallpaper.log，并 mirror 到 console（双击启动无控制台时请看此文件） */
function logDesktopWallpaper(message: string) {
  const line = `[${new Date().toISOString()}] ${message}`
  try {
    appendFileSync(join(app.getPath('userData'), 'desktop-wallpaper.log'), `${line}\n`, 'utf-8')
  } catch {
    /* 忽略 */
  }
  console.log(`[WorkBreak] ${line}`)
}

function readHwnd(win: BrowserWindow): number {
  const buf = win.getNativeWindowHandle()
  if (buf.length >= 8) return Number(buf.readBigUInt64LE(0))
  return buf.readUInt32LE(0)
}

/** 让主进程处理队列中的 IPC / Windows 消息，避免长时间连续 await 导致设置页 invoke 挂起 → 窗口「未响应」 */
function yieldMain(): Promise<void> {
  return new Promise((r) => setImmediate(r))
}

/** C# P/Invoke 类缓存为 DLL，避免每次 PowerShell 冷启动都 CSC 编译（此前 Attach+多次 Sync 可达数次 × 数秒） */
const WB_DESK_WALLPAPER_DLL_VER = 'v1'

function wbDeskWallpaperDllPath(): string {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, `wb-desk-wallpaper-${WB_DESK_WALLPAPER_DLL_VER}.dll`)
}

/** 与 PowerShell 中 `Screen.AllScreens | Sort Bounds.X, Bounds.Y` 一致，保证 HWND 与显示器一一对应 */
function sortedDisplaysForWallpaper(): Electron.Display[] {
  return [...screen.getAllDisplays()].sort((a, b) => {
    const dx = a.bounds.x - b.bounds.x
    if (dx !== 0) return dx
    return a.bounds.y - b.bounds.y
  })
}

/**
 * 独立 .ps1 + Node 异步 spawn；多显示器：HWND 须与 WinForms Screen.AllScreens 一致（与 sortedDisplaysForWallpaper 同序）。
 * WM_SPAWN_WORKER = 0x052C = 1324。
 */
const WALLPAPER_WIN32_PS1 = String.raw`param(
  [Parameter(Mandatory = $true)] [string] $ChildHwndsCsv,
  [Parameter(Mandatory = $true)] [ValidateSet('Attach','Sync','AttachAndSync')] [string] $Mode,
  [Parameter(Mandatory = $true)] [string] $WbDeskDll
)
$ErrorActionPreference = 'Stop'

try {
  Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
} catch {
  Write-Error "WinForms: $_"
  exit 1
}

$screens = @([System.Windows.Forms.Screen]::AllScreens | Sort-Object { $_.Bounds.X }, { $_.Bounds.Y })
$hwndList = @(
  foreach ($part in $ChildHwndsCsv.Split(',')) {
    $t = $part.Trim()
    if ($t -ne '') { [IntPtr][long]$t }
  }
)
if ($hwndList.Count -lt 1) {
  Write-Error "no child hwnds"
  exit 12
}
if ($hwndList.Count -ne $screens.Count) {
  Write-Error ("Attach/Sync: screen count {0} != hwnd count {1}" -f $screens.Count, $hwndList.Count)
  exit 35
}
foreach ($s in $screens) {
  if ($s.Bounds.Width -lt 1 -or $s.Bounds.Height -lt 1) {
    Write-Error "invalid screen bounds"
    exit 10
  }
}

$csharp = @'
using System;
using System.Runtime.InteropServices;
public class WbDesk {
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X, Y; }
  [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "FindWindowW")]
  public static extern IntPtr FindWindowW(string lpClassName, IntPtr lpWindowName);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "FindWindowExW")]
  public static extern IntPtr FindWindowExW(IntPtr hwndParent, IntPtr hwndChildAfter, string lpszClass, IntPtr lpszWindow);
  [DllImport("user32.dll")]
  public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam, uint fuFlags, uint uTimeout, ref IntPtr lpdwResult);
  [DllImport("user32.dll")]
  public static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);
  [DllImport("user32.dll")]
  public static extern bool ScreenToClient(IntPtr hWnd, ref POINT lpPoint);
  [DllImport("user32.dll")]
  public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll")]
  public static extern IntPtr GetParent(IntPtr hWnd);
  public const uint SWP_NOSIZE = 0x0001;
  public const uint SWP_NOMOVE = 0x0002;
  public const uint SWP_NOACTIVATE = 0x0010;
  public const uint SWP_SHOWWINDOW = 0x0040;
  public static IntPtr GetProgman() {
    IntPtr p = FindWindowW("Progman", IntPtr.Zero);
    if (p != IntPtr.Zero) return p;
    return FindWindowExW(IntPtr.Zero, IntPtr.Zero, "Progman", IntPtr.Zero);
  }
}
'@

$wbLoaded = $false
if (Test-Path $WbDeskDll) {
  try {
    Add-Type -Path $WbDeskDll -ErrorAction Stop
    $wbLoaded = $true
  } catch {
    try { Remove-Item $WbDeskDll -Force -ErrorAction SilentlyContinue } catch {}
  }
}
if (-not $wbLoaded) {
  try {
    $dllDir = Split-Path -Parent $WbDeskDll
    if ($dllDir -and -not (Test-Path $dllDir)) {
      New-Item -ItemType Directory -Path $dllDir -Force | Out-Null
    }
    Add-Type -TypeDefinition $csharp -OutputType Library -OutputAssembly $WbDeskDll -ErrorAction Stop
  } catch {
    try {
      Add-Type -TypeDefinition $csharp -ErrorAction Stop
    } catch {
      Write-Error "WbDesk: $_"
      exit 11
    }
  }
}

$HWND_TOP = [IntPtr]::Zero
$HWND_BOTTOM = [IntPtr]1
$WM_SPAWN_WORKER = [uint32]1324
$flMove = [uint32]([WbDesk]::SWP_NOACTIVATE -bor [WbDesk]::SWP_SHOWWINDOW)
$flZOnly = [uint32]([WbDesk]::SWP_NOSIZE -bor [WbDesk]::SWP_NOMOVE -bor [WbDesk]::SWP_NOACTIVATE)

function Get-FirstWallpaperWorkerW {
  param([IntPtr]$Progman)
  $w = [IntPtr]::Zero
  while ($true) {
    $w = [WbDesk]::FindWindowExW($Progman, $w, "WorkerW", [IntPtr]::Zero)
    if ($w -eq [IntPtr]::Zero) { break }
    $def = [WbDesk]::FindWindowExW($w, [IntPtr]::Zero, "SHELLDLL_DefView", [IntPtr]::Zero)
    if ($def -eq [IntPtr]::Zero) { return $w }
  }
  return [IntPtr]::Zero
}

if ($Mode -eq 'Sync') {
  for ($i = 0; $i -lt $hwndList.Count; $i++) {
    $hwndChild = $hwndList[$i]
    $b = $screens[$i].Bounds
    $par = [WbDesk]::GetParent($hwndChild)
    if ($par -eq [IntPtr]::Zero) {
      Write-Error ("Sync: no parent idx={0}" -f $i)
      exit 20
    }
    $pt = New-Object WbDesk+POINT
    $pt.X = [int]$b.Left
    $pt.Y = [int]$b.Top
    if (-not [WbDesk]::ScreenToClient($par, [ref]$pt)) {
      Write-Error ("Sync: ScreenToClient idx={0}" -f $i)
      exit 21
    }
    [void][WbDesk]::SetWindowPos($hwndChild, $HWND_TOP, $pt.X, $pt.Y, [int]$b.Width, [int]$b.Height, $flMove)
    [void][WbDesk]::SetWindowPos($hwndChild, $HWND_BOTTOM, 0, 0, 0, 0, $flZOnly)
  }
  Write-Output ("WB_SYNC_OK count={0}" -f $hwndList.Count)
  exit 0
}

$progman = [WbDesk]::GetProgman()
if ($progman -eq [IntPtr]::Zero) {
  Write-Error "Attach: no Progman"
  exit 30
}
$r = [IntPtr]::Zero
[void][WbDesk]::SendMessageTimeout($progman, $WM_SPAWN_WORKER, [IntPtr]::Zero, [IntPtr]::Zero, [uint32]0, [uint32]1000, [ref]$r)
Start-Sleep -Milliseconds 100
[void][WbDesk]::SendMessageTimeout($progman, $WM_SPAWN_WORKER, [IntPtr]13, [IntPtr]1, [uint32]0, [uint32]1000, [ref]$r)
Start-Sleep -Milliseconds 250

$target = Get-FirstWallpaperWorkerW -Progman $progman
if ($target -eq [IntPtr]::Zero) {
  $w = [IntPtr]::Zero
  while ($true) {
    $w = [WbDesk]::FindWindowExW($progman, $w, "WorkerW", [IntPtr]::Zero)
    if ($w -eq [IntPtr]::Zero) { break }
    $def = [WbDesk]::FindWindowExW($w, [IntPtr]::Zero, "SHELLDLL_DefView", [IntPtr]::Zero)
    if ($def -eq [IntPtr]::Zero) { $target = $w; break }
  }
}

if ($target -eq [IntPtr]::Zero) {
  $deskW = [IntPtr]::Zero
  $tw = [IntPtr]::Zero
  while ($true) {
    $tw = [WbDesk]::FindWindowExW([IntPtr]::Zero, $tw, "WorkerW", [IntPtr]::Zero)
    if ($tw -eq [IntPtr]::Zero) { break }
    $def = [WbDesk]::FindWindowExW($tw, [IntPtr]::Zero, "SHELLDLL_DefView", [IntPtr]::Zero)
    if ($def -ne [IntPtr]::Zero) { $deskW = $tw }
  }
  if ($deskW -ne [IntPtr]::Zero) {
    $next = [WbDesk]::FindWindowExW([IntPtr]::Zero, $deskW, "WorkerW", [IntPtr]::Zero)
    if ($next -ne [IntPtr]::Zero) {
      $d2 = [WbDesk]::FindWindowExW($next, [IntPtr]::Zero, "SHELLDLL_DefView", [IntPtr]::Zero)
      if ($d2 -eq [IntPtr]::Zero) { $target = $next }
    }
  }
}

if ($target -eq [IntPtr]::Zero) {
  Write-Error "Attach: no WorkerW"
  exit 31
}

for ($i = 0; $i -lt $hwndList.Count; $i++) {
  $hwndChild = $hwndList[$i]
  $b = $screens[$i].Bounds
  $primX = $b.Left
  $primY = $b.Top
  $primW = $b.Width
  $primH = $b.Height
  [void][WbDesk]::SetParent($hwndChild, $target)
  if ([WbDesk]::GetParent($hwndChild) -ne $target) {
    Write-Error ("Attach: SetParent failed idx={0}" -f $i)
    exit 32
  }
  $pt = New-Object WbDesk+POINT
  $pt.X = [int]$primX
  $pt.Y = [int]$primY
  if (-not [WbDesk]::ScreenToClient($target, [ref]$pt)) {
    Write-Error ("Attach: ScreenToClient idx={0}" -f $i)
    exit 33
  }
  [void][WbDesk]::SetWindowPos($hwndChild, $HWND_TOP, $pt.X, $pt.Y, [int]$primW, [int]$primH, $flMove)
  [void][WbDesk]::SetWindowPos($hwndChild, $HWND_BOTTOM, 0, 0, 0, 0, $flZOnly)
}
if ($Mode -eq 'AttachAndSync') {
  for ($i = 0; $i -lt $hwndList.Count; $i++) {
    $hwndChild = $hwndList[$i]
    $b = $screens[$i].Bounds
    $par = [WbDesk]::GetParent($hwndChild)
    if ($par -eq [IntPtr]::Zero) {
      Write-Error ("AttachAndSync: no parent idx={0}" -f $i)
      exit 34
    }
    $pt = New-Object WbDesk+POINT
    $pt.X = [int]$b.Left
    $pt.Y = [int]$b.Top
    if (-not [WbDesk]::ScreenToClient($par, [ref]$pt)) {
      Write-Error ("AttachAndSync: ScreenToClient idx={0}" -f $i)
      exit 36
    }
    [void][WbDesk]::SetWindowPos($hwndChild, $HWND_TOP, $pt.X, $pt.Y, [int]$b.Width, [int]$b.Height, $flMove)
    [void][WbDesk]::SetWindowPos($hwndChild, $HWND_BOTTOM, 0, 0, 0, 0, $flZOnly)
  }
  Write-Output ('WB_ATTACH_SYNC_OK target=' + $target.ToInt64() + ' count=' + $hwndList.Count)
  exit 0
}
Write-Output ('WB_OK multi target=' + $target.ToInt64() + ' count=' + $hwndList.Count)
exit 0
`

/** 异步 spawn，避免主进程在 PowerShell/CSC 期间整应用卡死（spawnSync 会阻塞所有 IPC） */
function runWallpaperWin32Script(
  mode: 'Attach' | 'Sync' | 'AttachAndSync',
  childHwnds: number[],
): Promise<{ ok: boolean; code: number | null; stdout: string; stderr: string; spawnErr?: string }> {
  const scriptPath = join(
    tmpdir(),
    `wb-wall-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}.ps1`,
  )
  writeFileSync(scriptPath, WALLPAPER_WIN32_PS1, 'utf-8')
  const timeoutMs = mode === 'Sync' ? 45_000 : 120_000
  return new Promise((resolve) => {
    let settled = false
    const finish = (out: {
      ok: boolean
      code: number | null
      stdout: string
      stderr: string
      spawnErr?: string
    }) => {
      if (settled) return
      settled = true
      try {
        unlinkSync(scriptPath)
      } catch {
        /* 忽略 */
      }
      resolve(out)
    }

    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-STA',
        '-File',
        scriptPath,
        '-ChildHwndsCsv',
        childHwnds.join(','),
        '-Mode',
        mode,
        '-WbDeskDll',
        wbDeskWallpaperDllPath(),
      ],
      { windowsHide: true },
    )
    let stdout = ''
    let stderr = ''
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk
      if (stdout.length > 9 * 1024 * 1024) child.kill()
    })
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk
      if (stderr.length > 9 * 1024 * 1024) child.kill()
    })
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* 忽略 */
      }
      finish({
        ok: false,
        code: null,
        stdout,
        stderr,
        spawnErr: `等待 PowerShell 超过 ${timeoutMs}ms`,
      })
    }, timeoutMs)
    child.on('error', (err) => {
      clearTimeout(timer)
      finish({ ok: false, code: null, stdout, stderr, spawnErr: err.message })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      finish({ ok: code === 0, code: code ?? -1, stdout, stderr })
    })
  })
}

/** 一次 PowerShell：附着 WorkerW + 首次几何同步（少一次冷启动，省数秒～十几秒） */
async function tryAttachWallpaperBehindDesktopIconsWin32(hwnds: number[]): Promise<boolean> {
  logDesktopWallpaper(
    `WorkerW 附着+同步(AttachAndSync) 开始 displays=${hwnds.length} childHwnds=${hwnds.join(',')}`,
  )
  const r = await runWallpaperWin32Script('AttachAndSync', hwnds)
  if (r.ok) {
    logDesktopWallpaper(`WorkerW 附着+同步成功 ${(r.stdout || '').trim() || '(stdout 空)'}`)
    return true
  }
  logDesktopWallpaper(
    `WorkerW 附着+同步失败 code=${String(r.code)} spawnErr=${r.spawnErr ?? ''} stdout=${r.stdout} stderr=${r.stderr}`,
  )
  return false
}

/** 回退：顶层窗口尽量置底（仍会盖住桌面图标）；异步避免 execFileSync 阻塞主进程 */
function sendWindowToBottomWin32(win: BrowserWindow): Promise<void> {
  if (process.platform !== 'win32') return Promise.resolve()
  const hwnd = readHwnd(win)
  const ps = `Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class Z {
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
}
'@
[void][Z]::SetWindowPos([IntPtr]${hwnd}, [IntPtr]1, 0, 0, 0, 0, 19)`
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps],
      { windowsHide: true, timeout: 12_000 },
      () => resolve(),
    )
  })
}

/** 所有 WorkerW 子窗口几何同步（顺序须与创建时 sortedDisplaysForWallpaper 一致） */
async function syncAllWallpaperToParentClientWin32(wins: BrowserWindow[]): Promise<boolean> {
  const alive = wins.filter((w) => !w.isDestroyed())
  if (alive.length === 0) return false
  const r = await runWallpaperWin32Script('Sync', alive.map(readHwnd))
  return r.ok
}

function scheduleWorkerWGeometryResyncDebounced() {
  if (!liveWallpaperAttachedToWorkerW || liveWallpaperWins.length === 0) return
  if (workerWResyncTimer) clearTimeout(workerWResyncTimer)
  workerWResyncTimer = setTimeout(() => {
    workerWResyncTimer = null
    const alive = liveWallpaperWins.filter((w) => !w.isDestroyed())
    if (alive.length > 0) void syncAllWallpaperToParentClientWin32(alive)
  }, WORKER_W_RESYNC_DEBOUNCE_MS)
}

function syncLiveWallpaperBounds() {
  const alive = liveWallpaperWins.filter((w) => !w.isDestroyed())
  if (alive.length === 0) return
  if (liveWallpaperAttachedToWorkerW) {
    void syncAllWallpaperToParentClientWin32(alive)
    return
  }
  const displays = sortedDisplaysForWallpaper()
  const n = Math.min(alive.length, displays.length)
  for (let i = 0; i < n; i++) {
    const b = displays[i].bounds
    alive[i].setBounds({
      x: Math.round(b.x),
      y: Math.round(b.y),
      width: Math.max(1, Math.round(b.width)),
      height: Math.max(1, Math.round(b.height)),
    })
  }
}

function ensureDisplayMetricsListener() {
  if (displayHooked) return
  displayHooked = true
  screen.on('display-metrics-changed', syncLiveWallpaperBounds)
}

export function isDesktopLiveWallpaperActive(): boolean {
  return liveWallpaperWins.some((w) => !w.isDestroyed())
}

export function getDesktopLiveWallpaperState(): { active: boolean; themeId: string | null } {
  const active = liveWallpaperWins.some((w) => !w.isDestroyed())
  return { active, themeId: active ? activeDesktopLiveThemeId : null }
}

/** 已在 WorkerW 上且屏数一致时，可只换 HTML + Sync，跳过销毁窗口与 AttachAndSync（换主题通常 <1s） */
function canHotReloadLiveWallpaper(): boolean {
  if (process.platform !== 'win32') return false
  if (!liveWallpaperAttachedToWorkerW) return false
  const alive = liveWallpaperWins.filter((w) => !w.isDestroyed())
  if (alive.length === 0) return false
  return alive.length === sortedDisplaysForWallpaper().length
}

async function hotReloadDesktopLiveWallpaper(
  themeRaw: PopupTheme,
): Promise<{ success: true } | { success: false; error: string }> {
  const wins = liveWallpaperWins.filter((w) => !w.isDestroyed())
  try {
    logDesktopWallpaper('动态壁纸：热更新（保留子窗口，仅换 HTML + 几何 Sync）')
    await yieldMain()
    const theme = prepareThemeForDesktopWallpaper(themeRaw)
    const { primaryPath, fallbackPath } = writeDesktopWallpaperHtmlFiles(theme)
    await yieldMain()
    await Promise.all(
      wins.map((win) => win.loadFile(primaryPath).catch(() => win.loadFile(fallbackPath))),
    )
    await yieldMain()
    const synced = await syncAllWallpaperToParentClientWin32(wins)
    if (!synced) {
      return { success: false, error: '热更新后几何同步失败' }
    }
    setTimeout(() => {
      const alive = liveWallpaperWins.filter((x) => !x.isDestroyed())
      if (alive.length > 0) void syncAllWallpaperToParentClientWin32(alive)
    }, 700)
    activeDesktopLiveThemeId = theme.id
    rebuildTrayMenu()
    return { success: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { success: false, error: msg || '热更新失败' }
  }
}

export function stopDesktopLiveWallpaper() {
  if (stoppingWallpaper) return
  stoppingWallpaper = true
  try {
    if (workerWResyncTimer) {
      clearTimeout(workerWResyncTimer)
      workerWResyncTimer = null
    }
    const copy = [...liveWallpaperWins]
    liveWallpaperWins = []
    for (const w of copy) {
      try {
        w.removeAllListeners('resize')
        w.removeAllListeners('move')
        w.removeAllListeners('closed')
        if (!w.isDestroyed()) w.destroy()
      } catch {
        /* 忽略 */
      }
    }
    liveWallpaperAttachedToWorkerW = false
    activeDesktopLiveThemeId = null
    rebuildTrayMenu()
  } finally {
    stoppingWallpaper = false
  }
}

/**
 * 每台显示器一个全屏 BrowserWindow（同主题 HTML），挂入 WorkerW；非 Windows 暂不支持。
 */
export async function startDesktopLiveWallpaper(
  themeRaw: PopupTheme,
): Promise<{ success: true } | { success: false; error: string }> {
  if (process.platform !== 'win32') {
    return {
      success: false,
      error: '动态桌面壁纸当前仅支持 Windows。',
    }
  }

  if (canHotReloadLiveWallpaper()) {
    const hot = await hotReloadDesktopLiveWallpaper(themeRaw)
    if (hot.success) return hot
    logDesktopWallpaper(`动态壁纸热更新失败: ${hot.error}，将完整重启`)
  }

  stopDesktopLiveWallpaper()
  liveWallpaperAttachedToWorkerW = false
  activeDesktopLiveThemeId = null
  await yieldMain()

  logDesktopWallpaper(`启动动态壁纸（诊断日志：${join(app.getPath('userData'), 'desktop-wallpaper.log')}）`)

  await yieldMain()
  const theme = prepareThemeForDesktopWallpaper(themeRaw)
  const { primaryPath, fallbackPath } = writeDesktopWallpaperHtmlFiles(theme)
  await yieldMain()
  const displays = sortedDisplaysForWallpaper()
  const wins: BrowserWindow[] = []

  const win32Edge: Pick<BrowserWindowConstructorOptions, 'thickFrame' | 'hasShadow'> =
    process.platform === 'win32' ? { thickFrame: false, hasShadow: false } : {}

  const createWin = (b: Electron.Rectangle) =>
    new BrowserWindow({
      x: Math.round(b.x),
      y: Math.round(b.y),
      width: Math.max(1, Math.round(b.width)),
      height: Math.max(1, Math.round(b.height)),
      frame: false,
      show: false,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      hasShadow: false,
      /** Win11 默认可圆角；铺满屏时四角会露系统桌面，动态壁纸需直角贴齐。 */
      roundedCorners: false,
      transparent: false,
      backgroundColor: '#000000',
      ...win32Edge,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        zoomFactor: 1,
      },
    })

  try {
    for (const d of displays) {
      const win = createWin(d.bounds)
      win.setMenuBarVisibility(false)
      wins.push(win)
      await yieldMain()
    }
    /** 多屏并行 loadFile，前后 yield，兼顾速度与 IPC 响应 */
    await Promise.all(
      wins.map((win) => win.loadFile(primaryPath).catch(() => win.loadFile(fallbackPath))),
    )
    await yieldMain()
    for (const w of wins) w.setIgnoreMouseEvents(true)
    await yieldMain()

    const hwnds = wins.map(readHwnd)
    let attached = await tryAttachWallpaperBehindDesktopIconsWin32(hwnds)
    if (!attached) {
      logDesktopWallpaper('WorkerW 首次附着失败，450ms 后重试一次')
      await new Promise((r) => setTimeout(r, 450))
      await yieldMain()
      attached = await tryAttachWallpaperBehindDesktopIconsWin32(hwnds)
    }
    await yieldMain()
    if (attached) {
      liveWallpaperAttachedToWorkerW = true
      logDesktopWallpaper('动态壁纸：WorkerW 多屏附着已判定成功（AttachAndSync 已含首次几何同步）')
    } else {
      liveWallpaperAttachedToWorkerW = false
      logDesktopWallpaper(
        '动态壁纸：WorkerW 附着失败，已退化为普通置底窗口（会挡住桌面图标）。详见 desktop-wallpaper.log',
      )
      console.warn(
        '[WorkBreak] 动态壁纸未能挂入桌面图标下层（WorkerW 附着失败），已退化为普通置底窗口，桌面图标可能被挡住。',
      )
      for (const w of wins) {
        await sendWindowToBottomWin32(w)
        await yieldMain()
      }
    }

    for (const w of wins) {
      w.on('closed', () => {
        if (!stoppingWallpaper) stopDesktopLiveWallpaper()
      })
      if (liveWallpaperAttachedToWorkerW) {
        w.on('resize', scheduleWorkerWGeometryResyncDebounced)
        w.on('move', scheduleWorkerWGeometryResyncDebounced)
      }
      w.showInactive()
    }
    await yieldMain()

    /** 显示后一次补同步即可（首次已在 AttachAndSync 内完成），减少 PowerShell 冷启动次数 */
    if (liveWallpaperAttachedToWorkerW) {
      setTimeout(() => {
        const alive = wins.filter((x) => !x.isDestroyed())
        if (alive.length > 0) void syncAllWallpaperToParentClientWin32(alive)
      }, 900)
    }

    liveWallpaperWins = wins
    ensureDisplayMetricsListener()
    activeDesktopLiveThemeId = theme.id
    rebuildTrayMenu()
    return { success: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    for (const w of wins) {
      try {
        if (!w.isDestroyed()) w.destroy()
      } catch {
        /* 忽略 */
      }
    }
    liveWallpaperWins = []
    activeDesktopLiveThemeId = null
    liveWallpaperAttachedToWorkerW = false
    rebuildTrayMenu()
    return { success: false, error: msg || '无法启动动态桌面壁纸' }
  }
}

export function registerDesktopLiveWallpaperQuitHook() {
  app.on('before-quit', () => {
    stopDesktopLiveWallpaper()
  })
}
