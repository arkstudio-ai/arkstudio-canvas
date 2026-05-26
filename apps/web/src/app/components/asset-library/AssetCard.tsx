// 单条 asset 的展示卡片. 渲染规则:
//   - Active + Image: 上游 URL (CDN) 可直接 <img>, 展原图缩略
//   - 其它 type / 其它 status: 文字占位 (类型名)
//   - Active 状态才能复制 URI (避免用户用 Processing 的拿去跑生成立即失败)
//   - Failed 时把上游错误 message 显在卡片下边

import React from 'react';
import { Copy, Link2, Trash2 } from 'lucide-react';
import type { Asset } from '../../services/volcengineAssetApi';
import {
  cardActionsStyle,
  cardBodyStyle,
  cardErrorStyle,
  cardStyle,
  cardThumbImgStyle,
  cardThumbPlaceholderStyle,
  cardThumbWrapStyle,
  cardTitleRowStyle,
  cardTitleStyle,
  cardUriStyle,
  smallBtnAccentStyle,
  smallBtnDangerStyle,
  smallBtnStyle,
  statusBadgeStyle,
} from './styles';

const ASSET_TYPE_LABELS: Record<Asset['assetType'], string> = {
  Image: '图片',
  Video: '视频',
  Audio: '音频',
};

const STATUS_TINT: Record<
  Asset['status'],
  { fg: string; bg: string; label: string }
> = {
  Active: { fg: '#5eead4', bg: 'rgba(20, 184, 166, 0.16)', label: '就绪' },
  Processing: { fg: '#fbbf24', bg: 'rgba(245, 158, 11, 0.16)', label: '处理中' },
  Failed: { fg: '#fca5a5', bg: 'rgba(239, 68, 68, 0.18)', label: '失败' },
};

export interface AssetCardProps {
  asset: Asset;
  onDelete: () => void;
  onCopyUri: () => void;
  /**
   * When present, the card renders a prominent "引用" button (in
   * addition to 复制 URI). The drawer wires this from
   * `uiStore.assetLibraryReferenceHandler`, which is set by whichever
   * caller opened the drawer in "reference to a specific node" mode
   * (currently only the SD2 video node's 素材库 button).
   */
  onReference?: () => void;
}

export const AssetCard: React.FC<AssetCardProps> = ({
  asset,
  onDelete,
  onCopyUri,
  onReference,
}) => {
  const tint = STATUS_TINT[asset.status];
  return (
    <div style={cardStyle}>
      <div style={cardThumbWrapStyle}>
        {asset.status === 'Active' && asset.assetType === 'Image' && asset.url ? (
          <img src={asset.url} alt="" style={cardThumbImgStyle} />
        ) : (
          <div style={cardThumbPlaceholderStyle}>
            {ASSET_TYPE_LABELS[asset.assetType]}
          </div>
        )}
      </div>
      <div style={cardBodyStyle}>
        <div style={cardTitleRowStyle}>
          <span style={cardTitleStyle}>{asset.name || asset.id}</span>
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
        <code style={cardUriStyle} title={asset.uri}>
          {asset.uri}
        </code>
        {asset.status === 'Failed' && asset.error && (
          <div style={cardErrorStyle}>{asset.error}</div>
        )}
        <div style={cardActionsStyle}>
          {onReference && (
            <button
              type="button"
              style={smallBtnAccentStyle}
              onClick={onReference}
              disabled={asset.status !== 'Active'}
              title={
                asset.status === 'Active'
                  ? '引用到当前 SD2 节点 (作为上游素材)'
                  : '只有就绪状态才能引用'
              }
            >
              <Link2 size={12} />
              <span>引用</span>
            </button>
          )}
          <button
            type="button"
            style={smallBtnStyle}
            onClick={onCopyUri}
            disabled={asset.status !== 'Active'}
            title={
              asset.status === 'Active'
                ? '复制 asset:// URI'
                : '只有就绪状态才能用于视频生成'
            }
          >
            <Copy size={12} />
            <span>复制 URI</span>
          </button>
          <button
            type="button"
            style={smallBtnDangerStyle}
            onClick={onDelete}
            title="删除"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </div>
  );
};
