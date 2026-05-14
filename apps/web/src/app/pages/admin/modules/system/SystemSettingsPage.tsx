import React, { useEffect, useState } from 'react';
import {
  Cloud,
  Database,
  Eye,
  EyeOff,
  ExternalLink,
  Github,
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
  getProviderSettings,
  getStorageSettings,
  pruneHistory,
  updateHistorySettings,
  updateOpenaiSettings,
  updateProviderSettings,
  updateStorageSettings,
} from '../../api/admin-api';
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
 *   4. 对象存储 (Tencent COS) 凭据 + bucket / region / 自定义域名 / TTL / 大小上限
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

    {/* Generation history retention */}
    <HistoryRetentionSection />

    {/* Object Storage (Tencent COS) */}
    <StorageSection />
  </div>
);

const Header: React.FC = () => (
  <header style={headerStyle}>
    <div>
      <h1 style={titleStyle}>系统设置</h1>
      <div style={subTitleStyle}>
        开源信息 · 模型 Provider · 生成历史保留 · 对象存储
      </div>
    </div>
  </header>
);

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
const SourceLicenseSection: React.FC = () => (
  <section style={sectionStyle}>
    <h3 style={sectionTitleStyle}>
      <Github size={11} style={{ verticalAlign: 'middle', marginRight: 6 }} />
      Source · License
    </h3>
    <div style={sectionBodyStyle}>
      <p style={hintStyle}>
        本服务以 <strong>{__ARK_LICENSE_NAME__}</strong> 协议开源；按 AGPL §13
        网络互动条款，部署方需要让访问者能拿到对应版本的源代码。
      </p>
      <div style={statusGridStyle}>
        <StatusCard
          icon={<Github size={14} />}
          label="Source code"
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
          source="git clone · 完整可重建"
          ok
        />
        <StatusCard
          icon={<Scale size={14} />}
          label="License"
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
          source="copyleft · 修改/SaaS 必须开源"
          ok
        />
        <StatusCard
          icon={<Database size={14} />}
          label="Version"
          value={__ARK_VERSION__}
          source="对应 git tag / GitHub release"
          ok
        />
      </div>
    </div>
  </section>
);

const sourceLinkStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  color: tokens.textPrimary,
  textDecoration: 'none',
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  fontSize: 13,
};

