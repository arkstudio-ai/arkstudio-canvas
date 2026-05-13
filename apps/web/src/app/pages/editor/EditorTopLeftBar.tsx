/**
 * 编辑器右上角的全局按钮栏（命名是历史遗留 — 实际定位在 right:16）。
 *
 * 开源版当前两颗按钮：
 *   - 分享：占位按钮。商业版的短链分享 (shareService) 已删；用户后续打算
 *     用它做"导出/复制画布 JSON"的入口，所以位置先留着，点击给一个
 *     toast 提示即可。
 *   - 后台：跳 /admin（日志、概览、模型配置等）。
 */

import React, { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutDashboard, Share2 } from 'lucide-react';
import { toast } from 'sonner';

export interface EditorTopLeftBarProps {
  /** 现在没用到，但保留 API 形状 — EditorPage 那边一直在透传 flowId */
  flowId?: string | null;
}

const baseButtonStyle: React.CSSProperties = {
  background: 'rgba(0, 0, 0, 0.85)',
  border: '1px solid rgba(255, 255, 255, 0.12)',
  cursor: 'pointer',
  transition: 'all 0.2s',
  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
};

const handleHover = (e: React.MouseEvent<HTMLElement>, enter: boolean) => {
  const target = e.currentTarget;
  if (enter) {
    target.style.background = 'rgba(30, 30, 30, 0.95)';
    target.style.borderColor = 'rgba(255, 255, 255, 0.2)';
  } else {
    target.style.background = 'rgba(0, 0, 0, 0.85)';
    target.style.borderColor = 'rgba(255, 255, 255, 0.12)';
  }
};

export function EditorTopLeftBar(_props: EditorTopLeftBarProps) {
  const navigate = useNavigate();

  const handleAdmin = useCallback(() => {
    navigate('/admin');
  }, [navigate]);

  const handleShare = useCallback(() => {
    toast.info('画布 JSON 分享功能开发中');
  }, []);

  return (
    <div
      style={{
        position: 'absolute',
        top: 16,
        right: 16,
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <div
        onClick={handleShare}
        style={{
          ...baseButtonStyle,
          width: 44,
          height: 44,
          borderRadius: 12,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        title="分享画布"
        onMouseEnter={(e) => handleHover(e, true)}
        onMouseLeave={(e) => handleHover(e, false)}
      >
        <Share2 size={20} color="rgba(255, 255, 255, 0.8)" />
      </div>

      <div
        onClick={handleAdmin}
        style={{
          ...baseButtonStyle,
          width: 44,
          height: 44,
          borderRadius: 12,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        title="后台 (日志 / 概览)"
        onMouseEnter={(e) => handleHover(e, true)}
        onMouseLeave={(e) => handleHover(e, false)}
      >
        <LayoutDashboard size={20} color="rgba(255, 255, 255, 0.8)" />
      </div>
    </div>
  );
}
