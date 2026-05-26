// Custom titlebar — the visual signal that "this is not a browser tab".
//
// Behaviour per host platform:
//   - macOS: the BrowserWindow uses `titleBarStyle: 'hiddenInset'`, which
//     keeps the native traffic-light buttons (red/yellow/green) on the left
//     but hides the rest of the chrome. We render a 32px draggable strip
//     with a 78px left padding so the title text doesn't underlap the
//     traffic lights. No painted minimise/maximise/close.
//   - Windows: the window has `titleBarOverlay`, which paints the system
//     min/max/close icons (32px tall) over the top-right corner; we keep
//     our own painted controls hidden and just render a 32px draggable
//     title row that respects the overlay's right-side reserved area
//     (~138px, accounting for caption buttons + snap-layouts hover zone).
//   - Linux: BrowserWindow has `frame: true` (system handles the chrome
//     entirely), so we render nothing here. Status bar / canvas paint as
//     usual under the system titlebar.
//   - Browser (vite dev in normal Chrome, no electron): we don't have a
//     painted titlebar, so we suppress the component entirely so
//     non-electron sessions don't see a phantom strip eating 32px.
//
// The drag region works via the CSS `app-region: drag` non-standard property
// (Chromium-only). Buttons / interactive elements set `app-region: no-drag`
// to remain clickable.

import React, { useEffect, useState } from 'react';
import { Minus, Square, X, Copy, Settings } from 'lucide-react';

import { useUIStore } from '../store/uiStore';

type Platform = 'darwin' | 'win32' | 'linux' | 'web';

interface DesktopBridge {
  platform?: string;
  windowControls?: {
    minimize: () => void;
    maximizeToggle: () => void;
    close: () => void;
  };
}

const detectPlatform = (): Platform => {
  if (typeof window === 'undefined') return 'web';
  const bridge = (window as unknown as { canvasDesktop?: DesktopBridge }).canvasDesktop;
  if (!bridge?.platform) return 'web';
  if (bridge.platform === 'darwin') return 'darwin';
  if (bridge.platform === 'win32') return 'win32';
  return 'linux';
};

const APP_NAME = 'Canvas Flow';

export const CustomTitleBar: React.FC = () => {
  const [platform] = useState<Platform>(() => detectPlatform());
  const flowName = useUIStore((s) => s.currentFlowName);
  const openSettings = useUIStore((s) => s.openSettings);

  // We only listen to maximize state on win32; mac uses native traffic
  // lights and linux uses the system frame, neither of which need our
  // input. Keep the listener cheap (no rAF loop).
  const [isMax, setIsMax] = useState(false);
  useEffect(() => {
    if (platform !== 'win32') return;
    const onResize = () => {
      // No reliable cross-version IPC for "is currently maximised", but
      // a viewport-equals-screen heuristic catches both maximize() and
      // user-dragged "almost-fullscreen" states well enough for the
      // icon to flip between square and copy variants.
      setIsMax(
        window.innerWidth >= window.screen.availWidth - 4 &&
          window.innerHeight >= window.screen.availHeight - 4,
      );
    };
    window.addEventListener('resize', onResize);
    onResize();
    return () => window.removeEventListener('resize', onResize);
  }, [platform]);

  // Browser session (non-electron) — render nothing so a normal Vite dev
  // page in Chrome doesn't gain a useless 32px black bar at the top.
  if (platform === 'web' || platform === 'linux') return null;

  const isMac = platform === 'darwin';
  const bridge = (window as unknown as { canvasDesktop?: DesktopBridge }).canvasDesktop;
  const ctrls = bridge?.windowControls;

  return (
    <header
      style={{
        ...rootStyle,
        // mac: leave 78px on the left for the traffic lights (plus a
        //      breathing margin) so our title text isn't behind them.
        // win: leave ~138px on the right for the system overlay's
        //      min/max/close caption buttons.
        paddingLeft: isMac ? 78 : 12,
        paddingRight: isMac ? 12 : 138,
      }}
    >
      <span style={titleStyle}>
        {flowName ? `${flowName} — ${APP_NAME}` : APP_NAME}
      </span>

      {/*
        Settings button. app-region: no-drag so click is honoured (the bar
        is otherwise a drag region). Sits at the right edge on mac; on win
        it's still in flow but the paddingRight: 138 reserves the system
        overlay's space, so the gear naturally lands just to the left of
        the min/max/close caption buttons.
      */}
      <button
        type="button"
        onClick={() => openSettings()}
        title="设置 (Cmd+,)"
        aria-label="设置"
        style={iconBtnStyle}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
          e.currentTarget.style.color = '#fff';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = '#9aa0a6';
        }}
      >
        <Settings size={14} />
      </button>

      {!isMac && ctrls && (
        // Hidden by titleBarOverlay on win, but left here so a future
        // platform (e.g. linux frameless) can flip on `frame: false` and
        // still get working window controls without further changes.
        <div style={{ display: 'none' }}>
          <button type="button" onClick={ctrls.minimize}><Minus size={14} /></button>
          <button type="button" onClick={ctrls.maximizeToggle}>
            {isMax ? <Copy size={14} /> : <Square size={14} />}
          </button>
          <button type="button" onClick={ctrls.close}><X size={14} /></button>
        </div>
      )}
    </header>
  );
};

const rootStyle: React.CSSProperties = {
  height: 32,
  flexShrink: 0,
  background: '#0a0a0a',
  borderBottom: '1px solid #1a1a1a',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#9aa0a6',
  fontSize: 12,
  letterSpacing: 0.3,
  userSelect: 'none',
  // Make the entire bar a window-drag region. Buttons inside opt out via
  // their own `app-region: no-drag`. This is a Chromium-only property; in
  // a normal browser it's ignored and the bar simply isn't draggable.
  WebkitAppRegion: 'drag',
} as React.CSSProperties;

const titleStyle: React.CSSProperties = {
  textAlign: 'center',
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const iconBtnStyle: React.CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: 6,
  border: 'none',
  background: 'transparent',
  color: '#9aa0a6',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  transition: 'background 0.15s, color 0.15s',
  WebkitAppRegion: 'no-drag',
} as React.CSSProperties;
