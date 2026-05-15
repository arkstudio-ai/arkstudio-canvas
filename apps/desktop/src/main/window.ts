// Single BrowserWindow factory.
//
// The renderer needs to know the backend URL before it issues its very first
// HTTP request — the canvas list, admin config, etc. all run during component
// mount. We solve that with a small handshake:
//   1. Main process passes backendBaseUrl into the BrowserWindow via the
//      `additionalArguments` flag, which the preload script reads.
//   2. Preload exposes `window.__BACKEND_BASE__` before any renderer JS runs.
//   3. apps/web/src/app/config/api.ts checks that field first and falls back
//      to the build-time `VITE_API_BASE_URL` only when undefined (web/docker
//      deployments).
//
// We deliberately keep `nodeIntegration: false` and `contextIsolation: true`.
// The backend already exposes everything the renderer needs over HTTP; there
// is no reason to widen the renderer's blast radius with raw Node access.

import { BrowserWindow, session, shell } from 'electron';
import path from 'node:path';
import log from 'electron-log/main';

export interface CreateWindowOptions {
  /** http URL the renderer should hit for backend calls. */
  backendBaseUrl: string;
  /** When set, BrowserWindow loads this URL (dev: vite dev server). */
  rendererUrl?: string;
  /** When set, BrowserWindow loads this file (prod: packaged web/dist/index.html). */
  rendererFile?: string;
}

// backend 返回的资源 URL 在数据库里是同源相对路径 (`/static/uploads/<key>`).
// 浏览器在 http 加载场景下解析到同一个 origin (vite dev / nginx 自部署)，
// 但 Electron 用 file:// 加载 index.html, 相对路径 resolve 到 file:// 根,
// `<img src="/static/uploads/...">` 全部 404 → 黑图.
//
// 改 ~10 个 <img>/<video>/<audio> 调用方一个个加前缀太碎易漏. 这里走网络
// 拦截: file:///static/uploads/<key> → http://127.0.0.1:<backend>/static/uploads/<key>.
// 渲染层代码不需要改, MediaNode / canvas 缩略图 / 模板封面 / 历史列表 /
// 剪贴板 / 各 dialog 全部一发命中.
//
// 安全考量: 只匹配 /static/uploads/ 前缀, 不会广撒网拦截渲染层自身的
// .js/.css/.png 资源 (vite 打包用 `./assets/...` 相对路径).
function installStaticUploadsRedirect(backendBaseUrl: string): void {
  session.defaultSession.webRequest.onBeforeRequest(
    // chrome match-pattern 要求 file scheme 的 host 部分用 * 通配
    { urls: ['file://*/static/uploads/*'] },
    (details, callback) => {
      try {
        const parsed = new URL(details.url);
        const redirectURL = `${backendBaseUrl}${parsed.pathname}${parsed.search}${parsed.hash}`;
        log.info('[window] redirect', details.url, '->', redirectURL);
        callback({ redirectURL });
      } catch (err) {
        log.warn('[window] redirect skipped, URL parse failed:', details.url, err);
        callback({});
      }
    },
  );
}

