// Electron main entry. Wiring order matters:
//   1. Set up logging early — anything that throws afterwards lands in
//      `<userData>/logs/main.log`, which is what we'll ask packaged users
//      for when they file an issue.
//   2. Wait for app.whenReady().
//   3. Mint / load secrets, resolve paths, start the backend (or wait on the
//      dev backend to come up).
//   4. Create the BrowserWindow with the resolved backend URL.
//   5. Register `before-quit` so the backend child gets a SIGTERM before
//      Electron tears down — otherwise the child can leak SQLite locks.

import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'node:path';
import log from 'electron-log/main';

import { resolveDesktopPaths } from './paths.js';
import { loadOrCreateSecrets } from './secrets.js';
import { startBackend, type BackendHandle } from './backend.js';
import { ensureSchema } from './bootstrap-db.js';
import { ensureSeed } from './bootstrap-seed.js';
import { createMainWindow } from './window.js';
import {
  type DesktopSettings,
  loadDesktopSettings,
  saveDesktopSettings,
} from './desktop-settings.js';

const isDev = process.env.NODE_ENV === 'development';
const DEV_RENDERER_URL = process.env.DESKTOP_DEV_RENDERER_URL ?? 'http://localhost:5173';
const DEV_BACKEND_PORT = Number(process.env.DESKTOP_DEV_BACKEND_PORT ?? 18500);

// 桌面端 settings 从 userData/desktop-settings.json 读 — 必须在 app ready
// 之前 (因为 GPU command-line switches 只在进程启动时被 Chromium 消费一次).
// settings 文件不存在时返回默认值 (gpuAcceleration: true).
const desktopSettings = loadDesktopSettings();

// 必须在 app ready 之前注册的 commandLine switches. 让 Chromium 尽可能跑
// 硬件加速 — Electron 内置的 Chromium 在某些显卡 / 驱动版本会被自己的
// GPU blocklist 回退到软件渲染, 画布拖动直接卡到不能用.
//
//   - ignore-gpu-blocklist:    跳过 Chromium 内置 driver/GPU blocklist,
//     允许在已知"有问题"的硬件上仍然尝试硬件加速 (开源 Electron 应用
//     常用配置, VS Code 等都打开).
//   - enable-gpu-rasterization: 把 canvas raster 也丢给 GPU, 不走 CPU.
//   - enable-zero-copy:         GPU 进程直接读 raster buffer, 减少
//     一次 IPC 拷贝, 滚动 / pan 体感更顺.
//
// 默认全开. 如果用户 admin 里关了 gpuAcceleration, 这三条都不会注册,
// Chromium 走自己默认的 GPU 检测 + 黑名单回退逻辑.
if (desktopSettings.gpuAcceleration) {
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  app.commandLine.appendSwitch('enable-zero-copy');
}

// Initialise electron-log: writes to `<userData>/logs/main.log` on all
// platforms by default. The renderer / preload have their own loggers but for
// the main process we just hook console too.
log.initialize();
log.transports.console.level = isDev ? 'debug' : 'info';
log.transports.file.level = 'info';
log.info(`[main] starting Canvas Flow desktop, dev=${isDev}, electron=${process.versions.electron}`);

let backend: BackendHandle | undefined;

// Painted-titlebar window controls. Renderer dispatches these from its
// minimise/maximise/close icons (win/linux only — mac uses native traffic
// lights). Registered once at module load so they survive across re-bootstrap
// (macOS dock-click reopen).
ipcMain.on('window:minimize', (e) => {
  BrowserWindow.fromWebContents(e.sender)?.minimize();
});
ipcMain.on('window:maximize-toggle', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w) return;
  if (w.isMaximized()) w.unmaximize();
  else w.maximize();
});
ipcMain.on('window:close', (e) => {
  BrowserWindow.fromWebContents(e.sender)?.close();
});

