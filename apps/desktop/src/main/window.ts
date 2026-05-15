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

import { BrowserWindow, shell } from 'electron';
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

export function createMainWindow(opts: CreateWindowOptions): BrowserWindow {
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

  // External links (e.g. AGPL repo URL on the admin page) should open in the
  // user's browser, NOT navigate the app window away from the canvas.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch((err) => {
      log.warn('[window] failed to open external url:', url, err);
    });
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (opts.rendererUrl && url.startsWith(opts.rendererUrl)) return;
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