export function createMainWindow(opts: CreateWindowOptions): BrowserWindow {
  // 必须在 BrowserWindow 创建前注册 webRequest 监听, 否则首屏渲染的封面
  // 图可能跑在拦截器装好之前直接 404.
  installStaticUploadsRedirect(opts.backendBaseUrl);

  // Per-OS frame chrome:
  //   macOS: `hiddenInset` keeps the traffic-light buttons (red/yellow/green)
  //          but hides the rest of the title bar. The renderer paints its
  //          own title bar in the freed space, with a CSS `app-region: drag`
  //          zone matching the inset so users can still grab and drag the
  //          window from the top.
  //   Windows / Linux: `frame: false` removes the entire native frame; the
  //          renderer is fully responsible for drawing close/min/max
  //          controls. We additionally set `titleBarOverlay` on win32 so
  //          Windows' "snap layouts" hover-on-maximize hint still works
  //          against our painted minimise/maximise/close icons.
  const isMac = process.platform === 'darwin';
  const isWin = process.platform === 'win32';

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#0b0b10',
    show: false,
    titleBarStyle: isMac ? 'hiddenInset' : isWin ? 'hidden' : 'default',
    // Linux gets the system frame because there is no portable equivalent
    // of Windows' titleBarOverlay APIs and most distros expect their own
    // window manager controls anyway.
    frame: !isMac && !isWin,
    titleBarOverlay: isWin
      ? { color: '#0a0a0a', symbolColor: '#cbd0d8', height: 32 }
      : undefined,
    trafficLightPosition: isMac ? { x: 12, y: 11 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The preload script reads this from process.argv to know where the
      // backend lives. Keep the prefix unique so we don't collide with other
      // electron flags.
      additionalArguments: [
        `--backend-base-url=${opts.backendBaseUrl}`,
        // The renderer needs to know the OS without doing UA sniffing —
        // titlebar layout differs per platform (mac keeps traffic lights
        // on the left; win paints its own controls on the right).
        `--host-platform=${process.platform}`,
      ],
    },
  });

  // Don't paint a flash of black before the renderer is ready — show on
  // first-paint so the splash is just our own background colour.
  win.once('ready-to-show', () => {
    win.show();
  });

  // DevTools 调试快捷键 (即使 prod 打包后也保留).
  //   - macOS:  Cmd+Option+I
  //   - Win/Linux:  Ctrl+Shift+I
  //   - All:    F12
  // 用 before-input-event 而不是 globalShortcut: 后者是系统级, 没 focus
  // 时也会拦, 体验差; 前者只在 window focus 时生效.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = input.key.toLowerCase();
    const isMacChord = isMac && input.meta && input.alt && key === 'i';
    const isOtherChord = !isMac && input.control && input.shift && key === 'i';
    const isF12 = key === 'f12';
    if (isMacChord || isOtherChord || isF12) {
      win.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  // External links (e.g. AGPL repo URL on the admin page) should open in the
  // user's browser, NOT navigate the app window away from the canvas.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch((err) => {
      log.warn('[window] failed to open external url:', url, err);
    });
    return { action: 'deny' };
  });

  // will-navigate fires on full-page navigation (hash-only changes go through
  // did-navigate-in-page instead, and don't trip this hook). Two real triggers
  // in our app:
  //   1. <a href=...> link the user clicked.
  //   2. `window.location.href = url.toString()` patterns used to switch flowId
  //      (CanvasRailList) — same document, just a different search string.
  //
  // The original guard `if (rendererUrl && url.startsWith(rendererUrl))` was
  // broken for prod: in packaged mode `rendererUrl` is undefined (we use
  // loadFile), so EVERY navigation got routed to shell.openExternal, including
  // legitimate same-page query-string updates. Setting flowId would then open
  // the entire app in the system browser and freeze the rails.
  //
  // Correct test: compare against the currently-loaded document. Same protocol +
  // host + pathname means it's still "us", only the search/hash differs — let
  // the reload happen. Anything else (different origin, foreign file://, etc.)
  // gets forwarded to the OS browser as before.
  win.webContents.on('will-navigate', (event, url) => {
    try {
      const target = new URL(url);
      const current = new URL(win.webContents.getURL());
      if (
        target.protocol === current.protocol &&
        target.host === current.host &&
        target.pathname === current.pathname
      ) {
        return;
      }
    } catch {
      // Malformed URL — fall through and treat as external.
    }
    event.preventDefault();
    shell.openExternal(url).catch((err) => {
      log.warn('[window] failed to open external navigation url:', url, err);
    });
  });

  if (opts.rendererUrl) {
    log.info(`[window] loadURL ${opts.rendererUrl}`);
    void win.loadURL(opts.rendererUrl);
  } else if (opts.rendererFile) {
    log.info(`[window] loadFile ${opts.rendererFile}`);
    void win.loadFile(opts.rendererFile);
  } else {
    throw new Error('createMainWindow: either rendererUrl or rendererFile must be set');
  }

  return win;
}
