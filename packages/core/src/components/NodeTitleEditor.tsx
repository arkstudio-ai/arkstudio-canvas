import React, { useState } from 'react';
import { useViewport } from '@xyflow/react';

interface NodeTitleEditorProps {
  title: string;
  defaultTitle: string;
  onChange: (data: any) => void;
  className?: string;
}

export const NodeTitleEditor: React.FC<NodeTitleEditorProps> = ({
  title,
  defaultTitle,
  onChange,
  className = ''
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const { zoom } = useViewport();
  
  // 反向缩放，使标题文字大小固定不随画布缩放
  const inverseScale = 1 / zoom;

  // 显示的标题（优先级：自定义标题 > 默认标题）
  const displayTitle = title || defaultTitle;
  
  // 截断显示的标题（超过15字符用省略号）
  const truncatedDisplayTitle = displayTitle.length > 15 
    ? displayTitle.slice(0, 15) + '...' 
    : displayTitle;

  if (isEditing) {
    return (
      <input
        className={`nodrag canvas-node-title-input ${className}`}
        autoFocus
        maxLength={25}
        onBlur={() => setIsEditing(false)}
        placeholder="输入标题..."
        value={title || ''}
        onChange={(e) => {
          const newValue = e.target.value;
          // 限制最大15字符
          const truncatedValue = newValue.slice(0, 15);
          onChange({ title: truncatedValue });
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') {
            setIsEditing(false);
          }
        }}
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          top: `${-24 * inverseScale}px`,
          left: '0',
          background: 'rgba(0, 0, 0, 0.8)',
          border: '1px solid #555',
          borderRadius: '4px',
          padding: '2px 6px',
          color: '#fff',
          fontSize: '13px',
          fontWeight: '500',
          outline: 'none',
          minWidth: '50px',
          maxWidth: '200px',
          transform: `scale(${inverseScale})`,
          transformOrigin: 'left top',
        }}
      />
    );
  }

  return (
    <div
      className={`canvas-node-title ${className}`}
      onDoubleClick={() => setIsEditing(true)}
      title={displayTitle}
      style={{
        position: 'absolute',
        top: `${-24 * inverseScale}px`,
        left: '0',
        color: '#888',
        fontSize: '13px',
        fontWeight: '500',
        whiteSpace: 'nowrap',
        cursor: 'text',
        transition: 'color 0.2s',
        pointerEvents: 'auto',
        transform: `scale(${inverseScale})`,
        transformOrigin: 'left top',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = '#ccc';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = '#888';
      }}
    >
      {truncatedDisplayTitle}
    </div>
  );
};