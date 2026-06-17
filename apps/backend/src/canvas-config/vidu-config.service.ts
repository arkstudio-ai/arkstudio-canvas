import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertEncryptionKey,
  decrypt,
  encrypt,
  maskSecret,
} from '../common/crypto.util';

const KEY_BASE_URL = 'vidu.baseUrl';
const KEY_API_KEY = 'vidu.apiKey';
const KEY_TIMEOUT = 'vidu.timeoutSec';

const DEFAULT_BASE_URL = 'https://api.vidu.cn';
const DEFAULT_TIMEOUT_SEC = 60;
const CACHE_TTL_MS = 30_000;

interface CachedValue<T> {
  value: T;
  expiresAt: number;
}

@Injectable()
export class ViduConfigService implements OnModuleInit {
  private readonly logger = new Logger(ViduConfigService.name);
  private baseUrlCache: CachedValue<string | null> | null = null;
  private apiKeyCache: CachedValue<string | null> | null = null;
  private timeoutCache: CachedValue<number | null> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly nestConfig: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      assertEncryptionKey();
    } catch {
      this.logger.error(
        '[vidu-config] ENCRYPTION_KEY missing/short — Vidu 设置 will fail until fixed in apps/backend/.env',
      );
      return;
    }
    await this.migrateFromEnv();
  }

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
        throw new Error('Vidu apiKey 未配置；请在 /admin/config 填写');
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
          '[vidu-config] apiKey decrypt failed; treating as missing',
          e as Error,
        );
        plain = null;
      }
    }
    this.apiKeyCache = { value: plain, expiresAt: Date.now() + CACHE_TTL_MS };
    if (!plain)
      throw new Error('Vidu apiKey 未配置；请在 /admin/config 填写');
    return plain;
  }

  async getTimeoutMs(): Promise<number> {
    const cached = this.readCached(this.timeoutCache);
    if (cached !== undefined) {
      return (cached ?? DEFAULT_TIMEOUT_SEC) * 1000;
    }
    const row = await this.prisma.globalConfig.findUnique({
      where: { key: KEY_TIMEOUT },
    });
    const value = this.unwrapNumberValue(row?.value);
    this.timeoutCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return (value ?? DEFAULT_TIMEOUT_SEC) * 1000;
  }

  async getViewPayload(): Promise<{
    baseUrl: string;
    baseUrlConfigured: boolean;
    apiKeyMask: string | null;
    apiKeyConfigured: boolean;
    timeout: { value: number; default: number; configured: boolean };
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

    const timeoutRow = await this.prisma.globalConfig.findUnique({
      where: { key: KEY_TIMEOUT },
    });
    const timeoutStored = this.unwrapNumberValue(timeoutRow?.value);

    return {
      baseUrl: baseUrlValue ?? DEFAULT_BASE_URL,
      baseUrlConfigured: !!baseUrlValue,
      apiKeyMask: maskSecret(apiKeyPlain),
      apiKeyConfigured: !!apiKeyPlain,
      timeout: {
        value: timeoutStored ?? DEFAULT_TIMEOUT_SEC,
        default: DEFAULT_TIMEOUT_SEC,
        configured: timeoutStored !== null,
      },
    };
  }

  async updateSettings(input: {
    baseUrl?: string;
    apiKey?: string;
    timeoutSec?: number;
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
            description: 'Vidu base URL (admin-set)',
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
            description: 'Vidu API key (encrypted)',
          },
          update: { value: ciphertext },
        });
      }
      this.apiKeyCache = null;
    }

    if (input.timeoutSec !== undefined) {
      const raw = input.timeoutSec;
      if (!Number.isFinite(raw) || raw <= 0) {
        await this.prisma.globalConfig.deleteMany({
          where: { key: KEY_TIMEOUT },
        });
      } else {
        const clamped = Math.max(1, Math.floor(raw));
        await this.prisma.globalConfig.upsert({
          where: { key: KEY_TIMEOUT },
          create: {
            key: KEY_TIMEOUT,
            value: clamped,
            description: 'Vidu submit timeout (seconds, admin-set)',
          },
          update: { value: clamped },
        });
      }
      this.timeoutCache = null;
    }
  }

  private async migrateFromEnv(): Promise<void> {
    const apiKeyExists = await this.prisma.globalConfig.findUnique({
      where: { key: KEY_API_KEY },
    });
    if (!apiKeyExists) {
      const envApiKey = this.nestConfig.get<string>('VIDU_API_KEY');
      if (envApiKey) {
        try {
          const ciphertext = encrypt(envApiKey);
          await this.prisma.globalConfig.create({
            data: {
              key: KEY_API_KEY,
              value: ciphertext,
              description: 'Vidu API key (encrypted, migrated from env)',
            },
          });
          this.logger.log(
            '[vidu-config] migrated VIDU_API_KEY env → DB (encrypted)',
          );
        } catch (e) {
          this.logger.error(
            '[vidu-config] env → DB migration of apiKey failed',
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
