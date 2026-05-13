import React from 'react';

export interface BottomBarProps {
  /** 左侧 chip 区(模型 / 参数串 / 设置 / 业务自定义...) */
  left: React.ReactNode;
  /** 右侧 chip 区(数量 / 运行) */
  right: React.ReactNode;
}

/**
 * 浮窗底部 toolbar:两侧 flex 布局 + 顶部分隔线。
 * Chip 自身样式由 ChipBase 处理, BottomBar 只管布局。
 */
export const BottomBar: React.FC<BottomBarProps> = ({ left, right }) => {
  return (
    <div style={containerStyle}>
      <div style={sideStyle}>{left}</div>
      <div style={sideStyle}>{right}</div>
    </div>
  );
};

const containerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '8px 12px',
  borderTop: '1px solid #2a2a2a',
};

const sideStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'nowrap',
};
