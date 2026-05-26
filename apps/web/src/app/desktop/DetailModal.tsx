// Generic "details" modal — shared by every list-item right-click flow
// (node / template / voice / history). One field-value pair per row, with
// optional copy-to-clipboard buttons for ids / urls.
//
// Why generic: the four entities surface very different fields, but each
// one wants the same UX (read-only key/value table + close + occasional
// copy). Dialog libraries we already pull in (Radix) work but bring their
// own focus-trap + scrim style we'd then have to override; a thin custom
// modal keeps it consistent with SettingsOverlay.

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Copy, X } from 'lucide-react';
import { toast } from 'sonner';

export interface DetailField {
  label: string;
  /** Stringified value. Renderers don't try to format dates / numbers /
   *  json — caller is responsible for `String(...)` / `JSON.stringify(...)`. */
  value: string;
  /** Show a small copy icon that copies `value` (or `copyValue` if set) to
   *  the clipboard. Useful for ids / URLs. */
  copyable?: boolean;
  /** Override what the copy button writes (defaults to `value`). */
  copyValue?: string;
  /** Render value with monospace font (good for ids / urls / hashes). */
  monospace?: boolean;
}

interface DetailModalProps {
  title: string;
  fields: DetailField[];
  onClose: () => void;
}

export const DetailModal: React.FC<DetailModalProps> = ({
  title,
  fields,
  onClose,
}) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const handleCopy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success('已复制');
    } catch {
      toast.error('复制失败');
    }
  };

  return createPortal(
    <div
      style={scrimStyle}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div style={panelStyle} onMouseDown={(e) => e.stopPropagation()}>
        <header style={headerStyle}>
          <span style={titleStyle}>{title}</span>
          <button
            type="button"
            onClick={onClose}
            title="关闭 (Esc)"
            style={closeBtnStyle}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
              e.currentTarget.style.color = '#fff';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = '#9aa0a6';
            }}
          >
            <X size={16} />
          </button>
        </header>

        <dl style={listStyle}>
          {fields.map((f, i) => (
            <div key={i} style={rowStyle}>
              <dt style={dtStyle}>{f.label}</dt>
              <dd style={ddStyle}>
                <span
                  style={{
                    ...valueStyle,
                    fontFamily: f.monospace
                      ? 'ui-monospace, SFMono-Regular, monospace'
                      : undefined,
                  }}
                >
                  {f.value || <span style={emptyStyle}>—</span>}
                </span>
                {f.copyable && f.value && (
                  <button
                    type="button"
                    onClick={() => void handleCopy(f.copyValue ?? f.value)}
                    title="复制"
                    style={copyBtnStyle}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = '#fff';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = '#5a5f68';
                    }}
                  >
                    <Copy size={12} />
                  </button>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>,
    document.body,
  );
};

const scrimStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.55)',
  backdropFilter: 'blur(2px)',
  zIndex: 1500,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const panelStyle: React.CSSProperties = {
  width: 'min(560px, 90vw)',
  maxHeight: '80vh',
  background: '#0d0d0d',
  borderRadius: 12,
  border: '1px solid #1f1f1f',
  boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '12px 16px',
  borderBottom: '1px solid #1a1a1a',
  flexShrink: 0,
};

const titleStyle: React.CSSProperties = {
  color: '#e0e0e0',
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: 0.4,
  textTransform: 'uppercase',
};

const closeBtnStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  border: 'none',
  borderRadius: 8,
  background: 'transparent',
  color: '#9aa0a6',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'background 0.15s, color 0.15s',
};

const listStyle: React.CSSProperties = {
  margin: 0,
  padding: 16,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '120px 1fr',
  gap: 12,
  alignItems: 'baseline',
};

const dtStyle: React.CSSProperties = {
  margin: 0,
  color: '#8a8f98',
  fontSize: 12,
  fontWeight: 500,
};

const ddStyle: React.CSSProperties = {
  margin: 0,
  display: 'flex',
  alignItems: 'flex-start',
  gap: 6,
  minWidth: 0,
};

const valueStyle: React.CSSProperties = {
  color: '#e0e0e0',
  fontSize: 13,
  lineHeight: 1.5,
  wordBreak: 'break-all',
  flex: 1,
  minWidth: 0,
};

const emptyStyle: React.CSSProperties = {
  color: '#5a5f68',
};

const copyBtnStyle: React.CSSProperties = {
  width: 20,
  height: 20,
  border: 'none',
  background: 'transparent',
  color: '#5a5f68',
  cursor: 'pointer',
  borderRadius: 4,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  transition: 'color 0.15s',
};
