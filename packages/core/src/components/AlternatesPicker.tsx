// 多图生成的"选主图"模态.
//
// MediaNode 上 data.alternates 长度 > 1 时, 节点本体会渲染一个 stack 视觉
// (主图后面叠几张占位卡); 用户点 stack 调起这个 picker, 看到全部 N 张
// thumbnail. 点某张 → 通过 onPick 回写到 node.data.src 当主图 + 关 modal.
//
// 不做选中态高亮 (跟用户讨论一致 — 主图永远在 stack 顶层, 已经够明确).
// 不做删除 (整次生成原子, 想换重跑).
//
// 布局: ≤4 张走 2x2 grid (一屏全收), >4 张水平横滚 (macOS 翻照片同款),
// 不强行多行 grid 撑高 modal.

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import '../styles/canvas.css';

export interface AlternatesPickerProps {
  isOpen: boolean;
  onClose: () => void;
  /** 备选列表 (含当前主图). 顺序就是生成顺序, 不重排. */
  alternates: Array<{ src: string }>;
  /** 当前主图 src, 仅用于 hover title 显示"当前选中"提示, 不加视觉边框. */
  currentSrc: string | undefined;
  /** 点缩略图 → 回写到 node.data.src. 调完 picker 会自己关. */
  onPick: (src: string) => void;
  /** 媒体类型, 决定缩略图用 <img> 还是 <video preload=metadata>. */
  type: 'image' | 'video' | 'audio';
}

export const AlternatesPicker: React.FC<AlternatesPickerProps> = ({
  isOpen,
  onClose,
  alternates,
  currentSrc,
  onPick,
  type,
}) => {
  // 锁 body scroll, 跟 MediaViewerModal 同款.
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  // ESC 关.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [isOpen, onClose]);

  if (!isOpen || alternates.length === 0) return null;

  // ≤4 张 → 2x2 grid; >4 张 → 单行横滚.
  const layoutClass =
    alternates.length <= 4
      ? 'cf-alternates-grid'
      : 'cf-alternates-scroll';

  const handlePick = (src: string) => {
    onPick(src);
    onClose();
  };

  return createPortal(
    <div className="cf-media-modal-overlay" onClick={onClose}>
      <div
        className="cf-alternates-container"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="cf-media-modal-close" onClick={onClose}>
          <X size={24} />
        </button>
        <div className={layoutClass}>
          {alternates.map((alt, idx) => {
            const isCurrent = alt.src === currentSrc;
            return (
              <button
                key={`${alt.src}-${idx}`}
                type="button"
                className="cf-alternates-cell"
                onClick={() => handlePick(alt.src)}
                title={isCurrent ? '当前主图 (再次点击保持选择)' : '设为主图'}
              >
                {type === 'video' ? (
                  <video
                    src={alt.src}
                    muted
                    preload="metadata"
                    className="cf-alternates-media"
                  />
                ) : type === 'audio' ? (
                  <div className="cf-alternates-audio-placeholder">🎵</div>
                ) : (
                  <img src={alt.src} alt="" className="cf-alternates-media" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
};
