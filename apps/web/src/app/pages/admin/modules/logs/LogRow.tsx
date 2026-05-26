import React from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type {
  ExecutionPhase,
  ExecutionRow,
  ExecutionStatus,
  ModelKindOrUnknown,
} from '../../types';

const STATUS_COLOR: Record<ExecutionStatus, string> = {
  PENDING: '#A8C7FA',
  RUNNING: '#A8C7FA',
  COMPLETED: '#9BE39A',
  FAILED: '#FFB4AB',
};

const PHASE_LABEL_KEYS: Record<ExecutionPhase, string> = {
  submitting: 'settings:logs.row.phaseSubmitting',
  submitted: 'settings:logs.row.phaseSubmitted',
  polling: 'settings:logs.row.phasePolling',
  completed: 'settings:logs.row.phaseCompleted',
  failed: 'settings:logs.row.phaseFailed',
};

const KIND_PILL_COLOR: Record<ModelKindOrUnknown, string> = {
  chat: '#A8C7FA',
  video: '#D7BBFF',
  image: '#9BE39A',
  audio: '#FFD79A',
  unknown: '#666',
};

const KIND_LABEL_KEYS: Record<ModelKindOrUnknown, string | null> = {
  chat: 'settings:kind.chat',
  video: 'settings:kind.video',
  image: 'settings:kind.image',
  audio: 'settings:kind.audio',
  unknown: null,
};

export interface LogRowProps {
  row: ExecutionRow;
  onClick: () => void;
}

export const LogRow: React.FC<LogRowProps> = ({ row, onClick }) => {
  const { t } = useTranslation();
  const phaseText = row.phase ? t(PHASE_LABEL_KEYS[row.phase]) : '—';
  const kind: ModelKindOrUnknown = row.kind ?? 'unknown';
  const kindKey = KIND_LABEL_KEYS[kind];
  const kindLabel = kindKey ? t(kindKey) : '—';
  return (
    <tr style={trStyle} onClick={onClick}>
      <td style={tdMonoStyle} title={row.id}>{row.id.slice(0, 8)}</td>
      <td style={tdStyle}>{formatTime(row.createdAt)}</td>
      <td style={tdStyle}>
        <div>{row.modelSku ?? '—'}</div>
        {row.modelName && row.modelName !== row.modelSku ?
          <div style={subTextStyle}>{row.modelName}</div>
        : null}
      </td>
      <td style={tdStyle}>
        <span style={kindPillStyle(kind)}>{kindLabel}</span>
      </td>
      <td style={tdStyle}>
        <span style={{ ...statusBadgeStyle, color: STATUS_COLOR[row.status] }}>{row.status}</span>
      </td>
      <td style={tdStyle}>{phaseText}</td>
      <td style={tdNumStyle}>{row.latencyMs != null ? `${(row.latencyMs / 1000).toFixed(1)}s` : '—'}</td>
      <td style={tdNumStyle}>{renderUnit(row, t)}</td>
      <td
        style={{
          ...tdStyle,
          color: '#FFB4AB',
          maxWidth: 240,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={row.errorMsg ?? ''}
      >
        {row.errorMsg ?? ''}
      </td>
    </tr>
  );
};

/**
 * Per-row billable unit cell. Mirrors the Usage page logic so chat shows
 * tokens, video/audio show seconds, image shows count. Returning a string
 * instead of a node keeps the right-aligned numeric column tidy.
 */
function renderUnit(row: ExecutionRow, t: TFunction): string {
  switch (row.kind) {
    case 'chat':
      if (row.inputTokens == null && row.outputTokens == null) return '—';
      return `${row.inputTokens ?? 0} / ${row.outputTokens ?? 0} tok`;
    case 'video':
    case 'audio':
      if (row.outputDurationSec == null) return '—';
      return `${row.outputDurationSec.toFixed(0)}s`;
    case 'image':
      if (row.outputCount == null) return '—';
      return t('settings:logs.row.unitImage', { count: row.outputCount });
    default:
      return '—';
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const trStyle: React.CSSProperties = {
  cursor: 'pointer',
  borderTop: '1px solid #1a1a1a',
};
const tdStyle: React.CSSProperties = {
  padding: '10px 12px',
  fontSize: 12,
  color: '#ccc',
  verticalAlign: 'top',
};
const tdMonoStyle: React.CSSProperties = {
  ...tdStyle,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  color: '#888',
};
const tdNumStyle: React.CSSProperties = {
  ...tdStyle,
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
};
const subTextStyle: React.CSSProperties = { color: '#666', fontSize: 11, marginTop: 2 };
const statusBadgeStyle: React.CSSProperties = {
  fontWeight: 500,
  fontSize: 11,
  letterSpacing: 0.4,
};
const kindPillStyle = (kind: ModelKindOrUnknown): React.CSSProperties => ({
  display: 'inline-block',
  padding: '2px 7px',
  fontSize: 10,
  borderRadius: 999,
  background: 'rgba(255,255,255,0.04)',
  color: KIND_PILL_COLOR[kind],
  fontWeight: 500,
  letterSpacing: 0.3,
});
