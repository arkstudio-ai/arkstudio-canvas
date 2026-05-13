import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import {
  buttonGhostStyle,
  emptyStyle,
  fieldLabelStyle,
  fieldRowStyle,
  inputStyle,
  inputMonoStyle,
  tokens,
} from '../styles';
import { ChipMultiSelect } from './ChipMultiSelect';
import { KeyValueEditor } from './KeyValueEditor';
import { ParamsSchemaEditor, type ParamFieldSpec } from './ParamsSchemaEditor';

/**
 * Loose ModeEntry mirror; permissive on purpose so a half-typed mode
 * ("id only") doesn't blow up the editor mid-edit.
 */
export interface ModeEntry {
  id: string;
  label: string;
  sku: string;
  action?: string;
  acceptUpstreamTypes: string[];
  paramsSchemaOverride?: ParamFieldSpec[];
  defaultParamsOverride?: Record<string, unknown>;
}

export interface ModesEditorProps {
  value: ModeEntry[];
  onChange: (next: ModeEntry[]) => void;
}

const UPSTREAM_PRESETS = ['text', 'image', 'video', 'audio'];

/**
 * Editor for `model.modes[]` (only video family models use this).
 * Each mode is collapsible; the body exposes acceptUpstreamTypes /
 * paramsSchemaOverride / defaultParamsOverride sub-editors.
 */
export const ModesEditor: React.FC<ModesEditorProps> = ({ value, onChange }) => {
  const updateMode = (i: number, patch: Partial<ModeEntry>) => {
    const next = value.slice();
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };

  const removeMode = (i: number) => {
    const next = value.slice();
    next.splice(i, 1);
    onChange(next);
  };

  const addMode = () => {
    onChange([
      ...value,
      {
        id: '',
        label: '',
        sku: '',
        action: undefined,
        acceptUpstreamTypes: [],
      },
    ]);
  };

  return (
    <div style={containerStyle}>
      {value.length === 0 && <div style={emptyStyle}>该模型无子模式</div>}
      {value.map((mode, i) => (
        <ModeCard
          key={i}
          mode={mode}
          onChange={(patch) => updateMode(i, patch)}
          onRemove={() => removeMode(i)}
        />
      ))}
      <button type="button" onClick={addMode} style={buttonGhostStyle}>
        <Plus size={12} style={{ verticalAlign: 'middle' }} /> 新增模式
      </button>
    </div>
  );
};

const ModeCard: React.FC<{
  mode: ModeEntry;
  onChange: (patch: Partial<ModeEntry>) => void;
  onRemove: () => void;
}> = ({ mode, onChange, onRemove }) => {
  const [open, setOpen] = useState(true);
  return (
    <div style={cardStyle}>
      <div style={cardHeaderStyle}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          style={collapseBtnStyle}
          title={open ? '收起' : '展开'}
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <input
          value={mode.id}
          onChange={(e) => onChange({ id: e.target.value })}
          placeholder="mode id (e.g. t2v)"
          style={{ ...inputMonoStyle, flex: '0 0 130px' }}
        />
        <input
          value={mode.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="模式标签"
          style={{ ...inputStyle, flex: '0 0 140px' }}
        />
        <input
          value={mode.sku}
          onChange={(e) => onChange({ sku: e.target.value })}
          placeholder="DashScope SKU"
          style={{ ...inputMonoStyle, flex: 1 }}
        />
        <button type="button" onClick={onRemove} style={removeBtnStyle} title="删除模式">
          <Trash2 size={12} />
        </button>
      </div>

      {open && (
        <div style={bodyStyle}>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>action</span>
            <input
              value={mode.action ?? ''}
              onChange={(e) => onChange({ action: e.target.value || undefined })}
              placeholder="覆盖 family.action（可空）"
              style={inputMonoStyle}
            />
          </div>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>acceptUpstreamTypes</span>
            <ChipMultiSelect
              value={mode.acceptUpstreamTypes ?? []}
              presets={UPSTREAM_PRESETS}
              onChange={(next) => onChange({ acceptUpstreamTypes: next })}
            />
          </div>
          <SubSection title="paramsSchemaOverride">
            <ParamsSchemaEditor
              value={mode.paramsSchemaOverride ?? []}
              onChange={(next) =>
                onChange({ paramsSchemaOverride: next.length > 0 ? next : undefined })
              }
              emptyHint="无 override（继承 family.paramsSchema）"
            />
          </SubSection>
          <SubSection title="defaultParamsOverride">
            <KeyValueEditor
              value={(mode.defaultParamsOverride ?? {}) as Record<string, unknown>}
              onChange={(next) =>
                onChange({
                  defaultParamsOverride:
                    Object.keys(next).length > 0 ? next : undefined,
                })
              }
            />
          </SubSection>
        </div>
      )}
    </div>
  );
};

const SubSection: React.FC<{ title: string; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <div style={subSectionStyle}>
    <div style={subSectionTitleStyle}>{title}</div>
    {children}
  </div>
);

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const cardStyle: React.CSSProperties = {
  background: tokens.bgCardSoft,
  border: `1px solid ${tokens.border}`,
  borderRadius: 8,
  padding: 10,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const cardHeaderStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  alignItems: 'center',
};

const collapseBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: tokens.textMuted,
  cursor: 'pointer',
  padding: 2,
  display: 'inline-flex',
  alignItems: 'center',
};

const removeBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 26,
  height: 26,
  border: `1px solid ${tokens.borderStrong}`,
  borderRadius: 6,
  background: 'transparent',
  color: tokens.textMuted,
  cursor: 'pointer',
  flexShrink: 0,
};

const bodyStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  paddingLeft: 22,
  borderLeft: `2px solid ${tokens.border}`,
  marginLeft: 6,
};

const subSectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const subSectionTitleStyle: React.CSSProperties = {
  fontSize: 11,
  color: tokens.textMuted,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
};
