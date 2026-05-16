// Shared inline styles for the asset-library drawer + its sub-components.
// Inline (vs. css module) per repo convention — DetailModal / PromptModal
// do the same so visual tweaks stay collocated with structure.

import type React from 'react';

export const scrimStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.5)',
  zIndex: 999,
};

export const drawerStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  right: 0,
  bottom: 0,
  width: 420,
  background: '#0d0d12',
  borderLeft: '1px solid rgba(255,255,255,0.08)',
  display: 'flex',
  flexDirection: 'column',
  zIndex: 1000,
  color: '#e8e8ea',
};

export const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '14px 16px',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
};

export const titleGroupStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};
export const titleStyle: React.CSSProperties = { fontSize: 14, fontWeight: 600 };
export const subtitleStyle: React.CSSProperties = { fontSize: 11, color: '#888' };

export const iconBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  borderRadius: 6,
  border: '1px solid rgba(255,255,255,0.08)',
  background: 'transparent',
  color: '#cfcfd2',
  cursor: 'pointer',
};

export const filterRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 16px',
  gap: 8,
};

export const chipGroupStyle: React.CSSProperties = { display: 'flex', gap: 6 };

export const chipStyle = (active: boolean): React.CSSProperties => ({
  padding: '4px 10px',
  borderRadius: 6,
  fontSize: 12,
  border: '1px solid ' + (active ? '#34d399' : 'rgba(255,255,255,0.08)'),
  background: active ? 'rgba(52,211,153,0.14)' : 'transparent',
  color: active ? '#34d399' : '#cfcfd2',
  cursor: 'pointer',
});

export const actionsGroupStyle: React.CSSProperties = { display: 'flex', gap: 6 };

export const primaryBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '6px 12px',
  borderRadius: 6,
  fontSize: 12,
  border: '1px solid #34d399',
  background: 'rgba(52,211,153,0.14)',
  color: '#34d399',
  cursor: 'pointer',
};

export const secondaryBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '6px 12px',
  borderRadius: 6,
  fontSize: 12,
  border: '1px solid rgba(255,255,255,0.1)',
  background: 'transparent',
  color: '#cfcfd2',
  cursor: 'pointer',
};

export const formStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: 16,
  borderBottom: '1px solid rgba(255,255,255,0.06)',
};
export const formRowStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
export const formLabelStyle: React.CSSProperties = { fontSize: 11, color: '#999' };
export const formInputStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid rgba(255,255,255,0.08)',
  background: '#1a1a20',
  color: '#e8e8ea',
  fontSize: 12,
};
export const formNoteStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#fbbf24',
  lineHeight: 1.5,
};
export const formActionsStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
};

export const listScrollStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '8px 16px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};
export const emptyStyle: React.CSSProperties = {
  padding: 24,
  textAlign: 'center',
  color: '#777',
  fontSize: 12,
  lineHeight: 1.7,
};

export const cardStyle: React.CSSProperties = {
  display: 'flex',
  gap: 10,
  padding: 10,
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.06)',
  background: 'rgba(255,255,255,0.02)',
};
export const cardThumbWrapStyle: React.CSSProperties = {
  width: 64,
  height: 64,
  borderRadius: 6,
  overflow: 'hidden',
  background: '#1a1a20',
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};
export const cardThumbImgStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
};
export const cardThumbPlaceholderStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#666',
};
export const cardBodyStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};
export const cardTitleRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 6,
};
export const cardTitleStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  flex: 1,
};
export const statusBadgeStyle: React.CSSProperties = {
  padding: '2px 6px',
  fontSize: 10,
  borderRadius: 4,
  flexShrink: 0,
};
export const cardUriStyle: React.CSSProperties = {
  fontSize: 10,
  color: '#777',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};
export const cardErrorStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#fca5a5',
  lineHeight: 1.5,
};
export const cardActionsStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  marginTop: 4,
};
export const smallBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 8px',
  fontSize: 11,
  borderRadius: 4,
  border: '1px solid rgba(255,255,255,0.08)',
  background: 'transparent',
  color: '#cfcfd2',
  cursor: 'pointer',
};
export const smallBtnDangerStyle: React.CSSProperties = {
  ...smallBtnStyle,
  color: '#fca5a5',
};
