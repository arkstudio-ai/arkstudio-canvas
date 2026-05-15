import React, { useRef, useState } from 'react';
import { Upload, Download, Maximize2 } from 'lucide-react';
import { MediaViewerModal } from '@canvas-flow/core';
import type { CanvasFlowNode } from '@canvas-flow/core';

interface NodeToolbarRendererProps {
  onUploadRequest: (nodeId: string, file: File) => void;
}

/**
 * 创建 renderNodeToolbar 函数。
 * 根据节点类型和内容状态渲染不同的 toolbar 按钮：
 * - image/video 无内容 → 上传按钮
 * - image/video 有内容 → 下载 + 全屏
 * - 其他节点 → 不显示
 */
export function createRenderNodeToolbar({ onUploadRequest }: NodeToolbarRendererProps) {
  return ({ nodeId, node }: { nodeId: string; node: CanvasFlowNode }) => {
    const isMedia = node.type === 'image' || node.type === 'video';
    if (!isMedia) return null;

    const mediaSrc = node.data?.src || node.data?.output;
    const hasContent = Boolean(mediaSrc);

    if (!hasContent) {
      return <ToolbarUploadButton nodeId={nodeId} nodeType={node.type!} onUploadRequest={onUploadRequest} />;
    }

    return <ToolbarMediaActions src={mediaSrc as string} mediaType={node.type as 'image' | 'video'} />;
  };
}

const toolbarRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 4,
  alignItems: 'center',
  padding: '4px 6px',
  borderRadius: 8,
  background: 'rgba(30, 30, 30, 0.85)',
  backdropFilter: 'blur(6px)',
};

const toolbarBtnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  borderRadius: 6,
  border: 'none',
  background: 'transparent',
  color: '#ddd',
  cursor: 'pointer',
  transition: 'background 0.15s',
};

function ToolbarUploadButton({
  nodeId,
  nodeType,
  onUploadRequest,
}: {
  nodeId: string;
  nodeType: string;
  onUploadRequest: (nodeId: string, file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const accept = nodeType === 'video' ? 'video/*' : 'image/*';

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onUploadRequest(nodeId, file);
    }
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div style={toolbarRowStyle}>
      <label style={{ ...toolbarBtnStyle, margin: 0 }} title="上传文件">
        <Upload size={14} />
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          style={{ display: 'none' }}
          onChange={handleChange}
        />
      </label>
    </div>
  );
}

function ToolbarMediaActions({ src, mediaType }: { src: string; mediaType: 'image' | 'video' }) {
  const [viewerOpen, setViewerOpen] = useState(false);

  const handleDownload = async () => {
    // 不能走 `a.href = src; a.target = '_blank'`: src 是后端返回的相对路径
    // (`/static/uploads/...`), 桌面端 file:// 协议下 target=_blank 会触发
    // Electron 的 setWindowOpenHandler → shell.openExternal(file:///...) →
    // 用系统应用打开一个不存在的文件 → 失败. 浏览器/docker 自部署下虽然
    // 同源能打开, 但下载行为也不一致 (有时直接预览, 有时新标签页).
    // 走 fetch + Blob URL 跨平台一致, 跟节点右键菜单的下载实现保持一致.
    try {
      const res = await fetch(src);
      const blob = await res.blob();
      const objectUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = '';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(objectUrl);
    } catch (err) {
      console.error('[ToolbarMediaActions] download failed:', err);
    }
  };

  return (
    <>
      <div style={toolbarRowStyle}>
        <button style={toolbarBtnStyle} title="下载" onClick={handleDownload}>
          <Download size={14} />
        </button>
        <button style={toolbarBtnStyle} title="全屏预览" onClick={() => setViewerOpen(true)}>
          <Maximize2 size={14} />
        </button>
      </div>
      <MediaViewerModal
        isOpen={viewerOpen}
        onClose={() => setViewerOpen(false)}
        src={src}
        type={mediaType}
      />
    </>
  );
}
