// /admin/system → 对象存储 (OSS / TOS) section.
//
// Backed by /api/canvas-flow/oss-settings. Once configured, Volcengine
// Seedance i2v / r2v can stage local backend uploads to the configured
// bucket and feed the resulting public URL to upstream.
//
// 不配置时 Volcengine Seedance 只能跑纯文本 t2v — runtime 抛 400 引导
// 用户回来这里配置. Volcengine 卡片那条 hint 也指这.

import React, { useEffect, useState } from 'react';
import { Database } from 'lucide-react';
import { toast } from 'sonner';

import {
  getOssSettings,
  updateOssSettings,
} from '../../api/admin-api';
import type { OssProvider, OssSettingsView } from '../../types';
import {
  buttonAccentStyle,
  emptyStyle,
  fieldLabelStyle,
  fieldRowStyle,
  inputMonoStyle,
  sectionBodyStyle,
  sectionStyle,
  sectionTitleStyle,
  tokens,
} from '../config/styles';

const PROVIDER_LABELS: Record<OssProvider, string> = {
  'aliyun-oss': '阿里云 OSS',
  'volcengine-tos': '火山引擎 TOS',
};

const PROVIDER_HINTS: Record<OssProvider, { region: string; sample: string }> = {
  'aliyun-oss': {
    region: '示例: oss-cn-beijing / oss-cn-hangzhou',
    sample: 'https://<bucket>.<region>.aliyuncs.com',
  },
  'volcengine-tos': {
    region: '示例: cn-beijing / cn-guangzhou',
    sample: 'https://<bucket>.tos-<region>.volces.com',
  },
};

