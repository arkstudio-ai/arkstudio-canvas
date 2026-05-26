import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CanvasEmptyState, CanvasFlow, CanvasFlowHandle, defaultComponentRegistry, type CanvasConfig, type CanvasDropEvent } from '@canvas-flow/core';
import { v4 as uuidv4 } from 'uuid';
import { Flex, Spinner, Text } from '@radix-ui/themes';
import { toast } from 'sonner';

import { useFlow } from '../../hooks/useFlow';
import { useFlowExecution } from '../../hooks/useFlowExecution';
import { useExecutionRecovery } from '../../hooks/useExecutionRecovery';
import { useGroupSave } from '../../hooks/useGroupSave';
import { ClipboardButton, ClipboardDrawer } from '../../components/clipboard';
import { clipboardStore } from '../../store/clipboardStore';
import { useUIStore } from '../../store/uiStore';
// CanvasFlow 的 `execution` prop 在开源版不再承载实际"执行"语义
// （单/组执行通过 onNodeRun / onGroupRun 走 EditorPage 自己的链路）。
// 留一个 noop 仅为兼容 prop 形状，避免 core 一侧改动。
const noopExecution = { runNode: async () => ({ output: '' }) };
import { nodeConfigStore } from '../../store/nodeConfigStore';
import { exposeDebugTools } from '../../utils/debugTools';

import { createRenderNodeFloatingWindow } from './createRenderNodeFloatingWindow';
import { useClipboardDrawerOpen } from './useClipboardDrawerOpen';
import { useNodeContextMenuItems } from './useNodeContextMenuItems';
import { useApplyTemplateAsset } from './useApplyTemplateAsset';
import { useApplyHistoryItem } from './useApplyHistoryItem';
import { NegativeTextNode } from '../../components/nodes/NegativeTextNode';
import { createRenderNodeToolbar } from '../../components/toolbar/NodeToolbarRenderer';
import { GroupSaveDialog } from '../../components/GroupSaveDialog';
// DesktopShell（P1/P2）承载画布列表、模板、音色、历史；EditorPage 只负责 P3 画布与编组/剪贴板。

const appComponentRegistry = {
  ...defaultComponentRegistry,
  'NegativeTextNode': NegativeTextNode,
};

export interface EditorPageProps {
  configLoading: boolean;
  appConfig: CanvasConfig;
}

