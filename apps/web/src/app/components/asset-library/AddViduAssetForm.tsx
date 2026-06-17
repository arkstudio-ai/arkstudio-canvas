import React, { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { toast } from 'sonner';
import { type ViduAsset, type ViduAssetType, createViduAsset } from '../../services/viduAssetApi';
import { api } from '../../services/api';
import {
  formActionsStyle,
  formInputStyle,
  formLabelStyle,
  formNoteStyle,
  formRowStyle,
  formStyle,
  primaryBtnStyle,
  secondaryBtnStyle,
} from './styles';

export interface AddViduAssetFormProps {
  onCancel: () => void;
  onCreated: (asset: ViduAsset) => void;
}

export const AddViduAssetForm: React.FC<AddViduAssetFormProps> = ({
  onCancel,
  onCreated,
}) => {
  const [assetType, setAssetType] = useState<ViduAssetType>('character');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState('');
  const [mode, setMode] = useState<'local' | 'url'>('local');
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('请输入资产名称');
      return;
    }

    setSubmitting(true);
    try {
      let finalImageUrl: string;
      if (mode === 'local') {
        if (!file) {
          toast.error('请先选择图片');
          return;
        }
        finalImageUrl = await api.uploadFile(file);
      } else {
        if (!imageUrl.trim()) {
          toast.error('请输入图片 URL');
          return;
        }
        finalImageUrl = imageUrl.trim();
      }

      const asset = await createViduAsset({
        type: assetType,
        name: name.trim(),
        description: description.trim() || undefined,
        imageUrl: finalImageUrl,
      });
      onCreated(asset);
      setName('');
      setDescription('');
      setFile(null);
      setImageUrl('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      toast.error(`创建失败: ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form style={formStyle} onSubmit={handleSubmit}>
      <div style={formRowStyle}>
        <label style={formLabelStyle}>资产类型</label>
        <select
          style={formInputStyle}
          value={assetType}
          onChange={(e) => setAssetType(e.target.value as ViduAssetType)}
          disabled={submitting}
        >
          <option value="character">角色</option>
          <option value="scene">场景</option>
          <option value="tool">道具</option>
        </select>
      </div>

      <div style={formRowStyle}>
        <label style={formLabelStyle}>名称 (≤30字)</label>
        <input
          style={formInputStyle}
          type="text"
          placeholder="例: 林尘、客厅、订婚戒指"
          maxLength={30}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          disabled={submitting}
        />
      </div>

      <div style={formRowStyle}>
        <label style={formLabelStyle}>描述 (可选)</label>
        <input
          style={formInputStyle}
          type="text"
          placeholder="例: 男主角，穿白衬衫"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={submitting}
        />
      </div>

      <div style={formRowStyle}>
        <label style={formLabelStyle}>参考图片来源</label>
        <div style={modeRowStyle}>
          <label style={radioStyle(mode === 'local')}>
            <input
              type="radio"
              name="vidu-asset-mode"
              value="local"
              checked={mode === 'local'}
              onChange={() => setMode('local')}
              disabled={submitting}
            />
            <span>本地上传</span>
          </label>
          <label style={radioStyle(mode === 'url')}>
            <input
              type="radio"
              name="vidu-asset-mode"
              value="url"
              checked={mode === 'url'}
              onChange={() => setMode('url')}
              disabled={submitting}
            />
            <span>图片 URL</span>
          </label>
        </div>
      </div>

      {mode === 'local' ? (
        <div style={formRowStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              style={secondaryBtnStyle}
              onClick={() => fileInputRef.current?.click()}
              disabled={submitting}
            >
              <Upload size={12} style={{ marginRight: 4 }} />
              选择图片
            </button>
            <span style={fileNameStyle}>
              {file
                ? `${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)`
                : '未选择'}
            </span>
            <input
              ref={fileInputRef}
              type="file"
              style={{ display: 'none' }}
              accept="image/png,image/jpeg,image/jpg,image/webp"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
        </div>
      ) : (
        <div style={formRowStyle}>
          <input
            style={formInputStyle}
            type="url"
            placeholder="https://example.com/character.png"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            required
            disabled={submitting}
          />
        </div>
      )}

      <div style={formNoteStyle}>
        支持 png/jpeg/webp 格式, 像素 ≥128×128, 比例 ≤4:1.
        <br />
        一个资产对应一张参考图, 可跨多个短剧复用.
      </div>

      <div style={formActionsStyle}>
        <button type="button" style={secondaryBtnStyle} onClick={onCancel}>
          取消
        </button>
        <button type="submit" style={primaryBtnStyle} disabled={submitting}>
          {submitting ? '创建中…' : '添加资产'}
        </button>
      </div>
    </form>
  );
};

const modeRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 12,
  flex: 1,
};

const radioStyle = (active: boolean): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  padding: '4px 10px',
  borderRadius: 6,
  border: '1px solid',
  borderColor: active ? 'rgba(52,211,153,0.45)' : 'rgba(255,255,255,0.10)',
  background: active ? 'rgba(52,211,153,0.10)' : 'transparent',
  color: active ? '#5eead4' : '#cfcfd2',
  cursor: 'pointer',
});

const fileNameStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#9b9ea4',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};
