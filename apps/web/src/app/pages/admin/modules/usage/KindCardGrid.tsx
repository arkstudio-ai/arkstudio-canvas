import React from 'react';
import { MessageSquareText, Image as ImageIcon, Video, AudioLines } from 'lucide-react';
import type { KindBucket, ModelKind } from '../../types';

/**
 * 4-up grid showing a card per model kind. Each card surfaces the unit that
 * actually drives that kind's bill (tokens for chat, seconds for video /
 * audio, image count for image) so admins don't have to translate
 * `inputTokens` into "5 seconds of video" in their head.
 *
 * Cards for empty kinds still render so the layout stays predictable across
 * date ranges; the value just shows "—" instead of "0".
 */

interface KindMeta {
  kind: ModelKind;
  label: string;
  Icon: typeof MessageSquareText;
  /** Hue used for the icon + accent value; intentionally muted to match
   *  the rest of the admin shell (no large blocks of saturated color). */
  accent: string;
  /** Returns (label, value) for the kind-specific billable metric. */
  unit: (b: KindBucket) => { label: string; value: string };
}

const KIND_META: KindMeta[] = [
  {
    kind: 'chat',
    label: 'Chat',
    Icon: MessageSquareText,
    accent: '#A8C7FA',
    unit: (b) => ({
      label: 'Tokens (in / out)',
      value: `${formatNum(b.inputTokens)} / ${formatNum(b.outputTokens)}`,
    }),
  },
  {
    kind: 'video',
    label: 'Video',
    Icon: Video,
    accent: '#D7BBFF',
    unit: (b) => ({
      label: '输出视频时长',
      value: b.outputDurationSec > 0 ? `${formatSeconds(b.outputDurationSec)}` : '—',
    }),
  },
  {
    kind: 'image',
    label: 'Image',
    Icon: ImageIcon,
    accent: '#9BE39A',
    unit: (b) => ({
      label: '生成张数',
      value: b.outputCount > 0 ? `${b.outputCount} 张` : '—',
    }),
  },
  {
    kind: 'audio',
    label: 'Audio',
    Icon: AudioLines,
    accent: '#FFD79A',
    unit: (b) => ({
      label: '合成音频时长',
      value: b.outputDurationSec > 0 ? `${formatSeconds(b.outputDurationSec)}` : '—',
    }),
  },
];

export const KindCardGrid: React.FC<{ buckets: KindBucket[] }> = ({ buckets }) => {
  const byKind = new Map(buckets.map((b) => [b.kind, b]));
  return (
    <section style={gridStyle}>
      {KIND_META.map((meta) => {
        const bucket = byKind.get(meta.kind) ?? emptyBucket(meta.kind);
        const rate = bucket.count > 0 ? Math.round((bucket.completed / bucket.count) * 100) : null;
        const unit = meta.unit(bucket);
        return (
          <div key={meta.kind} style={cardStyle}>
            <div style={cardHeadStyle}>
              <meta.Icon size={14} color={meta.accent} strokeWidth={1.5} />
              <span style={cardKindLabelStyle}>{meta.label}</span>
            </div>
            <div style={cardCountRowStyle}>
              <span style={cardCountStyle}>{bucket.count}</span>
              <span style={cardCountSuffixStyle}>次调用</span>
              {rate !== null && (
                <span style={rateStyle(rate)}>{rate}% 成功</span>
              )}
            </div>
            <div style={cardUnitRowStyle}>
              <span style={cardUnitLabelStyle}>{unit.label}</span>
              <span style={{ ...cardUnitValueStyle, color: bucket.count > 0 ? meta.accent : '#555' }}>
                {unit.value}
              </span>
            </div>
          </div>
        );
      })}
    </section>
  );
};

function emptyBucket(kind: ModelKind): KindBucket {
  return {
    kind,
    count: 0,
    completed: 0,
    failed: 0,
    inputTokens: 0,
    outputTokens: 0,
    outputDurationSec: 0,
    outputCount: 0,
  };
}

function formatNum(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function formatSeconds(sec: number): string {
  if (sec < 60) return `${sec.toFixed(0)} 秒`;
  const min = Math.floor(sec / 60);
  const rem = Math.round(sec % 60);
  return `${min}m ${rem}s`;
}

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 12,
};
const cardStyle: React.CSSProperties = {
  background: '#141414',
  border: '1px solid #1f1f1f',
  borderRadius: 10,
  padding: '14px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};
const cardHeadStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};
const cardKindLabelStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#888',
  fontWeight: 500,
  letterSpacing: 0.3,
};
const cardCountRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 6,
  flexWrap: 'wrap',
};
const cardCountStyle: React.CSSProperties = {
  fontSize: 24,
  fontWeight: 600,
  color: '#fff',
  fontVariantNumeric: 'tabular-nums',
};
const cardCountSuffixStyle: React.CSSProperties = { fontSize: 12, color: '#666' };
const cardUnitRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 8,
  borderTop: '1px solid #1f1f1f',
  paddingTop: 8,
};
const cardUnitLabelStyle: React.CSSProperties = { fontSize: 11, color: '#666' };
const cardUnitValueStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  fontVariantNumeric: 'tabular-nums',
};

const rateStyle = (rate: number): React.CSSProperties => ({
  marginLeft: 'auto',
  fontSize: 11,
  color: rate >= 90 ? '#9BE39A' : rate >= 50 ? '#FFD79A' : '#FFB4AB',
  fontVariantNumeric: 'tabular-nums',
});
