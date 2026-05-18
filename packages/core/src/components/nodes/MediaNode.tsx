
import React, { useRef, useState } from 'react';
import { Video, Image as ImageIcon, Music, Upload } from 'lucide-react';
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

// asset:// 是 Volcengine 火山方舟的素材引用协议 — `asset://<asset_id>`. 上游
// 接口才认这个 scheme, 浏览器把它当未知 scheme 处理, <img src="asset://..." />
// 永远渲染失败. 这里识别后走占位 UI (色块 + Asset ID), 让用户看到 "我连了
// 一个素材资源, 不是空也不是坏图". 真实预览要等 Active 状态下到素材库面板
// 看缩略.
function isAssetUri(url: string | undefined | null): boolean {
  return typeof url === 'string' && url.startsWith('asset://');
}

const AssetPlaceholder: React.FC<{ uri: string; kind: 'image' | 'video' | 'audio' }> = ({
  uri,
  kind,
}) => {
  const id = uri.slice('asset://'.length);
  const label = kind === 'image' ? '图片素材' : kind === 'video' ? '视频素材' : '音频素材';
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        background: 'linear-gradient(135deg, rgba(52,211,153,0.10), rgba(20,184,166,0.10))',
        border: '1px dashed rgba(52,211,153,0.4)',
        borderRadius: 6,
        color: '#5eead4',
        fontSize: 11,
        padding: 8,
        boxSizing: 'border-box',
      }}
      title={uri}
    >
      <span style={{ fontWeight: 600 }}>📦 {label}</span>
      <code
        style={{
          fontSize: 10,
          opacity: 0.7,
          maxWidth: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {id}
      </code>
    </div>
  );
};

// 区分 "手动上传" vs "AI 生成" vs "asset 引用":
//
// - 手动上传 (useFlow.handleNodeDataChange 的 _uploadRequest 分支):
//     落库 { src, fileName, fileType, fileSize }  ← fileName 是关键签名
// - AI 生成 (params-builder.saveExecutionResult):
//     落库 { taskId, fileType, src }              ← 没 fileName, 有 taskId
// - asset:// 火山素材占位: 替换会丢失上游引用, 不出按钮
//
// 用 fileName 做正向证据 (双重保险: 同时 !taskId), AI 生成永远过不了,
// 避免 "用户在生成的图上点替换、把 AI 结果换掉" 这种意外操作.
function isManualUpload(data: any, isAsset: boolean): boolean {
  if (isAsset) return false;
  if (data?.taskId) return false;
  if (typeof data?.fileName !== 'string' || !data.fileName) return false;
  return !!(data?.src || data?.output);
}

/** 右上角圆角小绿按钮 → 触发隐藏 file picker → onChange 走 _uploadRequest
 *  通道 (app 层 useFlow.handleNodeDataChange 拦下文件做上传 + 落 src).
 *  accept 跟当前节点的 mime 类型对齐, 减小用户误选其它格式. */
const ReplaceButton: React.FC<{
  accept: string;
  onPick: (file: File) => void;
}> = ({ accept, onPick }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        className="cf-media-node-replace-btn"
        onClick={(e) => {
          e.stopPropagation();
          inputRef.current?.click();
        }}
        // 拦 ReactFlow 拖动 — 不然按住按钮拖会被当成拖节点.
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        title="替换为本地上传"
      >
        <Upload size={11} />
        <span>替换</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          if (inputRef.current) inputRef.current.value = '';
        }}
      />
    </>
  );
};

// Image Node
export const ImageNode: React.FC<NodeContentProps> = ({ data, isConnected, onChange }) => {
  
  const imgRef = useRef<HTMLImageElement>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const rawSrc = (data.src || data.output) as string | undefined;
  const isAsset = isAssetUri(rawSrc);
  const mediaSrc = resolveMediaUrl(rawSrc);
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
        onDoubleClick={() => mediaSrc && !isAsset && setIsModalOpen(true)}
        title={isAsset ? '火山方舟素材 — 用于下游视频生成' : '双击查看大图'}
      >
        {isAsset && rawSrc ? (
          <AssetPlaceholder uri={rawSrc} kind="image" />
        ) : mediaSrc ? (
          <img
            ref={imgRef}
            src={mediaSrc}
            alt="generated"
            className="cf-media-node-content cf-media-node-image"
            onLoad={handleImageLoad}
            style={{ display: 'block', cursor: 'zoom-in' }}
          />
        ) : null}
        {isManualUpload(data, isAsset) && (
          <ReplaceButton
            accept="image/*"
            onPick={(file) => onChange({ _uploadRequest: file, _uploadTargetKind: 'image' })}
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
export const VideoNode: React.FC<NodeContentProps> = ({
  data,
  isConnected,
  onChange,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const rawSrc = (data.src || data.output) as string | undefined;
  const isAsset = isAssetUri(rawSrc);
  const mediaSrc = resolveMediaUrl(rawSrc);
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
        title={isAsset ? '火山方舟视频素材 — 用于下游视频生成' : '双击全屏预览'}
      >
        {isAsset && rawSrc ? (
          <AssetPlaceholder uri={rawSrc} kind="video" />
        ) : mediaSrc ? (
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
        ) : null}
        {isManualUpload(data, isAsset) && (
          <ReplaceButton
            accept="video/*"
            onPick={(file) => onChange({ _uploadRequest: file, _uploadTargetKind: 'video' })}
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
export const AudioNode: React.FC<NodeContentProps> = ({ data, isConnected, onChange }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const rawSrc = (data.src || data.output) as string | undefined;
  const isAsset = isAssetUri(rawSrc);
  const mediaSrc = resolveMediaUrl(rawSrc);
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
        onDoubleClick={() => mediaSrc && !isAsset && setIsModalOpen(true)}
        title={isAsset ? '火山方舟音频素材 — 用于下游视频生成' : '双击打开播放器'}
        style={{
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        {isAsset && rawSrc ? (
          <AssetPlaceholder uri={rawSrc} kind="audio" />
        ) : mediaSrc ? (
          <audio
            src={mediaSrc}
            controls
            style={{
              width: '100%',
              minHeight: 54,
            }}
          />
        ) : null}
        {isManualUpload(data, isAsset) && (
          <ReplaceButton
            accept="audio/*"
            onPick={(file) => onChange({ _uploadRequest: file, _uploadTargetKind: 'audio' })}
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
