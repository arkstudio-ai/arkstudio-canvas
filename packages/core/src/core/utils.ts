import { Node, Edge, MarkerType } from '@xyflow/react';
import { CanvasFlowNode, CanvasFlowEdge, CanvasFlowGroup } from '../types/flow';

export const generateId = (prefix: string = 'node'): string => {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
};

export const toReactFlowNodes = (nodes: CanvasFlowNode[], groups: CanvasFlowGroup[] = []): Node[] => {
  // 1. Create group lookup map
  const groupMap = new Map(groups.map(g => [g.id, g]));

  // 2. Convert nodes（统一坐标语义：in-group 节点 position 永远是「相对父」）
  const flowNodes = nodes.map((node) => {
    const groupId = node.groupId;
    const group = groupId ? groupMap.get(groupId as string) : undefined;

    let position = node.position;
    let parentId = undefined;

    if (group) {
      parentId = group.id;
      // 与 React Flow 官方 subflow 约定对齐：child 节点 position 永远是相对父的局部坐标。
      // DB 持久化也统一为相对坐标——GROUP_ADD / NODE_MOVE / NODE_ADD / 模板 / clone
      // 全部一致，前端 fromReactFlowNodes 也不再做绝对转换。
      // 兼容：若历史数据残留 `_coordinateType: 'absolute'`，按一次性迁移减偏移，
      //   下次 NODE_MOVE 落库时会被覆盖回相对坐标。
      if (node._coordinateType === 'absolute') {
        position = {
          x: node.position.x - group.position.x,
          y: node.position.y - group.position.y,
        };
      } else {
        position = node.position;
      }
    }

    return {
      id: node.id,
      type: node.type,
      position: position,
      parentId: parentId, // Set parent ID for React Flow parent-child relationship
      extent: parentId ? ('parent' as const) : undefined, // Keep children within parent bounds
      expandParent: true, // Allow group to resize when dragging children
      draggable: true, // Ensure nodes are draggable
      zIndex: 10,
      width: node.width || 250, // 默认宽度 250
      height: node.height || 250, // 默认高度 250
      style: { 
          width: node.width ? `${node.width}px` : '250px',
          height: node.height ? `${node.height}px` : '250px'
      },
      data: {}, // Empty data object for ReactFlow
    };
  });

  // 3. Convert group nodes
  const groupNodes = groups.map((group) => ({
    id: group.id,
    type: 'group',
    position: group.position,
    zIndex: -1,
    draggable: true, // Ensure groups can be dragged
    width: group.width,
    height: group.height,
    style: {
      width: group.width,
      height: group.height,
    },
    data: {
      label: group.label,
      style: group.style,
    }
  }));

  // Ensure Group nodes are rendered first
  return [...groupNodes, ...flowNodes];
};

export const fromReactFlowNodes = (nodes: Node[], existingGroups: CanvasFlowGroup[] = []): { nodes: CanvasFlowNode[], groups: CanvasFlowGroup[] } => {
  const canvasNodes: CanvasFlowNode[] = [];
  const canvasGroups: CanvasFlowGroup[] = [];
  
  // Build group map from existing groups for label and style preservation
  const existingGroupMap = new Map(existingGroups.map(g => [g.id, g]));
  
  // First pass: collect groups
  const groupMap = new Map<string, { position: { x: number; y: number } }>();
  nodes.forEach(node => {
    if (node.type === 'group') {
      groupMap.set(node.id, { position: node.position });
      
      // Get existing group info or use defaults
      const existingGroup = existingGroupMap.get(node.id);
      
      canvasGroups.push({
        id: node.id,
        label: existingGroup?.label || 'Group',
        position: node.position,
        width: node.measured?.width || node.width || 200,
        height: node.measured?.height || node.height || 100,
        style: existingGroup?.style
      });
    }
  });
  
  // Second pass: process nodes（统一坐标语义：in-group 节点 position 直接保留 RF 相对父坐标）
  nodes.forEach(node => {
    if (node.type === 'group') {
      // Already processed above
      return;
    }

    // 与 React Flow 官方 subflow 约定一致：child 节点的 position 始终是相对父坐标，
    // 我们直接透传，不再做绝对转换。`_coordinateType` 字段统一标记为 'relative'，
    // 既清晰又向后兼容老的消费者（debugTools / coordinateTest）。
    const parentId = node.parentId;

    canvasNodes.push({
      id: node.id,
      type: node.type || 'default',
      position: node.position,
      // 必须以「显式 width/height」优先：measured 在布局/缩放过程中可能仍为旧尺寸，
      // 若抢先写入结构快照会破坏 ImageNode `_contentSize` 触发的按比例适配。
      width:
        typeof node.width === 'number' && Number.isFinite(node.width) && node.width > 0
          ? node.width
          : (typeof node.measured?.width === 'number' &&
                Number.isFinite(node.measured!.width) &&
                node.measured!.width > 0
              ? node.measured.width
              : 250),
      height:
        typeof node.height === 'number' && Number.isFinite(node.height) && node.height > 0
          ? node.height
          : (typeof node.measured?.height === 'number' &&
                Number.isFinite(node.measured!.height) &&
                node.measured!.height > 0
              ? node.measured.height
              : 250),
      groupId: parentId,
      _coordinateType: parentId ? 'relative' : 'absolute',
    });
  });

  return { nodes: canvasNodes, groups: canvasGroups };
};

export const toReactFlowEdges = (edges: CanvasFlowEdge[]): Edge[] => {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    data: edge.data,
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 20,
      height: 20,
      color: '#888',
    },
  }));
};

export const fromReactFlowEdges = (edges: Edge[]): CanvasFlowEdge[] => {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    data: edge.data as any,
  }));
};

export const getBounds = (nodes: { position: { x: number, y: number }, width?: number, height?: number }[]) => {
  if (nodes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  nodes.forEach(node => {
    const w = node.width || 200;
    const h = node.height || 40;
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + w);
    maxY = Math.max(maxY, node.position.y + h);
  });

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  };
};

interface SimpleNode { id: string; }
interface SimpleEdge { source: string; target: string; }

export const checkIsDag = (
  nodes: SimpleNode[],
  edges: SimpleEdge[],
  newConnection: { source: string; target: string }
): boolean => {
  const { source, target } = newConnection;
  if (source === target) return false;

  const adjacency = new Map<string, string[]>();
  nodes.forEach(node => adjacency.set(node.id, []));
  edges.forEach(edge => {
    const targets = adjacency.get(edge.source) || [];
    targets.push(edge.target);
    adjacency.set(edge.source, targets);
  });

  const visited = new Set<string>();
  const stack = [target];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === source) return false;
    if (!visited.has(current)) {
      visited.add(current);
      const neighbors = adjacency.get(current) || [];
      for (const neighbor of neighbors) {
        stack.push(neighbor);
      }
    }
  }
  return true;
};
