import { Play, Save, Ungroup } from 'lucide-react';
import type { ToolbarAction } from '@canvas-flow/core';

/**
 * 编组工具栏按钮配置
 * 
 * 工具栏样式说明：
 * - 胶囊形状容器，放置在编组正上方中央
 * - 深色背景 (#1e1e1e)，圆角 (border-radius: 20px)
 * - 带阴影效果 (box-shadow: 0 4px 16px rgba(0,0,0,0.5))
 * - 按钮 hover 时背景变亮
 * - "整组执行" 按钮使用绿色高亮 (#4ade80)
 */

export interface GroupToolbarConfig {
  runGroup?: Partial<ToolbarAction> | false;
  saveGroup?: Partial<ToolbarAction> | false;
  ungroupButton?: Partial<ToolbarAction> | false;
}

/**
 * 创建编组工具栏按钮数组
 */
export function createGroupToolbar(
  groupId: string,
  callbacks: {
    onRun?: (groupId: string) => void;
    onSave?: (groupId: string) => void;
    onUngroup?: (groupId: string) => void;
  },
  config?: GroupToolbarConfig
): ToolbarAction[] {
  const actions: ToolbarAction[] = [];

  if (config?.runGroup !== false && callbacks.onRun) {
    actions.push({
      id: 'run',
      label: '整组执行',
      icon: Play,
      onClick: (e) => {
        e.stopPropagation();
        callbacks.onRun?.(groupId);
      },
      className: 'text-green',
      ...config?.runGroup,
    });
  }

  if (config?.saveGroup !== false && callbacks.onSave) {
    actions.push({
      id: 'save',
      label: '保存',
      icon: Save,
      onClick: (e) => {
        e.stopPropagation();
        callbacks.onSave?.(groupId);
      },
      ...config?.saveGroup,
    });
  }

  if (config?.ungroupButton !== false && callbacks.onUngroup) {
    actions.push({
      id: 'ungroup',
      label: '解组',
      icon: Ungroup,
      onClick: (e) => {
        e.stopPropagation();
        callbacks.onUngroup?.(groupId);
      },
      ...config?.ungroupButton,
    });
  }

  return actions;
}
