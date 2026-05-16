import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertEncryptionKey,
  decrypt,
  encrypt,
  maskSecret,
} from '../common/crypto.util';

/**
 * OSS / TOS object storage settings.
 *
 * Purpose: stage local backend uploads (`/static/uploads/<key>`) to a
 * public-internet-reachable URL before passing them to vendors that
 * fetch by URL only (e.g. Volcengine Seedance CreateAsset / generation
 * tasks that take `image_url.url` — they pull from URL, can't accept
 * base64, and obviously can't reach desktop-mode localhost).
 *
 * Two strategies, one at a time (`provider` switch). User configures
 * either Aliyun OSS or Volcengine TOS credentials — both are S3-like
 * object stores that produce public URLs after a PutObject.
 *
 * Authoritative storage: `global_configs`
 *   - oss.provider         : 'aliyun-oss' | 'volcengine-tos' | null
 *   - oss.accessKeyId      : AES-256-GCM ciphertext (same as DashScope apiKey)
 *   - oss.accessKeySecret  : AES-256-GCM ciphertext
 *   - oss.bucket           : plain string
 *   - oss.region           : plain string (e.g. 'oss-cn-beijing' for aliyun,
 *                            'cn-beijing' for volcengine)
 *   - oss.endpoint         : optional plain string (custom domain / VPC endpoint)
 *   - oss.publicBaseUrl    : optional plain string (CDN / custom URL prefix;
 *                            empty = use default bucket public URL)
 *
 * The provider switch is intentional — running two cloud-storage adapters
 * simultaneously adds complexity without value. If a user needs to migrate
 * (e.g. aliyun → volcengine), they flip provider + update creds, and any
 * already-uploaded blobs stay where they are (we don't migrate historical
 * artefacts).
 */

export type OssProvider = 'aliyun-oss' | 'volcengine-tos';

const KEY_PROVIDER = 'oss.provider';
const KEY_ACCESS_KEY_ID = 'oss.accessKeyId';
const KEY_ACCESS_KEY_SECRET = 'oss.accessKeySecret';
const KEY_BUCKET = 'oss.bucket';
const KEY_REGION = 'oss.region';
const KEY_ENDPOINT = 'oss.endpoint';
const KEY_PUBLIC_BASE_URL = 'oss.publicBaseUrl';

const CACHE_TTL_MS = 30_000;

interface CachedValue<T> {
  value: T;
  expiresAt: number;
}

export interface OssCredentials {
  provider: OssProvider;
  accessKeyId: string;
  accessKeySecret: string;
  bucket: string;
  region: string;
  endpoint?: string;
  publicBaseUrl?: string;
}

