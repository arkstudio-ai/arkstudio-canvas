import { IsString, IsOptional, IsIn } from 'class-validator';

export const VIDU_ASSET_TYPES = ['character', 'scene', 'tool'] as const;
export type ViduAssetType = (typeof VIDU_ASSET_TYPES)[number];

export class CreateViduAssetDto {
  @IsIn(VIDU_ASSET_TYPES)
  type!: ViduAssetType;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  imageUrl!: string;
}

export class UpdateViduAssetDto {
  @IsOptional()
  @IsIn(VIDU_ASSET_TYPES)
  type?: ViduAssetType;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;
}
