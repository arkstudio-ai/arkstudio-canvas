import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { LocalStorageService } from '../storage/local-storage.service';

export interface TransferResult {
  success: boolean;
  fileKey?: string;
  accessUrl?: string;
  originalUrl: string;
  fileType?: string;
  size?: number;
  error?: string;
  /** Where the asset ended up — useful for diagnostics. Always 'local' or 'none'. */
  storage?: 'local' | 'none';
}

/**
 * Mirrors generated assets from a third-party host (DashScope etc.) into
 * our own local storage so the public URL stays stable after the
 * upstream signed URL expires (DashScope's are typically 24h).
 *
 * Open-source build: storage is local-disk-only. We never throw out of
 * `transferUrl` so one mirroring failure doesn't tank the executions
 * pipeline — caller falls back to the upstream URL and lives with the
 * eventual expiry.
 */
@Injectable()
export class FileTransferService {
  private readonly logger = new Logger(FileTransferService.name);

  constructor(private readonly localStorage: LocalStorageService) {}

  /**
   * @param sourceUrl   Original URL returned by the model provider.
   * @param executionId Used to derive the storage key (8-char prefix).
   * @param fileType    'image' | 'video' | 'audio' — only used for logs +
   *                    Content-Type fallback when the upstream omits it.
   */
  async transferUrl(
    sourceUrl: string,
    executionId: string,
    fileType: string,
  ): Promise<TransferResult> {
    if (this.localStorage.isLocalUrl(sourceUrl)) {
      // Already on our disk — no work to do, keep the URL we'd have minted anyway.
      this.logger.log(
        `[转存] ⏭️ 跳过: 已在 local storage (${sourceUrl.substring(0, 60)}...)`,
      );
      return {
        success: true,
        accessUrl: sourceUrl,
        originalUrl: sourceUrl,
        fileType,
        storage: 'local',
      };
    }

    const startTime = Date.now();
    this.logger.log(`[转存] 开始 (local): ${sourceUrl.substring(0, 80)}...`);

    try {
      const { buffer, contentType } = await this.downloadAsset(
        sourceUrl,
        fileType,
      );
      const ext = this.getExtension(contentType, sourceUrl);
      const key = this.localStorage.generateExecutionKey(executionId, ext);
      const result = await this.localStorage.putObject({
        key,
        buffer,
        contentType,
      });
      const duration = Date.now() - startTime;
      this.logger.log(`[转存] ✅ local 成功: ${key} (${duration}ms)`);
      return {
        success: true,
        fileKey: key,
        accessUrl: result.accessUrl,
        originalUrl: sourceUrl,
        fileType,
        size: result.bytes,
        storage: 'local',
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(
        `[转存] ❌ local 失败 (${duration}ms): ${(error as Error).message}`,
      );
      return {
        success: false,
        originalUrl: sourceUrl,
        error: (error as Error).message,
        storage: 'none',
      };
    }
  }

  /** Shared HTTP GET → Buffer. Hard upper bound = 500 MiB. */
  private async downloadAsset(
    sourceUrl: string,
    fileType: string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    const response = await axios.get(sourceUrl, {
      responseType: 'arraybuffer',
      timeout: 60_000,
      maxContentLength: 500 * 1024 * 1024,
    });
    const contentType = String(
      response.headers['content-type'] || this.getContentType(fileType),
    );
    const buffer = Buffer.from(response.data);
    this.logger.debug(`[下载] ${buffer.length} bytes, ${contentType}`);
    return { buffer, contentType };
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
}