@Injectable()
export class OssConfigService implements OnModuleInit {
  private readonly logger = new Logger(OssConfigService.name);
  private providerCache: CachedValue<OssProvider | null> | null = null;
  private accessKeyIdCache: CachedValue<string | null> | null = null;
  private accessKeySecretCache: CachedValue<string | null> | null = null;
  private bucketCache: CachedValue<string | null> | null = null;
  private regionCache: CachedValue<string | null> | null = null;
  private endpointCache: CachedValue<string | null> | null = null;
  private publicBaseUrlCache: CachedValue<string | null> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    try {
      assertEncryptionKey();
    } catch {
      this.logger.error(
        '[oss-config] ENCRYPTION_KEY missing/short — OSS 设置 will fail until fixed in apps/backend/.env',
      );
    }
  }

  // ---- runtime accessors --------------------------------------------------

  /**
   * `null` when OSS isn't configured (no provider set OR creds incomplete).
   * Callers should branch on this — typically Volcengine provider throws a
   * helpful "请去 /admin/system 配 OSS" error when it sees null AND a local
   * URL needs staging.
   */
  async getCredentials(): Promise<OssCredentials | null> {
    const provider = await this.getProvider();
    if (!provider) return null;
    const [accessKeyId, accessKeySecret, bucket, region, endpoint, publicBaseUrl] =
      await Promise.all([
        this.getAccessKeyId(),
        this.getAccessKeySecret(),
        this.getBucket(),
        this.getRegion(),
        this.getEndpoint(),
        this.getPublicBaseUrl(),
      ]);
    if (!accessKeyId || !accessKeySecret || !bucket || !region) return null;
    return {
      provider,
      accessKeyId,
      accessKeySecret,
      bucket,
      region,
      endpoint: endpoint ?? undefined,
      publicBaseUrl: publicBaseUrl ?? undefined,
    };
  }

  async getProvider(): Promise<OssProvider | null> {
    const cached = this.readCached(this.providerCache);
    if (cached !== undefined) return cached;
    const row = await this.prisma.globalConfig.findUnique({
      where: { key: KEY_PROVIDER },
    });
    const raw = this.unwrapStringValue(row?.value);
    const value: OssProvider | null =
      raw === 'aliyun-oss' || raw === 'volcengine-tos' ? raw : null;
    this.providerCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return value;
  }

  private async getAccessKeyId(): Promise<string | null> {
    const cached = this.readCached(this.accessKeyIdCache);
    if (cached !== undefined) return cached;
    const row = await this.prisma.globalConfig.findUnique({
      where: { key: KEY_ACCESS_KEY_ID },
    });
    const stored = this.unwrapStringValue(row?.value);
    let plain: string | null = null;
    if (stored) {
      try {
        plain = decrypt(stored);
      } catch (e) {
        this.logger.error('[oss-config] accessKeyId decrypt failed', e as Error);
      }
    }
    this.accessKeyIdCache = { value: plain, expiresAt: Date.now() + CACHE_TTL_MS };
    return plain;
  }

  private async getAccessKeySecret(): Promise<string | null> {
    const cached = this.readCached(this.accessKeySecretCache);
    if (cached !== undefined) return cached;
    const row = await this.prisma.globalConfig.findUnique({
      where: { key: KEY_ACCESS_KEY_SECRET },
    });
    const stored = this.unwrapStringValue(row?.value);
    let plain: string | null = null;
    if (stored) {
      try {
        plain = decrypt(stored);
      } catch (e) {
        this.logger.error(
          '[oss-config] accessKeySecret decrypt failed',
          e as Error,
        );
      }
    }
    this.accessKeySecretCache = {
      value: plain,
      expiresAt: Date.now() + CACHE_TTL_MS,
    };
    return plain;
  }

  private async getBucket(): Promise<string | null> {
    const cached = this.readCached(this.bucketCache);
    if (cached !== undefined) return cached;
    const row = await this.prisma.globalConfig.findUnique({
      where: { key: KEY_BUCKET },
    });
    const value = this.unwrapStringValue(row?.value);
    this.bucketCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return value;
  }

  private async getRegion(): Promise<string | null> {
    const cached = this.readCached(this.regionCache);
    if (cached !== undefined) return cached;
    const row = await this.prisma.globalConfig.findUnique({
      where: { key: KEY_REGION },
    });
    const value = this.unwrapStringValue(row?.value);
    this.regionCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return value;
  }

  private async getEndpoint(): Promise<string | null> {
    const cached = this.readCached(this.endpointCache);
    if (cached !== undefined) return cached;
    const row = await this.prisma.globalConfig.findUnique({
      where: { key: KEY_ENDPOINT },
    });
    const value = this.unwrapStringValue(row?.value);
    this.endpointCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return value;
  }

  private async getPublicBaseUrl(): Promise<string | null> {
    const cached = this.readCached(this.publicBaseUrlCache);
    if (cached !== undefined) return cached;
    const row = await this.prisma.globalConfig.findUnique({
      where: { key: KEY_PUBLIC_BASE_URL },
    });
    const value = this.unwrapStringValue(row?.value);
    this.publicBaseUrlCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return value;
  }

  // ---- admin surface ------------------------------------------------------

  async getViewPayload(): Promise<{
    provider: OssProvider | null;
    bucket: string;
    region: string;
    endpoint: string;
    publicBaseUrl: string;
    accessKeyIdMask: string | null;
    accessKeySecretConfigured: boolean;
    /** Convenience: backend's view of "this config will actually work". */
    ready: boolean;
  }> {
    const provider = await this.getProvider();
    const accessKeyId = await this.getAccessKeyId();
    const accessKeySecret = await this.getAccessKeySecret();
    const bucket = await this.getBucket();
    const region = await this.getRegion();
    const endpoint = await this.getEndpoint();
    const publicBaseUrl = await this.getPublicBaseUrl();
    return {
      provider,
      bucket: bucket ?? '',
      region: region ?? '',
      endpoint: endpoint ?? '',
      publicBaseUrl: publicBaseUrl ?? '',
      accessKeyIdMask: maskSecret(accessKeyId),
      accessKeySecretConfigured: !!accessKeySecret,
      ready: !!(
        provider &&
        accessKeyId &&
        accessKeySecret &&
        bucket &&
        region
      ),
    };
  }

  /**
   * Partial update. Same convention as other *ConfigService:
   *   undefined → untouched, '' → clear DB row, non-empty → upsert.
   *   accessKey* gets AES-encrypted before storage.
   */
  async updateSettings(input: {
    provider?: OssProvider | '';
    accessKeyId?: string;
    accessKeySecret?: string;
    bucket?: string;
    region?: string;
    endpoint?: string;
    publicBaseUrl?: string;
  }): Promise<void> {
    if (input.provider !== undefined) {
      const trimmed = input.provider.trim();
      if (trimmed === '') {
        await this.prisma.globalConfig.deleteMany({
          where: { key: KEY_PROVIDER },
        });
      } else if (trimmed === 'aliyun-oss' || trimmed === 'volcengine-tos') {
        await this.prisma.globalConfig.upsert({
          where: { key: KEY_PROVIDER },
          create: {
            key: KEY_PROVIDER,
            value: trimmed,
            description: 'OSS / TOS provider switch (admin-set)',
          },
          update: { value: trimmed },
        });
      }
      this.providerCache = null;
    }

    await this.upsertEncrypted(
      KEY_ACCESS_KEY_ID,
      input.accessKeyId,
      'OSS access key id (encrypted)',
      () => (this.accessKeyIdCache = null),
    );
    await this.upsertEncrypted(
      KEY_ACCESS_KEY_SECRET,
      input.accessKeySecret,
      'OSS access key secret (encrypted)',
      () => (this.accessKeySecretCache = null),
    );
    await this.upsertPlain(
      KEY_BUCKET,
      input.bucket,
      'OSS bucket name',
      () => (this.bucketCache = null),
    );
    await this.upsertPlain(
      KEY_REGION,
      input.region,
      'OSS region',
      () => (this.regionCache = null),
    );
    await this.upsertPlain(
      KEY_ENDPOINT,
      input.endpoint,
      'OSS endpoint override',
      () => (this.endpointCache = null),
    );
    await this.upsertPlain(
      KEY_PUBLIC_BASE_URL,
      input.publicBaseUrl,
      'OSS public base URL (CDN / custom domain)',
      () => (this.publicBaseUrlCache = null),
    );
  }

  // ---- internals ----------------------------------------------------------

  private async upsertEncrypted(
    key: string,
    value: string | undefined,
    description: string,
    bustCache: () => void,
  ): Promise<void> {
    if (value === undefined) return;
    const trimmed = value.trim();
    if (trimmed === '') {
      await this.prisma.globalConfig.deleteMany({ where: { key } });
    } else {
      const ciphertext = encrypt(trimmed);
      await this.prisma.globalConfig.upsert({
        where: { key },
        create: { key, value: ciphertext, description },
        update: { value: ciphertext },
      });
    }
    bustCache();
  }

  private async upsertPlain(
    key: string,
    value: string | undefined,
    description: string,
    bustCache: () => void,
  ): Promise<void> {
    if (value === undefined) return;
    const trimmed = value.trim();
    if (trimmed === '') {
      await this.prisma.globalConfig.deleteMany({ where: { key } });
    } else {
      await this.prisma.globalConfig.upsert({
        where: { key },
        create: { key, value: trimmed, description },
        update: { value: trimmed },
      });
    }
    bustCache();
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
}
