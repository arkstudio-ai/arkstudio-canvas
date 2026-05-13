import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { CosService } from './cos.service';
import { StorageConfigService } from '../canvas-config/storage-config.service';
import { GetUploadSignDto } from './dto/get-upload-sign.dto';

export interface UploadSignResult {
  uploadUrl: string;
  fileKey: string;
  accessUrl: string;
  expires: number;
  method: string;
}

/**
 * Issues a short-lived COS signed URL so the browser can PUT directly,
 * keeping uploads off the backend critical path. The size cap is read
 * from `StorageConfigService` per call so admin tweaks take effect
 * immediately without a restart.
 */
@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

  constructor(
    private readonly cosService: CosService,
    private readonly storageConfig: StorageConfigService,
  ) {}

  async getUploadSign(dto: GetUploadSignDto): Promise<UploadSignResult> {
    const { fileName, fileType, fileSize } = dto;

    const maxFileSize = await this.storageConfig.getMaxFileSize();
    if (fileSize > maxFileSize) {
      throw new BadRequestException(
        `文件大小超出限制，最大允许 ${Math.floor(maxFileSize / 1024 / 1024)}MB`,
      );
    }

    const fileKey = this.generateFileKey(fileName);

    const { signedUrl, expires } = await this.cosService.getUploadSignedUrl(fileKey, fileType);

    const accessUrl = await this.cosService.getPublicUrl(fileKey);

    this.logger.log(`生成上传签名: fileName=${fileName}, fileKey=${fileKey}`);

    return {
      uploadUrl: signedUrl,
      fileKey,
      accessUrl,
      expires,
      method: 'PUT',
    };
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
