/**
 * MiniMax TTS 参数 popover（语音合成）。
 *
 * 视觉对齐 image / video 的参数 popover：用 ParamsPopoverContainer + ParamsPopoverSection
 * 提供一致的 460 宽外壳和「label + 框」分区样式，避免音频节点是另一套观感。
 */
import React from 'react';
import { RefreshCw } from 'lucide-react';
import { AudioSlider } from './AudioSlider';
import { useVoiceOptions } from './useVoiceOptions';
import {
  ParamsPopoverContainer,
  ParamsPopoverSection,
} from '../common/ParamsPopover';

const EMOTION_OPTIONS = [
  { value: '', label: '自动' },
  { value: 'happy', label: '😊 开心' },
  { value: 'sad', label: '😢 悲伤' },
  { value: 'angry', label: '😠 愤怒' },
  { value: 'fearful', label: '😨 恐惧' },
  { value: 'disgusted', label: '🤢 厌恶' },
  { value: 'surprised', label: '😲 惊讶' },
  { value: 'calm', label: '😌 平静' },
  { value: 'fluent', label: '🗣️ 流畅' },
];

export interface MinimaxParamsPopoverProps {
  params: Record<string, unknown>;
  onPatch: (patch: Record<string, unknown>) => void;
}

export const MinimaxParamsPopover: React.FC<MinimaxParamsPopoverProps> = ({
  params,
  onPatch,
}) => {
  const { voiceOptions, voiceLoading, loadVoices } = useVoiceOptions();
  const [showAdvanced, setShowAdvanced] = React.useState(false);

  const get = <T,>(key: string, def: T): T => {
    const v = params[key];
    return v !== undefined ? (v as T) : def;
  };

  const voice = get<string>('voice', '');
  const speed = get<number>('speed', 1.0);
  const vol = get<number>('vol', 1.0);
  const pitch = get<number>('pitch', 0);
  const emotion = get<string>('emotion', '');
  const pitchFine = get<number>('pitchFine', 0);
  const intensity = get<number>('intensity', 0);
  const timbre = get<number>('timbre', 0);

  return (
    <ParamsPopoverContainer>
      <ParamsPopoverSection label="音色" framed={false}>
        <div style={rowStyle}>
          <select
            value={voice}
            onChange={(e) => onPatch({ voice: e.target.value })}
            disabled={voiceLoading}
            style={selectStyle}
          >
            {voiceLoading ? (
              <option value="">加载中…</option>
            ) : voiceOptions.length === 0 ? (
              <option value="">暂无音色</option>
            ) : (
              voiceOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label} - {opt.desc}
                </option>
              ))
            )}
          </select>
          <button
            type="button"
            onClick={loadVoices}
            disabled={voiceLoading}
            title="刷新音色列表"
            style={refreshBtnStyle}
          >
            <RefreshCw
              size={14}
              style={{ animation: voiceLoading ? 'spin 1s linear infinite' : 'none' }}
            />
          </button>
        </div>
      </ParamsPopoverSection>

      <ParamsPopoverSection label="情绪">
        <div style={chipWrapStyle}>
          {EMOTION_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onPatch({ emotion: opt.value })}
              style={chipStyle(emotion === opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </ParamsPopoverSection>

      <ParamsPopoverSection label="语音表现" framed={false}>
        <div style={sliderGroupStyle}>
          <AudioSlider
            label="语速"
            value={speed}
            min={0.5}
            max={2}
            step={0.1}
            defaultValue={1.0}
            leftLabel="慢"
            rightLabel="快"
            valueFormatter={(v) => `${v.toFixed(1)}x`}
            onChange={(v) => onPatch({ speed: v })}
          />
          <AudioSlider
            label="音量"
            value={vol}
            min={0.1}
            max={10}
            step={0.1}
            defaultValue={1.0}
            leftLabel="小"
            rightLabel="大"
            valueFormatter={(v) => v.toFixed(1)}
            onChange={(v) => onPatch({ vol: v })}
          />
          <AudioSlider
            label="语调"
            value={pitch}
            min={-12}
            max={12}
            step={1}
            defaultValue={0}
            leftLabel="低"
            rightLabel="高"
            valueFormatter={(v) => (v > 0 ? `+${v}` : v.toString())}
            onChange={(v) => onPatch({ pitch: v })}
          />
        </div>
      </ParamsPopoverSection>

      <div>
        <button
          type="button"
          onClick={() => setShowAdvanced((s) => !s)}
          style={advancedToggleStyle}
        >
          <span>音色微调</span>
          <span style={{ transform: showAdvanced ? 'rotate(180deg)' : 'none' }}>▾</span>
        </button>
        {showAdvanced && (
          <div style={sliderGroupStyle}>
            <AudioSlider
              label="音高（低沉 ↔ 明亮）"
              value={pitchFine}
              min={-100}
              max={100}
              step={1}
              defaultValue={0}
              leftLabel="低沉"
              rightLabel="明亮"
              onChange={(v) => onPatch({ pitchFine: v })}
            />
            <AudioSlider
              label="强度（柔和 ↔ 力量）"
              value={intensity}
              min={-100}
              max={100}
              step={1}
              defaultValue={0}
              leftLabel="柔和"
              rightLabel="力量"
              onChange={(v) => onPatch({ intensity: v })}
            />
            <AudioSlider
              label="音色（磁性 ↔ 清脆）"
              value={timbre}
              min={-100}
              max={100}
              step={1}
              defaultValue={0}
              leftLabel="磁性"
              rightLabel="清脆"
              onChange={(v) => onPatch({ timbre: v })}
            />
          </div>
        )}
      </div>
    </ParamsPopoverContainer>
  );
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const selectStyle: React.CSSProperties = {
  flex: 1,
  background: '#1c1c1c',
  border: '1px solid #2a2a2a',
  borderRadius: 8,
  padding: '10px 12px',
  color: '#eee',
  fontSize: 13,
  outline: 'none',
};

const refreshBtnStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 8,
  border: '1px solid #2a2a2a',
  background: '#1c1c1c',
  color: '#9a9a9a',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const chipWrapStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
};

const chipStyle = (active: boolean): React.CSSProperties => ({
  padding: '6px 12px',
  fontSize: 12,
  borderRadius: 999,
  border: 'none',
  background: active ? '#3a3a3a' : '#0a0a0a',
  color: active ? '#fff' : '#9a9a9a',
  cursor: 'pointer',
  transition: 'background 120ms',
});

const sliderGroupStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const advancedToggleStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 0',
  background: 'transparent',
  border: 'none',
  borderTop: '1px solid #2a2a2a',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  cursor: 'pointer',
  color: '#9a9a9a',
  fontSize: 12,
};
