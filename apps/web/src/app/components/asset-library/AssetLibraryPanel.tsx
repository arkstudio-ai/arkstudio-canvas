// 统一素材库 drawer — 支持 Volcengine (火山方舟) 和 Vidu 两套资产.
//
// 入口: StatusBar 的 "📦 素材库" 按钮.
// 两个 tab:
//   - 火山方舟: Seedance 参考素材 (Image/Video/Audio), 数据在 Volcengine 上游
//   - Vidu: 短剧资产 (角色/场景/道具), 数据在本地 DB

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Plus, RefreshCw, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  type Asset,
  type AssetType,
  deleteAsset,
  getAsset,
  listAssets,
} from '../../services/volcengineAssetApi';
import {
  type ViduAsset,
  type ViduAssetType,
  deleteViduAsset,
  listViduAssets,
} from '../../services/viduAssetApi';
import { useUIStore } from '../../store/uiStore';
import { AddAssetForm } from './AddAssetForm';
import { AddViduAssetForm } from './AddViduAssetForm';
import { AssetCard } from './AssetCard';
import { ViduAssetCard } from './ViduAssetCard';
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
  titleGroupStyle,
  titleStyle,
} from './styles';

interface AssetLibraryPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

type LibraryTab = 'volcengine' | 'vidu';

// Volcengine filter
const TYPE_FILTER_KEYS: Record<AssetType | 'All', string> = {
  All: 'assetLibrary.filter.all',
  Image: 'assetLibrary.filter.image',
  Video: 'assetLibrary.filter.video',
  Audio: 'assetLibrary.filter.audio',
};
const TYPE_FILTER_ORDER: Array<AssetType | 'All'> = ['All', 'Image', 'Video', 'Audio'];

// Vidu filter
const VIDU_TYPE_LABELS: Record<ViduAssetType | 'all', string> = {
  all: '全部',
  character: '角色',
  scene: '场景',
  tool: '道具',
};
const VIDU_TYPE_ORDER: Array<ViduAssetType | 'all'> = ['all', 'character', 'scene', 'tool'];

