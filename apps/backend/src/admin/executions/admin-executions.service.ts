import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EXECUTION_STATUSES, type ExecutionStatus } from '../../executions/dto/query-executions.dto';
import { MODEL_KINDS, inferModelKind, type ModelKind } from '../../executions/model-kind';

export type UsageRange = 'today' | 'week' | 'month';

export interface KindBucket {
  kind: ModelKind | 'unknown';
  count: number;
  completed: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  outputDurationSec: number;
  outputCount: number;
}

export interface ModelRow {
  modelName: string;
  kind: ModelKind | 'unknown';
  count: number;
  completed: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  outputDurationSec: number;
  outputCount: number;
}

export interface UsageOverview {
  range: UsageRange;
  rangeStart: string;
  rangeEnd: string;
  totals: {
    count: number;
    countByStatus: Record<ExecutionStatus, number>;
  };
  byKind: KindBucket[];
  byModel: ModelRow[];
}

/**
 * Admin-side aggregate queries on top of `flow_executions` /
 * `flow_execution_events`. Frontend `editor` keeps using
 * `ExecutionsService.listExecutions` for in-flight recovery; this service
 * exists so the admin / 后台 surface can grow (more aggregations,
 * cross-table joins, expensive analytics) without bloating the
 * orchestrator.
 */
