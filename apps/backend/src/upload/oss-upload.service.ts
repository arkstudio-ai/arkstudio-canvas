import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import OSS from 'ali-oss';
import { TosClient } from '@volcengine/tos-sdk';
import {
  OssConfigService,
  type OssCredentials,
} from '../canvas-config/oss-config.service';
import { LocalStorageService } from '../storage/local-storage.service';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Stage local backend files (`/static/uploads/<key>`) to a public-internet-
 * reachable URL via user-configured object storage. The output URL is what
 * gets fed to vendor APIs that fetch by URL only (Volcengine Seedance is
 * today's primary consumer).
 *
 * Two providers behind the same interface — Aliyun OSS and Volcengine TOS.
 * The OssConfigService says which one is active; each branch calls into the
 * vendor SDK to do the PutObject and constructs a public URL.
 *
 * Why two SDKs not S3-compat-mode: Both vendors offer S3 compatibility but
 * their compat modes drop features (multipart resume, server-side processing
 * params, signed URLs etc.). Using each vendor's native SDK = fewer surprise
 * 400s on real-world buckets.
 *
 * URL construction:
 *   - If user set `publicBaseUrl` (e.g. CDN domain): `${publicBaseUrl}/${key}`
 *   - Else: default bucket URL per vendor:
 *       Aliyun OSS  → https://<bucket>.<region>.aliyuncs.com/<key>
 *       Volcengine TOS → https://<bucket>.tos-<region>.volces.com/<key>
 *
 * Object key: `canvas-flow/<yyyy-mm-dd>/<uuid>-<sanitized-name>`.
 * Cap upload size at 100 MiB to match DashScope-OSS behaviour — generation
 * inputs above that hit hard limits in every upstream we care about anyway.
 */

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export interface StageLocalToOssResult {
  /** Public HTTPS URL the vendor can fetch. */
  publicUrl: string;
  /** Object key inside the bucket (after the bucket host). */
  key: string;
  /** Provider that handled it — useful for log / metrics. */
  provider: OssCredentials['provider'];
}

@Injectable()
export class OssUploadService {
  private readonly logger = new Logger(OssUploadService.name);

  constructor(
    private readonly ossConfig: OssConfigService,
    private readonly localStorage: LocalStorageService,
  ) {}

  /**
   * Cheap "is OSS configured" check — exposed so callers can short-circuit
   * with a helpful error before doing N sequential upload attempts.
   */
  async isReady(): Promise<boolean> {
    return (await this.ossConfig.getCredentials()) !== null;
  }

  /**
   * Resolve a `/static/uploads/<key>` URL (or full http://localhost-style)
   * to a public URL via the configured OSS / TOS bucket. Returns null when
   * OSS isn't configured — caller should branch on this and throw a helpful
   * error pointing the user to /admin/system.
   */
  async stageLocalToOss(
    localUrl: string,
  ): Promise<StageLocalToOssResult | null> {
    const creds = await this.ossConfig.getCredentials();
    if (!creds) return null;

    const localPath = await this.resolveLocalPath(localUrl);
    if (!localPath) {
      throw new Error(`无法解析本地文件路径: ${localUrl}`);
    }
    const buffer = fs.readFileSync(localPath);
    if (buffer.byteLength > MAX_UPLOAD_BYTES) {
      throw new Error(
        `文件 ${path.basename(localPath)} 超过 ${MAX_UPLOAD_BYTES / 1024 / 1024}MB 单次上传上限`,
      );
    }

    const ext = path.extname(localPath).toLowerCase();
    const baseName = sanitize(path.basename(localPath, ext));
    const dateBucket = new Date().toISOString().slice(0, 10);
    const key = `canvas-flow/${dateBucket}/${uuidv4().slice(0, 8)}-${baseName}${ext}`;
    const contentType = guessContentType(ext);

    const startedAt = Date.now();
    if (creds.provider === 'aliyun-oss') {
      await this.putAliyun(creds, key, buffer, contentType);
    } else {
      await this.putVolcengine(creds, key, buffer, contentType);
    }
    const elapsed = Date.now() - startedAt;
    const publicUrl = this.buildPublicUrl(creds, key);
    this.logger.log(
      `[oss-upload:${creds.provider}] ✅ ${publicUrl} (${buffer.byteLength}B, ${elapsed}ms)`,
    );
    return { publicUrl, key, provider: creds.provider };
  }

  // ---- per-vendor PutObject -----------------------------------------------

  private async putAliyun(
    creds: OssCredentials,
    key: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<void> {
    const client = new OSS({
      accessKeyId: creds.accessKeyId,
      accessKeySecret: creds.accessKeySecret,
      bucket: creds.bucket,
      region: creds.region,
      endpoint: creds.endpoint || undefined,
      secure: true,
    });
    await client.put(key, buffer, {
      mime: contentType,
      headers: { 'Cache-Control': 'public, max-age=3600' },
    });
  }

  private async putVolcengine(
    creds: OssCredentials,
    key: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<void> {
    const client = new TosClient({
      accessKeyId: creds.accessKeyId,
      accessKeySecret: creds.accessKeySecret,
      region: creds.region,
      endpoint: creds.endpoint || undefined,
    });
    await client.putObject({
      bucket: creds.bucket,
      key,
      body: buffer,
      contentType,
    });
  }

  // ---- URL building -------------------------------------------------------

  private buildPublicUrl(creds: OssCredentials, key: string): string {
    if (creds.publicBaseUrl) {
      const base = creds.publicBaseUrl.replace(/\/$/, '');
      return `${base}/${key}`;
    }
    if (creds.provider === 'aliyun-oss') {
      // 默认 bucket-vhost: https://<bucket>.<region>.aliyuncs.com/<key>
      // region 格式形如 "oss-cn-beijing"; 已经包含 oss- 前缀, 直接拼.
      return `https://${creds.bucket}.${creds.region}.aliyuncs.com/${key}`;
    }
    // volcengine-tos: https://<bucket>.tos-<region>.volces.com/<key>
    return `https://${creds.bucket}.tos-${creds.region}.volces.com/${key}`;
  }

  // ---- local file resolution ----------------------------------------------

  /**
   * Map a renderer-facing URL (relative `/static/uploads/foo.png` or absolute
   * `http://localhost:18500/static/uploads/foo.png`) to the on-disk path so
   * we can read its bytes for upload.
   */
  private async resolveLocalPath(localUrl: string): Promise<string | null> {
    const STATIC_PREFIX = '/static/uploads/';
    let pathPart = localUrl;
    try {
      // Drop scheme + host if it's a full URL.
      const u = new URL(localUrl);
      pathPart = u.pathname;
    } catch {
      /* not a full URL, treat as relative path */
    }
    const idx = pathPart.indexOf(STATIC_PREFIX);
    if (idx < 0) return null;
    const objectKey = pathPart.slice(idx + STATIC_PREFIX.length);
    const dataDir = await this.localStorage.getDataDir();
    return path.join(dataDir, objectKey);
  }
}

// ---- helpers --------------------------------------------------------------

function sanitize(name: string): string {
  if (/[^\x00-\x7F]/.test(name)) {
    return uuidv4().slice(0, 8);
  }
  return name
    .split('')
    .map((c) => (/[a-zA-Z0-9_\-]/.test(c) ? c : '_'))
    .join('')
    .slice(0, 50);
}

function guessContentType(ext: string): string {
  const map: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
  };
  return map[ext] ?? 'application/octet-stream';
}
