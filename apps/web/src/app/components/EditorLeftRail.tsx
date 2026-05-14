/**
 * 编辑器左侧浮动按钮栏。
 *
 * 开源版的最小职责：
 *   1. 一颗"+"按钮，弹出 FloatingNodeMenu 用来插入节点 / 上传 / 跳转画布列表
 *   2. 一个 extraButtons 插槽，由 EditorPage 注入 VoiceGallery 等额外按钮
 *
 * 历史上这套按钮挤在 FlowGroupGallery 里，跟商业版的"工作流资产"面板
 * 耦合在一起。开源改造时 flowGroupService / authService 已经被删，但按钮
 * 是核心交互不能丢，因此抽出本文件作为独立组件。
 *
 * 菜单弹出位置用 fixed + portal，避免被祖先 transform 影响（React Flow 的
 * 主容器有 transform，会把 absolute/fixed 的坐标系搞坏）。
 */

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from '@radix-ui/themes';
import { Plus } from 'lucide-react';
import { FloatingNodeMenu, type FloatingMenuCustomItem } from '@canvas-flow/core';

export interface EditorLeftRailAddNodeMenuItem {
  type: string;
  label: string;
  icon?: React.ReactNode;
}

export interface EditorLeftRailProps {
  /** "+"菜单选中节点类型时回调；不传则不渲染"+"按钮 */
  onAddNode?: (type: string) => void;
  /** "+"菜单选中"上传"时回调 */
  onUploadNode?: (file: File) => void;
  /** 可插入的节点类型清单；缺省时 FloatingNodeMenu 用其内置默认 */
  addNodeMenuItems?: EditorLeftRailAddNodeMenuItem[];
  /** 应用层注入的导航/全局动作（如"画布"入口跳 /workspace），渲染在节点上方分割线之上 */
  customMenuItems?: FloatingMenuCustomItem[];
  /** 额外按钮插槽（如 VoiceGallery）；按从上到下渲染 */
  extraButtons?: React.ReactNode;
}

export function EditorLeftRail({
  onAddNode,
  onUploadNode,
  addNodeMenuItems,
  customMenuItems,
  extraButtons,
}: EditorLeftRailProps) {
  const [addNodeAnchor, setAddNodeAnchor] = useState<{ x: number; y: number } | null>(null);

  return (
    <>
      <div style={railContainerStyle}>
        {onAddNode && (
          <IconButton
            variant="solid"
            color="gray"
            size="3"
            radius="full"
            onClick={(e) => {
              e.stopPropagation();
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setAddNodeAnchor(
                addNodeAnchor
                  ? null
                  : {
                      x: rect.right + 6,
                      // 让菜单顶部对齐按钮顶部（FloatingNodeMenu 自身有 padding:8）
                      y: rect.top - 8,
                    },
              );
            }}
            title="添加节点"
            style={{
              boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
              backgroundColor: addNodeAnchor ? '#2a2a2a' : '#FFFFFF',
              color: addNodeAnchor ? '#fff' : '#111',
              cursor: 'pointer',
            }}
          >
            <Plus size={20} />
          </IconButton>
        )}
        {extraButtons}
      </div>

      {onAddNode && addNodeAnchor && createPortal(
        <FloatingNodeMenu
          position={addNodeAnchor}
          onAddNode={(type) => {
            onAddNode(type);
            setAddNodeAnchor(null);
          }}
          onUploadNode={onUploadNode ? (file) => {
            onUploadNode(file);
            setAddNodeAnchor(null);
          } : undefined}
          availableTypes={addNodeMenuItems}
          customItems={customMenuItems}
          onClose={() => setAddNodeAnchor(null)}
        />,
        document.body,
      )}
    </>
  );
}

const railContainerStyle: React.CSSProperties = {
  position: 'fixed',
  left: 12,
  top: '50%',
  transform: 'translateY(-50%)',
  zIndex: 1200,
  display: 'flex',
  flexDirection: 'column',
  // 居中对齐：extraButtons 现在每个触发器下方都带「画布/模板/历史/音色」二字 label，
  // 包裹 div 比单纯的 IconButton 更宽，需要让所有子项居中，否则 "+" 会偏左。
  alignItems: 'center',
  gap: 16,
};
