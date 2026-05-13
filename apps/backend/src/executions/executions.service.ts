import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { FlowsService } from '../flows/flows.service';
import { ExecuteFlowDto } from './dto/execute-flow.dto';
import { ExecutionTask, BatchProgressDto } from './dto/execute-response.dto';
import { v4 as uuidv4 } from 'uuid';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QueryExecutionsDto, EXECUTION_STATUSES, ExecutionStatus } from './dto/query-executions.dto';
import { ExecutionEventsService } from './execution-events.service';
import { ParamsBuilderService } from './params-builder.service';
import { ModelResolverService } from './model-resolver.service';
import { FlowNodeParamsService } from '../flows/flow-node-params.service';
import { ProviderRegistry } from '../providers/provider-registry.service';
import type { PollResult, ProviderClient, ProviderUsage, SubmitResult } from '../providers/provider.types';
import { inferModelKind } from './model-kind';
import { GenerationHistoryService } from '../generation-history/generation-history.service';
import type { HistoryNodeType } from '../generation-history/dto/query-history.dto';

const HISTORY_NODE_TYPES = new Set<HistoryNodeType>(['image', 'video', 'audio', 'text']);

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

type ExecutionPhase = 'submitting' | 'submitted' | 'polling' | 'completed' | 'failed';

/** Cap snippet at 2KB JSON to keep failure rows scannable. */
const SNIPPET_MAX_BYTES = 2048;

/**
 * Sanitize a failure payload before persisting to FlowExecutionEvent.
 * Drops auth-ish keys, stringifies non-JSON, and truncates oversized output.
 * `undefined` / `null` short-circuit to `null` so callers don't have to guard.
 */
/**
 * Map a ProviderUsage into the fixed columns on flow_executions.
 *
 * Open-source build does NOT compute `cost` at execution time. Pricing is
 * a deployment-private concern (varies by SKU and tier) and best derived
 * from per-kind units + `modelSku` at billing time.
 *
 * Each kind populates its OWN column so `SUM` per-kind is unambiguous:
 *   chat  → inputTokens / outputTokens
 *   video → outputDurationSec  (output video seconds)
 *   audio → outputDurationSec  (synthesized audio seconds)
 *   image → outputCount        (number of images)
 *
 * Earlier the bridge multiplexed everything onto `inputTokens` which made
 * the admin overview show e.g. "5 input tokens" for a video that was
 * actually 5 seconds long. New code MUST keep these columns disjoint by
 * kind so reporting stays honest.
 */
function usageToPatch(usage?: ProviderUsage): Prisma.FlowExecutionUpdateInput {
  if (!usage) return {};
  const patch: Prisma.FlowExecutionUpdateInput = {};
  if (typeof usage.inputTokens === 'number') patch.inputTokens = usage.inputTokens;
  if (typeof usage.outputTokens === 'number') patch.outputTokens = usage.outputTokens;
  if (typeof usage.videoDurationSec === 'number') patch.outputDurationSec = usage.videoDurationSec;
  else if (typeof usage.audioDurationSec === 'number') patch.outputDurationSec = usage.audioDurationSec;
  if (typeof usage.imageCount === 'number') patch.outputCount = usage.imageCount;
  return patch;
}

function sanitizeSnippet(payload: unknown): Prisma.InputJsonValue | null {
  if (payload === undefined || payload === null) return null;

  const sensitive = new Set(['authorization', 'api_key', 'apikey', 'token', 'access_token']);
  const walk = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(walk);
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = sensitive.has(k.toLowerCase()) ? '***' : walk(val);
    }
    return out;
  };

  let normalized: unknown;
  if (typeof payload === 'string') {
    try {
      normalized = JSON.parse(payload);
    } catch {
      normalized = { raw: payload };
    }
  } else if (payload instanceof Error) {
    normalized = { message: payload.message, name: payload.name };
  } else {
    normalized = payload;
  }

  const cleaned = walk(normalized);
  const json = JSON.stringify(cleaned);
  if (json.length <= SNIPPET_MAX_BYTES) return cleaned as Prisma.InputJsonValue;
  return { truncated: true, head: json.slice(0, SNIPPET_MAX_BYTES) } as Prisma.InputJsonValue;
}

@Injectable()
export class ExecutionsService {
  private readonly logger = new Logger(ExecutionsService.name);

