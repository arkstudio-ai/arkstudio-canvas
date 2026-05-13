import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import {
  StorageConfigService,
  StorageNotConfiguredError,
} from '../canvas-config/storage-config.service';

export interface TransferResult {
  success: boolean;
  fileKey?: string;
  accessUrl?: string;
  originalUrl: string;
  fileType?: string;
  size?: number;
  error?: string;
}

/**
 * Mirrors generated assets from a third-party host (DashScope/etc.) into
 * our own COS so the public URL stays stable after the upstream signed
 * URL expires.
 *
 * COS credentials come from `StorageConfigService` (DB-backed); when
 * unconfigured we degrade gracefully -- callers receive a `success:false`
 * TransferResult with `error: 'COS 未配置'` and decide whether to keep
 * the original URL for the run. We never throw out of `transferUrl` so
 * one missing setting can't tank the whole executions pipeline.
 */
@Injectable()
export class FileTransferService {
  private readonly logger = new Logger(FileTransferService.name);

  constructor(private readonly storageConfig: StorageConfigService) {}

  /**
   * @param sourceUrl   Original URL returned by the model provider.
   * @param executionId Used to derive the COS object key (8-char prefix).
   * @param fileType    'image' | 'video' | 'audio' -- only used for logs +
   *                    Content-Type fallback when the upstream omits it.
   */
  async transferUrl(
    sourceUrl: string,
    executionId: string,
    fileType: string,
  ): Promise<TransferResult> {
    let creds;
    try {
      creds = await this.storageConfig.getCredentials();
    } catch (e) {
      if (e instanceof StorageNotConfiguredError) {
        this.logger.warn('COS 未配置，跳过转存');
        return { success: false, originalUrl: sourceUrl, error: 'COS 未配置' };
      }
      throw e;
    }

    if (creds.customDomain && this.isAlreadyOnCos(sourceUrl, creds.customDomain)) {
      this.logger.log(`[转存] ⏭️ 跳过: URL已在COS上 (${sourceUrl.substring(0, 60)}...)`);
      return { success: true, accessUrl: sourceUrl, originalUrl: sourceUrl, fileType };
    }

    const startTime = Date.now();
    this.logger.log(`[转存] 开始: ${sourceUrl.substring(0, 80)}...`);

    try {
      const response = await axios.get(sourceUrl, {
        responseType: 'arraybuffer',
        timeout: 60_000,
        // Hard upper bound; defensive guard for download size, independent
        // of the COS object cap which is enforced at upload time elsewhere.
        maxContentLength: 500 * 1024 * 1024,
      });

      const contentType = String(
        response.headers['content-type'] || this.getContentType(fileType),
      );
      const contentLength = response.headers['content-length'] || response.data.length;
      const buffer = Buffer.from(response.data);

      this.logger.debug(`[转存] 下载完成: ${contentLength} bytes, ${contentType}`);

      const ext = this.getExtension(contentType, sourceUrl);
      const fileKey = this.generateFileKey(executionId, ext);

      await this.uploadToCOS(fileKey, buffer, contentType, creds.bucket);

      const accessUrl = creds.customDomain
        ? `https://${creds.customDomain}/${fileKey}`
        : `https://${creds.bucket}.cos.${creds.region}.myqcloud.com/${fileKey}`;

      const duration = Date.now() - startTime;
      this.logger.log(`[转存] ✅ 成功: ${fileKey} (${duration}ms)`);

      return {
        success: true,
        fileKey,
        accessUrl,
        originalUrl: sourceUrl,
        fileType,
        size: buffer.length,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`[转存] ❌ 失败 (${duration}ms): ${(error as Error).message}`);
      return { success: false, originalUrl: sourceUrl, error: (error as Error).message };
    }
  }

  private async uploadToCOS(
    fileKey: string,
    buffer: Buffer,
    contentType: string,
    bucket: string,
  ): Promise<void> {
    const cos = await this.storageConfig.getCosClient();
    return new Promise((resolve, reject) => {
      cos.putObject(
        {
          Bucket: bucket,
          Region: 'accelerate', // global accelerate endpoint
          Key: fileKey,
          Body: buffer,
          ContentType: contentType,
        },
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        },
      );
    });
  }

  /**
   * Object key layout: `executions/{YYYY-MM-DD}/{shortExecId}-{uuid}.{ext}`.
   *
   * Open-source build has no user system, so the legacy `{userId}` segment
   * (always 'system' from the executions pipeline) was dropped in #11.
   */
  private generateFileKey(executionId: string, ext: string): string {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const uuid = uuidv4().substring(0, 8);
    const shortExecId = executionId.substring(0, 8);
    return `executions/${dateStr}/${shortExecId}-${uuid}.${ext}`;
  }

  private getExtension(contentType: string, url: string): string {
    const mimeMap: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'video/mp4': 'mp4',
      'video/webm': 'webm',
      'video/quicktime': 'mov',
      'audio/mpeg': 'mp3',
      'audio/wav': 'wav',
      'audio/ogg': 'ogg',
    };

    const ext = mimeMap[contentType];
    if (ext) return ext;

    try {
      const urlPath = new URL(url).pathname;
      const match = urlPath.match(/\.([a-zA-Z0-9]+)(\?|$)/);
      if (match) return match[1].toLowerCase();
    } catch {
      // ignore
    }
    return 'bin';
  }

  private getContentType(fileType: string): string {
    const typeMap: Record<string, string> = {
      image: 'image/jpeg',
      video: 'video/mp4',
      audio: 'audio/mpeg',
    };
    return typeMap[fileType] || 'application/octet-stream';
  }

  /** True when the URL is already served from our custom domain. */
  private isAlreadyOnCos(url: string, customDomain: string): boolean {
    try {
      return new URL(url).hostname === customDomain;
    } catch {
      return false;
    }
  }
}
