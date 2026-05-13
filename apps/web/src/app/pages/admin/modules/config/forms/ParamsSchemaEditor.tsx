import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import {
  buttonGhostStyle,
  emptyStyle,
  inputStyle,
  inputMonoStyle,
  tokens,
} from '../styles';
import { ChipMultiSelect } from './ChipMultiSelect';

/**
 * Loose mirror of @canvas-flow/core ParamFieldSpec / ParamFieldOption,
 * kept local + permissive so the editor can save partial drafts without
 * fighting the library's strict types.
 */
export interface ParamFieldOption {
  label: string;
  value: string;
  enabledForModes?: string[];
}

export interface ParamFieldSpec {
  key: string;
  label: string;
  type: 'select';
  defaultValue?: string;
  options: ParamFieldOption[];
}

export interface ParamsSchemaEditorProps {
  value: ParamFieldSpec[];
  onChange: (next: ParamFieldSpec[]) => void;
  /** Mode ids available to gate options with `enabledForModes`. */
  availableModeIds?: string[];
  /** Hint shown when the schema is empty (e.g. "此模型无参数"). */
  emptyHint?: string;
}

/**
 * Editor for `model.paramsSchema[]` (or `mode.paramsSchemaOverride[]`).
 *
 * Each schema row is collapsible; only the row body shows the option
 * sub-editor. The `enabledForModes` chip uses `availableModeIds` so users
 * pick from the actual modes defined on the parent model.
 */
export const ParamsSchemaEditor: React.FC<ParamsSchemaEditorProps> = ({
  value,
  onChange,
  availableModeIds = [],
  emptyHint = '该模型无 paramsSchema',
}) => {
  const updateField = (index: number, patch: Partial<ParamFieldSpec>) => {
    const next = value.slice();
    next[index] = { ...next[index], ...patch };
    onChange(next);
  };

  const removeField = (index: number) => {
    const next = value.slice();
    next.splice(index, 1);
    onChange(next);
  };

  const addField = () => {
    onChange([
      ...value,
      { key: '', label: '', type: 'select', options: [], defaultValue: undefined },
    ]);
  };

  return (
    <div style={containerStyle}>
      {value.length === 0 && <div style={emptyStyle}>{emptyHint}</div>}
      {value.map((field, i) => (
        <SchemaFieldCard
          key={i}
          field={field}
          availableModeIds={availableModeIds}
          onChange={(patch) => updateField(i, patch)}
          onRemove={() => removeField(i)}
        />
      ))}
      <button type="button" onClick={addField} style={buttonGhostStyle}>
        <Plus size={12} style={{ verticalAlign: 'middle' }} /> 新增字段
      </button>
    </div>
  );
};

const SchemaFieldCard: React.FC<{
  field: ParamFieldSpec;
  availableModeIds: string[];
  onChange: (patch: Partial<ParamFieldSpec>) => void;
  onRemove: () => void;
}> = ({ field, availableModeIds, onChange, onRemove }) => {
  const [open, setOpen] = useState(true);

  const updateOption = (i: number, patch: Partial<ParamFieldOption>) => {
    const next = field.options.slice();
    next[i] = { ...next[i], ...patch };
    onChange({ options: next });
  };

  const removeOption = (i: number) => {
    const next = field.options.slice();
    next.splice(i, 1);
    onChange({ options: next });
  };

  const addOption = () => {
    onChange({ options: [...field.options, { label: '', value: '' }] });
  };

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
          value={field.key}
          onChange={(e) => onChange({ key: e.target.value })}
          placeholder="key (e.g. aspectRatio)"
          style={{ ...inputMonoStyle, flex: '0 0 180px' }}
        />
        <input
          value={field.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="label"
          style={{ ...inputStyle, flex: '0 0 140px' }}
        />
        <input
          value={field.defaultValue ?? ''}
          onChange={(e) => onChange({ defaultValue: e.target.value || undefined })}
          placeholder="defaultValue"
          style={{ ...inputMonoStyle, flex: 1 }}
        />
        <button type="button" onClick={onRemove} style={removeBtnStyle} title="删除字段">
          <Trash2 size={12} />
        </button>
      </div>

      {open && (
        <div style={optionsBlockStyle}>
          <div style={optionsHeadStyle}>
            <span>options ({field.options.length})</span>
            <button type="button" onClick={addOption} style={buttonGhostStyle}>
              <Plus size={11} style={{ verticalAlign: 'middle' }} /> 新增 option
            </button>
          </div>
          {field.options.length === 0 && <div style={emptyStyle}>无选项</div>}
          {field.options.map((opt, i) => (
            <div key={i} style={optionRowStyle}>
              <input
                value={opt.label}
                onChange={(e) => updateOption(i, { label: e.target.value })}
                placeholder="label"
                style={{ ...inputStyle, flex: '0 0 110px' }}
              />
              <input
                value={opt.value}
                onChange={(e) => updateOption(i, { value: e.target.value })}
                placeholder="value"
                style={{ ...inputMonoStyle, flex: '0 0 110px' }}
              />
              <div style={enabledForBlockStyle}>
                <span style={enabledForLabelStyle}>仅模式可选:</span>
                <ChipMultiSelect
                  value={opt.enabledForModes ?? []}
                  presets={availableModeIds}
                  onChange={(next) =>
                    updateOption(i, {
                      enabledForModes: next.length > 0 ? next : undefined,
                    })
                  }
                />
              </div>
              <button
                type="button"
                onClick={() => removeOption(i)}
                style={removeBtnStyle}
                title="删除 option"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

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
  gap: 8,
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

const optionsBlockStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  paddingLeft: 22,
  borderLeft: `2px solid ${tokens.border}`,
  marginLeft: 6,
};

const optionsHeadStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  fontSize: 11,
  color: tokens.textMuted,
};

const optionRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  alignItems: 'center',
  flexWrap: 'wrap',
};

const enabledForBlockStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flex: 1,
  minWidth: 240,
};

const enabledForLabelStyle: React.CSSProperties = {
  fontSize: 10,
  color: tokens.textFaint,
  flexShrink: 0,
};
