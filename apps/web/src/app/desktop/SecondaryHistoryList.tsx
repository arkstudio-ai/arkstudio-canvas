// P2 「历史」tab — slim list of recent generations across all canvases.
//
// Pulls from the same `generationHistoryService.queryHistory` that powers
// the existing GenerationHistoryPanel popover, but renders inline (no
// modal, no tab bar, no fancy filters) since vertical real estate in P2
// is the constraint here, not feature richness — users who need filtering
// still have the popover via EditorLeftRail.
//
// Click a row → calls `applyHistoryItem` registered by EditorPage in the
// uiStore, which spawns a node on the canvas wired to the same model
// invocation.

import React, { useCallback, useEffect, useState } from 'react';
import { Image as ImageIcon, Music, Video, Type } from 'lucide-react';
import { toast } from 'sonner';

import {
  generationHistoryService,
  type HistoryListItem,
  type HistoryNodeType,
} from '../services/generationHistoryService';
import { useUIStore } from '../store/uiStore';

const PAGE_LIMIT = 30;

const TYPE_ICON: Record<HistoryNodeType, React.ComponentType<{ size?: number }>> = {
  image: ImageIcon,
  video: Video,
  audio: Music,
  text: Type,
};

export const SecondaryHistoryList: React.FC = () => {
  const [items, setItems] = useState<HistoryListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const apply = useUIStore((s) => s.applyHistoryItem);

  const fetchPage = useCallback(async () => {
    try {
      setLoading(true);
      const res = await generationHistoryService.query({
        page: 1,
        limit: PAGE_LIMIT,
      });
      setItems(res.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPage();
  }, [fetchPage]);

  const handleClick = useCallback(
    async (item: HistoryListItem) => {
      if (!apply) {
        toast.info('画布尚未就绪，稍后再试');
        return;
      }
      try {
        await apply(item);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '还原失败');
      }
    },
    [apply],
  );

  if (loading && items.length === 0) {
    return <div style={dimStyle}>加载中…</div>;
  }
  if (error) {
    return (
      <div style={errorStyle}>
        {error}
        <button type="button" style={retryStyle} onClick={() => void fetchPage()}>
          重试
        </button>
      </div>
    );
  }
  if (items.length === 0) {
    return <div style={dimStyle}>暂无生成历史</div>;
  }

  return (
    <ul style={listStyle}>
      {items.map((item) => {
        const Icon = TYPE_ICON[item.nodeType] ?? Type;
        const display = item.promptText?.trim() || item.modelName || item.nodeType;
        return (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => void handleClick(item)}
              style={rowStyle}
              title={display}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              {item.thumbnail ? (
                <img src={item.thumbnail} alt="" style={thumbStyle} />
              ) : (
                <div style={iconBoxStyle}>
                  <Icon size={16} />
                </div>
              )}
              <div style={textColStyle}>
                <span style={titleStyle}>{display}</span>
                <span style={metaStyle}>
                  {item.modelName ?? '—'} · {formatDate(item.createdAt)}
                </span>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
};

const formatDate = (iso: string): string => {
  try {
    const d = new Date(iso);
    const now = Date.now();
    const diff = now - d.getTime();
    if (diff < 60_000) return '刚刚';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
    return `${d.getMonth() + 1}-${d.getDate()}`;
  } catch {
    return '';
  }
};

const listStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  width: '100%',
  padding: 6,
  border: 'none',
  background: 'transparent',
  color: '#cbd0d8',
  cursor: 'pointer',
  borderRadius: 8,
  textAlign: 'left',
  transition: 'background 0.15s',
};

const thumbStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 6,
  objectFit: 'cover',
  background: '#181a20',
  flexShrink: 0,
};

const iconBoxStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 6,
  background: '#181a20',
  color: '#8a8f98',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
};

const textColStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  flex: 1,
};

const titleStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#e0e0e0',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  lineHeight: 1.3,
};

const metaStyle: React.CSSProperties = {
  fontSize: 10,
  color: '#5a5f68',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  marginTop: 2,
};

const dimStyle: React.CSSProperties = {
  color: '#5a5f68',
  fontSize: 12,
  textAlign: 'center',
  padding: '24px 8px',
};

const errorStyle: React.CSSProperties = {
  color: '#ff6b6b',
  fontSize: 12,
  textAlign: 'center',
  padding: '16px 8px',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
};

const retryStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.12)',
  color: '#e0e0e0',
  padding: '4px 10px',
  borderRadius: 6,
  fontSize: 11,
  cursor: 'pointer',
};
