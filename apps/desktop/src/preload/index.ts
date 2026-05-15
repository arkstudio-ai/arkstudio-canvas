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

import { contextBridge } from 'electron';

const BACKEND_FLAG = '--backend-base-url=';
const backendArg = process.argv.find((arg) => arg.startsWith(BACKEND_FLAG));
const backendBaseUrl = backendArg ? backendArg.slice(BACKEND_FLAG.length) : '';

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
  /** Electron / Chrome / Node versions for the admin "About" surface, if we want to expose it later. */
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
});
