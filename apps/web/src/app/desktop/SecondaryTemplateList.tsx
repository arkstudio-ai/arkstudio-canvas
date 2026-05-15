// P2 「模板」tab — workflow templates with one-tap apply + create + manage.
//
// Tab toolbar has a "+ 创建模板" button. The only way to actually mint a
// template is "select nodes on the canvas → group → click the group's
// save icon" — there's no dedicated dialog (templatesService.create needs
// graph data). So the + button is an info-only affordance: it surfaces a
// toast explaining the flow. We deliberately keep it visible (not hidden)
// so users learn the affordance exists.
//
// Right-click row → 详情 / 应用到画布 / 删除.

import React, { useCallback, useEffect, useState } from 'react';
import { LayoutTemplate, Plus, Info, Trash2, Play } from 'lucide-react';
import { toast } from 'sonner';

import {
  templatesService,
  type TemplateAsset,
} from '../services/templatesService';
import { useUIStore } from '../store/uiStore';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { DetailModal, type DetailField } from './DetailModal';

const PAGE_LIMIT = 30;

export const SecondaryTemplateList: React.FC = () => {
  const [items, setItems] = useState<TemplateAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{
    pos: { x: number; y: number };
    item: TemplateAsset;
  } | null>(null);
  const [detail, setDetail] = useState<TemplateAsset | null>(null);
  const apply = useUIStore((s) => s.applyTemplateAsset);

  const fetchPage = useCallback(async () => {
    try {
      setLoading(true);
      const res = await templatesService.query({
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
    async (item: TemplateAsset) => {
      if (!apply) {
        toast.info('画布尚未就绪，稍后再试');
        return;
      }
      try {
        await apply(item);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '应用模板失败');
      }
    },
    [apply],
  );

  const handleCreateHint = useCallback(() => {
    toast.info('在画布选中多个节点 → 右键创建编组 → 点击编组保存图标');
  }, []);

  const handleDelete = useCallback(async (item: TemplateAsset) => {
    if (!window.confirm(`确认删除模板「${item.name}」？该操作不可恢复。`)) return;
    try {
      await templatesService.remove(item.id);
      setItems((prev) => prev.filter((t) => t.id !== item.id));
      toast.success('已删除');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  }, []);

  const ctxItems: ContextMenuItem[] = ctxMenu
    ? [
        {
          label: '应用到画布',
          icon: <Play size={14} />,
          onClick: () => void handleClick(ctxMenu.item),
        },
        {
          label: '详细信息',
          icon: <Info size={14} />,
          onClick: () => setDetail(ctxMenu.item),
        },
        { divider: true, label: '' },
        {
          label: '删除',
          icon: <Trash2 size={14} />,
          danger: true,
          onClick: () => void handleDelete(ctxMenu.item),
        },
      ]
    : [];

  const detailFields: DetailField[] = detail
    ? [
        { label: 'ID', value: detail.id, copyable: true, monospace: true },
        { label: '名称', value: detail.name },
        { label: '描述', value: detail.description ?? '' },
        {
          label: '标签',
          value: detail.tags.map((t) => `${t.category}:${t.value}`).join(', '),
        },
        {
          label: '启用',
          value: detail.enabled ? '是' : '否',
        },
        {
          label: '创建于',
          value: new Date(detail.createdAt).toLocaleString(),
        },
        {
          label: '更新于',
          value: new Date(detail.updatedAt).toLocaleString(),
        },
      ]
    : [];

  return (
    <div style={containerStyle}>
      <div style={toolbarStyle}>
        <button
          type="button"
          onClick={handleCreateHint}
          style={createBtnStyle}
          title="如何创建模板"
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
          }}
        >
          <Plus size={14} />
          <span style={createLabelStyle}>创建模板</span>
        </button>
      </div>

      {loading && items.length === 0 ? (
        <div style={dimStyle}>加载中…</div>
      ) : error ? (
        <div style={errorStyle}>
          {error}
          <button type="button" style={retryStyle} onClick={() => void fetchPage()}>
            重试
          </button>
        </div>
      ) : items.length === 0 ? (
        <div style={dimStyle}>暂无模板</div>
      ) : (
        <ul style={listStyle}>
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => void handleClick(item)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setCtxMenu({ pos: { x: e.clientX, y: e.clientY }, item });
                }}
                style={rowStyle}
                title={item.description ?? item.name}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                {item.cover ? (
                  <img src={item.cover} alt="" style={thumbStyle} />
                ) : (
                  <div style={iconBoxStyle}>
                    <LayoutTemplate size={16} />
                  </div>
                )}
                <div style={textColStyle}>
                  <span style={titleStyle}>{item.name}</span>
                  {item.description && (
                    <span style={metaStyle}>{item.description}</span>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {ctxMenu && (
        <ContextMenu
          position={ctxMenu.pos}
          items={ctxItems}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {detail && (
        <DetailModal
          title={`模板 · ${detail.name}`}
          fields={detailFields}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
};

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  height: '100%',
};

const toolbarStyle: React.CSSProperties = {
  display: 'flex',
  paddingBottom: 4,
  borderBottom: '1px solid #1a1a1a',
  marginBottom: 4,
};

const createBtnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flex: 1,
  padding: '6px 8px',
  borderRadius: 6,
  border: 'none',
  background: 'transparent',
  color: '#cbd0d8',
  fontSize: 12,
  textAlign: 'left',
  cursor: 'pointer',
  transition: 'background 0.15s',
};

const createLabelStyle: React.CSSProperties = {
  flex: 1,
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
