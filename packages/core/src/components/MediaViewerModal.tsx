import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import '../styles/canvas.css';

interface MediaViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  // 允许 undefined: MediaNode 用 `resolveMediaUrl()` 喂值, 节点 data.src 缺失
  // 时返回 undefined. 组件内部已经有 `!src` 的早返回, 类型对齐就行.
  src: string | undefined;
  type: 'image' | 'video' | 'audio';
}

export const MediaViewerModal: React.FC<MediaViewerModalProps> = ({
  isOpen,
  onClose,
  src,
  type,
}) => {
  // Lock body scroll when modal is open
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

  if (!isOpen || !src) return null;

  return createPortal(
    <div className="cf-media-modal-overlay" onClick={onClose}>
      <div className="cf-media-modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="cf-media-modal-close" onClick={onClose}>
          <X size={24} />
        </button>
        
        <div className="cf-media-modal-body">
          {type === 'image' && (
            <img src={src} alt="Preview" className="cf-media-modal-image" />
          )}
          
          {type === 'video' && (
            <video src={src} controls className="cf-media-modal-video" autoPlay />
          )}
          
          {type === 'audio' && (
            <div className="cf-media-modal-audio-wrapper">
              <div className="cf-media-modal-audio-icon">🎵</div>
              <audio src={src} controls className="cf-media-modal-audio" autoPlay />
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};


