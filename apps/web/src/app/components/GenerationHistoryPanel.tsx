/**
 * 生成历史面板（编辑器左侧）。
 *
 * 后端的 generation-history 模块在每次节点生成成功后会自动写一条记录，
 * 这里就是它的查看 / 复用入口：
 *   - tab 按 nodeType 过滤：全部 / 图 / 视频 / 音频 / 文本
 *   - 关键字搜索 promptText / modelName
 *   - 单击卡片 → onSelect(item) 回调，由上层（useApplyHistoryItem）把节点
 *     还原到当前画布
 *   - hover 卡片显示删除按钮
 *
 * 节流：滚到底自动加载下一页（跟 TemplateGallery 同样套路）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertDialog,
  Badge,
  Button,
  Flex,
  IconButton,
  SegmentedControl,
  Spinner,
  Text,
  TextField,
} from '@radix-ui/themes';
import { Cross2Icon, MagnifyingGlassIcon, TrashIcon } from '@radix-ui/react-icons';
import { History, ImageIcon, Music, Play, Type, Video } from 'lucide-react';
import { toast } from 'sonner';
import {
  generationHistoryService,
  type HistoryListItem,
  type HistoryNodeType,
} from '../services/generationHistoryService';

interface GenerationHistoryPanelProps {
  onSelect?: (item: HistoryListItem) => Promise<boolean | void>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

type TabKey = 'all' | HistoryNodeType;

const PAGE_LIMIT = 20;
const SCROLL_THRESHOLD_PX = 120;

const TABS: { key: TabKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'image', label: '图片' },
  { key: 'video', label: '视频' },
  { key: 'audio', label: '音频' },
  { key: 'text', label: '文本' },
];

function useDebouncedValue<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function NodeTypeIcon({ type }: { type: HistoryNodeType }) {
  const props = { size: 24, color: '#9CA3AF' } as const;
  if (type === 'image') return <ImageIcon {...props} />;
  if (type === 'video') return <Video {...props} />;
  if (type === 'audio') return <Music {...props} />;
  return <Type {...props} />;
}

export function GenerationHistoryPanel({
  onSelect,
  open: controlledOpen,
  onOpenChange,
}: GenerationHistoryPanelProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = (v: boolean) => {
    if (isControlled) onOpenChange?.(v);
    else setInternalOpen(v);
  };

  const [activeTab, setActiveTab] = useState<TabKey>('all');
  const [keyword, setKeyword] = useState('');
  const [items, setItems] = useState<HistoryListItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<HistoryListItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const debouncedKeyword = useDebouncedValue(keyword, 300);

  const fetchPage = useCallback(
    async (targetPage: number, append: boolean) => {
      if (!open) return;
      try {
        if (append) setLoadingMore(true);
        else setLoading(true);
        const res = await generationHistoryService.query({
          nodeType: activeTab === 'all' ? undefined : activeTab,
          keyword: debouncedKeyword || undefined,
          page: targetPage,
          limit: PAGE_LIMIT,
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
    [open, activeTab, debouncedKeyword],
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
  }, [open, activeTab, debouncedKeyword, fetchPage]);

  const handleApply = async (item: HistoryListItem) => {
    if (applyingId) return;
    setApplyingId(item.id);
    try {
      const ok = await onSelect?.(item);
      if (ok) setOpen(false);
    } finally {
      setApplyingId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      setDeleting(true);
      await generationHistoryService.remove(deleteTarget.id);
      setItems((prev) => prev.filter((it) => it.id !== deleteTarget.id));
      toast.success('已删除');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const renderCard = (item: HistoryListItem) => {
    const isApplying = applyingId === item.id;
    // backend writes the .mp4 URL into `thumbnail` for video rows (no
    // separate poster column), so for video we render a <video> element
    // that pulls just the metadata + first frame to act as the cover.
    // image / audio still show as static <img> / icon.
    const isVideoCover = item.nodeType === 'video' && !!item.thumbnail;
    const isImageCover = item.nodeType === 'image' && !!item.thumbnail;
    return (
      <div
        key={item.id}
        className="history-card"
        style={{
          ...cardStyle,
          cursor: isApplying ? 'not-allowed' : 'pointer',
          opacity: isApplying ? 0.7 : 1,
        }}
        onClick={() => !isApplying && handleApply(item)}
      >
        <div style={cardCoverStyle}>
          {isImageCover ? (
            <img
              src={item.thumbnail!}
              alt={item.promptText || item.id}
              style={coverMediaStyle}
            />
          ) : isVideoCover ? (
            // preload="metadata" 只下载视频前若干字节用来渲染首帧 / 时长，
            // 不会拉完整文件；muted + playsInline 确保 iOS 上不被当作
            // 自动播放拒绝；不挂 controls — 卡片只是封面，点击进入复用。
            <video
              src={item.thumbnail!}
              preload="metadata"
              muted
              playsInline
              style={coverMediaStyle}
            />
          ) : (
            <Flex align="center" justify="center" style={{ width: '100%', height: '100%' }}>
              <NodeTypeIcon type={item.nodeType as HistoryNodeType} />
            </Flex>
          )}

          {isVideoCover && (
            // 视频封面是静帧，叠一个播放图标避免被误认为图片
            <div style={videoPlayBadgeStyle}>
              <Play size={14} fill="#fff" color="#fff" />
            </div>
          )}

          {item.nodeType === 'video' && (
            <Badge color="gray" size="1" style={{ position: 'absolute', left: 6, bottom: 6 }}>
              视频
            </Badge>
          )}
          {item.nodeType === 'audio' && (
            <Badge color="gray" size="1" style={{ position: 'absolute', left: 6, bottom: 6 }}>
              音频
            </Badge>
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
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
            title={item.promptText || ''}
          >
            {item.promptText || '(无提示词)'}
          </Text>
          {item.modelName && (
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
              title={item.modelName}
            >
              {item.modelName}
            </Text>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <style>{`
        .history-card:hover .card-actions {
          opacity: 1 !important;
        }
      `}</style>

      <AlertDialog.Root open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialog.Content maxWidth="400px">
          <AlertDialog.Title>确认删除</AlertDialog.Title>
          <AlertDialog.Description>
            确定要删除这条历史记录吗？此操作不可恢复。
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
          title="生成历史"
          style={{
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
            backgroundColor: open ? '#2a2a2a' : '#1C1C1C',
            cursor: 'pointer',
          }}
        >
          <History size={20} />
        </IconButton>
        <span style={triggerLabelStyle}>历史</span>
      </div>

      {open && (
        <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 1100 }}>
          <div style={panelStyle}>
            <Flex justify="between" align="center">
              <Text size="3" weight="bold" style={{ color: '#fff' }}>
                生成历史
              </Text>
              <IconButton variant="ghost" color="gray" onClick={() => setOpen(false)}>
                <Cross2Icon />
              </IconButton>
            </Flex>

            <SegmentedControl.Root value={activeTab} onValueChange={(v) => setActiveTab(v as TabKey)}>
              {TABS.map((t) => (
                <SegmentedControl.Item key={t.key} value={t.key}>
                  {t.label}
                </SegmentedControl.Item>
              ))}
            </SegmentedControl.Root>

            <TextField.Root
              size="2"
              radius="full"
              placeholder="搜索 prompt 或模型名"
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
              ) : items.length === 0 ? (
                <Flex
                  align="center"
                  justify="center"
                  style={{ height: '100%', minHeight: 100 }}
                  direction="column"
                  gap="2"
                >
                  <Text color="gray">暂无生成历史</Text>
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
const listContainerStyle: React.CSSProperties = {
  flex: 1,
  overflow: 'auto',
  paddingRight: 4,
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
const videoPlayBadgeStyle: React.CSSProperties = {
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: 32,
  height: 32,
  borderRadius: '50%',
  background: 'rgba(0,0,0,0.55)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  pointerEvents: 'none',
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
