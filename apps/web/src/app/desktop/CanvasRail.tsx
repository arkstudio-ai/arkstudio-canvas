// P1 — leftmost 56px rail. Discord's "server list" equivalent.
//
// Phase A: skeleton only. Top section is a placeholder for the canvas list
// (will be wired in phase B by extracting the existing CanvasGallery). Bottom
// section already houses the settings entry (Cmd+,/click → opens the
// SettingsOverlay) and a "+" placeholder for "new canvas".
//
// Why a separate component instead of inlining into DesktopShell: this rail
// will accumulate logic (drag-to-reorder canvases, hover preview, presence
// indicator…) and we want one file to own that.

import React from 'react';
import { Settings } from 'lucide-react';

import { useUIStore } from '../store/uiStore';
import { CanvasRailList } from './CanvasRailList';

export const CanvasRail: React.FC = () => {
  const openSettings = useUIStore((s) => s.openSettings);
  const currentFlowId = useUIStore((s) => s.currentFlowId);

  return (
    <aside style={asideStyle} aria-label="Canvas rail">
      <CanvasRailList currentFlowId={currentFlowId} />

      <div style={bottomGroupStyle}>
        <RailButton title="设置" onClick={() => openSettings()}>
          <Settings size={18} />
        </RailButton>
      </div>
    </aside>
  );
};

interface RailButtonProps {
  title: string;
  onClick?: () => void;
  active?: boolean;
  children: React.ReactNode;
}

const RailButton: React.FC<RailButtonProps> = ({
  title,
  onClick,
  active,
  children,
}) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    style={{
      ...railButtonStyle,
      background: active ? 'rgba(255,255,255,0.08)' : 'transparent',
      color: active ? '#fff' : '#9aa0a6',
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
      e.currentTarget.style.color = '#fff';
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.background = active
        ? 'rgba(255,255,255,0.08)'
        : 'transparent';
      e.currentTarget.style.color = active ? '#fff' : '#9aa0a6';
    }}
  >
    {children}
  </button>
);

const asideStyle: React.CSSProperties = {
  width: 56,
  flexShrink: 0,
  background: '#0a0a0a',
  borderRight: '1px solid #1a1a1a',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  padding: '12px 0',
  boxSizing: 'border-box',
  // 让 CanvasRailList (flex: 1) 撑满，bottomGroup 自然落底。
  gap: 8,
};

const bottomGroupStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
};

const railButtonStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 10,
  border: 'none',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'background 0.15s, color 0.15s',
  padding: 0,
};
