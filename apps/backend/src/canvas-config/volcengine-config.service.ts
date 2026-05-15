import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertEncryptionKey,
  decrypt,
  encrypt,
  maskSecret,
} from '../common/crypto.util';

/**
 * Single source of truth for the Volcengine (Doubao / Seedance / 火山方舟)
 * base URL + API key.
 *
 * Why "Volcengine" not "Doubao": the same baseUrl + key serves multiple
 * model families (Seedance 2.0 video, Doubao chat, …). We keep one config
 * row for the vendor and let provider implementations pick endpoints off it.
 *
 * Authoritative storage: `global_configs` rows
 *   - volcengine.baseUrl          : plain string (default: 第三方代理)
 *   - volcengine.apiKey           : aes-256-gcm ciphertext
 *   - volcengine.defaultModel     : plain string, optional default model ID
 *                                   (admin can preset `doubao-seedance-2-0-260128`
 *                                   so frontend node config can leave model empty)
 *   - volcengine.timeoutSec.video : integer seconds, optional
 *
 * Why default to the 第三方代理 (`http://123.57.80.82/seedance`)? Phase-1 uses
 * the proxy; the path layout for both `/contents/generations/tasks` (video)
 * and `/open/CreateAsset` (asset library) is identical to the volc official
 * 邀测版本, so admin can flip baseUrl to `https://ark.cn-beijing.volces.com/api/v3`
 * with zero code changes once they obtain official credentials.
 *
 * Cache TTL: 30s, same as DashscopeConfigService — keeps provider hot-path
 * fast without making admin updates feel sticky.
 */

const KEY_BASE_URL = 'volcengine.baseUrl';
const KEY_API_KEY = 'volcengine.apiKey';
const KEY_DEFAULT_MODEL = 'volcengine.defaultModel';
const KEY_TIMEOUT_VIDEO = 'volcengine.timeoutSec.video';

// 默认指向第三方代理；admin 可改为 https://ark.cn-beijing.volces.com/api/v3 切官方
const DEFAULT_BASE_URL = 'http://123.57.80.82/seedance';
const DEFAULT_TIMEOUT_VIDEO_SEC = 30;
const CACHE_TTL_MS = 30_000;

interface CachedValue<T> {
  value: T;
  expiresAt: number;
}

