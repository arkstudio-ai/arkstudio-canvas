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

import { CanvasRail } from './CanvasRail';
import { SecondaryRail } from './SecondaryRail';
import { StatusBar } from './StatusBar';
import { SettingsOverlay } from './SettingsOverlay';
import { CustomTitleBar } from './CustomTitleBar';
import { useGlobalShortcuts } from './useGlobalShortcuts';

export interface DesktopShellProps {
  /** P3 main content. In production this is `<EditorPage … />`. */
  children: ReactNode;
}

export const DesktopShell: React.FC<DesktopShellProps> = ({ children }) => {
  useGlobalShortcuts();

  return (
    <div style={rootStyle}>
      <CustomTitleBar />
      <div style={railsRowStyle}>
        <CanvasRail />
        <SecondaryRail />
        <main style={mainStyle}>{children}</main>
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

const mainStyle: React.CSSProperties = {
  flex: 1,
  position: 'relative',
  minWidth: 0,
  background: '#000',
};
