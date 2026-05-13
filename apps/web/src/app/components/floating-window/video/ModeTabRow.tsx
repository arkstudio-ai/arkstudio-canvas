import React from 'react';
import type { ModeEntry } from '@canvas-flow/core';

export interface ModeTabRowProps {
  modes: ModeEntry[];
  /** 当前选中的 mode.id */
  value: string;
  onChange: (modeId: string) => void;
  disabled?: boolean;
}

/**
 * Video family 顶部模式 tab 行（如「文生 / 首帧生成 / 全能参考 / 视频编辑」）。
 *
 * 视觉风格参考竞品(Bailian Seedance):
 * - 横向滚动条；当前激活 tab 高亮背景 + 微缩边框；其它 tab 透明。
 * - tab 数量随 family 不同(wan2.6 只有 3 个，hh/wan2.7 有 4 个)。
 */
export const ModeTabRow: React.FC<ModeTabRowProps> = ({ modes, value, onChange, disabled }) => {
  if (modes.length <= 1) return null;
  return (
    <div style={rowStyle}>
      {modes.map((m) => {
        const active = m.id === value;
        return (
          <button
            key={m.id}
            type="button"
            disabled={disabled}
            onClick={() => !disabled && !active && onChange(m.id)}
            style={tabBtnStyle(active, !!disabled)}
            title={m.sku}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
  alignItems: 'center',
};

const tabBtnStyle = (active: boolean, disabled: boolean): React.CSSProperties => ({
  padding: '6px 12px',
  borderRadius: 8,
  border: active ? '1px solid #3a3a3a' : '1px solid transparent',
  background: active ? '#262626' : 'transparent',
  color: active ? '#fff' : '#888',
  fontSize: 12,
  fontWeight: active ? 600 : 400,
  cursor: disabled ? 'not-allowed' : active ? 'default' : 'pointer',
  opacity: disabled ? 0.5 : 1,
  letterSpacing: 0.3,
  transition: 'background 0.15s, color 0.15s, border-color 0.15s',
});
