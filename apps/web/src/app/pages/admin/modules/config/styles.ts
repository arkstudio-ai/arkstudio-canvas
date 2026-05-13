import type { CSSProperties } from 'react';

/**
 * Shared dark-theme tokens for the canvas-config admin editor.
 * Colors mirror UsagePage / LogDrawer so the editor blends with the rest
 * of the admin shell without re-defining the palette per file.
 */
export const tokens = {
  bgPage: '#070707',
  bgCard: '#141414',
  bgCardSoft: '#0d0d0d',
  bgInput: '#0a0a0a',
  bgChip: 'rgba(255,255,255,0.04)',
  bgChipHover: 'rgba(255,255,255,0.08)',
  bgAccent: 'rgba(168,199,250,0.12)',
  border: '#1f1f1f',
  borderStrong: '#2a2a2a',
  borderAccent: '#A8C7FA',
  textPrimary: '#fff',
  textSecondary: '#bbb',
  textMuted: '#888',
  textFaint: '#555',
  accent: '#A8C7FA',
  ok: '#9BE39A',
  warn: '#E6C893',
  err: '#FFB4AB',
};

export const sectionTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: 12,
  color: tokens.textMuted,
  fontWeight: 500,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
};

export const sectionStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

export const sectionBodyStyle: CSSProperties = {
  background: tokens.bgCard,
  border: `1px solid ${tokens.border}`,
  borderRadius: 8,
  padding: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

export const fieldRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  fontSize: 12,
};

export const fieldLabelStyle: CSSProperties = {
  color: tokens.textMuted,
  minWidth: 110,
  flexShrink: 0,
};

export const inputStyle: CSSProperties = {
  flex: 1,
  background: tokens.bgInput,
  border: `1px solid ${tokens.border}`,
  borderRadius: 6,
  padding: '6px 10px',
  color: tokens.textPrimary,
  fontSize: 12,
  fontFamily: 'inherit',
  minWidth: 0,
};

export const inputMonoStyle: CSSProperties = {
  ...inputStyle,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  fontSize: 11,
};

export const buttonStyle: CSSProperties = {
  background: tokens.bgChip,
  border: `1px solid ${tokens.borderStrong}`,
  borderRadius: 6,
  color: tokens.textSecondary,
  fontSize: 12,
  padding: '6px 12px',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

export const buttonAccentStyle: CSSProperties = {
  ...buttonStyle,
  background: tokens.bgAccent,
  border: `1px solid ${tokens.accent}`,
  color: tokens.accent,
};

export const buttonGhostStyle: CSSProperties = {
  ...buttonStyle,
  background: 'transparent',
  border: `1px dashed ${tokens.borderStrong}`,
  color: tokens.textMuted,
};

export const buttonDangerStyle: CSSProperties = {
  ...buttonStyle,
  color: tokens.err,
  borderColor: 'rgba(255,180,171,0.4)',
};

export const tabBarStyle: CSSProperties = {
  display: 'flex',
  gap: 4,
  borderBottom: `1px solid ${tokens.border}`,
  paddingBottom: 0,
};

export const tabStyle = (active: boolean): CSSProperties => ({
  border: 'none',
  background: 'transparent',
  color: active ? tokens.textPrimary : tokens.textMuted,
  borderBottom: `2px solid ${active ? tokens.accent : 'transparent'}`,
  padding: '8px 14px',
  fontSize: 13,
  fontWeight: active ? 600 : 400,
  cursor: 'pointer',
  fontFamily: 'inherit',
  marginBottom: -1,
});

export const emptyStyle: CSSProperties = {
  color: tokens.textFaint,
  fontSize: 12,
  padding: '12px 0',
  textAlign: 'center',
};

export const codeBlockStyle: CSSProperties = {
  margin: 0,
  background: tokens.bgInput,
  border: `1px solid ${tokens.border}`,
  borderRadius: 6,
  padding: 10,
  fontSize: 11,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  color: tokens.textSecondary,
  overflow: 'auto',
  maxHeight: 400,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
};
