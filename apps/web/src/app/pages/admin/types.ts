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
  /** Sidebar label. */
  label: string;
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

// ---- Storage (COS) settings ------------------------------------------------
//
// Mirrors apps/backend/src/canvas-config/storage-config.service.ts. Secrets
// are never returned in plaintext -- only `secretIdMask` / `secretKeyMask`
// (e.g. `AKID12...x9aB`); editing requires the operator to retype.

/**
 * Effective upload destination resolved by the backend.
 *
 *   'cos'              → COS credentials are configured; uploads land
 *                        in the operator's own bucket (long-lived URLs)
 *   'dashscope-temp'   → no COS, but DashScope key is set; uploads go
 *                        to DashScope's free temporary store as
 *                        `oss://...` URLs (48h TTL, 100MB cap)
 *   'none'             → neither configured; the upload endpoint will
 *                        400, the UI shows a "至少配置一个" warning
 */
export type StorageStrategy = 'cos' | 'dashscope-temp' | 'none';

export interface StorageSettingsView {
  /** True when secretId + secretKey + bucket are all set in DB. */
  configured: boolean;
  secretIdMask: string | null;
  secretKeyMask: string | null;
  bucket: string | null;
  /** Effective region (DB override OR built-in default 'ap-hongkong'). */
  region: string;
  regionDefault: string;
  regionConfigured: boolean;
  customDomain: string | null;
  /** Sign URL TTL in seconds. */
  signExpires: number;
  signExpiresDefault: number;
  signExpiresConfigured: boolean;
  /** Bytes. UI converts to MB for display. */
  maxFileSize: number;
  maxFileSizeDefault: number;
  maxFileSizeConfigured: boolean;
  /** Effective strategy currently applied to uploads. Backend-computed. */
  strategy: StorageStrategy;
  /** True when DashScope api key is set; surfaced so the UI can explain why fallback is/isn't available. */
  dashscopeKeyOk: boolean;
}

/**
 * PUT body. Same untouched/clear/set semantics as Provider settings:
 *   - undefined          → field untouched
 *   - empty string ''    → clear the field (region: revert to default; rest: null)
 *   - non-empty string   → upsert (secrets get encrypted server-side)
 *   - signExpires/maxFileSize: undefined = untouched, negative = clear, 0+ = upsert
 */
export interface StorageSettingsUpdate {
  secretId?: string;
  secretKey?: string;
  bucket?: string;
  region?: string;
  customDomain?: string;
  signExpires?: number;
  maxFileSize?: number;
}
