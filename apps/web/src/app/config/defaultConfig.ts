import { CanvasConfig } from '@canvas-flow/core';
import { configService } from '../../services/configService';
import type { CanvasFlowConfigData } from '../../types/configApi';

export const defaultAppConfig: CanvasConfig = {
  style: { background: '#000000' },
  nodeDefinitions: [],
};

/**
 * 异步加载配置（来源：后端 GET /api/canvas-flow/config）。
 * 失败时回退到 defaultAppConfig（空 nodeDefinitions）— 不再读静态 JSON。
 */
export const loadAppConfig = async (): Promise<CanvasConfig> => {
  try {
    const configData: CanvasFlowConfigData = await configService.loadConfig();
    return {
      style: configData.style,
      nodeDefinitions: configData.nodeDefinitions,
    } as CanvasConfig;
  } catch (error) {
    console.error('[loadAppConfig] 配置加载失败:', error);
    return defaultAppConfig;
  }
};
