import React from 'react';

export interface NodeFloatingWindowProps {
  /** 最顶部模式 tab 行(video family 才传，例如「文生 / 首帧 / 全能参考 / 视频编辑」) */
  topBar?: React.ReactNode;

  /** 顶部素材条(image/video 才传) */
  refStrip?: React.ReactNode;

  /** 中间 prompt 区域(Phase 2 暂用 <textarea>, Phase 3 换 <PromptEditor>) */
  promptArea: React.ReactNode;

  /** 底部 chip toolbar */
  bottomBar: React.ReactNode;

  /** 窗口宽度, 默认 480 */
  width?: number;

  /** 自定义类名, 用于业务面板加变种样式 */
  className?: string;
}

/**
 * 节点浮动弹窗 — 共享骨架。
 *
 * 由 React Flow `<NodeToolbar position={Position.Bottom}>` 包裹定位,
 * 这里只负责"容器视觉 + 三段式垂直布局"。
 */
export const NodeFloatingWindow: React.FC<NodeFloatingWindowProps> = ({
  topBar,
  refStrip,
  promptArea,
  bottomBar,
  width = 480,
  className,
}) => {
  return (
    <div
      className={`cf-node-floating-window${className ? ` ${className}` : ''}`}
      style={{ ...containerStyle, width }}
      onWheel={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {topBar && <div style={topBarWrapStyle}>{topBar}</div>}
      {refStrip && <div style={refStripWrapStyle}>{refStrip}</div>}
      <div style={promptWrapStyle}>{promptArea}</div>
      {bottomBar}
    </div>
  );
};

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  background: 'linear-gradient(180deg, #1a1a1a 0%, #141414 100%)',
  border: '1px solid #2a2a2a',
  borderRadius: 12,
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  color: '#eee',
  overflow: 'hidden',
  cursor: 'default',
};

const topBarWrapStyle: React.CSSProperties = {
  padding: '8px 12px 0 12px',
};

const refStripWrapStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid #2a2a2a',
};

const promptWrapStyle: React.CSSProperties = {
  padding: '12px',
  flex: 1,
  minHeight: 0,
};