export const AssetLibraryPanel: React.FC<AssetLibraryPanelProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<LibraryTab>('volcengine');

  // ---- Volcengine state ----
  const [assets, setAssets] = useState<Asset[]>([]);
  const [vcLoading, setVcLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState<AssetType | 'All'>('All');
  const [vcAddOpen, setVcAddOpen] = useState(false);
  const referenceHandler = useUIStore((s) => s.assetLibraryReferenceHandler);

  // ---- Vidu state ----
  const [viduAssets, setViduAssets] = useState<ViduAsset[]>([]);
  const [viduLoading, setViduLoading] = useState(false);
  const [viduTypeFilter, setViduTypeFilter] = useState<ViduAssetType | 'all'>('all');
  const [viduAddOpen, setViduAddOpen] = useState(false);

  // ---- Volcengine data ----
  const refreshVolcengine = useCallback(async () => {
    setVcLoading(true);
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
      setVcLoading(false);
    }
  }, [typeFilter]);

  // ---- Vidu data ----
  const refreshVidu = useCallback(async () => {
    setViduLoading(true);
    try {
      const items = await listViduAssets(
        viduTypeFilter === 'all' ? undefined : viduTypeFilter,
      );
      setViduAssets(items);
    } catch (err) {
      toast.error(`加载 Vidu 资产失败: ${(err as Error).message}`);
    } finally {
      setViduLoading(false);
    }
  }, [viduTypeFilter]);

  useEffect(() => {
    if (isOpen && activeTab === 'volcengine') void refreshVolcengine();
  }, [isOpen, activeTab, refreshVolcengine]);

  useEffect(() => {
    if (isOpen && activeTab === 'vidu') void refreshVidu();
  }, [isOpen, activeTab, refreshVidu]);

  // Esc 关闭
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

  // Volcengine Processing 轮询
  const pollTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!isOpen || activeTab !== 'volcengine') return;
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
  }, [isOpen, activeTab, assets]);

  const handleDeleteVc = async (asset: Asset) => {
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

  const handleDeleteVidu = async (asset: ViduAsset) => {
    if (!confirm(`确认删除 ${VIDU_TYPE_LABELS[asset.type]} "${asset.name}"?`))
      return;
    try {
      await deleteViduAsset(asset.id);
      setViduAssets((prev) => prev.filter((a) => a.id !== asset.id));
      toast.success('已删除');
    } catch (err) {
      toast.error(`删除失败: ${(err as Error).message}`);
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
            {/* Tab switcher */}
            <div style={tabRowStyle}>
              <button
                type="button"
                style={tabStyle(activeTab === 'volcengine')}
                onClick={() => setActiveTab('volcengine')}
              >
                火山方舟
              </button>
              <button
                type="button"
                style={tabStyle(activeTab === 'vidu')}
                onClick={() => setActiveTab('vidu')}
              >
                Vidu 短剧
              </button>
            </div>
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

        {activeTab === 'volcengine' ? (
          <>
            <div style={filterRowStyle}>
              <div style={chipGroupStyle}>
                {TYPE_FILTER_ORDER.map((type) => (
                  <button
                    key={type}
                    type="button"
                    style={chipStyle(typeFilter === type)}
                    onClick={() => setTypeFilter(type)}
                  >
                    {t(TYPE_FILTER_KEYS[type])}
                  </button>
                ))}
              </div>
              <div style={actionsGroupStyle}>
                <button
                  type="button"
                  style={iconBtnStyle}
                  onClick={() => void refreshVolcengine()}
                  disabled={vcLoading}
                  title="刷新"
                >
                  <RefreshCw size={14} style={{ opacity: vcLoading ? 0.4 : 1 }} />
                </button>
                <button
                  type="button"
                  style={primaryBtnStyle}
                  onClick={() => setVcAddOpen((v) => !v)}
                >
                  <Plus size={14} />
                  <span>添加</span>
                </button>
              </div>
            </div>

            {vcAddOpen && (
              <AddAssetForm
                onCancel={() => setVcAddOpen(false)}
                onCreated={(asset) => {
                  setAssets((prev) => [asset, ...prev]);
                  setVcAddOpen(false);
                  toast.success('已提交, 等待处理');
                }}
              />
            )}

            <div style={listScrollStyle}>
              {vcLoading && assets.length === 0 ? (
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
                    onDelete={() => handleDeleteVc(asset)}
                    onCopyUri={() => handleCopyUri(asset.uri)}
                    onReference={
                      referenceHandler
                        ? () => {
                            referenceHandler({
                              id: asset.id,
                              name: asset.name || asset.id,
                              uri: asset.uri,
                              assetType: asset.assetType,
                              thumbnailUrl: asset.url,
                            });
                            onClose();
                          }
                        : undefined
                    }
                  />
                ))
              )}
            </div>
          </>
        ) : (
          <>
            <div style={filterRowStyle}>
              <div style={chipGroupStyle}>
                {VIDU_TYPE_ORDER.map((type) => (
                  <button
                    key={type}
                    type="button"
                    style={chipStyle(viduTypeFilter === type)}
                    onClick={() => setViduTypeFilter(type)}
                  >
                    {VIDU_TYPE_LABELS[type]}
                  </button>
                ))}
              </div>
              <div style={actionsGroupStyle}>
                <button
                  type="button"
                  style={iconBtnStyle}
                  onClick={() => void refreshVidu()}
                  disabled={viduLoading}
                  title="刷新"
                >
                  <RefreshCw size={14} style={{ opacity: viduLoading ? 0.4 : 1 }} />
                </button>
                <button
                  type="button"
                  style={primaryBtnStyle}
                  onClick={() => setViduAddOpen((v) => !v)}
                >
                  <Plus size={14} />
                  <span>添加</span>
                </button>
              </div>
            </div>

            {viduAddOpen && (
              <AddViduAssetForm
                onCancel={() => setViduAddOpen(false)}
                onCreated={(asset) => {
                  setViduAssets((prev) => [asset, ...prev]);
                  setViduAddOpen(false);
                  toast.success('资产已添加');
                }}
              />
            )}

            <div style={listScrollStyle}>
              {viduLoading && viduAssets.length === 0 ? (
                <div style={emptyStyle}>加载中…</div>
              ) : viduAssets.length === 0 ? (
                <div style={emptyStyle}>
                  暂无 Vidu 资产.
                  <br />
                  点 "添加" 创建角色 / 场景 / 道具.
                </div>
              ) : (
                viduAssets.map((asset) => (
                  <ViduAssetCard
                    key={asset.id}
                    asset={asset}
                    onDelete={() => handleDeleteVidu(asset)}
                  />
                ))
              )}
            </div>
          </>
        )}
      </aside>
    </>,
    document.body,
  );
};

const tabRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 2,
  marginTop: 4,
};

const tabStyle = (active: boolean): React.CSSProperties => ({
  padding: '3px 10px',
  fontSize: 11,
  borderRadius: 4,
  border: 'none',
  background: active ? 'rgba(255,255,255,0.10)' : 'transparent',
  color: active ? '#e8e8ea' : '#777',
  cursor: 'pointer',
  fontWeight: active ? 600 : 400,
});
