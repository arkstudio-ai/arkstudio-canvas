import React, { useState } from 'react';
import type { NodeContentProps } from '@canvas-flow/core';

/**
 * 反向提示词节点 — 应用层领域变体
 * 
 * 与 Core 的 TextNode 结构相同，但永远显示"反向提示词"样式。
 * 节点类型（text-negative）本身即表达语义，无需额外标记字段。
 */
export const NegativeTextNode: React.FC<NodeContentProps> = ({ data, onChange }) => {
  const [isEditing, setIsEditing] = useState(false);

  return (
    <div
      className="cf-text-node-container cf-text-node-negative"
      onDoubleClick={() => setIsEditing(true)}
    >
      <div
        className="cf-text-node-negative-badge"
        title="反向提示词：描述不希望出现的内容。若模型不支持反向提示词，此内容将被忽略。"
      >
        反向提示词
      </div>
      {isEditing ? (
        <textarea
          className="nodrag cf-text-node-input"
          autoFocus
          onBlur={() => setIsEditing(false)}
          placeholder="描述不希望出现的内容，若模型不支持反向提示词，此内容将被忽略..."
          value={data.text || ''}
          onChange={(e) => onChange({ text: e.target.value })}
          onKeyDown={(e) => e.stopPropagation()}
        />
      ) : (
        <>
          <div className={`cf-text-node-display ${!data.text ? 'placeholder' : ''}`}>
            {data.text || '双击输入反向提示词...'}
          </div>
          <div className="cf-text-node-overlay">
            双击编辑
          </div>
        </>
      )}
    </div>
  );
};
