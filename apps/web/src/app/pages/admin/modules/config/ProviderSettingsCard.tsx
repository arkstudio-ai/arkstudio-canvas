import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Eye, EyeOff, KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { getProviderSettings, updateProviderSettings } from '../../api/admin-api';
import type { DashscopeKind, ProviderSettingsView } from '../../types';
import {
  buttonAccentStyle,
  buttonStyle,
  buttonGhostStyle,
  fieldLabelStyle,
  fieldRowStyle,
  inputMonoStyle,
  inputStyle,
  sectionBodyStyle,
  sectionStyle,
  sectionTitleStyle,
  tokens,
} from './styles';

const TIMEOUT_KINDS: { kind: DashscopeKind; label: string; hintKey: string }[] = [
  { kind: 'chat', label: 'Chat', hintKey: 'settings:config.providerCard.kinds.chatHint' },
  { kind: 'image', label: 'Image', hintKey: 'settings:config.providerCard.kinds.imageHint' },
  { kind: 'video', label: 'Video', hintKey: 'settings:config.providerCard.kinds.videoHint' },
  { kind: 'audio', label: 'Audio', hintKey: 'settings:config.providerCard.kinds.audioHint' },
];

const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com';

/**
 * DashScope (Bailian) base URL + API key admin panel.
 *
 * Two notable safety properties baked in here:
 *   1. The plaintext apiKey is never available client-side. The view
 *      payload only carries a mask (sk-1de...0252). To change it, the
 *      operator types the new key into a separate input + clicks save.
 *   2. Empty input fields = "untouched". To clear a value (revert to
 *      the built-in default URL / "未配置" key), the operator must
 *      use the dedicated [清除并用默认值] / [清除 apiKey] buttons,
 *      which send an explicit empty string. This avoids the foot-gun
 *      where blanking a field by accident wipes the credential.
 *
 * Sits inside CanvasConfigPage as a collapsible card; default folded so
 * the daily node-config workflow isn't visually crowded.
 */
