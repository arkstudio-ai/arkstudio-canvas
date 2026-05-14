/**
 * 工作流模板库面板（编辑器左侧）。
 *
 * 由 EditorPage 通过 EditorLeftRail 的 extraButtons 注入。点击 PanelLeft
 * 图标展开右侧 Panel，面板里展示后端 `/templates` 返回的模板列表，
 * 用户可以：
 *   - 关键字 / 标签搜索
 *   - 单击卡片应用模板到当前画布（onSelect 回调，由上层接 useApplyTemplateAsset）
 *   - hover 卡片显示编辑/删除按钮
 *
 * 与商业版 FlowGroupGallery 的差异：
 *   - 没有 my/public Tab：开源版无登录态，所有模板共享
 *   - 没有发布申请按钮（publishRequestService 已删）
 *   - 没有 UserMenu / Admin 按钮（这些在 EditorTopLeftBar）
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertDialog,
  Badge,
  Button,
  Flex,
  IconButton,
  Spinner,
  Text,
  TextField,
} from '@radix-ui/themes';
import { Cross2Icon, MagnifyingGlassIcon, Pencil1Icon, TrashIcon } from '@radix-ui/react-icons';
import { PanelLeft } from 'lucide-react';
import { toast } from 'sonner';
import {
  templatesService,
  type TemplateAsset,
  type TemplateTag,
} from '../services/templatesService';
import { TemplateEditDialog } from './TemplateEditDialog';

interface TemplateGalleryProps {
  /** 单击卡片时回调；返回 true 表示应用成功，会自动关掉面板。 */
  onSelect?: (asset: TemplateAsset) => Promise<boolean | void>;
  /** 受控的开关状态（EditorPage 用来跟其他面板互斥） */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

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

const buildTags = (raw: string): TemplateTag[] => {
  return raw
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
    .map((value) => ({ category: 'tag', value }));
};

