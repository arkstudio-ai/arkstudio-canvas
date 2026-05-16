// Add-asset form, called from AssetLibraryPanel's "+ 添加" button.
//
// 仅支持公网 URL — 桌面端用户机器的 /static/uploads/* 是 localhost, 火山
// 服务器拉不到. 走云存储再注册的能力留到后续 (需要 OSS / TOS 凭据).

import React, { useState } from 'react';
import { toast } from 'sonner';
import {
  type Asset,
  type AssetType,
  createAsset,
} from '../../services/volcengineAssetApi';
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

export interface AddAssetFormProps {
  onCancel: () => void;
  onCreated: (asset: Asset) => void;
}

export const AddAssetForm: React.FC<AddAssetFormProps> = ({
  onCancel,
  onCreated,
}) => {
  const [url, setUrl] = useState('');
  const [assetType, setAssetType] = useState<AssetType>('Image');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setSubmitting(true);
    try {
      const asset = await createAsset({
        url: url.trim(),
        assetType,
        name: name.trim() || undefined,
      });
      onCreated(asset);
      setUrl('');
      setName('');
    } catch (err) {
      toast.error(`提交失败: ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form style={formStyle} onSubmit={handleSubmit}>
      <div style={formRowStyle}>
        <label style={formLabelStyle}>类型</label>
        <select
          style={formInputStyle}
          value={assetType}
          onChange={(e) => setAssetType(e.target.value as AssetType)}
          disabled={submitting}
        >
          <option value="Image">图片 (jpg/png/webp/...)</option>
          <option value="Video">视频 (mp4/mov)</option>
          <option value="Audio">音频 (wav/mp3)</option>
        </select>
      </div>
      <div style={formRowStyle}>
        <label style={formLabelStyle}>公网 URL</label>
        <input
          style={formInputStyle}
          type="url"
          placeholder="https://your-cdn.example.com/file.png"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
          disabled={submitting}
        />
      </div>
      <div style={formRowStyle}>
        <label style={formLabelStyle}>名称</label>
        <input
          style={formInputStyle}
          type="text"
          placeholder="可选, 帮自己识别"
          maxLength={64}
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={submitting}
        />
      </div>
      <div style={formNoteStyle}>
        ⚠ URL 必须公网可达. localhost / 内网 / 局域网地址火山服务器拉不到.
      </div>
      <div style={formActionsStyle}>
        <button type="button" style={secondaryBtnStyle} onClick={onCancel}>
          取消
        </button>
        <button type="submit" style={primaryBtnStyle} disabled={submitting}>
          {submitting ? '提交中…' : '注册到素材库'}
        </button>
      </div>
    </form>
  );
};
