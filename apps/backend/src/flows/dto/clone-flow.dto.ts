import { IsOptional, IsString } from 'class-validator';

export class CloneFlowDto {
  @IsOptional()
  @IsString()
  name?: string;
}
