import React, { useRef } from 'react';
import { Plus, X } from 'lucide-react';

export interface RefStripItem {
  id: string;
  /** @ 候选 / 文案里用到的展示名，如 图片1 */
  mentionLabel: string;
  type: string;
  thumbnailUrl?: string;
  onRemove: () => void;
  /**
   * 当前模式下该上游是否生效。
   * 例如 video「文生」模式不接受 image，已连的 image 上游显示「未生效」灰态。
   * 仅视觉提示，不阻塞用户操作（可继续删除、@ 引用）。
   */
  inactive?: boolean;
}

export interface UpstreamRefStripProps {
  items: RefStripItem[];
  onPickFile: (file: File) => void;
  disabled?: boolean;
}

/**
 * 顶部素材参考条：封面 + `@` / Prompt 用到的 label（由父级推导）
 */
export const UpstreamRefStrip: React.FC<UpstreamRefStripProps> = ({
  items,
  onPickFile,
  disabled = false,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div style={rowStyle}>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onPickFile(file);
          if (inputRef.current) inputRef.current.value = '';
        }}
      />

      <button
        type="button"
        style={{
          ...plusBtnStyle,
          ...(disabled ?
            {
              opacity: 0.45,
              cursor: 'not-allowed',
            }
          : {}),
        }}
        disabled={disabled}
        title="上传并连接到上游素材"
        onClick={() => !disabled && inputRef.current?.click()}
      >
        <Plus size={16} />
      </button>

      <div style={chipsWrapStyle}>
        {items.map((it) => (
          <div
            key={it.id}
            style={{ ...chipStyle, ...(it.inactive ? chipInactiveStyle : null) }}
            title={it.inactive ? '当前模式不使用该上游' : undefined}
          >
            <span style={thumbBoxStyle}>
              {it.thumbnailUrl ? (
                <img
                  src={it.thumbnailUrl}
                  alt={it.mentionLabel}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    display: 'block',
                    filter: it.inactive ? 'grayscale(1) brightness(0.55)' : undefined,
                  }}
                />
              ) : (
                <span style={fallbackTypeStyle}>{shortType(it.type)}</span>
              )}
              {it.inactive && <span style={inactiveBadgeStyle}>未生效</span>}
            </span>
            <span style={{ ...chipLabelStyle, ...(it.inactive ? inactiveLabelStyle : null) }}>
              {it.mentionLabel}
            </span>
            <button
              type="button"
              aria-label={`移除引用 ${it.mentionLabel}`}
              style={{ ...xBtnStyle, ...(disabled ? { opacity: 0.4, cursor: 'not-allowed' } : {}) }}
              disabled={disabled}
              onClick={() => !disabled && it.onRemove()}
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

function shortType(t: string): string {
  if (t === 'image') return '图';
  if (t === 'video') return '视';
  if (t === 'text') return '文';
  if (t === 'audio') return '音';
  return '?';
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
};

const chipsWrapStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 8,
  flex: 1,
  minWidth: 0,
};

const plusBtnStyle: React.CSSProperties = {
  flexShrink: 0,
  width: 34,
  height: 34,
  borderRadius: 8,
  border: '1px dashed #3d3d3d',
  background: '#141414',
  color: '#999',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
};

const chipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  background: '#1f1f1f',
  border: '1px solid #303030',
  borderRadius: 8,
  padding: '4px 6px 4px 4px',
  maxWidth: 180,
};

const chipInactiveStyle: React.CSSProperties = {
  background: '#161616',
  border: '1px dashed #2a2a2a',
};

const inactiveBadgeStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 10,
  color: '#aaa',
  background: 'rgba(0,0,0,0.45)',
  pointerEvents: 'none',
  letterSpacing: 0.5,
};

const inactiveLabelStyle: React.CSSProperties = {
  color: '#777',
};

const thumbBoxStyle: React.CSSProperties = {
  position: 'relative',
  width: 32,
  height: 32,
  borderRadius: 6,
  overflow: 'hidden',
  background: '#0d0d0d',
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '1px solid #2a2a2a',
};

const fallbackTypeStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#666',
};

const chipLabelStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#ccc',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  flex: 1,
  minWidth: 0,
};

const xBtnStyle: React.CSSProperties = {
  flexShrink: 0,
  width: 22,
  height: 22,
  border: 'none',
  borderRadius: 4,
  background: 'transparent',
  color: '#888',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
};
