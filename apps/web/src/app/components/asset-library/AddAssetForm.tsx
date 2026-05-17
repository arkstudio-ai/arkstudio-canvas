// Add-asset form, called from AssetLibraryPanel's "+ 添加" button.
//
// Two modes:
//   - 公网 URL: 用户直接粘 URL, 跟原始 MVP 行为一致.
//   - 本地文件: 文件 picker → /upload/file → /static/uploads/<key>;
//     backend 收到本地 URL 后会自动 stage 到 admin 配的 OSS / TOS, 再
//     用得到的公网 URL 调 Volcengine CreateAsset. 没配 OSS 时这个 radio
//     option 显示但 disabled, 鼠标 hover 提示去 /admin/system 配.

import React, { useEffect, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { toast } from 'sonner';
import {
  type Asset,
  type AssetType,
  createAsset,
  getOssReady,
} from '../../services/volcengineAssetApi';
import { api } from '../../services/api';
import {
  formActionsStyle,
  formInputStyle,
  formLabelStyle,
  formNoteStyle,
  formRowStyle,
  formStyle,
  linkStyle,
  primaryBtnStyle,
  secondaryBtnStyle,
} from './styles';

export interface AddAssetFormProps {
  onCancel: () => void;
  onCreated: (asset: Asset) => void;
}

type Mode = 'url' | 'local';

export const AddAssetForm: React.FC<AddAssetFormProps> = ({
  onCancel,
  onCreated,
}) => {
  const [mode, setMode] = useState<Mode>('url');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [assetType, setAssetType] = useState<AssetType>('Image');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [ossReady, setOssReady] = useState<boolean | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const ready = await getOssReady();
      if (!cancelled) setOssReady(ready);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const localDisabled = ossReady === false;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      let finalUrl: string;
      if (mode === 'local') {
        if (!file) {
          toast.error('请先选择文件');
          return;
        }
        // Upload to local backend disk first; backend's CreateAsset
        // will stage this /static/... URL to OSS before passing to
        // Volcengine.
        finalUrl = await api.uploadFile(file);
      } else {
        if (!url.trim()) return;
        finalUrl = url.trim();
      }
      const asset = await createAsset({
        url: finalUrl,
        assetType,
        name: name.trim() || undefined,
      });
      onCreated(asset);
      setUrl('');
      setName('');
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      toast.error(`提交失败: ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form style={formStyle} onSubmit={handleSubmit}>
      <div style={formRowStyle}>
        <label style={formLabelStyle}>来源</label>
        <div style={modeRowStyle}>
          <label style={radioStyle(mode === 'url')}>
            <input
              type="radio"
              name="add-asset-mode"
              value="url"
              checked={mode === 'url'}
              onChange={() => setMode('url')}
              disabled={submitting}
            />
            <span>公网 URL</span>
          </label>
          <label
            style={radioStyle(mode === 'local', localDisabled)}
            title={
              localDisabled
                ? '本地上传需先在 /admin/system → 对象存储 (OSS / TOS) 配置一个 bucket'
                : undefined
            }
          >
            <input
              type="radio"
              name="add-asset-mode"
              value="local"
              checked={mode === 'local'}
              onChange={() => setMode('local')}
              disabled={submitting || localDisabled}
            />
            <span>本地文件</span>
            {localDisabled && <em style={radioHintStyle}>(未配 OSS)</em>}
          </label>
        </div>
      </div>

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

      {mode === 'url' ? (
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
      ) : (
        <div style={formRowStyle}>
          <label style={formLabelStyle}>文件</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
            <button
              type="button"
              style={secondaryBtnStyle}
              onClick={() => fileInputRef.current?.click()}
              disabled={submitting}
            >
              <Upload size={12} style={{ marginRight: 4 }} />
              选择文件
            </button>
            <span style={fileNameStyle}>
              {file ? `${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)` : '未选择'}
            </span>
            <input
              ref={fileInputRef}
              type="file"
              style={{ display: 'none' }}
              accept="image/*,video/*,audio/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
        </div>
      )}

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
        {mode === 'url' ? (
          <>
            URL 必须公网可达 — 火山服务器要在线拉这个文件.
            <br />
            <br />
            常用来源: GitHub raw · 图床 (
            <a
              href="https://www.beeimg.cn/"
              target="_blank"
              rel="noopener noreferrer"
              style={linkStyle}
            >
              蜜蜂图床
            </a>
            ,视频可用语雀:
            <a
              href="https://www.yuque.com/"
              target="_blank"
              rel="noopener noreferrer"
              style={linkStyle}
            >
              语雀文档
            </a>
            ) · OSS / TOS / COS
          </>
        ) : (
          <>
            选好文件后, 提交时本地先上传到 backend 磁盘, 再由 backend 自动 stage 到
            你配置的 OSS / TOS, 生成的公网 URL 才上报给火山方舟. 单个文件 ≤ 100MB.
          </>
        )}
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

const modeRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 12,
  flex: 1,
};

const radioStyle = (
  active: boolean,
  disabled: boolean = false,
): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  padding: '4px 10px',
  borderRadius: 6,
  border: '1px solid',
  borderColor: active
    ? 'rgba(52,211,153,0.45)'
    : 'rgba(255,255,255,0.10)',
  background: active ? 'rgba(52,211,153,0.10)' : 'transparent',
  color: disabled ? '#666' : active ? '#5eead4' : '#cfcfd2',
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.55 : 1,
});

const radioHintStyle: React.CSSProperties = {
  fontStyle: 'normal',
  fontSize: 10,
  color: '#888',
};

const fileNameStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#9b9ea4',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};
