import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  NodeDefinitionInput,
  SaveConfigResponse,
  ConfigVersionResponse,
} from './dto/save-config.dto';

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
    const configMap = globalConfigs.reduce((acc, config) => {
      acc[config.key] = config.value;
      return acc;
    }, {} as Record<string, any>);

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

        const typesToDelete = [...existingTypes].filter((t) => !newTypes.has(t));
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
}
