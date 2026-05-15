// P2 「音色」tab — cloned voices with one-tap preview, create, delete.
//
// Toolbar "+" opens CreateVoiceDialog; 成功后 CreateVoiceDialog 会 dispatch
// VOICE_LIST_REFRESH_EVENT，与本 tab 的 listener 一起刷新列表。
//
// Right-click row → 试听 / 详情 / 删除.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play, Plus, Info, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import {
  voiceService,
  type VoiceItem,
} from '../services/voiceService';
import { VOICE_LIST_REFRESH_EVENT } from '../constants/voiceListRefresh';
import { CreateVoiceDialog } from '../components/CreateVoiceDialog';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { DetailModal, type DetailField } from './DetailModal';

export const SecondaryVoiceList: React.FC = () => {
  const [items, setItems] = useState<VoiceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{
    pos: { x: number; y: number };
    item: VoiceItem;
  } | null>(null);
  const [detail, setDetail] = useState<VoiceItem | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  const fetchList = useCallback(async () => {
    try {
      setLoading(true);
      const list = await voiceService.getVoices({ status: 'SUCCESS' });
      setItems(list);
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

  useEffect(() => {
    const handler = () => void fetchList();
    window.addEventListener(VOICE_LIST_REFRESH_EVENT, handler);
    return () => window.removeEventListener(VOICE_LIST_REFRESH_EVENT, handler);
  }, [fetchList]);

  // Stop the shared audio on unmount so the user doesn't get
  // ghost-playback after switching tabs.
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  const handlePlay = useCallback((item: VoiceItem) => {
    if (!item.demoAudioUrl) return;

    if (playingId === item.id) {
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }

    audioRef.current?.pause();
    const audio = new Audio(item.demoAudioUrl);
    audio.onended = () => setPlayingId(null);
    void audio.play();
    audioRef.current = audio;
    setPlayingId(item.id);
  }, [playingId]);

  const handleDelete = useCallback(async (item: VoiceItem) => {
    if (!window.confirm(`确认删除音色「${item.name}」？该操作不可恢复。`)) return;
    try {
      await voiceService.deleteVoice(item.id);
      setItems((prev) => prev.filter((v) => v.id !== item.id));
      // Stop any playback of the deleted voice.
      if (playingId === item.id) {
        audioRef.current?.pause();
        setPlayingId(null);
      }
      toast.success('已删除');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  }, [playingId]);

  const ctxItems: ContextMenuItem[] = ctxMenu
    ? [
        {
          label: ctxMenu.item.demoAudioUrl
            ? playingId === ctxMenu.item.id ? '暂停试听' : '试听'
            : '无试听音频',
          icon: playingId === ctxMenu.item.id ? <Pause size={14} /> : <Play size={14} />,
          disabled: !ctxMenu.item.demoAudioUrl,
          onClick: () => handlePlay(ctxMenu.item),
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
        { label: 'Voice ID', value: detail.voiceId, copyable: true, monospace: true },
        { label: '名称', value: detail.name },
        { label: '状态', value: detail.status },
        { label: '错误信息', value: detail.errorMsg ?? '' },
        {
          label: '试听 URL',
          value: detail.demoAudioUrl ?? '',
          copyable: !!detail.demoAudioUrl,
          monospace: true,
        },
        {
          label: '创建于',
          value: new Date(detail.createdAt).toLocaleString(),
        },
      ]
    : [];

  return (
    <div style={containerStyle}>
      <div style={toolbarStyle}>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          style={createBtnStyle}
          title="克隆新音色"
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
          }}
        >
          <Plus size={14} />
          <span style={createLabelStyle}>克隆音色</span>
        </button>
      </div>

      {loading && items.length === 0 ? (
        <div style={dimStyle}>加载中…</div>
      ) : error ? (
        <div style={errorStyle}>
          {error}
          <button type="button" style={retryStyle} onClick={() => void fetchList()}>
            重试
          </button>
        </div>
      ) : items.length === 0 ? (
        <div style={dimStyle}>暂无自定义音色</div>
      ) : (
        <ul style={listStyle}>
          {items.map((item) => {
            const playing = playingId === item.id;
            const playable = !!item.demoAudioUrl;
            return (
              <li key={item.id}>
                <div
                  style={rowStyle}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setCtxMenu({ pos: { x: e.clientX, y: e.clientY }, item });
                  }}
                >
                  <button
                    type="button"
                    onClick={() => handlePlay(item)}
                    disabled={!playable}
                    style={{
                      ...playBtnStyle,
                      cursor: playable ? 'pointer' : 'not-allowed',
                      color: playable ? '#e0e0e0' : '#3f4451',
                    }}
                    title={playable ? (playing ? '暂停试听' : '试听') : '无试听音频'}
                  >
                    {playing ? <Pause size={14} /> : <Play size={14} />}
                  </button>
                  <div style={textColStyle}>
                    <span style={titleStyle}>{item.name}</span>
                    <span style={metaStyle}>
                      {item.voiceId.slice(0, 16)}
                      {item.voiceId.length > 16 ? '…' : ''}
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {showCreate && (
        <CreateVoiceDialog
          open={showCreate}
          onClose={() => setShowCreate(false)}
          onSuccess={() => {
            setShowCreate(false);
            void fetchList();
          }}
        />
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
          title={`音色 · ${detail.name}`}
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
  padding: 6,
  borderRadius: 8,
};

const playBtnStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 6,
  background: '#181a20',
  border: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  transition: 'background 0.15s, color 0.15s',
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
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
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
