import { Controller, Post, Body } from '@nestjs/common';
import { UploadService } from './upload.service';
import { GetUploadSignDto } from './dto/get-upload-sign.dto';

@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  /**
   * 获取上传签名 URL
   * POST /api/upload/sign
   */
  @Post('sign')
  async getUploadSign(@Body() dto: GetUploadSignDto) {
    return this.uploadService.getUploadSign(dto);
  }
}
