import React, { useState, useRef, useImperativeHandle, useCallback } from 'react';
import { CanvasEditor, CanvasDropEvent } from './CanvasEditor';
import { FlowRunner } from './FlowRunner';
import { CanvasProvider, GroupActionType } from './CanvasContext';
import { CanvasFlowValue, CanvasFlowNode, CanvasFlowEdge, CanvasFlowGroup } from '../types/flow';
import { ExecutionConfig } from '../types/execution';
import { CanvasConfig, ComponentRegistry } from '../types/schema';
import { generateId } from './utils';
import { NodeMediaEmitter } from './NodeMediaEmitter';
import '../styles/canvas.css';

import { defaultCanvasConfig, defaultComponentRegistry } from './defaults';

export type CanvasMode = 'edit' | 'view';

export interface CanvasFlowUIOptions {
  showMinimap?: boolean;
  showGrid?: boolean;
  showToolbar?: boolean;
}

/** 自定义右键菜单项 */
export interface CustomContextMenuItem {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  icon?: React.ReactNode;
}

export interface CanvasFlowProps {
  initialFlow?: CanvasFlowValue;

  // New Props
  config?: CanvasConfig;
  components?: ComponentRegistry;

  execution?: ExecutionConfig;
  mode?: CanvasMode;
  ui?: CanvasFlowUIOptions;
  renderEmpty?: React.ReactNode;
  
  // Custom Inspector rendering (Render Props pattern)
  renderNodeInspector?: (props: {
    nodeId: string;
    node: CanvasFlowNode;
  }) => React.ReactNode | null;

  // Custom Top Toolbar rendering (Render Props pattern)
  renderNodeToolbar?: (props: {
    nodeId: string;
    node: CanvasFlowNode;
  }) => React.ReactNode | null;
  
  /**
   * 自定义节点右键菜单项
   * @param nodeId - 右键点击的节点 ID
   * @param node - 节点数据
   * @param mediaData - 节点的媒体数据（从 mediaMap 获取）
   * @returns 自定义菜单项数组（会追加到默认菜单项之后）
   */
  getNodeContextMenuItems?: (
    nodeId: string,
    node: CanvasFlowNode,
    mediaData: any
  ) => CustomContextMenuItem[];
  
  onChange?: (flow: CanvasFlowValue) => void;
  onSave?: (flow: CanvasFlowValue) => void;
  onRunFlow?: (flow: CanvasFlowValue) => void;
  onNodeRun?: (nodeId: string) => Promise<any>;
  onGroupRun?: (groupId: string) => Promise<any>;
  onGroupSave?: (groupId: string, flow: CanvasFlowValue) => void;
  onSelectionChange?: (nodeIds: string[]) => void;
  
  // Granular Event Hooks (Callbacks)
  onNodeAdd?: (node: CanvasFlowNode) => void;
  /** Callback when node is copied, use to copy params */
  onNodeCopy?: (sourceNodeId: string, newNodeId: string) => void;
  onNodeDelete?: (nodeId: string) => void;
  onNodeMove?: (node: CanvasFlowNode) => void;
  onNodeDataChange?: (nodeId: string, data: any) => void;
  /**
   * Called after the canvas auto-fits a node to its media content's aspect
   * ratio. Use this to persist the resulting `width` / `height` to your
   * backend so the layout survives a page refresh.
   *
   * Mirrors `onNodeMove` but for size-only changes. The core debounces the
   * call internally, so it's safe to wire directly to a PATCH request.
   */
  onNodeResize?: (nodeId: string, dimensions: { width: number; height: number }) => void;
  onEdgeAdd?: (edge: CanvasFlowEdge) => void;
  onEdgeDelete?: (edgeId: string) => void;
  
  // Group Events
  onGroupAdd?: (group: CanvasFlowGroup) => void;
  onGroupDelete?: (groupId: string) => void;
  onGroupUngroup?: (groupId: string, nodeIds: string[]) => void; // 解组：移除分组但保留节点
  onGroupUpdate?: (group: Partial<CanvasFlowGroup> & { id: string }) => void;

