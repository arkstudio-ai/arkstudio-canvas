/**
 * 创建自定义音色 - 支持两种来源：
 *   1. 上传：选本地音频文件
 *   2. 录音：浏览器麦克风现录（MediaRecorder API）
 *
 * 两条路径最终都会得到一个 File 对象，统一走 api.uploadFile → 拿到 accessUrl，
 * 再调 voiceService.createVoice 触发后端音色复刻。
 *
 * 时长校验在客户端做，避免无效音频上传到 OSS：
 *   - 最小 10 秒（百炼 mini-clone-api 强制最低）
 *   - 最大 5 分钟（同上限制）
 */

import { useEffect, useRef, useState } from 'react';
import {
  Button,
  Dialog,
  Flex,
  Spinner,
  Tabs,
  Text,
  TextField,
} from '@radix-ui/themes';
import { Upload, Clock, Mic, Square, Trash2 } from 'lucide-react';
import { voiceService } from '../services/voiceService';
import { api } from '../services/api';
import { VOICE_LIST_REFRESH_EVENT } from '../constants/voiceListRefresh';

interface CreateVoiceDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const MIN_DURATION = 10;
const MAX_DURATION = 300;

type SourceTab = 'upload' | 'record';

/** 用 HTMLAudioElement 探测音频实际时长（秒，向上取整） */
function getAudioDuration(file: File | Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    const url = URL.createObjectURL(file);
    const cleanup = () => URL.revokeObjectURL(url);
    audio.onloadedmetadata = () => {
      // 录音得到的 webm 在 Chrome 上有时 duration = Infinity，
      // 先 seek 到极大值触发实际计算，再读 duration。
      if (Number.isFinite(audio.duration)) {
        resolve(Math.round(audio.duration));
        cleanup();
        return;
      }
      audio.currentTime = Number.MAX_SAFE_INTEGER;
      audio.ontimeupdate = () => {
        audio.ontimeupdate = null;
        resolve(Math.round(audio.duration));
        cleanup();
      };
    };
    audio.onerror = () => { cleanup(); reject(new Error('无法读取音频时长')); };
    audio.src = url;
  });
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? `${mins}分${secs}秒` : `${secs}秒`;
}

/** MediaRecorder 优先 webm/opus，其次浏览器自选 */
function pickRecorderMimeType(): string | undefined {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  for (const t of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) {
      return t;
    }
  }
  return undefined;
}

