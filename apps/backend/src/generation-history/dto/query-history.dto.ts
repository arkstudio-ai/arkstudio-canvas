import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export type HistoryNodeType = 'image' | 'video' | 'text' | 'audio';

export class QueryHistoryDto {
  @IsOptional()
  @IsEnum(['image', 'video', 'text', 'audio'] as const)
  nodeType?: HistoryNodeType;

  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;
}
