import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ViduAssetService } from './vidu-asset.service';
import { CreateViduAssetDto, UpdateViduAssetDto } from './dto/vidu-asset.dto';
import type { ViduAssetType } from './dto/vidu-asset.dto';

@Controller('vidu-assets')
export class ViduAssetController {
  constructor(private readonly viduAssetService: ViduAssetService) {}

  @Post()
  create(@Body() dto: CreateViduAssetDto) {
    return this.viduAssetService.create(dto);
  }

  @Get()
  findAll(@Query('type') type?: ViduAssetType) {
    return this.viduAssetService.findAll(type);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.viduAssetService.findById(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateViduAssetDto) {
    return this.viduAssetService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.viduAssetService.remove(id);
  }
}
