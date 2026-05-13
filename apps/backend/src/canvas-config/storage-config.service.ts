import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { assertEncryptionKey, decrypt, encrypt, maskSecret } from '../common/crypto.util';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const COS = require('cos-nodejs-sdk-v5');

const KEY_SECRET_ID = 'storage.cos.secretId';
const KEY_SECRET_KEY = 'storage.cos.secretKey';
const KEY_BUCKET = 'storage.cos.bucket';
const KEY_REGION = 'storage.cos.region';
const KEY_CUSTOM_DOMAIN = 'storage.cos.customDomain';
const KEY_SIGN_EXPIRES = 'storage.cos.signExpires';
const KEY_MAX_FILE_SIZE = 'storage.cos.maxFileSize';

const DEFAULT_REGION = 'ap-hongkong';
const DEFAULT_SIGN_EXPIRES = 3600;
/** 100 MiB. Aligned with the previous .env default. */
const DEFAULT_MAX_FILE_SIZE = 100 * 1024 * 1024;
const CACHE_TTL_MS = 30_000;

interface CachedValue<T> {
  value: T;
  expiresAt: number;
}

export interface CosCredentials {
  secretId: string;
  secretKey: string;
  bucket: string;
  region: string;
  customDomain: string | null;
  signExpires: number;
  maxFileSize: number;
}

export class StorageNotConfiguredError extends Error {
  constructor() {
    super('对象存储 (COS) 未配置；请在 /admin/system 填写 SecretId / SecretKey / Bucket');
    this.name = 'StorageNotConfiguredError';
  }
}

export interface StorageSettingsView {
  /** True when secretId + secretKey + bucket are all set in DB. */
  configured: boolean;
  /** Masked SecretId (e.g. AKID12...x9aB) or null. */
  secretIdMask: string | null;
  /** Masked SecretKey or null. */
  secretKeyMask: string | null;
  bucket: string | null;
  region: string;
  regionDefault: string;
  regionConfigured: boolean;
  customDomain: string | null;
  signExpires: number;
  signExpiresDefault: number;
  signExpiresConfigured: boolean;
  /** Bytes. */
  maxFileSize: number;
  maxFileSizeDefault: number;
  maxFileSizeConfigured: boolean;
}

/**
 * Single source of truth for COS storage credentials and tunables.
 *
 * Authoritative storage: `global_configs` rows
 *   - storage.cos.secretId       : aes-256-gcm ciphertext
 *   - storage.cos.secretKey      : aes-256-gcm ciphertext
 *   - storage.cos.bucket         : plain string
 *   - storage.cos.region         : plain string (defaults to ap-hongkong)
 *   - storage.cos.customDomain   : plain string (optional)
 *   - storage.cos.signExpires    : number (seconds, defaults to 3600)
 *   - storage.cos.maxFileSize    : number (bytes, defaults to 100 MiB)
 *
 * Why not env-only? Open-source operators want to flip credentials from
 * the admin UI without redeploying. The legacy COS_* env vars are only
 * honoured at first boot (see `migrateFromEnv`).
 *
 * The COS client itself is created lazily per-credentials and cached so
 * we don't pay the construction cost on every request; cache is busted
 * when credentials change.
 */