  /** 拖拽放置到画布事件 */
  onCanvasDrop?: (event: CanvasDropEvent) => void;
  /** 上传文件创建节点回调 */
  onUploadNode?: (file: File, position: { x: number; y: number }) => void;

  className?: string;
  style?: React.CSSProperties;
}

export interface CanvasFlowHandle {
  init(initialData?: CanvasFlowValue, flowId?: string): string;
  getFlow(): CanvasFlowValue;
  setFlow(flow: CanvasFlowValue): void;
  runFlow(): Promise<any>;
  fitView(): void;
  getViewport(): { x: number; y: number; zoom: number };
  
  // 节点查询 API
  getNode(nodeId: string): CanvasFlowNode | null;
  getUpstreamNodes(nodeId: string): Array<{
    id: string;
    type: string;
    label: string;
    position: { x: number; y: number };
    data: any;
  }>;
  
  // 媒体内容设置 API (专用方法 - 类型安全)
  //
  // 可选 meta.aiGenerated: backend saveExecutionResult 通路写 true,
  // reload (dataAdapter) / 数据回灌路径透传过来. 不传则保持原值/不动 —
  // 手动上传 (file picker) 等场景就别传, 节点没 aiGenerated 字段, 视为
  // 手动. 不要把任何业务字段塞进 meta — 这里只收 "内容来源 marker" 一类
  // 极小集合, 想加新字段先在 updateMediaData 白名单里挂一席.
  setNodeImage(
    nodeId: string,
    src: string,
    meta?: { aiGenerated?: boolean },
  ): void;
  setNodeVideo(
    nodeId: string,
    src: string,
    meta?: { aiGenerated?: boolean },
  ): void;
  setNodeAudio(
    nodeId: string,
    src: string,
    meta?: { aiGenerated?: boolean },
  ): void;
  setNodeText(nodeId: string, text: string): void;
  setNodeTitle(nodeId: string, title: string): void;
  setNodeOutput(nodeId: string, outputData: any): void;
  
  // 通用内容设置 API (保留，用于特殊场景)
  setNodeContent(nodeId: string, content: { src?: string; text?: string; outputData?: any }): void;
  clearNodeContent(nodeId: string): void;
  
  // 加载/错误状态管理 API
  setNodeLoading(nodeId: string): void;
  clearNodeLoading(nodeId: string): void;
  setNodeError(nodeId: string, error: string): void;
  clearNodeError(nodeId: string): void;
  
  // 媒体数据管理 API (旧版，保留向后兼容)
  /** @deprecated 请使用 setNodeImage/setNodeText 等专用方法 */
  updateNodeMedia(nodeId: string, media: any): void;
  batchUpdateNodeMedia(updates: Array<{ nodeId: string; data: any }>): void;
  getNodeMedia(nodeId: string): any;
  updateNodeStatus(nodeId: string, status: 'running' | 'idle'): void;
}

