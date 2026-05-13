import type { NodeData } from './nodeData';

export type CanvasNodeKind = 'text' | 'image' | 'audio' | 'video' | string;

export interface CanvasFlowNode {
  id: string;
  type: CanvasNodeKind;
  position: { x: number; y: number };
  data?: NodeData; // 数据字段标记为可选，支持数据分离架构
  /** 所属编组 ID */
  groupId?: string;
  /** 节点宽度 */
  width?: number;
  /** 节点高度 */
  height?: number;
  /** 
   * 坐标类型标记（内部字段，用于坐标转换）
   * - 'absolute': 绝对坐标（相对于画布原点）
   * - 'relative': 相对坐标（相对于父编组）
   * - undefined: 未标记（自动推断：有 groupId 则相对，否则绝对）
   */
  _coordinateType?: 'absolute' | 'relative';
}

/**
 * 纯结构节点（不含业务数据）
 * 用于数据分离架构，只包含位置、类型等结构信息
 */
export interface StructureNode {
  id: string;
  type: CanvasNodeKind;
  position: { x: number; y: number };
  groupId?: string;
  width?: number;
  height?: number;
  /** 坐标类型标记 */
  _coordinateType?: 'absolute' | 'relative';
}

export interface CanvasFlowEdge {
  id: string;
  source: string;
  target: string;
  targetHandle?: string | null;
  sourceHandle?: string | null;
  data?: Record<string, any>;
}

export interface CanvasUpstreamNode {
  id: string;
  type: CanvasNodeKind;
  label?: string;
  data: NodeData;
}

export interface CanvasFlowMeta {
  name?: string;
  description?: string;
  tags?: string[];
}

export interface CanvasFlowGroup {
  id: string;
  label: string;
  position: { x: number; y: number };
  width: number;
  height: number;
  style?: {
    backgroundColor?: string;
    color?: string;
  };
}

export interface CanvasFlowValue {
  nodes: CanvasFlowNode[];
  edges: CanvasFlowEdge[];
  /** 编组列表 */
  groups?: CanvasFlowGroup[];
  meta?: CanvasFlowMeta;
}
