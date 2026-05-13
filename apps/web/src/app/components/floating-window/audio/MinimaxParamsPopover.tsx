import React from 'react';
import { RefreshCw } from 'lucide-react';
import { AudioSlider } from './AudioSlider';
import { useVoiceOptions } from './useVoiceOptions';

const EMOTION_OPTIONS = [
  { value: '', label: '自动匹配' },
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
    <div style={containerStyle}>
      <div style={rowStyle}>
        <select
          value={voice}
          onChange={(e) => onPatch({ voice: e.target.value })}
          disabled={voiceLoading}
          style={selectStyle}
        >
          {voiceLoading ?
            <option value="">加载中…</option>
          : voiceOptions.length === 0 ?
            <option value="">暂无音色</option>
          : voiceOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label} - {opt.desc}
              </option>
            ))
          }
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

      <div style={{ marginTop: 12 }}>
        <div style={labelStyle}>情绪</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {EMOTION_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onPatch({ emotion: opt.value })}
              style={emotionBtnStyle(emotion === opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
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

      <div style={{ borderTop: '1px solid #2a2a2a', marginTop: 6 }}>
        <button
          type="button"
          onClick={() => setShowAdvanced((s) => !s)}
          style={advancedToggleStyle}
        >
          <span>音色微调</span>
          <span style={{ transform: showAdvanced ? 'rotate(180deg)' : 'none' }}>▾</span>
        </button>
        {showAdvanced && (
          <div style={{ paddingTop: 4 }}>
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
    </div>
  );
};

const containerStyle: React.CSSProperties = {
  width: 360,
  maxHeight: 480,
  overflowY: 'auto',
  padding: 12,
  color: '#ddd',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const selectStyle: React.CSSProperties = {
  flex: 1,
  background: '#0a0a0a',
  border: '1px solid #333',
  borderRadius: 6,
  padding: '8px 10px',
  color: '#eee',
  fontSize: 13,
  outline: 'none',
};

const refreshBtnStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 6,
  border: '1px solid #333',
  background: '#0a0a0a',
  color: '#999',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#aaa',
  marginBottom: 6,
};

const emotionBtnStyle = (active: boolean): React.CSSProperties => ({
  padding: '4px 10px',
  fontSize: 11,
  borderRadius: 12,
  border: active ? '1px solid #3b82f6' : '1px solid #333',
  background: active ? 'rgba(59, 130, 246, 0.15)' : '#0a0a0a',
  color: active ? '#6b9fff' : '#aaa',
  cursor: 'pointer',
});

const advancedToggleStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 0',
  background: 'transparent',
  border: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  cursor: 'pointer',
  color: '#888',
  fontSize: 12,
};