@Injectable()
export class AdminExecutionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Single execution with all its phase events appended. Avoids the
   * N+1 follow-up request the frontend would otherwise make to render
   * the detail drawer.
   */
  async findOneWithEvents(id: string) {
    const execution = await this.prisma.flowExecution.findUnique({ where: { id } });
    if (!execution) return null;
    const events = await this.prisma.flowExecutionEvent.findMany({
      where: { executionId: id },
      orderBy: { createdAt: 'asc' },
    });
    return { ...execution, events };
  }

  /**
   * Per-kind aggregate so the admin Usage page can display each kind's
   * billable unit in its own column instead of jamming everything into
   * `tokens` (e.g. video shouldn't show "5 input tokens" when the upstream
   * meaning is "5 seconds of generated video").
   *
   * Two passes:
   *   1. groupBy(kind × status) → bucket per kind w/ unit sums for KPI cards
   *   2. groupBy(modelName × status) → per-model rows; kind is re-inferred
   *      from modelName because old rows (or backfills) may have null kind
   */
  async getUsageOverview(range: UsageRange): Promise<UsageOverview> {
    const { rangeStart, rangeEnd } = this.resolveRange(range);

    const where: Prisma.FlowExecutionWhereInput = {
      createdAt: { gte: rangeStart, lte: rangeEnd },
    };

    const [count, byStatus, byKindStatus, byModelStatus] = await Promise.all([
      this.prisma.flowExecution.count({ where }),
      this.prisma.flowExecution.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
      this.prisma.flowExecution.groupBy({
        by: ['kind', 'status'],
        where,
        _count: { _all: true },
        _sum: {
          inputTokens: true,
          outputTokens: true,
          outputDurationSec: true,
          outputCount: true,
        },
      }),
      this.prisma.flowExecution.groupBy({
        by: ['modelName', 'modelSku', 'kind', 'status'],
        where: { ...where, modelName: { not: null } },
        _count: { _all: true },
        _sum: {
          inputTokens: true,
          outputTokens: true,
          outputDurationSec: true,
          outputCount: true,
        },
      }),
    ]);

    return {
      range,
      rangeStart: rangeStart.toISOString(),
      rangeEnd: rangeEnd.toISOString(),
      totals: {
        count,
        countByStatus: this.tallyStatus(byStatus),
      },
      byKind: this.tallyKindBuckets(byKindStatus),
      byModel: this.tallyModelRows(byModelStatus),
    };
  }

  private tallyStatus(
    rows: Array<{ status: string; _count: { _all: number } }>,
  ): Record<ExecutionStatus, number> {
    const counts: Record<ExecutionStatus, number> = {
      PENDING: 0,
      RUNNING: 0,
      COMPLETED: 0,
      FAILED: 0,
    };
    for (const row of rows) {
      const key = row.status as ExecutionStatus;
      if (EXECUTION_STATUSES.includes(key)) counts[key] = row._count._all;
    }
    return counts;
  }

  private tallyKindBuckets(
    rows: Array<{
      kind: string | null;
      status: string;
      _count: { _all: number };
      _sum: {
        inputTokens: number | null;
        outputTokens: number | null;
        outputDurationSec: number | null;
        outputCount: number | null;
      };
    }>,
  ): KindBucket[] {
    const map = new Map<KindBucket['kind'], KindBucket>();
    // Pre-seed the four known kinds so the UI can render empty cards.
    for (const k of MODEL_KINDS) {
      map.set(k, this.emptyKindBucket(k));
    }
    for (const row of rows) {
      const kind: KindBucket['kind'] =
        (row.kind as ModelKind | null) ?? 'unknown';
      const cur = map.get(kind) ?? this.emptyKindBucket(kind);
      cur.count += row._count._all;
      if (row.status === 'COMPLETED') cur.completed += row._count._all;
      if (row.status === 'FAILED') cur.failed += row._count._all;
      cur.inputTokens += row._sum.inputTokens ?? 0;
      cur.outputTokens += row._sum.outputTokens ?? 0;
      cur.outputDurationSec += row._sum.outputDurationSec ?? 0;
      cur.outputCount += row._sum.outputCount ?? 0;
      map.set(kind, cur);
    }
    return Array.from(map.values());
  }

  private emptyKindBucket(kind: KindBucket['kind']): KindBucket {
    return {
      kind,
      count: 0,
      completed: 0,
      failed: 0,
      inputTokens: 0,
      outputTokens: 0,
      outputDurationSec: 0,
      outputCount: 0,
    };
  }

  private tallyModelRows(
    rows: Array<{
      modelName: string | null;
      modelSku: string | null;
      kind: string | null;
      status: string;
      _count: { _all: number };
      _sum: {
        inputTokens: number | null;
        outputTokens: number | null;
        outputDurationSec: number | null;
        outputCount: number | null;
      };
    }>,
  ): ModelRow[] {
    const map = new Map<string, ModelRow>();
    for (const row of rows) {
      const name = row.modelName ?? 'unknown';
      const cur =
        map.get(name) ??
        this.emptyModelRow(name, (row.kind as ModelKind | null) ?? inferModelKind(row.modelSku));
      cur.count += row._count._all;
      if (row.status === 'COMPLETED') cur.completed += row._count._all;
      if (row.status === 'FAILED') cur.failed += row._count._all;
      cur.inputTokens += row._sum.inputTokens ?? 0;
      cur.outputTokens += row._sum.outputTokens ?? 0;
      cur.outputDurationSec += row._sum.outputDurationSec ?? 0;
      cur.outputCount += row._sum.outputCount ?? 0;
      map.set(name, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }

  private emptyModelRow(modelName: string, kind: ModelKind | null): ModelRow {
    return {
      modelName,
      kind: kind ?? 'unknown',
      count: 0,
      completed: 0,
      failed: 0,
      inputTokens: 0,
      outputTokens: 0,
      outputDurationSec: 0,
      outputCount: 0,
    };
  }

  private resolveRange(range: UsageRange): { rangeStart: Date; rangeEnd: Date } {
    const now = new Date();
    const rangeEnd = new Date(now);
    const rangeStart = new Date(now);
    if (range === 'today') {
      rangeStart.setHours(0, 0, 0, 0);
    } else if (range === 'week') {
      rangeStart.setDate(rangeStart.getDate() - 7);
    } else {
      rangeStart.setDate(rangeStart.getDate() - 30);
    }
    return { rangeStart, rangeEnd };
  }
}
