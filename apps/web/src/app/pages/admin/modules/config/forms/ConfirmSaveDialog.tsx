import React from 'react';
import { X } from 'lucide-react';
import {
  buttonAccentStyle,
  buttonStyle,
  codeBlockStyle,
  sectionTitleStyle,
  tokens,
} from '../styles';
import type { CanvasConfigPayload } from '../../../types';
import { computeDiffSummary } from '../state/diff';

export interface ConfirmSaveDialogProps {
  open: boolean;
  base: CanvasConfigPayload;
  draft: CanvasConfigPayload;
  saving: boolean;
  serverVersion: number;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Modal that lists what's about to change before sending PUT.
 *
 * Shown summary lines come from `computeDiffSummary(base, draft)`. If
 * nothing changed (shouldn't happen; the [Save] button is disabled
 * when !isDirty) we still render the dialog so the operator sees the
 * "no changes" hint instead of silently submitting.
 */
export const ConfirmSaveDialog: React.FC<ConfirmSaveDialogProps> = ({
  open,
  base,
  draft,
  saving,
  serverVersion,
  onCancel,
  onConfirm,
}) => {
  if (!open) return null;
  const diff = computeDiffSummary(base, draft);

  return (
    <>
      <div style={overlayStyle} onClick={saving ? undefined : onCancel} />
      <aside style={dialogStyle}>
        <header style={headerStyle}>
          <div>
            <div style={titleStyle}>确认保存</div>
            <div style={subtitleStyle}>
              当前服务器版本 v{serverVersion} → 保存后变为 v{serverVersion + 1}
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            style={closeBtnStyle}
            title="关闭"
            disabled={saving}
          >
            <X size={16} />
          </button>
        </header>

        <section>
          <h3 style={sectionTitleStyle}>变更摘要 ({diff.length})</h3>
          {diff.length === 0 ?
            <div style={emptyStyle}>无差异</div>
          : <ul style={listStyle}>
              {diff.map((line, i) => (
                <li key={i} style={lineStyle}>
                  {line}
                </li>
              ))}
            </ul>
          }
        </section>

        <details style={detailsStyle}>
          <summary style={summaryStyle}>完整 JSON diff（高级）</summary>
          <pre style={codeBlockStyle}>
{JSON.stringify(
  {
    nodeDefinitions: draft.nodeDefinitions.map((n: any) => n.type),
  },
  null,
  2,
)}
          </pre>
        </details>

        <footer style={footerStyle}>
          <button type="button" onClick={onCancel} style={buttonStyle} disabled={saving}>
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            style={buttonAccentStyle}
            disabled={saving || diff.length === 0}
          >
            {saving ? '保存中…' : `确认保存到 v${serverVersion + 1}`}
          </button>
        </footer>
      </aside>
    </>
  );
};

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.55)',
  zIndex: 200,
};

const dialogStyle: React.CSSProperties = {
  position: 'fixed',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: 'min(560px, 92vw)',
  maxHeight: '80vh',
  background: tokens.bgCardSoft,
  border: `1px solid ${tokens.borderStrong}`,
  borderRadius: 12,
  zIndex: 210,
  padding: 20,
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  overflow: 'auto',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
};

const titleStyle: React.CSSProperties = {
  color: tokens.textPrimary,
  fontSize: 16,
  fontWeight: 600,
};

const subtitleStyle: React.CSSProperties = {
  color: tokens.textMuted,
  fontSize: 11,
  marginTop: 4,
};

const closeBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: `1px solid ${tokens.borderStrong}`,
  borderRadius: 6,
  padding: 6,
  color: tokens.textMuted,
  cursor: 'pointer',
};

const listStyle: React.CSSProperties = {
  margin: 0,
  padding: 0,
  listStyle: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  maxHeight: 220,
  overflow: 'auto',
};

const lineStyle: React.CSSProperties = {
  padding: '6px 10px',
  background: tokens.bgCard,
  border: `1px solid ${tokens.border}`,
  borderRadius: 6,
  fontSize: 12,
  color: tokens.textSecondary,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  wordBreak: 'break-all',
};

const emptyStyle: React.CSSProperties = {
  color: tokens.textFaint,
  fontSize: 12,
  padding: '8px 0',
};

const detailsStyle: React.CSSProperties = {
  fontSize: 11,
  color: tokens.textMuted,
};

const summaryStyle: React.CSSProperties = {
  cursor: 'pointer',
  padding: '4px 0',
};

const footerStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  justifyContent: 'flex-end',
  marginTop: 4,
};
