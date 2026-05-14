import { Node, Edge, MarkerType } from '@xyflow/react';
import { CanvasFlowNode, CanvasFlowEdge, CanvasFlowGroup } from '../types/flow';

export const generateId = (prefix: string = 'node'): string => {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
};

export const toReactFlowNodes = (nodes: CanvasFlowNode[], groups: CanvasFlowGroup[] = []): Node[] => {
  // 1. Create group lookup map
  const groupMap = new Map(groups.map(g => [g.id, g]));

  // 2. Convert nodes with coordinate type awareness
  const flowNodes = nodes.map((node) => {
    const groupId = node.groupId;
    const group = groupId ? groupMap.get(groupId as string) : undefined;
    
    let position = node.position;
    let parentId = undefined;

    if (group) {
      parentId = group.id;

      // 决定 position 是绝对坐标还是相对坐标，再翻译成 RF 需要的「父节点
      // 局部坐标」。三条来源：
      //   1) 显式标记 _coordinateType === 'absolute' → 减去 group 偏移
      //   2) 显式标记 'relative' → 原样使用
      //   3) 旧数据中曾经 GROUP_ADD 标了 'relative'，但用户后续拖拽走了
      //      NODE_MOVE 路径，position 被覆写成绝对坐标却没更新标签。
      //      这种情况坐标会跑到 group 几何之外（合法的相对坐标只可能在
      //      [-margin, group.size + margin] 之间）。命中即按 'absolute'
      //      自愈，避免节点 + 连线整体错位。
      const claimsAbsolute = node._coordinateType === 'absolute';
      const lacksTag = node._coordinateType !== 'relative' && !claimsAbsolute;
      const margin = 200;
      const looksLikeAbsolute =
        node.position.x < -margin ||
        node.position.x > (group.width || 0) + margin ||
        node.position.y < -margin ||
        node.position.y > (group.height || 0) + margin;

      const treatAsAbsolute = claimsAbsolute || lacksTag || looksLikeAbsolute;

      if (treatAsAbsolute) {
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
  
  // Second pass: process nodes and convert to absolute coordinates
  nodes.forEach(node => {
    if (node.type === 'group') {
      // Already processed above
      return;
    }
    
    // Handle standard nodes
    let position = node.position;
    const parentId = node.parentId;
    
    // ✅ 如果节点有 parentId（在编组内），转换为绝对坐标
    // ReactFlow 内部存储的是相对坐标，我们需要转换为绝对坐标供上层使用
    if (parentId) {
      const parentGroup = groupMap.get(parentId);
      if (parentGroup) {
        position = {
          x: node.position.x + parentGroup.position.x,
          y: node.position.y + parentGroup.position.y
        };
      }
    }
    
    canvasNodes.push({
      id: node.id,
      type: node.type || 'default',
      position: position, // ✅ 绝对坐标（无论是否在编组内）
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
      groupId: parentId, // Map parentId back to groupId
      _coordinateType: 'absolute', // ✅ 标记为绝对坐标
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