export function CreateVoiceDialog({ open, onClose, onSuccess }: CreateVoiceDialogProps) {
  const [tab, setTab] = useState<SourceTab>('upload');

  const [name, setName] = useState('');
  const [demoText, setDemoText] = useState('');

  // 共享：最终要上传的音频（来自上传或录音）
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [loadingDuration, setLoadingDuration] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 录音状态
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const tickRef = useRef<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // 关闭对话框时统一清理副作用（流、定时器、对象 URL）
  useEffect(() => {
    if (open) return;
    stopRecorderTracks();
    if (tickRef.current) { window.clearInterval(tickRef.current); tickRef.current = null; }
    if (previewUrl) { URL.revokeObjectURL(previewUrl); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function stopRecorderTracks() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }

  function resetAudio() {
    setAudioFile(null);
    setDuration(null);
    if (previewUrl) { URL.revokeObjectURL(previewUrl); }
    setPreviewUrl(null);
    setError(null);
  }

  function adoptAudio(file: File) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const url = URL.createObjectURL(file);
    setAudioFile(file);
    setPreviewUrl(url);
    setError(null);
    setLoadingDuration(true);
    getAudioDuration(file)
      .then((dur) => {
        setDuration(dur);
        if (dur < MIN_DURATION) {
          setError(`音频时长不能少于 ${MIN_DURATION} 秒，当前 ${dur} 秒`);
        } else if (dur > MAX_DURATION) {
          setError(`音频时长不能超过 ${MAX_DURATION / 60} 分钟，当前 ${formatDuration(dur)}`);
        }
      })
      .catch(() => setError('无法读取音频时长，请重试'))
      .finally(() => setLoadingDuration(false));
  }

  // ---- 上传 tab ---------------------------------------------------------

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    if (!selected.type.startsWith('audio/')) {
      setError('请选择音频文件');
      return;
    }
    adoptAudio(selected);
  };

  // ---- 录音 tab ---------------------------------------------------------

  const startRecording = async () => {
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e: any) {
      setError(e?.name === 'NotAllowedError' ? '麦克风权限被拒绝' : '无法访问麦克风');
      return;
    }
    streamRef.current = stream;
    const mimeType = pickRecorderMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunksRef.current = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
      const ext = blob.type.includes('mp4') ? 'm4a' : 'webm';
      const file = new File([blob], `recording-${Date.now()}.${ext}`, { type: blob.type });
      stopRecorderTracks();
      adoptAudio(file);
    };
    recorder.start();
    recorderRef.current = recorder;
    setRecording(true);
    setRecordSeconds(0);
    tickRef.current = window.setInterval(() => {
      setRecordSeconds((s) => {
        const next = s + 1;
        if (next >= MAX_DURATION) stopRecording();
        return next;
      });
    }, 1000);
  };

  const stopRecording = () => {
    if (tickRef.current) { window.clearInterval(tickRef.current); tickRef.current = null; }
    setRecording(false);
    try { recorderRef.current?.stop(); } catch { /* ignore */ }
  };

  // ---- 提交 -------------------------------------------------------------

  const handleSubmit = async () => {
    if (!name.trim()) { setError('请输入音色名称'); return; }
    if (!audioFile || duration === null) { setError('请上传或录制音频'); return; }
    if (duration < MIN_DURATION || duration > MAX_DURATION) {
      setError(`音频时长需要在 ${MIN_DURATION}-${MAX_DURATION} 秒之间`);
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const audioUrl = await api.uploadFile(audioFile);
      setUploading(false);
      setCreating(true);
      await voiceService.createVoice({
        name: name.trim(),
        audioUrl,
        demoText: demoText.trim() || undefined,
      });
      setName('');
      setDemoText('');
      resetAudio();
      onSuccess();
      window.dispatchEvent(new Event(VOICE_LIST_REFRESH_EVENT));
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    } finally {
      setUploading(false);
      setCreating(false);
    }
  };

  const handleClose = () => {
    if (uploading || creating || recording) return;
    setName('');
    setDemoText('');
    resetAudio();
    onClose();
  };

  const isLoading = uploading || creating || loadingDuration || recording;
  const isDurationValid = duration !== null && duration >= MIN_DURATION && duration <= MAX_DURATION;

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && handleClose()}>
      <Dialog.Content maxWidth="460px">
        <Dialog.Title>创建自定义音色</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="4">
          上传或录制一段 {MIN_DURATION} 秒 ~ {MAX_DURATION / 60} 分钟的音频，AI 会复刻这个音色。
        </Dialog.Description>

        <Flex direction="column" gap="4">
          <Flex direction="column" gap="1">
            <Text size="2" weight="medium">音色名称 *</Text>
            <TextField.Root
              placeholder="给音色起个名字"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isLoading}
            />
          </Flex>

          <Tabs.Root value={tab} onValueChange={(v) => { setTab(v as SourceTab); resetAudio(); }}>
            <Tabs.List size="1">
              <Tabs.Trigger value="upload"><Upload size={12} style={{ marginRight: 4 }} />上传文件</Tabs.Trigger>
              <Tabs.Trigger value="record"><Mic size={12} style={{ marginRight: 4 }} />麦克风录制</Tabs.Trigger>
            </Tabs.List>

            <Tabs.Content value="upload" style={{ paddingTop: 12 }}>
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
              />
              <Button
                variant="soft"
                color="gray"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || creating}
                style={{ justifyContent: 'flex-start', width: '100%' }}
              >
                <Upload size={16} />
                {audioFile && tab === 'upload' ? audioFile.name : '选择音频文件'}
              </Button>
            </Tabs.Content>

            <Tabs.Content value="record" style={{ paddingTop: 12 }}>
              <Flex direction="column" gap="2" align="center" style={recordPanelStyle}>
                {recording ? (
                  <>
                    <Text size="5" weight="bold" style={{ color: '#ef4444' }}>
                      ● {formatDuration(recordSeconds)}
                    </Text>
                    <Button color="red" variant="solid" onClick={stopRecording}>
                      <Square size={14} fill="#fff" />停止录音
                    </Button>
                    <Text size="1" color="gray">最多 {MAX_DURATION / 60} 分钟，到时间会自动停止</Text>
                  </>
                ) : audioFile && tab === 'record' ? (
                  <>
                    <Text size="2" style={{ color: '#a78bfa' }}>已录制 {duration ? formatDuration(duration) : '...'}</Text>
                    <Flex gap="2">
                      <Button variant="soft" color="gray" onClick={resetAudio}>
                        <Trash2 size={14} />重录
                      </Button>
                      <Button variant="soft" color="violet" onClick={startRecording}>
                        <Mic size={14} />重新开始
                      </Button>
                    </Flex>
                  </>
                ) : (
                  <>
                    <Text size="1" color="gray">点击开始，朗读 {MIN_DURATION} 秒以上的内容</Text>
                    <Button color="violet" variant="solid" onClick={startRecording}>
                      <Mic size={14} />开始录音
                    </Button>
                  </>
                )}
              </Flex>
            </Tabs.Content>
          </Tabs.Root>

          {/* 时长 + 试听共用展示区 */}
          {(loadingDuration || duration !== null) && (
            <Flex direction="column" gap="2">
              {loadingDuration && (
                <Flex align="center" gap="1">
                  <Spinner size="1" />
                  <Text size="1" color="gray">检测时长中...</Text>
                </Flex>
              )}
              {duration !== null && !loadingDuration && (
                <Flex align="center" gap="2">
                  <Clock size={12} color={isDurationValid ? '#22c55e' : '#ef4444'} />
                  <Text size="1" style={{ color: isDurationValid ? '#22c55e' : '#ef4444' }}>
                    时长：{formatDuration(duration)}{isDurationValid ? ' ✓' : ''}
                  </Text>
                </Flex>
              )}
              {previewUrl && (
                <audio src={previewUrl} controls style={{ width: '100%', height: 36 }} />
              )}
            </Flex>
          )}

          <Flex direction="column" gap="1">
            <Text size="2" weight="medium">试听文本（可选）</Text>
            <TextField.Root
              placeholder="留空使用默认文本生成试听音频"
              value={demoText}
              onChange={(e) => setDemoText(e.target.value)}
              disabled={isLoading}
            />
          </Flex>

          {error && <Text size="2" color="red">{error}</Text>}
        </Flex>

        <Flex gap="3" mt="4" justify="end">
          <Dialog.Close>
            <Button variant="soft" color="gray" disabled={uploading || creating || recording}>取消</Button>
          </Dialog.Close>
          <Button
            variant="solid"
            color="violet"
            onClick={handleSubmit}
            disabled={isLoading || !name.trim() || !audioFile || !isDurationValid}
          >
            {uploading ? (<><Spinner size="1" />上传中...</>)
              : creating ? (<><Spinner size="1" />复刻中...</>)
              : '创建音色'}
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}

const recordPanelStyle: React.CSSProperties = {
  padding: '20px 12px',
  borderRadius: 8,
  background: 'rgba(139, 92, 246, 0.05)',
  border: '1px dashed rgba(139, 92, 246, 0.25)',
};
