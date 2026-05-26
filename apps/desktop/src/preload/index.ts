// Preload — runs in an isolated world before the renderer's JS, with limited
// Node access (we keep contextIsolation on so we can't accidentally leak `fs`
// or `child_process` into the page).
//
// Single job for now: expose the backend base URL the main process passed in
// via `additionalArguments`. Without this the renderer can't know which port
// to talk to (we allocate dynamically in prod).
//
// Convention: future IPC channels go on `window.canvasDesktop`, e.g.
//   window.canvasDesktop.openLogsFolder()
//   window.canvasDesktop.versions
// We're keeping the surface tiny on purpose. Every method here is a permanent
// API contract the desktop renderer can depend on across versions.

import { contextBridge, ipcRenderer } from 'electron';

const readArg = (flag: string): string => {
  const found = process.argv.find((arg) => arg.startsWith(flag));
  return found ? found.slice(flag.length) : '';
};

const backendBaseUrl = readArg('--backend-base-url=');
const hostPlatform = readArg('--host-platform=') || process.platform;

if (!backendBaseUrl) {
  console.warn(
    '[preload] no --backend-base-url passed; renderer will fall back to VITE_API_BASE_URL',
  );
}

// Plain global is enough for the api.ts read site (`(window as any).__BACKEND_BASE__`).
// We use contextBridge so the value lives in the page's main world rather than
// only the isolated world.
contextBridge.exposeInMainWorld('__BACKEND_BASE__', backendBaseUrl);

contextBridge.exposeInMainWorld('canvasDesktop', {
  /** Backend base URL the main process resolved (dev: localhost:18500, prod: dynamic). */
  backendBaseUrl,
  /**
   * `process.platform` of the host (darwin / win32 / linux). Lets the renderer
   * pick the right titlebar layout without having to do UA sniffing — mac keeps
   * traffic-light buttons on the left, win paints its own controls on the right
   * via titleBarOverlay.
   */
  platform: hostPlatform,
  /** Electron / Chrome / Node versions for the admin "About" surface, if we want to expose it later. */
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  /**
   * Window control intents. Renderer's painted minimise/maximise/close icons
   * dispatch these; main listens via ipcMain.on('window:minimize') etc.
   * Implemented for win/linux (where there is no native titlebar). On mac
   * the renderer hides its painted controls and lets the OS traffic-light
   * buttons handle these intents directly.
   */
  windowControls: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximizeToggle: () => ipcRenderer.send('window:maximize-toggle'),
    close: () => ipcRenderer.send('window:close'),
  },
  /**
   * Desktop-level user settings (GPU acceleration etc) persisted across
   * app launches in a JSON file under userData. Most knobs require a
   * restart to apply because they affect Chromium command-line switches
   * that are only consumed at process start — renderer is responsible
   * for surfacing that.
   */
  desktopSettings: {
    get: (): Promise<{ gpuAcceleration: boolean }> =>
      ipcRenderer.invoke('desktop-settings:get'),
    set: (
      patch: Partial<{ gpuAcceleration: boolean }>,
    ): Promise<{ gpuAcceleration: boolean }> =>
      ipcRenderer.invoke('desktop-settings:set', patch),
  },
});
