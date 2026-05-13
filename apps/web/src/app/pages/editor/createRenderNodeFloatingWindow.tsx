import type { CanvasConfig } from '@canvas-flow/core';
import { ImageFloatingWindowPanel } from '../../components/floating-window/image/ImageFloatingWindowPanel';
import { VideoFloatingWindowPanel } from '../../components/floating-window/video/VideoFloatingWindowPanel';
import { AudioFloatingWindowPanel } from '../../components/floating-window/audio/AudioFloatingWindowPanel';
import { TextFloatingWindowPanel } from '../../components/floating-window/text/TextFloatingWindowPanel';
import { nodeConfigStore } from '../../store/nodeConfigStore';

export interface CreateRenderNodeFloatingWindowArgs {
  currentFlow: any;
  appConfig: CanvasConfig;
  executingNodes: Set<string>;
  /**
   * Bumped to force a re-render after async config-store writes.
   * Read once per render so React picks up the change; never used directly.
   */
  configStoreVersion: number;
  getNodeMedia: (nodeId: string) => Record<string, unknown>;
  onInspectorChange: (nodeId: string, updates: any) => void;
  onRunNode: (nodeId: string) => void;
  onDisconnectUpstreamEdge: (targetNodeId: string, sourceNodeId: string) => void;
  onConnectUpstreamViaUploadFile: (targetNodeId: string, file: File) => void;
}

export function createRenderNodeFloatingWindow({
  currentFlow,
  appConfig,
  executingNodes,
  configStoreVersion,
  getNodeMedia,
  onInspectorChange,
  onRunNode,
  onDisconnectUpstreamEdge,
  onConnectUpstreamViaUploadFile,
}: CreateRenderNodeFloatingWindowArgs) {
  return ({ nodeId, node }: any) => {
    void configStoreVersion;

    const config = nodeConfigStore.get(nodeId);

    const upstreamNodes: {
      id: string;
      type: string;
      label: string;
      position: { x: number; y: number };
      data: any;
    }[] = [];

    if (currentFlow) {
      const incomingEdges = currentFlow.edges.filter((edge: any) => edge.target === nodeId);
      for (const edge of incomingEdges) {
        const sourceNode = currentFlow.nodes.find((n: any) => n.id === edge.source);
        if (sourceNode) {
          const nodeDef = appConfig.nodeDefinitions.find((def: any) => def.type === sourceNode.type);
          const label = nodeDef?.label || sourceNode.type;
          upstreamNodes.push({
            id: sourceNode.id,
            type: sourceNode.type,
            label,
            position: sourceNode.position ?? { x: 0, y: 0 },
            data: sourceNode.data || {},
          });
        }
      }
    }

    if (node.type === 'audio') {
      return (
        <AudioFloatingWindowPanel
          nodeId={nodeId}
          appConfig={appConfig}
          config={config}
          isRunning={executingNodes.has(nodeId)}
          onChange={(updates) => onInspectorChange(nodeId, updates)}
          onRun={() => onRunNode(nodeId)}
        />
      );
    }

    if (node.type === 'text') {
      return (
        <TextFloatingWindowPanel
          nodeId={nodeId}
          appConfig={appConfig}
          upstreamNodes={upstreamNodes}
          config={config}
          isRunning={executingNodes.has(nodeId)}
          getNodeMedia={getNodeMedia}
          onChange={(updates) => onInspectorChange(nodeId, updates)}
          onRun={() => onRunNode(nodeId)}
          onDisconnectUpstream={(sourceId) => onDisconnectUpstreamEdge(nodeId, sourceId)}
          onAddUpstreamViaFile={(file) => onConnectUpstreamViaUploadFile(nodeId, file)}
        />
      );
    }

    if (node.type === 'image') {
      return (
        <ImageFloatingWindowPanel
          nodeId={nodeId}
          appConfig={appConfig}
          upstreamNodes={upstreamNodes}
          config={config}
          isRunning={executingNodes.has(nodeId)}
          getNodeMedia={getNodeMedia}
          onChange={(updates) => onInspectorChange(nodeId, updates)}
          onRun={() => onRunNode(nodeId)}
          onDisconnectUpstream={(sourceId) => onDisconnectUpstreamEdge(nodeId, sourceId)}
          onAddUpstreamViaFile={(file) => onConnectUpstreamViaUploadFile(nodeId, file)}
        />
      );
    }

    if (node.type === 'video') {
      return (
        <VideoFloatingWindowPanel
          nodeId={nodeId}
          appConfig={appConfig}
          upstreamNodes={upstreamNodes}
          config={config}
          isRunning={executingNodes.has(nodeId)}
          getNodeMedia={getNodeMedia}
          onChange={(updates) => onInspectorChange(nodeId, updates)}
          onRun={() => onRunNode(nodeId)}
          onDisconnectUpstream={(sourceId) => onDisconnectUpstreamEdge(nodeId, sourceId)}
          onAddUpstreamViaFile={(file) => onConnectUpstreamViaUploadFile(nodeId, file)}
        />
      );
    }

    return null;
  };
}
