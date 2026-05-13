import React, { forwardRef, useEffect, useImperativeHandle, useState } from 'react';

export interface MentionCandidate {
  id: string;
  label: string;
  type: string;
  /** 缩略图 URL; 没有则按 type 显示占位符 */
  thumbnailUrl?: string;
}

export interface AtMenuRef {
  /** 外部转发键盘事件; 返回 true 表示已消费 */
  onKeyDown: (event: KeyboardEvent) => boolean;
}

export interface AtMenuProps {
  items: MentionCandidate[];
  /** 选中候选回调,父级负责将 `@label` 插入到 textarea */
  onSelect: (item: MentionCandidate) => void;
  /** 已选中索引(受控)。父级可不传,内部自管。 */
  highlightedIndex?: number;
  onHighlightedIndexChange?: (index: number) => void;
}

const TYPE_FALLBACK_EMOJI: Record<string, string> = {
  image: '🖼',
  video: '🎬',
  audio: '🎵',
  text: '📝',
};

export const AtMenu = forwardRef<AtMenuRef, AtMenuProps>(
  ({ items, onSelect, highlightedIndex: controlledIndex, onHighlightedIndexChange }, ref) => {
    const [innerIndex, setInnerIndex] = useState(0);
    const isControlled = controlledIndex !== undefined;
    const selectedIndex = isControlled ? controlledIndex : innerIndex;

    const setIndex = (next: number) => {
      if (!isControlled) setInnerIndex(next);
      onHighlightedIndexChange?.(next);
    };

    useEffect(() => {
      if (!isControlled) setInnerIndex(0);
    }, [items, isControlled]);

    const selectItem = (index: number) => {
      const item = items[index];
      if (item) onSelect(item);
    };

    useImperativeHandle(ref, () => ({
      onKeyDown: (event) => {
        if (items.length === 0) return false;
        if (event.key === 'ArrowUp') {
          setIndex((selectedIndex + items.length - 1) % items.length);
          return true;
        }
        if (event.key === 'ArrowDown') {
          setIndex((selectedIndex + 1) % items.length);
          return true;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          selectItem(selectedIndex);
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) {
      return (
        <div style={containerStyle} role="listbox">
          <div style={emptyStyle}>没有匹配的素材</div>
        </div>
      );
    }

    return (
      <div style={containerStyle} role="listbox">
        {items.map((item, i) => {
          const active = i === selectedIndex;
          return (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={active}
              onMouseEnter={() => setIndex(i)}
              onMouseDown={(e) => {
                // mousedown 而非 click: 避免 textarea blur 先于 onSelect
                e.preventDefault();
                selectItem(i);
              }}
              style={itemStyle(active)}
            >
              <span style={thumbStyle}>
                {item.thumbnailUrl ? (
                  <img
                    src={item.thumbnailUrl}
                    alt={item.label}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                ) : (
                  <span style={fallbackEmojiStyle}>{TYPE_FALLBACK_EMOJI[item.type] ?? '·'}</span>
                )}
              </span>
              <span style={labelStyle}>{item.label}</span>
              <span style={badgeStyle}>{item.type}</span>
            </button>
          );
        })}
      </div>
    );
  },
);

AtMenu.displayName = 'AtMenu';

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 220,
  maxHeight: 280,
  overflowY: 'auto',
  background: 'linear-gradient(180deg, #1a1a1a 0%, #141414 100%)',
  border: '1px solid #2a2a2a',
  borderRadius: 10,
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
  padding: 6,
  color: '#eee',
  fontSize: 13,
};

const itemStyle = (active: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '6px 8px',
  borderRadius: 6,
  border: 'none',
  background: active ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
  color: active ? '#6b9fff' : '#ddd',
  cursor: 'pointer',
  fontSize: 13,
  outline: 'none',
  textAlign: 'left',
  width: '100%',
});

const thumbStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 4,
  overflow: 'hidden',
  flexShrink: 0,
  background: '#222',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '1px solid #2a2a2a',
};

const fallbackEmojiStyle: React.CSSProperties = {
  fontSize: 16,
  lineHeight: 1,
};

const labelStyle: React.CSSProperties = {
  flex: 1,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const badgeStyle: React.CSSProperties = {
  flexShrink: 0,
  display: 'inline-flex',
  alignItems: 'center',
  padding: '1px 6px',
  borderRadius: 4,
  background: 'rgba(255, 255, 255, 0.06)',
  fontSize: 10,
  color: '#888',
  textTransform: 'uppercase',
};

const emptyStyle: React.CSSProperties = {
  padding: '8px 10px',
  color: '#666',
  fontSize: 12,
};
