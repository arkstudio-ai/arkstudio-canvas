import React from 'react';
import { MousePointerClick } from 'lucide-react';
import '../styles/canvas.css';

interface CanvasEmptyStateProps {
  /** 旧 API 占位：原本用于点击空态卡片触发模板生成，目前未启用。 */
  onAction?: (action: string) => void;
}

export const CanvasEmptyState: React.FC<CanvasEmptyStateProps> = (_props) => {
  return (
    <div className="cf-canvas-empty-state">
      <div className="cf-empty-instruction">
        <div className="cf-double-click-badge">
            <MousePointerClick size={14} />
            <span>双击</span>
        </div>
        <span className="cf-instruction-text">画布自由生成,或查看工作流模板</span>
      </div>
      
      {/* <div className="cf-empty-actions">
        <button className="cf-action-card" onClick={() => onAction?.('text-to-video')}>
          <Video size={18} />
          <span>文字生视频</span>
        </button>
        
        <button className="cf-action-card" onClick={() => onAction?.('image-bg-replace')}>
          <ImageIcon size={18} />
          <span>图片换背景</span>
        </button>
        
        <button className="cf-action-card" onClick={() => onAction?.('first-frame-video')}>
          <Film size={18} />
          <span>首帧生成视频</span>
        </button>
        
        <button className="cf-action-card" onClick={() => onAction?.('audio-to-video')}>
          <Music size={18} />
          <span>音频生视频</span>
        </button>
        
         <button className="cf-action-card" onClick={() => onAction?.('workflow')}>
          <Workflow size={18} />
          <span>工作流</span>
        </button>
      </div> */}
    </div>
  );
};












