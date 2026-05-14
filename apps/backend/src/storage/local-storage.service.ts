import {
  Injectable,
  Logger,
  OnModuleInit,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs, createReadStream } from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { ReadStream } from 'fs';
import { PrismaService } from '../prisma/prisma.service';

const KEY_MAX_FILE_SIZE = 'storage.local.maxFileSize';
const KEY_DATA_DIR = 'storage.local.dataDir';

/** 100 MiB. Same default the old COS path had so existing UI numbers stay sensible. */
const DEFAULT_MAX_FILE_SIZE = 100 * 1024 * 1024;
/**
 * Default mount point inside the docker container. `deploy/docker-compose.yml`
 * declares a named volume bound here so files survive `docker compose down`.
 *
 * For dev runs (no docker), `STORAGE_LOCAL_DATA_DIR` env override or the DB
 * config row pick a writable path under the repo (see `resolveDataDir`).
 */
const DEFAULT_DATA_DIR = '/data/uploads';
/** URL prefix served by `StaticUploadsController`. Frontend templates these in directly. */
const PUBLIC_BASE_URL = '/static/uploads';

const CACHE_TTL_MS = 30_000;

interface CachedNumber {
  value: number;
  expiresAt: number;
}

interface CachedString {
  value: string;
  expiresAt: number;
}

export interface LocalStorageStats {
  dataDir: string;
  bytes: number;
  fileCount: number;
}

export interface LocalStorageView {
  /** Effective data directory (resolved from DB → env → default in that order). */
  dataDir: string;
  dataDirDefault: string;
  dataDirSource: 'db' | 'env' | 'default';
  /** Cached file count + total bytes; cheap-ish to compute, run on each GET. */
  stats: LocalStorageStats;
  /** Bytes. */
  maxFileSize: number;
  maxFileSizeDefault: number;
  maxFileSizeConfigured: boolean;
  publicBaseUrl: string;
}

export interface PutObjectArgs {
  key: string;
  buffer: Buffer;
  contentType: string;
}

export interface PutObjectResult {
  /** Relative URL the frontend can put straight into <img src> / <video src>. */
  accessUrl: string;
  bytes: number;
}

export interface ReadObjectResult {
  stream: ReadStream;
  bytes: number;
  contentType: string;
}

/**
 * Local-disk storage backend — single source of truth for everything the
 * open-source build persists permanently (uploaded reference assets,
 * mirrored generation results, history thumbnails).
 *
 * Why disk-only (no S3/COS abstraction)? See the D2 decision discussion:
 *
 *   - Tencent COS demanded paid cloud account + public domain just to run
 *     the canvas locally — antithetical to "open-source, zero-cost demo".
 *   - The same dev-then-Electron progression we expect future contributors
 *     to follow lands on `app.getPath('userData')`, which is also disk.
 *   - i2i / i2v reference upload to Aliyun is solved separately by the
 *     `DashscopeUploadService.stageLocalUrlsToTemp` helper in providers,
 *     so this service never has to know about cloud at all.
 *
 * Storage layout: `${dataDir}/${key}` where `key` is e.g.
 *   `uploads/2026-05-14/abc123-photo.png`
 *   `executions/2026-05-14/8a2b3c-d4e5.jpg`
 * The two-segment date prefix keeps any single directory under a few
 * thousand files even on heavy days, important for ext4/btrfs `readdir`.
 *
 * Public URLs are *relative* (`/static/uploads/...`). The accompanying
 * `StaticUploadsController` serves them; nginx in `deploy/nginx.conf`
 * proxies the path to backend so same-origin works without CORS.
 */
