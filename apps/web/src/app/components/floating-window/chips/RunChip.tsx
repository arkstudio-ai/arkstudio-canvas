import React from 'react';
import { ArrowUp, Loader2 } from 'lucide-react';

export interface RunChipProps {
  /** 左侧 slot: 开源版传 null/空, 商业版可塞价格 / 限免 等组件 */
  prefix?: React.ReactNode;
  onRun: () => void;
  isRunning?: boolean;
  disabled?: boolean;
  /**
   * 自定义 disabled 状态下的 hover 文案。
   * 用于解释「为什么不能跑」(如「请先填写 prompt 或连接上游」)，避免用户
   * 在灰按钮上无声反馈。
   */
  disabledReason?: string;
}

/**
 * 运行按钮 chip:右侧固定圆形 ↑ 按钮 + 左侧 prefix(可选 slot)。
 * 这是浮窗最显眼的"主操作"。
 */
export const RunChip: React.FC<RunChipProps> = ({
  prefix,
  onRun,
  isRunning,
  disabled,
  disabledReason,
}) => {
  const fullDisabled = Boolean(disabled || isRunning);
  const title =
    isRunning ? '运行中...'
    : fullDisabled && disabledReason ? disabledReason
    : '运行 (Cmd/Ctrl + Enter)';

  return (
    <div style={containerStyle}>
      {prefix && <div style={prefixStyle}>{prefix}</div>}
      <button
        type="button"
        onClick={onRun}
        disabled={fullDisabled}
        title={title}
        style={runButtonStyle(fullDisabled)}
      >
        {isRunning ? (
          <Loader2 size={16} style={{ animation: 'cf-spin 1s linear infinite' }} />
        ) : (
          <ArrowUp size={16} />
        )}
        {/* 内联 keyframes 兜底; 应用层应当在全局 css 里定义 */}
        <style>{`@keyframes cf-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </button>
    </div>
  );
};

const containerStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  background: 'rgba(255, 255, 255, 0.04)',
  border: '1px solid #2a2a2a',
  borderRadius: 999,
  padding: '2px 2px 2px 10px',
  height: 32,
};

const prefixStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  color: '#ddd',
  fontSize: 12,
  marginRight: 4,
};

const runButtonStyle = (disabled: boolean): React.CSSProperties => ({
  width: 28,
  height: 28,
  borderRadius: '50%',
  border: 'none',
  background: disabled
    ? '#333'
    : 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
  color: disabled ? '#666' : '#fff',
  cursor: disabled ? 'not-allowed' : 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  outline: 'none',
  transition: 'background 0.15s, transform 0.1s',
  flexShrink: 0,
});
