import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { assertEncryptionKey, decrypt, encrypt, maskSecret } from '../common/crypto.util';

const KEY_BASE_URL = 'dashscope.baseUrl';
const KEY_API_KEY = 'dashscope.apiKey';
const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com';
const CACHE_TTL_MS = 30_000;

/**
 * Per-kind submit-timeout (seconds). These mirror the legacy hard-coded
 * values inside each provider; they're the "no admin override" fallback.
 *
 * Polling timeouts (image/video) are intentionally NOT exposed -- they're
 * fixed at 10s because polling is a cheap GET and a long-running poll is
 * a bug, not a tuning knob.
 */
export type DashscopeKind = 'chat' | 'image' | 'video' | 'audio';
export const DEFAULT_TIMEOUT_SEC: Record<DashscopeKind, number> = {
  chat: 60,
  image: 30,
  video: 30,
  audio: 120,
};
const TIMEOUT_KEY: Record<DashscopeKind, string> = {
  chat: 'dashscope.timeoutSec.chat',
  image: 'dashscope.timeoutSec.image',
  video: 'dashscope.timeoutSec.video',
  audio: 'dashscope.timeoutSec.audio',
};

interface CachedValue<T> {
  value: T;
  expiresAt: number;
}

/**
 * Single source of truth for the DashScope (Bailian) base URL + API key.
 *
 * Authoritative storage: `global_configs` rows
 *   - dashscope.baseUrl  : plain string
 *   - dashscope.apiKey   : aes-256-gcm ciphertext (see common/crypto.util)
 *
 * Why not keep the raw env path? The open-source build wants admins to
 * change credentials without restarting backend, so reading the DB is the
 * runtime path. The env vars only act as bootstrap material on the very
 * first boot (see `migrateFromEnv`); after that they are ignored.
 *
 * Reads use a tiny in-memory cache (30s) so the per-call MySQL hit doesn't
 * dominate provider latency. Writes invalidate the cache immediately so an
 * admin save takes effect without waiting for TTL.
 */
@Injectable()
export class DashscopeConfigService implements OnModuleInit {
  private readonly logger = new Logger(DashscopeConfigService.name);
  private baseUrlCache: CachedValue<string | null> | null = null;
  private apiKeyCache: CachedValue<string | null> | null = null;
  private timeoutCache: Record<DashscopeKind, CachedValue<number | null> | null> = {
    chat: null,
    image: null,
    video: null,
    audio: null,
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly nestConfig: ConfigService,
  ) {}

  /**
   * Boot:
   *   1. Crash early if ENCRYPTION_KEY is missing (otherwise every model
   *      call would fail later with a confusing decrypt error).
   *   2. Best-effort one-shot migration from env to DB so existing
   *      single-host deployments keep working after upgrade.
   */
  async onModuleInit(): Promise<void> {
    try {
      assertEncryptionKey();
    } catch (e) {
      this.logger.error(
        '[dashscope-config] ENCRYPTION_KEY missing/short — Provider 设置 will fail until fixed in apps/backend/.env',
      );
      return;
    }
    await this.migrateFromEnv();
  }

  // ---- runtime accessors used by providers ---------------------------------

  async getBaseUrl(): Promise<string> {
    const cached = this.readCached(this.baseUrlCache);
    if (cached !== undefined) return cached ?? DEFAULT_BASE_URL;

    const row = await this.prisma.globalConfig.findUnique({ where: { key: KEY_BASE_URL } });
    const value = (row?.value as { value?: string } | string | null) ?? null;
    const url = typeof value === 'string' ? value : value?.value ?? null;
    this.baseUrlCache = { value: url, expiresAt: Date.now() + CACHE_TTL_MS };
    return url ?? DEFAULT_BASE_URL;
  }

