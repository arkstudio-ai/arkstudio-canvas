import React from 'react';
import { ChipBase } from './ChipBase';

export interface CountChipProps {
  value: number;
  /** 最大可选数, 默认 4 */
  max?: number;
  onChange: (n: number) => void;
  disabled?: boolean;
}

/**
 * 数量选择 chip:1x / 2x / 3x / 4x。
 */
export const CountChip: React.FC<CountChipProps> = ({ value, max = 4, onChange, disabled }) => {
  const options = Array.from({ length: max }, (_, i) => i + 1);

  return (
    <ChipBase
      variant="dropdown"
      disabled={disabled}
      title="生成数量"
      popover={({ close }) => (
        <div style={listStyle}>
          {options.map((n) => {
            const active = n === value;
            return (
              <button
                key={n}
                type="button"
                onClick={() => {
                  onChange(n);
                  close();
                }}
                style={itemStyle(active)}
              >
                {n}x
              </button>
            );
          })}
        </div>
      )}
    >
      {value}x
    </ChipBase>
  );
};

const listStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 80,
};

const itemStyle = (active: boolean): React.CSSProperties => ({
  padding: '6px 12px',
  borderRadius: 6,
  border: 'none',
  background: active ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
  color: active ? '#6b9fff' : '#ddd',
  cursor: 'pointer',
  fontSize: 13,
  textAlign: 'center',
  outline: 'none',
});
