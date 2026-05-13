
import React, { useState } from 'react';
import { NodeContentProps } from '../../types/schema';
import '../../styles/canvas.css';

export const TextNode: React.FC<NodeContentProps> = ({ data, onChange }) => {
  const [isEditing, setIsEditing] = useState(false);

  return (
    <div 
      className="cf-text-node-container"
      onDoubleClick={() => setIsEditing(true)}
    >
      {isEditing ? (
        <textarea
          className="nodrag cf-text-node-input"
          autoFocus
          onBlur={() => setIsEditing(false)}
          placeholder="输入文本或者编辑生成结果..."
          value={data.text || ''}
          onChange={(e) => onChange({ text: e.target.value })}
          onKeyDown={(e) => e.stopPropagation()} 
        />
      ) : (
        <>
          <div className={`cf-text-node-display ${!data.text ? 'placeholder' : ''}`}>
            {data.text || '双击输入文本...'}
          </div>
          <div className="cf-text-node-overlay">
            双击编辑
          </div>
        </>
      )}
    </div>
  );
};
