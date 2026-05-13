import React from 'react';
import { ChipBase } from './ChipBase';

export interface ParamsChipProps {
  /** chip 上展示的当前参数串(如"720p / 5s / 自适应") */
  summary: React.ReactNode;
  /** popover 内容由调用方提供(各节点定制) */
  renderPopover: (api: { close: () => void }) => React.ReactNode;
  disabled?: boolean;
  title?: string;
}

/**
 * 复合参数 chip:用于展示"模型专属参数串"。
 * 由调用方决定弹什么内容(比例/质量/分辨率组合)。
 */
export const ParamsChip: React.FC<ParamsChipProps> = ({
  summary,
  renderPopover,
  disabled,
  title,
}) => {
  return (
    <ChipBase
      variant="dropdown"
      disabled={disabled}
      title={title}
      popover={renderPopover}
    >
      {summary}
    </ChipBase>
  );
};