@Injectable()
export class LocalStorageService implements OnModuleInit {
  private readonly logger = new Logger(LocalStorageService.name);
  private dataDirCache: CachedString | null = null;
  private maxFileSizeCache: CachedNumber | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly nestConfig: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    // 启动时确保 data dir 存在 + 写权限可用，否则启动直接挂掉。
    // 比"第一次上传时报 EACCES"对运维友好得多——容器/挂载没配好的人
    // 看到 startup error 一眼就能定位。
    try {
      const dir = await this.getDataDir();
      await fs.mkdir(dir, { recursive: true });
      // 探测写权限（fs.access 在 ro 挂载上仍然返回成功，只能实写一次）
      const probe = path.join(dir, '.write-probe');
      await fs.writeFile(probe, '');
      await fs.unlink(probe).catch(() => undefined);
      this.logger.log(`[local-storage] data dir ready: ${dir}`);
    } catch (e) {
      this.logger.error(
        `[local-storage] data dir not writable: ${(e as Error).message}. ` +
          'Uploads / generation result mirroring will fail until fixed.',
      );
    }
  }

  // ---- runtime accessors ---------------------------------------------------

  /**
   * Resolve precedence: DB row → env → built-in default.
   *
   * Why DB wins: admin can switch dirs at runtime without redeploy.
   * Why env still matters: docker-compose injects `STORAGE_LOCAL_DATA_DIR=/data/uploads`
   * so a fresh `docker compose up` works before anyone visits /admin/system.
   */
  async getDataDir(): Promise<string> {
    const cached = this.readCachedString(this.dataDirCache);
    if (cached !== undefined) return cached;
    const dbRow = await this.prisma.globalConfig.findUnique({
      where: { key: KEY_DATA_DIR },
    });
    const fromDb = this.unwrapStringValue(dbRow?.value);
    const fromEnv = this.nestConfig.get<string>('STORAGE_LOCAL_DATA_DIR');
    const value = fromDb || fromEnv || DEFAULT_DATA_DIR;
    this.dataDirCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return value;
  }

  /**
   * Source classification — exposed in the admin view so operators can tell
   * "is this dir set in DB, env, or fallback?" at a glance.
   */
  async getDataDirSource(): Promise<'db' | 'env' | 'default'> {
    const dbRow = await this.prisma.globalConfig.findUnique({
      where: { key: KEY_DATA_DIR },
    });
    if (this.unwrapStringValue(dbRow?.value)) return 'db';
    if (this.nestConfig.get<string>('STORAGE_LOCAL_DATA_DIR')) return 'env';
    return 'default';
  }

  async getMaxFileSize(): Promise<number> {
    const cached = this.readCachedNumber(this.maxFileSizeCache);
    if (cached !== undefined) return cached;
    const row = await this.prisma.globalConfig.findUnique({
      where: { key: KEY_MAX_FILE_SIZE },
    });
    const v = this.unwrapNumberValue(row?.value);
    const value = v ?? DEFAULT_MAX_FILE_SIZE;
    this.maxFileSizeCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return value;
  }

  getPublicBaseUrl(): string {
    return PUBLIC_BASE_URL;
  }

  // ---- write path ----------------------------------------------------------

  /**
   * Persist a buffer under `${dataDir}/${key}` and return a relative
   * accessUrl the frontend can render directly.
   *
   * Throws BadRequestException for >maxFileSize (matches the old COS
   * path's behaviour so callers don't change error handling).
   */
  async putObject(args: PutObjectArgs): Promise<PutObjectResult> {
    const { key, buffer, contentType } = args;
    const max = await this.getMaxFileSize();
    if (buffer.byteLength > max) {
      throw new BadRequestException(
        `文件大小超出限制，最大允许 ${Math.floor(max / 1024 / 1024)}MB`,
      );
    }
    const safeKey = this.assertSafeKey(key);
    const dataDir = await this.getDataDir();
    const fullPath = path.join(dataDir, safeKey);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, buffer);
    const accessUrl = `${PUBLIC_BASE_URL}/${safeKey}`;
    this.logger.log(
      `[local-storage] put ${safeKey} (${buffer.byteLength}B, ${contentType})`,
    );
    return { accessUrl, bytes: buffer.byteLength };
  }

  // ---- read path -----------------------------------------------------------

  /**
   * Stream an object back by storage key. Returns null when the key
   * is missing so the controller can map to 404.
   *
   * `contentType` is best-effort inferred from the file extension since
   * we don't persist a side-car metadata file. Mismatched extensions get
   * `application/octet-stream` and the browser figures it out.
   */
  async readObject(key: string): Promise<ReadObjectResult | null> {
    const safeKey = this.assertSafeKey(key);
    const dataDir = await this.getDataDir();
    const fullPath = path.join(dataDir, safeKey);
    let stat;
    try {
      stat = await fs.stat(fullPath);
    } catch (e: any) {
      if (e?.code === 'ENOENT') return null;
      throw e;
    }
    if (!stat.isFile()) return null;
    return {
      stream: createReadStream(fullPath),
      bytes: stat.size,
      contentType: this.guessContentType(safeKey),
    };
  }

  /**
   * "Local URL" detector + resolver, used by the DashScope stage helper
   * to know "is this an upstream node's output that I need to ship to
   * dashscope-temp before the cloud model can read it?"
   *
   * Recognised local URL shapes:
   *   - `/static/uploads/<key>`                   (relative — most common)
   *   - `http://localhost:18500/static/uploads/<key>`  (absolute, dev mode)
   *   - `http://127.0.0.1:18500/static/uploads/<key>`  (absolute, dev mode)
   * Anything else (https public URL, oss://, dashscope-temp) is NOT local
   * and the caller should pass it straight through to the model.
   */
  isLocalUrl(url: string | null | undefined): boolean {
    if (!url) return false;
    if (url.startsWith(`${PUBLIC_BASE_URL}/`)) return true;
    try {
      const u = new URL(url);
      const isLoopback = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
      return isLoopback && u.pathname.startsWith(`${PUBLIC_BASE_URL}/`);
    } catch {
      return false;
    }
  }

  /**
   * Read a buffer back given a local URL (relative or absolute).
   * Returns null on miss so the stage helper can downgrade gracefully.
   */
  async readObjectByLocalUrl(
    url: string,
  ): Promise<{ buffer: Buffer; contentType: string; bytes: number } | null> {
    if (!this.isLocalUrl(url)) return null;
    let key: string;
    if (url.startsWith(`${PUBLIC_BASE_URL}/`)) {
      key = url.slice(PUBLIC_BASE_URL.length + 1);
    } else {
      try {
        const u = new URL(url);
        key = u.pathname.slice(PUBLIC_BASE_URL.length + 1);
      } catch {
        return null;
      }
    }
    const obj = await this.readObject(key);
    if (!obj) return null;
    const chunks: Buffer[] = [];
    for await (const chunk of obj.stream) {
      chunks.push(chunk as Buffer);
    }
    return {
      buffer: Buffer.concat(chunks),
      contentType: obj.contentType,
      bytes: obj.bytes,
    };
  }

  // ---- key derivation helpers (used by callers) ----------------------------

  /** `uploads/{YYYY-MM-DD}/{uuid}-{sanitized}` — for direct user uploads. */
  generateUploadKey(originalFileName: string): string {
    const dateStr = new Date().toISOString().split('T')[0];
    const uuid = uuidv4();
    return `uploads/${dateStr}/${uuid}-${this.sanitizeFileName(originalFileName)}`;
  }

  /** `executions/{YYYY-MM-DD}/{shortExec}-{uuid}.{ext}` — for transferred AI results. */
  generateExecutionKey(executionId: string, ext: string): string {
    const dateStr = new Date().toISOString().split('T')[0];
    const uuid = uuidv4().substring(0, 8);
    const shortExecId = executionId.substring(0, 8);
    return `executions/${dateStr}/${shortExecId}-${uuid}.${ext}`;
  }

  // ---- admin surface -------------------------------------------------------

  async getViewPayload(): Promise<LocalStorageView> {
    const [dataDir, source, max, stats] = await Promise.all([
      this.getDataDir(),
      this.getDataDirSource(),
      this.getMaxFileSize(),
      this.getStats(),
    ]);
    const maxRow = await this.prisma.globalConfig.findUnique({
      where: { key: KEY_MAX_FILE_SIZE },
    });
    return {
      dataDir,
      dataDirDefault: DEFAULT_DATA_DIR,
      dataDirSource: source,
      stats,
      maxFileSize: max,
      maxFileSizeDefault: DEFAULT_MAX_FILE_SIZE,
      maxFileSizeConfigured: maxRow !== null,
      publicBaseUrl: PUBLIC_BASE_URL,
    };
  }

  async updateSettings(input: {
    dataDir?: string;
    maxFileSize?: number;
  }): Promise<void> {
    if (input.dataDir !== undefined) {
      await this.upsertString(KEY_DATA_DIR, input.dataDir);
    }
    if (input.maxFileSize !== undefined) {
      await this.upsertNumber(KEY_MAX_FILE_SIZE, input.maxFileSize);
    }
    this.dataDirCache = null;
    this.maxFileSizeCache = null;
  }

  /**
   * Walk dataDir to compute total bytes + file count.
   * Run on every admin page-load; cap at ~100k files where the recursion
   * cost still stays under a few hundred ms. Beyond that operators can
   * `du -sh` from the host shell.
   */
  async getStats(): Promise<LocalStorageStats> {
    const dataDir = await this.getDataDir();
    let bytes = 0;
    let fileCount = 0;
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch (e: any) {
        if (e?.code === 'ENOENT') return;
        throw e;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile()) {
          try {
            const s = await fs.stat(full);
            bytes += s.size;
            fileCount += 1;
          } catch {
            // racy delete during walk; ignore.
          }
        }
      }
    };
    await walk(dataDir);
    return { dataDir, bytes, fileCount };
  }

  // ---- internals -----------------------------------------------------------

  /**
   * Reject `..`, absolute paths, and Windows drive letters. The
   * controller passes user-supplied path segments through here before
   * any disk access, so this is the only place path traversal is
   * defended against.
   */
  private assertSafeKey(key: string): string {
    if (!key || typeof key !== 'string') {
      throw new BadRequestException('storage key required');
    }
    const normalized = path.posix.normalize(key.replace(/\\/g, '/'));
    if (
      normalized.startsWith('/') ||
      normalized.startsWith('..') ||
      normalized.includes('/..') ||
      /^[a-z]:/i.test(normalized)
    ) {
      throw new BadRequestException(`invalid storage key: ${key}`);
    }
    return normalized;
  }

  private sanitizeFileName(fileName: string): string {
    const lastDotIndex = fileName.lastIndexOf('.');
    const ext = lastDotIndex > 0 ? fileName.slice(lastDotIndex) : '';
    const baseName =
      lastDotIndex > 0 ? fileName.slice(0, lastDotIndex) : fileName;
    if (/[^\x00-\x7F]/.test(baseName)) {
      return uuidv4().substring(0, 8) + ext.toLowerCase();
    }
    const sanitized = baseName
      .split('')
      .map((char) => (/[a-zA-Z0-9_\-]/.test(char) ? char : '_'))
      .join('');
    const truncated =
      sanitized.length > 50 ? sanitized.slice(0, 50) : sanitized;
    return truncated + ext.toLowerCase();
  }

  private guessContentType(key: string): string {
    const ext = path.extname(key).toLowerCase();
    const map: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.mov': 'video/quicktime',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.ogg': 'audio/ogg',
      '.flac': 'audio/flac',
      '.m4a': 'audio/mp4',
      '.json': 'application/json',
      '.txt': 'text/plain; charset=utf-8',
    };
    return map[ext] ?? 'application/octet-stream';
  }

  private async upsertString(key: string, raw: string): Promise<void> {
    const trimmed = raw.trim();
    if (trimmed === '') {
      await this.prisma.globalConfig.deleteMany({ where: { key } });
      return;
    }
    await this.prisma.globalConfig.upsert({
      where: { key },
      create: { key, value: trimmed, description: `${key} (admin-set)` },
      update: { value: trimmed },
    });
  }

  private async upsertNumber(key: string, raw: number): Promise<void> {
    if (!Number.isFinite(raw) || raw < 0) {
      await this.prisma.globalConfig.deleteMany({ where: { key } });
      return;
    }
    const clamped = Math.floor(raw);
    await this.prisma.globalConfig.upsert({
      where: { key },
      create: { key, value: clamped, description: `${key} (admin-set)` },
      update: { value: clamped },
    });
  }

  private readCachedNumber(slot: CachedNumber | null): number | undefined {
    if (!slot) return undefined;
    if (slot.expiresAt < Date.now()) return undefined;
    return slot.value;
  }

  private readCachedString(slot: CachedString | null): string | undefined {
    if (!slot) return undefined;
    if (slot.expiresAt < Date.now()) return undefined;
    return slot.value;
  }

  private unwrapStringValue(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && value !== null && 'value' in (value as any)) {
      const inner = (value as any).value;
      return typeof inner === 'string' ? inner : null;
    }
    return null;
  }

  private unwrapNumberValue(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    if (typeof value === 'object' && value !== null && 'value' in (value as any)) {
      return this.unwrapNumberValue((value as any).value);
    }
    return null;
  }
}
