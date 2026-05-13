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

  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = src;
    a.download = '';
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
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