  constructor(
    private readonly flowsService: FlowsService,
    private readonly prisma: PrismaService,
    private readonly events: ExecutionEventsService,
    private readonly paramsBuilder: ParamsBuilderService,
    private readonly modelResolver: ModelResolverService,
    private readonly nodeParamsService: FlowNodeParamsService,
    private readonly providers: ProviderRegistry,
    private readonly history: GenerationHistoryService,
  ) {}

  /**
   * Best-effort write to the generation history table after a node finishes
   * successfully. Failures are swallowed inside `history.record` itself, so
   * an outage of the history table never blocks the generation flow.
   */
  private async recordHistoryIfApplicable(
    nodeType: string,
    resultData: Record<string, any>,
    params: Record<string, any>,
    modelName: string | null,
    executionId: string,
  ): Promise<void> {
    if (!HISTORY_NODE_TYPES.has(nodeType as HistoryNodeType)) return;
    const historyType = nodeType as HistoryNodeType;
    const promptText =
      typeof params?.prompt === 'string' && params.prompt.trim()
        ? params.prompt.trim()
        : typeof resultData?.text === 'string' && resultData.text.trim()
          ? resultData.text.trim()
          : null;
    const src = typeof resultData?.src === 'string' && resultData.src ? resultData.src : null;
    await this.history.record({
      nodeType: historyType,
      thumbnail: historyType === 'image' || historyType === 'video' ? src : null,
      promptText,
      modelName,
      src,
      outputData: resultData,
      params,
      executionId,
    });
  }

