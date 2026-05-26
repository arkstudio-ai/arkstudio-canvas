// P1 — leftmost rail. Houses the canvas list + a collapse toggle.
//
// Two display modes (toggle lives in `useUIStore.canvasRailMode`):
//   - 'expanded'  → 180px wide, rows show [cover + name + created-at]
//   - 'collapsed' → 56px wide, Discord-style cover-only tiles (the v1 look)
//
// Why both: the wider expanded mode wins on at-a-glance identification
// (user feedback: "画布 list 只展示封面不太好"); the collapsed mode wins
// when the user wants every pixel of canvas surface back. We let them
// flip without forcing a single answer.
//
// Width changes go through a 220ms ease-out transition (Apple-ish curve)
// so the layout shift feels intentional rather than a hard jump.
//
// Settings button: also lives here at the bottom of P1 (browser sessions
// don't render `CustomTitleBar` so the titlebar settings gear is invisible
// there — this gives a path to settings that always exists).

import React from 'react';
import { useTranslation } from 'react-i18next';
import { PanelLeftClose, PanelLeftOpen, Settings } from 'lucide-react';

import { useUIStore } from '../store/uiStore';
import { CanvasRailList } from './CanvasRailList';

const WIDTH_EXPANDED = 180;
const WIDTH_COLLAPSED = 56;
const TRANSITION = 'width 220ms cubic-bezier(0.32, 0.72, 0, 1)';

export const CanvasRail: React.FC = () => {
  const { t } = useTranslation();
  const currentFlowId = useUIStore((s) => s.currentFlowId);
  const mode = useUIStore((s) => s.canvasRailMode);
  const toggle = useUIStore((s) => s.toggleCanvasRail);
  const openSettings = useUIStore((s) => s.openSettings);

  const expanded = mode === 'expanded';
  const toggleLabel = expanded ? t('canvasRail.collapse') : t('canvasRail.expand');

  const hoverEnter = (e: React.MouseEvent<HTMLButtonElement>): void => {
    e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
    e.currentTarget.style.color = '#fff';
  };
  const hoverLeave = (e: React.MouseEvent<HTMLButtonElement>): void => {
    e.currentTarget.style.background = 'transparent';
    e.currentTarget.style.color = '#9aa0a6';
  };

  return (
    <aside
      style={{
        ...asideStyle,
        width: expanded ? WIDTH_EXPANDED : WIDTH_COLLAPSED,
      }}
      aria-label="Canvas rail"
    >
      <div style={listScrollWrapStyle}>
        <CanvasRailList currentFlowId={currentFlowId} mode={mode} />
      </div>

      <div
        style={{
          ...bottomBarStyle,
          flexDirection: expanded ? 'row' : 'column',
          justifyContent: expanded ? 'space-between' : 'center',
          gap: expanded ? 0 : 4,
        }}
      >
        <button
          type="button"
          onClick={() => openSettings()}
          title={t('settings.title') as string}
          aria-label={t('settings.title') as string}
          style={iconBtnStyle}
          onMouseEnter={hoverEnter}
          onMouseLeave={hoverLeave}
        >
          <Settings size={14} />
        </button>
        <button
          type="button"
          onClick={toggle}
          title={toggleLabel}
          aria-label={toggleLabel}
          style={iconBtnStyle}
          onMouseEnter={hoverEnter}
          onMouseLeave={hoverLeave}
        >
          {expanded ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
        </button>
      </div>
    </aside>
  );
};

const asideStyle: React.CSSProperties = {
  flexShrink: 0,
  background: '#0a0a0a',
  borderRight: '1px solid #1a1a1a',
  display: 'flex',
  flexDirection: 'column',
  padding: '8px 0 0',
  boxSizing: 'border-box',
  transition: TRANSITION,
  overflow: 'hidden',
};

// 内层包一层 scroll wrap 而不是直接给 CanvasRailList 设 overflow,
// 是为了在折叠/展开 transition 期间 (width 在变化), 保证内容不抖动.
// CanvasRailList 内部按当前 mode 选择 layout, 父容器只管 width 动画.
const listScrollWrapStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  overflowX: 'hidden',
};

const bottomBarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '6px 8px',
  borderTop: '1px solid #1a1a1a',
  flexShrink: 0,
  // justify-content swapped per mode (see render).
};

const iconBtnStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 6,
  border: 'none',
  background: 'transparent',
  color: '#9aa0a6',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'background 0.15s, color 0.15s',
};
