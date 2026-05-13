import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  buttonGhostStyle,
  emptyStyle,
  inputStyle,
  inputMonoStyle,
  tokens,
} from '../styles';

export interface KeyValueEditorProps {
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}

/**
 * Generic JSON-friendly KV editor for `defaultParams`.
 *
 * Values are stored as their primitive type when possible -- numbers stay
 * numbers, booleans stay booleans, strings remain strings. Anything that
 * looks like JSON ([..], {...}, null) is parsed; everything else is kept
 * as a raw string. Display uses `JSON.stringify` so the round-trip is
 * lossless even for nested structures.
 */
export const KeyValueEditor: React.FC<KeyValueEditorProps> = ({ value, onChange }) => {
  const [newKey, setNewKey] = useState('');

  const entries = Object.entries(value);

  const updateKey = (oldKey: string, newKeyName: string) => {
    if (!newKeyName.trim() || newKeyName === oldKey) return;
    if (newKeyName in value) return;
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      next[k === oldKey ? newKeyName : k] = v;
    }
    onChange(next);
  };

  const updateValue = (key: string, raw: string) => {
    const parsed = parseValue(raw);
    onChange({ ...value, [key]: parsed });
  };

  const remove = (key: string) => {
    const next = { ...value };
    delete next[key];
    onChange(next);
  };

  const add = () => {
    const trimmed = newKey.trim();
    if (!trimmed || trimmed in value) return;
    onChange({ ...value, [trimmed]: '' });
    setNewKey('');
  };

  return (
    <div style={containerStyle}>
      {entries.length === 0 && <div style={emptyStyle}>无默认参数</div>}
      {entries.map(([k, v]) => (
        <div key={k} style={rowStyle}>
          <input
            defaultValue={k}
            onBlur={(e) => updateKey(k, e.target.value)}
            style={{ ...inputStyle, flex: '0 0 160px' }}
          />
          <input
            defaultValue={formatValue(v)}
            onBlur={(e) => updateValue(k, e.target.value)}
            style={inputMonoStyle}
            placeholder="JSON / 字符串 / 数字 / true / false / null"
          />
          <button
            type="button"
            onClick={() => remove(k)}
            style={removeBtnStyle}
            title="删除"
          >
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      <div style={addRowStyle}>
        <input
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder="新参数名 (回车添加)"
          style={{ ...inputStyle, flex: '0 0 160px' }}
        />
        <button type="button" onClick={add} disabled={!newKey.trim()} style={buttonGhostStyle}>
          <Plus size={12} style={{ verticalAlign: 'middle' }} /> 添加
        </button>
      </div>
    </div>
  );
};

function parseValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === '') return '';
  if (trimmed === 'null') return null;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return raw;
    }
  }
  return raw;
}

function formatValue(v: unknown): string {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  alignItems: 'center',
};

const addRowStyle: React.CSSProperties = {
  ...rowStyle,
  marginTop: 4,
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