export function EditorPage({
  configLoading,
  appConfig,
}: EditorPageProps) {
  const flowRef = useRef<CanvasFlowHandle>(null);

  const [configStoreVersion, setConfigStoreVersion] = useState(0);
  const [executingNodes, setExecutingNodes] = useState<Set<string>>(new Set());

  // 检测是否在 iframe 中
  const isInIframe = typeof window !== 'undefined' && window.self !== window.top;

  const clipboardDrawerOpen = useClipboardDrawerOpen();

  useEffect(() => {
    const unsubscribe = nodeConfigStore.subscribe(() => setConfigStoreVersion((v) => v + 1));
    return unsubscribe;
  }, []);

  const handleNotify = useCallback((type: 'success' | 'error', message: string) => {
    if (type === 'success') toast.success(message);
    else toast.error(message);
  }, []);

  const setNodeExecuting = useCallback((nodeId: string) => {
    setExecutingNodes((prev) => new Set(prev).add(nodeId));
  }, []);

  const clearNodeExecuting = useCallback((nodeId: string) => {
    setExecutingNodes((prev) => {
      const next = new Set(prev);
      next.delete(nodeId);
      return next;
    });
  }, []);

  const {
    flowId,
    currentFlow,
    loading: flowLoading,
    error,
    loadNodesData,
    // 🔥 重试状态：重试时禁用用户操作
    isRetrying,
    retryInfo,
    handleNodeAdd,
    handleNodeDelete,
    handleNodeMove,
    handleNodeResize,
    handleEdgeAdd,
    handleEdgeDelete,
    handleNodeDataChange,
    handleGroupAdd,
    handleGroupDelete,
    handleGroupUngroup,
    handleGroupUpdate,
    handleFlowChange,
    updateVersion,
  } = useFlow(flowRef, appConfig);

  const getNodeContextMenuItems = useNodeContextMenuItems(flowRef, handleNodeDataChange);

  // 模板资产应用：P2「模板」tab 通过 store 回调，把模板节点合并进当前画布。
  const bumpConfigStoreVersion = useCallback(() => setConfigStoreVersion((v) => v + 1), []);
  const applyTemplateAsset = useApplyTemplateAsset({
    flowRef,
    flowId,
    loadNodesData,
    updateVersion,
    bumpConfigStoreVersion,
  });

  // 生成历史还原：P2「历史」tab 通过 store，在画布中央生成节点。
  const applyHistoryItem = useApplyHistoryItem({
    flowRef,
    appConfig,
    handleNodeAdd,
    bumpConfigStoreVersion,
  });

  // 编组保存到模板库：GroupNode 上的「保存」图标 → 弹 GroupSaveDialog → 调 templatesService.create。
  const groupSave = useGroupSave(flowRef, flowId, handleNotify, { stripCoordinateType: true });

  useEffect(() => {
    const timer = setTimeout(() => {
      if (flowRef.current) exposeDebugTools(flowRef);
    }, 500);
    return () => clearTimeout(timer);
  }, [flowId]);

  // 把 useFlow 解析出的 flowId 推到全局 uiStore，
  // 让 P1 (CanvasRail) / P2 (SecondaryRail node tree) / 状态栏等
  // 不需要再各自 parse URL 或 props 透传。
  const setCurrentFlowId = useUIStore((s) => s.setCurrentFlowId);
  useEffect(() => {
    setCurrentFlowId(flowId ?? null);
  }, [flowId, setCurrentFlowId]);

  // 同样把当前画布的 node 列表（瘦身版）推给 store，让 P2 节点树消费。
  // 只取 id/type/label/groupId，避免节点 data 频繁变更时整个面板抖动重渲。
  const setCurrentNodes = useUIStore((s) => s.setCurrentNodes);
  const setCurrentGroups = useUIStore((s) => s.setCurrentGroups);
  const setCurrentEdgesCount = useUIStore((s) => s.setCurrentEdgesCount);
  const setCurrentFlowName = useUIStore((s) => s.setCurrentFlowName);
  useEffect(() => {
    const nodes = currentFlow?.nodes ?? [];
    setCurrentNodes(
      nodes.map((n) => ({
        id: n.id,
        type: n.type,
        groupId: n.groupId,
        // 不同节点把"显示名"放在不同字段；这里是 best-effort 兜底。
        label:
          (n.data as { label?: string; title?: string; name?: string } | undefined)?.label ??
          (n.data as { title?: string } | undefined)?.title ??
          (n.data as { name?: string } | undefined)?.name,
      })),
    );
    setCurrentGroups(
      (currentFlow?.groups ?? []).map((g) => ({
        id: g.id,
        label: g.label || '编组',
      })),
    );
    setCurrentEdgesCount((currentFlow?.edges ?? []).length);
    setCurrentFlowName(currentFlow?.meta?.name ?? '');
  }, [
    currentFlow,
    setCurrentNodes,
    setCurrentGroups,
    setCurrentEdgesCount,
    setCurrentFlowName,
  ]);

  // 把"重置缩放到 100% / 整图"的回调注册到 store, 让状态栏的缩放
  // 读数点击时能直接调用. fitView 会基于当前节点边界自适应缩放,
  // 比硬性 setViewport(zoom:1) 更符合用户预期.
  const setResetZoom = useUIStore((s) => s.setResetZoom);
  useEffect(() => {
    setResetZoom(() => flowRef.current?.fitView());
    return () => setResetZoom(null);
  }, [setResetZoom]);

  // Poll viewport zoom into the store. xyflow doesn't expose a zoom-change
  // event on our CanvasFlow wrapper (only `getViewport()`), and adding an
  // event prop to the core package risks API churn for one consumer. 300ms
  // is below the human "smooth" threshold (~500ms) for status-bar text and
  // costs basically nothing — getViewport is O(1) and the store ignores
  // identical writes (we compare before set).
  const setCurrentZoom = useUIStore((s) => s.setCurrentZoom);
  useEffect(() => {
    let lastZoom = -1;
    const tick = () => {
      const z = flowRef.current?.getViewport?.().zoom;
      if (typeof z === 'number' && z !== lastZoom) {
        lastZoom = z;
        setCurrentZoom(z);
      }
    };
    const id = window.setInterval(tick, 300);
    return () => window.clearInterval(id);
  }, [setCurrentZoom]);

  // 把"还原历史项到画布"的回调注册到 store，让 P2「历史」tab 不必拿 flowRef。
  const setApplyHistoryItemAction = useUIStore((s) => s.setApplyHistoryItem);
  useEffect(() => {
    setApplyHistoryItemAction(applyHistoryItem as (item: unknown) => Promise<boolean | void>);
    return () => setApplyHistoryItemAction(null);
  }, [applyHistoryItem, setApplyHistoryItemAction]);

  // 同步"正在执行的节点数"到 store，状态栏会订阅显示队列指示器。
  const setExecutingNodesCount = useUIStore((s) => s.setExecutingNodesCount);
  useEffect(() => {
    setExecutingNodesCount(executingNodes.size);
  }, [executingNodes, setExecutingNodesCount]);

  // 把模板还原回调注册到 store —— SecondaryTemplateList 通过它一键应用模板。
  const setApplyTemplateAssetAction = useUIStore((s) => s.setApplyTemplateAsset);
  useEffect(() => {
    setApplyTemplateAssetAction(
      applyTemplateAsset as (asset: unknown) => Promise<boolean | void>,
    );
    return () => setApplyTemplateAssetAction(null);
  }, [applyTemplateAsset, setApplyTemplateAssetAction]);

  // 节点删除：右键 P2「节点」tab 行 → 删除画布对应节点.
  //
  // useFlow 的 handleNodeDelete 只做「标记 deletedNodesRef + 清 store +
  // 同步后端」, 假设节点已经从 xyflow 画布上移除 —— 这在画布内置删除
  // (用户按 Delete) 路径下成立, 因为 xyflow 自己处理了 DOM. 但 P2 列表
  // 右键删除时, xyflow 不知情, 节点在画布上还显示着. wrapper 先 setFlow
  // 把节点 + 涉及的边从画布移除, 再调 handleNodeDelete 走原有清理.
  const setDeleteNodeFromCanvas = useUIStore((s) => s.setDeleteNodeFromCanvas);
  const deleteNodeById = useCallback(
    (nodeId: string) => {
      const handle = flowRef.current;
      if (handle) {
        const flow = handle.getFlow();
        handle.setFlow({
          ...flow,
          nodes: flow.nodes.filter((n) => n.id !== nodeId),
          edges: flow.edges.filter(
            (e) => e.source !== nodeId && e.target !== nodeId,
          ),
        });
      }
      handleNodeDelete(nodeId);
    },
    [handleNodeDelete],
  );
  useEffect(() => {
    setDeleteNodeFromCanvas(deleteNodeById);
    return () => setDeleteNodeFromCanvas(null);
  }, [deleteNodeById, setDeleteNodeFromCanvas]);

  useEffect(() => {
    if (!error) return;
    toast.error(error, {
      duration: 5000,
      action: { label: '刷新重试', onClick: () => window.location.reload() },
    });
  }, [error]);

  const { executeNode, executeGroup, recoverInFlightExecutions } = useFlowExecution({
    flowId,
    flowRef,
    handleNotify,
    loadNodesData,
    setNodeExecuting,
    clearNodeExecuting,
  });

  // 刷新页面 / 切回画布后，把后端还在 RUNNING 的任务的 loading 圈和轮询补回来。
  // 不做这一步会出现：admin 日志能看到任务还在跑，但画布上节点不转圈、
  // 任务跑完了视频也不会自动出现的"幽灵 loading 丢失"现象。
  useExecutionRecovery({
    flowId,
    flowRef,
    recoverInFlightExecutions,
  });

  // 监听来自父窗口的 postMessage（用于 iframe 场景）
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'EXECUTE_GROUP' && event.data?.groupId) {
        console.log('[EditorPage] 收到执行 Group 消息:', event.data.groupId);
        executeGroup(event.data.groupId);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [executeGroup]);

  const handleInspectorChange = useCallback(
    (nodeId: string, updates: any) => handleNodeDataChange(nodeId, updates),
    [handleNodeDataChange],
  );

  const getNodeMedia = useCallback((id: string) => flowRef.current?.getNodeMedia(id) || {}, []);

  /** Phase 4 浮动窗: 拆掉图片节点的一条入边 */
  const disconnectUpstreamEdge = useCallback(
    (targetNodeId: string, sourceNodeId: string) => {
      const flow = flowRef.current?.getFlow();
      if (!flow?.edges) return;
      const edge = flow.edges.find(
        (e: { target: string; source: string; id?: string }) =>
          e.target === targetNodeId && e.source === sourceNodeId,
      );
      if (edge?.id) handleEdgeDelete(edge.id);
    },
    [handleEdgeDelete],
  );

  /**
   * Phase 4 浮动窗「+上传」：在左侧新建 image/video 节点，连线到当前节点并触发上传。
   */
  const connectUpstreamViaUploadForTarget = useCallback(
    (targetNodeId: string, file: File) => {
      if (!flowRef.current) return;
      const flow = flowRef.current.getFlow();
      const target = flow.nodes.find((n: { id: string }) => n.id === targetNodeId);
      if (!target) return;

      const nodeType: 'image' | 'video' =
        file.type.startsWith('video/') ? 'video' : 'image';
      const def = appConfig.nodeDefinitions.find((d) => d.type === nodeType);
      const width = def?.width ?? 260;
      const height = def?.height ?? 260;
      const newNodeId = uuidv4();
      const pos = {
        x: (target.position?.x ?? 0) - width - 80,
        y: target.position?.y ?? 0,
      };
      const newNode = {
        id: newNodeId,
        type: nodeType,
        position: pos,
        width,
        height,
      };
      const edgeId = `e-${newNodeId}-${targetNodeId}`;
      const newEdge = {
        id: edgeId,
        source: newNodeId,
        target: targetNodeId,
        data: {},
      };

      flowRef.current.setFlow({
        ...flow,
        nodes: [...flow.nodes, newNode],
        edges: [...(flow.edges || []), newEdge],
      });

      handleNodeAdd(newNode);
      handleEdgeAdd(newEdge as any);
      handleNodeDataChange(newNodeId, {
        _uploadRequest: file,
        _uploadTargetKind: nodeType,
        fileName: file.name,
        fileType: file.type,
      });
    },
    [appConfig.nodeDefinitions, handleEdgeAdd, handleNodeAdd, handleNodeDataChange],
  );

  const renderNodeInspector = useCallback(
    createRenderNodeFloatingWindow({
      currentFlow,
      appConfig,
      executingNodes,
      configStoreVersion,
      getNodeMedia,
      onInspectorChange: handleInspectorChange,
      onRunNode: executeNode,
      onDisconnectUpstreamEdge: disconnectUpstreamEdge,
      onConnectUpstreamViaUploadFile: connectUpstreamViaUploadForTarget,
    }),
    [
      appConfig,
      configStoreVersion,
      connectUpstreamViaUploadForTarget,
      currentFlow,
      disconnectUpstreamEdge,
      executeNode,
      executingNodes,
      getNodeMedia,
      handleInspectorChange,
    ],
  );

  const handleToolbarUpload = useCallback((nodeId: string, file: File) => {
    const kind = file.type.startsWith('video/') ? 'video'
      : file.type.startsWith('image/') ? 'image'
      : undefined;
    handleNodeDataChange(nodeId, {
      _uploadRequest: file,
      ...(kind ? { _uploadTargetKind: kind } : {}),
      fileName: file.name,
      fileType: file.type,
    });
  }, [handleNodeDataChange]);

  const renderNodeToolbar = useCallback(
    createRenderNodeToolbar({ onUploadRequest: handleToolbarUpload }),
    [handleToolbarUpload],
  );

  // 处理从剪辑区添加视频结果到画布
  const handleAddResultToCanvas = useCallback((result: { url: string; thumbnail?: string; duration?: number }) => {
    if (!flowRef.current) return;

    const newNodeId = uuidv4();

    const viewport = flowRef.current.getViewport?.() || { x: 0, y: 0, zoom: 1 };
    const centerX = (-viewport.x + window.innerWidth / 2) / viewport.zoom;
    const centerY = (-viewport.y + window.innerHeight / 2) / viewport.zoom;

    const newNode = {
      id: newNodeId,
      type: 'video',
      position: {
        x: centerX - 125,
        y: centerY - 125,
      },
      width: 250,
      height: 250,
    };

    const flow = flowRef.current.getFlow();
    flowRef.current.setFlow({
      ...flow,
      nodes: [...flow.nodes, newNode],
    });

    flowRef.current.setNodeVideo(newNodeId, result.url);

    handleNodeAdd(newNode);
    handleNodeDataChange(newNodeId, {
      fileName: '剪辑导出.mp4',
      fileType: 'video/mp4',
      src: result.url,
    });

    console.log('[EditorPage] 从剪辑区添加视频节点到画布:', newNodeId, result.url);
  }, [handleNodeAdd, handleNodeDataChange]);

  const handleUploadNode = useCallback((file: File, position: { x: number; y: number }) => {
    if (!flowRef.current) return;

    const nodeType = file.type.startsWith('image/') ? 'image'
      : file.type.startsWith('video/') ? 'video'
      : file.type.startsWith('audio/') ? 'audio' : null;
    if (!nodeType) return;

    const def = appConfig.nodeDefinitions.find(d => d.type === nodeType);
    const width = def?.width || 260;
    const height = def?.height || 260;
    const newNodeId = uuidv4();

    const newNode = {
      id: newNodeId,
      type: nodeType,
      position: { x: position.x - width / 2, y: position.y - height / 2 },
      width,
      height,
    };

    const flow = flowRef.current.getFlow();
    flowRef.current.setFlow({ ...flow, nodes: [...flow.nodes, newNode] });
    handleNodeAdd(newNode);
    handleNodeDataChange(newNodeId, {
      _uploadRequest: file,
      _uploadTargetKind: nodeType,
      fileName: file.name,
      fileType: file.type,
    });
  }, [appConfig, handleNodeAdd, handleNodeDataChange]);

  /**
   * 计算画布视口中央对应的 flow 坐标。供"从左侧菜单添加节点"使用。
   */
  const computeCanvasCenter = useCallback(() => {
    const viewport = flowRef.current?.getViewport?.() || { x: 0, y: 0, zoom: 1 };
    return {
      x: (-viewport.x + window.innerWidth / 2) / viewport.zoom,
      y: (-viewport.y + window.innerHeight / 2) / viewport.zoom,
    };
  }, []);

  /** 从左侧"+"菜单点击节点类型 -> 在画布中心插入对应节点。 */
  const handleAddNodeFromMenu = useCallback((nodeType: string) => {
    if (!flowRef.current) return;
    const def = appConfig.nodeDefinitions.find(d => d.type === nodeType);
    const width = def?.width || 260;
    const height = def?.height || 260;
    const center = computeCanvasCenter();
    const newNodeId = uuidv4();
    const newNode = {
      id: newNodeId,
      type: nodeType,
      position: { x: center.x - width / 2, y: center.y - height / 2 },
      width,
      height,
    };
    const flow = flowRef.current.getFlow();
    flowRef.current.setFlow({ ...flow, nodes: [...flow.nodes, newNode] });
    handleNodeAdd(newNode);
  }, [appConfig, handleNodeAdd, computeCanvasCenter]);

  /** 左侧"+"菜单选择"上传"时：在画布中心创建上传节点并塞入文件。 */
  const handleUploadNodeFromMenu = useCallback((file: File) => {
    const center = computeCanvasCenter();
    handleUploadNode(file, center);
  }, [handleUploadNode, computeCanvasCenter]);

  /**
   * "+"菜单可选节点列表：在 appConfig 注册的节点定义中筛掉 group / 反向提示词等内部
   * 类型，仅保留普通可创建节点；icon 走 FloatingNodeMenu 自带的 DEFAULT_ICONS 兜底。
   */
  const addNodeMenuItems = useMemo(() => {
    const HIDDEN = new Set(['group', 'text-negative']);
    return appConfig.nodeDefinitions
      .filter((def) => !HIDDEN.has(def.type))
      .map((def) => ({ type: def.type, label: def.label }));
  }, [appConfig]);

  // 把添加节点 / 上传 / 类型清单推到 store，供 P2 SecondaryNodeTree 等驱动。
  const setAddNodeMenuItems = useUIStore((s) => s.setAddNodeMenuItems);
  const setAddNodeFromMenu = useUIStore((s) => s.setAddNodeFromMenu);
  const setUploadNodeFromMenu = useUIStore((s) => s.setUploadNodeFromMenu);
  useEffect(() => {
    setAddNodeMenuItems(addNodeMenuItems);
  }, [addNodeMenuItems, setAddNodeMenuItems]);
  useEffect(() => {
    setAddNodeFromMenu(handleAddNodeFromMenu);
    return () => setAddNodeFromMenu(null);
  }, [handleAddNodeFromMenu, setAddNodeFromMenu]);
  useEffect(() => {
    setUploadNodeFromMenu(handleUploadNodeFromMenu);
    return () => setUploadNodeFromMenu(null);
  }, [handleUploadNodeFromMenu, setUploadNodeFromMenu]);

  // 处理画布拖放事件：把拖入的 URL/文件转成 image/video/audio 节点。
  const handleCanvasDrop = useCallback((event: CanvasDropEvent) => {
    if (!flowRef.current) return;

    const { data, position } = event;
    if (!data?.url && !data?.file) return;

    const fileType: string = data.fileType || data.file?.type || '';
    const nodeType: 'image' | 'video' | 'audio' =
      fileType.startsWith('video/') ? 'video'
      : fileType.startsWith('audio/') ? 'audio'
      : 'image';

    const newNodeId = uuidv4();
    const newNode = {
      id: newNodeId,
      type: nodeType,
      position: {
        x: position.x - 125,
        y: position.y - 125,
      },
      width: 250,
      height: 250,
    };

    const flow = flowRef.current.getFlow();
    flowRef.current.setFlow({
      ...flow,
      nodes: [...flow.nodes, newNode],
    });

    if (data.url) {
      if (nodeType === 'video') flowRef.current.setNodeVideo(newNodeId, data.url);
      else if (nodeType === 'audio') flowRef.current.setNodeAudio(newNodeId, data.url);
      else flowRef.current.setNodeImage(newNodeId, data.url);

      handleNodeDataChange(newNodeId, {
        fileName: data.fileName || '拖放文件',
        fileType: fileType || 'image/png',
        src: data.url,
      });
    } else if (data.file) {
      handleNodeDataChange(newNodeId, {
        _uploadRequest: data.file,
        _uploadTargetKind: nodeType,
        fileName: data.file.name,
        fileType: data.file.type,
      });
    }

    handleNodeAdd(newNode);
    console.log('[EditorPage] 拖放创建节点:', newNodeId, nodeType, data.url || data.file);
  }, [handleNodeAdd, handleNodeDataChange]);

  // 节点复制回调：只复制到本地 store，后端同步在 handleNodeAdd 中完成
  const handleNodeCopy = useCallback((sourceNodeId: string, newNodeId: string) => {
    // 1. 复制 params 到 nodeConfigStore
    const sourceConfig = nodeConfigStore.get(sourceNodeId);
    if (sourceConfig?.params) {
      const copiedParams = JSON.parse(JSON.stringify(sourceConfig.params));
      nodeConfigStore.set(newNodeId, { 
        prompt: sourceConfig.prompt,
        params: copiedParams 
      });
      console.log('[EditorPage] 复制节点 params 到本地:', sourceNodeId, '->', newNodeId);
    }
    
    // 2. 复制 data 到 mediaMap（核心库已经在 handlePaste 中处理）
    // 这里只做日志记录
    const sourceMedia = flowRef.current?.getNodeMedia(sourceNodeId);
    if (sourceMedia && Object.keys(sourceMedia).length > 0) {
      console.log('[EditorPage] 复制节点 data 到本地:', sourceNodeId, '->', newNodeId);
    }
  }, []);

  if (configLoading) {
    return (
      <Flex align="center" justify="center" style={{ position: 'fixed', inset: 0, background: '#000' }}>
        <Flex direction="column" align="center" gap="3">
          <Spinner size="3" />
          <Text color="gray">正在加载配置...</Text>
        </Flex>
      </Flex>
    );
  }

  return (
    <>
      <style>{`
        body { margin: 0; overflow: hidden; }
        .react-flow__attribution { display: none !important; }
        .react-flow__controls { display: none !important; }
        .react-flow__panel.bottom.left { display: none !important; }
      `}</style>

      {/*
        canvas surface — `position: absolute, inset: 0` 让它撑满父级
        DesktopShell 的 P3 区，而不是 viewport (旧实现是 fixed)。这样它
        就乖乖留在三柱布局里，不再覆盖 P1/P2/StatusBar。
      */}
      <div style={{ position: 'absolute', inset: 0, background: '#000', overflow: 'hidden' }}>
        {flowLoading && (
          <Flex
            align="center"
            justify="center"
            style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000 }}
          >
            <Spinner size="3" />
          </Flex>
        )}

        {/* 🔥 重试时的遮罩层，阻止用户操作 */}
        {isRetrying && (
          <Flex
            align="center"
            justify="center"
            style={{ 
              position: 'absolute', 
              inset: 0, 
              background: 'rgba(0,0,0,0.7)', 
              zIndex: 2000,
              backdropFilter: 'blur(2px)',
            }}
          >
            <Flex direction="column" align="center" gap="3">
              <Spinner size="3" />
              <Text color="gray" size="3">
                同步失败，正在重试 ({retryInfo?.attempt}/{retryInfo?.maxRetries})...
              </Text>
              <Text color="gray" size="2">
                请稍候，重试期间请勿操作
              </Text>
            </Flex>
          </Flex>
        )}

        <CanvasFlow
          ref={flowRef}
          execution={noopExecution}
          onChange={handleFlowChange}
          onRunFlow={() => {}}
          onNodeRun={executeNode}
          onGroupRun={executeGroup}
          onGroupSave={groupSave.handleGroupSaveTrigger}
          config={appConfig}
          components={appComponentRegistry}
          renderEmpty={<CanvasEmptyState onAction={() => {}} />}
          renderNodeInspector={renderNodeInspector}
          renderNodeToolbar={renderNodeToolbar}
          getNodeContextMenuItems={getNodeContextMenuItems}
          onNodeAdd={handleNodeAdd}
          onNodeCopy={handleNodeCopy}
          onNodeDelete={handleNodeDelete}
          onNodeMove={handleNodeMove}
          onNodeResize={handleNodeResize}
          onNodeDataChange={handleNodeDataChange}
          onEdgeAdd={handleEdgeAdd}
          onEdgeDelete={handleEdgeDelete}
          onGroupAdd={handleGroupAdd}
          onGroupDelete={handleGroupDelete}
          onGroupUngroup={handleGroupUngroup}
          onGroupUpdate={handleGroupUpdate}
          onCanvasDrop={handleCanvasDrop}
          onUploadNode={handleUploadNode}
        />
      </div>

      {/*
        P1/P2 已迁入 DesktopShell。剪贴板按钮 + 抽屉仍浮动在 P3，
        后续如需可再挪到侧栏。
      */}
      {!isInIframe && (
        <>
          <ClipboardButton onClick={() => clipboardStore.toggleDrawer()} />
          <ClipboardDrawer
            open={clipboardDrawerOpen}
            onClose={() => clipboardStore.setDrawerOpen(false)}
            onAddToCanvas={handleAddResultToCanvas}
          />
        </>
      )}

      <GroupSaveDialog
        open={groupSave.showSaveGroup}
        onClose={groupSave.handleClose}
        onConfirm={groupSave.handleSaveGroup}
        saving={groupSave.saving}
      />
    </>
  );
}


