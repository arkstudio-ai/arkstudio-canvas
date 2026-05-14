import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadService } from './upload.service';

@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  /**
   * Direct upload (multipart proxy).
   *
   * POST /upload/file
   *   Content-Type: multipart/form-data
   *   field: `file` (binary)
   *
   * Bytes are written to local disk via `LocalStorageService`. The
   * returned `accessUrl` is a relative path served by
   * `StaticUploadsController` (`/static/uploads/...`).
   *
   * Response:
   *   { accessUrl, fileKey, storage: 'local', bytes }
   *
   * For i2i / i2v reference images, the same `accessUrl` is later
   * re-staged to the dashscope-temp bucket inside the dashscope
   * provider — see `DashscopeUploadService.stageLocalUrlsToTemp`.
   */
  @Post('file')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('missing "file" multipart field');
    }
    return this.uploadService.uploadFileBuffer({
      fileName: file.originalname,
      contentType: file.mimetype,
      buffer: file.buffer,
    });
  }
}
