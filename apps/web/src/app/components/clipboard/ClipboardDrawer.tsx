/**
 * 剪辑区抽屉组件
 * 展示已加入剪辑区的资源和导出结果
 */

import React, { useEffect, useState } from 'react';
import { 
  clipboardStore, 
  ClipboardResource, 
  ExportResult 
} from '../../store/clipboardStore';
import { videoEditorBridge } from '../../services/videoEditorBridge';

interface ClipboardDrawerProps {
  open: boolean;
  onClose: () => void;
  onAddToCanvas?: (result: ExportResult) => void;
}

export const ClipboardDrawer: React.FC<ClipboardDrawerProps> = ({
  open,
  onClose,
  onAddToCanvas,
}) => {
  const [resources, setResources] = useState<ClipboardResource[]>([]);
  const [results, setResults] = useState<ExportResult[]>([]);

  useEffect(() => {
    const update = () => {
      const state = clipboardStore.getState();
      setResources(state.resources);
      setResults(state.results);
    };

    update();
    return clipboardStore.subscribe(update);
  }, []);

  const handleRemoveResource = (id: string) => {
    clipboardStore.removeResource(id);
    videoEditorBridge.removeResource(id);
  };

  const handleRemoveResult = (id: string) => {
    clipboardStore.removeResult(id);
  };

  const handleOpenEditor = () => {
    videoEditorBridge.openEditor();
    // 资源会在收到 EDITOR_READY 消息后自动同步
  };

  if (!open) return null;

  return (
    <>
      {/* 遮罩层 */}
      <div style={overlayStyle} onClick={onClose} />
      
      {/* 抽屉内容 */}
      <div style={drawerStyle}>
        {/* 头部 */}
        <div style={headerStyle}>
          <h3 style={titleStyle}>🎬 剪辑区</h3>
          <button style={closeButtonStyle} onClick={onClose}>×</button>
        </div>

        {/* 资源列表 */}
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>
            待剪辑资源 ({resources.length})
          </div>
          
          {resources.length === 0 ? (
            <div style={emptyStyle}>
              右键资源节点，选择"加入剪辑区"
            </div>
          ) : (
            <div style={listStyle}>
              {resources.map(resource => (
                <ResourceItem
                  key={resource.id}
                  resource={resource}
                  onRemove={() => handleRemoveResource(resource.id)}
                />
              ))}
            </div>
          )}

          {resources.length > 0 && (
            <button style={openEditorButtonStyle} onClick={handleOpenEditor}>
              🎥 打开视频编辑器
            </button>
          )}
        </div>

        {/* 分隔线 */}
        <div style={dividerStyle} />

        {/* 导出结果 */}
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>
            📁 导出结果 ({results.length})
          </div>
          
          {results.length === 0 ? (
            <div style={emptyStyle}>
              在视频编辑器中导出后，结果会显示在这里
            </div>
          ) : (
            <div style={listStyle}>
              {results.map(result => (
                <ResultItem
                  key={result.id}
                  result={result}
                  onRemove={() => handleRemoveResult(result.id)}
                  onAddToCanvas={onAddToCanvas ? () => onAddToCanvas(result) : undefined}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
};

// ============ 子组件 ============

const ResourceItem: React.FC<{
  resource: ClipboardResource;
  onRemove: () => void;
}> = ({ resource, onRemove }) => {
  const typeIcon = {
    video: '🎬',
    image: '🖼️',
    audio: '🎵',
  }[resource.type] || '📄';

  return (
    <div style={itemStyle}>
      <div style={thumbnailStyle}>
        {resource.thumbnail ? (
          <img src={resource.thumbnail} alt="" style={thumbImgStyle} />
        ) : (
          <span style={iconStyle}>{typeIcon}</span>
        )}
      </div>
      <div style={itemInfoStyle}>
        <div style={itemNameStyle}>{resource.name}</div>
        <div style={itemTypeStyle}>{resource.type}</div>
      </div>
      <button style={removeButtonStyle} onClick={onRemove} title="移除">
        ×
      </button>
    </div>
  );
};

const ResultItem: React.FC<{
  result: ExportResult;
  onRemove: () => void;
  onAddToCanvas?: () => void;
}> = ({ result, onRemove, onAddToCanvas }) => {
  return (
    <div style={itemStyle}>
      <div style={thumbnailStyle}>
        {result.thumbnail ? (
          <img src={result.thumbnail} alt="" style={thumbImgStyle} />
        ) : (
          <span style={iconStyle}>🎥</span>
        )}
      </div>
      <div style={itemInfoStyle}>
        <div style={itemNameStyle}>导出视频</div>
        <div style={itemTypeStyle}>
          {result.duration ? `${Math.round(result.duration)}s` : '视频'}
        </div>
      </div>
      {onAddToCanvas && (
        <button style={addToCanvasButtonStyle} onClick={onAddToCanvas} title="添加到画布">
          + 画布
        </button>
      )}
      <button style={removeButtonStyle} onClick={onRemove} title="移除">
        ×
      </button>
    </div>
  );
};

// ============ 样式 ============

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.3)',
  zIndex: 1100,
};

const drawerStyle: React.CSSProperties = {
  position: 'fixed',
  right: 0,
  top: 0,
  bottom: 0,
  width: '360px',
  background: '#1a1a1a',
  borderLeft: '1px solid #333',
  zIndex: 1101,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '16px 20px',
  borderBottom: '1px solid #333',
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '16px',
  fontWeight: 600,
  color: '#fff',
};

const closeButtonStyle: React.CSSProperties = {
  width: '28px',
  height: '28px',
  borderRadius: '4px',
  border: 'none',
  background: 'transparent',
  color: '#888',
  fontSize: '20px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const sectionStyle: React.CSSProperties = {
  padding: '16px 20px',
  flex: 1,
  overflow: 'auto',
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 500,
  color: '#888',
  marginBottom: '12px',
};

const emptyStyle: React.CSSProperties = {
  fontSize: '13px',
  color: '#666',
  textAlign: 'center',
  padding: '20px 0',
};

const listStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
};

const itemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  padding: '10px 12px',
  background: '#252525',
  borderRadius: '8px',
  transition: 'background 0.15s',
};

const thumbnailStyle: React.CSSProperties = {
  width: '40px',
  height: '40px',
  borderRadius: '4px',
  background: '#333',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'hidden',
  flexShrink: 0,
};

const thumbImgStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
};

const iconStyle: React.CSSProperties = {
  fontSize: '20px',
};

const itemInfoStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
};

const itemNameStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 500,
  color: '#fff',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const itemTypeStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#888',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
};

const addToCanvasButtonStyle: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: '4px',
  border: 'none',
  background: '#6366f1',
  color: '#fff',
  fontSize: '12px',
  fontWeight: 500,
  cursor: 'pointer',
  flexShrink: 0,
  transition: 'background 0.15s',
};

const removeButtonStyle: React.CSSProperties = {
  width: '24px',
  height: '24px',
  borderRadius: '4px',
  border: 'none',
  background: 'transparent',
  color: '#666',
  fontSize: '16px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
};

const dividerStyle: React.CSSProperties = {
  height: '1px',
  background: '#333',
  margin: '0 20px',
};

const openEditorButtonStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px',
  marginTop: '12px',
  borderRadius: '8px',
  border: 'none',
  background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
  color: 'white',
  fontSize: '14px',
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'opacity 0.15s',
};

