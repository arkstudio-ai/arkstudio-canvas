/**
 * 画布管理面板（开源版唯一的"我的画布"入口）。
 *
 * 商业版 WorkspacePage 是独立路由，开源版直接砍掉，把功能内聚到编辑器
 * 左侧浮动按钮里 — 用户开 Canvas 后从这里切换/新建/编辑/删除画布。
 *
 * 与商业版的差异：
 *   - 没有 isLoggedIn 校验（开源版无登录态，所有人共享同一份画布列表）
 *   - 没有 ownerId 显示
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertDialog, Button, Flex, IconButton, Spinner, Text, TextField } from '@radix-ui/themes';
import { Cross2Icon, MagnifyingGlassIcon, PlusIcon } from '@radix-ui/react-icons';
import { FolderOpen, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { canvasService, type CanvasItem } from '../services/canvasService';
import { lastFlowStore } from '../services/lastFlowStore';
import { CanvasEditDialog } from './CanvasEditDialog';

const PAGE_LIMIT = 20;
const SCROLL_THRESHOLD_PX = 120;

function useDebouncedValue<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

interface CanvasGalleryProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** 当前打开的画布 ID，用于在列表里高亮 */
  currentFlowId?: string | null;
}

export function CanvasGallery({ open: controlledOpen, onOpenChange, currentFlowId }: CanvasGalleryProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = (v: boolean) => {
    if (isControlled) onOpenChange?.(v);
    else setInternalOpen(v);
  };

  const [keyword, setKeyword] = useState('');
  const [items, setItems] = useState<CanvasItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [editingCanvas, setEditingCanvas] = useState<CanvasItem | null>(null);
  const [deletingCanvas, setDeletingCanvas] = useState<CanvasItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [applyingCanvas, setApplyingCanvas] = useState<CanvasItem | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const debouncedKeyword = useDebouncedValue(keyword, 300);

  const filteredItems = useMemo(() => {
    if (!debouncedKeyword) return items;
    const kw = debouncedKeyword.toLowerCase();
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(kw) ||
        (item.description || '').toLowerCase().includes(kw),
    );
  }, [items, debouncedKeyword]);

  const fetchPage = useCallback(
    async (targetPage: number, append: boolean) => {
      if (!open) return;
      try {
        if (append) setLoadingMore(true);
        else setLoading(true);
        const res = await canvasService.queryCanvases({ page: targetPage, limit: PAGE_LIMIT });
        setError(null);
        setPage(targetPage);
        setTotalPages(res.meta.totalPages);
        setItems((prev) => (append ? [...prev, ...res.items] : res.items));
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载失败');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [open],
  );

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || loading || loadingMore || page >= totalPages) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    if (scrollTop + clientHeight >= scrollHeight - SCROLL_THRESHOLD_PX) {
      void fetchPage(page + 1, true);
    }
  }, [loading, loadingMore, page, totalPages, fetchPage]);

  useEffect(() => {
    if (open) {
      setItems([]);
      setPage(1);
      setTotalPages(1);
      setKeyword('');
      void fetchPage(1, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  const handleDelete = async () => {
    if (!deletingCanvas) return;
    try {
      setDeleting(true);
      await canvasService.deleteCanvas(deletingCanvas.id);
      setItems((prev) => prev.filter((i) => i.id !== deletingCanvas.id));
      // 如果删的就是当前画布，把 lastFlowStore 也清掉，避免下次进来又被复用导致 404。
      if (deletingCanvas.id === currentFlowId) {
        lastFlowStore.clear();
      }
      toast.success('画布已删除');
      setDeletingCanvas(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeleting(false);
    }
  };

  const handleApplyCanvas = () => {
    if (!applyingCanvas) return;
    const url = new URL(window.location.href);
    url.searchParams.set('flowId', applyingCanvas.id);
    window.location.href = url.toString();
  };

  const handleCreate = async () => {
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
  };

  const renderCard = (item: CanvasItem) => {
    const isCurrent = item.id === currentFlowId;
    return (
      <div
        key={item.id}
        className="canvas-card"
        style={{
          ...cardStyle,
          // box-shadow 比 outline 更可控：outline 会被父级 overflow:auto 裁掉，
          // 而 box-shadow 配合 position:relative + zIndex 能浮在相邻卡片之上。
          ...(isCurrent
            ? {
                boxShadow: '0 0 0 2px #4f46e5',
                zIndex: 1,
              }
            : {}),
        }}
        onClick={() => setApplyingCanvas(item)}
      >
        <div style={cardCoverStyle}>
          {item.cover ? (
            <img src={item.cover} alt={item.name} style={coverImgStyle} />
          ) : (
            <Flex align="center" justify="center" style={{ width: '100%', height: '100%', color: '#9CA3AF' }}>
              <Text>{item.name.slice(0, 2)}</Text>
            </Flex>
          )}

          <div className="card-actions" style={cardActionsStyle}>
            <IconButton
              size="1"
              variant="solid"
              color="gray"
              onClick={(e) => {
                e.stopPropagation();
                setEditingCanvas(item);
              }}
              title="编辑"
              style={{ background: 'rgba(0,0,0,0.7)' }}
            >
              <Pencil size={12} />
            </IconButton>
            <IconButton
              size="1"
              variant="solid"
              color="red"
              onClick={(e) => {
                e.stopPropagation();
                setDeletingCanvas(item);
              }}
              title="删除"
              style={{ background: 'rgba(220,38,38,0.8)' }}
            >
              <Trash2 size={12} />
            </IconButton>
          </div>
        </div>
        <div style={cardBodyStyle}>
          <Text
            as="div"
            size="1"
            style={{
              color: '#fff',
              lineHeight: 1.3,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={item.name}
          >
            {item.name}
          </Text>
          {item.description && (
            <Text
              as="div"
              size="1"
              color="gray"
              style={{
                lineHeight: 1.3,
                opacity: 0.7,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={item.description}
            >
              {item.description}
            </Text>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <style>{`
        .canvas-card:hover .card-actions {
          opacity: 1 !important;
        }
      `}</style>

      <div style={triggerWrapStyle}>
        <IconButton
          variant="solid"
          color="gray"
          size="3"
          radius="full"
          onClick={() => setOpen(!open)}
          style={{
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
            backgroundColor: open ? '#2a2a2a' : '#1C1C1C',
            cursor: 'pointer',
          }}
          title="我的画布"
        >
          <FolderOpen size={20} />
        </IconButton>
        <span style={triggerLabelStyle}>画布</span>
      </div>

      {open && (
        <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 1100 }}>
          <div style={panelStyle}>
            <Flex justify="between" align="center">
              <Text size="3" weight="bold" style={{ color: '#fff' }}>
                我的画布
              </Text>
              <Flex gap="2" align="center">
                <Button size="1" variant="solid" onClick={handleCreate} disabled={creating}>
                  {creating ? <Spinner /> : <PlusIcon />}
                  新建
                </Button>
                <IconButton variant="ghost" color="gray" onClick={() => setOpen(false)}>
                  <Cross2Icon />
                </IconButton>
              </Flex>
            </Flex>

            <TextField.Root
              size="2"
              radius="full"
              placeholder="搜索画布..."
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            >
              <TextField.Slot>
                <MagnifyingGlassIcon />
              </TextField.Slot>
            </TextField.Root>

            <div ref={scrollRef} style={listContainerStyle}>
              {loading && items.length === 0 ? (
                <Flex align="center" justify="center" style={{ height: '100%', minHeight: 100 }} gap="2">
                  <Spinner />
                  <Text color="gray">加载中...</Text>
                </Flex>
              ) : error ? (
                <Flex
                  direction="column"
                  align="center"
                  justify="center"
                  gap="2"
                  style={{ height: '100%', minHeight: 100 }}
                >
                  <Text color="red">{error}</Text>
                  <Button variant="soft" onClick={() => fetchPage(1, false)}>
                    重试
                  </Button>
                </Flex>
              ) : filteredItems.length === 0 ? (
                <Flex
                  align="center"
                  justify="center"
                  style={{ height: '100%', minHeight: 100 }}
                  direction="column"
                  gap="2"
                >
                  <Text color="gray">{keyword ? '未找到匹配的画布' : '暂无画布，点右上"新建"创建一张'}</Text>
                </Flex>
              ) : (
                <div style={gridStyle}>{filteredItems.map(renderCard)}</div>
              )}

              {loadingMore && (
                <Flex align="center" justify="center" gap="2" style={{ padding: 12 }}>
                  <Spinner />
                  <Text color="gray">加载更多...</Text>
                </Flex>
              )}
            </div>
          </div>
        </div>
      )}

      {editingCanvas && (
        <CanvasEditDialog
          canvas={editingCanvas}
          onClose={() => setEditingCanvas(null)}
          onSave={() => {
            setEditingCanvas(null);
            void fetchPage(1, false);
          }}
        />
      )}

      <AlertDialog.Root open={!!deletingCanvas} onOpenChange={(o) => !o && setDeletingCanvas(null)}>
        <AlertDialog.Content maxWidth="400px">
          <AlertDialog.Title>确认删除</AlertDialog.Title>
          <AlertDialog.Description>
            确定要删除画布「{deletingCanvas?.name}」吗？此操作不可恢复。
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray" disabled={deleting}>
                取消
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button color="red" onClick={handleDelete} disabled={deleting}>
                {deleting ? <Spinner /> : '删除'}
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>

      <AlertDialog.Root open={!!applyingCanvas} onOpenChange={(o) => !o && setApplyingCanvas(null)}>
        <AlertDialog.Content maxWidth="400px">
          <AlertDialog.Title>切换画布</AlertDialog.Title>
          <AlertDialog.Description>
            打开画布「{applyingCanvas?.name}」？当前页面将刷新。
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">
                取消
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button color="blue" onClick={handleApplyCanvas}>
                确定
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </>
  );
}

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  left: 64,
  top: '50%',
  transform: 'translateY(-50%)',
  width: 380,
  maxHeight: '80vh',
  background: '#0d0f14',
  borderRadius: 16,
  border: '1px solid rgba(255,255,255,0.08)',
  boxShadow: '0 20px 60px rgba(0,0,0,0.55)',
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  pointerEvents: 'auto',
};
const listContainerStyle: React.CSSProperties = {
  flex: 1,
  overflow: 'auto',
  // 上下左右都留 4px，避免高亮卡片的 2px box-shadow 贴边时被滚动容器裁掉
  padding: 4,
  minHeight: 200,
};
const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
  gap: 12,
};
const cardStyle: React.CSSProperties = {
  borderRadius: 12,
  background: '#1a1b1f',
  padding: 8,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  position: 'relative',
  cursor: 'pointer',
};
const cardCoverStyle: React.CSSProperties = {
  position: 'relative',
  width: '100%',
  aspectRatio: '1 / 1',
  borderRadius: 8,
  overflow: 'hidden',
  background: 'linear-gradient(135deg, #1f2937 0%, #111827 100%)',
};
const coverImgStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
};
const cardActionsStyle: React.CSSProperties = {
  position: 'absolute',
  top: 6,
  right: 6,
  display: 'flex',
  gap: 4,
  opacity: 0,
  transition: 'opacity 0.2s',
};
const cardBodyStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 0,
};
const triggerWrapStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4,
};
const triggerLabelStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#bdbdbd',
  letterSpacing: '0.05em',
  userSelect: 'none',
};
