import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import axios from 'axios';
import { UploadService } from './upload.service';
import { STORAGE_DRIVER, type StorageDriver } from '../storage/storage-driver';

@Controller('upload')
export class UploadController {
  constructor(
    private readonly uploadService: UploadService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

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

  /**
   * Proxy download for cloud-stored resources.
   *
   * Frontend `fetch(tosUrl)` is blocked by CORS when the resource lives on
   * an external bucket (TOS / OSS). This endpoint fetches server-side and
   * streams back with `Content-Disposition: attachment`.
   *
   * Security: only URLs recognised by our storage driver (`ownsUrl`) are
   * accepted — this is NOT an open proxy.
   */
  @Get('download')
  async proxyDownload(
    @Query('url') url: string,
    @Res() res: Response,
  ) {
    if (!url) {
      throw new BadRequestException('missing "url" query parameter');
    }
    if (!this.storage.ownsUrl(url)) {
      throw new BadRequestException('url not recognized');
    }

    const upstream = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 60_000,
      maxContentLength: 200 * 1024 * 1024,
    });

    const contentType =
      upstream.headers['content-type'] || 'application/octet-stream';
    const baseName = decodeURIComponent(
      url.split('/').pop()?.split('?')[0] || 'download',
    );

    res.set({
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${baseName}"`,
      'Content-Length': String(Buffer.from(upstream.data).byteLength),
    });
    res.send(Buffer.from(upstream.data));
  }
}
