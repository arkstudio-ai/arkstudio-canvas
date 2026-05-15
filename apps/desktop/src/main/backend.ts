// Backend lifecycle inside the Electron app.
//
// Two modes:
//   - dev:  the backend is NOT forked here. We expect the developer to run
//           `pnpm dev:backend` separately (or via concurrently from root).
//           Hot reload + nest's watch mode are way more pleasant than killing
//           and re-forking on every code change. We just wait until the dev
//           backend's /health endpoint answers, then resolve.
//   - prod: we `fork()` the bundled `dist/main.js` as a sub-process of the
//           Electron main process. We use `process.execPath` + the
//           `ELECTRON_RUN_AS_NODE=1` env trick so Electron's bundled Node
//           runtime executes our Nest entry — no system Node required for end
//           users. The child gets:
//             PORT             — dynamically allocated, see startBackend()
//             DATABASE_URL     — file: URL pointing at userData/db
//             ENCRYPTION_KEY   — minted/persisted by secrets.ts
//             STORAGE_LOCAL_DATA_DIR — userData/uploads (LocalStorageService reads this)
//             NODE_ENV         — production
//
// The child's stdout / stderr are piped into electron-log so a packaged user
// who hits a crash can grab `<userData>/logs/main.log` and send it back.

import { fork, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import log from 'electron-log/main';
import type { DesktopPaths } from './paths.js';

// Local re-implementation of `get-port`'s `portNumbers + getPort` flow. We had
// to drop the dep because get-port@7 is pure ESM and our main process is
// emitted as CommonJS (Electron's bundler doesn't ship a TS ESM loader by
// default and we don't want to introduce one for ~40 lines of logic).
async function pickFreePort(start: number, end: number): Promise<number> {
  for (let port = start; port <= end; port++) {
    if (await isPortFree(port)) return port;
  }
  throw new Error(`no free port in [${start}, ${end}]`);
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen({ port, host: '127.0.0.1' }, () => {
      server.close(() => resolve(true));
    });
  });
}

export interface BackendHandle {
  /** Base URL the renderer should hit, e.g. http://127.0.0.1:18512. */
  baseUrl: string;
  /** Stop the backend — call from app.on('before-quit'). Resolves once exited or after 5 s timeout. */
  stop: () => Promise<void>;
}

export interface StartBackendOptions {
  paths: DesktopPaths;
  encryptionKey: string;
  /** Dev mode skips the fork and just waits for an already-running backend. */
  devMode: boolean;
  /** Dev mode reads this from env / default 18500. Prod ignores it (we allocate dynamically). */
  devPort?: number;
}

export async function startBackend(opts: StartBackendOptions): Promise<BackendHandle> {
  if (opts.devMode) {
    const port = opts.devPort ?? 18500;
    const baseUrl = `http://127.0.0.1:${port}`;
    log.info(`[backend] dev mode: waiting for external backend at ${baseUrl}`);
    await waitForHealth(baseUrl, 30_000);
    return {
      baseUrl,
      // Dev backend is not ours to kill.
      stop: async () => { /* no-op */ },
    };
  }

  // ---------- prod path ----------
  const port = await pickFreePort(18500, 18599);
  const baseUrl = `http://127.0.0.1:${port}`;
  log.info(`[backend] prod mode: forking ${opts.paths.backendEntry} on port ${port}`);

  const child: ChildProcess = fork(opts.paths.backendEntry, [], {
    // ELECTRON_RUN_AS_NODE makes Electron's binary behave as `node` for this
    // child only — no extra runtime to ship.
    execPath: process.execPath,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      PORT: String(port),
      DATABASE_URL: opts.paths.dbFileUrl,
      ENCRYPTION_KEY: opts.encryptionKey,
      // LocalStorageService 读这个键 (不是 LOCAL_STORAGE_DIR) — 跟 docker-compose 保持一致.
      STORAGE_LOCAL_DATA_DIR: opts.paths.uploadsDir,
    },
    // Pipe so we can capture logs; 'ipc' is required for fork() but unused here.
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });

  child.stdout?.on('data', (chunk: Buffer) => {
    log.info('[backend:stdout]', chunk.toString().trimEnd());
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    log.warn('[backend:stderr]', chunk.toString().trimEnd());
  });

  child.on('exit', (code, signal) => {
    log.warn(`[backend] child exited code=${code} signal=${signal}`);
  });

  // Block until the backend reports healthy. If it never does we propagate the
  // error up so the main entry can show a graceful "backend failed to start"
  // dialog instead of a blank Electron window.
  try {
    await waitForHealth(baseUrl, 30_000);
  } catch (err) {
    child.kill('SIGTERM');
    throw err;
  }

  return {
    baseUrl,
    stop: () => stopGracefully(child, 5_000),
  };
}

function waitForHealth(baseUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise<void>((resolve, reject) => {
    const probe = () => {
      const req = http.get(`${baseUrl}/health`, { timeout: 2_000 }, (res) => {
        // /health currently returns whatever AppController#getHealth sends; any
        // 2xx counts as up. If we tighten the contract later (require JSON body)
        // we'll plumb a stricter check here.
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          res.resume();
          resolve();
          return;
        }
        res.resume();
        retry(`status ${res.statusCode}`);
      });
      req.on('timeout', () => {
        req.destroy();
        retry('timeout');
      });
      req.on('error', (err) => {
        retry(err.message);
      });
    };
    const retry = (reason: string) => {
      if (Date.now() >= deadline) {
        reject(new Error(`backend /health never responded (${reason})`));
        return;
      }
      setTimeout(probe, 500);
    };
    probe();
  });
}

function stopGracefully(child: ChildProcess, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    if (child.exitCode != null || child.killed) {
      resolve();
      return;
    }
    const fallback = setTimeout(() => {
      // Backend ignored SIGTERM (or got stuck mid-shutdown). Hard kill so
      // Electron can actually quit instead of hanging the dock icon.
      log.warn('[backend] SIGTERM timeout, sending SIGKILL');
      child.kill('SIGKILL');
      resolve();
    }, timeoutMs);
    child.once('exit', () => {
      clearTimeout(fallback);
      resolve();
    });
    child.kill('SIGTERM');
  });
}
