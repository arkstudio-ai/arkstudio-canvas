import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadService } from './upload.service';
import { GetUploadSignDto } from './dto/get-upload-sign.dto';

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
   * Why not always use COS pre-signed PUT (the older `/upload/sign`)?
   * Because a fresh open-source clone has no COS credentials, and
   * pre-signed URLs require those credentials at sign time. Routing
   * through the backend lets us auto-fall-back to DashScope's free
   * temp bucket so the box is usable end-to-end with just a
   * DASHSCOPE_API_KEY.
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

  /**
   * @deprecated Use POST /upload/file instead. Kept around because some
   * older clients still cache this endpoint; will be removed in v0.2.
   *
   * Returns a COS-signed PUT URL — only works when COS is configured.
   * If COS is missing, the call fails (intentionally — clients should
   * have moved to /upload/file by now).
   */
  @Post('sign')
  async getUploadSign(@Body() dto: GetUploadSignDto) {
    return this.uploadService.getUploadSign(dto);
  }
}
