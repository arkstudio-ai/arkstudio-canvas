import React from 'react';

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
    <div style={containerStyle}>
      <div style={fieldStyle}>
        <div style={labelStyle}>声音性别</div>
        <div style={chipRowStyle}>
          {GENDER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onPatch({ gender: opt.value })}
              style={chipStyle(gender === opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div style={fieldStyle}>
        <div style={labelStyle}>音频格式</div>
        <div style={chipRowStyle}>
          {FORMAT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onPatch({ format: opt.value })}
              style={chipStyle(format === opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div style={fieldStyle}>
        <label style={toggleRowStyle}>
          <input
            type="checkbox"
            checked={useLyrics}
            onChange={(e) => onPatch({ useLyrics: e.target.checked })}
            style={{ accentColor: '#3b82f6' }}
          />
          <span style={{ fontSize: 13, color: '#ddd' }}>使用自定义歌词</span>
        </label>
        <div style={hintStyle}>
          {useLyrics ?
            '已切换为歌词模式：将忽略上方 prompt，直接按下列歌词演唱。'
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
      </div>
    </div>
  );
};

const containerStyle: React.CSSProperties = {
  width: 320,
  padding: 12,
  color: '#ddd',
};

const fieldStyle: React.CSSProperties = {
  marginBottom: 12,
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#aaa',
  marginBottom: 6,
};

const chipRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
};

const chipStyle = (active: boolean): React.CSSProperties => ({
  padding: '6px 14px',
  fontSize: 12,
  borderRadius: 999,
  border: active ? '1px solid #3b82f6' : '1px solid #333',
  background: active ? 'rgba(59, 130, 246, 0.15)' : '#0a0a0a',
  color: active ? '#6b9fff' : '#aaa',
  cursor: 'pointer',
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
  marginBottom: 8,
  lineHeight: 1.5,
};

const textareaStyle: React.CSSProperties = {
  width: '100%',
  background: '#0a0a0a',
  border: '1px solid #333',
  borderRadius: 6,
  padding: 10,
  color: '#eee',
  fontSize: 13,
  lineHeight: 1.5,
  resize: 'vertical',
  outline: 'none',
  boxSizing: 'border-box',
};
