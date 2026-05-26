import type { ComponentType, LazyExoticComponent } from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * Manifest entry consumed by the admin shell to:
 *   - render a sidebar nav item
 *   - register a `<Route>` under `/admin/<path>`
 *
 * 模块本身只导出 Page 组件 + 一份 manifest。Shell 通过 `adminModules.ts`
 * 把它们装配起来。模块代码 *不* 依赖 shell — 这样商业版/未来想把某个模块
 * 单拎出来挂在独立顶级路由 + 独立 layout 时，不需要改一行模块内代码。
 */
export interface AdminModule {
  /** Stable id; used for route key & nav active highlight. */
  id: string;
  /** i18next key (in `settings` namespace) for the sidebar nav label. */
  labelKey: string;
  /** Sidebar icon. */
  icon: LucideIcon;
  /** Sub-path under `/admin/`, no leading slash. e.g. `'logs'` -> `/admin/logs` */
  path: string;
  /** Lazy-loaded page component. */
  Component: LazyExoticComponent<ComponentType>;
}

/**
 * Backend `ResponseInterceptor` wraps every payload as `{ success, code, data }`.
 * Mirrors `apps/backend/src/common/interceptors/response.interceptor.ts`.
 */
export interface ApiEnvelope<T> {
  success: boolean;
  code: string;
  data: T;
  message?: string;
}

// ---- Domain types mirrored from backend (kept thin on purpose) ----

export type ExecutionStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
export type ExecutionPhase = 'submitting' | 'submitted' | 'polling' | 'completed' | 'failed';

/**
 * Coarse model kind used for per-kind billing slices in the admin overview.
 * Mirrors `apps/backend/src/executions/model-kind.ts`. `'unknown'` is the
 * defensive bucket for rows whose SKU we couldn't classify (legacy data,
 * provider misconfig, etc.).
 */
export type ModelKind = 'chat' | 'video' | 'image' | 'audio';
export type ModelKindOrUnknown = ModelKind | 'unknown';

export const MODEL_KINDS: ModelKind[] = ['chat', 'video', 'image', 'audio'];

