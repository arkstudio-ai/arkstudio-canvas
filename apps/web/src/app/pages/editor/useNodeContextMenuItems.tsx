import { useCallback, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import { Film, Download, Ban, X } from 'lucide-react';
import type { MutableRefObject } from 'react';

import type { CustomContextMenuItem, CanvasFlowNode, CanvasFlowHandle } from '@canvas-flow/core';
import { clipboardStore } from '../../store/clipboardStore';
import { videoEditorBridge } from '../../services/videoEditorBridge';

type MediaResourceType = 'video' | 'image' | 'audio';

interface NodeMediaData {
  src?: string;
  resourceType?: MediaResourceType;
  fileName?: string;
  title?: string;
  thumbnail?: string;
}

function isNodeMediaData(value: unknown): value is NodeMediaData {
  if (!value || typeof value !== 'object') return false;
  return true;
}

export function useNodeContextMenuItems(
  flowRef: MutableRefObject<CanvasFlowHandle | null>,
  onNodeDataChange?: (nodeId: string, data: any) => void,
) {
  // 用 ref 保持最新的 onNodeDataChange，避免 useCallback 闭包陈旧问题
  const onNodeDataChangeRef = useRef(onNodeDataChange);
  useEffect(() => {
    onNodeDataChangeRef.current = onNodeDataChange;
  }, [onNodeDataChange]);

  return useCallback(
    (nodeId: string, node: CanvasFlowNode, mediaData: any): CustomContextMenuItem[] => {
      const items: CustomContextMenuItem[] = [];
      const md: NodeMediaData = isNodeMediaData(mediaData) ? (mediaData as NodeMediaData) : {};

      // 文本节点 / 反向提示词节点：切换类型
      if (node.type === 'text' || node.type === 'text-negative') {
        const isNegative = node.type === 'text-negative';
        items.push({
          label: isNegative ? '取消反向提示词' : '设为反向提示词',
          icon: isNegative ? <X size={16} /> : <Ban size={16} />,
          onClick: () => {
            if (!flowRef.current) return;
            const newType = isNegative ? 'text' : 'text-negative';
            const flow = flowRef.current.getFlow();
            flowRef.current.setFlow({
              ...flow,
              nodes: flow.nodes.map(n => n.id === nodeId ? { ...n, type: newType } : n),
            });
            toast.success(newType === 'text-negative' ? '已设为反向提示词' : '已取消反向提示词');
          },
        });
        return items;
      }

      if (!md.src) return items;

      const isInClipboard = clipboardStore.hasResource(nodeId);

      const getResourceType = (): MediaResourceType => {
        if (md.resourceType) return md.resourceType;
        if (node.type === 'video') return 'video';
        if (node.type === 'audio') return 'audio';
        const src = md.src?.toLowerCase() || '';
        if (src.match(/\.(mp4|webm|mov|avi)$/)) return 'video';
        if (src.match(/\.(mp3|wav|ogg|m4a)$/)) return 'audio';
        return 'image';
      };

      const getName = (): string => {
        if (md.fileName) return md.fileName;
        if (md.title) return md.title;
        try {
          // md.src 已在调用入口被 `if (!md.src) return items` 守卫。
          const url = new URL(md.src!);
          const fileName = url.pathname.split('/').pop();
          if (fileName) return decodeURIComponent(fileName);
        } catch {}
        return `${node.type} 资源`;
      };

      if (isInClipboard) {
        items.push({
          label: '✓ 已在剪辑区',
          onClick: () => clipboardStore.setDrawerOpen(true),
          icon: <Film size={16} />,
        });
      } else {
        items.push({
          label: '加入剪辑区',
          onClick: () => {
            const type = getResourceType();
            const resource = {
              id: uuidv4(),
              nodeId,
              url: md.src!,
              type,
              name: getName(),
              thumbnail: md.thumbnail || (type === 'image' ? md.src : undefined),
              addedAt: Date.now(),
            };
            clipboardStore.addResource(resource);
            videoEditorBridge.sendResource(resource);
            toast.success('已加入剪辑区');
          },
          icon: <Film size={16} />,
        });
      }

      // 下载资源
      items.push({
        label: '下载资源',
        onClick: async () => {
          try {
            const fileName = getName();
            const response = await fetch(md.src!);
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            toast.success('下载已开始');
          } catch (error) {
            console.error('下载失败:', error);
            toast.error('下载失败，请重试');
          }
        },
        icon: <Download size={16} />,
      });

      return items;
    },
    [],
  );
}





