import React from 'react';
import { Settings } from 'lucide-react';
import { ChipBase } from './ChipBase';

export interface SettingsChipProps {
  /** popover 内容由调用方提供 */
  renderPopover: (api: { close: () => void }) => React.ReactNode;
  disabled?: boolean;
  title?: string;
}

/**
 * 齿轮 ⚙️ 按钮:不显示文字, 不显示 ⌄ 箭头, 仅 icon。
 */
export const SettingsChip: React.FC<SettingsChipProps> = ({
  renderPopover,
  disabled,
  title = '设置',
}) => {
  return (
    <ChipBase
      variant="action"
      disabled={disabled}
      title={title}
      popover={renderPopover}
    >
      <Settings size={14} />
    </ChipBase>
  );
};
