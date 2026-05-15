// Centralised file-system layout for the desktop build.
//
// Why a dedicated module: backend / window / lifecycle all need the same set of
// paths (userData root, db file, uploads dir, packaged backend entry). Having
// one source of truth avoids the classic Electron bug where one module computes
// `path.join(app.getPath('userData'), 'db')` and another forgets the trailing
// slash, and they end up reading/writing different directories on Windows.

import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

export interface DesktopPaths {
  /** Per-user data root, e.g. ~/Library/Application Support/Canvas Flow on macOS. */
  userData: string;
  /** SQLite file lives under userData/db so backups can grab the whole dir. */
  dbFile: string;
  /**
   * Prisma SQLite DATABASE_URL form of dbFile. Always forward-slashed —
   * Windows `file:C:\Users\...` historically tripped prisma's URL parser,
   * `file:C:/Users/...` is universally safe. Use this for any spawn that
   * needs DATABASE_URL.
   */
  dbFileUrl: string;
  /** Local uploads (images, videos) — same layout that `local-storage.service` uses. */
  uploadsDir: string;
  /** Persisted secrets file (ENCRYPTION_KEY etc.) so the backend keeps the same key across launches. */
  secretsFile: string;
  /** Backend bundle entry point inside the packaged app's resources. */
  backendEntry: string;
  /** Backend's prisma schema (used to bootstrap the DB on first launch). */
  backendSchema: string;
  /** Bundled prisma CLI entry (`prisma/build/index.js`). Run via ELECTRON_RUN_AS_NODE for `db push` at first launch. */
  prismaCli: string;
  /** Root of the bundled backend (cwd for the spawned db-push process so prisma can find @prisma/engines). */
  backendBundleDir: string;
  /** Compiled seed entry; spawned with `--if-empty` to seed default node definitions on a fresh install. */
  seedScript: string;
}

export function resolveDesktopPaths(): DesktopPaths {
  const userData = app.getPath('userData');
  const dbDir = path.join(userData, 'db');
  const uploadsDir = path.join(userData, 'uploads');

  // Ensure directories exist before any consumer (backend child process) tries
  // to write into them. SQLite will happily create the .db file but its parent
  // directory must exist; the local-storage service crashes if uploads is missing.
  for (const dir of [dbDir, uploadsDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Packaged layout: electron-builder copies our `extraResources` into
  // `<appRoot>/Contents/Resources/backend` (mac) or `<appRoot>/resources/backend`
  // (win/linux). `process.resourcesPath` points at that directory at runtime.
  // Dev builds never reach this code path — they use the spawn-from-source
  // strategy in backend.ts.
  const backendBundleDir = path.join(process.resourcesPath, 'backend');

  const dbFile = path.join(dbDir, 'canvas-flow.db');

  return {
    userData,
    dbFile,
    dbFileUrl: `file:${dbFile.replace(/\\/g, '/')}`,
    uploadsDir,
    secretsFile: path.join(userData, 'secrets.json'),
    backendEntry: path.join(backendBundleDir, 'dist', 'main.js'),
    backendSchema: path.join(backendBundleDir, 'prisma', 'schema.prisma'),
    prismaCli: path.join(backendBundleDir, 'node_modules', 'prisma', 'build', 'index.js'),
    backendBundleDir,
    seedScript: path.join(backendBundleDir, 'dist', 'prisma', 'seed-canvas-config.js'),
  };
}
