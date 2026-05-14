import React from 'react';
import { X, AlertTriangle } from 'lucide-react';
import {
  buttonAccentStyle,
  buttonStyle,
  sectionTitleStyle,
  tokens,
} from '../styles';
import type { ConfigExportEnvelope, ImportConfigResponse } from '../../../types';

export interface ImportPreviewDialogProps {
  open: boolean;
  applying: boolean;
  fileName: string | null;
  envelope: ConfigExportEnvelope | null;
  preview: ImportConfigResponse | null;
  /** Last server's config_version for the "v? → v?+1" subtitle. */
  serverVersion: number;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Two-step import confirm modal.
 *
 * Lifecycle:
 *   - Page parses the chosen file → calls importCanvasConfig(env, 'preview')
 *   - Server returns ImportConfigResponse (no DB writes yet)
 *   - This dialog renders the summary + warnings + envelope provenance
 *   - On 確認 → page calls importCanvasConfig(env, 'apply') and reloads
 *
 * Why a dedicated dialog (vs reusing ConfirmSaveDialog): the diff axes are
 * different. Save shows label-level node-by-node lines; import shows a 4-bin
 * summary (added/updated/deleted/unchanged) because incoming envelopes
 * routinely touch every node, which would render hundreds of lines in
 * the save-style list. Plus we need to surface schema/version warnings
 * which save doesn't have.
 */
export const ImportPreviewDialog: React.FC<ImportPreviewDialogProps> = ({
  open,
  applying,
  fileName,
  envelope,
  preview,
  serverVersion,
  onCancel,
  onConfirm,
}) => {
  if (!open) return null;
  const summary = preview?.summary;
  const totalChange = summary
    ? summary.nodesAdded + summary.nodesUpdated + summary.nodesDeleted
    : 0;

  return (
    <>
      <div style={overlayStyle} onClick={applying ? undefined : onCancel} />
      <aside style={dialogStyle}>
        <header style={headerStyle}>
          <div>
            <div style={titleStyle}>导入预览</div>
            <div style={subtitleStyle}>
              {envelope ? (
                <>
                  来源 v{envelope.exportedFromVersion} · 当前 v{serverVersion}
                  {' → '}
                  导入后变为 v{serverVersion + 1}
                </>
              ) : (
                '尚未读取文件'
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            style={closeBtnStyle}
            title="关闭"
            disabled={applying}
          >
            <X size={16} />
          </button>
        </header>

        {fileName && (
          <div style={fileNameStyle}>
            文件: <code>{fileName}</code>
            {envelope && (
              <span style={fileMetaStyle}>
                · 导出于 {new Date(envelope.exportedAt).toLocaleString()}
              </span>
            )}
          </div>
        )}

        {summary && (
          <section>
            <h3 style={sectionTitleStyle}>变更摘要</h3>
            <div style={summaryGridStyle}>
              <SummaryCell label="新增" count={summary.nodesAdded} accent="add" />
              <SummaryCell label="修改" count={summary.nodesUpdated} accent="modify" />
              <SummaryCell label="删除" count={summary.nodesDeleted} accent="delete" />
              <SummaryCell label="不变" count={summary.nodesUnchanged} accent="muted" />
            </div>
            {totalChange === 0 && (
              <div style={emptyStyle}>没有任何变更——envelope 与当前 DB 完全一致。</div>
            )}
          </section>
        )}

        {preview && preview.warnings.length > 0 && (
          <section>
            <h3 style={sectionTitleStyle}>
              <AlertTriangle size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              提醒 ({preview.warnings.length})
            </h3>
            <ul style={warningListStyle}>
              {preview.warnings.map((w, i) => (
                <li key={i} style={warningItemStyle}>
                  {w}
                </li>
              ))}
            </ul>
          </section>
        )}

        <footer style={footerStyle}>
          <button type="button" onClick={onCancel} style={buttonStyle} disabled={applying}>
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            style={buttonAccentStyle}
            disabled={applying || !preview || totalChange === 0}
          >
            {applying ? '导入中…' : `确认导入到 v${serverVersion + 1}`}
          </button>
        </footer>
      </aside>
    </>
  );
};

interface SummaryCellProps {
  label: string;
  count: number;
  accent: 'add' | 'modify' | 'delete' | 'muted';
}

const SummaryCell: React.FC<SummaryCellProps> = ({ label, count, accent }) => {
  const color =
    accent === 'add'
      ? '#22c55e'
      : accent === 'modify'
      ? '#f59e0b'
      : accent === 'delete'
      ? '#ef4444'
      : tokens.textMuted;
  return (
    <div style={cellStyle}>
      <div style={{ ...cellNumberStyle, color }}>{count}</div>
      <div style={cellLabelStyle}>{label}</div>
    </div>
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

const fileNameStyle: React.CSSProperties = {
  fontSize: 12,
  color: tokens.textSecondary,
  background: tokens.bgCard,
  border: `1px solid ${tokens.border}`,
  borderRadius: 6,
  padding: '8px 10px',
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  wordBreak: 'break-all',
};

const fileMetaStyle: React.CSSProperties = {
  marginLeft: 6,
  color: tokens.textMuted,
};

const summaryGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, 1fr)',
  gap: 8,
};

const cellStyle: React.CSSProperties = {
  background: tokens.bgCard,
  border: `1px solid ${tokens.border}`,
  borderRadius: 8,
  padding: '12px 8px',
  textAlign: 'center',
};

const cellNumberStyle: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 600,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  lineHeight: 1.2,
};

const cellLabelStyle: React.CSSProperties = {
  fontSize: 11,
  color: tokens.textMuted,
  marginTop: 4,
};

const emptyStyle: React.CSSProperties = {
  color: tokens.textFaint,
  fontSize: 12,
  padding: '8px 0',
};

const warningListStyle: React.CSSProperties = {
  margin: 0,
  padding: 0,
  listStyle: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const warningItemStyle: React.CSSProperties = {
  padding: '8px 10px',
  background: 'rgba(245, 158, 11, 0.08)',
  border: '1px solid rgba(245, 158, 11, 0.3)',
  borderRadius: 6,
  fontSize: 12,
  color: tokens.textSecondary,
  lineHeight: 1.5,
};

const footerStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  justifyContent: 'flex-end',
  marginTop: 4,
};
