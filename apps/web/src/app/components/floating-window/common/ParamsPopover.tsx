/**
 * 公共参数 popover 组件 — image / video 浮窗的「参数」chip 共用同一套视觉。
 *
 * 设计来源：百炼图像/视频生成 popover —— 比例做形状预览网格（'auto'
 * 选项 spans 2 行），其它 select 字段做等宽 segmented control。
 *
 * 这里只导出"积木"（RatioGrid / SegmentedRow / 容器样式），不导出整体
 * popover —— 各节点自行编排哪些字段走 RatioGrid，哪些走 SegmentedRow，
 * 以及如何注入「mode-aware 灰态」之类的节点专属逻辑。
 */
import React from 'react';
import type { ParamFieldOption, ParamFieldSpec } from '@canvas-flow/core';

/**
 * 选项可用性回调：返回 string → option 被禁用且 string 用作 hover title；
 * 返回 null/undefined → option 启用。video 节点用此注入 mode-aware 灰态。
 */
export type OptionDisabledFn = (option: ParamFieldOption) => string | null | undefined;

/* ---------- 比例网格 ---------- */

export const RatioGrid: React.FC<{
  field: ParamFieldSpec;
  current: string | undefined;
  onPick: (value: string) => void;
  isOptionDisabled?: OptionDisabledFn;
}> = ({ field, current, onPick, isOptionDisabled }) => {
  // 'auto' 是逻辑选项（让上游自己决定尺寸），按竞品布局把它单独占
  // grid 第 1 列、跨 2 行；不存在则普通铺。
  const auto = field.options.find((o) => o.value === 'auto');
  const others = field.options.filter((o) => o.value !== 'auto');

  return (
    <div style={sectionStyle}>
      <div style={sectionLabelStyle}>{field.label}</div>
      <div style={ratioFrameStyle}>
        <div style={ratioGridStyle}>
          {auto && (
            <RatioCell
              option={auto}
              active={current === auto.value}
              disabledReason={isOptionDisabled?.(auto) ?? null}
              onClick={() => onPick(auto.value)}
              span2
            />
          )}
          {others.map((o) => (
            <RatioCell
              key={o.value}
              option={o}
              active={current === o.value}
              disabledReason={isOptionDisabled?.(o) ?? null}
              onClick={() => onPick(o.value)}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

const RatioCell: React.FC<{
  option: ParamFieldOption;
  active: boolean;
  disabledReason: string | null;
  onClick: () => void;
  span2?: boolean;
}> = ({ option, active, disabledReason, onClick, span2 }) => {
  const disabled = !!disabledReason;
  return (
    <button
      type="button"
      onClick={() => {
        if (disabled) return;
        onClick();
      }}
      disabled={disabled}
      title={disabledReason ?? option.label}
      style={ratioCellStyle(active, disabled, span2)}
    >
      <RatioIcon value={option.value} large={span2} active={active} disabled={disabled} />
      <div style={ratioCellLabelStyle(active, disabled)}>{option.label}</div>
    </button>
  );
};

const RatioIcon: React.FC<{
  value: string;
  large?: boolean;
  active: boolean;
  disabled: boolean;
}> = ({ value, large, active, disabled }) => {
  const stroke = disabled ? '#555' : active ? '#fff' : '#9b9b9b';
  if (value === 'auto') {
    return <div style={{ width: 22, height: 60, border: `1.5px solid ${stroke}`, borderRadius: 3 }} />;
  }
  const m = value.match(/^(\d+):(\d+)$/);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const maxEdge = large ? 30 : 22;
  const scale = maxEdge / Math.max(a, b);
  return (
    <div
      style={{
        width: a * scale,
        height: b * scale,
        border: `1.5px solid ${stroke}`,
        borderRadius: 2,
      }}
    />
  );
};

/* ---------- segmented control ---------- */

export const SegmentedRow: React.FC<{
  field: ParamFieldSpec;
  current: string | undefined;
  onPick: (value: string) => void;
  isOptionDisabled?: OptionDisabledFn;
}> = ({ field, current, onPick, isOptionDisabled }) => (
  <div style={sectionStyle}>
    <div style={sectionLabelStyle}>{field.label}</div>
    <div style={segmentedFrameStyle}>
      {field.options.map((o) => {
        const active = current === o.value;
        const disabledReason = isOptionDisabled?.(o) ?? null;
        const disabled = !!disabledReason;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => {
              if (disabled) return;
              onPick(o.value);
            }}
            disabled={disabled}
            title={disabledReason ?? undefined}
            style={segmentedBtnStyle(active, disabled)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  </div>
);

/* ---------- 容器 / 空态 ---------- */

export const ParamsPopoverContainer: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={containerStyle}>{children}</div>
);

export const ParamsPopoverEmpty: React.FC<{ text?: string }> = ({ text }) => (
  <div style={emptyStyle}>{text ?? '该模型暂无可调参数'}</div>
);

/**
 * 单个参数分区：标题 + 内容块（背景灰，圆角）。
 * 给 audio popover 复用同一套视觉 token，避免 image/video/audio 三套样式。
 */
export const ParamsPopoverSection: React.FC<{
  label: string;
  children: React.ReactNode;
  /** 是否套灰底框；默认 true。slider 这种自带留白的可以传 false。 */
  framed?: boolean;
}> = ({ label, children, framed = true }) => (
  <div style={sectionStyle}>
    <div style={sectionLabelStyle}>{label}</div>
    {framed ? <div style={sectionFrameStyle}>{children}</div> : children}
  </div>
);

const sectionFrameStyle: React.CSSProperties = {
  background: '#1c1c1c',
  borderRadius: 10,
  padding: 10,
};

/* ---------- styles ---------- */

const containerStyle: React.CSSProperties = {
  padding: 14,
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  width: 460,
};

const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#9a9a9a',
};

const ratioFrameStyle: React.CSSProperties = {
  background: '#1c1c1c',
  borderRadius: 10,
  padding: 10,
};

const ratioGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(5, 1fr)',
  gridAutoRows: 60,
  gap: 6,
};

const ratioCellStyle = (
  active: boolean,
  disabled: boolean,
  span2?: boolean,
): React.CSSProperties => ({
  gridRow: span2 ? 'span 2' : undefined,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: 6,
  borderRadius: 8,
  border: 'none',
  background: active ? '#3a3a3a' : 'transparent',
  color: '#ddd',
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.4 : 1,
  transition: 'background 120ms',
});

const ratioCellLabelStyle = (active: boolean, disabled: boolean): React.CSSProperties => ({
  fontSize: 12,
  color: disabled ? '#666' : active ? '#fff' : '#9a9a9a',
});

const segmentedFrameStyle: React.CSSProperties = {
  background: '#1c1c1c',
  borderRadius: 10,
  padding: 4,
  display: 'grid',
  gridAutoFlow: 'column',
  gridAutoColumns: '1fr',
  gap: 4,
};

const segmentedBtnStyle = (active: boolean, disabled: boolean): React.CSSProperties => ({
  padding: '10px 8px',
  border: 'none',
  borderRadius: 7,
  background: active ? '#3a3a3a' : 'transparent',
  color: disabled ? '#555' : active ? '#fff' : '#9a9a9a',
  fontSize: 13,
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.5 : 1,
  transition: 'background 120ms',
});

const emptyStyle: React.CSSProperties = {
  padding: '8px 12px',
  fontSize: 12,
  color: '#777',
};
