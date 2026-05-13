import { IsString, IsOptional, IsObject, IsNotEmpty, IsArray } from 'class-validator';

export class CreateTemplateDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  cover?: string;

  @IsObject()
  json: any;

  @IsString()
  flowId: string;

  @IsArray()
  @IsOptional()
  tags?: Array<{ category: string; value: string }>;
}
