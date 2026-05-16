import { Module } from '@nestjs/common';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';
import { FileTransferService } from './file-transfer.service';
import { DashscopeUploadService } from './dashscope-upload.service';
import { OssUploadService } from './oss-upload.service';
import { CanvasConfigModule } from '../canvas-config/canvas-config.module';
import { StorageModule } from '../storage/storage.module';

/**
 * Upload module — four concerns wired together:
 *
 *   - `UploadService`         : POST /upload/file → write to local storage
 *   - `FileTransferService`   : mirror upstream model URL → local storage
 *   - `DashscopeUploadService`: temp-bucket bridge for i2i / i2v references
 *                               (DashScope private oss:// URLs)
 *   - `OssUploadService`      : generic OSS / TOS adapter to produce public
 *                               HTTPS URLs for vendors that fetch by URL
 *                               only (Volcengine Seedance i2v / r2v).
 *
 * `StorageModule` provides `LocalStorageService`, the single source of
 * truth for "where the bytes live on disk". Both upload services read back
 * from there when staging a local file to a remote bucket.
 */
@Module({
  imports: [CanvasConfigModule, StorageModule],
  controllers: [UploadController],
  providers: [
    UploadService,
    FileTransferService,
    DashscopeUploadService,
    OssUploadService,
  ],
  exports: [
    UploadService,
    FileTransferService,
    DashscopeUploadService,
    OssUploadService,
  ],
})
export class UploadModule {}
