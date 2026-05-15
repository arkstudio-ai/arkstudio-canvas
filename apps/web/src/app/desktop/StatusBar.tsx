// P5 — bottom status bar (VSCode style). Always visible, 28px tall.
//
// Phase A: shows backend reachability (polls /health every 5s) and the
// resolved API base URL (so users can tell at a glance what backend the app
// is currently talking to). Phase E will add: queue size, current default
// model, perhaps a "go online" toggle.

import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { API_BASE_URL } from '../config/api';
import { useUIStore } from '../store/uiStore';

type HealthStatus = 'unknown' | 'ok' | 'down';

const POLL_INTERVAL_MS = 5_000;

export const StatusBar: React.FC = () => {
  const [status, setStatus] = useState<HealthStatus>('unknown');
  const queue = useUIStore((s) => s.executingNodesCount);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const probe = async () => {
      try {
        // Use the same base the app uses for everything else, so we're
        // verifying the actual backend the canvas talks to (not a different
        // localhost port that happens to answer).
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
  const label =
    status === 'ok' ? 'backend' : status === 'down' ? 'backend offline' : 'backend …';

  // Trim the protocol so the bar reads as "127.0.0.1:18500" rather than the
  // full URL — easier to scan, and the protocol is always http in our case.
  const baseDisplay = (API_BASE_URL || '(same origin)').replace(/^https?:\/\//, '');

  return (
    <footer style={rootStyle} aria-label="Status bar">
      <div style={leftGroupStyle}>
        <span style={dotStyle(dotColor)} aria-hidden />
        <span>{label}</span>
        <span style={dimStyle}>· {baseDisplay}</span>
      </div>
      <div style={rightGroupStyle}>
        {queue > 0 && (
          <span style={queueStyle} title={`${queue} 个节点正在生成中`}>
            <Loader2 size={11} style={spinStyle} />
            {queue} running
          </span>
        )}
      </div>

      {/* Inline keyframes for the spinner — kept local so we don't have to
          touch global CSS just for the status bar. */}
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
  padding: '0 12px',
  fontSize: 11,
  color: '#a8aeb6',
  fontVariantNumeric: 'tabular-nums',
  letterSpacing: 0.2,
};

const leftGroupStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const rightGroupStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
};

const dimStyle: React.CSSProperties = {
  color: '#5a5f68',
};

const dotStyle = (color: string): React.CSSProperties => ({
  display: 'inline-block',
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: color,
  boxShadow: `0 0 6px ${color}`,
});

const queueStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  color: '#fbbf24',
};

const spinStyle: React.CSSProperties = {
  animation: 'cf-status-spin 1.2s linear infinite',
};