@Injectable()
export class StorageConfigService implements OnModuleInit {
  private readonly logger = new Logger(StorageConfigService.name);
  private credentialsCache: CachedValue<CosCredentials | null> | null = null;
  private cosClient: any = null;
  private cosClientCredentialsKey: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly nestConfig: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      assertEncryptionKey();
    } catch {
      this.logger.error(
        '[storage-config] ENCRYPTION_KEY missing/short — 存储设置 will fail until fixed in apps/backend/.env',
      );
      return;
    }
    await this.migrateFromEnv();
  }

  // ---- runtime accessors ---------------------------------------------------

  /**
   * Returns the full credential set or throws StorageNotConfiguredError.
   * Callers (CosService / FileTransferService) should let the error
   * propagate so the upload endpoint returns a clear 4xx instead of a
   * cryptic 500.
   */
  async getCredentials(): Promise<CosCredentials> {
    const cached = this.readCached(this.credentialsCache);
    if (cached !== undefined) {
      if (!cached) throw new StorageNotConfiguredError();
      return cached;
    }
    const fresh = await this.loadCredentialsFromDb();
    this.credentialsCache = { value: fresh, expiresAt: Date.now() + CACHE_TTL_MS };
    if (!fresh) throw new StorageNotConfiguredError();
    return fresh;
  }

  /**
   * Returns a cached COS SDK client built from the current credentials.
   * Re-creates the client when credentials change so admin saves take
   * effect on the next request without a backend restart.
   */
  async getCosClient(): Promise<any> {
    const creds = await this.getCredentials();
    const key = `${creds.secretId}:${creds.secretKey}`;
    if (this.cosClient && this.cosClientCredentialsKey === key) {
      return this.cosClient;
    }
    this.cosClient = new COS({ SecretId: creds.secretId, SecretKey: creds.secretKey });
    this.cosClientCredentialsKey = key;
    return this.cosClient;
  }

  /** Bytes. Falls back to DEFAULT_MAX_FILE_SIZE when unconfigured. */
  async getMaxFileSize(): Promise<number> {
    try {
      const creds = await this.getCredentials();
      return creds.maxFileSize;
    } catch {
      // Even when credentials are absent, the upload controller still
      // rejects oversized files; honour the default in that case.
      return DEFAULT_MAX_FILE_SIZE;
    }
  }

  // ---- admin surface -------------------------------------------------------

  async getViewPayload(): Promise<StorageSettingsView> {
    const [secretIdRow, secretKeyRow, bucketRow, regionRow, domainRow, expRow, maxRow] =
      await Promise.all([
        this.prisma.globalConfig.findUnique({ where: { key: KEY_SECRET_ID } }),
        this.prisma.globalConfig.findUnique({ where: { key: KEY_SECRET_KEY } }),
        this.prisma.globalConfig.findUnique({ where: { key: KEY_BUCKET } }),
        this.prisma.globalConfig.findUnique({ where: { key: KEY_REGION } }),
        this.prisma.globalConfig.findUnique({ where: { key: KEY_CUSTOM_DOMAIN } }),
        this.prisma.globalConfig.findUnique({ where: { key: KEY_SIGN_EXPIRES } }),
        this.prisma.globalConfig.findUnique({ where: { key: KEY_MAX_FILE_SIZE } }),
      ]);

    let secretIdPlain: string | null = null;
    let secretKeyPlain: string | null = null;
    const sIdStored = this.unwrapStringValue(secretIdRow?.value);
    const sKeyStored = this.unwrapStringValue(secretKeyRow?.value);
    if (sIdStored) {
      try {
        secretIdPlain = decrypt(sIdStored);
      } catch {
        secretIdPlain = null;
      }
    }
    if (sKeyStored) {
      try {
        secretKeyPlain = decrypt(sKeyStored);
      } catch {
        secretKeyPlain = null;
      }
    }

    const bucket = this.unwrapStringValue(bucketRow?.value);
    const region = this.unwrapStringValue(regionRow?.value);
    const customDomain = this.unwrapStringValue(domainRow?.value);
    const signExpires = this.unwrapNumberValue(expRow?.value);
    const maxFileSize = this.unwrapNumberValue(maxRow?.value);

    return {
      configured: !!(secretIdPlain && secretKeyPlain && bucket),
      secretIdMask: maskSecret(secretIdPlain),
      secretKeyMask: maskSecret(secretKeyPlain),
      bucket,
      region: region ?? DEFAULT_REGION,
      regionDefault: DEFAULT_REGION,
      regionConfigured: region !== null,
      customDomain,
      signExpires: signExpires ?? DEFAULT_SIGN_EXPIRES,
      signExpiresDefault: DEFAULT_SIGN_EXPIRES,
      signExpiresConfigured: signExpires !== null,
      maxFileSize: maxFileSize ?? DEFAULT_MAX_FILE_SIZE,
      maxFileSizeDefault: DEFAULT_MAX_FILE_SIZE,
      maxFileSizeConfigured: maxFileSize !== null,
    };
  }

  /**
   * Apply a partial admin update.
   *
   * String fields (secretId, secretKey, bucket, region, customDomain):
   *   - undefined  → field untouched
   *   - empty `''` → clear (revert to default for region; null for the rest)
   *   - non-empty  → upsert (secrets get encrypted before storage)
   *
   * Number fields (signExpires, maxFileSize):
   *   - undefined  → untouched
   *   - negative   → clear (revert to DEFAULT_*)
   *   - 0+         → upsert
   */
  async updateSettings(input: {
    secretId?: string;
    secretKey?: string;
    bucket?: string;
    region?: string;
    customDomain?: string;
    signExpires?: number;
    maxFileSize?: number;
  }): Promise<void> {
    if (input.secretId !== undefined) {
      await this.upsertSecret(KEY_SECRET_ID, input.secretId, 'COS SecretId');
    }
    if (input.secretKey !== undefined) {
      await this.upsertSecret(KEY_SECRET_KEY, input.secretKey, 'COS SecretKey');
    }
    if (input.bucket !== undefined) {
      await this.upsertString(KEY_BUCKET, input.bucket, 'COS bucket');
    }
    if (input.region !== undefined) {
      await this.upsertString(KEY_REGION, input.region, 'COS region');
    }
    if (input.customDomain !== undefined) {
      await this.upsertString(KEY_CUSTOM_DOMAIN, input.customDomain, 'COS custom domain');
    }
    if (input.signExpires !== undefined) {
      await this.upsertNumber(KEY_SIGN_EXPIRES, input.signExpires, 'COS sign expires (sec)');
    }
    if (input.maxFileSize !== undefined) {
      await this.upsertNumber(KEY_MAX_FILE_SIZE, input.maxFileSize, 'COS max file size (bytes)');
    }
    // Any save invalidates both caches; the next request rebuilds both
    // the credentials snapshot and (lazily) the COS client.
    this.credentialsCache = null;
    this.cosClient = null;
    this.cosClientCredentialsKey = null;
  }

  // ---- internals -----------------------------------------------------------

  private async loadCredentialsFromDb(): Promise<CosCredentials | null> {
    const [sIdRow, sKeyRow, bucketRow, regionRow, domainRow, expRow, maxRow] = await Promise.all([
      this.prisma.globalConfig.findUnique({ where: { key: KEY_SECRET_ID } }),
      this.prisma.globalConfig.findUnique({ where: { key: KEY_SECRET_KEY } }),
      this.prisma.globalConfig.findUnique({ where: { key: KEY_BUCKET } }),
      this.prisma.globalConfig.findUnique({ where: { key: KEY_REGION } }),
      this.prisma.globalConfig.findUnique({ where: { key: KEY_CUSTOM_DOMAIN } }),
      this.prisma.globalConfig.findUnique({ where: { key: KEY_SIGN_EXPIRES } }),
      this.prisma.globalConfig.findUnique({ where: { key: KEY_MAX_FILE_SIZE } }),
    ]);
    const sIdStored = this.unwrapStringValue(sIdRow?.value);
    const sKeyStored = this.unwrapStringValue(sKeyRow?.value);
    const bucket = this.unwrapStringValue(bucketRow?.value);
    if (!sIdStored || !sKeyStored || !bucket) return null;
    let secretId: string;
    let secretKey: string;
    try {
      secretId = decrypt(sIdStored);
      secretKey = decrypt(sKeyStored);
    } catch (e) {
      this.logger.error('[storage-config] secret decrypt failed', e as Error);
      return null;
    }
    return {
      secretId,
      secretKey,
      bucket,
      region: this.unwrapStringValue(regionRow?.value) ?? DEFAULT_REGION,
      customDomain: this.unwrapStringValue(domainRow?.value),
      signExpires: this.unwrapNumberValue(expRow?.value) ?? DEFAULT_SIGN_EXPIRES,
      maxFileSize: this.unwrapNumberValue(maxRow?.value) ?? DEFAULT_MAX_FILE_SIZE,
    };
  }

  /**
   * Best-effort one-shot migration so pre-DB deployments keep working
   * after upgrade. Each row is migrated independently — a partial env
   * (e.g. only bucket/region set) is fine.
   */
  private async migrateFromEnv(): Promise<void> {
    const moves: Array<[string, string | undefined, boolean]> = [
      [KEY_SECRET_ID, this.nestConfig.get<string>('COS_SECRET_ID'), true],
      [KEY_SECRET_KEY, this.nestConfig.get<string>('COS_SECRET_KEY'), true],
      [KEY_BUCKET, this.nestConfig.get<string>('COS_BUCKET'), false],
      [KEY_REGION, this.nestConfig.get<string>('COS_REGION'), false],
      [KEY_CUSTOM_DOMAIN, this.nestConfig.get<string>('COS_CUSTOM_DOMAIN'), false],
    ];
    for (const [key, raw, isSecret] of moves) {
      if (!raw) continue;
      const exists = await this.prisma.globalConfig.findUnique({ where: { key } });
      if (exists) continue;
      const stored = isSecret ? encrypt(raw) : raw;
      try {
        await this.prisma.globalConfig.create({
          data: {
            key,
            value: stored,
            description: `${key} (${isSecret ? 'encrypted, ' : ''}migrated from env)`,
          },
        });
        this.logger.log(`[storage-config] migrated ${key} env → DB`);
      } catch (e) {
        this.logger.warn(`[storage-config] env → DB migration of ${key} failed`, (e as Error).message);
      }
    }

    // Numeric tunables -- only migrate if env value parses cleanly.
    const moveNumber = async (key: string, envKey: string) => {
      const raw = this.nestConfig.get<string>(envKey);
      if (!raw) return;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) return;
      const exists = await this.prisma.globalConfig.findUnique({ where: { key } });
      if (exists) return;
      await this.prisma.globalConfig.create({
        data: {
          key,
          value: Math.floor(n),
          description: `${key} (migrated from env)`,
        },
      });
      this.logger.log(`[storage-config] migrated ${envKey} env → DB`);
    };
    await moveNumber(KEY_SIGN_EXPIRES, 'COS_SIGN_EXPIRES');
    await moveNumber(KEY_MAX_FILE_SIZE, 'COS_MAX_FILE_SIZE');
  }

  private async upsertString(key: string, raw: string, description: string): Promise<void> {
    const trimmed = raw.trim();
    if (trimmed === '') {
      await this.prisma.globalConfig.deleteMany({ where: { key } });
      return;
    }
    await this.prisma.globalConfig.upsert({
      where: { key },
      create: { key, value: trimmed, description: `${description} (admin-set)` },
      update: { value: trimmed },
    });
  }

  private async upsertSecret(key: string, raw: string, description: string): Promise<void> {
    const trimmed = raw.trim();
    if (trimmed === '') {
      await this.prisma.globalConfig.deleteMany({ where: { key } });
      return;
    }
    const ciphertext = encrypt(trimmed);
    await this.prisma.globalConfig.upsert({
      where: { key },
      create: { key, value: ciphertext, description: `${description} (encrypted, admin-set)` },
      update: { value: ciphertext },
    });
  }

  private async upsertNumber(key: string, raw: number, description: string): Promise<void> {
    if (!Number.isFinite(raw) || raw < 0) {
      await this.prisma.globalConfig.deleteMany({ where: { key } });
      return;
    }
    const clamped = Math.floor(raw);
    await this.prisma.globalConfig.upsert({
      where: { key },
      create: { key, value: clamped, description: `${description} (admin-set)` },
      update: { value: clamped },
    });
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
