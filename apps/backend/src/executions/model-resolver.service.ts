import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Family logical model + sub-mode resolution.
 *
 * Frontend ModelChip lets users pick a logical model family (`params.model`),
 * e.g. `wan2.7`, and an in-family mode (`params.mode`), e.g. `r2v`. The
 * real DashScope SKU lives on `NodeDefinition.models[*].modes[*].sku`, e.g.
 * `wan2.7-r2v`. This service walks that table once per node execution and
 * returns the resolved triple, used both for the actual API call and for
 * audit logging in `flow_executions`.
 *
 * Single-mode legacy models (no `modes[]`) collapse to `modelSku = family.value`
 * with `modeId = null`.
 */
export interface ResolvedModel {
  /** Family logical id (= params.model) */
  modelName: string | null;
  /** Real provider SKU (= mode.sku, or family.value for single-mode) */
  modelSku: string | null;
  /** Mode id (= params.mode), null for single-mode models */
  modeId: string | null;
}

@Injectable()
export class ModelResolverService {
  private readonly logger = new Logger(ModelResolverService.name);

  constructor(private readonly prisma: PrismaService) {}

  async resolve(
    nodeType: string,
    params: Record<string, any>,
  ): Promise<ResolvedModel> {
    const modelName: string | null =
      typeof params.model === 'string' && params.model ? params.model : null;

    const def = await this.prisma.nodeDefinition.findUnique({
      where: { type: nodeType },
      select: { models: true },
    });

    const models = (def?.models ?? []) as Array<Record<string, any>>;
    if (!Array.isArray(models) || models.length === 0) {
      return { modelName, modelSku: null, modeId: null };
    }

    const family = modelName
      ? models.find((m) => m?.value === modelName)
      : null;
    if (!family) {
      // 未声明的 model 直接返回 family 标识；上游模型如纯 SKU 直接命中
      return { modelName, modelSku: modelName, modeId: null };
    }

    const modes: Array<Record<string, any>> = Array.isArray(family.modes)
      ? family.modes
      : [];

    // 单模式模型：SKU 就是 family.value
    if (modes.length === 0) {
      return {
        modelName,
        modelSku: typeof family.value === 'string' ? family.value : null,
        modeId: null,
      };
    }

    const requestedModeId =
      typeof params.mode === 'string' && params.mode ? params.mode : null;

    const mode =
      (requestedModeId && modes.find((m) => m?.id === requestedModeId)) ||
      (typeof family.defaultModeId === 'string' &&
        modes.find((m) => m?.id === family.defaultModeId)) ||
      modes[0];

    if (!mode) {
      this.logger.warn(
        `无法解析 mode: nodeType=${nodeType} model=${modelName} mode=${requestedModeId}`,
      );
      return { modelName, modelSku: null, modeId: requestedModeId };
    }

    return {
      modelName,
      modelSku: typeof mode.sku === 'string' ? mode.sku : null,
      modeId: typeof mode.id === 'string' ? mode.id : null,
    };
  }
}
