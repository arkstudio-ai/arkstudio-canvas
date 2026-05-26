// HTML/CSS context menu rendered via portal. Used by every list-item
// right-click in the secondary rail (nodes / templates / voices / history).
//
// Why not Electron's native Menu.popup: that requires an IPC round-trip,
// only works in packaged desktop builds, and gives us no styling control.
// Web-style context menus are good enough for Discord/Slack/Notion/Linear
// — they all use HTML menus to keep the look identical across platforms,
// including in their browser sessions.
//
// Behaviour:
//   - Anchor to the cursor position (event.clientX/Y from onContextMenu).
//   - Close on: outside click, escape, scroll, window resize, navigation.
//   - Items can be marked `danger: true` (red text) and `disabled: true`.
//   - Optional `divider: true` between groups (renders as a hairline).
//
// Usage:
//   const [menu, setMenu] = useState<{x: number; y: number} | null>(null);
//   <li onContextMenu={(e) => { e.preventDefault(); setMenu({x: e.clientX, y: e.clientY}); }}>
//   {menu && <ContextMenu position={menu} items={[...]} onClose={() => setMenu(null)} />}

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface ContextMenuItem {
  /** Display label. */
  label: string;
  /** Optional leading icon. */
  icon?: React.ReactNode;
  /** Click handler — invoked, then the menu closes automatically. */
  onClick?: () => void;
  /** Greys out and disables the item. */
  disabled?: boolean;
  /** Renders the label in red (used for delete / dangerous actions). */
  danger?: boolean;
  /** Renders a hairline divider INSTEAD of a row (label/onClick ignored). */
  divider?: boolean;
}

interface ContextMenuProps {
  position: { x: number; y: number };
  items: ContextMenuItem[];
  onClose: () => void;
}

const MENU_MIN_WIDTH = 180;
const VIEWPORT_MARGIN = 8;

export const ContextMenu: React.FC<ContextMenuProps> = ({
  position,
  items,
  onClose,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  // Start with the click coords; we'll clamp inside the viewport after we
  // measure the actual menu height (varies with item count). Two-pass to
  // avoid menus flowing off-screen when right-clicking near the bottom.
  const [pos, setPos] = useState(position);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let { x, y } = position;
    if (x + rect.width > window.innerWidth - VIEWPORT_MARGIN) {
      x = window.innerWidth - rect.width - VIEWPORT_MARGIN;
    }
    if (y + rect.height > window.innerHeight - VIEWPORT_MARGIN) {
      y = window.innerHeight - rect.height - VIEWPORT_MARGIN;
    }
    if (x !== pos.x || y !== pos.y) setPos({ x, y });
    // Intentionally only run when `position` changes — we adjust pos
    // once after mount based on the menu's actual rendered size.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position]);

  useEffect(() => {
    // Native capture-phase listener fires BEFORE React's synthetic onClick.
    // 第一版我们用 menu root 的 React onMouseDown stopPropagation 拦, 但
    // capture 阶段 native listener 早于 React 合成系统, stopPropagation
    // 拦不住, 结果 mousedown 一按菜单就 unmount, mouseup 时 button 已经
    // 不在 DOM 里 → click 永远不触发. 改成检查 target 是否在 menu 里:
    // 是 → 让 button 自己处理, 否 → 关菜单.
    const close = (e: MouseEvent) => {
      if (ref.current && ref.current.contains(e.target as Node)) return;
      onClose();
    };
    window.addEventListener('mousedown', close, true);
    // scroll / resize 不分内外, 直接关.
    const closeAlways = () => onClose();
    window.addEventListener('scroll', closeAlways, true);
    window.addEventListener('resize', closeAlways);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', close, true);
      window.removeEventListener('scroll', closeAlways, true);
      window.removeEventListener('resize', closeAlways);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={{
        ...rootStyle,
        left: pos.x,
        top: pos.y,
      }}
    >
      {items.map((item, i) => {
        if (item.divider) {
          return <div key={i} style={dividerStyle} role="separator" />;
        }
        return (
          <button
            key={i}
            type="button"
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              item.onClick?.();
              onClose();
            }}
            role="menuitem"
            style={{
              ...rowStyle,
              color: item.disabled
                ? '#3f4451'
                : item.danger
                ? '#ff6b6b'
                : '#e0e0e0',
              cursor: item.disabled ? 'not-allowed' : 'pointer',
            }}
            onMouseEnter={(e) => {
              if (item.disabled) return;
              e.currentTarget.style.background = item.danger
                ? 'rgba(220,38,38,0.18)'
                : 'rgba(255,255,255,0.06)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            {item.icon && <span style={iconSlotStyle}>{item.icon}</span>}
            <span style={labelStyle}>{item.label}</span>
          </button>
        );
      })}
    </div>,
    document.body,
  );
};

const rootStyle: React.CSSProperties = {
  position: 'fixed',
  zIndex: 2000,
  minWidth: MENU_MIN_WIDTH,
  padding: 4,
  background: '#1a1c21',
  border: '1px solid #2a2d35',
  borderRadius: 8,
  boxShadow: '0 12px 32px rgba(0,0,0,0.55)',
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  fontSize: 12,
  userSelect: 'none',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  width: '100%',
  padding: '7px 10px',
  border: 'none',
  background: 'transparent',
  borderRadius: 6,
  textAlign: 'left',
  transition: 'background 0.1s',
};

const iconSlotStyle: React.CSSProperties = {
  width: 14,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
};

const labelStyle: React.CSSProperties = {
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const dividerStyle: React.CSSProperties = {
  height: 1,
  margin: '4px 0',
  background: '#2a2d35',
};
