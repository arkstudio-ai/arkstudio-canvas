// Lightweight input modal replacing window.prompt().
//
// Electron 6+ disables window.prompt() in renderer processes (returns null
// immediately, no UI shown), so any feature that relied on it broke silently
// when we packaged the desktop build. This component covers the common
// "ask for one short string" case (canvas rename, voice rename, …).
//
// Style mirrors DetailModal: same scrim, same panel, same close affordances —
// keeps the look consistent across all our modal surfaces.

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface PromptModalProps {
  title: string;
  /** Initial input value — typically what the user is renaming. */
  defaultValue?: string;
  /** Hint shown under the title (optional). */
  description?: string;
  /** Placeholder when input is empty. */
  placeholder?: string;
  /** Confirm button label. Defaults to 「确定」. */
  confirmLabel?: string;
  /** Optional async validator. Return a string to surface as inline error. */
  validate?: (value: string) => string | null;
  /** Called with trimmed value on confirm. Returning a Promise blocks Confirm. */
  onConfirm: (value: string) => void | Promise<void>;
  onCancel: () => void;
}

export const PromptModal: React.FC<PromptModalProps> = ({
  title,
  defaultValue = '',
  description,
  placeholder,
  confirmLabel = '确定',
  validate,
  onConfirm,
  onCancel,
}) => {
  const [value, setValue] = useState(defaultValue);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Autofocus + select-all so the user can immediately overtype the existing
  // name (matches Finder's rename UX). Run once after first paint.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const close = () => {
    if (busy) return;
    onCancel();
  };

  const handleConfirm = async () => {
    if (busy) return;
    const trimmed = value.trim();
    const validationError = validate?.(trimmed) ?? null;
    if (validationError) {
      setError(validationError);
      return;
    }
    setBusy(true);
    try {
      await onConfirm(trimmed);
    } finally {
      // 即使 onConfirm 抛错, 让用户能改完再试; 父组件可以选择关掉 modal.
      setBusy(false);
    }
  };

  return createPortal(
    <div
      style={scrimStyle}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
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
            onClick={close}
            disabled={busy}
            title="取消 (Esc)"
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

        <div style={bodyStyle}>
          {description && <p style={descStyle}>{description}</p>}
          <input
            ref={inputRef}
            type="text"
            value={value}
            placeholder={placeholder}
            disabled={busy}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleConfirm();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                close();
              }
            }}
            style={{
              ...inputStyle,
              borderColor: error ? '#ff6b6b' : '#2a2d35',
            }}
          />
          {error && <span style={errorStyle}>{error}</span>}
        </div>

        <footer style={footerStyle}>
          <button
            type="button"
            onClick={close}
            disabled={busy}
            style={cancelBtnStyle}
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={busy}
            style={confirmBtnStyle}
          >
            {busy ? '处理中…' : confirmLabel}
          </button>
        </footer>
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
  width: 'min(420px, 90vw)',
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

const bodyStyle: React.CSSProperties = {
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const descStyle: React.CSSProperties = {
  margin: 0,
  color: '#8a8f98',
  fontSize: 12,
  lineHeight: 1.5,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  background: '#181a20',
  border: '1px solid #2a2d35',
  borderRadius: 8,
  color: '#e0e0e0',
  fontSize: 13,
  outline: 'none',
  transition: 'border-color 0.15s',
};

const errorStyle: React.CSSProperties = {
  color: '#ff6b6b',
  fontSize: 11,
};

const footerStyle: React.CSSProperties = {
  padding: '12px 16px',
  borderTop: '1px solid #1a1a1a',
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
};

const cancelBtnStyle: React.CSSProperties = {
  padding: '6px 14px',
  background: 'transparent',
  border: '1px solid #2a2d35',
  borderRadius: 8,
  color: '#cbd0d8',
  fontSize: 12,
  cursor: 'pointer',
};

const confirmBtnStyle: React.CSSProperties = {
  padding: '6px 14px',
  background: '#4f46e5',
  border: '1px solid #4f46e5',
  borderRadius: 8,
  color: '#fff',
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
};
