import { Module } from '@nestjs/common';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';
import { CosService } from './cos.service';
import { FileTransferService } from './file-transfer.service';
import { CanvasConfigModule } from '../canvas-config/canvas-config.module';

@Module({
  imports: [CanvasConfigModule],
  controllers: [UploadController],
  providers: [UploadService, CosService, FileTransferService],
  exports: [UploadService, CosService, FileTransferService],
})
export class UploadModule {}