export const OssSection: React.FC = () => {
  const [view, setView] = useState<OssSettingsView | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [drafts, setDrafts] = useState({
    accessKeyId: '',
    accessKeySecret: '',
    bucket: '',
    region: '',
    endpoint: '',
    publicBaseUrl: '',
  });

  const load = async () => {
    setLoading(true);
    try {
      const v = await getOssSettings();
      setView(v);
      setDrafts({
        accessKeyId: '',
        accessKeySecret: '',
        bucket: v.bucket,
        region: v.region,
        endpoint: v.endpoint,
        publicBaseUrl: v.publicBaseUrl,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载 OSS 设置失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const apply = async (patch: Parameters<typeof updateOssSettings>[0]) => {
    setSaving(true);
    try {
      const v = await updateOssSettings(patch);
      setView(v);
      if (patch.accessKeyId !== undefined)
        setDrafts((d) => ({ ...d, accessKeyId: '' }));
      if (patch.accessKeySecret !== undefined)
        setDrafts((d) => ({ ...d, accessKeySecret: '' }));
      toast.success('已保存');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (!view) {
    return (
      <section style={sectionStyle}>
        <h3 style={sectionTitleStyle}>
          <Database size={11} style={{ verticalAlign: 'middle', marginRight: 6 }} />
          对象存储 (OSS / TOS)
        </h3>
        <div style={sectionBodyStyle}>
          <div style={emptyStyle}>{loading ? '加载中…' : '加载失败'}</div>
        </div>
      </section>
    );
  }

  const provider = view.provider;
  const hints = provider ? PROVIDER_HINTS[provider] : null;

  return (
    <section style={sectionStyle}>
      <h3 style={sectionTitleStyle}>
        <Database size={11} style={{ verticalAlign: 'middle', marginRight: 6 }} />
        对象存储 (OSS / TOS)
      </h3>
      <div style={sectionBodyStyle}>
        <div style={hintStyle}>
          阿里 OSS 或火山 TOS 二选一. <strong style={{ color: tokens.warn }}>
          未配置时, 火山方舟 Seedance 仅能跑纯文本 (t2v); 任何"图生视频 / 视频参考"模式
          都会因为本地 URL 不可达而失败.</strong> 配置后凭据 aes-256-gcm 加密落库.
        </div>

        <div style={fieldRowStyle}>
          <span style={fieldLabelStyle}>Provider</span>
          <select
            style={{ ...inputMonoStyle, width: '100%' }}
            value={provider ?? ''}
            onChange={(e) => {
              const v = e.target.value as OssProvider | '';
              void apply({ provider: v });
            }}
            disabled={saving}
          >
            <option value="">(未配置 — 禁用 OSS staging)</option>
            <option value="aliyun-oss">阿里云 OSS (ali-oss)</option>
            <option value="volcengine-tos">火山引擎 TOS</option>
          </select>
        </div>

        {provider && (
          <>
            <div style={fieldRowStyle}>
              <span style={fieldLabelStyle}>Access Key ID</span>
              <input
                style={inputMonoStyle}
                type="text"
                placeholder={
                  view.accessKeyIdMask ?? '从 RAM 子账号控制台获取'
                }
                value={drafts.accessKeyId}
                onChange={(e) =>
                  setDrafts((d) => ({ ...d, accessKeyId: e.target.value }))
                }
                onBlur={() => {
                  if (drafts.accessKeyId)
                    void apply({ accessKeyId: drafts.accessKeyId });
                }}
                disabled={saving}
              />
            </div>
            <div style={fieldRowStyle}>
              <span style={fieldLabelStyle}>Access Key Secret</span>
              <input
                style={inputMonoStyle}
                type="password"
                placeholder={
                  view.accessKeySecretConfigured ? '••••••••(已配置)' : '密钥串'
                }
                value={drafts.accessKeySecret}
                onChange={(e) =>
                  setDrafts((d) => ({ ...d, accessKeySecret: e.target.value }))
                }
                onBlur={() => {
                  if (drafts.accessKeySecret)
                    void apply({ accessKeySecret: drafts.accessKeySecret });
                }}
                disabled={saving}
              />
            </div>
            <div style={fieldRowStyle}>
              <span style={fieldLabelStyle}>Bucket</span>
              <input
                style={inputMonoStyle}
                placeholder="my-canvas-flow-assets"
                value={drafts.bucket}
                onChange={(e) =>
                  setDrafts((d) => ({ ...d, bucket: e.target.value }))
                }
                onBlur={() => {
                  if (drafts.bucket !== view.bucket)
                    void apply({ bucket: drafts.bucket });
                }}
                disabled={saving}
              />
            </div>
            <div style={fieldRowStyle}>
              <span style={fieldLabelStyle}>Region</span>
              <input
                style={inputMonoStyle}
                placeholder={hints?.region}
                value={drafts.region}
                onChange={(e) =>
                  setDrafts((d) => ({ ...d, region: e.target.value }))
                }
                onBlur={() => {
                  if (drafts.region !== view.region)
                    void apply({ region: drafts.region });
                }}
                disabled={saving}
              />
            </div>
            <div style={fieldRowStyle}>
              <span style={fieldLabelStyle}>Endpoint</span>
              <input
                style={inputMonoStyle}
                placeholder="自定义域名 / VPC 内网 endpoint, 留空走默认"
                value={drafts.endpoint}
                onChange={(e) =>
                  setDrafts((d) => ({ ...d, endpoint: e.target.value }))
                }
                onBlur={() => {
                  if (drafts.endpoint !== view.endpoint)
                    void apply({ endpoint: drafts.endpoint });
                }}
                disabled={saving}
              />
            </div>
            <div style={fieldRowStyle}>
              <span style={fieldLabelStyle}>Public Base URL</span>
              <input
                style={inputMonoStyle}
                placeholder={`CDN 域名前缀, 留空走 ${hints?.sample ?? 'bucket 默认 URL'}`}
                value={drafts.publicBaseUrl}
                onChange={(e) =>
                  setDrafts((d) => ({ ...d, publicBaseUrl: e.target.value }))
                }
                onBlur={() => {
                  if (drafts.publicBaseUrl !== view.publicBaseUrl)
                    void apply({ publicBaseUrl: drafts.publicBaseUrl });
                }}
                disabled={saving}
              />
            </div>

            <div
              style={{
                ...readyBoxStyle,
                borderColor: view.ready
                  ? 'rgba(52, 211, 153, 0.35)'
                  : 'rgba(245, 158, 11, 0.35)',
                background: view.ready
                  ? 'rgba(52, 211, 153, 0.08)'
                  : 'rgba(245, 158, 11, 0.08)',
                color: view.ready ? '#5eead4' : '#fbbf24',
              }}
            >
              {view.ready ? (
                <>
                  ✅ {PROVIDER_LABELS[provider]} 配置完整,
                  Volcengine Seedance i2v / r2v 可用
                </>
              ) : (
                <>
                  ⚠ 缺少 AK / SK / bucket / region 中的某项, 还不能开始 staging
                </>
              )}
              <button
                type="button"
                style={{ ...buttonAccentStyle, marginLeft: 12 }}
                onClick={() => void load()}
                disabled={loading}
              >
                刷新
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
};

const hintStyle: React.CSSProperties = {
  fontSize: 12,
  color: tokens.textSecondary,
  lineHeight: 1.6,
  marginBottom: 12,
};

const readyBoxStyle: React.CSSProperties = {
  marginTop: 12,
  padding: '8px 12px',
  borderRadius: 6,
  border: '1px solid',
  fontSize: 12,
  lineHeight: 1.6,
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
};
