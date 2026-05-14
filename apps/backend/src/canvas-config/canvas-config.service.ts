import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  NodeDefinitionInput,
  SaveConfigResponse,
  ConfigVersionResponse,
} from './dto/save-config.dto';
import {
  CONFIG_EXPORT_SCHEMA,
  ConfigExportEnvelope,
  ImportConfigDto,
  ImportConfigResponse,
  normalizeImportEnvelope,
} from './dto/import-export-config.dto';

/**
 * Canvas Flow node-definition / model-catalog config service.
 *
 * Single source of truth: `node_definitions` MySQL table. Each row holds
 * its full `models[]` JSON (including modes / paramsSchema / paramsSchemaOverride),
 * so the frontend gets the complete config tree from one query.
 *
 * Phase 7-D removed the legacy NodeInspectorField / ModelOption /
 * ModelFunctionalOption tables and the `params` shadow column on
 * NodeDefinition; everything inspector-related is gone.
 */
@Injectable()
export class CanvasConfigService {
  constructor(private prisma: PrismaService) {}

  async getConfig() {
    const globalConfigs = await this.prisma.globalConfig.findMany();
    const configMap = globalConfigs.reduce(
      (acc, config) => {
        acc[config.key] = config.value;
        return acc;
      },
      {} as Record<string, any>,
    );

    const nodeDefinitions = await this.prisma.nodeDefinition.findMany({
      orderBy: { sortOrder: 'asc' },
    });

    const formattedNodeDefinitions = nodeDefinitions.map((nodeDef) => ({
      type: nodeDef.type,
      label: nodeDef.label,
      component: nodeDef.component,
      width: nodeDef.width,
      height: nodeDef.height,
      defaultData: nodeDef.defaultData,
      defaultParams: nodeDef.defaultParams ?? {},
      models: nodeDef.models,
      connectionRules: nodeDef.connectionRules,
    }));

    return {
      token: configMap.token || 'dev-token-placeholder',
      style: configMap.style || { background: '#000000' },
      nodeDefinitions: formattedNodeDefinitions,
    };
  }

  async getVersion(): Promise<ConfigVersionResponse> {
    const versionConfig = await this.prisma.globalConfig.findUnique({
      where: { key: 'config_version' },
    });

    if (!versionConfig) {
      await this.prisma.globalConfig.create({
        data: {
          key: 'config_version',
          value: { version: 1, lastModified: new Date().toISOString() },
        },
      });
      return {
        version: 1,
        lastModified: new Date().toISOString(),
      };
    }

    const value = versionConfig.value as any;
    return {
      version: value.version || 1,
      lastModified: value.lastModified || versionConfig.updatedAt.toISOString(),
      modifiedBy: value.modifiedBy,
    };
  }

  /**
   * Smart upsert: deletes node types not present in the incoming config,
   * upserts every other node, bumps the global config_version.
   */
  async saveConfig(
    config: {
      token?: string;
      style?: any;
      nodeDefinitions: NodeDefinitionInput[];
    },
    modifiedBy?: string,
  ): Promise<SaveConfigResponse> {
    const currentVersion = await this.getVersion();

    const stats = {
      nodesUpdated: 0,
      nodesDeleted: 0,
    };

    await this.prisma.$transaction(
      async (tx) => {
        if (config.token !== undefined) {
          await tx.globalConfig.upsert({
            where: { key: 'token' },
            create: { key: 'token', value: config.token },
            update: { value: config.token },
          });
        }

        if (config.style !== undefined) {
          await tx.globalConfig.upsert({
            where: { key: 'style' },
            create: { key: 'style', value: config.style },
            update: { value: config.style },
          });
        }

        const existingNodes = await tx.nodeDefinition.findMany({
          select: { type: true },
        });
        const existingTypes = new Set(existingNodes.map((n) => n.type));
        const newTypes = new Set(config.nodeDefinitions.map((n) => n.type));

        const typesToDelete = [...existingTypes].filter(
          (t) => !newTypes.has(t),
        );
        if (typesToDelete.length > 0) {
          await tx.nodeDefinition.deleteMany({
            where: { type: { in: typesToDelete } },
          });
          stats.nodesDeleted = typesToDelete.length;
        }

        for (let i = 0; i < config.nodeDefinitions.length; i++) {
          const nodeDef = config.nodeDefinitions[i];
          await this.upsertNodeDefinition(tx, nodeDef, i);
          stats.nodesUpdated++;
        }

        const newVersion = currentVersion.version + 1;
        await tx.globalConfig.upsert({
          where: { key: 'config_version' },
          create: {
            key: 'config_version',
            value: {
              version: newVersion,
              lastModified: new Date().toISOString(),
              modifiedBy,
            },
          },
          update: {
            value: {
              version: newVersion,
              lastModified: new Date().toISOString(),
              modifiedBy,
            },
          },
        });
      },
      {
        maxWait: 10000,
        timeout: 60000,
      },
    );

    return {
      version: currentVersion.version + 1,
      summary: stats,
    };
  }

