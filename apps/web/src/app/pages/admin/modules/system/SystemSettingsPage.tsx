import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Database,
  Eye,
  EyeOff,
  ExternalLink,
  Folder,
  Github,
  HardDrive,
  History,
  KeyRound,
  Link2,
  Plug,
  Scale,
  Timer,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  getHistorySettings,
  getOpenaiSettings,
  getVolcengineSettings,
  updateVolcengineSettings,
  getProviderSettings,
  getStorageSettings,
  pruneHistory,
  updateHistorySettings,
  updateOpenaiSettings,
  updateProviderSettings,
  updateStorageSettings,
} from '../../api/admin-api';
import { TestConnectionButton } from './TestConnectionButton';
import type {
  HistoryKind,
  HistorySettingsView,
  StorageSettingsView,
} from '../../types';
import {
  buttonAccentStyle,
  buttonStyle,
  buttonGhostStyle,
  emptyStyle,
  fieldLabelStyle,
  fieldRowStyle,
  inputMonoStyle,
  inputStyle,
  sectionBodyStyle,
  sectionStyle,
  sectionTitleStyle,
  tokens,
} from '../config/styles';
import { NetworkSection } from './NetworkSection';
import { DesktopSection } from './DesktopSection';
import { OssSection } from './OssSection';


/**
 * /admin/system — 系统设置 page.
 *
 * Aggregates everything an operator can tune at runtime without a
 * backend restart, as a stack of self-contained section components:
 *   1. Source · License (AGPL §13 compliance)
 *   2. 模型 Provider 设置 (DashScope + OpenAI-compat in one card,
 *      tabbed; future ByteDance / Google add a tab without changing
 *      the layout)
 *   3. 生成历史保留策略 (max age / max per kind / 立即清理)
 *   4. 本地存储 (data dir / 最大文件大小 / 占用统计)
 *
 * The page itself is just a router — every section owns its own
 * load/save state so a backend hiccup on one endpoint never blocks
 * the rest of the page from rendering.
 *
 * Save semantics mirror the backend DTOs:
 *   - field omitted        → untouched
 *   - empty string         → clear (revert to default / "未配置")
 *   - timeouts.{kind} = 0  → clear (revert to per-kind hard-coded fallback)
 *   - history/storage numeric -1 sentinel → clear (revert to built-in default)
 */
export const SystemSettingsPage: React.FC = () => (
  <div style={pageStyle}>
    <Header />

    {/* AGPL §13 注脚：网络服务部署必须给用户一个明显的途径拿到对应版本源码。
        这一段在 /admin/system 顶部 + 在普通 canvas 页底部的 Footer 里都
        挂一份，确保 SaaS 部署也满足 corresponding source 要求。 */}
    <SourceLicenseSection />

    {/* 模型 provider —— DashScope + OpenAI-compat 合并 tab 卡片 */}
    <ProvidersSection />

    {/* 网络代理 — 影响 backend axios 出站; 国内厂商建议禁用代理 */}
    <NetworkSection />

    {/* 对象存储 — Volcengine Seedance i2v / r2v 必需; 不配则只能跑 t2v */}
    <OssSection />

    {/* 桌面端独占 (GPU 加速等) — 浏览器访问时显示 "桌面端独占" disabled 态 */}
    <DesktopSection />

    {/* Generation history retention */}
    <HistoryRetentionSection />

    {/* Local storage */}
    <StorageSection />
  </div>
);

const Header: React.FC = () => {
  const { t } = useTranslation();
  return (
    <header style={headerStyle}>
      <div>
        <h1 style={titleStyle}>{t('settings:system.pageTitle')}</h1>
        <div style={subTitleStyle}>{t('settings:system.pageSubtitle')}</div>
      </div>
    </header>
  );
};

/**
 * AGPL-3.0 §13 compliance widget.
 *
 * Whenever this stack is reachable over a network, anyone interacting
 * with it must be able to obtain "corresponding source" for the exact
 * running version. We surface that here as the most prominent card on
 * /admin/system, with three signals:
 *   - Repo URL  → where to clone source
 *   - Version   → which tag of that repo to check out
 *   - License   → AGPL-3.0-only with a link to the verbatim text
 *
 * Values are baked at build time (vite `define`) so they reflect the
 * artifact actually served, not whatever the runtime DB might claim.
 */
