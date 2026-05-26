import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { VolcengineAssetService } from './volcengine-asset.service';
import {
  CreateAssetDto,
  ListAssetsQueryDto,
} from './dto/asset.dto';

/**
 * REST surface for the renderer-side 素材库 (asset library) UI.
 *
 * Sits under `/api/volcengine/assets` to keep vendor-scoped endpoints
 * separated from the canvas / admin-config ones:
 *
 *   POST   /api/volcengine/assets         → create (proxy CreateAsset)
 *   GET    /api/volcengine/assets         → list (page/size/filter)
 *   GET    /api/volcengine/assets/:id     → get one (status polling)
 *   DELETE /api/volcengine/assets/:id     → delete
 *
 * Auth: piggybacks on the shared VolcengineConfigService apiKey — no
 * separate session, no per-user assets. Single-user desktop assumption.
 */
@Controller('api/volcengine/assets')
export class VolcengineAssetController {
  constructor(private readonly assets: VolcengineAssetService) {}

  @Post()
  async create(@Body() dto: CreateAssetDto) {
    return this.assets.create(dto);
  }

  /**
   * Query string: `pageNumber`, `pageSize`, optional `status` / `assetType`.
   * Server clamps `pageSize` to ≤ 100 (matches upstream limit).
   */
  @Get()
  async list(@Query() query: ListAssetsQueryDto) {
    return this.assets.list({
      ...query,
      pageNumber: query.pageNumber ? Number(query.pageNumber) : undefined,
      pageSize: query.pageSize ? Number(query.pageSize) : undefined,
    });
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return this.assets.get(id);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    await this.assets.delete(id);
    return { success: true };
  }
}