  async getApiKey(): Promise<string> {
    const cached = this.readCached(this.apiKeyCache);
    if (cached !== undefined) {
      if (!cached) throw new Error('DashScope apiKey 未配置；请在 /admin/config 填写');
      return cached;
    }

    const row = await this.prisma.globalConfig.findUnique({ where: { key: KEY_API_KEY } });
    const stored = this.unwrapStringValue(row?.value);
    let plain: string | null = null;
    if (stored) {
      try {
        plain = decrypt(stored);
      } catch (e) {
        this.logger.error('[dashscope-config] apiKey decrypt failed; treating as missing', e as Error);
        plain = null;
      }
    }
    this.apiKeyCache = { value: plain, expiresAt: Date.now() + CACHE_TTL_MS };
    if (!plain) throw new Error('DashScope apiKey 未配置；请在 /admin/config 填写');
    return plain;
  }

  /**
   * Per-kind submit timeout in milliseconds. Falls back to the legacy
   * hard-coded value when the admin hasn't configured one. Returned in
   * ms (not seconds) because that's what `axios.timeout` and friends
   * already expect, so callers don't need to multiply.
   */
  async getTimeoutMs(kind: DashscopeKind): Promise<number> {
    const cached = this.readCached(this.timeoutCache[kind]);
    if (cached !== undefined) {
      return (cached ?? DEFAULT_TIMEOUT_SEC[kind]) * 1000;
    }
    const row = await this.prisma.globalConfig.findUnique({ where: { key: TIMEOUT_KEY[kind] } });
    const value = this.unwrapNumberValue(row?.value);
    this.timeoutCache[kind] = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return (value ?? DEFAULT_TIMEOUT_SEC[kind]) * 1000;
  }

  // ---- admin surface used by the controller --------------------------------

  /**
   * View payload for the admin UI -- never returns the plaintext apiKey.
   * `apiKeyMask` is `null` when nothing is configured so the UI can render
   * a "未配置" hint. Each timeout entry carries `{value, default, configured}`
   * so the UI can render "DB" vs "默认" badges without a second round-trip.
   */
  async getViewPayload(): Promise<{
    baseUrl: string;
    baseUrlConfigured: boolean;
    apiKeyMask: string | null;
    apiKeyConfigured: boolean;
    timeouts: Record<DashscopeKind, { value: number; default: number; configured: boolean }>;
  }> {
    const baseUrlRow = await this.prisma.globalConfig.findUnique({ where: { key: KEY_BASE_URL } });
    const baseUrlValue = this.unwrapStringValue(baseUrlRow?.value);
    const apiKeyRow = await this.prisma.globalConfig.findUnique({ where: { key: KEY_API_KEY } });
    const apiKeyStored = this.unwrapStringValue(apiKeyRow?.value);
    let apiKeyPlain: string | null = null;
    if (apiKeyStored) {
      try {
        apiKeyPlain = decrypt(apiKeyStored);
      } catch {
        apiKeyPlain = null;
      }
    }

    const timeouts = {} as Record<DashscopeKind, { value: number; default: number; configured: boolean }>;
    for (const kind of Object.keys(TIMEOUT_KEY) as DashscopeKind[]) {
      const row = await this.prisma.globalConfig.findUnique({ where: { key: TIMEOUT_KEY[kind] } });
      const stored = this.unwrapNumberValue(row?.value);
      timeouts[kind] = {
        value: stored ?? DEFAULT_TIMEOUT_SEC[kind],
        default: DEFAULT_TIMEOUT_SEC[kind],
        configured: stored !== null,
      };
    }

    return {
      baseUrl: baseUrlValue ?? DEFAULT_BASE_URL,
      baseUrlConfigured: !!baseUrlValue,
      apiKeyMask: maskSecret(apiKeyPlain),
      apiKeyConfigured: !!apiKeyPlain,
      timeouts,
    };
  }