export interface ExecutionRow {
  id: string;
  flowId: string;
  nodeId: string;
  modelName: string | null;
  modelSku: string | null;
  modeId: string | null;
  kind: ModelKindOrUnknown | null;
  batchId: string | null;
  status: ExecutionStatus;
  phase: ExecutionPhase | null;
  externalTaskId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  outputDurationSec: number | null;
  outputCount: number | null;
  latencyMs: number | null;
  requestPayload: unknown;
  responsePayload: unknown;
  errorMsg: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface ExecutionEventRow {
  id: string;
  executionId: string;
  phase: ExecutionPhase;
  attempt: number | null;
  externalStatus: string | null;
  message: string | null;
  payloadSnippet: unknown;
  createdAt: string;
}

export interface ExecutionDetail extends ExecutionRow {
  events: ExecutionEventRow[];
}

export interface ListMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ExecutionListResponse {
  items: ExecutionRow[];
  meta: ListMeta;
}

/**
 * Per-kind aggregate. Each kind is responsible for its own billable unit
 * (see `model-kind.ts` on the backend); the UI decides which numbers to
 * highlight per card based on `kind`.
 */
export interface KindBucket {
  kind: ModelKindOrUnknown;
  count: number;
  completed: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  outputDurationSec: number;
  outputCount: number;
}

export interface ModelRow {
  modelName: string;
  kind: ModelKindOrUnknown;
  count: number;
  completed: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  outputDurationSec: number;
  outputCount: number;
}

export interface UsageOverview {
  range: 'today' | 'week' | 'month';
  rangeStart: string;
  rangeEnd: string;
  totals: {
    count: number;
    countByStatus: Record<ExecutionStatus, number>;
  };
  byKind: KindBucket[];
  byModel: ModelRow[];
}

export interface ListExecutionsParams {
  page?: number;
  limit?: number;
  status?: string;
  phase?: string;
  modelName?: string;
  modelSku?: string;
  modeId?: string;
  startDate?: string;
  endDate?: string;
}

// ---- Canvas config (admin editor) -----------------------------------------
//
// These mirror the runtime shapes returned by /api/canvas-flow/config and
// the input shape of PUT /api/canvas-flow/config. Kept loose-typed (any[])
// for `nodeDefinitions` because the editor mutates the whole tree --
// strong typing would just duplicate @canvas-flow/core's NodeDefinition
// here. Validation lives in the editor itself.

export interface CanvasConfigPayload {
  token: string;
  style: { background?: string; [k: string]: unknown };
  nodeDefinitions: any[];
}

export interface CanvasConfigVersion {
  version: number;
  lastModified: string;
  modifiedBy?: string;
}

export interface SaveConfigResult {
  version: number;
  summary: {
    nodesUpdated: number;
    nodesDeleted: number;
  };
}

// ---- Portable config import/export ----
//
// Mirrors apps/backend/src/canvas-config/dto/import-export-config.dto.ts.
// The frontend treats the envelope as opaque-ish: we only ever inspect
// `$schema` for a sanity warning and the inner `config` shape (which is
// the same CanvasConfigPayload runtime API uses).

export const CONFIG_EXPORT_SCHEMA = 'canvas-flow.config/v1';

export interface ConfigExportEnvelope {
  $schema: typeof CONFIG_EXPORT_SCHEMA;
  exportedAt: string;
  exportedFromVersion: number;
  config: CanvasConfigPayload;
}

export interface ImportConfigSummary {
  nodesAdded: number;
  nodesUpdated: number;
  nodesDeleted: number;
  nodesUnchanged: number;
}

export interface ImportConfigResponse {
  /** null in preview mode, the new config_version in apply mode. */
  version: number | null;
  summary: ImportConfigSummary;
  warnings: string[];
  dryRun: boolean;
}

/**
 * Read-only payload for the Provider 设置 panel. The plaintext apiKey is
 * never returned -- only `apiKeyMask` (e.g. `sk-1de...0252`). `baseUrl`
 * is always populated (defaults to https://dashscope.aliyuncs.com when
 * nothing is configured); `baseUrlConfigured` lets the UI show whether
 * the value came from DB or the built-in default.
 */
export type DashscopeKind = 'chat' | 'image' | 'video' | 'audio';

export interface TimeoutEntry {
  /** Effective value the runtime is using (DB override OR built-in default). */
  value: number;
  /** Built-in fallback when no admin override exists. */
  default: number;
  /** True if `value` came from the DB; false if it's the built-in default. */
  configured: boolean;
}

export interface ProviderSettingsView {
  baseUrl: string;
  baseUrlConfigured: boolean;
  apiKeyMask: string | null;
  apiKeyConfigured: boolean;
  timeouts: Record<DashscopeKind, TimeoutEntry>;
}

/**
 * PUT body. `undefined` skips the field; empty string clears the row
 * (apiKey: revert to "未配置"; baseUrl: revert to default URL).
 *
 * `timeouts.{kind}`:
 *   - omit → kind untouched
 *   - 0 / negative → clear (revert to per-kind hard-coded fallback)
 *   - positive → upsert (clamped to >= 1s on the server)
 */
export interface ProviderSettingsUpdate {
  baseUrl?: string;
  apiKey?: string;
  timeouts?: Partial<Record<DashscopeKind, number>>;
}

// ---- OpenAI-compatible provider settings ----------------------------------
//
// Mirrors apps/backend/src/canvas-config/openai-compat-config.service.ts.
// Same shape as ProviderSettings* on purpose so the admin section can reuse
// every render primitive (StatusCard, TimeoutsTable, ...). Kept as a parallel
// type rather than a generic so future bytedance / google variants can each
// own their own DEFAULT_BASE_URL / KIND set without forcing a refactor.
//
// Kinds always include all four (chat/image/video/audio) even though only
// chat + image have providers today; that way adding an audio provider
// doesn't require a second frontend migration on top of the backend one.

export type OpenaiCompatKind = 'chat' | 'image' | 'video' | 'audio';

export interface OpenaiSettingsView {
  baseUrl: string;
  baseUrlConfigured: boolean;
  apiKeyMask: string | null;
  apiKeyConfigured: boolean;
  timeouts: Record<OpenaiCompatKind, TimeoutEntry>;
}

export interface OpenaiSettingsUpdate {
  baseUrl?: string;
  apiKey?: string;
  timeouts?: Partial<Record<OpenaiCompatKind, number>>;
}

// ---- Volcengine (火山方舟 Seedance) -----------------------------------------
//
// 4-kind timeout shape mirrors Dashscope/OpenAI for shared-UI compat; only
// `video` is real in phase 1. `defaultModel` is Volcengine-specific (lets
// admin preset e.g. `doubao-seedance-2-0-260128` so node config can omit it).

export type VolcengineKind = 'chat' | 'image' | 'video' | 'audio';

export interface VolcengineSettingsView {
  baseUrl: string;
  baseUrlConfigured: boolean;
  apiKeyMask: string | null;
  apiKeyConfigured: boolean;
  defaultModel: string | null;
  timeouts: Record<VolcengineKind, TimeoutEntry>;
}

export interface VolcengineSettingsUpdate {
  baseUrl?: string;
  apiKey?: string;
  defaultModel?: string;
  timeouts?: Partial<Record<VolcengineKind, number>>;
}

// ---- Network (proxy) -------------------------------------------------------
//
// Centralised proxy config so users don't need to wrangle shell env vars.
// Most relevant for China-based users whose shell has HTTPS_PROXY=...:7890
// for OpenAI/翻墙, which BREAKS DashScope / Volcengine (国内 IDC 直连).
//
// `disabled=true` is the "force direct" big-red-button — overrides the
// configured strings AND unsets process.env.HTTP_PROXY at backend boot.

export interface NetworkSettingsView {
  /** DB-stored value (admin form draft). Empty string ↔ no DB row. */
  httpProxy: string;
  httpsProxy: string;
  disabled: boolean;
  /** Snapshot of process.env at view time — diagnostic so admin can spot
   *  "I changed it but the shell env is still leaking through" cases. */
  effective: {
    httpProxy: string | null;
    httpsProxy: string | null;
    /** axios's bundled proxy-from-env falls back here when HTTP(S)_PROXY
     *  isn't set; we mirror our admin value into it so user-shell
     *  `ALL_PROXY=socks5://...` (V2Ray/Clash) can't sneak through. */
    allProxy?: string | null;
  };
  /** Constructor name of http(s).globalAgent right now. Triages
   *  "protocol mismatch" without a backend restart — `HttpProxyAgent`
   *  / `HttpsProxyAgent` for proxied, `Agent` for direct. */
  globalAgent?: {
    http: string;
    https: string;
  };
}

export interface NetworkSettingsUpdate {
  httpProxy?: string;
  httpsProxy?: string;
  disabled?: boolean;
}

// ---- OSS / TOS object storage ---------------------------------------------
//
// Used to stage local file uploads (`/static/uploads/...`) to a public-
// internet-reachable URL so URL-only vendors (Volcengine Seedance) can fetch
// them. One provider at a time: Aliyun OSS or Volcengine TOS. 留空 provider
// 即禁用 staging (Seedance i2v / r2v 不可用).

export type OssProvider = 'aliyun-oss' | 'volcengine-tos';

export interface OssSettingsView {
  provider: OssProvider | null;
  bucket: string;
  region: string;
  endpoint: string;
  publicBaseUrl: string;
  accessKeyIdMask: string | null;
  accessKeySecretConfigured: boolean;
  /** Backend's view of "everything filled, ready to upload". */
  ready: boolean;
}

export interface OssSettingsUpdate {
  provider?: OssProvider | '';
  accessKeyId?: string;
  accessKeySecret?: string;
  bucket?: string;
  region?: string;
  endpoint?: string;
  publicBaseUrl?: string;
}

// ---- Provider 连通性测试 ----------------------------------------------------
//
// 镜像 apps/backend/src/canvas-config/provider-connectivity.service.ts 的
// `TestConnectionResult`. 后端约定: 探活无论成功失败都回 200, 错误装在 body
// 里, 让前端走同一条 toast 路径处理.

export interface TestConnectionInput {
  /** 留空 → 使用 DB 已存的 baseUrl. */
  baseUrl?: string;
  /** 留空 → 使用 DB 已存的 apiKey; 若 DB 也没存, 后端返回 ok=false. */
  apiKey?: string;
}

export interface TestConnectionResult {
  ok: boolean;
  /** 上游 HTTP 状态码; 网络错误时为 null. */
  status: number | null;
  /** 端到端耗时 (毫秒). */
  latencyMs: number;
  /** 实际命中的 baseUrl, 用于在"用 DB 已保存"模式下回显. */
  baseUrl: string;
  /** 凭据各来自 draft (这次请求里传的) 还是 saved (DB). */
  source: { baseUrl: 'draft' | 'saved'; apiKey: 'draft' | 'saved' };
  /** 上游 GET /models 返回的模型数 (ok=true 时). */
  modelCount?: number;
  /** 单行诊断, 直接灌进 toast / 显示在按钮旁边. */
  message?: string;
}

// ---- Generation history retention -----------------------------------------
//
// Mirrors apps/backend/src/canvas-config/history-retention.service.ts. Both
// knobs follow the standard "0 = clear / revert to DEFAULT" convention; the
// runtime treats 0 as "knob disabled" if an admin explicitly saves 0.

export type HistoryKind = 'image' | 'video' | 'audio' | 'text';

export interface HistorySettingsView {
  /** Effective day window (DB override OR built-in default). 0 = disabled. */
  maxAgeDays: number;
  maxAgeDaysDefault: number;
  maxAgeDaysConfigured: boolean;
  /** Effective per-kind cap (DB override OR built-in default). 0 = disabled. */
  maxPerKind: number;
  maxPerKindDefault: number;
  maxPerKindConfigured: boolean;
  /** Live row counts at read time -- used by the UI for "你有 N 张图" hints. */
  counts: Record<HistoryKind | 'total', number>;
  /** ISO timestamp of the most recent prune attempt; null if backend hasn't pruned since boot. */
  lastPruneAt: string | null;
  /** Rows the most recent prune deleted (sum of age + per-kind passes). */
  lastPruneDeleted: number;
}

export interface HistorySettingsUpdate {
  maxAgeDays?: number;
  maxPerKind?: number;
}

export interface PruneOutcome {
  ageDeleted: number;
  perKindDeleted: number;
  total: number;
  ranAt: string;
}

export interface PruneResponse {
  outcome: PruneOutcome;
  view: HistorySettingsView;
}

// ---- Storage (local disk) -------------------------------------------------
//
// Mirrors apps/backend/src/storage/local-storage.service.ts. Open-source
// build is local-disk-only — bytes live under `dataDir`, served by
// `StaticUploadsController` on `/static/uploads/<key>`.

export interface LocalStorageStats {
  /** Effective dataDir at the moment stats were computed. */
  dataDir: string;
  /** Total bytes across all files under dataDir. */
  bytes: number;
  /** Total file count across all files under dataDir. */
  fileCount: number;
}

export interface StorageSettingsView {
  /** Effective dataDir (DB override OR env OR built-in default). */
  dataDir: string;
  /** Built-in fallback path when no DB / env override exists. */
  dataDirDefault: string;
  /** Where the effective value came from. */
  dataDirSource: 'db' | 'env' | 'default';
  /** Live filesystem stats; recomputed on every GET. */
  stats: LocalStorageStats;
  /** Bytes. UI converts to MB for display. */
  maxFileSize: number;
  maxFileSizeDefault: number;
  maxFileSizeConfigured: boolean;
  /** Relative URL prefix that resolves to dataDir; const today (`/static/uploads`). */
  publicBaseUrl: string;
}

/**
 * PUT body. Same untouched/clear/set semantics as Provider settings:
 *   - undefined          → field untouched
 *   - empty string ''    → clear the field (revert to env / default)
 *   - non-empty string   → upsert
 *   - maxFileSize: undefined = untouched, negative = clear, 0+ = upsert
 */
export interface StorageSettingsUpdate {
  dataDir?: string;
  maxFileSize?: number;
}
