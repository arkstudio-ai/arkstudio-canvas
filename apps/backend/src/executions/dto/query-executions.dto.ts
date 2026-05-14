import {
  IsString,
  IsOptional,
  IsDateString,
  IsInt,
  Min,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';

export const EXECUTION_STATUSES = [
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export const EXECUTION_PHASES = [
  'submitting',
  'submitted',
  'polling',
  'completed',
  'failed',
] as const;
export type ExecutionPhase = (typeof EXECUTION_PHASES)[number];

const STATUS_LIST_PATTERN =
  /^(PENDING|RUNNING|COMPLETED|FAILED)(,(PENDING|RUNNING|COMPLETED|FAILED))*$/;
const PHASE_LIST_PATTERN =
  /^(submitting|submitted|polling|completed|failed)(,(submitting|submitted|polling|completed|failed))*$/;

export class QueryExecutionsDto {
  @IsOptional()
  @IsString()
  canvasId?: string;

  @IsOptional()
  @IsString()
  batchId?: string;

  @IsOptional()
  @IsString()
  nodeId?: string;

  /**
   * Single status or comma-separated list, e.g. `PENDING` or `PENDING,RUNNING`.
   * Used by the frontend to recover in-flight executions after a reload.
   */
  @IsOptional()
  @IsString()
  @Matches(STATUS_LIST_PATTERN, {
    message:
      'status must be one or more of PENDING,RUNNING,COMPLETED,FAILED (comma-separated)',
  })
  status?: string;

  /**
   * Family logical model id (e.g. `wan2.7`, `qwen-plus`).
   * Backed by `flow_executions.modelName` indexed column.
   */
  @IsOptional()
  @IsString()
  modelName?: string;

  /**
   * Real DashScope SKU (e.g. `wan2.7-r2v`, `qwen-plus`).
   * Useful for digging into one specific mode's history.
   */
  @IsOptional()
  @IsString()
  modelSku?: string;

  /**
   * Mode id (e.g. `t2v`, `i2v`, `r2v`); null for single-mode models.
   */
  @IsOptional()
  @IsString()
  modeId?: string;

  /**
   * Phase filter for the admin logs page — single value or comma-separated
   * list. Mirrors `flow_executions.phase`.
   */
  @IsOptional()
  @IsString()
  @Matches(PHASE_LIST_PATTERN, {
    message:
      'phase must be one or more of submitting,submitted,polling,completed,failed',
  })
  phase?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

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
