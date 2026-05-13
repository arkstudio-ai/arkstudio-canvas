import { IsString, IsOptional, IsObject, IsNotEmpty } from 'class-validator';

export class CreateFlowDto {
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
  @IsOptional()
  initialGraph?: any;
}
