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
   * The backend internally picks a destination based on what's
   * configured in /admin/system:
   *   - COS configured       → `putObject` to our bucket; long-lived URL
   *   - else DashScope key   → DashScope free temporary store (oss://, 48h)
   *   - else                 → 400 BAD_REQUEST asking for storage
   *
   * Response:
   *   { accessUrl, fileKey?, storage: 'cos' | 'dashscope-temp', expiresAt? }
   *
   * 早期版本的 `POST /upload/sign`（COS 预签名 PUT）已删除——开箱即用
   * 模式下没有 COS 凭据可签，统一走这条多 multipart 代理路径，让 backend
   * 自动在 COS / DashScope 临时桶之间选目的地。
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
