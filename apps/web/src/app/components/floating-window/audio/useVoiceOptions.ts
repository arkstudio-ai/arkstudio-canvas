/**
 * 音色选项 Hook - 给 MiniMax 参数面板的音色下拉框用。
 *
 * 直接拉成功的 voice 列表，把 voiceId 当 select.value（要落到节点 params.voice
 * 上的就是这个）。`desc` 字段在开源版无用户态后实际只用作兜底 label，但保留
 * 这个字段以免 popover 那边的渲染需要做别的判断。
 */

import { useCallback, useEffect, useState } from 'react';
import { voiceService, VoiceItem } from '../../../services/voiceService';
import { VOICE_LIST_REFRESH_EVENT } from '../../../constants/voiceListRefresh';

export interface VoiceOption {
  value: string;
  label: string;
  desc: string;
}

export function useVoiceOptions() {
  const [voiceOptions, setVoiceOptions] = useState<VoiceOption[]>([]);
  const [voiceLoading, setVoiceLoading] = useState(false);

  const loadVoices = useCallback(async () => {
    setVoiceLoading(true);
    try {
      const list = await voiceService.getVoices({ status: 'SUCCESS' });
      const options: VoiceOption[] = list.map((v: VoiceItem) => ({
        value: v.voiceId,
        label: v.name,
        desc: '自定义音色',
      }));
      setVoiceOptions(options);
    } catch (err) {
      console.error('加载音色列表失败:', err);
    } finally {
      setVoiceLoading(false);
    }
  }, []);

  useEffect(() => { loadVoices(); }, [loadVoices]);

  useEffect(() => {
    const handleRefresh = () => loadVoices();
    window.addEventListener(VOICE_LIST_REFRESH_EVENT, handleRefresh);
    return () => window.removeEventListener(VOICE_LIST_REFRESH_EVENT, handleRefresh);
  }, [loadVoices]);

  return { voiceOptions, voiceLoading, loadVoices };
}
