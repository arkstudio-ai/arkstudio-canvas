import { useState, useCallback, useRef, useMemo } from 'react';
import { Connection, Edge, Node, addEdge, OnConnectStartParams, ReactFlowInstance, MarkerType } from '@xyflow/react';
import { CanvasFlowEdge } from '../../types/flow';
import { checkIsDag, fromReactFlowNodes } from '../utils';
import { CanvasConfig, NodeDefinition } from '../../types/schema';

interface UseCanvasConnectionProps {
  nodes: Node[];
  edges: Edge[];
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>;
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
  setSelectedNodeId: (id: string | null) => void;
  onEdgeAdd?: (edge: CanvasFlowEdge) => void;
  onNodeAdd?: (node: any) => void;
  config: CanvasConfig;
  rfInstance: ReactFlowInstance | null;
}

export function useCanvasConnection({
  nodes,
  edges,
  setEdges,
  setNodes,
  setSelectedNodeId,
  onEdgeAdd,
  onNodeAdd,
  config,
  rfInstance
}: UseCanvasConnectionProps) {
  
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionMenu, setConnectionMenu] = useState<{
    isOpen: boolean;
    position: { x: number; y: number };
    source: { nodeId: string | null; handleId: string | null; handleType?: 'source' | 'target' | null } | null;
  }>({ isOpen: false, position: { x: 0, y: 0 }, source: null });

  const connectionStartRef = useRef<OnConnectStartParams | null>(null);

  // 校验连接规则
  const checkConnectionAllowed = useCallback((sourceType: string, targetType: string) => {
    const sourceDef = config.nodeDefinitions.find(d => d.type === sourceType);
    const targetDef = config.nodeDefinitions.find(d => d.type === targetType);

    if (!sourceDef || !targetDef) return true; 

    // 1. Check Source's Allowed Targets
    if (sourceDef.connectionRules?.allowedTargets) {
      if (!sourceDef.connectionRules.allowedTargets.includes(targetType)) {
        return false;
      }
    }

    // 2. Check Target's Allowed Sources
    if (targetDef.connectionRules?.allowedSources) {
      if (!targetDef.connectionRules.allowedSources.includes(sourceType)) {
        return false;
      }
    }

    return true;
  }, [config.nodeDefinitions]);

  // DAG 检查回调
  const isValidConnection = useCallback(
    (connection: Connection | Edge) => {
      if (connection.source === connection.target) return false;
      
      const source = connection.source;
      const target = connection.target;
      
      // 1. 规则校验
      const sourceNode = nodes.find(n => n.id === source);
      const targetNode = nodes.find(n => n.id === target);
      
      if (sourceNode && targetNode) {
         if (!checkConnectionAllowed(sourceNode.type || 'default', targetNode.type || 'default')) {
             return false;
         }
      }

      // 2. DAG 校验
      const simpleNodes = nodes.map(n => ({ id: n.id }));
      const simpleEdges = edges.map(e => ({ source: e.source, target: e.target }));
      
      return checkIsDag(simpleNodes, simpleEdges, { source, target });
    },
    [nodes, edges, checkConnectionAllowed]
  );

  const onConnect = useCallback((params: Connection) => {
    // Guard: Ensure source and target are present
    if (!params.source || !params.target) {
      console.warn('Skipping invalid connection attempt: missing source or target');
      return;
    }

    if (isValidConnection(params)) {
      const edgeWithMarker = {
        ...params,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 20,
          height: 20,
          color: '#888',
        }
      };
      setEdges((eds) => addEdge(edgeWithMarker, eds));
      
      if (onEdgeAdd) {
          const newEdge: CanvasFlowEdge = {
            id: `e-${params.source}-${params.target}`,
            source: params.source,
            target: params.target,
            data: {}
          };
          onEdgeAdd(newEdge);
      }
    }
  }, [setEdges, isValidConnection, onEdgeAdd]);

  const onConnectStart = useCallback((_event: any, params: OnConnectStartParams) => {
    connectionStartRef.current = params;
    setIsConnecting(true);
  }, []);

  const onConnectEnd = useCallback((event: any) => {
    setIsConnecting(false);
    const target = event.target as Element;
    const isPane = target.classList.contains('react-flow__pane');
    
    if (isPane && connectionStartRef.current && rfInstance) {
      const { clientX, clientY } = event;
      setConnectionMenu({
        isOpen: true,
        position: { x: clientX, y: clientY },
        source: {
          ...connectionStartRef.current,
          handleType: connectionStartRef.current.handleType
        }
      });
    }
  }, [rfInstance]);

  const handleMenuAddNode = useCallback((type: string) => {
    if (!rfInstance) return;

    const { position, source } = connectionMenu;
    
    const flowPos = rfInstance.screenToFlowPosition({ x: position.x, y: position.y });

    // 调整一下位置，让节点中心对准点击处
    flowPos.x -= 100; 
    flowPos.y -= 50;

    // 获取节点类型配置
    const definition = config.nodeDefinitions.find(def => def.type === type);

    const defaultWidth = definition?.width || 250;
    const defaultHeight = definition?.height || 250;

    const newNodeId = `node-${Date.now()}`;
    const newNode: Node = {
        id: newNodeId,
        type,
        position: flowPos,
        width: defaultWidth,
        height: defaultHeight,
        selected: true,
        style: { 
            width: `${defaultWidth}px`, 
            height: `${defaultHeight}px` 
        },
        data: {}, // Empty data object for ReactFlow
    };

    setNodes((nds) => [...nds.map(n => ({ ...n, selected: false })), newNode] as typeof nds);
    setSelectedNodeId(newNodeId);
    
    if (onNodeAdd) {
        const { nodes: newNodes } = fromReactFlowNodes([newNode], []);
        if (newNodes.length > 0) {
           onNodeAdd(newNodes[0]);
        }
    }

    if (source?.nodeId) {
      let newEdge: Edge;

      // 如果是从 target handle (左侧) 拖出来的，说明是从旧节点左侧连线
      // 这种情况下，新节点应该是上游 (Source)，旧节点是下游 (Target)
      if (source.handleType === 'target') {
        newEdge = {
          id: `e-${newNodeId}-${source.nodeId}`,
          source: newNodeId,
          target: source.nodeId,
          targetHandle: source.handleId, 
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 20,
            height: 20,
            color: '#888',
          }
        };
      } else {
        // 默认情况：从 source handle (右侧) 拖出来
        // 旧节点是上游 (Source)，新节点是下游 (Target)
        newEdge = {
          id: `e-${source.nodeId}-${newNodeId}`,
          source: source.nodeId,
          target: newNodeId,
          sourceHandle: source.handleId,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 20,
            height: 20,
            color: '#888',
          }
        };
      }

      setEdges((eds) => addEdge(newEdge, eds));
      
      if (onEdgeAdd) {
          onEdgeAdd({
              id: newEdge.id,
              source: newEdge.source,
              target: newEdge.target,
              data: {}
          });
      }
    }

    setConnectionMenu(prev => ({ ...prev, isOpen: false }));
    connectionStartRef.current = null;
  }, [connectionMenu, rfInstance, setNodes, setEdges, onNodeAdd, onEdgeAdd, config.nodeDefinitions]);

  // 根据 config 和当前连接状态生成可用节点类型列表
  const availableNodeTypes = useMemo(() => {
    const allTypes = config.nodeDefinitions.map((def: NodeDefinition) => ({
      type: def.type,
      label: def.label,
    }));

    // 如果不是在连接过程中（即双击空白处添加），显示所有节点
    if (!connectionMenu.source || !connectionMenu.source.nodeId) {
      return allTypes;
    }

    // 连接模式下，根据规则过滤
    const sourceNodeId = connectionMenu.source.nodeId;
    const sourceNode = nodes.find(n => n.id === sourceNodeId);
    
    if (!sourceNode) return allTypes;

    const handleType = connectionMenu.source.handleType; // 'source' | 'target'

    return allTypes.filter(item => {
      if (handleType === 'target') {
        return checkConnectionAllowed(item.type, sourceNode.type || 'default');
      } 
      else {
        return checkConnectionAllowed(sourceNode.type || 'default', item.type);
      }
    });
  }, [config.nodeDefinitions, connectionMenu.source, nodes, checkConnectionAllowed]);

  return {
    isConnecting,
    connectionMenu,
    setConnectionMenu,
    isValidConnection,
    onConnect,
    onConnectStart,
    onConnectEnd,
    handleMenuAddNode,
    availableNodeTypes
  };
}
