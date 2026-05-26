// /admin/system → 对象存储 (OSS / TOS) section.
//
// Backed by /api/canvas-flow/oss-settings. Once configured, Volcengine
// Seedance i2v / r2v can stage local backend uploads to the configured
// bucket and feed the resulting public URL to upstream.
//
// 不配置时 Volcengine Seedance 只能跑纯文本 t2v — runtime 抛 400 引导
// 用户回来这里配置. Volcengine 卡片那条 hint 也指这.

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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

const PROVIDER_LABEL_KEYS: Record<OssProvider, string> = {
  'aliyun-oss': 'settings:system.oss.providerAliyun',
  'volcengine-tos': 'settings:system.oss.providerVolcengine',
};

const REGION_HINT_KEYS: Record<OssProvider, string> = {
  'aliyun-oss': 'settings:system.oss.regionHintAliyun',
  'volcengine-tos': 'settings:system.oss.regionHintVolcengine',
};

const SAMPLE_URL_KEYS: Record<OssProvider, string> = {
  'aliyun-oss': 'settings:system.oss.publicBaseUrlSampleAliyun',
  'volcengine-tos': 'settings:system.oss.publicBaseUrlSampleVolcengine',
};

export const OssSection: React.FC = () => {
  const { t } = useTranslation();
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
      toast.error(err instanceof Error ? err.message : t('settings:system.oss.toastLoadFailed'));
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
      toast.success(t('settings:common.saved'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings:common.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  if (!view) {
    return (
      <section style={sectionStyle}>
        <h3 style={sectionTitleStyle}>
          <Database size={11} style={{ verticalAlign: 'middle', marginRight: 6 }} />
          {t('settings:system.oss.title')}
        </h3>
        <div style={sectionBodyStyle}>
          <div style={emptyStyle}>{loading ? t('settings:common.loading') : t('settings:common.loadFailed')}</div>
        </div>
      </section>
    );
  }

  const provider = view.provider;
  const sampleUrl = provider
    ? t(SAMPLE_URL_KEYS[provider])
    : t('settings:system.oss.publicBaseUrlSampleFallback');

  return (
    <section style={sectionStyle}>
      <h3 style={sectionTitleStyle}>
        <Database size={11} style={{ verticalAlign: 'middle', marginRight: 6 }} />
        {t('settings:system.oss.title')}
      </h3>
      <div style={sectionBodyStyle}>
        <div style={hintStyle}>{t('settings:system.oss.hint')}</div>

        <div style={fieldRowStyle}>
          <span style={fieldLabelStyle}>{t('settings:system.oss.providerLabel')}</span>
          <select
            style={{ ...inputMonoStyle, width: '100%' }}
            value={provider ?? ''}
            onChange={(e) => {
              const v = e.target.value as OssProvider | '';
              void apply({ provider: v });
            }}
            disabled={saving}
          >
            <option value="">{t('settings:system.oss.providerNoneOption')}</option>
            <option value="aliyun-oss">{t('settings:system.oss.providerAliyun')}</option>
            <option value="volcengine-tos">{t('settings:system.oss.providerVolcengine')}</option>
          </select>
        </div>

        {provider && (
          <>
            <div style={fieldRowStyle}>
              <span style={fieldLabelStyle}>{t('settings:system.oss.accessKeyIdLabel')}</span>
              <input
                style={inputMonoStyle}
                type="text"
                placeholder={view.accessKeyIdMask ?? t('settings:system.oss.accessKeyIdPlaceholder')}
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
              <span style={fieldLabelStyle}>{t('settings:system.oss.accessKeySecretLabel')}</span>
              <input
                style={inputMonoStyle}
                type="password"
                placeholder={
                  view.accessKeySecretConfigured
                    ? t('settings:system.oss.accessKeySecretPlaceholderConfigured')
                    : t('settings:system.oss.accessKeySecretPlaceholderEmpty')
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
              <span style={fieldLabelStyle}>{t('settings:system.oss.bucketLabel')}</span>
              <input
                style={inputMonoStyle}
                placeholder={t('settings:system.oss.bucketPlaceholder')}
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
              <span style={fieldLabelStyle}>{t('settings:system.oss.regionLabel')}</span>
              <input
                style={inputMonoStyle}
                placeholder={t(REGION_HINT_KEYS[provider])}
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
              <span style={fieldLabelStyle}>{t('settings:system.oss.endpointLabel')}</span>
              <input
                style={inputMonoStyle}
                placeholder={t('settings:system.oss.endpointPlaceholder')}
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
              <span style={fieldLabelStyle}>{t('settings:system.oss.publicBaseUrlLabel')}</span>
              <input
                style={inputMonoStyle}
                placeholder={t('settings:system.oss.publicBaseUrlPlaceholder', { sample: sampleUrl })}
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
              {view.ready
                ? t('settings:system.oss.readyMessage', { provider: t(PROVIDER_LABEL_KEYS[provider]) })
                : t('settings:system.oss.notReadyMessage')}
              <button
                type="button"
                style={{ ...buttonAccentStyle, marginLeft: 12 }}
                onClick={() => void load()}
                disabled={loading}
              >
                {t('settings:common.refresh')}
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