const SourceLicenseSection: React.FC = () => {
  const { t } = useTranslation();
  return (
  <section style={sectionStyle}>
    <h3 style={sectionTitleStyle}>
      <Github size={11} style={{ verticalAlign: 'middle', marginRight: 6 }} />
      {t('settings:system.source.title')}
    </h3>
    <div style={sectionBodyStyle}>
      <p style={hintStyle}>
        {t('settings:system.source.hint', { license: __ARK_LICENSE_NAME__ })}
      </p>
      <div style={statusGridStyle}>
        <StatusCard
          icon={<Github size={14} />}
          label={t('settings:system.source.sourceLabel')}
          value={
            <a
              href={__ARK_REPO_URL__}
              target="_blank"
              rel="noopener noreferrer"
              style={sourceLinkStyle}
            >
              {__ARK_REPO_URL__.replace(/^https?:\/\//, '')}
              <ExternalLink size={11} />
            </a>
          }
          source={t('settings:system.source.sourceSub')}
          ok
        />
        <StatusCard
          icon={<Scale size={14} />}
          label={t('settings:system.source.licenseLabel')}
          value={
            <a
              href={__ARK_LICENSE_URL__}
              target="_blank"
              rel="noopener noreferrer"
              style={sourceLinkStyle}
            >
              {__ARK_LICENSE_NAME__}
              <ExternalLink size={11} />
            </a>
          }
          source={t('settings:system.source.licenseSub')}
          ok
        />
        <StatusCard
          icon={<Database size={14} />}
          label={t('settings:system.source.versionLabel')}
          value={__ARK_VERSION__}
          source={t('settings:system.source.versionSub')}
          ok
        />
      </div>
    </div>
  </section>
  );
};

const sourceLinkStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  color: tokens.textPrimary,
  textDecoration: 'none',
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  fontSize: 13,
};

// labels come from `settings:kind.*` at render time so EN / ZH stay in sync.
const HISTORY_KINDS: { kind: HistoryKind; labelKey: string }[] = [
  { kind: 'image', labelKey: 'settings:kind.image' },
  { kind: 'video', labelKey: 'settings:kind.video' },
  { kind: 'audio', labelKey: 'settings:kind.audio' },
  { kind: 'text', labelKey: 'settings:kind.text' },
];

/**
 * Generation history retention card.
 *
 * Self-contained: fetches & owns its own state (independent of the
 * Provider settings load) so a backend hiccup on /history-settings
 * doesn't block the rest of the page from rendering.
 *
 * The "0 = clear (revert to default)" semantics from the backend dto
 * are surfaced here as a "重置" button next to each input; admins can
 * also explicitly type 0 to disable the knob entirely.
 */
const HistoryRetentionSection: React.FC = () => {
  const { t } = useTranslation();
  const [view, setView] = useState<HistorySettingsView | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pruning, setPruning] = useState(false);
  const [ageDraft, setAgeDraft] = useState('');
  const [perKindDraft, setPerKindDraft] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const v = await getHistorySettings();
      setView(v);
      setAgeDraft('');
      setPerKindDraft('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings:system.history.toastLoadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const apply = async (patch: { maxAgeDays?: number; maxPerKind?: number }) => {
    setSaving(true);
    try {
      const v = await updateHistorySettings(patch);
      setView(v);
      if (patch.maxAgeDays !== undefined) setAgeDraft('');
      if (patch.maxPerKind !== undefined) setPerKindDraft('');
      toast.success(t('settings:common.saved'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings:common.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const runPrune = async () => {
    if (!confirm(t('settings:system.history.confirmPrune'))) return;
    setPruning(true);
    try {
      const { outcome, view: fresh } = await pruneHistory();
      setView(fresh);
      if (outcome.total === 0) {
        toast.success(t('settings:system.history.toastChecked'));
      } else {
        toast.success(
          t('settings:system.history.toastPruned', {
            total: outcome.total,
            age: outcome.ageDeleted,
            perKind: outcome.perKindDeleted,
          }),
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings:system.history.toastPruneFailed'));
    } finally {
      setPruning(false);
    }
  };

  if (!view) {
    return (
      <section style={sectionStyle}>
        <h3 style={sectionTitleStyle}>
          <History size={11} style={{ verticalAlign: 'middle', marginRight: 6 }} />
          {t('settings:system.history.title')}
        </h3>
        <div style={sectionBodyStyle}>
          <div style={emptyStyle}>{loading ? t('settings:common.loading') : t('settings:common.loadFailed')}</div>
        </div>
      </section>
    );
  }

  const ageNum = Number(ageDraft);
  const ageDirty =
    ageDraft !== '' &&
    Number.isFinite(ageNum) &&
    ageNum >= 0 &&
    ageNum !== view.maxAgeDays;
  const perKindNum = Number(perKindDraft);
  const perKindDirty =
    perKindDraft !== '' &&
    Number.isFinite(perKindNum) &&
    perKindNum >= 0 &&
    perKindNum !== view.maxPerKind;

  return (
    <section style={sectionStyle}>
      <h3 style={sectionTitleStyle}>
        <History size={11} style={{ verticalAlign: 'middle', marginRight: 6 }} />
        {t('settings:system.history.title')}
      </h3>
      <div style={sectionBodyStyle}>
        <p style={hintStyle}>{t('settings:system.history.hint')}</p>

        {/* Counts overview */}
        <div style={countsRowStyle}>
          <CountChip label={t('settings:kind.total')} value={view.counts.total} primary />
          {HISTORY_KINDS.map(({ kind, labelKey }) => (
            <CountChip key={kind} label={t(labelKey)} value={view.counts[kind] ?? 0} />
          ))}
        </div>

        {/* Knobs */}
        <div style={fieldRowStyle}>
          <span style={fieldLabelStyle}>{t('settings:system.history.maxAgeDays')}</span>
          <input
            value={ageDraft}
            onChange={(e) => setAgeDraft(e.target.value)}
            placeholder={t('settings:system.history.placeholderAge', {
              cur: view.maxAgeDays,
              def: view.maxAgeDaysDefault,
              suffix: view.maxAgeDaysConfigured ? '' : t('settings:system.history.notConfiguredSuffix'),
            })}
            style={{ ...inputStyle, width: 220, flex: 'none' }}
            type="number"
            min="0"
            disabled={saving}
          />
          <button
            type="button"
            onClick={() => apply({ maxAgeDays: Math.floor(ageNum) })}
            style={ageDirty ? buttonAccentStyle : buttonStyle}
            disabled={!ageDirty || saving}
          >
            {t('settings:common.save')}
          </button>
          {view.maxAgeDaysConfigured && (
            <button
              type="button"
              onClick={() => apply({ maxAgeDays: -1 })}
              style={buttonGhostStyle}
              disabled={saving}
              title={t('settings:system.history.resetAgeTitle', { count: view.maxAgeDaysDefault })}
            >
              {t('settings:common.resetDefault')}
            </button>
          )}
        </div>

        <div style={fieldRowStyle}>
          <span style={fieldLabelStyle}>{t('settings:system.history.maxPerKind')}</span>
          <input
            value={perKindDraft}
            onChange={(e) => setPerKindDraft(e.target.value)}
            placeholder={t('settings:system.history.placeholderPerKind', {
              cur: view.maxPerKind,
              def: view.maxPerKindDefault,
              suffix: view.maxPerKindConfigured ? '' : t('settings:system.history.notConfiguredSuffix'),
            })}
            style={{ ...inputStyle, width: 220, flex: 'none' }}
            type="number"
            min="0"
            disabled={saving}
          />
          <button
            type="button"
            onClick={() => apply({ maxPerKind: Math.floor(perKindNum) })}
            style={perKindDirty ? buttonAccentStyle : buttonStyle}
            disabled={!perKindDirty || saving}
          >
            {t('settings:common.save')}
          </button>
          {view.maxPerKindConfigured && (
            <button
              type="button"
              onClick={() => apply({ maxPerKind: -1 })}
              style={buttonGhostStyle}
              disabled={saving}
              title={t('settings:system.history.resetPerKindTitle', { count: view.maxPerKindDefault })}
            >
              {t('settings:common.resetDefault')}
            </button>
          )}
        </div>

        {/* Manual prune */}
        <div style={fieldRowStyle}>
          <span style={fieldLabelStyle}>{t('settings:system.history.manualPrune')}</span>
          <button
            type="button"
            onClick={() => void runPrune()}
            style={buttonStyle}
            disabled={pruning || saving}
          >
            <Trash2 size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />
            {pruning ? t('settings:system.history.pruning') : t('settings:common.run')}
          </button>
          <span style={lastPruneStyle}>
            {view.lastPruneAt
              ? t('settings:system.history.lastPrune', {
                  at: new Date(view.lastPruneAt).toLocaleString(),
                  count: view.lastPruneDeleted,
                })
              : t('settings:system.history.lastPruneNever')}
          </span>
        </div>
      </div>
    </section>
  );
};

/**
 * Local storage settings card.
 *
 * Open-source build is local-disk-only — no cloud-storage abstraction.
 * Two knobs total:
 *
 *   - dataDir       : where bytes live on disk. Source precedence is
 *                     DB → env(`STORAGE_LOCAL_DATA_DIR`) → built-in
 *                     default `/data/uploads`. The view banner shows
 *                     which source is currently winning.
 *   - maxFileSize   : per-file upload cap in bytes (UI shows MB).
 *
 * Stats (`bytes`, `fileCount`) are recomputed on every GET via a
 * `walk(dataDir)` on the backend; cheap enough for ~100k files.
 *
 * For i2i / i2v workflows that need a public URL, the dashscope
 * provider re-stages the local file to dashscope-temp at submit
 * time — see `DashscopeUploadService.stageLocalUrlsToTemp`. No
 * configuration needed here.
 */
const StorageSection: React.FC = () => {
  const { t } = useTranslation();
  const [view, setView] = useState<StorageSettingsView | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [drafts, setDrafts] = useState({
    dataDir: '',
    maxFileSizeMb: '',
  });

  const load = async () => {
    setLoading(true);
    try {
      const v = await getStorageSettings();
      setView(v);
      setDrafts({
        dataDir: v.dataDirSource === 'db' ? v.dataDir : '',
        maxFileSizeMb: v.maxFileSizeConfigured
          ? String(Math.floor(v.maxFileSize / 1024 / 1024))
          : '',
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings:system.storage.toastLoadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const apply = async (patch: { dataDir?: string; maxFileSize?: number }) => {
    setSaving(true);
    try {
      const v = await updateStorageSettings(patch);
      setView(v);
      setDrafts((s) => ({
        ...s,
        dataDir:
          patch.dataDir !== undefined
            ? v.dataDirSource === 'db'
              ? v.dataDir
              : ''
            : s.dataDir,
        maxFileSizeMb:
          patch.maxFileSize !== undefined
            ? v.maxFileSizeConfigured
              ? String(Math.floor(v.maxFileSize / 1024 / 1024))
              : ''
            : s.maxFileSizeMb,
      }));
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
          <HardDrive size={11} style={{ verticalAlign: 'middle', marginRight: 6 }} />
          {t('settings:system.storage.title')}
        </h3>
        <div style={sectionBodyStyle}>
          <div style={emptyStyle}>{loading ? t('settings:common.loading') : t('settings:common.loadFailed')}</div>
        </div>
      </section>
    );
  }

  const dataDirDirty =
    drafts.dataDir.trim() !== (view.dataDirSource === 'db' ? view.dataDir : '');
  const maxMbNum = Number(drafts.maxFileSizeMb);
  const currentMaxMb = view.maxFileSizeConfigured
    ? String(Math.floor(view.maxFileSize / 1024 / 1024))
    : '';
  const maxFileSizeDirty =
    drafts.maxFileSizeMb !== currentMaxMb &&
    (drafts.maxFileSizeMb === '' || (Number.isFinite(maxMbNum) && maxMbNum >= 0));

  // dataDir 来源标签 (从 settings:system.storage.sourceLabel.* 拿翻译).
  const sourceLabel: Record<StorageSettingsView['dataDirSource'], string> = {
    db: t('settings:system.storage.sourceLabel.db'),
    env: t('settings:system.storage.sourceLabel.env'),
    default: t('settings:system.storage.sourceLabel.default'),
  };

  return (
    <section style={sectionStyle}>
      <h3 style={sectionTitleStyle}>
        <HardDrive size={11} style={{ verticalAlign: 'middle', marginRight: 6 }} />
        {t('settings:system.storage.title')}
      </h3>
      <div style={sectionBodyStyle}>
        <p style={hintStyle}>{t('settings:system.storage.hint')}</p>

        {/* Status overview */}
        <div style={statusGridStyle}>
          <StatusCard
            icon={<Folder size={14} />}
            label={t('settings:system.storage.dataDirLabel')}
            value={view.dataDir}
            source={`${sourceLabel[view.dataDirSource]} · ${view.dataDirDefault}`}
            ok
          />
          <StatusCard
            icon={<Database size={14} />}
            label={t('settings:system.storage.sizeLabel')}
            value={formatBytes(view.stats.bytes)}
            source={t('settings:system.storage.sizeSub', { count: view.stats.fileCount.toLocaleString() })}
            ok
          />
          <StatusCard
            icon={<Link2 size={14} />}
            label={t('settings:system.storage.publicUrlLabel')}
            value={`${view.publicBaseUrl}/<key>`}
            source={t('settings:system.storage.publicUrlSub')}
            ok
          />
        </div>

        {/* Data dir */}
        <div style={fieldRowStyle}>
          <span style={fieldLabelStyle}>{t('settings:system.storage.dataDirLabel')}</span>
          <input
            value={drafts.dataDir}
            onChange={(e) => setDrafts((s) => ({ ...s, dataDir: e.target.value }))}
            placeholder={
              view.dataDirSource === 'db'
                ? t('settings:system.storage.dataDirPlaceholderConfigured')
                : view.dataDirSource === 'env'
                  ? `${sourceLabel.env}: ${view.dataDir}`
                  : `${sourceLabel.default}: ${view.dataDirDefault}`
            }
            style={inputMonoStyle}
            disabled={saving}
          />
          <button
            type="button"
            onClick={() => apply({ dataDir: drafts.dataDir.trim() })}
            style={dataDirDirty ? buttonAccentStyle : buttonStyle}
            disabled={!dataDirDirty || saving}
          >
            {t('settings:common.save')}
          </button>
          {view.dataDirSource === 'db' && (
            <button
              type="button"
              onClick={() => {
                if (!confirm(t('settings:system.storage.dataDirConfirmClear'))) return;
                void apply({ dataDir: '' });
              }}
              style={buttonGhostStyle}
              disabled={saving}
              title={t('settings:system.storage.dataDirResetTitle')}
            >
              {t('settings:common.resetDefault')}
            </button>
          )}
        </div>

        {/* Max File Size */}
        <div style={fieldRowStyle}>
          <span style={fieldLabelStyle}>{t('settings:system.storage.maxFileLabel')}</span>
          <input
            value={drafts.maxFileSizeMb}
            onChange={(e) => setDrafts((s) => ({ ...s, maxFileSizeMb: e.target.value }))}
            placeholder={t('settings:system.storage.maxFilePlaceholder', {
              cur: Math.floor(view.maxFileSize / 1024 / 1024),
              def: Math.floor(view.maxFileSizeDefault / 1024 / 1024),
              suffix: view.maxFileSizeConfigured ? '' : t('settings:system.history.notConfiguredSuffix'),
            })}
            style={{ ...inputStyle, width: 240, flex: 'none' }}
            type="number"
            min="0"
            disabled={saving}
          />
          <button
            type="button"
            onClick={() =>
              apply({
                maxFileSize:
                  drafts.maxFileSizeMb === ''
                    ? -1
                    : Math.floor(Number(drafts.maxFileSizeMb)) * 1024 * 1024,
              })
            }
            style={maxFileSizeDirty ? buttonAccentStyle : buttonStyle}
            disabled={!maxFileSizeDirty || saving}
          >
            {t('settings:common.save')}
          </button>
          {view.maxFileSizeConfigured && (
            <button
              type="button"
              onClick={() => apply({ maxFileSize: -1 })}
              style={buttonGhostStyle}
              disabled={saving}
              title={`清除 DB 配置，回退到内置默认 ${Math.floor(view.maxFileSizeDefault / 1024 / 1024)} MB`}
            >
              重置默认
            </button>
          )}
        </div>
      </div>
    </section>
  );
};

/** 1234567 → "1.18 MB". Used by StorageSection · stats. */
function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const v = bytes / Math.pow(1024, i);
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 2)} ${units[i]}`;
}

const CountChip: React.FC<{ label: string; value: number; primary?: boolean }> = ({
  label,
  value,
  primary,
}) => (
  <div
    style={{
      ...countChipStyle,
      borderColor: primary ? tokens.borderAccent : tokens.border,
      color: primary ? tokens.accent : tokens.textSecondary,
    }}
  >
    <span style={countChipLabelStyle}>{label}</span>
    <span style={countChipValueStyle}>{value}</span>
  </div>
);

const StatusCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  // 改为 ReactNode 以支持 SourceLicenseSection 里链接 + 图标的组合 cell；
  // 旧调用全是字符串，向后兼容（string ⊂ ReactNode）。
  value: React.ReactNode;
  source: string;
  ok: boolean;
}> = ({ icon, label, value, source, ok }) => (
  <div style={{ ...statusCardStyle, borderColor: ok ? tokens.border : 'rgba(255,180,171,0.4)' }}>
    <div style={statusCardHeadStyle}>
      <span style={{ color: ok ? tokens.accent : tokens.err, display: 'inline-flex' }}>{icon}</span>
      <span>{label}</span>
    </div>
    <div style={statusCardValueStyle}>{value}</div>
    <div style={{ ...statusCardSrcStyle, color: ok ? tokens.textMuted : tokens.err }}>{source}</div>
  </div>
);

// ---- 模型 Provider 设置（合并卡片）-----------------------------------------
//
// 把 DashScope 和 OpenAI-compat 的配置合在一张大卡片里，UI 解决三个迷惑点：
//   1. 顶部 4 张状态卡（两个 provider × baseUrl/apiKey）一眼看全配置态，
//      不用滚屏来回对比。
//   2. Tabs 切换具体 provider 的详细配置 —— 一屏只看一个，避免之前
//      "一直往下滚不知道还在配 DashScope 还是已经到 OpenAI" 的混乱。
//   3. 每个 tab 顶部一行"影响范围" callout，明确告诉操作者：改这里的
//      凭据/超时 影响的是哪些 SKU 前缀。前缀表跟 ProviderRegistry 的
//      supports() 一致，没有"文档跟代码漂移"的风险。
//
// 未来加字节/谷歌：在 PROVIDER_CARDS 数组里加一项即可，UI 自动多一个 tab。

interface ProviderCard {
  id: 'dashscope' | 'openai' | 'volcengine';
  /** i18n key for the human-readable provider label (tab + status card). */
  labelKey: string;
  defaultBaseUrl: string;
  /** 影响范围 chips：每条对应 ProviderRegistry 里的一个 supports() 前缀。 */
  scopeChips: { sku: string; modality: 'chat' | 'image' | 'video' | 'audio' }[];
  /** 超时档位 + 文案 (label 保 English 跟 backend kind 对齐, hint 走 i18n). */
  timeoutKinds: { kind: ProviderKind; label: string; hintKey: string }[];
  timeoutsHintKey: string;
  baseUrlHintKey: string;
  apiKeyHintKey: string;
  /** 可选的二段警告 (Volcengine OSS 依赖), 红字渲染. */
  apiKeyWarningKey?: string;
  load: () => Promise<ProviderConfigView>;
  save: (patch: ProviderConfigPatch) => Promise<ProviderConfigView>;
  /** 清除 apiKey 弹窗话术的 i18n key (每个 provider 单独, 列出影响 SKU). */
  clearKeyConfirmKey: string;
}

type ProviderKind = 'chat' | 'image' | 'video' | 'audio';

interface ProviderConfigView {
  baseUrl: string;
  baseUrlConfigured: boolean;
  apiKeyMask: string | null;
  apiKeyConfigured: boolean;
  timeouts: Record<ProviderKind, { value: number; default: number; configured: boolean }>;
}

interface ProviderConfigPatch {
  baseUrl?: string;
  apiKey?: string;
  timeouts?: Partial<Record<ProviderKind, number>>;
}

const PROVIDER_CARDS: ProviderCard[] = [
  {
    id: 'dashscope',
    labelKey: 'settings:system.providers.dashscope.label',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com',
    scopeChips: [
      { sku: 'qwen-*', modality: 'chat' },
      { sku: 'deepseek*', modality: 'chat' },
      { sku: 'glm*', modality: 'chat' },
      { sku: 'wan2.7-image*', modality: 'image' },
      { sku: 'wan2.6-* / wan2.7-*', modality: 'video' },
      { sku: 'happyhorse*', modality: 'video' },
      { sku: 'speech-* / fun-music*', modality: 'audio' },
    ],
    timeoutKinds: [
      { kind: 'chat', label: 'Chat', hintKey: 'settings:system.providers.dashscope.kindHints.chat' },
      { kind: 'image', label: 'Image', hintKey: 'settings:system.providers.dashscope.kindHints.image' },
      { kind: 'video', label: 'Video', hintKey: 'settings:system.providers.dashscope.kindHints.video' },
      { kind: 'audio', label: 'Audio', hintKey: 'settings:system.providers.dashscope.kindHints.audio' },
    ],
    timeoutsHintKey: 'settings:system.providers.dashscope.timeoutsHint',
    baseUrlHintKey: 'settings:system.providers.dashscope.baseUrlHint',
    apiKeyHintKey: 'settings:system.providers.dashscope.apiKeyHint',
    load: getProviderSettings,
    save: updateProviderSettings,
    clearKeyConfirmKey: 'settings:system.providers.dashscope.clearKeyConfirm',
  },
  {
    id: 'openai',
    labelKey: 'settings:system.providers.openai.label',
    defaultBaseUrl: 'https://api.openai.com/v1',
    scopeChips: [
      { sku: 'openai-chat/*', modality: 'chat' },
      { sku: 'openai-image/*', modality: 'image' },
    ],
    timeoutKinds: [
      { kind: 'chat', label: 'Chat', hintKey: 'settings:system.providers.openai.kindHints.chat' },
      { kind: 'image', label: 'Image', hintKey: 'settings:system.providers.openai.kindHints.image' },
      { kind: 'video', label: 'Video', hintKey: 'settings:system.providers.openai.kindHints.video' },
      { kind: 'audio', label: 'Audio', hintKey: 'settings:system.providers.openai.kindHints.audio' },
    ],
    timeoutsHintKey: 'settings:system.providers.openai.timeoutsHint',
    baseUrlHintKey: 'settings:system.providers.openai.baseUrlHint',
    apiKeyHintKey: 'settings:system.providers.openai.apiKeyHint',
    load: getOpenaiSettings,
    save: updateOpenaiSettings,
    clearKeyConfirmKey: 'settings:system.providers.openai.clearKeyConfirm',
  },
  {
    id: 'volcengine',
    labelKey: 'settings:system.providers.volcengine.label',
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    scopeChips: [
      { sku: 'doubao-seedance-* / seedance-*', modality: 'video' },
    ],
    timeoutKinds: [
      { kind: 'chat', label: 'Chat', hintKey: 'settings:system.providers.volcengine.kindHints.chat' },
      { kind: 'image', label: 'Image', hintKey: 'settings:system.providers.volcengine.kindHints.image' },
      { kind: 'video', label: 'Video', hintKey: 'settings:system.providers.volcengine.kindHints.video' },
      { kind: 'audio', label: 'Audio', hintKey: 'settings:system.providers.volcengine.kindHints.audio' },
    ],
    timeoutsHintKey: 'settings:system.providers.volcengine.timeoutsHint',
    baseUrlHintKey: 'settings:system.providers.volcengine.baseUrlHint',
    apiKeyHintKey: 'settings:system.providers.volcengine.apiKeyHint',
    apiKeyWarningKey: 'settings:system.providers.volcengine.ossWarning',
    load: getVolcengineSettings,
    save: updateVolcengineSettings,
    clearKeyConfirmKey: 'settings:system.providers.volcengine.clearKeyConfirm',
  },
];

const ProvidersSection: React.FC = () => {
  const { t } = useTranslation();
  const [activeId, setActiveId] = useState<ProviderCard['id']>('dashscope');
  // 两个 provider 各自的 view + draft 都 own 在这里，并发 load 一次拿到。
  const [views, setViews] = useState<Record<ProviderCard['id'], ProviderConfigView | null>>({
    dashscope: null,
    openai: null,
    volcengine: null,
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [baseUrlDrafts, setBaseUrlDrafts] = useState<Record<ProviderCard['id'], string>>({
    dashscope: '',
    openai: '',
    volcengine: '',
  });
  const [apiKeyDrafts, setApiKeyDrafts] = useState<Record<ProviderCard['id'], string>>({
    dashscope: '',
    openai: '',
    volcengine: '',
  });
  const [showKey, setShowKey] = useState<Record<ProviderCard['id'], boolean>>({
    dashscope: false,
    openai: false,
    volcengine: false,
  });

  const loadAll = async () => {
    setLoading(true);
    try {
      const entries = await Promise.all(
        PROVIDER_CARDS.map(async (c) => {
          const v = await c.load();
          return [c.id, v] as const;
        }),
      );
      const next = { ...views };
      const nextBaseDrafts = { ...baseUrlDrafts };
      for (const [id, v] of entries) {
        next[id] = v;
        nextBaseDrafts[id] = v.baseUrlConfigured ? v.baseUrl : '';
      }
      setViews(next);
      setBaseUrlDrafts(nextBaseDrafts);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings:system.providers.toastLoadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apply = async (id: ProviderCard['id'], patch: ProviderConfigPatch) => {
    const card = PROVIDER_CARDS.find((c) => c.id === id);
    if (!card) return;
    setSaving(true);
    try {
      const v = await card.save(patch);
      setViews((s) => ({ ...s, [id]: v }));
      if (patch.baseUrl !== undefined) {
        setBaseUrlDrafts((s) => ({ ...s, [id]: v.baseUrlConfigured ? v.baseUrl : '' }));
      }
      if (patch.apiKey !== undefined) {
        setApiKeyDrafts((s) => ({ ...s, [id]: '' }));
        setShowKey((s) => ({ ...s, [id]: false }));
      }
      toast.success(t('settings:common.saved'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings:common.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const allLoaded = PROVIDER_CARDS.every((c) => views[c.id] !== null);

  return (
    <section style={sectionStyle}>
      <h3 style={sectionTitleStyle}>
        <Plug size={11} style={{ verticalAlign: 'middle', marginRight: 6 }} />
        {t('settings:system.providers.sectionTitle')}
      </h3>
      <div style={sectionBodyStyle}>

        {/* 4 张状态卡：两 provider × (baseUrl, apiKey) —— 一眼看全配置态 */}
        <div style={statusGridStyle}>
          {PROVIDER_CARDS.map((card) => {
            const v = views[card.id];
            return (
              <React.Fragment key={card.id}>
                <StatusCard
                  icon={<Link2 size={14} />}
                  label={`${t(card.labelKey)} · ${t('settings:system.providers.statusCard.baseUrlLabel')}`}
                  value={v ? v.baseUrl : t('settings:common.loading')}
                  source={v ? (v.baseUrlConfigured ? t('settings:common.dbOverride') : t('settings:common.builtinDefault')) : ''}
                  ok
                />
                <StatusCard
                  icon={<KeyRound size={14} />}
                  label={`${t(card.labelKey)} · ${t('settings:system.providers.statusCard.apiKeyLabel')}`}
                  value={
                    v
                      ? v.apiKeyConfigured
                        ? v.apiKeyMask ?? t('settings:common.configured')
                        : t('settings:common.notConfigured')
                      : t('settings:common.loading')
                  }
                  source={
                    v
                      ? v.apiKeyConfigured
                        ? t('settings:system.providers.statusCard.apiKeySourceConfigured')
                        : t('settings:system.providers.statusCard.apiKeySourceMissing')
                      : ''
                  }
                  ok={v ? v.apiKeyConfigured : true}
                />
              </React.Fragment>
            );
          })}
        </div>

        {/* Tabs */}
        <div style={tabBarStyle}>
          {PROVIDER_CARDS.map((card) => {
            const active = card.id === activeId;
            return (
              <button
                key={card.id}
                type="button"
                onClick={() => setActiveId(card.id)}
                style={active ? tabActiveStyle : tabStyle}
              >
                {t(card.labelKey)}
              </button>
            );
          })}
        </div>

        {!allLoaded ? (
          <div style={emptyStyle}>{loading ? t('settings:common.loading') : t('settings:common.loadFailed')}</div>
        ) : (
          <ProviderTabBody
            card={PROVIDER_CARDS.find((c) => c.id === activeId)!}
            view={views[activeId]!}
            saving={saving}
            baseUrlDraft={baseUrlDrafts[activeId]}
            setBaseUrlDraft={(s) => setBaseUrlDrafts((prev) => ({ ...prev, [activeId]: s }))}
            apiKeyDraft={apiKeyDrafts[activeId]}
            setApiKeyDraft={(s) => setApiKeyDrafts((prev) => ({ ...prev, [activeId]: s }))}
            showKey={showKey[activeId]}
            setShowKey={(b) => setShowKey((prev) => ({ ...prev, [activeId]: b }))}
            apply={(patch) => apply(activeId, patch)}
          />
        )}
      </div>
    </section>
  );
};

const ProviderTabBody: React.FC<{
  card: ProviderCard;
  view: ProviderConfigView;
  saving: boolean;
  baseUrlDraft: string;
  setBaseUrlDraft: (s: string) => void;
  apiKeyDraft: string;
  setApiKeyDraft: (s: string) => void;
  showKey: boolean;
  setShowKey: (b: boolean) => void;
  apply: (patch: ProviderConfigPatch) => void;
}> = ({
  card,
  view,
  saving,
  baseUrlDraft,
  setBaseUrlDraft,
  apiKeyDraft,
  setApiKeyDraft,
  showKey,
  setShowKey,
  apply,
}) => {
  const { t } = useTranslation();
  const baseUrlDirty = baseUrlDraft.trim() !== (view.baseUrlConfigured ? view.baseUrl : '');
  const apiKeyDirty = apiKeyDraft.trim().length > 0;

  return (
    <div style={tabBodyStyle}>
      {/* 影响范围 callout：明确告诉用户改这个 provider 会影响哪些 SKU */}
      <ScopeCallout chips={card.scopeChips} vendorLabel={t(card.labelKey)} />

      {/* Base URL */}
      <div style={fieldGroupStyle}>
        <div style={fieldGroupHeadStyle}>
          <Link2 size={12} />
          <span>Base URL</span>
        </div>
        <p style={hintStyle}>{t(card.baseUrlHintKey)}</p>
        <div style={fieldRowStyle}>
          <span style={fieldLabelStyle}>Base URL</span>
          <input
            value={baseUrlDraft}
            onChange={(e) => setBaseUrlDraft(e.target.value)}
            placeholder={t('settings:system.providers.baseUrlPlaceholder', { url: card.defaultBaseUrl })}
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
          {view.baseUrlConfigured && (
            <button
              type="button"
              onClick={() => apply({ baseUrl: '' })}
              style={buttonGhostStyle}
              disabled={saving}
              title={t('settings:system.providers.baseUrlResetTitle')}
            >
              {t('settings:common.resetDefault')}
            </button>
          )}
        </div>
      </div>

      {/* API Key */}
      <div style={fieldGroupStyle}>
        <div style={fieldGroupHeadStyle}>
          <KeyRound size={12} />
          <span>API Key</span>
        </div>
        <p style={hintStyle}>{t(card.apiKeyHintKey)}</p>
        {card.apiKeyWarningKey && (
          <p style={{ ...hintStyle, color: tokens.warn, marginTop: 6 }}>
            {t(card.apiKeyWarningKey)}
          </p>
        )}
        <div style={fieldRowStyle}>
          <span style={fieldLabelStyle}>API Key</span>
          <div style={apiKeyInputWrapStyle}>
            <input
              value={apiKeyDraft}
              onChange={(e) => setApiKeyDraft(e.target.value)}
              placeholder={
                view.apiKeyConfigured
                  ? t('settings:system.providers.apiKeyPlaceholderConfigured', { mask: view.apiKeyMask })
                  : t('settings:system.providers.apiKeyPlaceholderEmpty')
              }
              type={showKey ? 'text' : 'password'}
              style={{ ...inputMonoStyle, paddingRight: 36 }}
              disabled={saving}
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
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
          {view.apiKeyConfigured && (
            <button
              type="button"
              onClick={() => {
                if (!confirm(t(card.clearKeyConfirmKey))) return;
                apply({ apiKey: '' });
              }}
              style={buttonGhostStyle}
              disabled={saving}
              title={t('settings:system.providers.apiKeyClearTitle')}
            >
              {t('settings:common.clear')}
            </button>
          )}
        </div>
        {/* 探活按钮: 输入框为空时用 DB 已存的, 非空时用草稿; 详细规则见
            TestConnectionButton 组件文档. 放在 API Key 行下面是因为它最常和
            "我刚改了 key 想验一下"或"配错了不知道为啥不通"的两类操作绑在一起.
            Volcengine 暂未接 ProviderConnectivityService 的 testVolcengine
            endpoint, 隐藏按钮 — 等 Slice 3 (asset 后端) 起来一起补. */}
        {card.id !== 'volcengine' && (
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>{t('settings:system.testConnection.label')}</span>
            <TestConnectionButton
              providerId={card.id}
              baseUrlDraft={baseUrlDraft}
              apiKeyDraft={apiKeyDraft}
              hasSavedKey={view.apiKeyConfigured}
              disabled={saving}
            />
          </div>
        )}
      </div>

      {/* Timeouts */}
      <div style={fieldGroupStyle}>
        <div style={fieldGroupHeadStyle}>
          <Timer size={12} />
          <span>{t('settings:system.providers.timeoutsTitle')}</span>
        </div>
        <p style={hintStyle}>{t(card.timeoutsHintKey)}</p>
        <TimeoutsTable
          view={view}
          kinds={card.timeoutKinds}
          saving={saving}
          apply={(timeouts) => apply({ timeouts })}
        />
      </div>
    </div>
  );
};

/**
 * 影响范围 callout：列出当前 provider 接管的 SKU 前缀，按 modality 分组色码。
 * 单一目的就是回答 "我改这里会影响哪些模型？" — 不夹杂任何其它信息。
 *
 * 数据是静态的（{@link PROVIDER_CARDS}.scopeChips），跟 ProviderRegistry 的
 * supports() 保持手工对齐。一旦后端加新前缀，这里要顺手更新一行。
 */
const ScopeCallout: React.FC<{
  chips: ProviderCard['scopeChips'];
  vendorLabel: string;
}> = ({ chips, vendorLabel }) => {
  const { t } = useTranslation();
  return (
    <div style={scopeCalloutStyle}>
      <div style={scopeCalloutHeadStyle}>
        <span style={scopeCalloutLabelStyle}>{t('settings:system.scopeCallout.label')}</span>
        <span style={scopeCalloutDescStyle}>
          {t('settings:system.scopeCallout.desc', { vendor: vendorLabel })}
        </span>
      </div>
      <div style={scopeChipsStyle}>
        {chips.map((c, i) => (
          <span key={`${c.sku}-${i}`} style={{ ...scopeChipStyle, ...modalityChipStyle[c.modality] }}>
            <code style={{ background: 'transparent', padding: 0 }}>{c.sku}</code>
            <span style={scopeChipModalityStyle}>{c.modality}</span>
          </span>
        ))}
      </div>
    </div>
  );
};

const TimeoutsTable: React.FC<{
  view: ProviderConfigView;
  kinds: ProviderCard['timeoutKinds'];
  saving: boolean;
  apply: (timeouts: Partial<Record<ProviderKind, number>>) => void;
}> = ({ view, kinds, saving, apply }) => {
  const { t } = useTranslation();
  const [drafts, setDrafts] = useState<Record<ProviderKind, string>>({
    chat: '',
    image: '',
    video: '',
    audio: '',
  });

  return (
    <div style={timeoutTableStyle}>
      {kinds.map(({ kind, label, hintKey }) => {
        const entry = view.timeouts[kind];
        const draft = drafts[kind];
        const draftNum = Number(draft);
        const dirty =
          draft !== '' &&
          Number.isFinite(draftNum) &&
          draftNum > 0 &&
          draftNum !== entry.value;
        return (
          <div key={kind} style={timeoutRowStyle}>
            <div style={timeoutLabelColStyle}>
              <span style={timeoutLabelStyle}>{label}</span>
              <span style={timeoutHintStyle}>{t(hintKey)}</span>
            </div>
            <div style={timeoutValueColStyle}>
              <span style={timeoutCurrentStyle}>{entry.value}s</span>
              {entry.configured ? (
                <span style={{ ...badgeStyle, color: tokens.ok, borderColor: 'rgba(155,227,154,0.3)' }}>
                  DB
                </span>
              ) : (
                <span style={badgeStyle}>{t('settings:common.builtinDefault')}</span>
              )}
            </div>
            <input
              value={draft}
              onChange={(e) => setDrafts((s) => ({ ...s, [kind]: e.target.value }))}
              placeholder={t('settings:system.providers.timeoutPlaceholder')}
              style={{ ...inputStyle, width: 100, flex: 'none' }}
              type="number"
              min="1"
              disabled={saving}
            />
            <button
              type="button"
              onClick={() => {
                if (!Number.isFinite(draftNum) || draftNum <= 0) return;
                apply({ [kind]: Math.floor(draftNum) });
                setDrafts((s) => ({ ...s, [kind]: '' }));
              }}
              style={dirty ? buttonAccentStyle : buttonStyle}
              disabled={!dirty || saving}
            >
              {t('settings:common.save')}
            </button>
            {entry.configured ? (
              <button
                type="button"
                onClick={() => apply({ [kind]: 0 })}
                style={buttonGhostStyle}
                disabled={saving}
                title={t('settings:system.providers.timeoutResetTitle')}
              >
                {t('settings:common.resetDefault')}
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};

// ---- styles ---------------------------------------------------------------

const pageStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 20,
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-end',
  flexWrap: 'wrap',
  gap: 16,
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 20,
  fontWeight: 600,
  color: tokens.textPrimary,
};

const subTitleStyle: React.CSSProperties = {
  marginTop: 4,
  fontSize: 12,
  color: tokens.textMuted,
};

const statusGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 12,
};

const statusCardStyle: React.CSSProperties = {
  background: tokens.bgCard,
  border: '1px solid',
  borderRadius: 10,
  padding: '12px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const statusCardHeadStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  color: tokens.textMuted,
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  fontWeight: 500,
};

const statusCardValueStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  fontSize: 13,
  color: tokens.textPrimary,
  wordBreak: 'break-all',
};

const statusCardSrcStyle: React.CSSProperties = {
  fontSize: 11,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
};

const hintStyle: React.CSSProperties = {
  margin: '0 0 4px',
  fontSize: 11,
  lineHeight: 1.6,
  color: tokens.textMuted,
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

// ---- ProvidersSection 专用样式 -------------------------------------------

const tabBarStyle: React.CSSProperties = {
  display: 'flex',
  gap: 2,
  borderBottom: `1px solid ${tokens.border}`,
  marginTop: 16,
};

const tabStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  // 没 active 的 tab 不带自己的下边线, 也不 marginBottom:-1 上拉.
  // 这样 tabBar 那条 1px 灰线在每个 tab 下方都正常贯穿, 不被
  // transparent border 刮掉一段 — 跟用户报告的 "tabs 没点击过下方
  // 没有白色底边" 对得上.
  borderBottom: '2px solid transparent',
  color: tokens.textMuted,
  fontSize: 12,
  padding: '8px 14px',
  cursor: 'pointer',
  fontWeight: 500,
};

const tabActiveStyle: React.CSSProperties = {
  ...tabStyle,
  color: tokens.textPrimary,
  // 必须用 shorthand `borderBottom` 而不是 longhand `borderBottomColor`.
  // tabStyle 是 shorthand, 如果这里用 longhand 覆盖, React 切回 inactive
  // 时移除 longhand 但 shorthand 已被浏览器拆成 width/style/color 三条,
  // color 那条没人重写就丢, 之前 active 的 tab 切走后看起来还像 active.
  borderBottom: `2px solid ${tokens.accent}`,
  // 上拉 1px 让 accent border 跟 tabBar 的 1px 灰线 (border) 重合,
  // 视觉上是 "选中的 tab 用 accent 色顶替了那段灰线".
  marginBottom: -1,
};

const tabBodyStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  paddingTop: 14,
};

const fieldGroupStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  paddingBottom: 8,
  borderBottom: `1px dashed ${tokens.border}`,
};

const fieldGroupHeadStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  color: tokens.textPrimary,
  fontSize: 12,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
};

const scopeCalloutStyle: React.CSSProperties = {
  background: tokens.bgCard,
  border: `1px solid ${tokens.border}`,
  borderRadius: 8,
  padding: '10px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const scopeCalloutHeadStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 8,
  flexWrap: 'wrap',
};

const scopeCalloutLabelStyle: React.CSSProperties = {
  color: tokens.accent,
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
};

const scopeCalloutDescStyle: React.CSSProperties = {
  fontSize: 11,
  color: tokens.textMuted,
  lineHeight: 1.5,
};

const scopeChipsStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
};

const scopeChipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '3px 8px',
  borderRadius: 6,
  fontSize: 11,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  border: '1px solid',
};

const scopeChipModalityStyle: React.CSSProperties = {
  fontSize: 9,
  textTransform: 'uppercase',
  letterSpacing: 0.6,
  opacity: 0.7,
  fontFamily: 'inherit',
};

/**
 * 按 modality 着色 —— 让"chat / image / video / audio"在 chips 里一眼区分。
 * 颜色取自现有 tokens 体系，避免引入新的颜色变量。
 */
const modalityChipStyle: Record<ProviderKind, React.CSSProperties> = {
  chat: { color: tokens.textPrimary, borderColor: tokens.border, background: 'rgba(255,255,255,0.02)' },
  image: { color: tokens.accent, borderColor: 'rgba(180,200,255,0.3)', background: 'rgba(120,140,255,0.06)' },
  video: { color: tokens.ok, borderColor: 'rgba(155,227,154,0.3)', background: 'rgba(120,200,120,0.06)' },
  audio: { color: '#e6c97a', borderColor: 'rgba(230,201,122,0.3)', background: 'rgba(230,201,122,0.06)' },
};

const timeoutTableStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
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
  flex: '0 0 220px',
  gap: 2,
};

const timeoutLabelStyle: React.CSSProperties = {
  color: tokens.textPrimary,
  fontSize: 13,
  fontWeight: 500,
};

const timeoutHintStyle: React.CSSProperties = {
  color: tokens.textFaint,
  fontSize: 10,
};

const timeoutValueColStyle: React.CSSProperties = {
  flex: '0 0 110px',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
};

const timeoutCurrentStyle: React.CSSProperties = {
  color: tokens.textSecondary,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  fontSize: 13,
};

const badgeStyle: React.CSSProperties = {
  display: 'inline-block',
  fontSize: 9,
  padding: '1px 6px',
  borderRadius: 999,
  border: '1px solid rgba(255,255,255,0.08)',
  background: tokens.bgChip,
  color: tokens.textMuted,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  letterSpacing: 0.3,
};

const countsRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap',
  marginBottom: 4,
};

const countChipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 10px',
  borderRadius: 8,
  background: tokens.bgChip,
  border: '1px solid',
  fontSize: 11,
};

const countChipLabelStyle: React.CSSProperties = {
  color: tokens.textMuted,
  fontSize: 10,
};

const countChipValueStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  fontSize: 12,
};

const lastPruneStyle: React.CSSProperties = {
  color: tokens.textMuted,
  fontSize: 11,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
};
