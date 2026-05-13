import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import {
  StorageConfigService,
  StorageNotConfiguredError,
} from '../canvas-config/storage-config.service';
import { DashscopeUploadService } from './dashscope-upload.service';

export interface TransferResult {
  success: boolean;
  fileKey?: string;
  accessUrl?: string;
  originalUrl: string;
  fileType?: string;
  size?: number;
  error?: string;
  /** Where the asset ended up — useful for diagnostics + admin UI. */
  storage?: 'cos' | 'dashscope-temp' | 'none';
}

/**
 * Mirrors generated assets from a third-party host (DashScope/etc.) into
 * our own storage so the public URL stays stable after the upstream
 * signed URL expires (DashScope's are typically 24h).
 *
 * Strategy (auto-fallback so a fresh open-source clone is usable
 * without ANY storage configuration):
 *
 *   1. COS configured       → mirror into our bucket; long-lived URL
 *   2. else DashScope key   → re-upload via DashScope's free temporary
 *                             storage (`oss://` URL, 48h TTL, 100MB cap)
 *   3. else                 → degrade gracefully: keep the upstream URL
 *                             for the run; caller decides what to do
 *
 * We never throw out of `transferUrl` so one missing setting can't tank
 * the whole executions pipeline.
 */
@Injectable()
export class FileTransferService {
  private readonly logger = new Logger(FileTransferService.name);

  constructor(
    private readonly storageConfig: StorageConfigService,
    private readonly dashscopeUpload: DashscopeUploadService,
  ) {}

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
    // ----- Branch 1: COS configured → long-lived mirror ------------------
    let creds;
    try {
      creds = await this.storageConfig.getCredentials();
    } catch (e) {
      if (!(e instanceof StorageNotConfiguredError)) throw e;
      // No COS — try DashScope temporary fallback below.
      return this.transferToDashscopeTemp(sourceUrl, executionId, fileType);
    }

    if (creds.customDomain && this.isAlreadyOnCos(sourceUrl, creds.customDomain)) {
      this.logger.log(`[转存] ⏭️ 跳过: URL已在COS上 (${sourceUrl.substring(0, 60)}...)`);
      return {
        success: true,
        accessUrl: sourceUrl,
        originalUrl: sourceUrl,
        fileType,
        storage: 'cos',
      };
    }

    const startTime = Date.now();
    this.logger.log(`[转存] 开始 (cos): ${sourceUrl.substring(0, 80)}...`);

    try {
      const { buffer, contentType } = await this.downloadAsset(sourceUrl, fileType);

      const ext = this.getExtension(contentType, sourceUrl);
      const fileKey = this.generateFileKey(executionId, ext);

      await this.uploadToCOS(fileKey, buffer, contentType, creds.bucket);

      const accessUrl = creds.customDomain
        ? `https://${creds.customDomain}/${fileKey}`
        : `https://${creds.bucket}.cos.${creds.region}.myqcloud.com/${fileKey}`;

      const duration = Date.now() - startTime;
      this.logger.log(`[转存] ✅ cos 成功: ${fileKey} (${duration}ms)`);

      return {
        success: true,
        fileKey,
        accessUrl,
        originalUrl: sourceUrl,
        fileType,
        size: buffer.length,
        storage: 'cos',
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`[转存] ❌ cos 失败 (${duration}ms): ${(error as Error).message}`);
      return {
        success: false,
        originalUrl: sourceUrl,
        error: (error as Error).message,
        storage: 'none',
      };
    }
  }

  /**
   * Free-tier fallback: re-upload to DashScope's instant bucket so the
   * model can resolve the asset via `oss://` for the next 48h.
   *
   * Skipped silently when the DashScope key is also missing — callers
   * keep using the original (short-lived) third-party URL.
   */
  private async transferToDashscopeTemp(
    sourceUrl: string,
    executionId: string,
    fileType: string,
  ): Promise<TransferResult> {
    if (!(await this.dashscopeUpload.isAvailable())) {
      this.logger.warn('[转存] 🪶 COS 未配置且 DashScope key 缺失；保留原始 URL');
      return {
        success: false,
        originalUrl: sourceUrl,
        error: 'no storage configured',
        storage: 'none',
      };
    }

    const startTime = Date.now();
    this.logger.log(`[转存] 开始 (dashscope-temp): ${sourceUrl.substring(0, 80)}...`);

    try {
      const { buffer, contentType } = await this.downloadAsset(sourceUrl, fileType);
      const ext = this.getExtension(contentType, sourceUrl);
      // Model name is best-effort — DashScope's policy is keyed by model
      // but in practice only enforces account match. We pick a generic
      // SKU based on fileType so the policy URL groups assets sensibly.
      const model = this.modelHintForFileType(fileType);
      const result = await this.dashscopeUpload.uploadBuffer({
        model,
        fileName: `${executionId.substring(0, 8)}-${uuidv4().slice(0, 8)}.${ext}`,
        buffer,
        contentType,
      });
      const duration = Date.now() - startTime;
      this.logger.log(`[转存] ✅ dashscope-temp 成功: ${result.ossUrl} (${duration}ms)`);
      return {
        success: true,
        accessUrl: result.ossUrl,
        originalUrl: sourceUrl,
        fileType,
        size: result.bytes,
        storage: 'dashscope-temp',
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(
        `[转存] ❌ dashscope-temp 失败 (${duration}ms): ${(error as Error).message}`,
      );
      return {
        success: false,
        originalUrl: sourceUrl,
        error: (error as Error).message,
        storage: 'none',
      };
    }
  }

  /** Shared HTTP GET → Buffer used by both COS and dashscope-temp branches. */
  private async downloadAsset(
    sourceUrl: string,
    fileType: string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
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
    const buffer = Buffer.from(response.data);
    this.logger.debug(`[下载] ${buffer.length} bytes, ${contentType}`);
    return { buffer, contentType };
  }

  private modelHintForFileType(fileType: string): string {
    switch (fileType) {
      case 'image':
        return 'qwen-vl-plus';
      case 'video':
        return 'wanx2.7';
      case 'audio':
        return 'qwen-audio-turbo';
      default:
        return 'qwen-vl-plus';
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