const HISTORY_KINDS: { kind: HistoryKind; label: string }[] = [
  { kind: 'image', label: '图片' },
  { kind: 'video', label: '视频' },
  { kind: 'audio', label: '音频' },
  { kind: 'text', label: '文本' },
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
      toast.error(err instanceof Error ? err.message : '加载历史设置失败');
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
      toast.success('已保存');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const runPrune = async () => {
    if (!confirm('确认立即清理超出保留策略的历史记录? 不可恢复。')) return;
    setPruning(true);
    try {
      const { outcome, view: fresh } = await pruneHistory();
      setView(fresh);
      if (outcome.total === 0) {
        toast.success('已检查，无需清理');
      } else {
        toast.success(
          `已清理 ${outcome.total} 条 (按时间 ${outcome.ageDeleted}, 按数量 ${outcome.perKindDeleted})`,
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '清理失败');
    } finally {
      setPruning(false);
    }
  };

  if (!view) {
    return (
      <section style={sectionStyle}>
        <h3 style={sectionTitleStyle}>
          <History size={11} style={{ verticalAlign: 'middle', marginRight: 6 }} />
          生成历史保留
        </h3>
        <div style={sectionBodyStyle}>
          <div style={emptyStyle}>{loading ? '加载中…' : '加载失败'}</div>
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
        生成历史保留
      </h3>
      <div style={sectionBodyStyle}>
        <p style={hintStyle}>
          开源版不跑定时任务：每次新生成会顺手做一次节流清理（10 分钟内最多触发一次），
          也可以从下面的「立即清理」按钮强制触发。两个阈值任一保存为 0 表示禁用该维度。
        </p>

        {/* Counts overview */}
        <div style={countsRowStyle}>
          <CountChip label="总计" value={view.counts.total} primary />
          {HISTORY_KINDS.map(({ kind, label }) => (
            <CountChip key={kind} label={label} value={view.counts[kind] ?? 0} />
          ))}
        </div>

        {/* Knobs */}
        <div style={fieldRowStyle}>
          <span style={fieldLabelStyle}>最大保留天数</span>
          <input
            value={ageDraft}
            onChange={(e) => setAgeDraft(e.target.value)}
            placeholder={`当前 ${view.maxAgeDays}d · 默认 ${view.maxAgeDaysDefault}d${view.maxAgeDaysConfigured ? '' : ' (未配置)'}`}
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
            保存
          </button>
          {view.maxAgeDaysConfigured && (
            <button
              type="button"
              onClick={() => apply({ maxAgeDays: -1 })}
              style={buttonGhostStyle}
              disabled={saving}
              title={`清除 DB 配置，回退到内置默认 ${view.maxAgeDaysDefault} 天`}
            >
              重置默认
            </button>
          )}
        </div>

        <div style={fieldRowStyle}>
          <span style={fieldLabelStyle}>每个 kind 最多条数</span>
          <input
            value={perKindDraft}
            onChange={(e) => setPerKindDraft(e.target.value)}
            placeholder={`当前 ${view.maxPerKind} · 默认 ${view.maxPerKindDefault}${view.maxPerKindConfigured ? '' : ' (未配置)'}`}
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
            保存
          </button>
          {view.maxPerKindConfigured && (
            <button
              type="button"
              onClick={() => apply({ maxPerKind: -1 })}
              style={buttonGhostStyle}
              disabled={saving}
              title={`清除 DB 配置，回退到内置默认 ${view.maxPerKindDefault} 条/kind`}
            >
              重置默认
            </button>
          )}
        </div>

        {/* Manual prune */}
        <div style={fieldRowStyle}>
          <span style={fieldLabelStyle}>立即清理</span>
          <button
            type="button"
            onClick={() => void runPrune()}
            style={buttonStyle}
            disabled={pruning || saving}
          >
            <Trash2 size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />
            {pruning ? '清理中…' : '执行'}
          </button>
          <span style={lastPruneStyle}>
            {view.lastPruneAt
              ? `上次：${new Date(view.lastPruneAt).toLocaleString()} · 删除 ${view.lastPruneDeleted} 条`
              : '上次：未运行（自后端启动）'}
          </span>
        </div>
      </div>
    </section>
  );
};

/**
 * Storage (Tencent COS) settings card.
 *
 * Self-contained -- mirrors HistoryRetentionSection so a backend hiccup
 * on /storage-settings doesn't block the rest of the page.
 *
 * Field semantics match the backend DTO:
 *   - text fields (secretId/secretKey/bucket/region/customDomain):
 *       empty input + 保存 → clear (region: revert to default; rest: null)
 *   - secrets are write-only (mask only; replace by typing a new value)
 *   - signExpires / maxFileSize: 0 is a valid "explicit value" upsert;
 *     "重置默认" sends a sentinel `-1` so the backend deletes the row.
 *
 * `maxFileSize` is stored in bytes server-side but exposed in MB here
 * for usability — operators think in MB, not bytes.
 */
/**
 * Single-line banner that explains the auto-fallback storage strategy
 * the backend just resolved.
 *
 *   cos              → green "走 COS（生产模式）"
 *   dashscope-temp   → amber "未配 COS，走 DashScope 临时存储 · 48h 失效"
 *   none             → red   "未配置 — 上传/转存功能未启用"
 *
 * Why a separate component? StorageSection is already 250+ lines and
 * the banner needs different colours per state, which is awkward to
 * inline. Keep it small + close so the rationale stays obvious.
 */
const StorageStrategyBanner: React.FC<{ view: StorageSettingsView }> = ({ view }) => {
  let bg = '';
  let border = '';
  let icon: React.ReactNode = null;
  let title = '';
  let detail = '';
  switch (view.strategy) {
    case 'cos':
      bg = 'rgba(155,227,154,0.08)';
      border = 'rgba(155,227,154,0.4)';
      icon = <Cloud size={14} style={{ color: tokens.ok }} />;
      title = '当前走 COS · 生产模式';
      detail = '上传 / 转存到你自己的腾讯云桶；URL 长寿命。';
      break;
    case 'dashscope-temp':
      bg = 'rgba(230,200,147,0.08)';
      border = 'rgba(230,200,147,0.4)';
      icon = <Timer size={14} style={{ color: tokens.warn }} />;
      title = '当前走 DashScope 临时存储 · 开箱即用模式';
      detail =
        '未配置 COS，自动 fallback 到 DashScope 免费临时存储（oss:// URL，48h 自动失效，单文件 ≤ 100MB，仅北京 region）。生产部署建议补全下方 COS 凭据。';
      break;
    case 'none':
    default:
      bg = 'rgba(255,180,171,0.10)';
      border = 'rgba(255,180,171,0.5)';
      icon = <KeyRound size={14} style={{ color: tokens.err }} />;
      title = '存储未配置';
      detail = view.dashscopeKeyOk
        ? '理论上 DashScope key 已配，但 strategy 仍解析为 none — 这通常是后端 cache 还没刷新；几秒后刷新本页。'
        : '请至少在上方"DashScope · API Key"填一份 key（开启临时存储 fallback），或者在下方填齐 COS 凭据（生产）。';
      break;
  }
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '10px 12px',
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 10,
        marginBottom: 4,
      }}
    >
      <span style={{ display: 'inline-flex', marginTop: 2 }}>{icon}</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 12, color: tokens.textPrimary, fontWeight: 600 }}>{title}</span>
        <span style={{ fontSize: 11, color: tokens.textMuted, lineHeight: 1.5 }}>{detail}</span>
      </div>
    </div>
  );
};

