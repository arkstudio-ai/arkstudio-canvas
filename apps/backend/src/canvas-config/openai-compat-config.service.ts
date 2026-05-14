import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { assertEncryptionKey, decrypt, encrypt, maskSecret } from '../common/crypto.util';

const KEY_BASE_URL = 'openai.baseUrl';
const KEY_API_KEY = 'openai.apiKey';
/**
 * OpenAI default. Operators接 OpenRouter / Together / Groq / 自建 vLLM
 * 都按"OpenAI-compatible"协议来；只要在 admin 里把 base URL 改掉就行，
 * provider 代码无差别。
 *
 * 约定 base URL 末尾**不含**斜线，且**包含 `/v1`**（OpenAI / OpenRouter
 * / vLLM 都遵循这个）。Provider 拼接 `${baseUrl}/chat/completions`、
 * `${baseUrl}/images/generations` 时是固定的。
 */
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const CACHE_TTL_MS = 30_000;

/**
 * Per-kind submit timeout (seconds). 4 档保持和 DashScope 对齐，方便
 * 未来 OpenAI 新增 video / 把 audio TTS 也接进来时不需要改 schema。
 *
 * 默认值比 DashScope 略宽：OpenAI 多模态 chat / DALL-E 3 偶发 60s+。
 */
export type OpenaiCompatKind = 'chat' | 'image' | 'video' | 'audio';
export const DEFAULT_OPENAI_TIMEOUT_SEC: Record<OpenaiCompatKind, number> = {
  chat: 90,
  image: 90,
  video: 120,
  audio: 60,
};
const TIMEOUT_KEY: Record<OpenaiCompatKind, string> = {
  chat: 'openai.timeoutSec.chat',
  image: 'openai.timeoutSec.image',
  video: 'openai.timeoutSec.video',
  audio: 'openai.timeoutSec.audio',
};

interface CachedValue<T> {
  value: T;
  expiresAt: number;
}

/**
 * Single source of truth for the OpenAI-compatible upstream (OpenAI /
 * OpenRouter / Together / self-hosted vLLM ...) base URL + API key.
 *
 * Mirrors `DashscopeConfigService` exactly so adding the third provider
 * (字节 / 谷歌) means a clean copy-paste with constant tweaks. The two
 * services intentionally don't share a base class — that would couple
 * envs, db keys and admin DTOs across providers and make local edits
 * to one risk breaking the other. The duplication is shallow (~80
 * lines) and worth the isolation.
 *
 * Authoritative storage: `global_configs` rows
 *   - openai.baseUrl  : plain string
 *   - openai.apiKey   : aes-256-gcm ciphertext (see common/crypto.util)
 *   - openai.timeoutSec.{chat|image|video|audio} : integer seconds
 *
 * `OPENAI_BASE_URL` / `OPENAI_API_KEY` env vars are bootstrap-only:
 * if the corresponding DB row is missing on first boot, we encrypt and
 * persist them, then ignore env on subsequent boots. Admins update via
 * `/admin/system` after that.
 */
