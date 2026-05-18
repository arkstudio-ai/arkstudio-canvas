import React, { useEffect, useState } from 'react';
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

const Header: React.FC = () => (
  <header style={headerStyle}>
    <div>
      <h1 style={titleStyle}>系统设置</h1>
      <div style={subTitleStyle}>
        开源信息 · 模型 Provider · 生成历史保留 · 本地存储
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
      toast.error(err instanceof Error ? err.message : '加载存储设置失败');
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
          <HardDrive size={11} style={{ verticalAlign: 'middle', marginRight: 6 }} />
          本地存储
        </h3>
        <div style={sectionBodyStyle}>
          <div style={emptyStyle}>{loading ? '加载中…' : '加载失败'}</div>
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

  // dataDir 来源标签 + 提示
  const sourceLabel: Record<StorageSettingsView['dataDirSource'], string> = {
    db: 'DB 覆盖',
    env: 'STORAGE_LOCAL_DATA_DIR',
    default: '内置默认',
  };

  return (
    <section style={sectionStyle}>
      <h3 style={sectionTitleStyle}>
        <HardDrive size={11} style={{ verticalAlign: 'middle', marginRight: 6 }} />
        本地存储
      </h3>
      <div style={sectionBodyStyle}>
        <p style={hintStyle}>
          所有上传文件、模型生成结果都直接写入下方 <code>data dir</code>，由 backend 的{' '}
          <code>/static/uploads/&lt;key&gt;</code> 路由对外提供。生产部署请把这个路径放到一个
          独立挂载卷（<code>docker-compose.yml</code> 已经默认这么做），<code>docker compose down</code> 不会丢数据。
          <br />
          需要让阿里云模型读取本地图片做 i2i / i2v？后端会在 submit 之前自动把对应文件再上传到
          DashScope 临时桶（<code>oss://</code>，48h 失效），这里无需任何额外配置。
        </p>

        {/* Status overview */}
        <div style={statusGridStyle}>
          <StatusCard
            icon={<Folder size={14} />}
            label="Data dir"
            value={view.dataDir}
            source={`${sourceLabel[view.dataDirSource]} · 默认 ${view.dataDirDefault}`}
            ok
          />
          <StatusCard
            icon={<Database size={14} />}
            label="占用空间"
            value={formatBytes(view.stats.bytes)}
            source={`${view.stats.fileCount.toLocaleString()} 个文件`}
            ok
          />
          <StatusCard
            icon={<Link2 size={14} />}
            label="对外路径"
            value={`${view.publicBaseUrl}/<key>`}
            source="同源静态文件 · 1y immutable cache"
            ok
          />
        </div>

        {/* Data dir */}
        <div style={fieldRowStyle}>
          <span style={fieldLabelStyle}>Data dir</span>
          <input
            value={drafts.dataDir}
            onChange={(e) => setDrafts((s) => ({ ...s, dataDir: e.target.value }))}
            placeholder={
              view.dataDirSource === 'db'
                ? '已用 DB 配置 · 输入新路径覆盖'
                : view.dataDirSource === 'env'
                  ? `当前来自环境变量: ${view.dataDir}`
                  : `内置默认: ${view.dataDirDefault}`
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
            保存
          </button>
          {view.dataDirSource === 'db' && (
            <button
              type="button"
              onClick={() => {
                if (!confirm('确认清除 DB 配置? 清除后回退到环境变量 / 内置默认。已写入旧路径的文件不会自动迁移。')) return;
                void apply({ dataDir: '' });
              }}
              style={buttonGhostStyle}
              disabled={saving}
              title="从 DB 删除该字段；回退到 STORAGE_LOCAL_DATA_DIR 或内置默认"
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
      { sku: 'wan2.7-image*', modality: 'image' },
      { sku: 'wan2.6-* / wan2.7-*', modality: 'video' },
      { sku: 'happyhorse*', modality: 'video' },
      { sku: 'speech-* / fun-music*', modality: 'audio' },
    ],
    timeoutKinds: [
      { kind: 'chat', label: 'Chat', hint: '同步对话调用 (qwen / deepseek / glm)' },
      { kind: 'image', label: 'Image', hint: '同步万相 2.7 图像 submit（multimodal-generation）' },
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
      '确认清除 DashScope API Key? 清除后 qwen-* / wan2.7-* / glm / deepseek / speech-* / fun-music 等所有阿里系 SKU 都会调用失败。',
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
  {
    id: 'volcengine',
    label: 'Volcengine (火山方舟 Seedance)',
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    scopeChips: [
      { sku: 'doubao-seedance-* / seedance-*', modality: 'video' },
    ],
    timeoutKinds: [
      {
        kind: 'chat',
        label: 'Chat',
        hint: '当前 Volcengine 暂未接入 chat provider；预留位以兼容未来 Doubao 文本模型。',
      },
      {
        kind: 'image',
        label: 'Image',
        hint: '当前未接入；预留位。',
      },
      {
        kind: 'video',
        label: 'Video',
        hint: 'Seedance 2.0 / 2.0 Fast submit；polling 固定 10s 不暴露。',
      },
      {
        kind: 'audio',
        label: 'Audio',
        hint: '当前未接入；预留位。',
      },
    ],
    timeoutsHint:
      '当前仅 video 落库（Seedance 2.0 / 2.0 Fast）。chat / image / audio 字段写入也会被静默忽略，等对应 provider 接入再启用。Polling 固定 10s 不暴露。',
    baseUrlHint: (
      <>
        Volcengine（火山方舟）Seedance Video API 网关。默认指向官方{' '}
        <code>https://ark.cn-beijing.volces.com/api/v3</code>。
        如果你部署了自建/私有代理且 path layout 与官方一致
        （<code>/contents/generations/tasks</code> +{' '}
        <code>/open/CreateAsset</code>），可改成你的代理地址，0 代码切换。
        <strong>不要</strong>带 <code>/contents/...</code> 后缀，
        provider 会自己拼。
      </>
    ),
    apiKeyHint: (
      <>
        Bearer Token。官方填你的 <code>ARK_API_KEY</code>；私有代理填代理 key。
        落库前用 <code>ENCRYPTION_KEY</code> 做 aes-256-gcm 加密；页面只显示
        掩码。配置后才能使用 <code>doubao-seedance-*</code> SKU。
        <br />
        <br />
        <strong style={{ color: tokens.warn }}>
          注意：Seedance 视频生成的 i2v / r2v 模式还要额外配「对象存储 (OSS / TOS)」
          (下面那个 section)，否则本地上传的图片无法被火山服务器拉到，只能跑纯文本 t2v。
        </strong>
      </>
    ),
    load: getVolcengineSettings,
    save: updateVolcengineSettings,
    clearKeyConfirm:
      '确认清除 Volcengine API Key? 清除后所有 doubao-seedance-* / seedance-* SKU 都会调用失败。',
  },
];

const ProvidersSection: React.FC = () => {
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
        {/* 探活按钮: 输入框为空时用 DB 已存的, 非空时用草稿; 详细规则见
            TestConnectionButton 组件文档. 放在 API Key 行下面是因为它最常和
            "我刚改了 key 想验一下"或"配错了不知道为啥不通"的两类操作绑在一起.
            Volcengine 暂未接 ProviderConnectivityService 的 testVolcengine
            endpoint, 隐藏按钮 — 等 Slice 3 (asset 后端) 起来一起补. */}
        {card.id !== 'volcengine' && (
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>连通性测试</span>
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
  borderBottomColor: tokens.accent,
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
