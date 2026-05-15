// P2 「音色」tab — slim list of cloned voices with one-tap preview.
//
// Read-only on purpose: creating / deleting voices belongs in a settings
// surface (or a dedicated dialog) rather than the rail. The rail is for
// "I want to use one of these in my canvas" workflows; clicking play is
// the only interaction users normally take here.
//
// Listens to the `voice-list-refresh` event (same one CreateVoiceDialog
// dispatches when a clone finishes) so brand-new voices appear without
// the user having to switch tabs.
//
// Audio playback uses one shared <Audio> element kept in a ref. Playing
// a second item swaps the source so we never overlap audio.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';

import {
  voiceService,
  type VoiceItem,
} from '../services/voiceService';
import { VOICE_LIST_REFRESH_EVENT } from '../components/VoiceGallery';

export const SecondaryVoiceList: React.FC = () => {
  const [items, setItems] = useState<VoiceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

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

  if (loading && items.length === 0) {
    return <div style={dimStyle}>加载中…</div>;
  }
  if (error) {
    return (
      <div style={errorStyle}>
        {error}
        <button type="button" style={retryStyle} onClick={() => void fetchList()}>
          重试
        </button>
      </div>
    );
  }
  if (items.length === 0) {
    return <div style={dimStyle}>暂无自定义音色</div>;
  }

  return (
    <ul style={listStyle}>
      {items.map((item) => {
        const playing = playingId === item.id;
        const playable = !!item.demoAudioUrl;
        return (
          <li key={item.id}>
            <div style={rowStyle}>
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