  /**
   * Apply a partial admin update.
   *
   * Semantics:
   *   - `undefined`       → field untouched
   *   - empty string `''` → clear the row (revert to DEFAULT_BASE_URL / no-key)
   *   - non-empty string  → upsert (apiKey gets encrypted before storage)
   *
   * Timeouts use the same "untouched/clear/set" pattern but with numbers:
   *   - `undefined`  → untouched
   *   - `0`          → clear (revert to DEFAULT_TIMEOUT_SEC[kind])
   *   - any positive → upsert; values >= 1 second are accepted, anything
   *     smaller is clamped to 1s to avoid pathological "fail immediately"
   *     misconfigurations.
   */
  async updateSettings(input: {
    baseUrl?: string;
    apiKey?: string;
    timeouts?: Partial<Record<DashscopeKind, number>>;
  }): Promise<void> {
    if (input.baseUrl !== undefined) {
      const trimmed = input.baseUrl.trim();
      if (trimmed === '') {
        await this.prisma.globalConfig.deleteMany({ where: { key: KEY_BASE_URL } });
      } else {
        await this.prisma.globalConfig.upsert({
          where: { key: KEY_BASE_URL },
          create: { key: KEY_BASE_URL, value: trimmed, description: 'DashScope base URL (admin-set)' },
          update: { value: trimmed },
        });
      }
      this.baseUrlCache = null;
    }

    if (input.apiKey !== undefined) {
      const trimmed = input.apiKey.trim();
      if (trimmed === '') {
        await this.prisma.globalConfig.deleteMany({ where: { key: KEY_API_KEY } });
      } else {
        const ciphertext = encrypt(trimmed);
        await this.prisma.globalConfig.upsert({
          where: { key: KEY_API_KEY },
          create: { key: KEY_API_KEY, value: ciphertext, description: 'DashScope API key (encrypted)' },
          update: { value: ciphertext },
        });
      }
      this.apiKeyCache = null;
    }

    if (input.timeouts) {
      for (const [k, raw] of Object.entries(input.timeouts) as [DashscopeKind, number | undefined][]) {
        if (raw === undefined) continue;
        const key = TIMEOUT_KEY[k];
        if (!key) continue;
        if (!Number.isFinite(raw) || raw <= 0) {
          await this.prisma.globalConfig.deleteMany({ where: { key } });
        } else {
          const clamped = Math.max(1, Math.floor(raw));
          await this.prisma.globalConfig.upsert({
            where: { key },
            create: {
              key,
              value: clamped,
              description: `DashScope ${k} submit timeout (seconds, admin-set)`,
            },
            update: { value: clamped },
          });
        }
        this.timeoutCache[k] = null;
      }
    }
  }

  // ---- internals -----------------------------------------------------------

  /**
   * Lazy migration: if the DB has no apiKey but `process.env.DASHSCOPE_API_KEY`
   * is set (and ENCRYPTION_KEY is valid), encrypt and store it once. Same
   * for baseUrl. Logs whether anything was moved so operators see the
   * boundary clearly.
   */
  private async migrateFromEnv(): Promise<void> {
    const baseUrlExists = await this.prisma.globalConfig.findUnique({ where: { key: KEY_BASE_URL } });
    if (!baseUrlExists) {
      const envBaseUrl = this.nestConfig.get<string>('DASHSCOPE_BASE_URL');
      if (envBaseUrl) {
        await this.prisma.globalConfig.create({
          data: {
            key: KEY_BASE_URL,
            value: envBaseUrl,
            description: 'DashScope base URL (migrated from env)',
          },
        });
        this.logger.log(`[dashscope-config] migrated DASHSCOPE_BASE_URL env → DB`);
      }
    }

    const apiKeyExists = await this.prisma.globalConfig.findUnique({ where: { key: KEY_API_KEY } });
    if (!apiKeyExists) {
      const envApiKey = this.nestConfig.get<string>('DASHSCOPE_API_KEY');
      if (envApiKey) {
        try {
          const ciphertext = encrypt(envApiKey);
          await this.prisma.globalConfig.create({
            data: {
              key: KEY_API_KEY,
              value: ciphertext,
              description: 'DashScope API key (encrypted, migrated from env)',
            },
          });
          this.logger.log(`[dashscope-config] migrated DASHSCOPE_API_KEY env → DB (encrypted)`);
        } catch (e) {
          this.logger.error('[dashscope-config] env → DB migration of apiKey failed', e as Error);
        }
      }
    }
  }

  private readCached<T>(slot: CachedValue<T> | null): T | undefined {
    if (!slot) return undefined;
    if (slot.expiresAt < Date.now()) return undefined;
    return slot.value;
  }

  /**
   * Prisma stores `Json` columns as either the literal value or the wrapped
   * object depending on history; this normaliser keeps both shapes working.
   */
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