export const CanvasFlow = React.forwardRef<CanvasFlowHandle, CanvasFlowProps>((props, ref) => {
  const {
    initialFlow = { nodes: [], edges: [] },
    config = defaultCanvasConfig,
    components = defaultComponentRegistry,
    execution = {},
    mode = 'edit',
    ui = { showToolbar: true },
    renderEmpty,
    renderNodeInspector,
    renderNodeToolbar,
    onChange,
    onSave,
    onRunFlow,
    onNodeRun,
    onGroupRun,
    onGroupSave,
    onSelectionChange,
    
    // Granular events
    onNodeAdd,
    onNodeCopy,
    onNodeDelete,
    onNodeMove,
    onNodeDataChange,
    onNodeResize,
    onEdgeAdd,
    onEdgeDelete,
    
    // Group events
    onGroupAdd,
    onGroupDelete,
    onGroupUngroup,
    onGroupUpdate,
    
    // Custom context menu
    getNodeContextMenuItems,
    
    // Canvas drop
    onCanvasDrop,
    onUploadNode,
    
    className,
    style
  } = props;

  void ui;
  void onSave;

  const [currentFlow, setCurrentFlow] = useState<CanvasFlowValue>(initialFlow);
  const [isRunning, setIsRunning] = useState(false);
  const [runningNodeId, setRunningNodeId] = useState<string | null>(null);
  const [inspectingNodeId, setInspectingNodeId] = useState<string | null>(null);

  /**
   * 画布结构快照：在 setFlow / handleFlowChange 时同步更新。
   * CanvasEditor 未实现 getFlow 时，`currentFlow` 的 React state 会晚一拍，
   * 紧接着 setFlow() 后立即 getNode()/findNode() 会读到旧节点表，导致误判节点类型。
   */
  const structureSnapshotRef = useRef<CanvasFlowValue>(initialFlow);
  
  const runnerRef = useRef(new FlowRunner(execution));
  const editorRef = useRef<any>(null);
  const canvasIdRef = useRef<string>('');
  
  // 媒体数据管理
  const mediaMapRef = useRef<Map<string, any>>(new Map());
  const mediaEmitterRef = useRef<NodeMediaEmitter>(new NodeMediaEmitter());
  
  // ⚠️ 移除 useMemo 初始化 mediaMap
  // mediaMap 应该完全由专用 API (setNodeImage/setNodeText 等) 管理
  // 初始化时：应用层调用 setFlow(structureJson) + loadNodesData() 来填充数据

  // ========== 内部辅助方法 ==========
  
  /**
   * 查找节点（内部方法）
   */
  const findNode = useCallback((nodeId: string): CanvasFlowNode | null => {
    const editorFlow = editorRef.current?.getFlow?.();
    const flow = editorFlow ?? structureSnapshotRef.current;

    if (!flow || !flow.nodes) return null;
    return flow.nodes.find((n: CanvasFlowNode) => n.id === nodeId) || null;
  }, []);
  
  /**
   * 验证节点类型（内部方法）
   */
  const validateNodeType = useCallback((
    nodeId: string, 
    expectedTypes: string | string[], 
    methodName: string
  ): CanvasFlowNode | null => {
    const node = findNode(nodeId);
    
    if (!node) {
      console.warn(`[${methodName}] 节点不存在: ${nodeId}`);
      return null;
    }
    
    const types = Array.isArray(expectedTypes) ? expectedTypes : [expectedTypes];
    
    if (!types.includes(node.type)) {
      console.error(
        `[${methodName}] 节点 ${nodeId} 的类型是 "${node.type}"，不符合要求。`,
        `期望的类型: ${types.join(', ')}`
      );
      return null;
    }
    
    return node;
  }, [findNode]);
  
  /**
   * 更新节点媒体数据（内部核心方法）
   * 只接受白名单内的媒体字段，过滤掉非法字段
   */
  const updateMediaData = useCallback((nodeId: string, updates: Record<string, any>) => {
    // 媒体字段白名单（Core 层只管理这些字段）
    const allowedMediaFields = [
      // 媒体内容字段
      'src',           // 图片/视频/音频 URL
      'text',          // 文本内容
      'title',         // 节点标题
      'outputData',    // 通用输出数据
      'output',        // 兼容旧字段
      
      // UI 状态字段（Core 内部管理）
      '_loading',          // 加载状态
      '_error',            // 错误信息
      '_executionStatus',  // 执行状态
      '_contentSize',      // 内容尺寸
      
      // Upload 节点特殊字段
      'fileName',      // 文件名
      'fileType',      // 文件类型
      'fileSize',      // 文件大小
      '_uploading',    // 上传中状态
      '_uploadError',  // 上传错误信息

      // 内容来源 marker — backend saveExecutionResult 写入 true,
      // reload / SSE 回灌路径把它带进 mediaMap. MediaNode 用它判定
      // "替换" 按钮显不显示 (只对手动上传出按钮). 没这字段的视为手动.
      'aiGenerated',

      // 其他媒体相关字段
      'resourceType',  // 资源类型
    ];
    
    const currentMedia = mediaMapRef.current.get(nodeId) || {};
    const updatedMedia = { ...currentMedia };
    
    console.log(`[Core updateMediaData] 节点 ${nodeId}:`, {
      currentMedia,
      updates,
      willMerge: updatedMedia
    });
    
    // 只更新白名单内的字段
    Object.keys(updates).forEach(key => {
      if (allowedMediaFields.includes(key)) {
        if (updates[key] === undefined) {
          // 删除字段
          delete updatedMedia[key];
        } else {
          // 更新字段
          updatedMedia[key] = updates[key];
        }
      } else {
        // 警告非法字段
        console.warn(
          `[updateMediaData] 忽略非媒体字段 "${key}" (节点 ${nodeId})`,
          `\n允许的字段: ${allowedMediaFields.join(', ')}`
        );
      }
    });
    
    mediaMapRef.current.set(nodeId, updatedMedia);
    mediaEmitterRef.current.emit(nodeId, updatedMedia);
    console.log(`[Core updateMediaData] 更新后:`, updatedMedia);
  }, []);

  useImperativeHandle(ref, () => ({
    init: (initialData?: CanvasFlowValue, flowId?: string) => {
      const newId = flowId || generateId();
      canvasIdRef.current = newId;

      if (initialData) {
        // ⚠️ 不再初始化 mediaMap
        // mediaMap 由应用层通过专用 API 填充

        structureSnapshotRef.current = initialData;
        setCurrentFlow(initialData);
        if (editorRef.current?.setFlow) {
          editorRef.current.setFlow(initialData);
          setTimeout(() => {
             editorRef.current?.fitView();
          }, 10);
        }
      }
      
      return newId;
    },
    getFlow: () => {
      // 从 CanvasEditor 获取最新的实时数据
      const editorFlow = editorRef.current?.getFlow?.();
      if (editorFlow) {
        return editorFlow;
      }

      // CanvasEditor 无 getFlow 时，用快照（已与 setFlow / 画布交互同步）
      return structureSnapshotRef.current;
    },
    setFlow: (flow: CanvasFlowValue) => {
      structureSnapshotRef.current = flow;
      setCurrentFlow(flow);
      if (editorRef.current?.setFlow) {
        editorRef.current.setFlow(flow);
      }
    },
    runFlow: async () => {
      return handleRunFlow();
    },
    fitView: () => {
      editorRef.current?.fitView();
    },
    getViewport: () => {
       return editorRef.current?.getViewport() || { x: 0, y: 0, zoom: 1 };
    },
    
    // 节点查询 API
    getNode: (nodeId: string) => {
      const editorFlow = editorRef.current?.getFlow?.();
      const flow = editorFlow ?? structureSnapshotRef.current;

      if (!flow || !flow.nodes) return null;
      return flow.nodes.find((n: CanvasFlowNode) => n.id === nodeId) || null;
    },
    getUpstreamNodes: (nodeId: string) => {
      const editorFlow = editorRef.current?.getFlow?.();
      const flow = editorFlow ?? structureSnapshotRef.current;
      if (!flow.edges) return [];

      // Find all edges pointing to this node
      const incomingEdges = flow.edges.filter((e: CanvasFlowEdge) => e.target === nodeId);
      const upstreamNodeIds = incomingEdges.map((e: CanvasFlowEdge) => e.source);

      // Get upstream node information
      return flow.nodes
        .filter((n: CanvasFlowNode) => upstreamNodeIds.includes(n.id))
        .map((n: CanvasFlowNode) => {
          const definition = config.nodeDefinitions.find(d => d.type === n.type);
          const mediaData = mediaMapRef.current.get(n.id) || {};
          
          return {
            id: n.id,
            type: n.type,
            label: definition?.label || n.type,
            position: n.position,
            data: mediaData
          };
        });
    },
    
    // 媒体内容设置 API (专用方法 - 类型安全)
    // 职责：验证类型 + 组装参数 + 调用通用方法
    
    setNodeImage: (
      nodeId: string,
      src: string,
      meta?: { aiGenerated?: boolean },
    ) => {
      const validTypes = ['image', 'video', 'audio'];
      if (validateNodeType(nodeId, validTypes, 'setNodeImage')) {
        const payload: Record<string, unknown> = { src };
        if (meta?.aiGenerated !== undefined) payload.aiGenerated = meta.aiGenerated;
        updateMediaData(nodeId, payload);
      }
    },

    setNodeVideo: (
      nodeId: string,
      src: string,
      meta?: { aiGenerated?: boolean },
    ) => {
      if (validateNodeType(nodeId, 'video', 'setNodeVideo')) {
        const payload: Record<string, unknown> = { src };
        if (meta?.aiGenerated !== undefined) payload.aiGenerated = meta.aiGenerated;
        updateMediaData(nodeId, payload);
      }
    },

    setNodeAudio: (
      nodeId: string,
      src: string,
      meta?: { aiGenerated?: boolean },
    ) => {
      if (validateNodeType(nodeId, 'audio', 'setNodeAudio')) {
        const payload: Record<string, unknown> = { src };
        if (meta?.aiGenerated !== undefined) payload.aiGenerated = meta.aiGenerated;
        updateMediaData(nodeId, payload);
      }
    },
    
    setNodeText: (nodeId: string, text: string) => {
      if (validateNodeType(nodeId, 'text', 'setNodeText')) {
        updateMediaData(nodeId, { text });
      }
    },
    
    setNodeTitle: (nodeId: string, title: string) => {
      // 任何节点都可以设置 title，只需验证节点存在
      const node = findNode(nodeId);
      if (node) {
        updateMediaData(nodeId, { title });
      } else {
        console.warn(`[setNodeTitle] 节点不存在: ${nodeId}`);
      }
    },
    
    setNodeOutput: (nodeId: string, outputData: any) => {
      // 任何节点都可以设置 outputData，只需验证节点存在
      const node = findNode(nodeId);
      if (node) {
        updateMediaData(nodeId, { outputData });
      } else {
        console.warn(`[setNodeOutput] 节点不存在: ${nodeId}`);
      }
    },
    
    // ========== 通用内容设置 API ==========

    
    // 通用内容设置 API (直接调用内部核心方法)
    setNodeContent: (nodeId: string, content: any) => {
      updateMediaData(nodeId, content);
    },
    clearNodeContent: (nodeId: string) => {
      // 清空媒体内容，但保留 UI 状态
      const currentMedia = mediaMapRef.current.get(nodeId) || {};
      const { src, text, outputData, ...uiState } = currentMedia;
      
      mediaMapRef.current.set(nodeId, uiState);
      mediaEmitterRef.current.emit(nodeId, uiState);
    },
    
    // 加载/错误状态管理 API
    setNodeLoading: (nodeId: string) => {
      const currentMedia = mediaMapRef.current.get(nodeId) || {};
      mediaMapRef.current.set(nodeId, { ...currentMedia, _loading: true });
      mediaEmitterRef.current.emit(nodeId, mediaMapRef.current.get(nodeId)!);
    },
    clearNodeLoading: (nodeId: string) => {
      const currentMedia = mediaMapRef.current.get(nodeId) || {};
      console.log(`[Core clearNodeLoading] 节点 ${nodeId} 清除前:`, currentMedia);
      // ✅ 创建新对象，不直接修改引用
      const updatedMedia = { ...currentMedia };
      delete updatedMedia._loading;
      mediaMapRef.current.set(nodeId, updatedMedia);
      mediaEmitterRef.current.emit(nodeId, updatedMedia);
      console.log(`[Core clearNodeLoading] 节点 ${nodeId} 清除后:`, updatedMedia);
    },
    setNodeError: (nodeId: string, error: string) => {
      const currentMedia = mediaMapRef.current.get(nodeId) || {};
      mediaMapRef.current.set(nodeId, { ...currentMedia, _error: error });
      mediaEmitterRef.current.emit(nodeId, mediaMapRef.current.get(nodeId)!);
    },
    clearNodeError: (nodeId: string) => {
      const currentMedia = mediaMapRef.current.get(nodeId) || {};
      // ✅ 创建新对象，不直接修改引用
      const updatedMedia = { ...currentMedia };
      delete updatedMedia._error;
      mediaMapRef.current.set(nodeId, updatedMedia);
      mediaEmitterRef.current.emit(nodeId, updatedMedia);
    },
    
    // 媒体数据管理 API 实现 (旧版，保留向后兼容)
    updateNodeMedia: (nodeId: string, media: any) => {
      const currentMedia = mediaMapRef.current.get(nodeId) || {};
      const updatedMedia = { ...currentMedia, ...media };
      
      // ✅ 处理 undefined 值：删除对应的属性而不是保留 undefined
      Object.keys(updatedMedia).forEach(key => {
        if (updatedMedia[key] === undefined) {
          delete updatedMedia[key];
        }
      });
      
      mediaMapRef.current.set(nodeId, updatedMedia);
      mediaEmitterRef.current.emit(nodeId, updatedMedia);
    },
    batchUpdateNodeMedia: (updates: Array<{ nodeId: string; data: any }>) => {
      updates.forEach(({ nodeId, data }) => {
        const currentMedia = mediaMapRef.current.get(nodeId) || {};
        const updatedMedia = { ...currentMedia, ...data };
        mediaMapRef.current.set(nodeId, updatedMedia);
      });
      mediaEmitterRef.current.batchEmit(updates.map(u => ({ nodeId: u.nodeId, data: mediaMapRef.current.get(u.nodeId)! })));
    },
    getNodeMedia: (nodeId: string) => {
      return mediaMapRef.current.get(nodeId) || {};
    },
    updateNodeStatus: (nodeId: string, status: 'running' | 'idle') => {
      const currentMedia = mediaMapRef.current.get(nodeId) || {};
      const updatedMedia = { ...currentMedia, _executionStatus: status };
      mediaMapRef.current.set(nodeId, updatedMedia);
      mediaEmitterRef.current.emit(nodeId, updatedMedia);
    }
  }), [currentFlow, config, findNode, validateNodeType, updateMediaData]);

  const handleFlowChange = useCallback((newFlow: CanvasFlowValue) => {
    structureSnapshotRef.current = newFlow;
    setCurrentFlow(newFlow);
    onChange?.(newFlow);
  }, [onChange]);

  const handleSelectionChange = useCallback((nodeIds: string[]) => {
    // nodeIds only contains non-group nodes (filtered by CanvasEditor)
    if (nodeIds.length === 1) {
      setInspectingNodeId(nodeIds[0]);
    } else {
      setInspectingNodeId(null);
    }
    onSelectionChange?.(nodeIds);
  }, [onSelectionChange]);

  const handleRunFlow = async () => {
    if (isRunning) return;
    setIsRunning(true);
    onRunFlow?.(currentFlow);
    
    try {
      // 状态推送由后端 SSE 处理，前端这里只做触发与等待。
      const result = await runnerRef.current.runFlow(currentFlow, () => {});
      return result;
    } catch (err) {
      console.error('Flow execution failed', err);
    } finally {
      setIsRunning(false);
    }
  };

  const handleGroupRun = async (groupId: string) => {
    if (isRunning) return;

    if (onGroupRun) {
      setIsRunning(true);
      try {
        await onGroupRun(groupId);
      } catch (err) {
        console.error(`Group ${groupId} execution failed`, err);
      } finally {
        setIsRunning(false);
      }
      return;
    }
    
    const groupNodes = currentFlow.nodes.filter((n: CanvasFlowNode) => n.groupId === groupId);
    if (groupNodes.length === 0) return;

    const groupNodeIds = new Set(groupNodes.map((n: CanvasFlowNode) => n.id));
    const groupEdges = currentFlow.edges.filter(
      (e: CanvasFlowEdge) => groupNodeIds.has(e.source) && groupNodeIds.has(e.target),
    );

    const groupFlow: CanvasFlowValue = {
        nodes: groupNodes,
        edges: groupEdges,
        groups: [],
        meta: currentFlow.meta
    };

    setIsRunning(true);
    try {
        await runnerRef.current.runFlow(groupFlow, () => {});
    } catch (err) {
        console.error(`Group ${groupId} execution failed`, err);
    } finally {
        setIsRunning(false);
    }
  };

  const handleNodeRun = async (nodeId: string) => {
    if (runningNodeId) return;
    
    setRunningNodeId(nodeId);
    try {
      if (onNodeRun) {
        await onNodeRun(nodeId);
      } else {
        console.warn('No onNodeRun handler provided');
      }
    } catch (err) {
      console.error('Node execution failed:', err);
    } finally {
      setRunningNodeId(null);
    }
  };

  // Dispatcher for Group Actions
  const handleGroupAction = useCallback((type: GroupActionType, payload: any) => {
    switch (type) {
      case 'create':
        onGroupAdd?.(payload);
        break;
      case 'delete':
        onGroupDelete?.(payload);
        break;
      case 'update':
      case 'move':
        onGroupUpdate?.(payload);
        break;
      case 'ungroup':
        if (editorRef.current?.ungroup) {
            editorRef.current.ungroup(payload.id);
        }
        break;
      case 'run':
        handleGroupRun(payload.id);
        break;
      case 'save':
        const targetGroup = currentFlow.groups?.find(g => g.id === payload.id);
        if (!targetGroup) {
            console.warn(`Group ${payload.id} not found for save`);
            return;
        }
        const children = currentFlow.nodes.filter(n => n.groupId === payload.id);
        const childIds = new Set(children.map(n => n.id));
        const internalEdges = currentFlow.edges.filter(e => childIds.has(e.source) && childIds.has(e.target));
        
        const groupFlow: CanvasFlowValue = {
            nodes: children,
            edges: internalEdges,
            groups: [targetGroup],
            meta: currentFlow.meta
        };
        onGroupSave?.(payload.id, groupFlow);
        break;
    }
  }, [onGroupAdd, onGroupDelete, onGroupUpdate, currentFlow, onGroupRun, onGroupSave]); // Added onGroupRun to deps

  // 媒体管理辅助函数
  const getNodeMedia = useCallback((nodeId: string) => {
    return mediaMapRef.current.get(nodeId) || {};
  }, []);

  const updateNodeMedia = useCallback((nodeId: string, media: any) => {
    const currentMedia = mediaMapRef.current.get(nodeId) || {};
    console.log(`[Core updateNodeMedia] 节点 ${nodeId}:`, {
      currentMedia,
      newMedia: media,
      willMerge: { ...currentMedia, ...media }
    });
    const updatedMedia = { ...currentMedia, ...media };
    
    // ✅ 处理 undefined 值：删除对应的属性而不是保留 undefined
    Object.keys(updatedMedia).forEach(key => {
      if (updatedMedia[key] === undefined) {
        delete updatedMedia[key];
      }
    });
    
    mediaMapRef.current.set(nodeId, updatedMedia);
    mediaEmitterRef.current.emit(nodeId, updatedMedia);
    console.log(`[Core updateNodeMedia] 更新后的 mediaMap:`, updatedMedia);
  }, []);

  return (
    <CanvasProvider 
      config={config} 
      components={components} 
      readOnly={mode === 'view'}
      onNodeRun={handleNodeRun}
      onNodeDataChange={onNodeDataChange}
      onNodeResize={onNodeResize}
      runningNodeId={runningNodeId}
      isExecuting={isRunning || !!runningNodeId}
      onGroupAction={handleGroupAction}
      inspectingNodeId={inspectingNodeId}
      mediaMap={mediaMapRef.current}
      mediaEmitter={mediaEmitterRef.current}
      getNodeMedia={getNodeMedia}
      updateNodeMedia={updateNodeMedia}
      renderNodeInspector={renderNodeInspector}
      renderNodeToolbar={renderNodeToolbar}
      getNodeContextMenuItems={getNodeContextMenuItems}
    >
      <div className={`canvas-flow-container ${className || ''}`} style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden', ...style }}>
        <CanvasEditor
          ref={editorRef}
          initialFlow={initialFlow}
          readOnly={mode === 'view'}
          renderEmpty={renderEmpty}
          onChange={handleFlowChange}
          onSelectionChange={handleSelectionChange} 
          
          onNodeAdd={onNodeAdd}
          onNodeCopy={onNodeCopy}
          onNodeMove={onNodeMove}
          onNodeDelete={onNodeDelete}
          onNodeDataChange={onNodeDataChange}
          onEdgeAdd={onEdgeAdd}
          onEdgeDelete={onEdgeDelete}
          
          onGroupAdd={onGroupAdd}
          onGroupDelete={onGroupDelete}
          onGroupUngroup={onGroupUngroup}
          onGroupUpdate={onGroupUpdate}
          
          onCanvasDrop={onCanvasDrop}
          onUploadNode={onUploadNode}
        />
      </div>
    </CanvasProvider>
  );
});

CanvasFlow.displayName = 'CanvasFlow';
export default CanvasFlow;
