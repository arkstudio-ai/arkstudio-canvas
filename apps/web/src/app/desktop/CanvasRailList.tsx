// Canvas list rendered inline in P1 (Sidebar style, ~180px wide).
//
// v2 layout (was: 36×36 cover-only tiles, looked like Discord servers):
//
//   ┌────────────────────────────┐
//   │ [cover 32] My Canvas       │  ← active row has a left ring
//   │           2026-05-15 14:30 │
//   │ [cover 32] Test            │
//   │           5h 前            │
//   │ ...                        │
//   │ ──────────────────────     │
//   │ [+]      新建画布          │
//   └────────────────────────────┘
//
// Horizontal density tradeoff: we lose 124px of canvas area vs. the old
// 56px Discord-style rail, but gain at-a-glance identification (name +
// timestamp). User asked for this explicitly: "画布 list 只展示封面不太好".
//
// Hover affordance (A): after 350ms of hovering a row, a richer card pops
// out on the right side with a larger cover preview and full timestamps.
// Discord/macOS Dock both use this pattern — fast scan via the inline row,
// detail via dwell. The 350ms is intentional: shorter feels twitchy when
// users mouse-traverse the list to reach + at the bottom.
//
// Behaviour:
//   - On mount: fetch first page (PAGE_LIMIT items, no infinite scroll yet).
//   - Click row: navigate via ?flowId=<id> (hard reload — useFlow doesn't
//     support live id swap mid-edit).
//   - + row: create blank canvas, jump to it.
//   - Right-click row: 重命名 / 详细信息 / 删除 (ContextMenu + DetailModal +
//     PromptModal). Rename uses our PromptModal because Electron 6+
//     disabled window.prompt() in renderers.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, FolderOpen, Pencil, Info, Trash2 } from 'lucide-react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';

import { canvasService, type CanvasItem } from '../services/canvasService';
import { lastFlowStore } from '../services/lastFlowStore';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { DetailModal, type DetailField } from './DetailModal';
import { PromptModal } from './PromptModal';

interface CanvasRailListProps {
  /** Currently-loaded canvas id, used for the active ring. */
  currentFlowId?: string | null;
  /** Display mode, sourced from useUIStore.canvasRailMode. */
  mode: 'expanded' | 'collapsed';
}

const PAGE_LIMIT = 30;
const HOVER_PREVIEW_DELAY_MS = 350;

