import { memo, useCallback, useRef, useEffect, useState } from 'react';
import { Handle, Position, NodeToolbar, NodeProps, useReactFlow, useEdges } from '@xyflow/react';
import { Loader2 } from 'lucide-react';
import { useCanvasContext } from './CanvasContext';
import { NodeContentProps } from '../types/schema';
import { NodeTitleEditor } from '../components/NodeTitleEditor';

function useDebouncedCallback<T extends (...args: any[]) => any>(
  callback: T,
  delay: number
) {
  const callbackRef = useRef(callback);
  const timeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  return useCallback((...args: Parameters<T>) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      callbackRef.current(...args);
    }, delay);
  }, [delay]);
}

export const UniversalNode = memo((props: NodeProps) => {
  // Cast props to any to access style if it's not in the types yet, or extend NodeProps
  const { id, data, selected, style } = props as any; 
  const {
    config,
    components,
    readOnly,
    onNodeRun,
    onNodeDataChange,
    onNodeResize,
    inspectingNodeId,
    mediaMap,
    mediaEmitter,
    renderNodeInspector,
    renderNodeToolbar,
  } = useCanvasContext();
  const { setNodes } = useReactFlow();
  const edges = useEdges();
  
  // 订阅媒体数据更新
  // 初始化时从 mediaMap 获取，如果没有则使用 props.data
  const [nodeMedia, setNodeMedia] = useState(() => {
    const mediaFromMap = mediaMap.get(id);
    if (mediaFromMap && Object.keys(mediaFromMap).length > 0) {
      return mediaFromMap;
    }
    // 降级：使用 props.data（向后兼容）
    return data || {};
  });
  
  useEffect(() => {
    const handler = (updatedMedia: any) => {
      setNodeMedia(updatedMedia);
    };
    mediaEmitter.on(id, handler);
    return () => mediaEmitter.off(id, handler);
  }, [id, mediaEmitter]);


  // 1. 查找节点定义
  const nodeType = props.type || 'default';
  const definition = config.nodeDefinitions.find(def => def.type === nodeType);

  if (!definition) {
    return (
      <div style={{ padding: 10, border: '1px solid red', borderRadius: 4, background: '#fff0f0' }}>
        Unknown node type: {nodeType}
      </div>
    );
  }

  // 2. 查找内容渲染组件
  const ContentComponent = components[definition.component];

  // Debounce the external sync to prevent API flooding
  const debouncedSync = useDebouncedCallback((nodeId: string, newData: any) => {
    if (onNodeDataChange) {
      onNodeDataChange(nodeId, newData);
    }
  }, 500);

  // Auto-fit resize signal — debounced separately from data sync because
  // `_contentSize` can fire multiple times during media load (e.g. video
  // dimension events) and we only want the final stable size hitting the
  // backend. 800ms gives the browser time to settle before persisting.
  const debouncedResize = useDebouncedCallback(
    (nodeId: string, dimensions: { width: number; height: number }) => {
      onNodeResize?.(nodeId, dimensions);
    },
    800,
  );

  const handleNodeChange = (newData: any) => {
    // 1. Update local nodeMedia state immediately (UI responds instantly)
    const updatedMedia = { ...nodeMedia, ...newData };
    setNodeMedia(updatedMedia);
    
    // 2. Update mediaMap cache (托管缓存)
    mediaMap.set(id, updatedMedia);
    mediaEmitter.emit(id, updatedMedia);
    
    // 3. Update React Flow node data (让外部应用能监听到变更)
    setNodes((nodes) =>
      nodes.map((node) => {
        if (node.id === id) {
          const mergedData = { ...node.data, ...newData };
          
          // 自适应尺寸：检测到 _contentSize 时按比例调整节点大小
          if (newData._contentSize) {
            const { width: nw, height: nh } = newData._contentSize;
            const ratio = nw / nh;
            const defW = definition!.width || 260;
            const defH = definition!.height || 260;
            const defaultDim = Math.min(defW, defH);

            let targetWidth: number;
            let targetHeight: number;
            if (ratio >= 1) {
              targetHeight = defaultDim;
              targetWidth = Math.round(defaultDim * ratio);
            } else {
              targetWidth = defaultDim;
              targetHeight = Math.round(defaultDim / ratio);
            }

            // Only push to the backend when the computed dimensions actually
            // diverge from what's already on the node. This avoids a write
            // amplification loop on every page-load: after refresh the media
            // re-loads, `_contentSize` re-fires, target* matches the persisted
            // size, and we silently no-op instead of round-tripping a PATCH.
            const curW = typeof node.width === 'number' ? node.width : 0;
            const curH = typeof node.height === 'number' ? node.height : 0;
            if (Math.abs(curW - targetWidth) > 2 || Math.abs(curH - targetHeight) > 2) {
              debouncedResize(id, { width: targetWidth, height: targetHeight });
            }

            return {
              ...node,
              data: mergedData,
              width: targetWidth,
              height: targetHeight,
              style: { ...node.style, width: `${targetWidth}px`, height: `${targetHeight}px` },
            };
          }

          return { ...node, data: mergedData };
        }
        return node;
      })
    );
    
    // 4. Notify external (debounced sync to backend)
    debouncedSync(id, newData);
  };

  const isConnected = edges.some(e => e.source === id || e.target === id);

  // 历史上这里维护过 upstreamNodes 列表供节点内容使用；当前由 onRequestOptions
  // / Inspector 通过 CanvasContext 自取，本节点不再需要这份订阅。

  const contentProps: NodeContentProps = {
    nodeId: id,
    data: { ...data, ...nodeMedia },
    selected: !!selected,
    isConnected,
    onChange: handleNodeChange,
    onRun: onNodeRun ? () => onNodeRun(id) : undefined,
    style: style,
  };

  // 构建节点类名
  const nodeClassName = [
    'canvas-node',
    selected ? 'selected' : '',
    nodeMedia._error ? 'error' : '',
  ].filter(Boolean).join(' ');

  const nodeForRender = { id, type: nodeType, position: { x: 0, y: 0 }, data: nodeMedia };
  const toolbarContent = renderNodeToolbar?.({ nodeId: id, node: nodeForRender });
  const inspectorContent = renderNodeInspector?.({ nodeId: id, node: nodeForRender });

  return (
    <div className={nodeClassName} style={{width: '100%', height: '100%'}}>
      {/* Top Toolbar (Render Props pattern) */}
      {toolbarContent && (
        <NodeToolbar isVisible={!!selected && !readOnly} position={Position.Top}>
          {toolbarContent}
        </NodeToolbar>
      )}

      {/*
        Bottom Inspector (Render Props pattern)
        — 直接作为节点 root 的子元素绝对定位,而非走 NodeToolbar.
          NodeToolbar 内部会反向应用 viewport.zoom 让工具栏保持原视觉大小;
          我们这里希望浮动窗"随画布缩放",所以让它继承 React Flow 节点
          的 transform: scale,这样视觉上跟节点一起缩放 (与竞品一致).
        — popover (ChipBase / AtMenu) 仍走 createPortal 到 body 不缩放,
          保证可读性.
      */}
      {inspectorContent && id === inspectingNodeId && !readOnly && (
        <div
          className="cf-node-bottom-inspector"
          style={{
            position: 'absolute',
            top: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            marginTop: 12,
            zIndex: 10,
            pointerEvents: 'auto',
          }}
        >
          {inspectorContent}
        </div>
      )}

      {/* Title Editor */}
      <NodeTitleEditor
        title={nodeMedia.title || ''}
        defaultTitle={definition.label}
        onChange={handleNodeChange}
      />

      {/* Handles */}
      <Handle type="target" position={Position.Left} className="canvas-handle" />
      
      {/* Content Body */}
      <div className="canvas-node-body" style={{ position: 'relative' }}>
        {ContentComponent ? (
          <ContentComponent {...contentProps} />
        ) : (
          <div style={{ padding: 10 }}>Missing Component: {definition.component}</div>
        )}

        {/* GLOBAL LOADING OVERLAY */}
        {(nodeMedia._loading || nodeMedia._executionStatus === 'running') && (
            <div className="cf-upload-loading-overlay" style={{
                position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                background: 'rgba(0,0,0,0.7)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                zIndex: 20, color: '#fff', gap: 8, borderRadius: 'inherit'
            }}>
                <Loader2 className="cf-spinner" size={24} style={{ animation: 'spin 1s linear infinite' }} />
                <span style={{fontSize: 12}}>Running...</span>
                <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
            </div>
        )}
      </div>

      {/* Compact error chip — red dot + "失败" label, hover shows full reason.
       *  Detail goes into `data-detail` so CSS controls the tooltip layout
       *  and the chip itself stays a single-line pill. */}
      {nodeMedia._error && (
        <div
          className="cf-node-error-bar"
          data-detail={String(nodeMedia._error)}
          title={String(nodeMedia._error)}
        >
          <span className="cf-node-error-icon" aria-hidden="true" />
          <span className="cf-node-error-text">失败</span>
        </div>
      )}
      
      <Handle type="source" position={Position.Right} className="canvas-handle" />
    </div>
  );
});