  async listExecutions(query: QueryExecutionsDto) {
    const { canvasId, batchId, nodeId, status, modelName, modelSku, modeId, phase, startDate, endDate } = query;
    const page = query.page || 1;
    const limit = query.limit || 20;

    const where: Prisma.FlowExecutionWhereInput = {};

    if (canvasId) where.flowId = canvasId;
    if (batchId) where.batchId = batchId;
    if (nodeId) where.nodeId = nodeId;
    if (modelName) where.modelName = modelName;
    if (modelSku) where.modelSku = modelSku;
    if (modeId) where.modeId = modeId;

    if (status) {
      const parts = status.split(',').map((s) => s.trim()).filter(Boolean);
      where.status = parts.length === 1 ? parts[0] : { in: parts };
    }

    if (phase) {
      const parts = phase.split(',').map((s) => s.trim()).filter(Boolean);
      where.phase = parts.length === 1 ? parts[0] : { in: parts };
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [total, items] = await Promise.all([
      this.prisma.flowExecution.count({ where }),
      this.prisma.flowExecution.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      items,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string) {
    return this.prisma.flowExecution.findUnique({ where: { id } });
  }

  /**
   * Aggregate per-status counts for a batch, used by the frontend progress
   * indicator (e.g. "3/5 done"). Returns zeros when the batch does not
   * exist so the UI can still render without a 404.
   */
  async getBatchProgress(batchId: string): Promise<BatchProgressDto> {
    const grouped = await this.prisma.flowExecution.groupBy({
      by: ['status'],
      where: { batchId },
      _count: { _all: true },
    });

    const counts: Record<ExecutionStatus, number> = {
      PENDING: 0,
      RUNNING: 0,
      COMPLETED: 0,
      FAILED: 0,
    };
    for (const row of grouped) {
      const key = row.status as ExecutionStatus;
      if (EXECUTION_STATUSES.includes(key)) counts[key] = row._count._all;
    }

    const total = counts.PENDING + counts.RUNNING + counts.COMPLETED + counts.FAILED;
    return {
      batchId,
      total,
      pending: counts.PENDING,
      running: counts.RUNNING,
      completed: counts.COMPLETED,
      failed: counts.FAILED,
      done: total > 0 && counts.PENDING === 0 && counts.RUNNING === 0,
    };
  }

  async execute(dto: ExecuteFlowDto, isSyncMode = false): Promise<ExecutionTask[]> {
    this.logger.log(
      `收到执行请求: canvasId=${dto.canvasId}` +
      (dto.groupId ? `, groupId=${dto.groupId}` : '') +
      (dto.targetNodeId ? `, targetNodeId=${dto.targetNodeId}` : '') +
      (isSyncMode ? ' (同步模式)' : ' (异步模式)')
    );

    if (!dto.groupId && !dto.targetNodeId) {
      throw new BadRequestException('必须提供 groupId 或 targetNodeId');
    }

    const flow = await this.flowsService.findOne(dto.canvasId);
    const structure = flow.structureJson as any;
    const nodes = structure.nodes || [];
    const edges = structure.edges || [];

    if (dto.groupId) {
      return this.executeGroup(dto, nodes, edges, isSyncMode);
    } else {
      return this.executeSingleNode(dto, nodes, edges, isSyncMode);
    }
  }

  private async executeSingleNode(
    dto: ExecuteFlowDto, nodes: any[], edges: any[], isSyncMode: boolean,
  ): Promise<ExecutionTask[]> {
    const { targetNodeId } = dto;
    if (!targetNodeId) throw new BadRequestException('targetNodeId is required');
    return this.executeGroupNodes(dto, [targetNodeId], nodes, edges, isSyncMode);
  }

  private async executeGroup(
    dto: ExecuteFlowDto, nodes: any[], edges: any[], isSyncMode: boolean,
  ): Promise<ExecutionTask[]> {
    const { groupId } = dto;
    const groupNodes = nodes.filter(n => n.groupId === groupId);
    
    if (groupNodes.length === 0) {
      throw new BadRequestException(`编组 ${groupId} 内没有节点`);
    }

    const nodeIds = new Set(groupNodes.map(n => n.id));
    const groupEdges = edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));
    const executionOrder = this.topologicalSortExcludingRoots(groupNodes, groupEdges);

    this.logger.log(`编组 ${groupId} 执行顺序: ${executionOrder.join(' → ')}`);

    if (executionOrder.length === 0) {
      return [] as any;
    }

    return this.executeGroupNodes(dto, executionOrder, nodes, edges, isSyncMode);
  }

  private async executeGroupNodes(
    dto: ExecuteFlowDto, nodeIds: string[], allNodes: any[], edges: any[], isSyncMode: boolean,
  ): Promise<ExecutionTask[]> {
    const { canvasId } = dto;
    const batchId = nodeIds.length > 1 ? uuidv4() : null;

    const executions = await Promise.all(
      nodeIds.map(nodeId =>
        this.prisma.flowExecution.create({
          data: {
            id: uuidv4(),
            flowId: canvasId,
            nodeId,
            batchId,
            status: 'PENDING',
            createdAt: new Date(),
          },
        })
      )
    );

    // Notify SSE subscribers about all PENDING rows immediately so the
    // frontend can render loading state for every node in the batch even
    // before runNodeExecution acquires its first slot.
    for (const exec of executions) {
      this.events.emit({
        executionId: exec.id,
        flowId: canvasId,
        nodeId: exec.nodeId!,
        batchId: exec.batchId,
        status: 'PENDING',
      });
    }

    const tasks: ExecutionTask[] = executions.map(exec => ({
      executionId: exec.id,
      nodeId: exec.nodeId!,
      status: 'PENDING',
      batchId: exec.batchId,
    }));

    if (!isSyncMode) {
      this.executeNodesInBackground(canvasId, nodeIds, executions, edges)
        .catch(err => this.logger.error(`后台执行失败: ${err.message}`));
      return tasks;
    }

    await this.executeNodesInBackground(canvasId, nodeIds, executions, edges);

    const updatedExecutions = await this.prisma.flowExecution.findMany({
      where: { id: { in: executions.map(e => e.id) } },
    });

    return updatedExecutions.map(exec => ({
      executionId: exec.id,
      nodeId: exec.nodeId!,
      status: exec.status as ExecutionTask['status'],
      batchId: exec.batchId,
    }));
  }

  private topologicalSortExcludingRoots(nodes: any[], edges: any[]): string[] {
    const graph = new Map<string, string[]>();
    const inDegree = new Map<string, number>();
    
    nodes.forEach(n => {
      graph.set(n.id, []);
      inDegree.set(n.id, 0);
    });
    
    edges.forEach(e => {
      const neighbors = graph.get(e.source) || [];
      neighbors.push(e.target);
      graph.set(e.source, neighbors);
      inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1);
    });
    
    const rootNodes: string[] = [];
    inDegree.forEach((degree, nodeId) => {
      if (degree === 0) rootNodes.push(nodeId);
    });
    
    const queue: string[] = [...rootNodes];
    const result: string[] = [];
    
    while (queue.length > 0) {
      const current = queue.shift()!;
      result.push(current);
      
      const neighbors = graph.get(current) || [];
      neighbors.forEach(neighbor => {
        const newDegree = (inDegree.get(neighbor) || 0) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) queue.push(neighbor);
      });
    }
    
