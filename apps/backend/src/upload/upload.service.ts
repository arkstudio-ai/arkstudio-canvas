import { Inject, Injectable, Logger, BadRequestException } from '@nestjs/common';
import { STORAGE_DRIVER, type StorageDriver } from '../storage/storage-driver';

export interface UploadFileResult {
  /** Browser-renderable URL: relative `/static/uploads/...` for local driver,
   *  public bucket URL for cloud (aliyun-oss / volcengine-tos). */
  accessUrl: string;
  fileKey: string;
  /** Tag the storage backend that wrote this object; useful for frontend
   *  to display origin + for cleanup tools. */
  storage: string;
  bytes: number;
}

/**
 * Direct multipart upload endpoint backing `POST /upload/file`.
 *
 * Injects the `STORAGE_DRIVER` token (resolved by `StorageModule.useFactory`
 * from `STORAGE_BACKEND` env): local default → `LocalStorageService`,
 * `aliyun-oss` / `volcengine-tos` → `S3CompatStorageService`. Same code
 * path; swapping backends is a single env var.
 *
 * For i2i / i2v reference assets that need to be readable by a cloud model
 * (DashScope), the upload still goes here first; the dashscope provider
 * later re-stages it to the dashscope-temp bucket via
 * `DashscopeUploadService.stageLocalUrlsToTemp` at submit time (which
 * inspects URL ownership via the driver's `ownsUrl()`).
 */
@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

  constructor(@Inject(STORAGE_DRIVER) private readonly storage: StorageDriver) {}

  async uploadFileBuffer(args: {
    fileName: string;
    contentType: string;
    buffer: Buffer;
  }): Promise<UploadFileResult> {
    const { fileName, contentType, buffer } = args;

    // Size-cap is enforced inside putObject; we don't duplicate the check
    // here so the admin's "max file size" knob is the single source of truth.
    const key = this.storage.generateUploadKey(fileName);
    let result;
    try {
      result = await this.storage.putObject({
        key,
        buffer,
        contentType,
      });
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      this.logger.error(
        `[upload] putObject failed for ${key}: ${(e as Error).message}`,
      );
      throw new BadRequestException(`存储写入失败: ${(e as Error).message}`);
    }
    // Heuristic: relative URL → local; everything else → cloud (tag with
    // host so admin can grep upload logs by bucket later).
    const isRel = result.accessUrl.startsWith('/');
    const backendTag = isRel ? 'local' : new URL(result.accessUrl).host;
    this.logger.log(
      `[upload] ${backendTag} ${result.accessUrl} (${result.bytes}B, ${contentType})`,
    );
    return {
      accessUrl: result.accessUrl,
      fileKey: key,
      storage: backendTag,
      bytes: result.bytes,
    };
  }
}
