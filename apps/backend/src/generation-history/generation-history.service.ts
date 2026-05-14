import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service';
import { HistoryRetentionService } from '../canvas-config/history-retention.service';
import type { QueryHistoryDto, HistoryNodeType } from './dto/query-history.dto';
import type { RecordHistoryDto } from './dto/record-history.dto';

/**
 * Open-source generation history.
 *
 * Lifecycle:
 *   1. Provider / executions code calls `record(...)` after a node finishes
 *      generating successfully. We don't record failures — `FlowExecutionEvent`
 *      already covers the audit trail.
 *   2. Frontend `<HistoryPanel>` (TODO) calls `query(...)` to list records,
 *      `instantiate(:id)` to drop the past output back onto the canvas,
 *      `remove(:id)` to delete a row.
 *
 * Open-source notes:
 *   - No userId / no ownership filter — every record is visible to every user
 *     of the deployment.
 *   - Lazy retention: every successful `record(...)` triggers a throttled
 *     `HistoryRetentionService.pruneIfNeeded()` so the table stays bounded
 *     without running a cron. Admin can also force a prune from the system
 *     settings page (`POST /api/canvas-flow/history-settings/prune`).
 */
@Injectable()
export class GenerationHistoryService {
  private readonly logger = new Logger(GenerationHistoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly retention: HistoryRetentionService,
  ) {}

  async query(dto: QueryHistoryDto) {
    const { nodeType, keyword, page = 1, limit = 20 } = dto;

    const where: Prisma.GenerationHistoryWhereInput = {};
    if (nodeType) where.nodeType = nodeType;
    if (keyword) {
      where.OR = [
        { promptText: { contains: keyword } },
        { modelName: { contains: keyword } },
      ];
    }

    const [total, items] = await Promise.all([
      this.prisma.generationHistory.count({ where }),
      this.prisma.generationHistory.findMany({
        where,
        select: {
          id: true,
          nodeType: true,
          thumbnail: true,
          promptText: true,
          modelName: true,
          width: true,
          height: true,
          createdAt: true,
        },
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

  async instantiate(id: string) {
    const row = await this.prisma.generationHistory.findUnique({
      where: { id },
    });
    if (!row) throw new NotFoundException(`History ${id} not found`);

    const newNodeId = uuidv4();
    const defaultDimensions = this.defaultDimensions(
      row.nodeType as HistoryNodeType,
    );
    const width = row.width || defaultDimensions.width;
    const height = row.height || defaultDimensions.height;

    return {
      id: newNodeId,
      type: row.nodeType,
      position: { x: 0, y: 0 },
      width,
      height,
      data: row.outputData ?? {},
      params: row.params ?? {},
      meta: {
        sourceHistoryId: row.id,
        createdAt: row.createdAt.toISOString(),
      },
    };
  }

  async remove(id: string) {
    const row = await this.prisma.generationHistory.findUnique({
      where: { id },
    });
    if (!row) throw new NotFoundException(`History ${id} not found`);
    await this.prisma.generationHistory.delete({ where: { id } });
  }

  /**
   * Persist a single successful node generation. Called from the executions /
   * providers layer; never reached via HTTP. Returns the created row id so
   * the caller can attach it to logs.
   */
  async record(dto: RecordHistoryDto): Promise<string | null> {
    if (!dto.nodeType) {
      this.logger.warn('[GenerationHistory.record] missing nodeType, skip');
      return null;
    }
    try {
      const row = await this.prisma.generationHistory.create({
        data: {
          nodeType: dto.nodeType,
          thumbnail: dto.thumbnail ?? null,
          promptText: dto.promptText ?? null,
          modelName: dto.modelName ?? null,
          width: dto.width ?? 0,
          height: dto.height ?? 0,
          src: dto.src ?? null,
          outputData:
            (dto.outputData as Prisma.InputJsonValue) ?? Prisma.JsonNull,
          params: (dto.params as Prisma.InputJsonValue) ?? Prisma.JsonNull,
          executionId: dto.executionId ?? null,
        },
        select: { id: true },
      });
      // Throttled inline cleanup. Awaited but it bails out cheaply when the
      // 10-min window hasn't elapsed, so high-frequency writes don't pay.
      await this.retention.pruneIfNeeded();
      return row.id;
    } catch (err) {
      // Recording failures must never break the calling generation flow.
      this.logger.error(
        '[GenerationHistory.record] persist failed',
        err as Error,
      );
      return null;
    }
  }

  private defaultDimensions(type: HistoryNodeType): {
    width: number;
    height: number;
  } {
    switch (type) {
      case 'video':
      case 'image':
        return { width: 250, height: 250 };
      case 'audio':
        return { width: 250, height: 120 };
      case 'text':
      default:
        return { width: 320, height: 200 };
    }
  }
}
