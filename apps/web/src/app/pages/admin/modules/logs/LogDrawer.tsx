import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { getExecutionDetail } from '../../api/admin-api';
import type { ExecutionDetail, ExecutionPhase } from '../../types';

const PHASE_DOT: Record<ExecutionPhase, string> = {
  submitting: '#A8C7FA',
  submitted: '#A8C7FA',
  polling: '#E6C893',
  completed: '#9BE39A',
  failed: '#FFB4AB',
};

export interface LogDrawerProps {
  executionId: string | null;
  onClose: () => void;
}

/**
 * Right-side detail drawer for a single execution.
 * Lazy-loads the detail (with events) only when an id is provided.
 */
export const LogDrawer: React.FC<LogDrawerProps> = ({ executionId, onClose }) => {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<ExecutionDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!executionId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setDetail(null);
    getExecutionDetail(executionId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((err: unknown) => {
        if (!cancelled) toast.error(err instanceof Error ? err.message : t('settings:logs.drawer.toastLoadFailed'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [executionId, t]);

  if (!executionId) return null;

  return (
    <>
      <div style={overlayStyle} onClick={onClose} />
      <aside style={drawerStyle}>
        <header style={headerStyle}>
          <div>
            <div style={titleStyle}>{t('settings:logs.drawer.title')}</div>
            <div style={subtitleStyle}>{executionId}</div>
          </div>
          <button type="button" onClick={onClose} style={closeBtnStyle} title={t('settings:logs.drawer.closeTitle')}>
            <X size={16} />
          </button>
        </header>

        {loading && <div style={emptyStyle}>{t('settings:common.loading')}</div>}

        {detail && (
          <>
            <Section label={t('settings:logs.drawer.basicInfo')}>
              <Field label={t('settings:logs.drawer.fieldStatus')} value={detail.status} />
              <Field label={t('settings:logs.drawer.fieldPhase')} value={detail.phase ?? '—'} />
              <Field label={t('settings:logs.drawer.fieldModelSku')} value={detail.modelSku ?? '—'} />
              <Field label={t('settings:logs.drawer.fieldModeId')} value={detail.modeId ?? '—'} />
              <Field label={t('settings:logs.drawer.fieldLatency')} value={detail.latencyMs != null ? `${(detail.latencyMs / 1000).toFixed(2)}s` : '—'} />
              <Field
                label={t('settings:logs.drawer.fieldTokens')}
                value={
                  detail.inputTokens != null || detail.outputTokens != null ?
                    `${detail.inputTokens ?? 0} / ${detail.outputTokens ?? 0}`
                  : '—'
                }
              />
              <Field label={t('settings:logs.drawer.fieldExternalTaskId')} value={detail.externalTaskId ?? '—'} mono />
              {detail.errorMsg ?
                <Field label={t('settings:logs.drawer.fieldErrorMsg')} value={detail.errorMsg} accent="#FFB4AB" />
              : null}
            </Section>

            <Section label={t('settings:logs.drawer.timelineTitle', { count: detail.events.length })}>
              {detail.events.length === 0 ?
                <div style={emptyStyle}>{t('settings:logs.drawer.noEvents')}</div>
              : <ol style={timelineStyle}>
                  {detail.events.map((e) => (
                    <li key={e.id} style={timelineItemStyle}>
                      <span style={{ ...timelineDotStyle, background: PHASE_DOT[e.phase] }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={timelineHeadStyle}>
                          <span style={{ color: PHASE_DOT[e.phase] }}>{e.phase}</span>
                          {e.attempt != null && <span style={attemptStyle}>#{e.attempt}</span>}
                          {e.externalStatus && <span style={attemptStyle}>{e.externalStatus}</span>}
                          <span style={timeStyle}>{formatRelative(e.createdAt, detail.createdAt)}</span>
                        </div>
                        {e.message && <div style={messageStyle}>{e.message}</div>}
                        {e.payloadSnippet ?
                          <PayloadBlock value={e.payloadSnippet} />
                        : null}
                      </div>
                    </li>
                  ))}
                </ol>
              }
            </Section>

            {detail.requestPayload ?
              <Section label={t('settings:logs.drawer.requestPayload')}>
                <PayloadBlock value={detail.requestPayload} />
              </Section>
            : null}

            {detail.responsePayload ?
              <Section label={t('settings:logs.drawer.responsePayload')}>
                <PayloadBlock value={detail.responsePayload} />
              </Section>
            : null}
          </>
        )}
      </aside>
    </>
  );
};

const Section: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <section style={sectionStyle}>
    <h3 style={sectionTitleStyle}>{label}</h3>
    <div style={sectionBodyStyle}>{children}</div>
  </section>
);

const Field: React.FC<{ label: string; value: string; mono?: boolean; accent?: string }> = ({
  label,
  value,
  mono,
  accent,
}) => (
  <div style={fieldRowStyle}>
    <span style={fieldLabelStyle}>{label}</span>
    <span
      style={{
        ...(mono ? fieldValueMonoStyle : fieldValueStyle),
        ...(accent ? { color: accent } : {}),
      }}
    >
      {value}
    </span>
  </div>
);

const PayloadBlock: React.FC<{ value: unknown }> = ({ value }) => {
  let text: string;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  return <pre style={preStyle}>{text}</pre>;
};

function formatRelative(iso: string, baseIso: string): string {
  const d = new Date(iso).getTime();
  const base = new Date(baseIso).getTime();
  const diff = Math.max(0, d - base);
  if (diff < 1000) return `+${diff}ms`;
  return `+${(diff / 1000).toFixed(2)}s`;
}

// ---- styles ---------------------------------------------------------------

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.45)',
  zIndex: 90,
};
const drawerStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  right: 0,
  bottom: 0,
  width: 'min(640px, 92vw)',
  background: '#0d0d0d',
  borderLeft: '1px solid #1f1f1f',
  zIndex: 100,
  overflowY: 'auto',
  padding: 20,
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
};
const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
};
const titleStyle: React.CSSProperties = { color: '#fff', fontSize: 16, fontWeight: 600 };
const subtitleStyle: React.CSSProperties = {
  color: '#666',
  fontSize: 11,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  marginTop: 4,
};
const closeBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid #2a2a2a',
  borderRadius: 6,
  padding: 6,
  color: '#999',
  cursor: 'pointer',
};

const sectionStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 };
const sectionTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  color: '#888',
  fontWeight: 500,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
};
const sectionBodyStyle: React.CSSProperties = {
  background: '#141414',
  border: '1px solid #1f1f1f',
  borderRadius: 8,
  padding: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const fieldRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  fontSize: 12,
};
const fieldLabelStyle: React.CSSProperties = { color: '#888', minWidth: 110 };
const fieldValueStyle: React.CSSProperties = { color: '#ddd', flex: 1, wordBreak: 'break-all' };
const fieldValueMonoStyle: React.CSSProperties = {
  ...fieldValueStyle,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  fontSize: 11,
};

const timelineStyle: React.CSSProperties = {
  margin: 0,
  padding: 0,
  listStyle: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
};
const timelineItemStyle: React.CSSProperties = { display: 'flex', gap: 10, alignItems: 'flex-start' };
const timelineDotStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: '50%',
  marginTop: 5,
  flexShrink: 0,
};
const timelineHeadStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'baseline',
  flexWrap: 'wrap',
  fontSize: 12,
  fontWeight: 500,
};
const attemptStyle: React.CSSProperties = { color: '#888', fontSize: 11, fontWeight: 400 };
const timeStyle: React.CSSProperties = { color: '#555', fontSize: 11, fontWeight: 400 };
const messageStyle: React.CSSProperties = { color: '#aaa', fontSize: 12, marginTop: 4, wordBreak: 'break-word' };

const preStyle: React.CSSProperties = {
  margin: 0,
  background: '#0a0a0a',
  border: '1px solid #1f1f1f',
  borderRadius: 6,
  padding: 10,
  fontSize: 11,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  color: '#bbb',
  overflow: 'auto',
  maxHeight: 300,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
};
const emptyStyle: React.CSSProperties = { color: '#666', fontSize: 12, padding: '12px 0' };
