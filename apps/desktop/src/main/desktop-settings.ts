// Persistent user-tunable knobs that the **main process** needs to read
// BEFORE backend / renderer come up.
//
// Why a separate file (not a row in backend SQLite):
//   - Some switches must apply before `app.whenReady()` — most notably
//     `app.commandLine.appendSwitch('ignore-gpu-blocklist')` etc. That's
//     way before NestJS / Prisma / our IPC bridge exist; we need a sync
//     read at the top of main/index.ts.
//   - Storing as a one-line JSON in userData keeps it dead simple to debug
//     by hand (`cat ~/Library/Application\ Support/canvas-flow-desktop/desktop-settings.json`),
//     and survives backend / DB resets independently.
//
// Schema is intentionally tiny — only fields that MUST live here go here.
// Anything that can wait for backend to come up (e.g. admin-managed proxy)
// stays in the SQLite global_configs table where caching + admin endpoints
// already exist.

import fs from 'node:fs';
import path from 'node:path';
import log from 'electron-log/main';

export interface DesktopSettings {
  /**
   * Force-enable Chromium GPU rasterization. When true (default), main
   * appends `ignore-gpu-blocklist` + `enable-gpu-rasterization` +
   * `enable-zero-copy` command-line switches at boot. When false,
   * Chromium uses its own GPU blocklist and may fall back to software
   * rendering on some hardware — slower but more compatible.
   *
   * Changes require a full app restart since command-line switches are
   * evaluated once at process start.
   */
  gpuAcceleration: boolean;
}

const DEFAULTS: DesktopSettings = {
  gpuAcceleration: true,
};

/**
 * Resolve `<userData>/desktop-settings.json`. Called BEFORE `app.whenReady()`,
 * so we can't use `app.getPath('userData')` — instead derive from environment
 * variables the same way Electron does internally. Falls back to a "default
 * user data" guess if env vars are missing (only happens in test harnesses).
 */
function resolveSettingsPath(): string {
  // `app.getPath('userData')` would work here too IF this is called after
  // app module loaded but BEFORE app.whenReady. To keep this file
  // free of an `electron` import (lets it be unit-testable in plain Node)
  // we accept either form: explicit env override, or platform-specific
  // path derivation.
  const explicit = process.env.CANVAS_FLOW_USER_DATA;
  if (explicit) return path.join(explicit, 'desktop-settings.json');

  // Match Electron's default userData layout per-platform. App name
  // resolution happens via `app.getName()` at runtime; we cache the
  // hyphen-case form 'canvas-flow-desktop' because `app.getName()` would
  // require an `electron` import which we can't have at module-init time
  // before app boots fully.
  const appName = 'canvas-flow-desktop';
  if (process.platform === 'darwin') {
    return path.join(
      process.env.HOME ?? '',
      'Library',
      'Application Support',
      appName,
      'desktop-settings.json',
    );
  }
  if (process.platform === 'win32') {
    return path.join(
      process.env.APPDATA ?? '',
      appName,
      'desktop-settings.json',
    );
  }
  // linux + others
  return path.join(
    process.env.HOME ?? '',
    '.config',
    appName,
    'desktop-settings.json',
  );
}

export function loadDesktopSettings(): DesktopSettings {
  const file = resolveSettingsPath();
  try {
    if (!fs.existsSync(file)) {
      log.info(`[desktop-settings] no file at ${file}, using defaults`);
      return { ...DEFAULTS };
    }
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw) as Partial<DesktopSettings>;
    // Fill missing keys with defaults — keeps backward-compat as we add
    // new switches over time.
    const merged: DesktopSettings = { ...DEFAULTS, ...parsed };
    log.info(`[desktop-settings] loaded from ${file}: ${JSON.stringify(merged)}`);
    return merged;
  } catch (err) {
    log.warn(
      `[desktop-settings] failed to read ${file}, using defaults: ${(err as Error).message}`,
    );
    return { ...DEFAULTS };
  }
}

export function saveDesktopSettings(next: DesktopSettings): void {
  const file = resolveSettingsPath();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(next, null, 2), 'utf8');
    log.info(`[desktop-settings] saved to ${file}: ${JSON.stringify(next)}`);
  } catch (err) {
    log.error(
      `[desktop-settings] failed to save ${file}: ${(err as Error).message}`,
    );
    throw err;
  }
}
