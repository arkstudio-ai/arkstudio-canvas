import React, { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { tokens } from '../styles';

export interface ChipMultiSelectProps {
  /** Currently selected values (display order = render order). */
  value: string[];
  /** Available presets shown as `+ presetLabel` quick-add buttons. */
  presets?: string[];
  /** Called with the next array; never mutated in place. */
  onChange: (next: string[]) => void;
  /** Allow the user to type a custom value not in `presets`. */
  allowCustom?: boolean;
  /** Placeholder for the custom-value input. */
  placeholder?: string;
}

/**
 * Multi-select rendered as removable chips + quick-add presets.
 *
 * Used for `acceptUpstreamTypes` (preset = ['text','image','video','audio']),
 * `allowedUpstreamTypes` (same), `enabledForModes` (preset = the parent
 * model's mode ids — passed in by caller). For `enabledForModes` an empty
 * array means "all modes" (matches the runtime semantics).
 */
export const ChipMultiSelect: React.FC<ChipMultiSelectProps> = ({
  value,
  presets = [],
  onChange,
  allowCustom = false,
  placeholder = '自定义...',
}) => {
  const [draft, setDraft] = useState('');
  const remaining = presets.filter((p) => !value.includes(p));

  const add = (v: string) => {
    const trimmed = v.trim();
    if (!trimmed || value.includes(trimmed)) return;
    onChange([...value, trimmed]);
  };

  const remove = (v: string) => {
    onChange(value.filter((x) => x !== v));
  };

  return (
    <div style={containerStyle}>
      {value.length === 0 && remaining.length === 0 && !allowCustom && (
        <span style={emptyStyle}>（空）</span>
      )}
      {value.map((v) => (
        <span key={v} style={chipStyle}>
          {v}
          <button type="button" onClick={() => remove(v)} style={removeBtnStyle} title="移除">
            <X size={11} />
          </button>
        </span>
      ))}
      {remaining.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => add(p)}
          style={presetBtnStyle}
          title={`添加 ${p}`}
        >
          <Plus size={10} /> {p}
        </button>
      ))}
      {allowCustom && (
        <span style={customWrapStyle}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add(draft);
                setDraft('');
              }
            }}
            placeholder={placeholder}
            style={customInputStyle}
          />
          <button
            type="button"
            disabled={!draft.trim()}
            onClick={() => {
              add(draft);
              setDraft('');
            }}
            style={customAddBtnStyle}
          >
            <Plus size={11} />
          </button>
        </span>
      )}
    </div>
  );
};

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
  alignItems: 'center',
  flex: 1,
  minWidth: 0,
};

const chipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '3px 4px 3px 8px',
  fontSize: 11,
  borderRadius: 999,
  background: tokens.bgChipHover,
  color: tokens.textPrimary,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
};

const removeBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 16,
  height: 16,
  borderRadius: '50%',
  border: 'none',
  background: 'transparent',
  color: tokens.textMuted,
  cursor: 'pointer',
  padding: 0,
};

const presetBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  padding: '3px 8px',
  fontSize: 11,
  borderRadius: 999,
  background: 'transparent',
  border: `1px dashed ${tokens.borderStrong}`,
  color: tokens.textMuted,
  cursor: 'pointer',
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
};

const customWrapStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
};

const customInputStyle: React.CSSProperties = {
  background: tokens.bgInput,
  border: `1px solid ${tokens.border}`,
  borderRadius: 6,
  padding: '3px 8px',
  fontSize: 11,
  color: tokens.textPrimary,
  width: 120,
  fontFamily: 'inherit',
};

const customAddBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 22,
  height: 22,
  border: `1px solid ${tokens.borderStrong}`,
  borderRadius: 6,
  background: tokens.bgChip,
  color: tokens.textSecondary,
  cursor: 'pointer',
  padding: 0,
};

const emptyStyle: React.CSSProperties = {
  color: tokens.textFaint,
  fontSize: 11,
};
