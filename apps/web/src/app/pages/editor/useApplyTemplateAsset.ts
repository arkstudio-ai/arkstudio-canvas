/**
 * 把模板资产应用到当前画布的 hook。
 *
 * 流程：
 *   1. 调 `templatesService.instantiate(id)` 拿到一份"新 ID 化"过的子图。
 *   2. 给所有节点/边/编组再换一遍前端侧的 uuid，避免与画布既有元素撞 ID。
 *   3. 立即写入到 React Flow（setFlow）+ nodeConfigStore（params），用户能瞬间
 *      看到节点出现，没有"等后端写完"的延迟。
 *   4. 异步把 GROUP_ADD/NODE_ADD/EDGE_ADD + updateNodeData/updateNodeParams
 *      推到后端持久化。即便后端这一步失败，前端也已经显示了，下次刷新会
 *      自动从 lastFlowStore 走标准加载流程，不会丢已有元素 — 但这条
 *      模板就需要用户重新点一次。这是开源版可接受的妥协。
 */
import { useCallback } from 'react';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';

import type { CanvasFlowHandle } from '@canvas-flow/core';
import { templatesService, type TemplateAsset } from '../../services/templatesService';
import { api } from '../../services/api';
import { nodeConfigStore } from '../../store/nodeConfigStore';

export interface UseApplyTemplateAssetArgs {
  flowRef: React.RefObject<CanvasFlowHandle | null>;
  flowId: string | null | undefined;
  loadNodesData: (nodeIds: string[], force?: boolean) => Promise<void>;
  updateVersion: (version: number) => void;
  bumpConfigStoreVersion: () => void;
}

export function useApplyTemplateAsset({
  flowRef,
  flowId,
  loadNodesData,
  updateVersion,
  bumpConfigStoreVersion,
}: UseApplyTemplateAssetArgs) {
  return useCallback(
    async (asset: TemplateAsset) => {
      if (!flowRef.current || !flowId) return false;

      try {
        const incoming = await templatesService.instantiate(asset.id);
        if (!incoming.nodes || incoming.nodes.length === 0) {
          toast.error('模板数据为空');
          return false;
        }

        const current = flowRef.current.getFlow();

        const oldToNewIdMap = new Map<string, string>();
        incoming.nodes.forEach((n) => oldToNewIdMap.set(n.id, uuidv4()));
        (incoming.groups || []).forEach((g) => oldToNewIdMap.set(g.id, uuidv4()));
        (incoming.edges || []).forEach((e) => oldToNewIdMap.set(e.id, uuidv4()));

        const structureGroups = (incoming.groups || []).map((g) => ({
          ...g,
          id: oldToNewIdMap.get(g.id)!,
          label: g.label || 'Group',
          position: { x: g.position?.x ?? 0, y: g.position?.y ?? 0 },
          width: g.width ?? 320,
          height: g.height ?? 240,
        }));

        const firstGroupId = structureGroups[0]?.id;

        const structureNodes = incoming.nodes.map((n: any) => {
          const oldGroupId = n.groupId || n.parentId;
          const newGroupId = oldGroupId ? oldToNewIdMap.get(oldGroupId) : firstGroupId;
          return {
            id: oldToNewIdMap.get(n.id)!,
            type: n.type,
            position: {
              x: n.position?.x ?? 0,
              y: n.position?.y ?? 0,
            },
            width: n.width,
            height: n.height,
            groupId: newGroupId,
            extent: n.extent,
          };
        });

        const structureEdges = (incoming.edges || []).map((e) => ({
          ...e,
          id: oldToNewIdMap.get(e.id)!,
          source: oldToNewIdMap.get(e.source)!,
          target: oldToNewIdMap.get(e.target)!,
        }));

        const mergedFlow = {
          ...current,
          nodes: [...current.nodes, ...structureNodes],
          edges: [...current.edges, ...structureEdges],
          groups: [...(current.groups || []), ...structureGroups],
        };

        // 立刻把 params 灌进 store，否则节点弹出后第一帧 Inspector 是空的。
        incoming.nodes.forEach((n) => {
          const newId = oldToNewIdMap.get(n.id)!;
          if (n.params) {
            nodeConfigStore.set(newId, {
              ...(nodeConfigStore.get(newId) || {}),
              params: n.params,
            });
          }
        });
        bumpConfigStoreVersion();

        flowRef.current.setFlow(mergedFlow);

        const latestFlow = await api.getFlow(flowId);

        const operations = [
          ...structureGroups.map((g: any) => ({
            op: 'GROUP_ADD',
            data: {
              id: g.id,
              label: g.label || 'Group',
              position: g.position,
              width: g.width,
              height: g.height,
            },
          })),
          ...structureNodes.map((n: any) => ({
            op: 'NODE_ADD',
            data: {
              id: n.id,
              type: n.type,
              position: n.position,
              width: n.width,
              height: n.height,
              groupId: n.groupId,
            },
          })),
          ...structureEdges.map((e: any) => ({
            op: 'EDGE_ADD',
            data: { id: e.id, source: e.source, target: e.target },
          })),
        ];

        api
          .applyOperations(flowId, latestFlow.version, operations)
          .then((res: any) => {
            updateVersion(res.version);

            const dataPromises = incoming.nodes
              .filter((n) => n.data && Object.keys(n.data).length > 0)
              .map((n) => api.updateNodeData(flowId, oldToNewIdMap.get(n.id)!, n.data));

            const paramsPromises = incoming.nodes
              .filter((n) => n.params && Object.keys(n.params).length > 0)
              .map((n) => api.updateNodeParams(flowId, oldToNewIdMap.get(n.id)!, n.params));

            const allPromises = [...dataPromises, ...paramsPromises];
            if (allPromises.length === 0) return undefined;
            return Promise.all(allPromises).then(() => {
              const newNodeIds = incoming.nodes.map((n) => oldToNewIdMap.get(n.id)!);
              return loadNodesData(newNodeIds, false);
            });
          })
          .catch((err) => {
            console.warn('[useApplyTemplateAsset] 后端持久化失败（前端已渲染）:', err);
          });

        toast.success('模板已应用到画布');
        return true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : '应用模板失败');
        return false;
      }
    },
    [bumpConfigStoreVersion, flowId, flowRef, loadNodesData, updateVersion],
  );
}