export const ProviderSettingsCard: React.FC = () => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<ProviderSettingsView | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [baseUrlDraft, setBaseUrlDraft] = useState('');
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [showKey, setShowKey] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const v = await getProviderSettings();
      setView(v);
      setBaseUrlDraft(v.baseUrlConfigured ? v.baseUrl : '');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings:config.providerCard.toastLoadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const apply = async (patch: {
    baseUrl?: string;
    apiKey?: string;
    timeouts?: Partial<Record<DashscopeKind, number>>;
  }) => {
    setSaving(true);
    try {
      const v = await updateProviderSettings(patch);
      setView(v);
      if (patch.baseUrl !== undefined) {
        setBaseUrlDraft(v.baseUrlConfigured ? v.baseUrl : '');
      }
      if (patch.apiKey !== undefined) {
        setApiKeyDraft('');
        setShowKey(false);
      }
      toast.success(t('settings:common.saved'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings:common.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const baseUrlDirty = view ? baseUrlDraft.trim() !== (view.baseUrlConfigured ? view.baseUrl : '') : false;
  const apiKeyDirty = apiKeyDraft.trim().length > 0;

  return (
    <section style={sectionStyle}>
      <div style={titleRowStyle}>
        <button type="button" onClick={() => setOpen((o) => !o)} style={collapseBtnStyle}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <KeyRound size={13} />
          <span>{t('settings:config.providerCard.title')}</span>
        </button>
        <div style={statusRowStyle}>
          {view ?
            <>
              <StatusPill ok={view.baseUrlConfigured || true} label="baseUrl">
                {view.baseUrl === DEFAULT_BASE_URL && !view.baseUrlConfigured ? t('settings:config.providerCard.statusDefault') : t('settings:config.providerCard.statusDB')}
              </StatusPill>
              <StatusPill ok={view.apiKeyConfigured} label="apiKey">
                {view.apiKeyConfigured ? view.apiKeyMask ?? 'OK' : t('settings:common.notConfigured')}
              </StatusPill>
            </>
          : <span style={{ fontSize: 11, color: tokens.textMuted }}>{loading ? t('settings:common.loading') : ''}</span>}
        </div>
      </div>

      {open && (
        <div style={sectionBodyStyle}>
          <p style={hintStyle}>{t('settings:config.providerCard.hint')}</p>

          {/* Base URL row */}
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>Base URL</span>
            <input
              value={baseUrlDraft}
              onChange={(e) => setBaseUrlDraft(e.target.value)}
              placeholder={t('settings:config.providerCard.baseUrlPlaceholder', { url: DEFAULT_BASE_URL })}
              style={inputMonoStyle}
              disabled={saving}
            />
            <button
              type="button"
              onClick={() => apply({ baseUrl: baseUrlDraft.trim() })}
              style={baseUrlDirty ? buttonAccentStyle : buttonStyle}
              disabled={!baseUrlDirty || saving}
            >
              {t('settings:common.save')}
            </button>
            {view?.baseUrlConfigured && (
              <button
                type="button"
                onClick={() => apply({ baseUrl: '' })}
                style={buttonGhostStyle}
                disabled={saving}
                title={t('settings:config.providerCard.baseUrlResetTitle')}
              >
                {t('settings:common.resetDefault')}
              </button>
            )}
          </div>

          {/* API Key row */}
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>API Key</span>
            <div style={apiKeyInputWrapStyle}>
              <input
                value={apiKeyDraft}
                onChange={(e) => setApiKeyDraft(e.target.value)}
                placeholder={view?.apiKeyConfigured
                  ? t('settings:config.providerCard.apiKeyPlaceholderConfigured', { mask: view.apiKeyMask })
                  : t('settings:config.providerCard.apiKeyPlaceholderEmpty')}
                type={showKey ? 'text' : 'password'}
                style={{ ...inputMonoStyle, paddingRight: 36 }}
                disabled={saving}
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowKey((s) => !s)}
                style={eyeBtnStyle}
                title={showKey ? t('settings:common.hide') : t('settings:common.show')}
                tabIndex={-1}
              >
                {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
            <button
              type="button"
              onClick={() => apply({ apiKey: apiKeyDraft.trim() })}
              style={apiKeyDirty ? buttonAccentStyle : buttonStyle}
              disabled={!apiKeyDirty || saving}
            >
              {t('settings:common.save')}
            </button>
            {view?.apiKeyConfigured && (
              <button
                type="button"
                onClick={() => {
                  if (!confirm(t('settings:config.providerCard.clearKeyConfirm'))) return;
                  void apply({ apiKey: '' });
                }}
                style={buttonGhostStyle}
                disabled={saving}
                title={t('settings:config.providerCard.apiKeyClearTitle')}
              >
                {t('settings:common.clear')}
              </button>
            )}
          </div>

          {view && <TimeoutsSection view={view} saving={saving} apply={apply} />}
        </div>
      )}
    </section>
  );
};

const TimeoutsSection: React.FC<{
  view: ProviderSettingsView;
  saving: boolean;
  apply: (patch: { timeouts?: Partial<Record<DashscopeKind, number>> }) => void;
}> = ({ view, saving, apply }) => {
  const { t } = useTranslation();
  const [drafts, setDrafts] = useState<Record<DashscopeKind, string>>({
    chat: '',
    image: '',
    video: '',
    audio: '',
  });

  return (
    <div style={timeoutsBlockStyle}>
      <div style={timeoutsHeadStyle}>
        <span>{t('settings:config.providerCard.timeoutsTitle')}</span>
        <span style={{ color: tokens.textFaint, fontSize: 10 }}>
          {t('settings:config.providerCard.timeoutsCaveat')}
        </span>
      </div>
      {TIMEOUT_KINDS.map(({ kind, label, hintKey }) => {
        const entry = view.timeouts[kind];
        const draft = drafts[kind];
        const draftNum = Number(draft);
        const dirty = draft !== '' && Number.isFinite(draftNum) && draftNum > 0 && draftNum !== entry.value;
        return (
          <div key={kind} style={timeoutRowStyle}>
            <div style={timeoutLabelColStyle}>
              <span style={timeoutLabelStyle}>{label}</span>
              <span style={timeoutHintStyle}>{t(hintKey)}</span>
            </div>
            <div style={timeoutValueColStyle}>
              <span style={timeoutCurrentStyle}>
                {entry.value}s
                {entry.configured ?
                  <span style={{ ...badgeStyle, color: tokens.ok, borderColor: 'rgba(155,227,154,0.3)' }}>{t('settings:config.providerCard.dbBadge')}</span>
                : <span style={{ ...badgeStyle, color: tokens.textMuted }}>{t('settings:config.providerCard.defaultBadge', { seconds: entry.default })}</span>}
              </span>
            </div>
            <input
              value={draft}
              onChange={(e) => setDrafts((s) => ({ ...s, [kind]: e.target.value }))}
              placeholder={t('settings:config.providerCard.timeoutPlaceholder')}
              style={{ ...inputStyle, width: 100, flex: 'none' }}
              type="number"
              min="1"
              disabled={saving}
            />
            <button
              type="button"
              onClick={() => {
                if (!Number.isFinite(draftNum) || draftNum <= 0) return;
                apply({ timeouts: { [kind]: Math.floor(draftNum) } });
                setDrafts((s) => ({ ...s, [kind]: '' }));
              }}
              style={dirty ? buttonAccentStyle : buttonStyle}
              disabled={!dirty || saving}
            >
              {t('settings:common.save')}
            </button>
            {entry.configured ?
              <button
                type="button"
                onClick={() => apply({ timeouts: { [kind]: 0 } })}
                style={buttonGhostStyle}
                disabled={saving}
                title={t('settings:config.providerCard.timeoutResetTitle')}
              >
                {t('settings:common.resetDefault')}
              </button>
            : null}
          </div>
        );
      })}
    </div>
  );
};

const StatusPill: React.FC<{ ok: boolean; label: string; children: React.ReactNode }> = ({
  ok,
  label,
  children,
}) => (
  <span style={{ ...pillStyle, color: ok ? tokens.ok : tokens.warn, borderColor: ok ? 'rgba(155,227,154,0.3)' : 'rgba(230,200,147,0.3)' }}>
    <span style={{ color: tokens.textMuted, marginRight: 6 }}>{label}:</span>
    {children}
  </span>
);

const titleRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  ...sectionTitleStyle,
  textTransform: 'none',
  letterSpacing: 0,
  fontSize: 13,
  fontWeight: 500,
  color: tokens.textSecondary,
  cursor: 'default',
};

const collapseBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  background: 'transparent',
  border: 'none',
  color: tokens.textSecondary,
  cursor: 'pointer',
  padding: 4,
  fontSize: 13,
  fontWeight: 500,
  fontFamily: 'inherit',
};

const statusRowStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
};

const pillStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  fontSize: 11,
  padding: '2px 8px',
  borderRadius: 999,
  border: '1px solid',
  background: tokens.bgChip,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
};

const hintStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 11,
  lineHeight: 1.5,
  color: tokens.textMuted,
  padding: '4px 0 8px',
  borderBottom: `1px dashed ${tokens.border}`,
};

const apiKeyInputWrapStyle: React.CSSProperties = {
  position: 'relative',
  flex: 1,
  minWidth: 0,
  display: 'flex',
};

const eyeBtnStyle: React.CSSProperties = {
  position: 'absolute',
  right: 6,
  top: '50%',
  transform: 'translateY(-50%)',
  background: 'transparent',
  border: 'none',
  color: tokens.textMuted,
  cursor: 'pointer',
  padding: 4,
  display: 'inline-flex',
  alignItems: 'center',
};

const timeoutsBlockStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  marginTop: 6,
  paddingTop: 12,
  borderTop: `1px dashed ${tokens.border}`,
};

const timeoutsHeadStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 10,
  fontSize: 11,
  color: tokens.textMuted,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  fontWeight: 500,
};

const timeoutRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  flexWrap: 'wrap',
};

const timeoutLabelColStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: '0 0 200px',
  gap: 2,
};

const timeoutLabelStyle: React.CSSProperties = {
  color: tokens.textPrimary,
  fontSize: 12,
  fontWeight: 500,
};

const timeoutHintStyle: React.CSSProperties = {
  color: tokens.textFaint,
  fontSize: 10,
};

const timeoutValueColStyle: React.CSSProperties = {
  flex: '0 0 130px',
  display: 'flex',
  alignItems: 'center',
};

const timeoutCurrentStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  color: tokens.textSecondary,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  fontSize: 12,
};

const badgeStyle: React.CSSProperties = {
  display: 'inline-block',
  fontSize: 9,
  padding: '1px 6px',
  borderRadius: 999,
  border: '1px solid rgba(255,255,255,0.08)',
  background: tokens.bgChip,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  letterSpacing: 0.3,
};
