import { Module } from '@nestjs/common';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';
import { FileTransferService } from './file-transfer.service';
import { DashscopeUploadService } from './dashscope-upload.service';
import { CanvasConfigModule } from '../canvas-config/canvas-config.module';
import { StorageModule } from '../storage/storage.module';

/**
 * Upload module — three concerns wired together:
 *
 *   - `UploadService`         : POST /upload/file → write to local storage
 *   - `FileTransferService`   : mirror upstream model URL → local storage
 *   - `DashscopeUploadService`: temp-bucket bridge for i2i / i2v references
 *                               (reads back from local storage when needed)
 *
 * `StorageModule` provides `LocalStorageService`, the single source of
 * truth for "where the bytes live on disk". `DashscopeUploadService` is
 * also exported so `ProvidersModule` can import this module and let the
 * dashscope-image / dashscope-video providers call
 * `stageLocalUrlsToTemp()` before submitting to the cloud model.
 */
@Module({
  imports: [CanvasConfigModule, StorageModule],
  controllers: [UploadController],
  providers: [UploadService, FileTransferService, DashscopeUploadService],
  exports: [UploadService, FileTransferService, DashscopeUploadService],
})
export class UploadModule {}
