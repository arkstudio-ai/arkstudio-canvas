import React from 'react';
import { Trash2 } from 'lucide-react';
import type { ViduAsset } from '../../services/viduAssetApi';
import {
  cardActionsStyle,
  cardBodyStyle,
  cardStyle,
  cardThumbImgStyle,
  cardThumbWrapStyle,
  cardTitleRowStyle,
  cardTitleStyle,
  smallBtnDangerStyle,
  statusBadgeStyle,
} from './styles';

const TYPE_LABELS: Record<string, { label: string; fg: string; bg: string }> = {
  character: { label: '角色', fg: '#93c5fd', bg: 'rgba(59,130,246,0.16)' },
  scene: { label: '场景', fg: '#86efac', bg: 'rgba(34,197,94,0.16)' },
  tool: { label: '道具', fg: '#fde68a', bg: 'rgba(245,158,11,0.16)' },
};

export interface ViduAssetCardProps {
  asset: ViduAsset;
  onDelete: () => void;
  selected?: boolean;
  onToggleSelect?: () => void;
}

export const ViduAssetCard: React.FC<ViduAssetCardProps> = ({
  asset,
  onDelete,
  selected,
  onToggleSelect,
}) => {
  const tint = TYPE_LABELS[asset.type] ?? {
    label: asset.type,
    fg: '#cfcfd2',
    bg: 'rgba(255,255,255,0.06)',
  };

  return (
    <div
      style={{
        ...cardStyle,
        borderColor: selected
          ? 'rgba(99,102,241,0.6)'
          : 'rgba(255,255,255,0.06)',
        background: selected
          ? 'rgba(99,102,241,0.08)'
          : 'rgba(255,255,255,0.02)',
        cursor: onToggleSelect ? 'pointer' : undefined,
      }}
      onClick={onToggleSelect}
    >
      <div style={cardThumbWrapStyle}>
        <img src={asset.imageUrl} alt="" style={cardThumbImgStyle} />
      </div>
      <div style={cardBodyStyle}>
        <div style={cardTitleRowStyle}>
          <span style={cardTitleStyle}>{asset.name}</span>
          <span
            style={{
              ...statusBadgeStyle,
              color: tint.fg,
              background: tint.bg,
            }}
          >
            {tint.label}
          </span>
        </div>
        {asset.description && (
          <div style={descStyle}>{asset.description}</div>
        )}
        <div style={cardActionsStyle}>
          <button
            type="button"
            style={smallBtnDangerStyle}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            title="删除"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </div>
  );
};

const descStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#999',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};