// Desktop settings (GPU acceleration etc) — admin reads + writes via
// preload bridge. set 后必须重启 app 才能让 commandLine switches 重新生效,
// renderer 自己负责 toast 提示 "重启生效".
ipcMain.handle('desktop-settings:get', () => desktopSettings);
ipcMain.handle(
  'desktop-settings:set',
  (_e, patch: Partial<DesktopSettings>) => {
    const next: DesktopSettings = { ...desktopSettings, ...patch };
    saveDesktopSettings(next);
    // 同步本进程缓存. 不影响已经 register 过的 commandLine switches.
    Object.assign(desktopSettings, next);
    return next;
  },
);

async function bootstrap() {
  await app.whenReady();

  const paths = resolveDesktopPaths();
  log.info(`[main] userData=${paths.userData}`);

  const secrets = loadOrCreateSecrets(paths.secretsFile);

  try {
    // Prod 模式: 先把 schema 推到 userData/db/canvas-flow.db（首次安装 / 升级
    // 跨 schema 版本时建表 / 加列），然后种子默认节点目录（仅当 node_definitions
    // 为空时；--if-empty 保护 admin 已编辑过的目录不被清掉）。
    // dev 模式假设开发者已经手动 db push + 必要 seed 过 apps/backend/prisma/dev.db。
    if (!isDev) {
      await ensureSchema({ paths });
      await ensureSeed({ paths });
    }

    backend = await startBackend({
      paths,
      encryptionKey: secrets.encryptionKey,
      devMode: isDev,
      devPort: DEV_BACKEND_PORT,
    });
  } catch (err) {
    // Show a real dialog so a packaged user isn't left staring at a hung dock
    // icon. Then exit — there's nothing useful we can render without backend.
    log.error('[main] backend failed to start:', err);
    dialog.showErrorBox(
      'Canvas Flow 启动失败',
      `后端服务未能启动:\n\n${(err as Error).message}\n\n日志位于 ${path.join(paths.userData, 'logs', 'main.log')}`,
    );
    app.exit(1);
    return;
  }

  log.info(`[main] backend ready at ${backend.baseUrl}`);

  const win = createMainWindow({
    backendBaseUrl: backend.baseUrl,
    rendererUrl: isDev ? DEV_RENDERER_URL : undefined,
    // Packaged renderer lives at <appRoot>/Contents/Resources/web/index.html
    // (mac) — same directory layout that electron-builder's `extraResources`
    // emits. Dev mode bypasses this entirely.
    rendererFile: isDev
      ? undefined
      : path.join(process.resourcesPath, 'web', 'index.html'),
  });

  // macOS dock click after all windows closed: re-create instead of exiting.
  // This is a hard requirement of the macOS HIG; without it App Store reviewers
  // (and any user with muscle memory) will think the app is broken.
  app.on('activate', () => {
    if (require('electron').BrowserWindow.getAllWindows().length === 0) {
      void bootstrap();
    }
  });

  // Prevent the app from quitting when the last window closes on Linux/Win,
  // matching the macOS convention of "menubar app stays alive". Users always
  // have Cmd+Q / File > Quit if they really want out, which fires before-quit
  // and tears down the backend.
  win.on('closed', () => { /* default behaviour: quit on platforms != darwin */ });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async (event) => {
  if (!backend) return;
  // We need to await the backend stop, but Electron's quit event is sync.
  // Pattern: prevent the first quit, await our cleanup, then trigger again.
  if ((app as unknown as { _quitInitiated?: boolean })._quitInitiated) return;
  event.preventDefault();
  (app as unknown as { _quitInitiated?: boolean })._quitInitiated = true;
  log.info('[main] before-quit: stopping backend');
  try {
    await backend.stop();
  } catch (err) {
    log.warn('[main] backend stop errored:', err);
  }
  app.quit();
});

bootstrap().catch((err) => {
  log.error('[main] bootstrap unhandled error:', err);
  app.exit(1);
});
