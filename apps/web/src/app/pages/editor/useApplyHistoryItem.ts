/**
 * 把一条生成历史"还原"到当前画布的 hook。
 *
 * 跟 useApplyTemplateAsset 类似，但只创建单个节点，不需要 applyOperations
 * 批量。流程：
 *   1. 调 generationHistoryService.instantiate(id) 拿到 { type, data, params, … }
 *   2. 在画布视口中央生成一个新节点 id（uuid 化避免与画布既有节点撞 ID）
 *   3. 把 params 写到 nodeConfigStore（让 Inspector 第一帧就能渲染正确模型）
 *   4. setFlow 把节点塞进画布；立即用 setNodeImage/Video/Audio/Text 显示媒体
 *   5. 触发 handleNodeAdd 走 useFlow 的标准创建 → 自动持久化 params + data
 */
import { useCallback } from 'react';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';

import type { CanvasConfig, CanvasFlowHandle } from '@canvas-flow/core';
import {
  generationHistoryService,
  type HistoryListItem,
} from '../../services/generationHistoryService';
import { nodeConfigStore } from '../../store/nodeConfigStore';

export interface UseApplyHistoryItemArgs {
  flowRef: React.RefObject<CanvasFlowHandle | null>;
  appConfig: CanvasConfig;
  handleNodeAdd: (node: any) => void;
  bumpConfigStoreVersion: () => void;
}

export function useApplyHistoryItem({
  flowRef,
  appConfig,
  handleNodeAdd,
  bumpConfigStoreVersion,
}: UseApplyHistoryItemArgs) {
  return useCallback(
    async (item: HistoryListItem) => {
      if (!flowRef.current) return false;

      try {
        const incoming = await generationHistoryService.instantiate(item.id);

        const def = appConfig.nodeDefinitions.find((d) => d.type === incoming.type);
        const width = incoming.width || def?.width || 250;
        const height = incoming.height || def?.height || 250;

        const viewport = flowRef.current.getViewport?.() || { x: 0, y: 0, zoom: 1 };
        const centerX = (-viewport.x + window.innerWidth / 2) / viewport.zoom;
        const centerY = (-viewport.y + window.innerHeight / 2) / viewport.zoom;

        const newNodeId = uuidv4();
        const newNode = {
          id: newNodeId,
          type: incoming.type,
          position: {
            x: centerX - width / 2,
            y: centerY - height / 2,
          },
          width,
          height,
        };

        // 1. 写入 params（Inspector 渲染用 + handleNodeAdd 后端同步用）
        if (incoming.params && Object.keys(incoming.params).length > 0) {
          nodeConfigStore.set(newNodeId, { params: incoming.params as Record<string, any> });
          bumpConfigStoreVersion();
        }

        // 2. 把节点塞进画布
        const flow = flowRef.current.getFlow();
        flowRef.current.setFlow({
          ...flow,
          nodes: [...flow.nodes, newNode],
        });

        // 3. 立刻把媒体内容画上去（handleNodeAdd 内会读 mediaMap 同步给后端）
        const data = (incoming.data || {}) as Record<string, any>;
        if (data.src) {
          if (incoming.type === 'image') flowRef.current.setNodeImage(newNodeId, data.src);
          else if (incoming.type === 'video') flowRef.current.setNodeVideo(newNodeId, data.src);
          else if (incoming.type === 'audio') flowRef.current.setNodeAudio(newNodeId, data.src);
        }
        if (data.text) flowRef.current.setNodeText(newNodeId, data.text);
        if (data.title) flowRef.current.setNodeTitle(newNodeId, data.title);
        if (data.outputData) flowRef.current.setNodeOutput(newNodeId, data.outputData);

        // 4. 走标准创建：会持久化结构 + 当前 store 里的 params + getNodeMedia 拿到的 data
        handleNodeAdd(newNode);

        toast.success('历史记录已应用到画布');
        return true;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '应用历史失败');
        return false;
      }
    },
    [appConfig, bumpConfigStoreVersion, flowRef, handleNodeAdd],
  );
}
