/**
 * 剪辑区浮动按钮
 * 显示在画布右侧，点击展开剪辑区抽屉
 */

import React, { useEffect, useState } from 'react';
import { clipboardStore } from '../../store/clipboardStore';

interface ClipboardButtonProps {
  onClick: () => void;
}

export const ClipboardButton: React.FC<ClipboardButtonProps> = ({ onClick }) => {
  const [count, setCount] = useState(0);
  const [hasResults, setHasResults] = useState(false);

  useEffect(() => {
    const update = () => {
      const state = clipboardStore.getState();
      setCount(state.resources.length);
      setHasResults(state.results.length > 0);
    };

    update();
    return clipboardStore.subscribe(update);
  }, []);

  // 没有资源也没有结果时不显示按钮
  if (count === 0 && !hasResults) {
    return null;
  }

  return (
    <button
      onClick={onClick}
      style={buttonStyle}
      title="打开剪辑区"
    >
      <svg 
        width="20" 
        height="20" 
        viewBox="0 0 24 24" 
        fill="none" 
        stroke="currentColor" 
        strokeWidth="2"
      >
        <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
        <circle cx="12" cy="13" r="3" />
      </svg>
      
      {count > 0 && (
        <span style={badgeStyle}>{count}</span>
      )}
      
      {hasResults && (
        <span style={dotStyle} />
      )}
    </button>
  );
};

// ============ 样式 ============

const buttonStyle: React.CSSProperties = {
  position: 'fixed',
  right: '20px',
  top: '50%',
  transform: 'translateY(-50%)',
  width: '48px',
  height: '48px',
  borderRadius: '50%',
  background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
  border: 'none',
  color: 'white',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxShadow: '0 4px 12px rgba(99, 102, 241, 0.4)',
  transition: 'all 0.2s ease',
  zIndex: 1000,
};

const badgeStyle: React.CSSProperties = {
  position: 'absolute',
  top: '-4px',
  right: '-4px',
  minWidth: '20px',
  height: '20px',
  borderRadius: '10px',
  background: '#ef4444',
  color: 'white',
  fontSize: '12px',
  fontWeight: 600,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '0 6px',
};

const dotStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: '-2px',
  right: '-2px',
  width: '12px',
  height: '12px',
  borderRadius: '50%',
  background: '#22c55e',
  border: '2px solid white',
};










