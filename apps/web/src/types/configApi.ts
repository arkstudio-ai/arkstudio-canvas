/**
 * Canvas Flow 配置 API 类型定义。
 *
 * 仅保留 GET /api/canvas-flow/config 的响应壳。
 * 节点 / 模型 / 模式的具体类型由 @canvas-flow/core 的 NodeDefinition / ModelEntry /
 * ModeEntry / ParamFieldSpec 提供（单一事实源）。
 */

/** 后端统一响应包装 */
export interface ApiResponse<T> {
  success: boolean;
  code: string;
  data: T;
}

/** 完整配置响应数据 */
export interface CanvasFlowConfigData {
  token: string;
  style: {
    background: string;
    [key: string]: any;
  };
  /**
   * 节点定义数组。后端按 @canvas-flow/core 的 NodeDefinition 形态返回；
   * 这里保留为 any[] 避免本文件与 core 的循环依赖与重复定义。
   */
  nodeDefinitions: any[];
}

/** 完整配置 API 响应 */
export type CanvasFlowConfigResponse = ApiResponse<CanvasFlowConfigData>;

/** 配置加载选项 */
export interface ConfigLoadOptions {
  /** 用户ID（用于权限过滤） */
  userId?: string;
  /** 强制刷新配置（忽略缓存） */
  forceRefresh?: boolean;
}

/** 配置加载状态 */
export interface ConfigLoadState {
  loading: boolean;
  error: Error | null;
  config: CanvasFlowConfigData | null;
}
