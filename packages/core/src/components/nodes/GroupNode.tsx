import React, { memo, useState, useCallback, useMemo } from 'react';
import { NodeProps, NodeResizer, useReactFlow, useViewport } from '@xyflow/react';
import { Play, Ungroup, Save } from 'lucide-react';
import { useCanvasContext } from '../../core/CanvasContext';
import type { ToolbarAction } from './ActionToolbar';

export const GroupNode = memo(({ id, data, selected }: NodeProps) => {
  const { setNodes } = useReactFlow();
  const { onGroupAction } = useCanvasContext();
  const { zoom } = useViewport();
  
  const [isEditing, setIsEditing] = useState(false);
  const [labelInput, setLabelInput] = useState(data.label as string || 'Group');

  const style = data.style as any;
  
  // 反向缩放，使标题和工具栏大小固定不随画布缩放
  const inverseScale = 1 / zoom;
  
  const handleRename = useCallback(() => {
    setIsEditing(false);
    
    // 1. Local Update (Optimistic)
    setNodes((nodes) => nodes.map(n => {
      if (n.id === id) {
        return { ...n, data: { ...n.data, label: labelInput } };
      }
      return n;
    }));

    // 2. Notify Parent
    if (onGroupAction) {
        onGroupAction('update', { id, label: labelInput });
    }
  }, [id, labelInput, setNodes, onGroupAction]);

  const handleUngroup = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (onGroupAction) {
        onGroupAction('ungroup', { id });
    }
  }, [id, onGroupAction]);

  const handleRun = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (onGroupAction) {
        onGroupAction('run', { id });
    }
  }, [id, onGroupAction]);

  const defaultActions: ToolbarAction[] = useMemo(() => [
    {
        id: 'run',
        label: '整组执行',
        icon: Play,
        onClick: handleRun,
        className: 'text-green'
    },
    {
        id: 'save',
        label: '保存',
        icon: Save,
        onClick: (e) => {
            e.stopPropagation();
            if (onGroupAction) {
                onGroupAction('save', { id });
            }
        }
    },
    {
        id: 'ungroup',
        label: '解组',
        icon: Ungroup,
        onClick: handleUngroup
    }
  ], [handleRun, handleUngroup]);

  const actions = (data.toolbarActions as ToolbarAction[]) || defaultActions;

  const handleResizeEnd = useCallback((_event: any, params: any) => {
    if (onGroupAction) {
        onGroupAction('update', { 
            id, 
            width: params.width, 
            height: params.height,
            style: { ...style, width: params.width, height: params.height }
        });
    }
  }, [id, style, onGroupAction]);

  return (
    <div style={{ 
      width: '100%', 
      height: '100%', 
      backgroundColor: style?.backgroundColor || 'rgba(30, 30, 30, 0.6)', 
      border: selected ? '1px solid #ffffff' : '1px solid rgba(255,255,255,0.1)',
      borderRadius: 12,
      position: 'relative',
      transition: 'all 0.2s ease',
      boxShadow: selected ? '0 0 0 2px rgba(255, 255, 255, 0.2)' : 'none',
    }}>
      <NodeResizer 
        minWidth={100} 
        minHeight={100} 
        isVisible={!!selected} 
        lineStyle={{ border: 'none' }}
        handleStyle={{ width: 10, height: 10, borderRadius: 2 }}
        color="#ffffff"
        onResizeEnd={handleResizeEnd}
      />
      
      {/* 编组标题 - 左上角位置，使用与节点标题相同的样式，反向缩放保持固定大小 */}
      <div
        style={{
          position: 'absolute',
          top: -24 * inverseScale,
          left: 0,
          transform: `scale(${inverseScale})`,
          transformOrigin: 'left top',
          pointerEvents: 'auto',
        }}
      >
        {isEditing ? (
          <input
            autoFocus
            maxLength={25}
            value={labelInput}
            onChange={(e) => {
              // 限制最大15字符
              const newValue = e.target.value.slice(0, 15);
              setLabelInput(newValue);
            }}
            onBlur={handleRename}
            onKeyDown={(e) => e.key === 'Enter' && handleRename()}
            onMouseDown={(e) => e.stopPropagation()}
            className="canvas-node-title-input"
            style={{ position: 'static' }}
          />
        ) : (
          <div 
            className="canvas-node-title"
            style={{ position: 'static' }}
            onDoubleClick={() => setIsEditing(true)}
          >
            {data.label as string}
          </div>
        )}
      </div>

      {/* 编组工具栏 - 放在编组正上方中央，使用胶囊按钮组样式，反向缩放保持固定大小 */}
      <div 
        style={{
          position: 'absolute',
          top: -56 * inverseScale,
          left: '50%',
          transform: `translateX(-50%) scale(${inverseScale})`,
          transformOrigin: 'center top',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
          opacity: selected ? 1 : 0,
          transition: 'opacity 0.2s',
        }}
      >
        {/* 工具栏容器 - 胶囊样式 */}
        <div
          className="group-toolbar-capsule"
          style={{
            display: 'flex',
            alignItems: 'center',
            background: '#1e1e1e',
            borderRadius: 20,
            padding: '6px 8px',
            gap: 2,
            boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            border: '1px solid #333',
            pointerEvents: selected ? 'auto' : 'none',
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* 工具按钮组 */}
          {actions.map((action) => {
            const Icon = action.icon as any;
            const isGreen = action.className?.includes('text-green');
            return (
              <button
                key={action.id}
                onClick={action.onClick}
                title={action.title || action.label}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '6px 12px',
                  borderRadius: 14,
                  cursor: 'pointer',
                  color: isGreen ? '#4ade80' : '#ccc',
                  fontSize: 13,
                  fontWeight: 500,
                  border: 'none',
                  background: 'transparent',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = isGreen ? 'rgba(74, 222, 128, 0.15)' : '#2a2a2a';
                  e.currentTarget.style.color = isGreen ? '#4ade80' : '#fff';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = isGreen ? '#4ade80' : '#ccc';
                }}
              >
                {action.icon && (
                  <span style={{ display: 'flex', alignItems: 'center' }}>
                    {React.isValidElement(action.icon) ? action.icon : <Icon size={14} />}
                  </span>
                )}
                {action.label && <span>{action.label}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
});
