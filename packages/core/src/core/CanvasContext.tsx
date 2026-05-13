import React, { createContext, useContext } from 'react';
import { CanvasConfig, ComponentRegistry } from '../types/schema';
import { CanvasFlowNode } from '../types/flow';
import { NodeMediaEmitter } from './NodeMediaEmitter';

export type GroupActionType = 'create' | 'delete' | 'update' | 'move' | 'ungroup' | 'run' | 'save';

/** 自定义右键菜单项 */
export interface CustomContextMenuItem {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  icon?: React.ReactNode;
}

interface CanvasContextValue {
  config: CanvasConfig;
  components: ComponentRegistry;
  readOnly: boolean;
  onNodeRun?: (nodeId: string) => Promise<void>;
  onNodeDataChange?: (nodeId: string, data: any) => void;
  /**
   * Reports a node dimension change driven by *content* auto-fit (e.g. an
   * image / video finished loading and the node re-sized itself to match the
   * media's aspect ratio).
   *
   * This is intentionally separate from `onNodeDataChange` because content
   * auto-fit produces a structural mutation (node.width / node.height) that
   * must be persisted to the backend, whereas `onNodeDataChange` only carries
   * payload-level updates (the upstream useFlow handler filters out anything
   * starting with `_`, which would silently drop `_contentSize` if we tried
   * to piggy-back).
   *
   * The emitter (UniversalNode) is responsible for debouncing this callback
   * so consumers can wire it straight to a network call.
   */
  onNodeResize?: (nodeId: string, dimensions: { width: number; height: number }) => void;
  runningNodeId?: string | null;
  // The ID of the node that should display its inspector (usually the single selected node)
  inspectingNodeId?: string | null;
  // Global execution state (true if ANY execution is happening - single, group, or flow)
  isExecuting?: boolean;
  // New callback for Group operations
  onGroupAction?: (type: GroupActionType, payload: any) => void;
  // Global overlay state for mutex
  activeOverlay?: { nodeId: string; elementId: string } | null;
  setActiveOverlay?: (overlay: { nodeId: string; elementId: string } | null) => void;
  // 媒体数据管理
  mediaMap: Map<string, any>;
  mediaEmitter: NodeMediaEmitter;
  getNodeMedia: (nodeId: string) => any;
  updateNodeMedia: (nodeId: string, media: any) => void;
  // Custom Inspector rendering (Render Props)
  renderNodeInspector?: (props: {
    nodeId: string;
    node: CanvasFlowNode;
  }) => React.ReactNode | null;
  // Custom Top Toolbar rendering (Render Props)
  renderNodeToolbar?: (props: {
    nodeId: string;
    node: CanvasFlowNode;
  }) => React.ReactNode | null;
  // Custom context menu items
  getNodeContextMenuItems?: (
    nodeId: string,
    node: CanvasFlowNode,
    mediaData: any
  ) => CustomContextMenuItem[];
}

const CanvasContext = createContext<CanvasContextValue | null>(null);

export const CanvasProvider: React.FC<CanvasContextValue & { children: React.ReactNode }> = ({ 
  children, 
  ...value 
}) => {
  return (
    <CanvasContext.Provider value={value}>
      {children}
    </CanvasContext.Provider>
  );
};

export const useCanvasContext = () => {
  const context = useContext(CanvasContext);
  if (!context) {
    throw new Error('useCanvasContext must be used within a CanvasProvider');
  }
  return context;
};
