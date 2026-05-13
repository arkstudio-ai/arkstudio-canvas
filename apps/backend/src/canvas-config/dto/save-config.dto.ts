import { IsObject, IsNotEmpty } from 'class-validator';

/**
 * Canvas Flow 配置保存 DTO（Phase 7-D 后的精简版）。
 *
 * 配置只保留 NodeDefinition 一张表，所有 model / mode / paramsSchema 信息
 * 都直接落在 NodeDefinition.models JSON 字段里，不再有 inspector 相关结构。
 */
export class SaveConfigDto {
  @IsObject()
  @IsNotEmpty()
  config: {
    token?: string;
    style?: {
      background?: string;
    };
    nodeDefinitions: NodeDefinitionInput[];
  };
}

export interface NodeDefinitionInput {
  type: string;
  label: string;
  component: string;
  width?: number;
  height?: number;
  defaultData?: any;
  defaultParams?: Record<string, any>;
  connectionRules?: {
    allowedSources?: string[];
    allowedTargets?: string[];
  };
  /** Model catalog; null/undefined for nodes without model selection. */
  models?: ModelEntryInput[] | null;
}

/**
 * ModelEntry input (mirrors @canvas-flow/core ModelEntry).
 *
 * Persisted as-is into NodeDefinition.models[] -- backend does not introspect
 * the structure, the frontend interprets it via the floating window panels.
 */
export interface ModelEntryInput {
  value: string;
  label: string;
  action: string;
  icon?: string;
  allowedUpstreamTypes?: string[];
  defaultParams?: Record<string, any>;
  paramsSchema?: ParamFieldSpecInput[];
  modes?: ModeEntryInput[];
  defaultModeId?: string;
}

export interface ModeEntryInput {
  id: string;
  label: string;
  sku: string;
  action?: string;
  acceptUpstreamTypes: Array<'image' | 'video' | 'text' | 'audio'>;
  paramsSchemaOverride?: ParamFieldSpecInput[];
  defaultParamsOverride?: Record<string, any>;
}

export interface ParamFieldSpecInput {
  key: string;
  label: string;
  type: 'select';
  options: ParamFieldOptionInput[];
  defaultValue?: string;
}

export interface ParamFieldOptionInput {
  label: string;
  value: string;
  enabledForModes?: string[];
}

// Response types
export interface SaveConfigResponse {
  version: number;
  summary: {
    nodesUpdated: number;
    nodesDeleted: number;
  };
}

export interface ConfigVersionResponse {
  version: number;
  lastModified: string;
  modifiedBy?: string;
}
