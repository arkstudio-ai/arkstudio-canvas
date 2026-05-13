import { IsInt, IsOptional, IsString, IsObject, Min } from 'class-validator';
import { Type } from 'class-transformer';
import type { HistoryNodeType } from './query-history.dto';

/**
 * Internal payload for `GenerationHistoryService.record`. Not exposed via HTTP
 * — it's invoked from the executions / providers code path after a node
 * generation succeeds. Kept as a class so the same validation pipeline
 * applies if we ever decide to surface a manual "record" endpoint for
 * imported assets.
 */
export class RecordHistoryDto {
  @IsString()
  nodeType!: HistoryNodeType;

  @IsOptional()
  @IsString()
  thumbnail?: string | null;

  @IsOptional()
  @IsString()
  promptText?: string | null;

  @IsOptional()
  @IsString()
  modelName?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  width?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  height?: number;

  @IsOptional()
  @IsString()
  src?: string | null;

  @IsOptional()
  @IsObject()
  outputData?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  executionId?: string;
}
