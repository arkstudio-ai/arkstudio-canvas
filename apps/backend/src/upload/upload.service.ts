import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { LocalStorageService } from '../storage/local-storage.service';

export interface UploadFileResult {
  /** Relative URL (`/static/uploads/...`) — frontend templates this directly. */
  accessUrl: string;
  fileKey: string;
  storage: 'local';
  bytes: number;
}

/**
 * Direct multipart upload endpoint backing `POST /upload/file`.
 *
 * Open-source build writes everything to local disk via
 * `LocalStorageService` — see the D2 design discussion for why we
 * deleted the COS / S3 branch instead of abstracting them: an
 * open-source canvas should not require a paid cloud account just to
 * persist a generated PNG.
 *
 * For i2i / i2v reference assets that ALSO need to be readable by a
 * cloud model, the upload still goes here first; the dashscope provider
 * later re-stages it to the dashscope-temp bucket through
 * `DashscopeUploadService.stageLocalUrlsToTemp` at submit time.
 */
@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

  constructor(private readonly localStorage: LocalStorageService) {}

  async uploadFileBuffer(args: {
    fileName: string;
    contentType: string;
    buffer: Buffer;
  }): Promise<UploadFileResult> {
    const { fileName, contentType, buffer } = args;

    // Size-cap is enforced inside putObject via getMaxFileSize(); we don't
    // duplicate the check here so the admin's "max file size" knob is the
    // single source of truth.
    const key = this.localStorage.generateUploadKey(fileName);
    let result;
    try {
      result = await this.localStorage.putObject({
        key,
        buffer,
        contentType,
      });
    } catch (e) {
      // putObject throws BadRequestException for size-cap; let it bubble.
      if (e instanceof BadRequestException) throw e;
      this.logger.error(
        `[upload] putObject failed for ${key}: ${(e as Error).message}`,
      );
      throw new BadRequestException(`本地存储写入失败: ${(e as Error).message}`);
    }
    this.logger.log(
      `[upload] local ${result.accessUrl} (${result.bytes}B, ${contentType})`,
    );
    return {
      accessUrl: result.accessUrl,
      fileKey: key,
      storage: 'local',
      bytes: result.bytes,
    };
  }
}
