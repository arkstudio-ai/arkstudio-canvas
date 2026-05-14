/**
 * FunMusic 参数 popover（背景音乐 / 歌曲生成）。
 *
 * 视觉对齐 image / video 的参数 popover：用 ParamsPopoverContainer + ParamsPopoverSection
 * 提供 460 宽外壳和「label + 框」的分区样式，性别 / 格式用与 SegmentedRow 同款的 segmented control。
 */
import React from 'react';
import {
  ParamsPopoverContainer,
  ParamsPopoverSection,
} from '../common/ParamsPopover';

export interface FunMusicParamsPopoverProps {
  params: Record<string, unknown>;
  onPatch: (patch: Record<string, unknown>) => void;
}

const GENDER_OPTIONS = [
  { value: 'female', label: '女声' },
  { value: 'male', label: '男声' },
];

const FORMAT_OPTIONS = [
  { value: 'mp3', label: 'MP3' },
  { value: 'wav', label: 'WAV' },
];

export const FunMusicParamsPopover: React.FC<FunMusicParamsPopoverProps> = ({
  params,
  onPatch,
}) => {
  const get = <T,>(key: string, def: T): T => {
    const v = params[key];
    return v !== undefined ? (v as T) : def;
  };

  const gender = get<string>('gender', 'female');
  const format = get<string>('format', 'mp3');
  const useLyrics = get<boolean>('useLyrics', false);
  const lyrics = get<string>('lyrics', '');

  return (
    <ParamsPopoverContainer>
      <ParamsPopoverSection label="声音性别">
        <div style={segmentedRowStyle}>
          {GENDER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onPatch({ gender: opt.value })}
              style={segmentedBtnStyle(gender === opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </ParamsPopoverSection>

      <ParamsPopoverSection label="音频格式">
        <div style={segmentedRowStyle}>
          {FORMAT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onPatch({ format: opt.value })}
              style={segmentedBtnStyle(format === opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </ParamsPopoverSection>

      <ParamsPopoverSection label="歌词" framed={false}>
        <label style={toggleRowStyle}>
          <input
            type="checkbox"
            checked={useLyrics}
            onChange={(e) => onPatch({ useLyrics: e.target.checked })}
            style={{ accentColor: '#3a3a3a' }}
          />
          <span style={{ fontSize: 13, color: '#ddd' }}>使用自定义歌词</span>
        </label>
        <div style={hintStyle}>
          {useLyrics
            ? '已切换为歌词模式：将忽略上方 prompt，直接按下列歌词演唱。'
            : '默认模式：根据上方 prompt 描述的风格，由模型自动作词。'}
        </div>
        {useLyrics && (
          <textarea
            value={lyrics}
            onChange={(e) => onPatch({ lyrics: e.target.value })}
            placeholder="输入完整歌词（中文 5~350 字 / 英文 5~2000 字符）"
            rows={5}
            style={textareaStyle}
          />
        )}
      </ParamsPopoverSection>
    </ParamsPopoverContainer>
  );
};

const segmentedRowStyle: React.CSSProperties = {
  display: 'grid',
  gridAutoFlow: 'column',
  gridAutoColumns: '1fr',
  gap: 4,
};

const segmentedBtnStyle = (active: boolean): React.CSSProperties => ({
  padding: '10px 8px',
  border: 'none',
  borderRadius: 7,
  background: active ? '#3a3a3a' : 'transparent',
  color: active ? '#fff' : '#9a9a9a',
  fontSize: 13,
  cursor: 'pointer',
  transition: 'background 120ms',
});

const toggleRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  cursor: 'pointer',
  marginBottom: 4,
};

const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#777',
  marginTop: 2,
  marginBottom: 8,
  lineHeight: 1.5,
};

const textareaStyle: React.CSSProperties = {
  width: '100%',
  background: '#1c1c1c',
  border: '1px solid #2a2a2a',
  borderRadius: 8,
  padding: 10,
  color: '#eee',
  fontSize: 13,
  lineHeight: 1.5,
  resize: 'vertical',
  outline: 'none',
  boxSizing: 'border-box',
};