export function TemplateGallery({ onSelect, open: controlledOpen, onOpenChange }: TemplateGalleryProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = (value: boolean) => {
    if (isControlled) onOpenChange?.(value);
    else setInternalOpen(value);
  };

  const [keyword, setKeyword] = useState('');
  const [tagQuery, setTagQuery] = useState('');
  const [items, setItems] = useState<TemplateAsset[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TemplateAsset | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editTarget, setEditTarget] = useState<TemplateAsset | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  const debouncedKeyword = useDebouncedValue(keyword, 300);
  const debouncedTagQuery = useDebouncedValue(tagQuery, 300);
  const parsedTags = useMemo(() => buildTags(debouncedTagQuery), [debouncedTagQuery]);

  const fetchPage = useCallback(
    async (targetPage: number, append: boolean) => {
      if (!open) return;
      try {
        if (append) setLoadingMore(true);
        else setLoading(true);
        const res = await templatesService.query({
          page: targetPage,
          limit: PAGE_LIMIT,
          keyword: debouncedKeyword || undefined,
          tags: parsedTags.length ? parsedTags : undefined,
        });
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
    [open, debouncedKeyword, parsedTags],
  );

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || loading || loadingMore || page >= totalPages) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    if (scrollTop + clientHeight >= scrollHeight - SCROLL_THRESHOLD_PX) {
      void fetchPage(page + 1, true);
    }
  }, [fetchPage, loading, loadingMore, page, totalPages]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  useEffect(() => {
    if (!open) return;
    setPage(1);
    setTotalPages(1);
    setItems([]);
    void fetchPage(1, false);
  }, [open, debouncedKeyword, parsedTags, fetchPage]);

  const handleApply = async (item: TemplateAsset) => {
    if (applyingId) return;
    setApplyingId(item.id);
    try {
      const success = await onSelect?.(item);
      if (success) setOpen(false);
    } finally {
      setApplyingId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      setDeleting(true);
      await templatesService.remove(deleteTarget.id);
      setItems((prev) => prev.filter((it) => it.id !== deleteTarget.id));
      toast.success('模板已删除');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const renderCard = (item: TemplateAsset) => {
    const isApplying = applyingId === item.id;
    return (
      <div
        key={item.id}
        className="template-card"
        style={{
          ...cardStyle,
          cursor: isApplying ? 'not-allowed' : 'pointer',
          opacity: isApplying ? 0.7 : 1,
        }}
        onClick={() => !isApplying && handleApply(item)}
      >
        <div style={cardCoverStyle}>
          {item.cover ? (
            <img src={item.cover} alt={item.name} style={coverMediaStyle} />
          ) : (
            <Flex align="center" justify="center" style={{ width: '100%', height: '100%', color: '#9CA3AF' }}>
              <Text>{item.name.slice(0, 2)}</Text>
            </Flex>
          )}

          {isApplying && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(0,0,0,0.5)',
              }}
            >
              <Spinner />
            </div>
          )}

          <div className="card-actions" style={cardActionsStyle}>
            <IconButton
              size="1"
              variant="solid"
              color="gray"
              onClick={(e) => {
                e.stopPropagation();
                setEditTarget(item);
              }}
              title="编辑"
              style={{ background: 'rgba(0,0,0,0.7)' }}
            >
              <Pencil1Icon />
            </IconButton>
            <IconButton
              size="1"
              variant="solid"
              color="red"
              onClick={(e) => {
                e.stopPropagation();
                setDeleteTarget(item);
              }}
              title="删除"
              style={{ background: 'rgba(220,38,38,0.8)' }}
            >
              <TrashIcon />
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
          {item.tags.length > 0 && (
            <Flex gap="1" wrap="wrap" mt="1">
              {item.tags.slice(0, 3).map((tag) => (
                <Badge key={`${item.id}-${tag.category}-${tag.value}`} color="gray" size="1">
                  {tag.value}
                </Badge>
              ))}
            </Flex>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <style>{`
        .template-card:hover .card-actions {
          opacity: 1 !important;
        }
      `}</style>

      {editTarget && (
        <TemplateEditDialog
          asset={editTarget}
          onClose={() => setEditTarget(null)}
          onSave={() => {
            setEditTarget(null);
            void fetchPage(1, false);
          }}
        />
      )}

      <AlertDialog.Root open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialog.Content maxWidth="400px">
          <AlertDialog.Title>确认删除</AlertDialog.Title>
          <AlertDialog.Description>
            确定要删除模板「{deleteTarget?.name}」吗？此操作不可恢复。
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray" disabled={deleting}>
                取消
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button variant="solid" color="red" onClick={handleConfirmDelete} disabled={deleting}>
                {deleting ? <Spinner /> : '删除'}
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>

      <div style={triggerWrapStyle}>
        <IconButton
          variant="solid"
          color="gray"
          size="3"
          radius="full"
          onClick={() => setOpen(!open)}
          title="工作流模板"
          style={{
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
            backgroundColor: open ? '#2a2a2a' : '#1C1C1C',
            cursor: 'pointer',
          }}
        >
          <PanelLeft size={20} />
        </IconButton>
        <span style={triggerLabelStyle}>模板</span>
      </div>

      {open && (
        <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 1100 }}>
          <div style={panelStyle}>
            <Flex justify="between" align="center">
              <Text size="3" weight="bold" style={{ color: '#fff' }}>
                工作流模板
              </Text>
              <IconButton variant="ghost" color="gray" onClick={() => setOpen(false)}>
                <Cross2Icon />
              </IconButton>
            </Flex>

            <Flex gap="3" direction="column">
              <TextField.Root
                size="2"
                radius="full"
                placeholder="搜索名称"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
              >
                <TextField.Slot>
                  <MagnifyingGlassIcon />
                </TextField.Slot>
              </TextField.Root>
              <TextField.Root
                size="2"
                radius="full"
                placeholder="标签，逗号分隔"
                value={tagQuery}
                onChange={(e) => setTagQuery(e.target.value)}
              />
            </Flex>

            <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', paddingRight: 4, minHeight: 200 }}>
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
              ) : items.length === 0 ? (
                <Flex
                  align="center"
                  justify="center"
                  style={{ height: '100%', minHeight: 100 }}
                  direction="column"
                  gap="2"
                >
                  <Text color="gray">暂无模板</Text>
                </Flex>
              ) : (
                <div style={gridStyle}>{items.map(renderCard)}</div>
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
};
const cardCoverStyle: React.CSSProperties = {
  position: 'relative',
  width: '100%',
  aspectRatio: '1 / 1',
  borderRadius: 8,
  overflow: 'hidden',
  background: 'linear-gradient(135deg, #1f2937 0%, #111827 100%)',
};
const coverMediaStyle: React.CSSProperties = {
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
