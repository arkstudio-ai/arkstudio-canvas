import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateViduAssetDto, UpdateViduAssetDto, ViduAssetType } from './dto/vidu-asset.dto';

@Injectable()
export class ViduAssetService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateViduAssetDto) {
    return this.prisma.viduAsset.create({
      data: {
        type: dto.type,
        name: dto.name,
        description: dto.description,
        imageUrl: dto.imageUrl,
      },
    });
  }

  async findAll(type?: ViduAssetType) {
    return this.prisma.viduAsset.findMany({
      where: type ? { type } : undefined,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string) {
    const asset = await this.prisma.viduAsset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundException(`ViduAsset ${id} not found`);
    return asset;
  }

  async findByIds(ids: string[]) {
    if (ids.length === 0) return [];
    return this.prisma.viduAsset.findMany({
      where: { id: { in: ids } },
    });
  }

  async update(id: string, dto: UpdateViduAssetDto) {
    await this.findById(id);
    return this.prisma.viduAsset.update({
      where: { id },
      data: {
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.imageUrl !== undefined && { imageUrl: dto.imageUrl }),
      },
    });
  }

  async remove(id: string) {
    await this.findById(id);
    return this.prisma.viduAsset.delete({ where: { id } });
  }
}