  private async upsertNodeDefinition(
    tx: any,
    nodeDef: NodeDefinitionInput,
    sortOrder: number,
  ) {
    await tx.nodeDefinition.upsert({
      where: { type: nodeDef.type },
      create: {
        type: nodeDef.type,
        label: nodeDef.label,
        component: nodeDef.component,
        width: nodeDef.width || 250,
        height: nodeDef.height || 250,
        defaultData: nodeDef.defaultData || {},
        defaultParams: nodeDef.defaultParams ?? {},
        connectionRules: nodeDef.connectionRules || {},
        models: nodeDef.models ?? null,
        sortOrder,
      },
      update: {
        label: nodeDef.label,
        component: nodeDef.component,
        width: nodeDef.width || 250,
        height: nodeDef.height || 250,
        defaultData: nodeDef.defaultData || {},
        defaultParams: nodeDef.defaultParams ?? {},
        connectionRules: nodeDef.connectionRules || {},
        models: nodeDef.models ?? null,
        sortOrder,
      },
    });
  }

  async validateData() {
    const nodeCount = await this.prisma.nodeDefinition.count();
    return {
      nodeDefinitions: nodeCount,
    };
  }

  // ---- portable JSON import / export --------------------------------------

  /**
   * Wrap the runtime config in a versioned envelope suitable for download +
   * git commit + cross-instance transfer.
   *
   * Why an envelope instead of returning the bare runtime payload:
   *   - We need a `$schema` discriminator so future format upgrades can
   *     be detected on import (see `normalizeImportEnvelope`).
   *   - Provenance fields (`exportedAt`, `exportedFromVersion`) help the
   *     UI / file picker show "this came from instance X at time Y" with
   *     zero extra metadata files.
   *
   * Excluded from the envelope on purpose: API keys, storage settings,
   * history retention. Those are deployment-scoped, not catalog-scoped;
   * mixing them into the export would leak secrets and would also fight
   * an importing instance's own operations knobs.
   */
  async exportConfig(): Promise<ConfigExportEnvelope> {
    const [runtime, ver] = await Promise.all([
      this.getConfig(),
      this.getVersion(),
    ]);
    return {
      $schema: CONFIG_EXPORT_SCHEMA,
      exportedAt: new Date().toISOString(),
      exportedFromVersion: ver.version,
      config: {
        token: runtime.token,
        style: runtime.style,
        nodeDefinitions: runtime.nodeDefinitions as NodeDefinitionInput[],
      },
    };
  }

  /**
   * Two-step replace-style import:
   *
   *   - mode='preview' → only diff incoming envelope vs current DB and
   *                      return summary + warnings, no writes.
   *   - mode='apply'   → run saveConfig() with the same replace-all
   *                      semantics already used by PUT /config (types
   *                      not in the envelope are deleted).
   *
   * `replace` is the only semantics in v1 because:
   *   - it matches saveConfig's existing behaviour, so two paths collapse
   *     to one; less code, less divergence risk.
   *   - 'merge' is genuinely useful for cross-instance increments but
   *     adds non-trivial conflict policy (do incoming model[] entries
   *     replace, append, or merge by `value`?). We can layer it on later
   *     without touching the v1 wire format.
   */
  async importConfig(dto: ImportConfigDto): Promise<ImportConfigResponse> {
    const normalized = normalizeImportEnvelope(dto.envelope);
    const incoming = normalized.config.nodeDefinitions;

    const current = await this.prisma.nodeDefinition.findMany({
      select: { type: true, label: true, models: true },
    });
    const currentByType = new Map(current.map((n) => [n.type, n]));
    const incomingTypes = new Set(incoming.map((n) => n.type));

    let nodesAdded = 0;
    let nodesUpdated = 0;
    let nodesUnchanged = 0;
    for (const node of incoming) {
      const existing = currentByType.get(node.type);
      if (!existing) {
        nodesAdded++;
      } else if (
        // structural equality is overkill here — the user is going to see
        // a labelled "modified" entry anyway. Compare on the fields that
        // round-trip through `getConfig` to keep the diff honest.
        JSON.stringify(existing.models) !== JSON.stringify(node.models) ||
        existing.label !== node.label
      ) {
        nodesUpdated++;
      } else {
        nodesUnchanged++;
      }
    }
    const toDelete = [...currentByType.keys()].filter(
      (t) => !incomingTypes.has(t),
    );
    const nodesDeleted = toDelete.length;

    const warnings: string[] = [...normalized.warnings];
    if (nodesDeleted > 0) {
      warnings.push(
        `replace 模式：当前 DB 里 ${nodesDeleted} 个节点类型不在导入文件中，将被删除（${toDelete.join(', ')}）`,
      );
    }
    if (incoming.length === 0) {
      warnings.push('envelope.config.nodeDefinitions 为空，apply 后 DB 将清空所有节点定义');
    }

    if (dto.mode === 'preview') {
      return {
        version: null,
        summary: { nodesAdded, nodesUpdated, nodesDeleted, nodesUnchanged },
        warnings,
        dryRun: true,
      };
    }

    const result = await this.saveConfig(
      {
        token: normalized.config.token,
        style: normalized.config.style,
        nodeDefinitions: incoming,
      },
      dto.modifiedBy,
    );
    return {
      version: result.version,
      summary: { nodesAdded, nodesUpdated, nodesDeleted, nodesUnchanged },
      warnings,
      dryRun: false,
    };
  }
}
