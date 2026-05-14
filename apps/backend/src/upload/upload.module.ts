import { Module } from '@nestjs/common';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';
import { FileTransferService } from './file-transfer.service';
import { DashscopeUploadService } from './dashscope-upload.service';
import { CanvasConfigModule } from '../canvas-config/canvas-config.module';

@Module({
  imports: [CanvasConfigModule],
  controllers: [UploadController],
  providers: [UploadService, FileTransferService, DashscopeUploadService],
  // DashscopeUploadService is exported so providers (image/video/etc.)
  // can call `isDashscopeOssUrl(...)` directly without importing the
  // service — the helper is a static export from the same module file.
  exports: [UploadService, FileTransferService, DashscopeUploadService],
})
export class UploadModule {}
