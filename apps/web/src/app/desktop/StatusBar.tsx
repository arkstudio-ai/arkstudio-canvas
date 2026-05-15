// P5 — bottom status bar (VSCode style). Always visible, 28px tall.
//
// Layout (left-to-right):
//
//   ●     |   N 节点 · M 边   |   缩放 100% (click → fit)   |   ⏵ K 个生成中…
//
// The green dot is the only piece of "infrastructure" info we keep visible:
// at-a-glance proof the backend is reachable. Hovering it reveals the API
// base URL (the old always-visible text was noisy for users who have one
// install and never need to know the URL). The rest of the bar is editor
// state — what they're looking at + what's being computed for them.

import React, { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { API_BASE_URL } from '../config/api';
import { useUIStore } from '../store/uiStore';

type HealthStatus = 'unknown' | 'ok' | 'down';

const POLL_INTERVAL_MS = 5_000;

export const StatusBar: React.FC = () => {
  const [status, setStatus] = useState<HealthStatus>('unknown');
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const dotRef = useRef<HTMLSpanElement>(null);

  const queue = useUIStore((s) => s.executingNodesCount);
  const nodeCount = useUIStore((s) => s.currentNodes.length);
  const edgeCount = useUIStore((s) => s.currentEdgesCount);
  const zoom = useUIStore((s) => s.currentZoom);
  const resetZoom = useUIStore((s) => s.resetZoom);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const probe = async () => {
      try {
        const res = await fetch(`${API_BASE_URL || ''}/health`, {
          signal: AbortSignal.timeout(2_500),
        });
        if (cancelled) return;
        setStatus(res.ok ? 'ok' : 'down');
      } catch {
        if (cancelled) return;
        setStatus('down');
      } finally {
        if (!cancelled) {
          timer = setTimeout(probe, POLL_INTERVAL_MS);
        }
      }
    };
    probe();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const dotColor =
    status === 'ok' ? '#52c41a' : status === 'down' ? '#ff4d4f' : '#8a8f98';
  const tooltipText =
    status === 'ok'
      ? `已连接 · ${API_BASE_URL || '(same origin)'}`
      : status === 'down'
      ? `后端无响应 · ${API_BASE_URL || '(same origin)'}`
      : `连接中… · ${API_BASE_URL || '(same origin)'}`;
  const zoomPct = `${Math.round(zoom * 100)}%`;

  return (
    <footer style={rootStyle} aria-label="Status bar">
      <div style={leftGroupStyle}>
        <span
          ref={dotRef}
          style={dotWrapStyle}
          onMouseEnter={() => setTooltipOpen(true)}
          onMouseLeave={() => setTooltipOpen(false)}
          aria-label={tooltipText}
        >
          <span style={dotStyle(dotColor)} aria-hidden />
          {tooltipOpen && <span style={tooltipStyle}>{tooltipText}</span>}
        </span>

        <span style={dividerStyle} aria-hidden />

        <span style={statStyle}>
          <strong style={numStyle}>{nodeCount}</strong> 节点
          <span style={dotSepStyle}>·</span>
          <strong style={numStyle}>{edgeCount}</strong> 边
        </span>

        <span style={dividerStyle} aria-hidden />

        <button
          type="button"
          onClick={() => resetZoom?.()}
          disabled={!resetZoom}
          style={zoomBtnStyle}
          title={resetZoom ? '点击适配画布' : '画布加载中…'}
          onMouseEnter={(e) => {
            if (!resetZoom) return;
            e.currentTarget.style.color = '#fff';
            e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = '#a8aeb6';
            e.currentTarget.style.background = 'transparent';
          }}
        >
          缩放 <strong style={numStyle}>{zoomPct}</strong>
        </button>
      </div>

      <div style={rightGroupStyle}>
        {queue > 0 && (
          <span style={queueStyle} title={`${queue} 个节点正在生成中`}>
            <Loader2 size={11} style={spinStyle} />
            <strong style={numStyle}>{queue}</strong> 个生成中…
          </span>
        )}
      </div>

      <style>{`@keyframes cf-status-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </footer>
  );
};

const rootStyle: React.CSSProperties = {
  height: 28,
  flexShrink: 0,
  background: '#0a0a0a',
  borderTop: '1px solid #1a1a1a',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0 8px 0 12px',
  fontSize: 11,
  color: '#a8aeb6',
  fontVariantNumeric: 'tabular-nums',
  letterSpacing: 0.2,
};

const leftGroupStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  minWidth: 0,
};

const rightGroupStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
};

const dotWrapStyle: React.CSSProperties = {
  position: 'relative',
  display: 'inline-flex',
  alignItems: 'center',
  padding: '2px 4px',
  cursor: 'default',
};

const dotStyle = (color: string): React.CSSProperties => ({
  display: 'inline-block',
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: color,
  boxShadow: `0 0 6px ${color}`,
});

const tooltipStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 'calc(100% + 6px)',
  left: 0,
  background: '#1a1c21',
  border: '1px solid #2a2d35',
  color: '#e0e0e0',
  padding: '6px 10px',
  borderRadius: 6,
  fontSize: 11,
  whiteSpace: 'nowrap',
  zIndex: 100,
  pointerEvents: 'none',
  boxShadow: '0 6px 16px rgba(0,0,0,0.5)',
};

const dividerStyle: React.CSSProperties = {
  display: 'inline-block',
  width: 1,
  height: 12,
  background: '#1f2128',
  margin: '0 4px',
};

const statStyle: React.CSSProperties = {
  padding: '2px 4px',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
};

const dotSepStyle: React.CSSProperties = {
  margin: '0 6px',
  color: '#3f4451',
};

const zoomBtnStyle: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: '#a8aeb6',
  fontSize: 11,
  letterSpacing: 0.2,
  fontVariantNumeric: 'tabular-nums',
  padding: '2px 6px',
  borderRadius: 4,
  cursor: 'pointer',
  transition: 'background 0.15s, color 0.15s',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
};

const numStyle: React.CSSProperties = {
  color: '#e0e0e0',
  fontWeight: 500,
};

const queueStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  color: '#fbbf24',
};

const spinStyle: React.CSSProperties = {
  animation: 'cf-status-spin 1.2s linear infinite',
};