    if (result.length !== nodes.length) {
      throw new Error('图中存在环，无法执行');
    }
    
    return result.filter(nodeId => !rootNodes.includes(nodeId));
  }

  /**
   * Event-driven concurrent executor.
   *
   * Each node owns a Promise that:
   *   1. awaits the Promises of its in-batch upstream nodes,
   *   2. then runs runNodeExecution.
   *
   * Sibling nodes at the same topological depth therefore run truly in
   * parallel (no for-await serial bottleneck). An upstream failure is
   * surfaced through `Promise.allSettled` so we still mark the dependent
   * node as FAILED without making the API call. Sibling failures are
   * isolated — they don't abort other branches.
   */
  private async executeNodesInBackground(
    flowId: string,
    executionOrder: string[],
    executions: { id: string; nodeId: string | null; batchId: string | null }[],
    edges: any[],
  ) {
    const edgeMap = new Map<string, string[]>();
    edges.forEach(edge => {
      if (!edgeMap.has(edge.target)) edgeMap.set(edge.target, []);
      edgeMap.get(edge.target)!.push(edge.source);
    });

    const executionNodeSet = new Set(executionOrder);
    const nodePromises = new Map<string, Promise<void>>();

    for (const nodeId of executionOrder) {
      const execution = executions.find(e => e.nodeId === nodeId);
      if (!execution) continue;

      const upstreamNodeIds = (edgeMap.get(nodeId) || []).filter(id => executionNodeSet.has(id));
      const upstreamPromises = upstreamNodeIds
        .map(id => nodePromises.get(id))
        .filter((p): p is Promise<void> => p !== undefined);

      const task = (async () => {
        const upstreamResults = await Promise.allSettled(upstreamPromises);
        const failed = upstreamResults.find(r => r.status === 'rejected');

        if (failed) {
          await this.markExecutionFailed(
            execution.id,
            flowId,
            nodeId,
            execution.batchId,
            '上游节点执行失败',
          );
          throw new Error(`upstream failed for node ${nodeId}`);
        }

        await this.runNodeExecution(
          execution.id,
          flowId,
          nodeId,
          execution.batchId,
          edges,
        );
      })();

      nodePromises.set(nodeId, task);
    }

    await Promise.allSettled(Array.from(nodePromises.values()));
  }

  /**
   * Single status transition: persist + broadcast in one place so the SSE
   * channel never drifts from the DB.
   */
  private async transitionStatus(
    executionId: string,
    flowId: string,
    nodeId: string,
    batchId: string | null,
    status: 'RUNNING' | 'COMPLETED' | 'FAILED',
    patch: Prisma.FlowExecutionUpdateInput,
    eventExtras: Pick<{ errorMsg: string; latencyMs: number }, never> & {
      errorMsg?: string | null;
      latencyMs?: number | null;
    } = {},
  ) {
    await this.prisma.flowExecution.update({
      where: { id: executionId },
      data: { ...patch, status },
    });
    this.events.emit({
      executionId,
      flowId,
      nodeId,
      batchId,
      status,
      errorMsg: eventExtras.errorMsg ?? null,
      latencyMs: eventExtras.latencyMs ?? null,
    });
  }

  /**
   * Record one fine-grained lifecycle event AND patch flow_executions.phase
   * (plus externalTaskId on first submit) atomically. Polling phase only
   * needs to be called when the upstream status string actually changes;
   * `pollExternalTask` enforces this so the events table stays compact.
   */
  private async recordPhase(
    executionId: string,
    phase: ExecutionPhase,
    opts: {
      attempt?: number | null;
      externalStatus?: string | null;
      message?: string | null;
      externalTaskId?: string | null;
      payloadSnippet?: unknown;
    } = {},
  ): Promise<void> {
    const trimmedMsg =
      typeof opts.message === 'string' && opts.message.length > 1024
        ? opts.message.slice(0, 1024)
        : opts.message ?? null;

    await this.prisma.$transaction([
      this.prisma.flowExecutionEvent.create({
        data: {
          executionId,
          phase,
          attempt: opts.attempt ?? null,
          externalStatus: opts.externalStatus ?? null,
          message: trimmedMsg,
          payloadSnippet: (opts.payloadSnippet as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        },
      }),
      this.prisma.flowExecution.update({
        where: { id: executionId },
        data: {
          phase,
          ...(opts.externalTaskId ? { externalTaskId: opts.externalTaskId } : {}),
        },
      }),
    ]);
  }

  private async markExecutionFailed(
    executionId: string,
    flowId: string,
    nodeId: string,
    batchId: string | null,
    message: string,
    payloadSnippet?: unknown,
  ) {
    await this.transitionStatus(
      executionId,
      flowId,
      nodeId,
      batchId,
      'FAILED',
      { errorMsg: message, finishedAt: new Date() },
      { errorMsg: message },
    );
    await this.recordPhase(executionId, 'failed', {
      message,
      payloadSnippet: sanitizeSnippet(payloadSnippet),
    });
  }

  private async runNodeExecution(
    executionId: string,
    flowId: string,
    nodeId: string,
    batchId: string | null,
    edges: any[],
  ) {
    this.logger.log(`开始执行节点: executionId=${executionId}, nodeId=${nodeId}`);

    try {
      const flow = await this.flowsService.findOne(flowId);
      const structure = flow.structureJson as any;
      const node = structure.nodes.find((n: any) => n.id === nodeId);
      if (!node) throw new Error(`节点不存在: ${nodeId}`);

      // 解析 family + mode → modelName / modelSku / modeId，从 RUNNING 起就写入，
      // 失败/超时也能在 flow_executions 行里查到当时跑的是哪个 SKU。
      const currentParams = await this.nodeParamsService.getNodeParams(flowId, nodeId);
      const params = currentParams?.params || {};
      const resolved = await this.modelResolver.resolve(node.type, params as Record<string, any>);

      await this.transitionStatus(
        executionId,
        flowId,
        nodeId,
        batchId,
        'RUNNING',
        {
          startedAt: new Date(),
          modelName: resolved.modelName,
          modelSku: resolved.modelSku,
          modeId: resolved.modeId,
          kind: inferModelKind(resolved.modelSku),
        },
      );

      const upstreamNodeIds = edges
        .filter(e => e.target === nodeId)
        .map(e => e.source);

      const execRequest = await this.paramsBuilder.buildExecutionParams(flowId, nodeId, node.type, upstreamNodeIds);

      const provider = this.providers.resolve(resolved.modelSku);
      const submitReq = {
        requestId: execRequest.requestId,
        modelSku: resolved.modelSku ?? resolved.modelName ?? 'unknown',
        modelName: resolved.modelName ?? '',
        prompt: execRequest.prompt ?? '',
        inputs: execRequest.inputs ?? [],
        extraParams: execRequest.extraParams ?? {},
      };

      await this.recordPhase(executionId, 'submitting', {
        message: `submit via ${provider.name}: ${submitReq.modelSku}`,
      });

      const startTime = Date.now();
      let submitResult: SubmitResult;
      try {
        submitResult = await provider.submit(submitReq);
      } catch (submitErr: any) {
        submitErr.payloadSnippet =
          submitErr.payloadSnippet ?? submitErr?.response?.data ?? submitErr?.message;
        throw submitErr;
      }
      const latencyMs = Date.now() - startTime;

      if (submitResult.status === 'pending') {
        const taskId = submitResult.taskId ?? submitReq.requestId;
        if (!taskId) throw new Error('Provider returned no task id, cannot poll');
        await this.recordPhase(executionId, 'submitted', {
          externalTaskId: taskId,
          externalStatus: 'pending',
          message: `task accepted via ${provider.name}, polling taskId=${taskId}`,
        });
        await this.pollProviderTask(
          executionId,
          flowId,
          nodeId,
          batchId,
          node.type,
          provider,
          taskId,
          params as Record<string, any>,
          resolved.modelSku ?? resolved.modelName ?? null,
        );
      } else if (submitResult.status === 'completed') {
        const resultData = await this.paramsBuilder.saveExecutionResult(
          flowId,
          nodeId,
          node.type,
          submitResult,
          executionId,
        );

        await this.transitionStatus(
          executionId,
          flowId,
          nodeId,
          batchId,
          'COMPLETED',
          {
            finishedAt: new Date(),
            responsePayload: (submitResult.raw ?? submitResult) as any,
            latencyMs,
            ...usageToPatch(submitResult.usage),
          },
          { latencyMs },
        );
        await this.recordPhase(executionId, 'completed', {
          externalStatus: 'completed',
          message: `${provider.name} sync completed in ${latencyMs}ms`,
        });

        await this.recordHistoryIfApplicable(
          node.type,
          resultData,
          params as Record<string, any>,
          resolved.modelSku ?? resolved.modelName ?? null,
          executionId,
        );

        this.logger.log(
          `节点执行成功: executionId=${executionId}, sku=${resolved.modelSku ?? 'unknown'}, mode=${resolved.modeId ?? '-'}, 耗时=${latencyMs}ms`,
        );
      } else {
        // status === 'failed'
        const err: any = new Error(submitResult.errorMessage ?? 'submit failed');
        err.payloadSnippet = submitResult.raw ?? submitResult.errorMessage;
        throw err;
      }
    } catch (error: any) {
      this.logger.error(`节点执行失败: executionId=${executionId}, error=${error.message}`);
      await this.markExecutionFailed(
        executionId,
        flowId,
        nodeId,
        batchId,
        error.message,
        error.payloadSnippet,
      );
      throw error;
    }
  }

  /**
   * Poll the upstream task through the same provider that submitted it.
   *
   * Records one FlowExecutionEvent per upstream status transition (not per
   * poll attempt), plus a `completed` event at terminal success. Failures
   * are thrown so the outer `runNodeExecution` catch can persist them as
   * `failed` events via `markExecutionFailed`.
   */
  private async pollProviderTask(
    executionId: string,
    flowId: string,
    nodeId: string,
    batchId: string | null,
    nodeType: string,
    provider: ProviderClient,
    taskId: string,
    params: Record<string, any>,
    modelName: string | null,
  ) {
    let attempts = 0;
    const maxAttempts = 1800;
    const startTime = Date.now();
    let lastStatus: string | null = 'pending';

    while (attempts < maxAttempts) {
      let pollResult: PollResult | null = null;
      try {
        pollResult = await provider.pollStatus(taskId);
      } catch (error: any) {
        this.logger.warn(`[轮询] 第 ${attempts} 次错误: ${error?.message ?? error}`);
        attempts++;
        await delay(1000);
        continue;
      }

      attempts++;

      const newStatus = pollResult.status;
      if (newStatus !== lastStatus && newStatus !== 'completed' && newStatus !== 'failed') {
        await this.recordPhase(executionId, 'polling', {
          attempt: attempts,
          externalStatus: newStatus,
          message: `${provider.name}: ${lastStatus ?? '-'} -> ${newStatus}`,
        });
        lastStatus = newStatus;
      }

      if (newStatus === 'completed') {
        const latencyMs = Date.now() - startTime;
        this.logger.log(
          `轮询完成: provider=${provider.name} taskId=${taskId} 次数=${attempts} 耗时=${latencyMs}ms`,
        );

        const resultData = await this.paramsBuilder.saveExecutionResult(
          flowId,
          nodeId,
          nodeType,
          pollResult,
          executionId,
        );

        await this.transitionStatus(
          executionId,
          flowId,
          nodeId,
          batchId,
          'COMPLETED',
          {
            finishedAt: new Date(),
            responsePayload: (pollResult.raw ?? pollResult) as any,
            latencyMs,
            ...usageToPatch(pollResult.usage),
          },
          { latencyMs },
        );
        await this.recordPhase(executionId, 'completed', {
          attempt: attempts,
          externalStatus: 'completed',
          message: `polling completed after ${attempts} attempts (${latencyMs}ms)`,
        });

        await this.recordHistoryIfApplicable(
          nodeType,
          resultData,
          params,
          modelName,
          executionId,
        );

        return;
      }

      if (newStatus === 'failed') {
        const err: any = new Error(pollResult.errorMessage ?? '外部任务执行失败');
        err.payloadSnippet = pollResult.raw ?? pollResult.errorMessage;
        throw err;
      }

      await delay(1000);
    }

    const timeoutErr: any = new Error(`外部任务超时: provider=${provider.name} taskId=${taskId}`);
    timeoutErr.payloadSnippet = { provider: provider.name, taskId, attempts, lastStatus };
    throw timeoutErr;
  }

}
