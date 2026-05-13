/**
 * Execution task info returned to clients.
 *
 * `status` reflects the canonical FlowExecution.status values written by the
 * backend: PENDING → RUNNING → COMPLETED / FAILED.
 */
export interface ExecutionTask {
  executionId: string;
  nodeId: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  batchId?: string | null;
}

/**
 * POST /executions/execute response body (before the global response
 * interceptor wraps it). The controller returns an array of tasks directly;
 * the interceptor wraps the payload as `{ success, code, data }`.
 */
export type ExecuteResponseDto = ExecutionTask[];

/**
 * Aggregated batch progress, used by GET /executions/batch/:batchId/progress.
 */
export interface BatchProgressDto {
  batchId: string;
  total: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  done: boolean;
}