@Injectable()
export class OpenaiCompatConfigService implements OnModuleInit {
  private readonly logger = new Logger(OpenaiCompatConfigService.name);
  private baseUrlCache: CachedValue<string | null> | null = null;
  private apiKeyCache: CachedValue<string | null> | null = null;
  private timeoutCache: Record<OpenaiCompatKind, CachedValue<number | null> | null> = {
    chat: null,
    image: null,
    video: null,
    audio: null,
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly nestConfig: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      assertEncryptionKey();
    } catch {
      this.logger.error(
        '[openai-config] ENCRYPTION_KEY missing/short — OpenAI Provider 设置 will fail until fixed in apps/backend/.env',
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
    const url = this.unwrapStringValue(row?.value);
    this.baseUrlCache = { value: url, expiresAt: Date.now() + CACHE_TTL_MS };
    return url ?? DEFAULT_BASE_URL;
  }

  async getApiKey(): Promise<string> {
    const cached = this.readCached(this.apiKeyCache);
    if (cached !== undefined) {
      if (!cached) throw new Error('OpenAI apiKey 未配置；请在 /admin/system 填写');
      return cached;
    }

    const row = await this.prisma.globalConfig.findUnique({ where: { key: KEY_API_KEY } });
    const stored = this.unwrapStringValue(row?.value);
    let plain: string | null = null;
    if (stored) {
      try {
        plain = decrypt(stored);
      } catch (e) {
        this.logger.error('[openai-config] apiKey decrypt failed; treating as missing', e as Error);
        plain = null;
      }
    }
    this.apiKeyCache = { value: plain, expiresAt: Date.now() + CACHE_TTL_MS };
    if (!plain) throw new Error('OpenAI apiKey 未配置；请在 /admin/system 填写');
    return plain;
  }

  /** True iff API key is configured. Cheap probe; never throws. */
  async hasApiKey(): Promise<boolean> {
    try {
      await this.getApiKey();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Per-kind submit timeout in milliseconds. Same units as
   * `DashscopeConfigService.getTimeoutMs` so axios callers don't need
   * a per-provider unit conversion.
   */
  async getTimeoutMs(kind: OpenaiCompatKind): Promise<number> {
    const cached = this.readCached(this.timeoutCache[kind]);
    if (cached !== undefined) {
      return (cached ?? DEFAULT_OPENAI_TIMEOUT_SEC[kind]) * 1000;
    }
    const row = await this.prisma.globalConfig.findUnique({ where: { key: TIMEOUT_KEY[kind] } });
    const value = this.unwrapNumberValue(row?.value);
    this.timeoutCache[kind] = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return (value ?? DEFAULT_OPENAI_TIMEOUT_SEC[kind]) * 1000;
  }

  // ---- admin surface used by the controller --------------------------------

  async getViewPayload(): Promise<{
    baseUrl: string;
    baseUrlConfigured: boolean;
    apiKeyMask: string | null;
    apiKeyConfigured: boolean;
    timeouts: Record<OpenaiCompatKind, { value: number; default: number; configured: boolean }>;
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

    const timeouts = {} as Record<OpenaiCompatKind, { value: number; default: number; configured: boolean }>;
    for (const kind of Object.keys(TIMEOUT_KEY) as OpenaiCompatKind[]) {
      const row = await this.prisma.globalConfig.findUnique({ where: { key: TIMEOUT_KEY[kind] } });
      const stored = this.unwrapNumberValue(row?.value);
      timeouts[kind] = {
        value: stored ?? DEFAULT_OPENAI_TIMEOUT_SEC[kind],
        default: DEFAULT_OPENAI_TIMEOUT_SEC[kind],
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
   * Apply a partial admin update. Same untouched/clear/set semantics
   * as `DashscopeConfigService.updateSettings` so the admin UI can
   * paste-style copy that section.
   */
  async updateSettings(input: {
    baseUrl?: string;
    apiKey?: string;
    timeouts?: Partial<Record<OpenaiCompatKind, number>>;
  }): Promise<void> {
    if (input.baseUrl !== undefined) {
      const trimmed = input.baseUrl.trim().replace(/\/$/, '');
      if (trimmed === '') {
        await this.prisma.globalConfig.deleteMany({ where: { key: KEY_BASE_URL } });
      } else {
        await this.prisma.globalConfig.upsert({
          where: { key: KEY_BASE_URL },
          create: { key: KEY_BASE_URL, value: trimmed, description: 'OpenAI-compat base URL (admin-set)' },
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
          create: { key: KEY_API_KEY, value: ciphertext, description: 'OpenAI-compat API key (encrypted)' },
          update: { value: ciphertext },
        });
      }
      this.apiKeyCache = null;
    }

    if (input.timeouts) {
      for (const [k, raw] of Object.entries(input.timeouts) as [OpenaiCompatKind, number | undefined][]) {
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
              description: `OpenAI-compat ${k} submit timeout (seconds, admin-set)`,
            },
            update: { value: clamped },
          });
        }
        this.timeoutCache[k] = null;
      }
    }
  }

  // ---- internals -----------------------------------------------------------

  private async migrateFromEnv(): Promise<void> {
    const baseUrlExists = await this.prisma.globalConfig.findUnique({ where: { key: KEY_BASE_URL } });
    if (!baseUrlExists) {
      const envBaseUrl = this.nestConfig.get<string>('OPENAI_BASE_URL');
      if (envBaseUrl) {
        await this.prisma.globalConfig.create({
          data: {
            key: KEY_BASE_URL,
            value: envBaseUrl.replace(/\/$/, ''),
            description: 'OpenAI-compat base URL (migrated from env)',
          },
        });
        this.logger.log(`[openai-config] migrated OPENAI_BASE_URL env → DB`);
      }
    }

    const apiKeyExists = await this.prisma.globalConfig.findUnique({ where: { key: KEY_API_KEY } });
    if (!apiKeyExists) {
      const envApiKey = this.nestConfig.get<string>('OPENAI_API_KEY');
      if (envApiKey) {
        try {
          const ciphertext = encrypt(envApiKey);
          await this.prisma.globalConfig.create({
            data: {
              key: KEY_API_KEY,
              value: ciphertext,
              description: 'OpenAI-compat API key (encrypted, migrated from env)',
            },
          });
          this.logger.log(`[openai-config] migrated OPENAI_API_KEY env → DB (encrypted)`);
        } catch (e) {
          this.logger.error('[openai-config] env → DB migration of apiKey failed', e as Error);
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