export const CanvasRailList: React.FC<CanvasRailListProps> = ({
  currentFlowId,
  mode,
}) => {
  const [items, setItems] = useState<CanvasItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{
    pos: { x: number; y: number };
    item: CanvasItem;
  } | null>(null);
  const [detail, setDetail] = useState<CanvasItem | null>(null);
  const [renaming, setRenaming] = useState<CanvasItem | null>(null);
  const [hoverPreview, setHoverPreview] = useState<{
    item: CanvasItem;
    rect: DOMRect;
  } | null>(null);

  // Single shared timer — opening a new row mid-dwell cancels the previous
  // pending preview, so we don't see two cards racing for the screen.
  const hoverTimerRef = useRef<number | null>(null);

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

  // Cleanup any pending preview timer on unmount so we don't setState on a
  // gone component.
  useEffect(() => {
    return () => {
      if (hoverTimerRef.current !== null) {
        window.clearTimeout(hoverTimerRef.current);
      }
    };
  }, []);

  const handleSwitch = useCallback(
    (item: CanvasItem) => {
      if (item.id === currentFlowId) return;
      // Hard reload: useFlow can't live-swap a flowId mid-edit (would
      // need draft-flush + state reset). Reload is fine for desktop.
      const url = new URL(window.location.href);
      url.searchParams.set('flowId', item.id);
      window.location.href = url.toString();
    },
    [currentFlowId],
  );

  const handleHoverEnter = useCallback(
    (item: CanvasItem, rect: DOMRect) => {
      if (hoverTimerRef.current !== null) {
        window.clearTimeout(hoverTimerRef.current);
      }
      hoverTimerRef.current = window.setTimeout(() => {
        setHoverPreview({ item, rect });
      }, HOVER_PREVIEW_DELAY_MS);
    },
    [],
  );
  const handleHoverLeave = useCallback(() => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setHoverPreview(null);
  }, []);

  const handleRename = useCallback((item: CanvasItem) => {
    setRenaming(item);
  }, []);

  const submitRename = useCallback(
    async (next: string) => {
      if (!renaming) return;
      if (!next || next === renaming.name) {
        setRenaming(null);
        return;
      }
      try {
        const updated = await canvasService.updateCanvas(renaming.id, {
          name: next,
        });
        setItems((prev) =>
          prev.map((c) => (c.id === renaming.id ? updated : c)),
        );
        toast.success('已重命名');
        setRenaming(null);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '重命名失败');
      }
    },
    [renaming],
  );

  const handleDelete = useCallback(
    async (item: CanvasItem) => {
      if (!window.confirm(`确认删除画布「${item.name}」？该操作不可恢复。`))
        return;
      try {
        await canvasService.deleteCanvas(item.id);
        setItems((prev) => prev.filter((c) => c.id !== item.id));
        toast.success('已删除');
        if (item.id === currentFlowId) {
          const url = new URL(window.location.href);
          const remaining = items.find((c) => c.id !== item.id);
          if (remaining) {
            url.searchParams.set('flowId', remaining.id);
          } else {
            url.searchParams.delete('flowId');
          }
          window.location.href = url.toString();
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '删除失败');
      }
    },
    [currentFlowId, items],
  );

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

  const expanded = mode === 'expanded';

  return (
    <div style={containerStyle}>
      <div style={expanded ? listStyle : tileListStyle} role="list">
        {loading && items.length === 0 && (
          <div style={dimStyle}>{expanded ? '加载中…' : '·'}</div>
        )}
        {error && (
          <button
            type="button"
            onClick={() => void fetchList()}
            style={expanded ? errorRowStyle : errorTileStyle}
            title={`加载失败: ${error}\n点击重试`}
          >
            {expanded ? '! 加载失败 · 点击重试' : '!'}
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
              onContextMenu={(e) => {
                e.preventDefault();
                setCtxMenu({ pos: { x: e.clientX, y: e.clientY }, item });
              }}
              onMouseEnter={(e) => {
                handleHoverEnter(item, e.currentTarget.getBoundingClientRect());
                if (!active) e.currentTarget.style.background = expanded
                  ? '#1a1c22'
                  : '#1f2128';
              }}
              onMouseLeave={(e) => {
                handleHoverLeave();
                if (!active) e.currentTarget.style.background = expanded
                  ? 'transparent'
                  : '#181a20';
              }}
              style={
                expanded
                  ? {
                      ...rowStyle,
                      background: active
                        ? 'rgba(79,70,229,0.12)'
                        : 'transparent',
                      boxShadow: active
                        ? 'inset 2px 0 0 #4f46e5'
                        : 'inset 2px 0 0 transparent',
                    }
                  : {
                      ...tileStyle,
                      outline: active
                        ? '2px solid #4f46e5'
                        : '2px solid transparent',
                      outlineOffset: active ? -2 : 0,
                    }
              }
              title={item.name}
            >
              {expanded ? (
                <>
                  {item.cover ? (
                    <img src={item.cover} alt="" style={coverStyle} />
                  ) : (
                    <div style={initialBoxStyle}>
                      {item.name.slice(0, 2) || <FolderOpen size={14} />}
                    </div>
                  )}
                  <div style={textColStyle}>
                    <span
                      style={{
                        ...nameStyle,
                        color: active ? '#fff' : '#cbd0d8',
                      }}
                    >
                      {item.name || '未命名'}
                    </span>
                    <span style={metaStyle}>
                      {formatRelative(item.createdAt)}
                    </span>
                  </div>
                </>
              ) : item.cover ? (
                <img src={item.cover} alt="" style={tileCoverStyle} />
              ) : (
                <div style={tileInitialStyle}>
                  {item.name.slice(0, 2) || <FolderOpen size={14} />}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {expanded ? (
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
            if (!creating) {
              e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
              e.currentTarget.style.color = '#9aa0a6';
            }
          }}
        >
          <span style={createIconBoxStyle}>
            <Plus size={14} />
          </span>
          <span style={createLabelStyle}>新建画布</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={handleCreate}
          disabled={creating}
          style={{ ...tileCreateBtnStyle, opacity: creating ? 0.5 : 1 }}
          title="新建画布"
          onMouseEnter={(e) => {
            if (!creating) {
              e.currentTarget.style.background = 'rgba(99,102,241,0.18)';
              e.currentTarget.style.color = '#a5b4fc';
            }
          }}
          onMouseLeave={(e) => {
            if (!creating) {
              e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
              e.currentTarget.style.color = '#9aa0a6';
            }
          }}
        >
          <Plus size={18} />
        </button>
      )}

      {ctxMenu && (
        <ContextMenu
          position={ctxMenu.pos}
          items={buildCanvasMenu(ctxMenu.item, {
            onRename: handleRename,
            onDelete: handleDelete,
            onDetail: setDetail,
          })}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {detail && (
        <DetailModal
          title={`画布 · ${detail.name}`}
          fields={buildCanvasDetailFields(detail)}
          onClose={() => setDetail(null)}
        />
      )}

      {renaming && (
        <PromptModal
          title="重命名画布"
          defaultValue={renaming.name}
          placeholder="画布名称"
          confirmLabel="保存"
          validate={(v) => (v.length === 0 ? '名称不能为空' : null)}
          onConfirm={submitRename}
          onCancel={() => setRenaming(null)}
        />
      )}

      {hoverPreview && <HoverPreview {...hoverPreview} />}
    </div>
  );
};

// ─── Hover preview card ─────────────────────────────────────────────────────

interface HoverPreviewProps {
  item: CanvasItem;
  /** Anchor rect of the hovered row, used to position the card. */
  rect: DOMRect;
}

const HoverPreview: React.FC<HoverPreviewProps> = ({ item, rect }) => {
  // Anchor: right edge of the row + 8px gap. Vertically center on the row.
  // Clamp inside the viewport so cards near the bottom don't escape.
  const cardWidth = 240;
  const cardHeightEstimate = 220;
  let top = rect.top + rect.height / 2 - cardHeightEstimate / 2;
  if (top < 8) top = 8;
  if (top + cardHeightEstimate > window.innerHeight - 8) {
    top = window.innerHeight - cardHeightEstimate - 8;
  }
  const left = Math.min(rect.right + 8, window.innerWidth - cardWidth - 8);

  return createPortal(
    <div
      style={{
        ...previewStyle,
        top,
        left,
        width: cardWidth,
      }}
      role="tooltip"
    >
      {item.cover ? (
        <img src={item.cover} alt="" style={previewCoverStyle} />
      ) : (
        <div style={previewCoverPlaceholderStyle}>
          <FolderOpen size={32} />
        </div>
      )}
      <div style={previewBodyStyle}>
        <div style={previewTitleStyle}>{item.name || '未命名'}</div>
        {item.description && (
          <div style={previewDescStyle}>{item.description}</div>
        )}
        <dl style={previewFieldsStyle}>
          <div style={previewRowStyle}>
            <dt style={previewDtStyle}>创建于</dt>
            <dd style={previewDdStyle}>
              {new Date(item.createdAt).toLocaleString()}
            </dd>
          </div>
          <div style={previewRowStyle}>
            <dt style={previewDtStyle}>更新于</dt>
            <dd style={previewDdStyle}>
              {new Date(item.updatedAt).toLocaleString()}
            </dd>
          </div>
        </dl>
      </div>
    </div>,
    document.body,
  );
};

// ─── helpers ────────────────────────────────────────────────────────────────

function formatRelative(iso: string): string {
  try {
    const t = new Date(iso).getTime();
    const diff = Date.now() - t;
    if (diff < 60_000) return '刚刚';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
    if (diff < 30 * 86_400_000)
      return `${Math.floor(diff / 86_400_000)} 天前`;
    const d = new Date(t);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`;
  } catch {
    return '';
  }
}

function buildCanvasMenu(
  item: CanvasItem,
  handlers: {
    onRename: (i: CanvasItem) => void;
    onDelete: (i: CanvasItem) => void;
    onDetail: (i: CanvasItem) => void;
  },
): ContextMenuItem[] {
  return [
    {
      label: '重命名',
      icon: <Pencil size={14} />,
      onClick: () => handlers.onRename(item),
    },
    {
      label: '详细信息',
      icon: <Info size={14} />,
      onClick: () => handlers.onDetail(item),
    },
    { divider: true, label: '' },
    {
      label: '删除',
      icon: <Trash2 size={14} />,
      danger: true,
      onClick: () => handlers.onDelete(item),
    },
  ];
}

function buildCanvasDetailFields(item: CanvasItem): DetailField[] {
  return [
    { label: 'ID', value: item.id, copyable: true, monospace: true },
    { label: '名称', value: item.name },
    { label: '描述', value: item.description ?? '' },
    {
      label: '创建于',
      value: item.createdAt ? new Date(item.createdAt).toLocaleString() : '',
    },
    {
      label: '更新于',
      value: item.updatedAt ? new Date(item.updatedAt).toLocaleString() : '',
    },
  ];
}

// ─── styles ─────────────────────────────────────────────────────────────────

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  flex: 1,
  minHeight: 0,
  width: '100%',
};

const listStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  width: '100%',
  paddingBottom: 4,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '6px 10px',
  border: 'none',
  cursor: 'pointer',
  textAlign: 'left',
  transition: 'background 0.12s, color 0.12s, box-shadow 0.12s',
  minHeight: 44,
  boxSizing: 'border-box',
};

const coverStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 6,
  objectFit: 'cover',
  background: '#181a20',
  flexShrink: 0,
};

const initialBoxStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 6,
  background: '#181a20',
  color: '#cbd0d8',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: 0.5,
  flexShrink: 0,
  textTransform: 'uppercase',
};

const textColStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  flex: 1,
  gap: 1,
};

const nameStyle: React.CSSProperties = {
  fontSize: 12,
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
};

const createBtnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: 'calc(100% - 16px)',
  margin: '0 8px 4px',
  padding: '6px 8px',
  borderRadius: 8,
  border: '1px dashed rgba(255,255,255,0.12)',
  background: 'rgba(255,255,255,0.04)',
  color: '#9aa0a6',
  cursor: 'pointer',
  transition: 'background 0.15s, color 0.15s',
  flexShrink: 0,
  fontSize: 12,
  textAlign: 'left',
};

const createIconBoxStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 6,
  background: 'rgba(255,255,255,0.04)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
};

const createLabelStyle: React.CSSProperties = {
  flex: 1,
};

const dimStyle: React.CSSProperties = {
  color: '#5a5f68',
  fontSize: 11,
  textAlign: 'center',
  padding: '24px 8px',
};

const errorRowStyle: React.CSSProperties = {
  background: 'rgba(220,38,38,0.12)',
  color: '#fda4a4',
  border: 'none',
  margin: '0 8px',
  padding: '6px 10px',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 11,
  textAlign: 'left',
};

// ─── collapsed (cover-only tile) styles ─────────────────────────────────────

const tileListStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 6,
  flex: 1,
  minHeight: 0,
  width: '100%',
  paddingBottom: 4,
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

const tileCoverStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
};

const tileInitialStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: 0.5,
  color: '#cbd0d8',
  textTransform: 'uppercase',
};

const tileCreateBtnStyle: React.CSSProperties = {
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
  margin: '0 auto 4px',
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

// ─── hover preview styles ───────────────────────────────────────────────────

const previewStyle: React.CSSProperties = {
  position: 'fixed',
  zIndex: 1500,
  background: '#0d0d0d',
  border: '1px solid #1f1f1f',
  borderRadius: 10,
  boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
  overflow: 'hidden',
  pointerEvents: 'none',
};

const previewCoverStyle: React.CSSProperties = {
  width: '100%',
  height: 130,
  objectFit: 'cover',
  display: 'block',
  background: '#181a20',
};

const previewCoverPlaceholderStyle: React.CSSProperties = {
  width: '100%',
  height: 130,
  background: '#181a20',
  color: '#5a5f68',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const previewBodyStyle: React.CSSProperties = {
  padding: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const previewTitleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: '#e0e0e0',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const previewDescStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#8a8f98',
  lineHeight: 1.4,
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};

const previewFieldsStyle: React.CSSProperties = {
  margin: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const previewRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '52px 1fr',
  gap: 6,
};

const previewDtStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 10,
  color: '#5a5f68',
};

const previewDdStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 11,
  color: '#cbd0d8',
  fontVariantNumeric: 'tabular-nums',
};
