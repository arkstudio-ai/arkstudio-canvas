import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { Readable } from 'stream';
import OSS from 'ali-oss';
import { TosClient } from '@volcengine/tos-sdk';
import type {
  PutObjectArgs,
  PutObjectResult,
  ReadObjectByUrlResult,
  ReadObjectResult,
  StorageDriver,
} from './storage-driver';

type CloudProvider = 'aliyun-oss' | 'volcengine-tos';

interface CloudCredentials {
  provider: CloudProvider;
  accessKeyId: string;
  accessKeySecret: string;
  bucket: string;
  region: string;
  endpoint?: string;
  publicBaseUrl?: string;
}

const DEFAULT_MAX_FILE_SIZE = 100 * 1024 * 1024;

/**
 * S3-compatible storage driver (Aliyun OSS / Volcengine TOS).
 *
 * MVP 走 env-only 凭据 —— 商业版 dev / docker / OSS 自部署"我想换云"都靠
 * `.env` 配 STORAGE_S3_* 系列变量。这避开了"读加密 creds 从 global_configs
 * 表"这一层依赖，不需要 import OssConfigService（不会引入 CanvasConfigModule
 * ↔ StorageModule 的循环依赖）。
 *
 * 后续若要"admin UI 编辑 cloud creds 持久化到 DB"，把 OssConfigService 提出
 * 来成 OssConfigModule (不再放 canvas-config 包里) + 让 StorageModule import
 * 它。但 MVP 走 env 完全够用 —— 一台机器一个租户一份配置。
 *
 * 两个 provider 共用一个类（aliyun OSS / volcengine TOS 在 putObject /
 * readObject 内部分支调不同 SDK）—— 比拆成两个 driver 类共享 80% 代码省事。
 */
