// P2 「模板」tab — slim list of workflow templates.
//
// Same trim-down strategy as SecondaryHistoryList: pull the data from the
// existing `templatesService` but render inline (no popover, no tag filter,
// no edit/delete actions). The full TemplateGallery feature set lives in
// settings if/when we ever surface a "manage templates" page.
//
// Click → calls `applyTemplateAsset` registered by EditorPage in uiStore,
// which spawns the template's nodes/edges into the current canvas.

import React, { useCallback, useEffect, useState } from 'react';
import { LayoutTemplate } from 'lucide-react';
import { toast } from 'sonner';

import {
  templatesService,
  type TemplateAsset,
} from '../services/templatesService';
import { useUIStore } from '../store/uiStore';

const PAGE_LIMIT = 30;

export const SecondaryTemplateList: React.FC = () => {
  const [items, setItems] = useState<TemplateAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    return <div style={dimStyle}>暂无模板</div>;
  }

  return (
    <ul style={listStyle}>
      {items.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            onClick={() => void handleClick(item)}
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
  );
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
