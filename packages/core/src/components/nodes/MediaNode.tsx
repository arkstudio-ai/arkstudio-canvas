
import React, { useRef, useState } from 'react';
import { Video, Image as ImageIcon, Music } from 'lucide-react';
import { NodeContentProps } from '../../types/schema';
import { MediaViewerModal } from '../MediaViewerModal';
import '../../styles/canvas.css';

// 把后端返回的相对路径 (e.g. `/static/uploads/abc.png`) 解析到当前 backend
// origin. 仅在桌面端 / 任意 file:// 加载场景下生效 —— 浏览器把相对路径
// resolve 到当前 document 的 origin, 而 file:///static/uploads/... 显然
// 不存在, 图就黑了. http 加载场景 (vite dev / nginx 自部署) 相对路径本来
// 就同源, 这里也无侵入。
//
// 解析顺序与 apps/web/src/app/config/api.ts 对齐: 优先 window.__BACKEND_BASE__
// (preload 注入), 否则保持原样让浏览器自然 resolve.
function resolveMediaUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  // 已经是绝对 URL / data: / blob: — 不动
  if (/^[a-z]+:/i.test(url)) return url;
  if (!url.startsWith('/')) return url;
  const base =
    typeof window !== 'undefined' &&
    typeof (window as unknown as { __BACKEND_BASE__?: string }).__BACKEND_BASE__ === 'string'
      ? (window as unknown as { __BACKEND_BASE__?: string }).__BACKEND_BASE__
      : '';
  return base ? base + url : url;
}

// Image Node
export const ImageNode: React.FC<NodeContentProps> = ({ data, isConnected, onChange }) => {
  
  const imgRef = useRef<HTMLImageElement>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const mediaSrc = resolveMediaUrl(data.src || data.output);
  const showContent = Boolean(mediaSrc || isConnected);

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    // Report original dimensions to trigger auto-resize
    if (img.naturalWidth && img.naturalHeight) {
        onChange({ 
            _contentSize: { 
                width: img.naturalWidth, 
                height: img.naturalHeight 
            } 
        });
    }
  };

  if (!showContent) {
    return (
      <div className="cf-media-placeholder">
        <ImageIcon size={32} strokeWidth={1} />
      </div>
    );
  }

  return (
    <>
      <div 
        className="cf-media-node-container" 
        onDoubleClick={() => mediaSrc && setIsModalOpen(true)}
        title="双击查看大图"
      >
        {mediaSrc && (
          <img 
            ref={imgRef}
            src={mediaSrc} 
            alt="generated" 
            className="cf-media-node-content cf-media-node-image"
            onLoad={handleImageLoad}
            style={{ display: 'block', cursor: 'zoom-in' }} 
          />
        )}
      </div>
      
      <MediaViewerModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        src={mediaSrc} 
        type="image" 
      />
    </>
  );
};

// Video Node
export const VideoNode: React.FC<NodeContentProps> = ({ data, isConnected, onChange }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const mediaSrc = resolveMediaUrl(data.src || data.output);
  const showContent = isConnected || Boolean(mediaSrc);

  const handleVideoLoad = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget;
    if (video.videoWidth && video.videoHeight) {
        onChange({ 
            _contentSize: { 
                width: video.videoWidth, 
                height: video.videoHeight 
            } 
        });
    }
  };

  if (!showContent) {
    return (
      <div className="cf-media-placeholder">
        <Video size={32} strokeWidth={1} />
      </div>
    );
  }

  return (
    <>
      <div 
        className="cf-media-node-container"
        title="双击全屏预览"
      >
        {mediaSrc && (
          <video 
            ref={videoRef}
            src={mediaSrc} 
            controls
            controlsList="nofullscreen"
            className="cf-media-node-content"
            onLoadedMetadata={handleVideoLoad}
            style={{ display: 'block' }}
            onDoubleClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (mediaSrc) setIsModalOpen(true);
            }}
          />
        )}
      </div>

      <MediaViewerModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        src={mediaSrc} 
        type="video" 
      />
    </>
  );
};

// Audio Node
export const AudioNode: React.FC<NodeContentProps> = ({ data, isConnected }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const mediaSrc = resolveMediaUrl(data.src || data.output);
  const showContent = isConnected || Boolean(mediaSrc);

  if (!showContent) {
    return (
      <div className="cf-media-placeholder">
        <Music size={32} strokeWidth={1} />
      </div>
    );
  }

  return (
    <>
      <div 
        className="cf-media-node-container"
        onDoubleClick={() => mediaSrc && setIsModalOpen(true)}
        title="双击打开播放器"
        style={{ 
          cursor: 'pointer', 
          display: 'flex',
          justifyContent: 'center', 
          alignItems: 'center',
        }}
      >
        {mediaSrc && (
          <audio 
            src={mediaSrc} 
            controls
            style={{ 
              width: '100%', 
              minHeight: 54,
            }}
          />
        )}
      </div>

      <MediaViewerModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        src={mediaSrc} 
        type="audio" 
      />
    </>
  );
};