@Injectable()
export class S3CompatStorageService implements OnModuleInit, StorageDriver {
  private readonly logger = new Logger(S3CompatStorageService.name);
  private creds: CloudCredentials | null = null;
  private aliClient: OSS | null = null;
  private tosClient: TosClient | null = null;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    this.creds = this.resolveCreds();
    if (!this.creds) {
      this.logger.warn(
        '[s3-compat-storage] STORAGE_S3_* env not fully set — putObject/readObject will throw until configured.',
      );
      return;
    }
    this.logger.log(
      `[s3-compat-storage] ready (provider=${this.creds.provider} bucket=${this.creds.bucket} region=${this.creds.region})`,
    );
  }

  // ---- write ---------------------------------------------------------------

  async putObject(args: PutObjectArgs): Promise<PutObjectResult> {
    const creds = this.requireCreds();
    if (args.buffer.byteLength > DEFAULT_MAX_FILE_SIZE) {
      throw new BadRequestException(
        `文件大小超出限制，最大允许 ${Math.floor(DEFAULT_MAX_FILE_SIZE / 1024 / 1024)}MB`,
      );
    }
    if (creds.provider === 'aliyun-oss') {
      await this.getAliClient().put(args.key, args.buffer, {
        mime: args.contentType,
        headers: { 'Cache-Control': 'public, max-age=3600' },
      });
    } else {
      await this.getTosClient().putObject({
        bucket: creds.bucket,
        key: args.key,
        body: args.buffer,
        contentType: args.contentType,
      });
    }
    return {
      accessUrl: this.buildPublicUrl(args.key),
      bytes: args.buffer.byteLength,
    };
  }

  // ---- read ----------------------------------------------------------------

  async readObject(key: string): Promise<ReadObjectResult | null> {
    const creds = this.requireCreds();
    try {
      if (creds.provider === 'aliyun-oss') {
        // ali-oss get returns { content: Buffer, res: { headers, ... } }
        const res = (await this.getAliClient().get(key)) as {
          content: Buffer;
          res?: { headers?: Record<string, string | undefined> };
        };
        return {
          stream: Readable.from(res.content),
          bytes: res.content.byteLength,
          contentType: res.res?.headers?.['content-type'] ?? 'application/octet-stream',
        };
      }
      // @volcengine/tos-sdk 的 getObject 返回类型在 SDK ≥ 2.x 里是 stream-based
      // ContentReturn，跟 ali-oss 的 Buffer-based 不同。MVP 阶段商业版主要走
      // aliyun-oss；volcengine-tos 的 read 路径等真有需求时再补（业务端只在
      // dashscope stage helper 才走 readObjectByUrl，商业版可以约束自家文件
      // 入云后不再被本服务回读，避开这条路径）。
      throw new Error(
        'S3CompatStorageService.readObject not yet implemented for volcengine-tos. Use aliyun-oss for now.',
      );
    } catch (e) {
      // 任何 4xx/5xx (NoSuchKey / AccessDenied 都映射成 null)；500 类的也归 null，
      // 调用方对"读不到"统一按"miss"处理。生产可以更细分。
      this.logger.debug(`[s3-compat-storage] readObject miss key=${key}: ${(e as Error).message}`);
      return null;
    }
  }

  // ---- URL ownership / read by URL ----------------------------------------

  ownsUrl(url: string | null | undefined): boolean {
    if (!url || !this.creds) return false;
    try {
      const u = new URL(url);
      const publicBase = this.getPublicBaseUrl();
      if (publicBase && url.startsWith(publicBase + '/')) return true;
      // fallback: 默认 bucket-vhost 形式
      const defaultHost = this.defaultHostFor(this.creds);
      return u.host === defaultHost;
    } catch {
      return false;
    }
  }

  async readObjectByUrl(url: string): Promise<ReadObjectByUrlResult | null> {
    if (!this.ownsUrl(url)) return null;
    const key = this.urlToKey(url);
    if (!key) return null;
    const obj = await this.readObject(key);
    if (!obj) return null;
    const chunks: Buffer[] = [];
    for await (const chunk of obj.stream as AsyncIterable<Buffer>) {
      chunks.push(chunk);
    }
    return {
      buffer: Buffer.concat(chunks),
      contentType: obj.contentType,
      bytes: obj.bytes,
    };
  }

  // ---- URL helpers ---------------------------------------------------------

  getPublicBaseUrl(): string {
    if (!this.creds) return '';
    if (this.creds.publicBaseUrl) return this.creds.publicBaseUrl.replace(/\/$/, '');
    return `https://${this.defaultHostFor(this.creds)}`;
  }

  private defaultHostFor(creds: CloudCredentials): string {
    if (creds.provider === 'aliyun-oss') {
      return `${creds.bucket}.${creds.region}.aliyuncs.com`;
    }
    return `${creds.bucket}.tos-${creds.region}.volces.com`;
  }

  private buildPublicUrl(key: string): string {
    return `${this.getPublicBaseUrl()}/${key}`;
  }

  private urlToKey(url: string): string | null {
    try {
      const u = new URL(url);
      const publicBase = this.getPublicBaseUrl();
      if (publicBase && url.startsWith(publicBase + '/')) {
        return url.slice(publicBase.length + 1);
      }
      // 默认形式: bucket.host/<key>; pathname 含 leading /
      return u.pathname.replace(/^\//, '') || null;
    } catch {
      return null;
    }
  }

  // ---- key derivation ------------------------------------------------------

  generateUploadKey(originalFileName: string): string {
    const dateStr = new Date().toISOString().split('T')[0];
    const uuid = uuidv4();
    return `uploads/${dateStr}/${uuid}-${sanitizeFileName(originalFileName)}`;
  }

  generateExecutionKey(executionId: string, ext: string): string {
    const dateStr = new Date().toISOString().split('T')[0];
    const uuid = uuidv4().substring(0, 8);
    const shortExecId = executionId.substring(0, 8);
    return `executions/${dateStr}/${shortExecId}-${uuid}.${ext}`;
  }

  // ---- internals -----------------------------------------------------------

  private resolveCreds(): CloudCredentials | null {
    const backend = this.config.get<string>('STORAGE_BACKEND');
    if (backend !== 'aliyun-oss' && backend !== 'volcengine-tos') return null;
    const accessKeyId = this.config.get<string>('STORAGE_S3_ACCESS_KEY_ID');
    const accessKeySecret = this.config.get<string>('STORAGE_S3_ACCESS_KEY_SECRET');
    const bucket = this.config.get<string>('STORAGE_S3_BUCKET');
    const region = this.config.get<string>('STORAGE_S3_REGION');
    if (!accessKeyId || !accessKeySecret || !bucket || !region) return null;
    return {
      provider: backend as CloudProvider,
      accessKeyId,
      accessKeySecret,
      bucket,
      region,
      endpoint: this.config.get<string>('STORAGE_S3_ENDPOINT'),
      publicBaseUrl: this.config.get<string>('STORAGE_S3_PUBLIC_BASE_URL'),
    };
  }

  private requireCreds(): CloudCredentials {
    if (!this.creds) {
      throw new Error(
        'S3CompatStorageService not configured — set STORAGE_S3_* env vars.',
      );
    }
    return this.creds;
  }

  private getAliClient(): OSS {
    if (!this.aliClient) {
      const c = this.requireCreds();
      this.aliClient = new OSS({
        accessKeyId: c.accessKeyId,
        accessKeySecret: c.accessKeySecret,
        bucket: c.bucket,
        region: c.region,
        endpoint: c.endpoint || undefined,
        secure: true,
      });
    }
    return this.aliClient;
  }

  private getTosClient(): TosClient {
    if (!this.tosClient) {
      const c = this.requireCreds();
      this.tosClient = new TosClient({
        accessKeyId: c.accessKeyId,
        accessKeySecret: c.accessKeySecret,
        region: c.region,
        endpoint: c.endpoint || undefined,
      });
    }
    return this.tosClient;
  }
}

function sanitizeFileName(fileName: string): string {
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
  const truncated = sanitized.length > 50 ? sanitized.slice(0, 50) : sanitized;
  return truncated + ext.toLowerCase();
}
