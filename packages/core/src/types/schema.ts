
import React from 'react';

// 节点内容组件的 Props 标准
export interface NodeContentProps {
  nodeId: string;
  data: any;
  selected: boolean;
  isConnected: boolean;
  onChange: (newData: any) => void; 
  onRun?: () => void;
  style?: React.CSSProperties;
}

// 节点定义 (JSON)
export interface NodeDefinition {
  /** 节点类型唯一标识，如 'llm-text' */
  type: string;
  /** 节点显示名称 */
  label: string;
  
  /** 
   * 内容区渲染配置 
   * 指向注册表中的 key
   */
  component: string; 
  
  /** 初始数据 */
  defaultData?: Record<string, any>;

  /** 节点级默认参数（创建节点时合并到 nodeConfig.params） */
  defaultParams?: Record<string, any>;
  
  /** UI 配置 */
  width?: number;
  height?: number;

  /** 连接规则配置 */
  connectionRules?: NodeConnectionRules;

  /** 模型清单（image/video/text 节点用，其余 null） */
  models?: ModelEntry[] | null;
}

export interface ModelEntry {
  /**
   * 模型唯一标识。
   * - 单模式模型：等于真实 SKU，例如 'gemini-3-pro-image'
   * - 多模式（family）模型：是 family 逻辑标识，例如 'wan2.7'；
   *   实际调用的真实 SKU 由 modes[*].sku 决定
   */
  value: string;
  /** 展示名 */
  label: string;
  /**
   * 执行引擎 action key。
   * - 单模式模型：使用此字段
   * - 多模式模型：忽略此字段，使用 modes[*].action（family 仅作 UI 分组）
   */
  action: string;
  /** lucide-react 图标名 */
  icon?: string;
  /** 允许的上游节点类型，用于连接校验（多模式模型为所有 mode 的并集） */
  allowedUpstreamTypes?: string[];
  /** 选中此模型时合并到 params 的默认值 */
  defaultParams?: Record<string, any>;

  /**
   * 通用参数 schema（结构化）。
   * - 单模式：即模型的全部参数
   * - 多模式：所有 mode 共享的基础参数；mode.paramsSchemaOverride 可按 key 覆盖
   * 缺省表示该模型无结构化参数描述，floating window 会按节点类型用内置 fallback schema 渲染。
   */
  paramsSchema?: ParamFieldSpec[];

  /**
   * 子模式列表（family 模型用，例如 wan2.7 的 t2v/i2v/r2v/videoedit）。
   * 缺省或空数组表示单模式模型。
   */
  modes?: ModeEntry[];
  /** 默认选中的 mode.id，缺省时使用 modes[0].id */
  defaultModeId?: string;
}

/**
 * 子模式（family 模型才会有；如 wan2.7-t2v / wan2.7-i2v 等）。
 * 前端把它渲染为 tab 行，用户显式选择；上游变化只影响"生效/未生效"灰态，不改 mode。
 */
export interface ModeEntry {
  /** 模式 ID（family 内唯一），如 't2v' | 'i2v' | 'r2v' | 'video-edit' */
  id: string;
  /** tab 上显示的中文名，例如「全能参考」 */
  label: string;
  /** 真实百炼 SKU，例如 'wan2.7-r2v'，backend 据此调用 DashScope */
  sku: string;
  /** 执行引擎 action key（覆盖 family.action） */
  action?: string;
  /** 此模式接受的上游类型；不在此列表里的上游在 UpstreamRefStrip 灰显为"未生效" */
  acceptUpstreamTypes: Array<'image' | 'video' | 'text' | 'audio'>;
  /** 此模式独有 / 覆盖的参数 schema（按 key 覆盖 family.paramsSchema） */
  paramsSchemaOverride?: ParamFieldSpec[];
  /** 此模式独有 / 覆盖的默认参数（按 key 覆盖 family.defaultParams） */
  defaultParamsOverride?: Record<string, any>;
}

/** 参数下拉规格（Phase 1 仅支持 select；后续按需扩展 toggle / slider 等） */
export interface ParamFieldSpec {
  /** 真实写入 params 的字段名，例如 'aspectRatio' / 'duration' / 'resolution' */
  key: string;
  /** 展示名，如「比例」「时长」 */
  label: string;
  /** 类型；Phase 1 只支持 'select' */
  type: 'select';
  /** 选项列表 */
  options: Array<ParamFieldOption>;
  /** 默认值（可选） */
  defaultValue?: string;
}

/** 单个下拉选项；可按 modeId 限制是否可选（不限制则任何 mode 都能选）。 */
export interface ParamFieldOption {
  label: string;
  value: string;
  /**
   * 仅在 mode.id 命中此列表时可选；其它 mode 下选项常驻显示但 disabled。
   * 未提供则视为对所有 mode 启用。
   */
  enabledForModes?: string[];
}

export interface NodeConnectionRules {
  /** 允许连接到此节点的上游节点类型列表 (Left/Input) */
  allowedSources?: string[];
  /** 允许此节点连接到的下游节点类型列表 (Right/Output) */
  allowedTargets?: string[];
}

// 全局配置 (JSON)
export interface CanvasConfig {
  /** 定义所有可用的节点类型 */
  nodeDefinitions: NodeDefinition[];
  /** 样式配置 */
  style?: {
    background?: string; // 具体的颜色值或 CSS 变量
  };
}

// 组件注册表 (Code)
export type ComponentRegistry = Record<string, React.ComponentType<NodeContentProps>>;