@Injectable()
export class VolcengineConfigService implements OnModuleInit {
  private readonly logger = new Logger(VolcengineConfigService.name);
  private baseUrlCache: CachedValue<string | null> | null = null;
  private apiKeyCache: CachedValue<string | null> | null = null;
  private defaultModelCache: CachedValue<string | null> | null = null;
  private timeoutVideoCache: CachedValue<number | null> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly nestConfig: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      assertEncryptionKey();
    } catch {
      this.logger.error(
        '[volcengine-config] ENCRYPTION_KEY missing/short — Volcengine 设置 will fail until fixed in apps/backend/.env',
      );
      return;
    }
    await this.migrateFromEnv();
  }

  // ---- runtime accessors used by providers --------------------------------

  async getBaseUrl(): Promise<string> {
    const cached = this.readCached(this.baseUrlCache);
    if (cached !== undefined) return cached ?? DEFAULT_BASE_URL;
    const row = await this.prisma.globalConfig.findUnique({
      where: { key: KEY_BASE_URL },
    });
    const url = this.unwrapStringValue(row?.value);
    this.baseUrlCache = { value: url, expiresAt: Date.now() + CACHE_TTL_MS };
    return url ?? DEFAULT_BASE_URL;
  }

  async getApiKey(): Promise<string> {
    const cached = this.readCached(this.apiKeyCache);
    if (cached !== undefined) {
      if (!cached)
        throw new Error('Volcengine apiKey 未配置；请在 /admin/config 填写');
      return cached;
    }
    const row = await this.prisma.globalConfig.findUnique({
      where: { key: KEY_API_KEY },
    });
    const stored = this.unwrapStringValue(row?.value);
    let plain: string | null = null;
    if (stored) {
      try {
        plain = decrypt(stored);
      } catch (e) {
        this.logger.error(
          '[volcengine-config] apiKey decrypt failed; treating as missing',
          e as Error,
        );
        plain = null;
      }
    }
    this.apiKeyCache = { value: plain, expiresAt: Date.now() + CACHE_TTL_MS };
    if (!plain)
      throw new Error('Volcengine apiKey 未配置；请在 /admin/config 填写');
    return plain;
  }

  /**
   * Optional default model ID. Returns null when not configured — callers
   * should fall back to whatever the frontend SKU resolved to. Lets admin
   * set up a "house" model so node configs that leave model empty still
   * work (e.g. preset `doubao-seedance-2-0-260128`).
   */
  async getDefaultModel(): Promise<string | null> {
    const cached = this.readCached(this.defaultModelCache);
    if (cached !== undefined) return cached;
    const row = await this.prisma.globalConfig.findUnique({
      where: { key: KEY_DEFAULT_MODEL },
    });
    const value = this.unwrapStringValue(row?.value);
    this.defaultModelCache = {
      value,
      expiresAt: Date.now() + CACHE_TTL_MS,
    };
    return value;
  }

  async getVideoTimeoutMs(): Promise<number> {
    const cached = this.readCached(this.timeoutVideoCache);
    if (cached !== undefined) {
      return (cached ?? DEFAULT_TIMEOUT_VIDEO_SEC) * 1000;
    }
    const row = await this.prisma.globalConfig.findUnique({
      where: { key: KEY_TIMEOUT_VIDEO },
    });
    const value = this.unwrapNumberValue(row?.value);
    this.timeoutVideoCache = {
      value,
      expiresAt: Date.now() + CACHE_TTL_MS,
    };
    return (value ?? DEFAULT_TIMEOUT_VIDEO_SEC) * 1000;
  }

  // ---- admin surface ------------------------------------------------------

  /**
   * View payload for the admin UI. Shape matches DashscopeConfigService /
   * OpenaiCompatConfigService (Record<chat|image|video|audio, …> timeouts)
   * so the admin <ProvidersSection /> can render Volcengine through the
   * exact same PROVIDER_CARDS component path. Only the `video` slot is
   * actually persisted today — the other three return the default and
   * `configured: false` as future-compatible stubs.
   *
   * `defaultModel` is Volcengine-specific. The shared card UI doesn't
   * render it today (it'll surface via a follow-up). Still returned here
   * so curl-driven admins can read/write it.
   */
  async getViewPayload(): Promise<{
    baseUrl: string;
    baseUrlConfigured: boolean;
    apiKeyMask: string | null;
    apiKeyConfigured: boolean;
    defaultModel: string | null;
    timeouts: Record<
      'chat' | 'image' | 'video' | 'audio',
      { value: number; default: number; configured: boolean }
    >;
  }> {
    const baseUrlRow = await this.prisma.globalConfig.findUnique({
      where: { key: KEY_BASE_URL },
    });
    const baseUrlValue = this.unwrapStringValue(baseUrlRow?.value);

    const apiKeyRow = await this.prisma.globalConfig.findUnique({
      where: { key: KEY_API_KEY },
    });
    const apiKeyStored = this.unwrapStringValue(apiKeyRow?.value);
    let apiKeyPlain: string | null = null;
    if (apiKeyStored) {
      try {
        apiKeyPlain = decrypt(apiKeyStored);
      } catch {
        apiKeyPlain = null;
      }
    }

    const defaultModelRow = await this.prisma.globalConfig.findUnique({
      where: { key: KEY_DEFAULT_MODEL },
    });
    const defaultModel = this.unwrapStringValue(defaultModelRow?.value);

    const timeoutRow = await this.prisma.globalConfig.findUnique({
      where: { key: KEY_TIMEOUT_VIDEO },
    });
    const timeoutStored = this.unwrapNumberValue(timeoutRow?.value);

    const videoSlot = {
      value: timeoutStored ?? DEFAULT_TIMEOUT_VIDEO_SEC,
      default: DEFAULT_TIMEOUT_VIDEO_SEC,
      configured: timeoutStored !== null,
    };
    // chat/image/audio 暂未接入对应 Volcengine provider, 用 video 同款默认值,
    // configured 永远 false. 这样 admin UI 渲染时显示"默认 30s"且无"已配置"
    // 标记, 不会误导以为 chat 有效。
    const stub = {
      value: DEFAULT_TIMEOUT_VIDEO_SEC,
      default: DEFAULT_TIMEOUT_VIDEO_SEC,
      configured: false,
    };

    return {
      baseUrl: baseUrlValue ?? DEFAULT_BASE_URL,
      baseUrlConfigured: !!baseUrlValue,
      apiKeyMask: maskSecret(apiKeyPlain),
      apiKeyConfigured: !!apiKeyPlain,
      defaultModel,
      timeouts: {
        chat: stub,
        image: stub,
        video: videoSlot,
        audio: stub,
      },
    };
  }

  /**
   * Partial admin update.
   * Semantics match DashscopeConfigService:
   *   undefined → untouched   empty string '' → clear (revert to default)
   *   string → upsert (apiKey gets encrypted before storage)
   *   timeout 0/non-positive → clear
   */
  async updateSettings(input: {
    baseUrl?: string;
    apiKey?: string;
    defaultModel?: string;
    /**
     * Same 4-kind shape as DashscopeConfigService for shared-UI compat.
     * Only `video` is persisted today; chat/image/audio are silently ignored
     * until a corresponding Volcengine provider lands.
     */
    timeouts?: Partial<
      Record<'chat' | 'image' | 'video' | 'audio', number>
    >;
  }): Promise<void> {
    if (input.baseUrl !== undefined) {
      const trimmed = input.baseUrl.trim();
      if (trimmed === '') {
        await this.prisma.globalConfig.deleteMany({
          where: { key: KEY_BASE_URL },
        });
      } else {
        await this.prisma.globalConfig.upsert({
          where: { key: KEY_BASE_URL },
          create: {
            key: KEY_BASE_URL,
            value: trimmed,
            description: 'Volcengine base URL (admin-set)',
          },
          update: { value: trimmed },
        });
      }
      this.baseUrlCache = null;
    }

    if (input.apiKey !== undefined) {
      const trimmed = input.apiKey.trim();
      if (trimmed === '') {
        await this.prisma.globalConfig.deleteMany({
          where: { key: KEY_API_KEY },
        });
      } else {
        const ciphertext = encrypt(trimmed);
        await this.prisma.globalConfig.upsert({
          where: { key: KEY_API_KEY },
          create: {
            key: KEY_API_KEY,
            value: ciphertext,
            description: 'Volcengine API key (encrypted)',
          },
          update: { value: ciphertext },
        });
      }
      this.apiKeyCache = null;
    }

    if (input.defaultModel !== undefined) {
      const trimmed = input.defaultModel.trim();
      if (trimmed === '') {
        await this.prisma.globalConfig.deleteMany({
          where: { key: KEY_DEFAULT_MODEL },
        });
      } else {
        await this.prisma.globalConfig.upsert({
          where: { key: KEY_DEFAULT_MODEL },
          create: {
            key: KEY_DEFAULT_MODEL,
            value: trimmed,
            description:
              'Volcengine 默认 model ID (admin-set, e.g. doubao-seedance-2-0-260128)',
          },
          update: { value: trimmed },
        });
      }
      this.defaultModelCache = null;
    }

    if (input.timeouts?.video !== undefined) {
      const raw = input.timeouts.video;
      if (!Number.isFinite(raw) || raw <= 0) {
        await this.prisma.globalConfig.deleteMany({
          where: { key: KEY_TIMEOUT_VIDEO },
        });
      } else {
        const clamped = Math.max(1, Math.floor(raw));
        await this.prisma.globalConfig.upsert({
          where: { key: KEY_TIMEOUT_VIDEO },
          create: {
            key: KEY_TIMEOUT_VIDEO,
            value: clamped,
            description: 'Volcengine video submit timeout (seconds, admin-set)',
          },
          update: { value: clamped },
        });
      }
      this.timeoutVideoCache = null;
    }
    // chat/image/audio timeouts are silently ignored — no Volcengine provider
    // serves those modalities yet. Drop, don't error: a future shared UI form
    // that mass-submits all 4 fields shouldn't bounce on Volcengine.
  }

  // ---- internals ----------------------------------------------------------

  /**
   * Lazy bootstrap from env (one-shot, on first launch). After the row exists
   * in DB the env vars are ignored — same contract as DashscopeConfigService.
   */
  private async migrateFromEnv(): Promise<void> {
    const baseUrlExists = await this.prisma.globalConfig.findUnique({
      where: { key: KEY_BASE_URL },
    });
    if (!baseUrlExists) {
      const envBaseUrl = this.nestConfig.get<string>('VOLCENGINE_BASE_URL');
      if (envBaseUrl) {
        await this.prisma.globalConfig.create({
          data: {
            key: KEY_BASE_URL,
            value: envBaseUrl,
            description: 'Volcengine base URL (migrated from env)',
          },
        });
        this.logger.log(
          '[volcengine-config] migrated VOLCENGINE_BASE_URL env → DB',
        );
      }
    }

    const apiKeyExists = await this.prisma.globalConfig.findUnique({
      where: { key: KEY_API_KEY },
    });
    if (!apiKeyExists) {
      const envApiKey = this.nestConfig.get<string>('VOLCENGINE_API_KEY');
      if (envApiKey) {
        try {
          const ciphertext = encrypt(envApiKey);
          await this.prisma.globalConfig.create({
            data: {
              key: KEY_API_KEY,
              value: ciphertext,
              description:
                'Volcengine API key (encrypted, migrated from env)',
            },
          });
          this.logger.log(
            '[volcengine-config] migrated VOLCENGINE_API_KEY env → DB (encrypted)',
          );
        } catch (e) {
          this.logger.error(
            '[volcengine-config] env → DB migration of apiKey failed',
            e as Error,
          );
        }
      }
    }
  }

  private readCached<T>(slot: CachedValue<T> | null): T | undefined {
    if (!slot) return undefined;
    if (slot.expiresAt < Date.now()) return undefined;
    return slot.value;
  }

  private unwrapStringValue(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') return value;
    if (
      typeof value === 'object' &&
      value !== null &&
      'value' in (value as Record<string, unknown>)
    ) {
      const inner = (value as Record<string, unknown>).value;
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
    if (
      typeof value === 'object' &&
      value !== null &&
      'value' in (value as Record<string, unknown>)
    ) {
      return this.unwrapNumberValue(
        (value as Record<string, unknown>).value,
      );
    }
    return null;
  }
}
