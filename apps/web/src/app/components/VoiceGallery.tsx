/**
 * 自定义音色面板（开源版：无登录态、全局共享）。
 *
 * 入口：编辑器左下角的麦克风按钮。点开后展示所有音色，可试听 / 删除 /
 * 创建新音色。创建走 CreateVoiceDialog（支持上传文件 + 浏览器录音两种来源）。
 *
 * 商业版残留的 isOwner / isPublic / "我的"标签在这里被一次性清掉，避免
 * 看起来像还有一套权限系统而其实没有。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertDialog, Button, Flex, IconButton, Spinner, Text } from '@radix-ui/themes';
import { Cross2Icon } from '@radix-ui/react-icons';
import { Mic, Play, Pause, Trash2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { voiceService, VoiceItem } from '../services/voiceService';
import { CreateVoiceDialog } from './CreateVoiceDialog';

interface VoiceGalleryProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** 跨组件刷新音色列表的事件名（CreateVoiceDialog 与 useVoiceOptions 都监听） */
export const VOICE_LIST_REFRESH_EVENT = 'voice-list-refresh';

export function VoiceGallery({ open: controlledOpen, onOpenChange }: VoiceGalleryProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;

  const setOpen = (value: boolean) => {
    if (isControlled) onOpenChange?.(value);
    else setInternalOpen(value);
  };

  const [items, setItems] = useState<VoiceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VoiceItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  const fetchVoices = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    setError(null);
    try {
      const list = await voiceService.getVoices({ status: 'SUCCESS' });
      setItems(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [open]);

  useEffect(() => { fetchVoices(); }, [fetchVoices]);

  useEffect(() => {
    const handleRefresh = () => fetchVoices();
    window.addEventListener(VOICE_LIST_REFRESH_EVENT, handleRefresh);
    return () => window.removeEventListener(VOICE_LIST_REFRESH_EVENT, handleRefresh);
  }, [fetchVoices]);

  const handlePlay = (item: VoiceItem) => {
    if (!item.demoAudioUrl) return;
    if (playingId === item.id) {
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }
    audioRef.current?.pause();
    const audio = new Audio(item.demoAudioUrl);
    audio.onended = () => setPlayingId(null);
    audio.play();
    audioRef.current = audio;
    setPlayingId(item.id);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await voiceService.deleteVoice(deleteTarget.id);
      setItems((prev) => prev.filter((v) => v.id !== deleteTarget.id));
      window.dispatchEvent(new Event(VOICE_LIST_REFRESH_EVENT));
      toast.success(`已删除音色「${deleteTarget.name}」`);
      setDeleteTarget(null);
    } catch (err) {
      // 严格策略下，上游 delete_voice 失败 = 本地也不删；此时弹错让用户感知，
      // 同时**不关闭**确认弹窗，方便用户重试。
      const msg = err instanceof Error ? err.message : '删除音色失败';
      console.error('删除音色失败:', err);
      toast.error(msg);
    } finally {
      setDeleting(false);
    }
  };

  const handleCreateSuccess = () => {
    setShowCreate(false);
    fetchVoices();
    window.dispatchEvent(new Event(VOICE_LIST_REFRESH_EVENT));
  };

  const renderCard = (item: VoiceItem) => {
    const isPlaying = playingId === item.id;
    return (
      <div key={item.id} style={cardStyle}>
        <div style={iconContainerStyle}>
          <Mic size={20} color="#8b5cf6" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text size="2" weight="bold" style={{ color: '#fff' }}>{item.name}</Text>
          <div>
            <Text size="1" style={{ color: '#666' }}>
              {item.demoAudioUrl ? '可试听' : '无试听样本'}
            </Text>
          </div>
        </div>
        <Flex gap="2" align="center">
          {item.demoAudioUrl && (
            <IconButton
              size="1"
              variant="ghost"
              color="gray"
              onClick={(e) => { e.stopPropagation(); handlePlay(item); }}
              title={isPlaying ? '停止' : '试听'}
            >
              {isPlaying ? <Pause size={14} /> : <Play size={14} />}
            </IconButton>
          )}
          <IconButton
            size="1"
            variant="ghost"
            color="red"
            onClick={(e) => { e.stopPropagation(); setDeleteTarget(item); }}
            title="删除"
          >
            <Trash2 size={14} />
          </IconButton>
        </Flex>
      </div>
    );
  };

  return (
    <>
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
        title="自定义音色"
      >
        <Mic size={20} />
      </IconButton>

      {open && (
        <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 1100 }}>
          <div style={panelStyle}>
            <Flex justify="between" align="center">
              <Text size="2" weight="bold" style={{ color: '#fff' }}>自定义音色</Text>
              <Flex gap="2" align="center">
                <IconButton
                  size="1"
                  variant="soft"
                  color="violet"
                  onClick={() => setShowCreate(true)}
                  title="创建音色"
                >
                  <Plus size={14} />
                </IconButton>
                <IconButton variant="ghost" color="gray" onClick={() => setOpen(false)}>
                  <Cross2Icon />
                </IconButton>
              </Flex>
            </Flex>

            <div style={listContainerStyle}>
              {loading ? (
                <Flex align="center" justify="center" style={{ height: '100%', minHeight: 100 }} gap="2">
                  <Spinner /><Text color="gray">加载中...</Text>
                </Flex>
              ) : error ? (
                <Flex direction="column" align="center" justify="center" gap="2" style={{ height: '100%' }}>
                  <Text color="red">{error}</Text>
                  <Button variant="soft" size="1" onClick={fetchVoices}>重试</Button>
                </Flex>
              ) : items.length === 0 ? (
                <Flex direction="column" align="center" justify="center" gap="3" style={{ height: '100%', minHeight: 100 }}>
                  <Text color="gray">暂无音色</Text>
                  <Button variant="soft" size="1" onClick={() => setShowCreate(true)}>
                    <Plus size={14} />创建音色
                  </Button>
                </Flex>
              ) : (
                <Flex direction="column" gap="2">{items.map(renderCard)}</Flex>
              )}
            </div>
          </div>
        </div>
      )}

      <AlertDialog.Root open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialog.Content maxWidth="400px">
          <AlertDialog.Title>确认删除</AlertDialog.Title>
          <AlertDialog.Description>
            确定要删除音色「{deleteTarget?.name}」吗？此操作不可恢复。
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel><Button variant="soft" color="gray" disabled={deleting}>取消</Button></AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button variant="solid" color="red" onClick={handleDelete} disabled={deleting}>
                {deleting ? <Spinner /> : '删除'}
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>

      <CreateVoiceDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSuccess={handleCreateSuccess}
      />
    </>
  );
}

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  left: 64,
  top: '50%',
  transform: 'translateY(-50%)',
  width: 320,
  maxHeight: '70vh',
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
  minHeight: 150,
};

const cardStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '10px 12px',
  borderRadius: 10,
  background: '#1a1b1f',
};

const iconContainerStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 8,
  background: 'rgba(139, 92, 246, 0.15)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};
