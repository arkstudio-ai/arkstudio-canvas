/**
 * 保存编组到模板库的弹窗 hook。
 *
 * 商业版叫 "保存为编组资产"，对应 flow-groups 接口；开源版统一收敛到
 * `templatesService`。触发方式有两种：
 *   - GroupNode 上的"保存"图标 → 携带 group payload
 *   - 编辑器顶栏的手动按钮（暂未启用，但 hook 仍暴露 handleManualTrigger）
 *
 * 失败不抛弹窗、由调用方传入的 notify 决定（EditorPage 走 sonner.toast）。
 */
import { useCallback, useState } from 'react';
import type { CanvasFlowHandle } from '@canvas-flow/core';
import { templatesService, type TemplateTag } from '../services/templatesService';

type NotificationType = 'success' | 'error';

type GroupSaveOptions = {
  /** true 时去掉 _coordinateType（避免污染 template 结构） */
  stripCoordinateType?: boolean;
};

export interface GroupSavePayload {
  name: string;
  description: string;
  tags: TemplateTag[];
  cover?: string;
}

export function useGroupSave(
  flowRef: React.RefObject<CanvasFlowHandle | null>,
  flowId: string | null | undefined,
  notify?: (type: NotificationType, msg: string) => void,
  options: GroupSaveOptions = {},
) {
  const [showSaveGroup, setShowSaveGroup] = useState(false);
  const [pendingGroupData, setPendingGroupData] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const { stripCoordinateType = true } = options;

  const handleGroupSaveTrigger = useCallback((groupId: string, groupData: any) => {
    console.log('[useGroupSave] 触发保存编组:', groupId);
    setPendingGroupData(groupData);
    setShowSaveGroup(true);
  }, []);

  const handleManualTrigger = useCallback(() => {
    setPendingGroupData(null);
    setShowSaveGroup(true);
  }, []);

  const handleClose = useCallback(() => {
    setShowSaveGroup(false);
    setPendingGroupData(null);
  }, []);

  const handleSaveGroup = useCallback(
    async (data: GroupSavePayload) => {
      if (!flowId) {
        notify?.('error', '当前画布未就绪，无法保存模板');
        return;
      }

      let finalJson: { nodes: any[]; edges: any[]; groups: any[]; meta?: any } | null = null;

      if (pendingGroupData) {
        finalJson = {
          nodes: pendingGroupData.nodes || [],
          edges: pendingGroupData.edges || [],
          groups: pendingGroupData.groups || [],
          meta: pendingGroupData.meta || {},
        };
      } else {
        const currentFlow = flowRef.current?.getFlow();
        if (!currentFlow) {
          notify?.('error', '无法获取工作流数据');
          return;
        }

        let nodesToSave = currentFlow.nodes.filter((n: any) => n.selected);
        if (nodesToSave.length === 0) {
          nodesToSave = currentFlow.nodes;
        }

        const nodeIds = new Set(nodesToSave.map((n) => n.id));
        const edgesToSave = (currentFlow.edges || []).filter(
          (e) => nodeIds.has(e.source) && nodeIds.has(e.target),
        );

        finalJson = {
          nodes: nodesToSave,
          edges: edgesToSave,
          groups: currentFlow.groups || [],
          meta: {},
        };
      }

      if (stripCoordinateType && finalJson) {
        finalJson = {
          ...finalJson,
          nodes: finalJson.nodes.map((n: any) => {
            const { _coordinateType, ...rest } = n || {};
            return rest;
          }),
        };
      }

      try {
        setSaving(true);
        await templatesService.create({
          name: data.name,
          description: data.description,
          cover: data.cover,
          flowId,
          tags: data.tags,
          json: finalJson!,
        });
        notify?.('success', '模板已保存');
        handleClose();
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        notify?.('error', `保存失败：${errMsg}`);
      } finally {
        setSaving(false);
      }
    },
    [flowId, pendingGroupData, flowRef, stripCoordinateType, notify, handleClose],
  );

  return {
    showSaveGroup,
    saving,
    handleManualTrigger,
    handleGroupSaveTrigger,
    handleClose,
    handleSaveGroup,
  };
}
