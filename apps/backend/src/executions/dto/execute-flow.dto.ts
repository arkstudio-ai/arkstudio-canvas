import { IsString, IsOptional } from 'class-validator';

export class ExecuteFlowDto {
  @IsString()
  canvasId: string;

  @IsOptional()
  @IsString()
  targetNodeId?: string;

  @IsOptional()
  @IsString()
  groupId?: string;
}
