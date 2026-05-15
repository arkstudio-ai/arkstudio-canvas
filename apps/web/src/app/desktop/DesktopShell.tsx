// Top-level desktop layout. Three rails + status bar. Renders children in
// the P3 main area (the canvas).
//
// Layout (Discord-style):
//   ┌───────────────────────── viewport ─────────────────────────┐
//   │ ┌──────┬───────────────┬─────────────────────────────────┐ │
//   │ │  P1  │      P2       │          P3 (children)          │ │
//   │ │ 56px │     240px     │              flex               │ │
//   │ └──────┴───────────────┴─────────────────────────────────┘ │
//   │ ┌────────────────── P5 status bar (28px) ────────────────┐ │
//   │ └─────────────────────────────────────────────────────────┘ │
//   └─────────────────────────────────────────────────────────────┘
//
// Hard constraints we enforce here so callers don't have to think about it:
//   - The whole shell occupies exactly 100vh × 100vw, never overflows.
//   - P3's container is `position: relative`, so child elements with
//     `position: absolute; inset: 0` (e.g. EditorPage's canvas surface)
//     fill P3 instead of escaping to the viewport.
//   - `minWidth: 0` on the P3 main avoids the classic flex-shrink trap
//     where xyflow's inner SVG forces the column to expand past flex: 1.

import React, { type ReactNode } from 'react';
import { PanelLeftOpen } from 'lucide-react';

import { CanvasRail } from './CanvasRail';
import { SecondaryRail } from './SecondaryRail';
import { StatusBar } from './StatusBar';
import { SettingsOverlay } from './SettingsOverlay';
import { CustomTitleBar } from './CustomTitleBar';
import { useGlobalShortcuts } from './useGlobalShortcuts';
import { useUIStore } from '../store/uiStore';

export interface DesktopShellProps {
  /** P3 main content. In production this is `<EditorPage … />`. */
  children: ReactNode;
}

export const DesktopShell: React.FC<DesktopShellProps> = ({ children }) => {
  useGlobalShortcuts();
  const railCollapsed = useUIStore((s) => s.secondaryRailCollapsed);
  const expandRail = useUIStore((s) => s.toggleSecondaryRail);

  return (
    <div style={rootStyle}>
      <CustomTitleBar />
      <div style={railsRowStyle}>
        <CanvasRail />
        <SecondaryRail />
        {/*
          P3 嵌一层 frame, 不让画布直接顶到边. 视觉上把"画布"当独立窗格,
          跟 Linear / Notion / Discord 主区域同款的内嵌感. inner main
          仍 position:relative, EditorPage 内部的 absolute:inset-0 fill
          的是 inner, 不会逃出 frame.
        */}
        <div style={mainFrameStyle}>
          <main style={mainStyle}>
            {children}
            {/*
              展开 P2 的浮动按钮. 永远 render 着 (避免出现/消失的元素打断
              用户视线), 用 opacity + transform 控制可见性. P2 收起时
              fade-in + 从左侧滑入; P2 展开时 fade-out + 滑回去 (但
              已经被 inert 化, 不可点).
            */}
            <button
              type="button"
              onClick={expandRail}
              title="展开侧边栏 (Cmd+B)"
              aria-label="展开侧边栏"
              tabIndex={railCollapsed ? 0 : -1}
              style={{
                ...expandBtnStyle,
                opacity: railCollapsed ? 1 : 0,
                transform: railCollapsed
                  ? 'translateX(0)'
                  : 'translateX(-8px)',
                pointerEvents: railCollapsed ? 'auto' : 'none',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(13,13,13,0.95)';
                e.currentTarget.style.color = '#fff';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(13,13,13,0.7)';
                e.currentTarget.style.color = '#cbd0d8';
              }}
            >
              <PanelLeftOpen size={14} />
            </button>
          </main>
        </div>
      </div>
      <StatusBar />
      <SettingsOverlay />
    </div>
  );
};

const rootStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  width: '100vw',
  height: '100vh',
  background: '#000',
  color: '#e6e6e6',
  overflow: 'hidden',
};

const railsRowStyle: React.CSSProperties = {
  display: 'flex',
  flex: 1,
  minHeight: 0,
};

const mainFrameStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  // 四周等距留白. 之前左侧设 0 是为了让 P3 紧贴 P2, 但 secondary rail
  // 收起后画布会贴到 P1 边线上, 看起来突兀; 等距 6px 在两种状态下都成立.
  padding: 6,
  display: 'flex',
};

const mainStyle: React.CSSProperties = {
  flex: 1,
  position: 'relative',
  minWidth: 0,
  background: '#0a0a0a',
  borderRadius: 10,
  border: '1px solid #1a1a1a',
  overflow: 'hidden',
  // 轻微外阴影, 强化「悬浮窗格」的层次感.
  boxShadow: '0 1px 0 rgba(255,255,255,0.02) inset, 0 4px 16px rgba(0,0,0,0.4)',
};

// Floating "expand secondary rail" affordance. Sits in the top-left of the
// main canvas frame, fades + slides into view when the rail is collapsed;
// stays mounted (just inert) the rest of the time so the appear/disappear
// transition stays smooth on toggle.
const expandBtnStyle: React.CSSProperties = {
  position: 'absolute',
  top: 12,
  left: 12,
  width: 28,
  height: 28,
  borderRadius: 8,
  border: '1px solid #1f1f1f',
  background: 'rgba(13,13,13,0.7)',
  color: '#cbd0d8',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 50,
  // Two-axis transition: opacity for fade, transform for slide-in. The
  // 220ms matches the rail's own width transition so they finish together.
  transition:
    'opacity 220ms cubic-bezier(0.32, 0.72, 0, 1), transform 220ms cubic-bezier(0.32, 0.72, 0, 1), background 0.15s, color 0.15s',
  backdropFilter: 'blur(6px)',
};
