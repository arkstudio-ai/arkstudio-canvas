import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import {
  StorageConfigService,
  StorageNotConfiguredError,
} from '../canvas-config/storage-config.service';
import {
  DashscopeFileTooLargeError,
  DashscopeUploadService,
} from './dashscope-upload.service';

export interface UploadFileResult {
  accessUrl: string;
  fileKey?: string;
  storage: 'cos' | 'dashscope-temp';
  /** ISO string; only set for dashscope-temp (48h expiry). */
  expiresAt?: string;
  bytes: number;
}

/**
 * Two responsibilities:
 *
 *   1. `uploadFileBuffer` (proxy)  — receive a buffer through the
 *      backend and route it to whichever backend is configured. This
 *      is what makes a fresh open-source clone usable with just a
 *      DASHSCOPE_API_KEY.
 *
 *   2. Size enforcement — pulled from `StorageConfigService` per call
 *      so admin tweaks take effect without a restart. DashScope path
 *      additionally enforces the hard 100 MiB DashScope server limit.
 */
@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

  constructor(
    private readonly storageConfig: StorageConfigService,
    private readonly dashscopeUpload: DashscopeUploadService,
  ) {}

  /**
   * COS-first, DashScope-fallback proxy upload.
   *
   * Flow:
   *   1. Reject obviously oversized files (admin-tunable cap).
   *   2. Try COS putObject if credentials are configured.
   *   3. Otherwise upload to DashScope's free temporary bucket.
   *   4. If neither is available, throw 400 with a clear message
   *      pointing the operator at /admin/system.
   */
  async uploadFileBuffer(args: {
    fileName: string;
    contentType: string;
    buffer: Buffer;
  }): Promise<UploadFileResult> {
    const { fileName, contentType, buffer } = args;

    const maxFileSize = await this.storageConfig.getMaxFileSize();
    if (buffer.byteLength > maxFileSize) {
      throw new BadRequestException(
        `文件大小超出限制，最大允许 ${Math.floor(maxFileSize / 1024 / 1024)}MB`,
      );
    }

    // ---- COS branch ----
    let creds;
    try {
      creds = await this.storageConfig.getCredentials();
    } catch (e) {
      if (!(e instanceof StorageNotConfiguredError)) throw e;
      // Fall through to DashScope below.
      creds = null;
    }

    if (creds) {
      const fileKey = this.generateFileKey(fileName);
      try {
        await this.putBufferToCos(fileKey, buffer, contentType, creds.bucket);
      } catch (e) {
        // COS write failed (network / signature / quota). Don't fall
        // through to DashScope here — user explicitly configured COS,
        // they want to know it's broken instead of silently shipping
        // their assets to a 48h-TTL bucket.
        this.logger.error(`COS putObject failed for ${fileKey}: ${(e as Error).message}`);
        throw new BadRequestException(`COS 写入失败: ${(e as Error).message}`);
      }
      const accessUrl = creds.customDomain
        ? `https://${creds.customDomain}/${fileKey}`
        : `https://${creds.bucket}.cos.${creds.region}.myqcloud.com/${fileKey}`;
      this.logger.log(`[upload] cos ${accessUrl} (${buffer.byteLength}B)`);
      return { accessUrl, fileKey, storage: 'cos', bytes: buffer.byteLength };
    }

    // ---- DashScope fallback branch ----
    if (!(await this.dashscopeUpload.isAvailable())) {
      throw new BadRequestException(
        '存储未配置：请到 /admin/system 填写腾讯 COS 凭据，或至少填一份 DashScope API Key（开箱即用模式）。',
      );
    }

    try {
      const result = await this.dashscopeUpload.uploadBuffer({
        // Generic SKU — DashScope only enforces account match for the
        // policy; the actual model used at inference time can differ.
        model: 'qwen-vl-plus',
        fileName,
        buffer,
        contentType,
      });
      this.logger.log(`[upload] dashscope-temp ${result.ossUrl} (${result.bytes}B)`);
      return {
        accessUrl: result.ossUrl,
        storage: 'dashscope-temp',
        bytes: result.bytes,
        expiresAt: result.expiresAt.toISOString(),
      };
    } catch (e) {
      if (e instanceof DashscopeFileTooLargeError) {
        throw new BadRequestException(
          `DashScope 临时存储单文件最大 100MB；当前文件 ${(e.bytes / 1024 / 1024).toFixed(1)}MB 超限。配置腾讯 COS 即可解除该限制。`,
        );
      }
      throw e;
    }
  }

  private async putBufferToCos(
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
          Region: 'accelerate', // matches FileTransferService — global accelerate endpoint
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

  /** Object key layout: `uploads/{YYYY-MM-DD}/{uuid}-{sanitized}`. */
  private generateFileKey(originalFileName: string): string {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const uuid = uuidv4();
    const sanitizedFileName = this.sanitizeFileName(originalFileName);

    return `uploads/${dateStr}/${uuid}-${sanitizedFileName}`;
  }

  /**
   * Strip everything outside `[a-zA-Z0-9_-]` and the extension. CJK or
   * other non-ASCII names get replaced with a short UUID so we never
   * try to URL-sign a key that the COS SDK might mangle.
   */
  private sanitizeFileName(fileName: string): string {
    const lastDotIndex = fileName.lastIndexOf('.');
    const ext = lastDotIndex > 0 ? fileName.slice(lastDotIndex) : '';
    const baseName = lastDotIndex > 0 ? fileName.slice(0, lastDotIndex) : fileName;

    const hasNonAscii = /[^\x00-\x7F]/.test(baseName);

    if (hasNonAscii) {
      return uuidv4().substring(0, 8) + ext.toLowerCase();
    }

    const sanitized = baseName
      .split('')
      .map((char) => (/[a-zA-Z0-9_\-]/.test(char) ? char : '_'))
      .join('');

    const maxLength = 50;
    const truncated = sanitized.length > maxLength ? sanitized.slice(0, maxLength) : sanitized;

    return truncated + ext.toLowerCase();
  }
}
