// Canvas list rendered inline in the P1 rail (Discord server-list style).
//
// Why a slim re-implementation instead of reusing CanvasGallery:
//   - CanvasGallery is 412 lines of trigger-button + popover + edit + delete
//     dialogs. We need ~30 lines of "list current canvases as 36px tiles,
//     click to switch, plus a + button". Wrapping the heavyweight version
//     inside the rail would force us to fight its layout.
//   - Edit / delete still belong in CanvasGallery (kept as a popover from
//     EditorLeftRail for now). When we eventually decide to retire that
//     popover, those actions move into a settings module or a context menu
//     here. Phase B keeps both paths alive.
//
// Behaviour:
//   - On mount: fetch first page (PAGE_LIMIT items, no infinite scroll yet —
//     phase B+ if users actually have hundreds of canvases).
//   - Click tile: navigate via ?flowId=<id> (same trick CanvasGallery uses;
//     EditorPage's useFlow hook reads that query param).
//   - + button: create blank canvas, jump to it.
//   - Active canvas: 2px ring around the tile.

import React, { useCallback, useEffect, useState } from 'react';
import { Plus, FolderOpen } from 'lucide-react';
import { toast } from 'sonner';

import { canvasService, type CanvasItem } from '../services/canvasService';
import { lastFlowStore } from '../services/lastFlowStore';

interface CanvasRailListProps {
  /** Currently-loaded canvas id, used for the active ring. */
  currentFlowId?: string | null;
}

const PAGE_LIMIT = 30;

export const CanvasRailList: React.FC<CanvasRailListProps> = ({
  currentFlowId,
}) => {
  const [items, setItems] = useState<CanvasItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const fetchList = useCallback(async () => {
    try {
      setLoading(true);
      const res = await canvasService.queryCanvases({
        page: 1,
        limit: PAGE_LIMIT,
        sortBy: 'updatedAt',
        sortOrder: 'desc',
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
    void fetchList();
  }, [fetchList]);

  const handleSwitch = useCallback((item: CanvasItem) => {
    if (item.id === currentFlowId) return;
    // Same approach as CanvasGallery: location.href reload. Cleaner than
    // teaching useFlow to react to in-page id changes mid-edit (which would
    // need draft-flush + state reset). Reload is fine for desktop because
    // we don't have multi-tab session state to preserve.
    const url = new URL(window.location.href);
    url.searchParams.set('flowId', item.id);
    window.location.href = url.toString();
  }, [currentFlowId]);

  const handleCreate = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    try {
      const created = await canvasService.createCanvas();
      lastFlowStore.set(created.id);
      const url = new URL(window.location.href);
      url.searchParams.set('flowId', created.id);
      window.location.href = url.toString();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建画布失败');
      setCreating(false);
    }
  }, [creating]);

  return (
    <div style={containerStyle}>
      <div style={listStyle} role="list">
        {loading && items.length === 0 && (
          <div style={dimTextStyle} title="加载中">·</div>
        )}
        {error && (
          <button
            type="button"
            onClick={() => void fetchList()}
            style={errorTileStyle}
            title={`加载失败: ${error}\n点击重试`}
          >
            !
          </button>
        )}
        {items.map((item) => {
          const active = item.id === currentFlowId;
          return (
            <button
              key={item.id}
              type="button"
              role="listitem"
              onClick={() => handleSwitch(item)}
              style={{
                ...tileStyle,
                outline: active ? '2px solid #4f46e5' : '2px solid transparent',
                outlineOffset: active ? -2 : 0,
              }}
              title={item.name}
              onMouseEnter={(e) => {
                if (!active) e.currentTarget.style.background = '#1f2128';
              }}
              onMouseLeave={(e) => {
                if (!active) e.currentTarget.style.background = '#181a20';
              }}
            >
              {item.cover ? (
                <img src={item.cover} alt="" style={coverStyle} />
              ) : (
                <div style={initialStyle}>
                  {/* 2 字符缩写，跟 CanvasGallery 的 fallback 一致，
                      用户在两个入口看到同一张画布时辨识度统一。 */}
                  {item.name.slice(0, 2) || <FolderOpen size={14} />}
                </div>
              )}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={handleCreate}
        disabled={creating}
        style={{ ...createBtnStyle, opacity: creating ? 0.5 : 1 }}
        title="新建画布"
        onMouseEnter={(e) => {
          if (!creating) {
            e.currentTarget.style.background = 'rgba(99,102,241,0.18)';
            e.currentTarget.style.color = '#a5b4fc';
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
          e.currentTarget.style.color = '#9aa0a6';
        }}
      >
        <Plus size={18} />
      </button>
    </div>
  );
};

// ─── styles ─────────────────────────────────────────────────────────────────

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
  flex: 1,
  minHeight: 0,
  width: '100%',
};

const listStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 6,
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  width: '100%',
  paddingBottom: 6,
};

const tileStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 10,
  border: 'none',
  background: '#181a20',
  color: '#cbd0d8',
  cursor: 'pointer',
  padding: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'hidden',
  flexShrink: 0,
  transition: 'background 0.15s, outline-color 0.15s',
};

const coverStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
};

const initialStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: 0.5,
  color: '#cbd0d8',
};

const createBtnStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 10,
  border: '1px dashed rgba(255,255,255,0.12)',
  background: 'rgba(255,255,255,0.04)',
  color: '#9aa0a6',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'background 0.15s, color 0.15s',
  flexShrink: 0,
};

const dimTextStyle: React.CSSProperties = {
  color: '#5a5f68',
  fontSize: 16,
  padding: '8px 0',
};

const errorTileStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 10,
  border: 'none',
  background: 'rgba(220,38,38,0.18)',
  color: '#fda4a4',
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 700,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};