const StorageSection: React.FC = () => {
  const [view, setView] = useState<StorageSettingsView | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showSecretId, setShowSecretId] = useState(false);
  const [showSecretKey, setShowSecretKey] = useState(false);
  const [drafts, setDrafts] = useState({
    secretId: '',
    secretKey: '',
    bucket: '',
    region: '',
    customDomain: '',
    signExpires: '',
    maxFileSizeMb: '',
  });

  const load = async () => {
    setLoading(true);
    try {
      const v = await getStorageSettings();
      setView(v);
      setDrafts({
        secretId: '',
        secretKey: '',
        bucket: v.bucket ?? '',
        region: v.regionConfigured ? v.region : '',
        customDomain: v.customDomain ?? '',
        signExpires: v.signExpiresConfigured ? String(v.signExpires) : '',
        maxFileSizeMb: v.maxFileSizeConfigured
          ? String(Math.floor(v.maxFileSize / 1024 / 1024))
          : '',
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载存储设置失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const apply = async (
    patch: {
      secretId?: string;
      secretKey?: string;
      bucket?: string;
      region?: string;
      customDomain?: string;
      signExpires?: number;
      maxFileSize?: number;
    },
    onDone?: () => void,
  ) => {
    setSaving(true);
    try {
      const v = await updateStorageSettings(patch);
      setView(v);
      // Re-sync drafts that the server just confirmed; keep secret-input
      // boxes empty so the masked placeholder reads "已配置 · 输入新值覆盖".
      setDrafts((s) => ({
        ...s,
        secretId: patch.secretId !== undefined ? '' : s.secretId,
        secretKey: patch.secretKey !== undefined ? '' : s.secretKey,
        bucket: patch.bucket !== undefined ? v.bucket ?? '' : s.bucket,
        region: patch.region !== undefined ? (v.regionConfigured ? v.region : '') : s.region,
        customDomain:
          patch.customDomain !== undefined ? v.customDomain ?? '' : s.customDomain,
        signExpires:
          patch.signExpires !== undefined
            ? v.signExpiresConfigured
              ? String(v.signExpires)
              : ''
            : s.signExpires,
        maxFileSizeMb:
          patch.maxFileSize !== undefined
            ? v.maxFileSizeConfigured
              ? String(Math.floor(v.maxFileSize / 1024 / 1024))
              : ''
            : s.maxFileSizeMb,
      }));
      if (patch.secretId !== undefined) setShowSecretId(false);
      if (patch.secretKey !== undefined) setShowSecretKey(false);
      onDone?.();
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
          <Cloud size={11} style={{ verticalAlign: 'middle', marginRight: 6 }} />
          对象存储 (COS)
        </h3>
        <div style={sectionBodyStyle}>
          <div style={emptyStyle}>{loading ? '加载中…' : '加载失败'}</div>
        </div>
      </section>
    );
  }

  // ---- dirty checks --------------------------------------------------------
  const bucketDirty = drafts.bucket.trim() !== (view.bucket ?? '');
  const regionDirty =
    drafts.region.trim() !== (view.regionConfigured ? view.region : '');
  const customDomainDirty =
    drafts.customDomain.trim() !== (view.customDomain ?? '');
  const signExpiresNum = Number(drafts.signExpires);
  const signExpiresDirty =
    drafts.signExpires !== (view.signExpiresConfigured ? String(view.signExpires) : '') &&
    (drafts.signExpires === '' || (Number.isFinite(signExpiresNum) && signExpiresNum >= 0));
  const maxMbNum = Number(drafts.maxFileSizeMb);
  const currentMaxMb = view.maxFileSizeConfigured
    ? String(Math.floor(view.maxFileSize / 1024 / 1024))
    : '';
  const maxFileSizeDirty =
    drafts.maxFileSizeMb !== currentMaxMb &&
    (drafts.maxFileSizeMb === '' || (Number.isFinite(maxMbNum) && maxMbNum >= 0));
  const secretIdDirty = drafts.secretId.trim().length > 0;
  const secretKeyDirty = drafts.secretKey.trim().length > 0;

  return (
    <section style={sectionStyle}>
      <h3 style={sectionTitleStyle}>
        <Cloud size={11} style={{ verticalAlign: 'middle', marginRight: 6 }} />
        对象存储 (COS)
      </h3>
      <div style={sectionBodyStyle}>
        <p style={hintStyle}>
          上传 / 转存默认走腾讯云 COS（长寿命 URL，适合生产）。<strong>开源版可选</strong>：
          未配置时自动 fallback 到 DashScope 临时存储（<code>oss://</code> URL，48h 自动失效，
          单文件 100MB 上限，仅北京 region），适合 demo / 试用。SecretId / SecretKey 落库前用
          <code> ENCRYPTION_KEY </code>做 aes-256-gcm 加密，页面只显示掩码，永不回传明文。
        </p>

        {/* 当前生效的存储策略 — auto-fallback 决定，最重要的一眼信息 */}
        <StorageStrategyBanner view={view} />

        {/* Status overview */}
        <div style={statusGridStyle}>
          <StatusCard
            icon={<Database size={14} />}
            label="Bucket"
            value={view.bucket ?? '未配置'}
            source={view.configured ? `${view.region}` : '⚠ 未配置'}
            ok={!!view.bucket}
          />
          <StatusCard
            icon={<KeyRound size={14} />}
            label="SecretKey"
            value={view.secretKeyMask ?? '未配置'}
            source={view.configured ? 'DB · 加密存储' : '⚠ 未配置'}
            ok={view.configured}
          />
        </div>

        {/* Bucket */}
        <div style={fieldRowStyle}>
          <span style={fieldLabelStyle}>Bucket</span>
          <input
            value={drafts.bucket}
            onChange={(e) => setDrafts((s) => ({ ...s, bucket: e.target.value }))}
            placeholder="例: canvas-1314182386"
            style={inputMonoStyle}
            disabled={saving}
          />
          <button
            type="button"
            onClick={() => apply({ bucket: drafts.bucket.trim() })}
            style={bucketDirty ? buttonAccentStyle : buttonStyle}
            disabled={!bucketDirty || saving}
          >
            保存
          </button>
        </div>

        {/* Region */}
        <div style={fieldRowStyle}>
          <span style={fieldLabelStyle}>Region</span>
          <input
            value={drafts.region}
            onChange={(e) => setDrafts((s) => ({ ...s, region: e.target.value }))}
            placeholder={`默认 ${view.regionDefault}`}
            style={inputMonoStyle}
            disabled={saving}
          />
          <button
            type="button"
            onClick={() => apply({ region: drafts.region.trim() })}
            style={regionDirty ? buttonAccentStyle : buttonStyle}
            disabled={!regionDirty || saving}
          >
            保存
          </button>
          {view.regionConfigured && (
            <button
              type="button"
              onClick={() => apply({ region: '' })}
              style={buttonGhostStyle}
              disabled={saving}
              title={`清除 DB 配置，回退到内置默认 ${view.regionDefault}`}
            >
              重置默认
            </button>
          )}
        </div>

        {/* Custom Domain */}
        <div style={fieldRowStyle}>
          <span style={fieldLabelStyle}>自定义域名</span>
          <input
            value={drafts.customDomain}
            onChange={(e) => setDrafts((s) => ({ ...s, customDomain: e.target.value }))}
            placeholder="可选 · 例: cdn.example.com (含全球加速域名)"
            style={inputMonoStyle}
            disabled={saving}
          />
          <button
            type="button"
            onClick={() => apply({ customDomain: drafts.customDomain.trim() })}
            style={customDomainDirty ? buttonAccentStyle : buttonStyle}
            disabled={!customDomainDirty || saving}
          >
            保存
          </button>
          {view.customDomain && (
            <button
              type="button"
              onClick={() => apply({ customDomain: '' })}
              style={buttonGhostStyle}
              disabled={saving}
              title="从 DB 删除该字段，回退到默认 .cos.<region>.myqcloud.com 域名"
            >
              清除
            </button>
          )}
        </div>

        {/* Secret ID */}
        <div style={fieldRowStyle}>
          <span style={fieldLabelStyle}>SecretId</span>
          <div style={apiKeyInputWrapStyle}>
            <input
              value={drafts.secretId}
              onChange={(e) => setDrafts((s) => ({ ...s, secretId: e.target.value }))}
              placeholder={
                view.secretIdMask
                  ? `当前: ${view.secretIdMask} · 输入新值覆盖`
                  : '尚未配置 · 输入 AKID... 并保存'
              }
              type={showSecretId ? 'text' : 'password'}
              style={{ ...inputMonoStyle, paddingRight: 36 }}
              disabled={saving}
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setShowSecretId((s) => !s)}
              style={eyeBtnStyle}
              title={showSecretId ? '隐藏' : '显示'}
              tabIndex={-1}
            >
              {showSecretId ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          </div>
          <button
            type="button"
            onClick={() => apply({ secretId: drafts.secretId.trim() })}
            style={secretIdDirty ? buttonAccentStyle : buttonStyle}
            disabled={!secretIdDirty || saving}
          >
            保存
          </button>
          {view.secretIdMask && (
            <button
              type="button"
              onClick={() => {
                if (!confirm('确认清除 SecretId? 与 SecretKey 任一缺失，COS 上传/转存都会失败。')) return;
                void apply({ secretId: '' });
              }}
              style={buttonGhostStyle}
              disabled={saving}
            >
              清除
            </button>
          )}
        </div>

        {/* Secret Key */}
        <div style={fieldRowStyle}>
          <span style={fieldLabelStyle}>SecretKey</span>
          <div style={apiKeyInputWrapStyle}>
            <input
              value={drafts.secretKey}
              onChange={(e) => setDrafts((s) => ({ ...s, secretKey: e.target.value }))}
              placeholder={
                view.secretKeyMask
                  ? `当前: ${view.secretKeyMask} · 输入新值覆盖`
                  : '尚未配置 · 输入 SecretKey 并保存'
              }
              type={showSecretKey ? 'text' : 'password'}
              style={{ ...inputMonoStyle, paddingRight: 36 }}
              disabled={saving}
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setShowSecretKey((s) => !s)}
              style={eyeBtnStyle}
              title={showSecretKey ? '隐藏' : '显示'}
              tabIndex={-1}
            >
              {showSecretKey ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          </div>
          <button
            type="button"
            onClick={() => apply({ secretKey: drafts.secretKey.trim() })}
            style={secretKeyDirty ? buttonAccentStyle : buttonStyle}
            disabled={!secretKeyDirty || saving}
          >
            保存
          </button>
          {view.secretKeyMask && (
            <button
              type="button"
              onClick={() => {
                if (!confirm('确认清除 SecretKey? 清除后所有上传/转存都会失败，直到重新配置。')) return;
                void apply({ secretKey: '' });
              }}
              style={buttonGhostStyle}
              disabled={saving}
            >
              清除
            </button>
          )}
        </div>

        {/* Sign URL TTL */}
        <div style={fieldRowStyle}>
          <span style={fieldLabelStyle}>签名 URL 有效期</span>
          <input
            value={drafts.signExpires}
            onChange={(e) => setDrafts((s) => ({ ...s, signExpires: e.target.value }))}
            placeholder={`当前 ${view.signExpires}s · 默认 ${view.signExpiresDefault}s${view.signExpiresConfigured ? '' : ' (未配置)'}`}
            style={{ ...inputStyle, width: 240, flex: 'none' }}
            type="number"
            min="0"
            disabled={saving}
          />
          <button
            type="button"
            onClick={() =>
              apply({
                signExpires:
                  drafts.signExpires === '' ? -1 : Math.floor(Number(drafts.signExpires)),
              })
            }
            style={signExpiresDirty ? buttonAccentStyle : buttonStyle}
            disabled={!signExpiresDirty || saving}
          >
            保存
          </button>
          {view.signExpiresConfigured && (
            <button
              type="button"
              onClick={() => apply({ signExpires: -1 })}
              style={buttonGhostStyle}
              disabled={saving}
              title={`清除 DB 配置，回退到内置默认 ${view.signExpiresDefault} 秒`}
            >
              重置默认
            </button>
          )}
        </div>

        {/* Max File Size */}
        <div style={fieldRowStyle}>
          <span style={fieldLabelStyle}>最大文件大小 (MB)</span>
          <input
            value={drafts.maxFileSizeMb}
            onChange={(e) => setDrafts((s) => ({ ...s, maxFileSizeMb: e.target.value }))}
            placeholder={`当前 ${Math.floor(view.maxFileSize / 1024 / 1024)}MB · 默认 ${Math.floor(view.maxFileSizeDefault / 1024 / 1024)}MB${view.maxFileSizeConfigured ? '' : ' (未配置)'}`}
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
            保存
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
  id: 'dashscope' | 'openai';
  label: string;
  defaultBaseUrl: string;
  /** 影响范围 chips：每条对应 ProviderRegistry 里的一个 supports() 前缀。 */
  scopeChips: { sku: string; modality: 'chat' | 'image' | 'video' | 'audio' }[];
  /** 超时档位 + 文案。video/audio 两档保留即使没 provider，让 schema 一致。 */
  timeoutKinds: { kind: ProviderKind; label: string; hint: string }[];
  /** 各档说明 callout 的文字。 */
  timeoutsHint: string;
  baseUrlHint: React.ReactNode;
  apiKeyHint: React.ReactNode;
  load: () => Promise<ProviderConfigView>;
  save: (patch: ProviderConfigPatch) => Promise<ProviderConfigView>;
  /** 只在确认清除 apiKey 时弹的话术；默认是通用文案。 */
  clearKeyConfirm: string;
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
    label: 'DashScope (阿里百炼)',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com',
    scopeChips: [
      { sku: 'qwen-*', modality: 'chat' },
      { sku: 'deepseek*', modality: 'chat' },
      { sku: 'glm*', modality: 'chat' },
      { sku: 'qwen-image*', modality: 'image' },
      { sku: 'wanx*', modality: 'image' },
      { sku: 'wan2.* / wanx2.*', modality: 'video' },
      { sku: 'happyhorse*', modality: 'video' },
      { sku: 'speech-* / fun-music*', modality: 'audio' },
    ],
    timeoutKinds: [
      { kind: 'chat', label: 'Chat', hint: '同步对话调用 (qwen / deepseek / glm)' },
      { kind: 'image', label: 'Image', hint: '异步图像 submit；polling 固定 10s 不暴露' },
      { kind: 'video', label: 'Video', hint: '异步视频 submit；polling 固定 10s 不暴露' },
      { kind: 'audio', label: 'Audio', hint: 'TTS / FunMusic / 音色复刻 submit' },
    ],
    timeoutsHint:
      '按 model kind 分别设置 submit 调用超时。Polling（image/video）固定 10s 不暴露 — polling 是轻 GET，过长意味着是 bug，不是 tuning knob。留空 = 用内置默认；保存值 ≥ 1s。',
    baseUrlHint: (
      <>
        DashScope (Bailian) 网关地址。留空回退到默认 <code>https://dashscope.aliyuncs.com</code>。
        国际版账号请改 <code>https://dashscope-intl.aliyuncs.com</code>。
      </>
    ),
    apiKeyHint: (
      <>
        落库前用 <code>ENCRYPTION_KEY</code> 做 aes-256-gcm 加密；页面只显示掩码（如{' '}
        <code>sk-1de...0252</code>），永不回传明文。修改约 30 秒内对所有 model 调用生效。
      </>
    ),
    load: getProviderSettings,
    save: updateProviderSettings,
    clearKeyConfirm:
      '确认清除 DashScope API Key? 清除后 qwen-* / wanx-* / glm / deepseek / speech-* 等所有阿里系 SKU 都会调用失败。',
  },
  {
    id: 'openai',
    label: 'OpenAI-compatible',
    defaultBaseUrl: 'https://api.openai.com/v1',
    scopeChips: [
      { sku: 'openai-chat/*', modality: 'chat' },
      { sku: 'openai-image/*', modality: 'image' },
    ],
    timeoutKinds: [
      { kind: 'chat', label: 'Chat', hint: '/chat/completions (gpt-* / openrouter / vllm ...)' },
      { kind: 'image', label: 'Image', hint: '/images/generations (dall-e-3 偶发 60s+)' },
      { kind: 'video', label: 'Video', hint: '当前 OpenAI 无标准视频接口；保留以兼容未来扩展' },
      { kind: 'audio', label: 'Audio', hint: '/audio/speech TTS（暂未接入 provider，预留 schema）' },
    ],
    timeoutsHint:
      'DALL-E 3 / GPT-image-1 偶发 60s+，所以默认值比 DashScope 略宽。video / audio 两档暂时无对应 provider，配置仍保留以便未来加入。留空 = 用内置默认；保存值 ≥ 1s。',
    baseUrlHint: (
      <>
        支持任何 <strong>OpenAI Chat Completions / Images Generations</strong> 协议的网关：
        <code>OpenAI</code> · <code>OpenRouter</code> · <code>Together</code> ·{' '}
        <code>Groq</code> · 自建 <code>vLLM</code>。约定 base URL <strong>包含 <code>/v1</code> 且末尾不含斜线</strong>（保存时自动剪掉）。OpenRouter 用{' '}
        <code>https://openrouter.ai/api/v1</code>，自建 vLLM 用 <code>http://your-host:8000/v1</code>。
      </>
    ),
    apiKeyHint: (
      <>
        落库前用 <code>ENCRYPTION_KEY</code> 做 aes-256-gcm 加密；页面只显示掩码（如{' '}
        <code>sk-1de...0252</code>），永不回传明文。配置后才能在 <code>/admin/config</code> 把
        <code>openai-chat/&lt;model&gt;</code>、<code>openai-image/&lt;model&gt;</code> 加进节点 models 列表。
      </>
    ),
    load: getOpenaiSettings,
    save: updateOpenaiSettings,
    clearKeyConfirm:
      '确认清除 OpenAI API Key? 清除后所有 openai-chat/* / openai-image/* SKU 都会调用失败。',
  },
];

const ProvidersSection: React.FC = () => {
  const [activeId, setActiveId] = useState<ProviderCard['id']>('dashscope');
  // 两个 provider 各自的 view + draft 都 own 在这里，并发 load 一次拿到。
  const [views, setViews] = useState<Record<ProviderCard['id'], ProviderConfigView | null>>({
    dashscope: null,
    openai: null,
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [baseUrlDrafts, setBaseUrlDrafts] = useState<Record<ProviderCard['id'], string>>({
    dashscope: '',
    openai: '',
  });
  const [apiKeyDrafts, setApiKeyDrafts] = useState<Record<ProviderCard['id'], string>>({
    dashscope: '',
    openai: '',
  });
  const [showKey, setShowKey] = useState<Record<ProviderCard['id'], boolean>>({
    dashscope: false,
    openai: false,
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
      toast.error(err instanceof Error ? err.message : '加载 Provider 设置失败');
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
      toast.success('已保存');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const allLoaded = PROVIDER_CARDS.every((c) => views[c.id] !== null);

  return (
    <section style={sectionStyle}>
      <h3 style={sectionTitleStyle}>
        <Plug size={11} style={{ verticalAlign: 'middle', marginRight: 6 }} />
        模型 Provider 设置
      </h3>
      <div style={sectionBodyStyle}>
        <p style={hintStyle}>
          每个 Provider 接管一组 SKU 前缀；在下方 tab 里改 baseUrl / apiKey / timeout
          只会影响该 provider 的 SKU。新增的模型条目仍然在 <code>/admin/config</code> 的节点 models 列表里挂。
        </p>

        {/* 4 张状态卡：两 provider × (baseUrl, apiKey) —— 一眼看全配置态 */}
        <div style={statusGridStyle}>
          {PROVIDER_CARDS.map((card) => {
            const v = views[card.id];
            return (
              <React.Fragment key={card.id}>
                <StatusCard
                  icon={<Link2 size={14} />}
                  label={`${card.label} · Base URL`}
                  value={v ? v.baseUrl : '加载中…'}
                  source={v ? (v.baseUrlConfigured ? 'DB 覆盖' : '内置默认') : ''}
                  ok
                />
                <StatusCard
                  icon={<KeyRound size={14} />}
                  label={`${card.label} · API Key`}
                  value={v ? (v.apiKeyConfigured ? v.apiKeyMask ?? '已配置' : '未配置') : '加载中…'}
                  source={
                    v
                      ? v.apiKeyConfigured
                        ? 'DB · 加密存储'
                        : '⚠ 未配置 · 该 provider 不可用'
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
                {card.label}
              </button>
            );
          })}
        </div>

        {!allLoaded ? (
          <div style={emptyStyle}>{loading ? '加载中…' : '加载失败'}</div>
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
  const baseUrlDirty = baseUrlDraft.trim() !== (view.baseUrlConfigured ? view.baseUrl : '');
  const apiKeyDirty = apiKeyDraft.trim().length > 0;

  return (
    <div style={tabBodyStyle}>
      {/* 影响范围 callout：明确告诉用户改这个 provider 会影响哪些 SKU */}
      <ScopeCallout chips={card.scopeChips} vendorLabel={card.label} />

      {/* Base URL */}
      <div style={fieldGroupStyle}>
        <div style={fieldGroupHeadStyle}>
          <Link2 size={12} />
          <span>Base URL</span>
        </div>
        <p style={hintStyle}>{card.baseUrlHint}</p>
        <div style={fieldRowStyle}>
          <span style={fieldLabelStyle}>Base URL</span>
          <input
            value={baseUrlDraft}
            onChange={(e) => setBaseUrlDraft(e.target.value)}
            placeholder={`默认 ${card.defaultBaseUrl}`}
            style={inputMonoStyle}
            disabled={saving}
          />
          <button
            type="button"
            onClick={() => apply({ baseUrl: baseUrlDraft.trim() })}
            style={baseUrlDirty ? buttonAccentStyle : buttonStyle}
            disabled={!baseUrlDirty || saving}
          >
            保存
          </button>
          {view.baseUrlConfigured && (
            <button
              type="button"
              onClick={() => apply({ baseUrl: '' })}
              style={buttonGhostStyle}
              disabled={saving}
              title="清除 DB 配置，回退到默认 URL"
            >
              重置默认
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
        <p style={hintStyle}>{card.apiKeyHint}</p>
        <div style={fieldRowStyle}>
          <span style={fieldLabelStyle}>API Key</span>
          <div style={apiKeyInputWrapStyle}>
            <input
              value={apiKeyDraft}
              onChange={(e) => setApiKeyDraft(e.target.value)}
              placeholder={
                view.apiKeyConfigured
                  ? `当前: ${view.apiKeyMask} · 输入新值覆盖`
                  : '尚未配置 · 输入 sk-... 并保存'
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
              title={showKey ? '隐藏' : '显示'}
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
            保存
          </button>
          {view.apiKeyConfigured && (
            <button
              type="button"
              onClick={() => {
                if (!confirm(card.clearKeyConfirm)) return;
                apply({ apiKey: '' });
              }}
              style={buttonGhostStyle}
              disabled={saving}
              title="从 DB 删除 apiKey 行"
            >
              清除
            </button>
          )}
        </div>
      </div>

      {/* Timeouts */}
      <div style={fieldGroupStyle}>
        <div style={fieldGroupHeadStyle}>
          <Timer size={12} />
          <span>超时设置 (秒)</span>
        </div>
        <p style={hintStyle}>{card.timeoutsHint}</p>
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
}> = ({ chips, vendorLabel }) => (
  <div style={scopeCalloutStyle}>
    <div style={scopeCalloutHeadStyle}>
      <span style={scopeCalloutLabelStyle}>影响范围</span>
      <span style={scopeCalloutDescStyle}>
        改 <strong>{vendorLabel}</strong> 的 baseUrl / apiKey / timeout 会影响以下 SKU 前缀：
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

const TimeoutsTable: React.FC<{
  view: ProviderConfigView;
  kinds: ProviderCard['timeoutKinds'];
  saving: boolean;
  apply: (timeouts: Partial<Record<ProviderKind, number>>) => void;
}> = ({ view, kinds, saving, apply }) => {
  const [drafts, setDrafts] = useState<Record<ProviderKind, string>>({
    chat: '',
    image: '',
    video: '',
    audio: '',
  });

  return (
    <div style={timeoutTableStyle}>
      {kinds.map(({ kind, label, hint }) => {
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
              <span style={timeoutHintStyle}>{hint}</span>
            </div>
            <div style={timeoutValueColStyle}>
              <span style={timeoutCurrentStyle}>{entry.value}s</span>
              {entry.configured ? (
                <span style={{ ...badgeStyle, color: tokens.ok, borderColor: 'rgba(155,227,154,0.3)' }}>
                  DB
                </span>
              ) : (
                <span style={badgeStyle}>默认</span>
              )}
            </div>
            <input
              value={draft}
              onChange={(e) => setDrafts((s) => ({ ...s, [kind]: e.target.value }))}
              placeholder="新值"
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
              保存
            </button>
            {entry.configured ? (
              <button
                type="button"
                onClick={() => apply({ [kind]: 0 })}
                style={buttonGhostStyle}
                disabled={saving}
                title="清除 DB 配置，回退到内置默认"
              >
                重置
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
  borderBottom: '2px solid transparent',
  color: tokens.textMuted,
  fontSize: 12,
  padding: '8px 14px',
  cursor: 'pointer',
  fontWeight: 500,
  marginBottom: -1,
};

const tabActiveStyle: React.CSSProperties = {
  ...tabStyle,
  color: tokens.textPrimary,
  borderBottomColor: tokens.accent,
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
