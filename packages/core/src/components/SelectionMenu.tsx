import React from 'react';
import { Node, useReactFlow } from '@xyflow/react';
import { Group } from 'lucide-react';
import { getBounds } from '../core/utils';

interface SelectionMenuProps {
  selectedNodes: Node[];
  onCreateGroup: () => void;
}

export const SelectionMenu: React.FC<SelectionMenuProps> = ({ selectedNodes, onCreateGroup }) => {
  const { flowToScreenPosition, getNodes } = useReactFlow();

  // 过滤掉已经是 group 的节点
  const validNodes = selectedNodes.filter(n => n.type !== 'group');

  if (validNodes.length < 2) return null;

  // ✅ 限制：如果选中的节点中有任何一个已经在编组内，不显示编组按钮
  const hasNodeInGroup = validNodes.some(n => n.parentId);
  if (hasNodeInGroup) return null;

  // 获取所有节点用于查找父编组
  const allNodes = getNodes();
  const nodeMap = new Map(allNodes.map(n => [n.id, n]));

  // 计算每个节点的绝对坐标
  const bounds = getBounds(validNodes.map(n => {
    let absolutePosition = n.position;
    
    // 如果节点在编组内，需要加上父编组的位置得到绝对坐标
    if (n.parentId) {
      const parentNode = nodeMap.get(n.parentId as string);
      if (parentNode) {
        absolutePosition = {
          x: n.position.x + parentNode.position.x,
          y: n.position.y + parentNode.position.y
        };
      }
    }
    
    return {
      position: absolutePosition,
      width: n.measured?.width || n.width || 0,
      height: n.measured?.height || n.height || 0
    };
  }));

  // 计算中心上方位置 (Flow 坐标)
  const centerFlow = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y
  };

  // 转换为屏幕坐标
  const screenPos = flowToScreenPosition(centerFlow);

  return (
    <div
      style={{
        position: 'absolute',
        left: screenPos.x,
        top: screenPos.y - 40, 
        transform: 'translate(-50%, -100%)', // 向上偏移
        zIndex: 2000,
        pointerEvents: 'all',
      }}
    >
      <button
        onClick={(e) => {
            e.stopPropagation();
            onCreateGroup();
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 16px',
          backgroundColor: '#1a1a1a',
          color: 'white',
          border: '1px solid #333',
          borderRadius: 20,
          cursor: 'pointer',
          boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          fontSize: 13,
          fontWeight: 500,
          outline: 'none'
        }}
        onMouseEnter={e => e.currentTarget.style.backgroundColor = '#2a2a2a'}
        onMouseLeave={e => e.currentTarget.style.backgroundColor = '#1a1a1a'}
      >
        <Group size={14} />
        编组
      </button>
    </div>
  );
};


