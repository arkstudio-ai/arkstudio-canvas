import { IsString, IsOptional, IsBoolean, IsArray } from 'class-validator';

export class UpdateTemplateDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  cover?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsArray()
  addTags?: Array<{ category: string; value: string }>;

  @IsOptional()
  @IsArray()
  removeTags?: Array<{ category: string; value: string }>;
}
