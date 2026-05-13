import {
  Controller,
  Post,
  Body,
  Logger,
  Get,
  Query,
  Param,
  Sse,
  NotFoundException,
  MessageEvent,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { ExecutionsService } from './executions.service';
import { ExecutionEventsService } from './execution-events.service';
import { ExecuteFlowDto } from './dto/execute-flow.dto';
import { ExecutionTask, BatchProgressDto } from './dto/execute-response.dto';
import { QueryExecutionsDto } from './dto/query-executions.dto';

@Controller('executions')
export class ExecutionsController {
  private readonly logger = new Logger(ExecutionsController.name);

  constructor(
    private readonly executionsService: ExecutionsService,
    private readonly events: ExecutionEventsService,
  ) {}

  @Post('execute')
  async execute(
    @Body() dto: ExecuteFlowDto,
    @Query('mode') mode?: string,
  ): Promise<ExecutionTask[]> {
    const isSync = mode === 'sync';
    this.logger.log(
      `Received execution request for canvas ${dto.canvasId}, node ${dto.targetNodeId} (Sync: ${isSync})`,
    );
    return this.executionsService.execute(dto, isSync);
  }

  /**
   * Paginated execution history. `status` accepts a single value or a
   * comma-separated list (`PENDING,RUNNING`) so the frontend can recover
   * in-flight executions after a reload.
   */
  @Get()
  async listExecutions(@Query() query: QueryExecutionsDto) {
    return this.executionsService.listExecutions(query);
  }

  /**
   * SSE channel for live status updates. Subscribe with any combination of
   * `flowId`, `batchId`, or `executionId` — the server filters server-side
   * so the browser only receives events it cares about.
   *
   * The endpoint is mounted before `/:id` so Nest's path matcher doesn't
   * route `/stream` into `getExecution`.
   */
  @Sse('stream')
  stream(
    @Query('flowId') flowId?: string,
    @Query('batchId') batchId?: string,
    @Query('executionId') executionId?: string,
  ): Observable<MessageEvent> {
    return this.events.subscribe({ flowId, batchId, executionId });
  }

  /**
   * Aggregate progress for a batch (PENDING/RUNNING/COMPLETED/FAILED counts).
   * Cheap to poll from the UI and lets the frontend draw a "3/5 done" bar
   * without summing rows on the client.
   */
  @Get('batch/:batchId/progress')
  async getBatchProgress(@Param('batchId') batchId: string): Promise<BatchProgressDto> {
    return this.executionsService.getBatchProgress(batchId);
  }

  @Get(':id')
  async getExecution(@Param('id') id: string) {
    const execution = await this.executionsService.findOne(id);
    if (!execution) {
      throw new NotFoundException(`Execution ${id} not found`);
    }
    return execution;
  }

  @Get(':id/status')
  async getExecutionStatus(@Param('id') id: string) {
    const execution = await this.executionsService.findOne(id);
    if (!execution) {
      throw new NotFoundException(`Execution ${id} not found`);
    }
    return {
      id: execution.id,
      status: execution.status,
      errorMsg: execution.errorMsg,
      createdAt: execution.createdAt,
      finishedAt: execution.finishedAt,
    };
  }
}
