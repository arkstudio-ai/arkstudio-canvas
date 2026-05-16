// 火山方舟素材库 (Volcengine Assets) — 用户级 drawer 面板.
//
// 入口: StatusBar 的 "📦 素材库" 按钮.
// 范围 (Phase 4 MVP):
//   - 我的资产 列表 + 添加 (公网 URL) + 删除 + 复制 asset:// URI
//   - 公共素材库 / 虚拟人像库 暂不做 — 前者需开通公共库, 后者需身份认证
//     流程, 这两个都得用户去 Volcengine 控制台操作, 桌面端先不接.
//
// 数据流: useEffect 拉一次 list, Processing 状态的 asset 5s 轮询一次直到
// Active/Failed. 删除 / 添加都是乐观更新 + revalidate (重新拉 list).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, RefreshCw, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  type Asset,
  type AssetType,
  deleteAsset,
  getAsset,
  listAssets,
} from '../../services/volcengineAssetApi';
import { AddAssetForm } from './AddAssetForm';
import { AssetCard } from './AssetCard';
import {
  actionsGroupStyle,
  chipGroupStyle,
  chipStyle,
  drawerStyle,
  emptyStyle,
  filterRowStyle,
  headerStyle,
  iconBtnStyle,
  listScrollStyle,
  primaryBtnStyle,
  scrimStyle,
  subtitleStyle,
  titleGroupStyle,
  titleStyle,
} from './styles';

interface AssetLibraryPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const TYPE_FILTER_LABELS: Record<AssetType | 'All', string> = {
  All: '全部',
  Image: '图片',
  Video: '视频',
  Audio: '音频',
};
const TYPE_FILTER_ORDER: Array<AssetType | 'All'> = ['All', 'Image', 'Video', 'Audio'];

export const AssetLibraryPanel: React.FC<AssetLibraryPanelProps> = ({
  isOpen,
  onClose,
}) => {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState<AssetType | 'All'>('All');
  const [addOpen, setAddOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listAssets({
        pageNumber: 1,
        pageSize: 100,
        assetType: typeFilter === 'All' ? undefined : typeFilter,
      });
      setAssets(res.items);
    } catch (err) {
      toast.error(`加载素材库失败: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [typeFilter]);

  // 打开 + filter 变化时拉一次
  useEffect(() => {
    if (isOpen) void refresh();
  }, [isOpen, refresh]);

  // Esc 关闭, 跟 DetailModal 同模式
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [isOpen, onClose]);

  // Processing 状态的素材每 5s 轮询一次, 检测到 Active/Failed 就停 + 更新行
  const pollTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!isOpen) return;
    const processingIds = assets
      .filter((a) => a.status === 'Processing')
      .map((a) => a.id);
    if (processingIds.length === 0) {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }
    if (pollTimerRef.current) return;
    pollTimerRef.current = window.setInterval(async () => {
      const updates = await Promise.all(
        processingIds.map(async (id) => {
          try {
            return await getAsset(id);
          } catch {
            return null;
          }
        }),
      );
      setAssets((prev) =>
        prev.map((a) => {
          const fresh = updates.find((u) => u?.id === a.id);
          return fresh ?? a;
        }),
      );
    }, 5000);
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [isOpen, assets]);

  const handleDelete = async (asset: Asset) => {
    if (!confirm(`确认删除 ${asset.assetType} 素材 "${asset.name || asset.id}"?`))
      return;
    try {
      await deleteAsset(asset.id);
      setAssets((prev) => prev.filter((a) => a.id !== asset.id));
      toast.success('已删除');
    } catch (err) {
      toast.error(`删除失败: ${(err as Error).message}`);
    }
  };

  const handleCopyUri = async (uri: string) => {
    try {
      await navigator.clipboard.writeText(uri);
      toast.success(`已复制 ${uri}`);
    } catch {
      toast.error('复制失败');
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <>
      <div style={scrimStyle} onClick={onClose} />
      <aside style={drawerStyle} onClick={(e) => e.stopPropagation()}>
        <header style={headerStyle}>
          <div style={titleGroupStyle}>
            <span style={titleStyle}>素材库</span>
            <span style={subtitleStyle}>火山方舟 Seedance 参考素材</span>
          </div>
          <button
            type="button"
            style={iconBtnStyle}
            onClick={onClose}
            title="关闭 (Esc)"
          >
            <X size={16} />
          </button>
        </header>

        <div style={filterRowStyle}>
          <div style={chipGroupStyle}>
            {TYPE_FILTER_ORDER.map((t) => (
              <button
                key={t}
                type="button"
                style={chipStyle(typeFilter === t)}
                onClick={() => setTypeFilter(t)}
              >
                {TYPE_FILTER_LABELS[t]}
              </button>
            ))}
          </div>
          <div style={actionsGroupStyle}>
            <button
              type="button"
              style={iconBtnStyle}
              onClick={() => void refresh()}
              disabled={loading}
              title="刷新"
            >
              <RefreshCw size={14} style={{ opacity: loading ? 0.4 : 1 }} />
            </button>
            <button
              type="button"
              style={primaryBtnStyle}
              onClick={() => setAddOpen((v) => !v)}
            >
              <Plus size={14} />
              <span>添加</span>
            </button>
          </div>
        </div>

        {addOpen && (
          <AddAssetForm
            onCancel={() => setAddOpen(false)}
            onCreated={(asset) => {
              setAssets((prev) => [asset, ...prev]);
              setAddOpen(false);
              toast.success('已提交, 等待处理');
            }}
          />
        )}

        <div style={listScrollStyle}>
          {loading && assets.length === 0 ? (
            <div style={emptyStyle}>加载中…</div>
          ) : assets.length === 0 ? (
            <div style={emptyStyle}>
              暂无素材.
              <br />
              点 "添加" 用公网 URL 注册图片 / 视频 / 音频.
            </div>
          ) : (
            assets.map((asset) => (
              <AssetCard
                key={asset.id}
                asset={asset}
                onDelete={() => handleDelete(asset)}
                onCopyUri={() => handleCopyUri(asset.uri)}
              />
            ))
          )}
        </div>
      </aside>
    </>,
    document.body,
  );
};
