import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { getUsageOverview } from '../../api/admin-api';
import type { ExecutionStatus, ModelKindOrUnknown, ModelRow, UsageOverview } from '../../types';
import { KindCardGrid } from './KindCardGrid';

type Range = 'today' | 'week' | 'month';

const RANGE_LABELS: Record<Range, string> = {
  today: '今天',
  week: '近 7 天',
  month: '近 30 天',
};

const STATUS_COLOR: Record<ExecutionStatus, string> = {
  PENDING: '#A8C7FA',
  RUNNING: '#A8C7FA',
  COMPLETED: '#9BE39A',
  FAILED: '#FFB4AB',
};

const KIND_LABEL: Record<ModelKindOrUnknown, string> = {
  chat: 'Chat',
  video: 'Video',
  image: 'Image',
  audio: 'Audio',
  unknown: '未分类',
};

/**
 * Usage overview = three sections from one fetch:
 *   1. top KPIs (count / pass-fail / running) — neutral, kind-agnostic
 *   2. per-kind cards — each kind's billable unit in its own column
 *   3. per-model table — kind column drives which unit gets shown
 *
 * Tokens are intentionally NOT in the top KPI strip because they're only
 * meaningful for chat models. Mixing video seconds + tokens in a single
 * "Tokens" KPI was the bug we just fixed.
 */
