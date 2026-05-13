import React from 'react';
import type { ModelEntry } from '@canvas-flow/core';
import { ChipBase } from './ChipBase';
import { DynamicLucideIcon } from './icons';

export interface ModelChipProps {
  models: ModelEntry[];
  value: string;
  onChange: (modelValue: string) => void;
  disabled?: boolean;
}

/**
 * 模型选择 chip:显示当前选中模型的 icon + label, 点击弹下拉列表。
 */
export const ModelChip: React.FC<ModelChipProps> = ({ models, value, onChange, disabled }) => {
  const current = models.find((m) => m.value === value) ?? models[0];

  return (
    <ChipBase
      variant="dropdown"
      disabled={disabled || models.length === 0}
      title={current?.label}
      popover={({ close }) => (
        <ModelOptionList
          models={models}
          value={value}
          onChange={(v) => { onChange(v); close(); }}
        />
      )}
    >
      {current?.icon && <DynamicLucideIcon name={current.icon} size={14} />}
      <span>{current?.label ?? '未选择'}</span>
    </ChipBase>
  );
};

const ModelOptionList: React.FC<{
  models: ModelEntry[];
  value: string;
  onChange: (v: string) => void;
}> = ({ models, value, onChange }) => (
  <div role="listbox" style={listStyle}>
    {models.map((m) => {
      const active = m.value === value;
      return (
        <button
          key={m.value}
          type="button"
          role="option"
          aria-selected={active}
          onClick={() => onChange(m.value)}
          style={itemStyle(active)}
        >
          {m.icon && <DynamicLucideIcon name={m.icon} size={14} />}
          <span style={{ flex: 1, textAlign: 'left' }}>{m.label}</span>
        </button>
      );
    })}
  </div>
);

const listStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 180,
  maxHeight: 320,
  overflowY: 'auto',
};

const itemStyle = (active: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 10px',
  borderRadius: 6,
  border: 'none',
  background: active ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
  color: active ? '#6b9fff' : '#ddd',
  cursor: 'pointer',
  fontSize: 13,
  outline: 'none',
  transition: 'background 0.1s',
});