export const UsagePage: React.FC = () => {
  const [range, setRange] = useState<Range>('today');
  const [data, setData] = useState<UsageOverview | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getUsageOverview(range)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err: unknown) => {
        if (!cancelled) toast.error(err instanceof Error ? err.message : '加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <h1 style={titleStyle}>概览</h1>
        <div style={rangeTabsStyle}>
          {(Object.keys(RANGE_LABELS) as Range[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              style={rangeTabStyle(r === range)}
            >
              {RANGE_LABELS[r]}
            </button>
          ))}
        </div>
      </header>

      {loading && !data && <div style={emptyStyle}>加载中…</div>}

      {data && (
        <>
          <section style={kpiGridStyle}>
            <KpiCard label="调用次数" value={String(data.totals.count)} />
            <KpiCard
              label="成功 / 失败"
              value={`${data.totals.countByStatus.COMPLETED} / ${data.totals.countByStatus.FAILED}`}
              accent={
                data.totals.countByStatus.FAILED > 0 ?
                  STATUS_COLOR.FAILED
                : STATUS_COLOR.COMPLETED
              }
            />
            <KpiCard label="进行中" value={String(data.totals.countByStatus.RUNNING)} />
          </section>

          <section>
            <h2 style={sectionTitleStyle}>按类型</h2>
            <div style={{ height: 8 }} />
            <KindCardGrid buckets={data.byKind} />
          </section>

          <section style={tableSectionStyle}>
            <h2 style={sectionTitleStyle}>按模型</h2>
            {data.byModel.length === 0 ?
              <div style={emptyStyle}>该时间范围内暂无调用</div>
            : <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>模型</th>
                    <th style={thStyle}>类型</th>
                    <th style={thNumStyle}>总调用</th>
                    <th style={thNumStyle}>成功</th>
                    <th style={thNumStyle}>失败</th>
                    <th style={thNumStyle}>成功率</th>
                    <th style={thStyle}>计价指标</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byModel.map((row) => {
                    const rate = row.count > 0 ? Math.round((row.completed / row.count) * 100) : 0;
                    return (
                      <tr key={row.modelName}>
                        <td style={tdStyle}>{row.modelName}</td>
                        <td style={tdStyle}>
                          <span style={kindPillStyle(row.kind)}>{KIND_LABEL[row.kind]}</span>
                        </td>
                        <td style={tdNumStyle}>{row.count}</td>
                        <td style={tdNumStyle}>{row.completed}</td>
                        <td style={tdNumStyle}>{row.failed}</td>
                        <td style={tdNumStyle}>
                          <span style={rateStyle(rate)}>{rate}%</span>
                        </td>
                        <td style={tdStyle}>{renderUnit(row)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            }
          </section>
        </>
      )}
    </div>
  );
};

const KpiCard: React.FC<{ label: string; value: string; accent?: string }> = ({
  label,
  value,
  accent,
}) => (
  <div style={kpiCardStyle}>
    <div style={kpiLabelStyle}>{label}</div>
    <div style={{ ...kpiValueStyle, color: accent ?? '#fff' }}>{value}</div>
  </div>
);

/**
 * Render the per-kind billable unit column. Kept as a render function (not
 * a component) because each cell is a single span — wrapping in <Component>
 * just adds a stack frame for no semantic benefit.
 */
function renderUnit(row: ModelRow): React.ReactNode {
  switch (row.kind) {
    case 'chat':
      return <span style={unitMonoStyle}>{`${formatNum(row.inputTokens)} → ${formatNum(row.outputTokens)} tokens`}</span>;
    case 'video':
    case 'audio':
      return (
        <span style={unitMonoStyle}>
          {row.outputDurationSec > 0 ? `${formatSeconds(row.outputDurationSec)}` : '—'}
        </span>
      );
    case 'image':
      return <span style={unitMonoStyle}>{row.outputCount > 0 ? `${row.outputCount} 张` : '—'}</span>;
    default:
      return <span style={{ ...unitMonoStyle, color: '#555' }}>—</span>;
  }
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

// ---- styles ---------------------------------------------------------------

const pageStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 24 };
const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};
const titleStyle: React.CSSProperties = { margin: 0, fontSize: 20, fontWeight: 600, color: '#fff' };
const rangeTabsStyle: React.CSSProperties = { display: 'flex', gap: 4 };
const rangeTabStyle = (active: boolean): React.CSSProperties => ({
  border: 'none',
  background: active ? 'rgba(255,255,255,0.08)' : 'transparent',
  color: active ? '#fff' : '#888',
  padding: '6px 12px',
  borderRadius: 6,
  fontSize: 12,
  cursor: 'pointer',
});

const kpiGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 12,
};
const kpiCardStyle: React.CSSProperties = {
  background: '#141414',
  border: '1px solid #1f1f1f',
  borderRadius: 10,
  padding: '14px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};
const kpiLabelStyle: React.CSSProperties = { color: '#888', fontSize: 12 };
const kpiValueStyle: React.CSSProperties = { fontSize: 22, fontWeight: 600 };

const tableSectionStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10 };
const sectionTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 14,
  color: '#bbb',
  fontWeight: 500,
};

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  background: '#141414',
  border: '1px solid #1f1f1f',
  borderRadius: 10,
  overflow: 'hidden',
};
const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 14px',
  fontWeight: 500,
  fontSize: 12,
  color: '#888',
  borderBottom: '1px solid #1f1f1f',
};
const thNumStyle: React.CSSProperties = { ...thStyle, textAlign: 'right' };
const tdStyle: React.CSSProperties = {
  padding: '10px 14px',
  fontSize: 13,
  color: '#ccc',
  borderTop: '1px solid #1a1a1a',
};
const tdNumStyle: React.CSSProperties = {
  ...tdStyle,
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
};

const unitMonoStyle: React.CSSProperties = {
  fontVariantNumeric: 'tabular-nums',
  fontSize: 12,
  color: '#bbb',
};

const KIND_PILL_COLOR: Record<ModelKindOrUnknown, string> = {
  chat: '#A8C7FA',
  video: '#D7BBFF',
  image: '#9BE39A',
  audio: '#FFD79A',
  unknown: '#666',
};

const kindPillStyle = (kind: ModelKindOrUnknown): React.CSSProperties => ({
  display: 'inline-block',
  padding: '2px 8px',
  fontSize: 11,
  borderRadius: 999,
  background: 'rgba(255,255,255,0.04)',
  color: KIND_PILL_COLOR[kind],
  fontWeight: 500,
  letterSpacing: 0.3,
});

const rateStyle = (rate: number): React.CSSProperties => ({
  color:
    rate >= 90 ? STATUS_COLOR.COMPLETED
    : rate >= 50 ? STATUS_COLOR.PENDING
    : STATUS_COLOR.FAILED,
  fontWeight: 500,
});

const emptyStyle: React.CSSProperties = {
  color: '#666',
  fontSize: 13,
  padding: '24px 0',
  textAlign: 'center',
};
