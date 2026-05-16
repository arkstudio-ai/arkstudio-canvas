import type {
  ApiEnvelope,
  CanvasConfigPayload,
  CanvasConfigVersion,
  ConfigExportEnvelope,
  ExecutionDetail,
  ExecutionListResponse,
  HistorySettingsUpdate,
  HistorySettingsView,
  ImportConfigResponse,
  ListExecutionsParams,
  PruneResponse,
  OpenaiSettingsView,
  OpenaiSettingsUpdate,
  ProviderSettingsView,
  ProviderSettingsUpdate,
  SaveConfigResult,
  StorageSettingsUpdate,
  StorageSettingsView,
  TestConnectionInput,
  TestConnectionResult,
  UsageOverview,
  VolcengineSettingsView,
  VolcengineSettingsUpdate,
  NetworkSettingsView,
  NetworkSettingsUpdate,
  OssSettingsView,
  OssSettingsUpdate,
} from '../types';

// 共用 `apps/web/src/app/config/api.ts` 的解析（runtime 优先 / build-time
// 兜底）。重复在这里写一份会让桌面端 (Electron preload 注入的运行时 URL)
// 漏掉这个文件的请求。
import { API_BASE_URL } from '../../../config/api';

/**
 * Thin fetch wrapper for `/admin/*` endpoints.
 *
 * Auth is intentionally a no-op in the open-source build — when an
 * `ADMIN_TOKEN` scheme lands, the only place that needs to learn about it
 * is `getAdminAuthHeader()`.
 */
function getAdminAuthHeader(): Record<string, string> {
  // Reserved for future ADMIN_TOKEN; see `auth_decision = decide_later`.
  return {};
}

async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...getAdminAuthHeader(),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }
  const env = (await res.json()) as ApiEnvelope<T>;
  if (!env.success) {
    throw new Error(env.message || `API error: ${env.code}`);
  }
  return env.data;
}

function toQueryString(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function listExecutions(
  params: ListExecutionsParams = {},
): Promise<ExecutionListResponse> {
  return adminFetch<ExecutionListResponse>(
    `/admin/executions${toQueryString(params as Record<string, unknown>)}`,
  );
}

export function getExecutionDetail(id: string): Promise<ExecutionDetail> {
  return adminFetch<ExecutionDetail>(`/admin/executions/${encodeURIComponent(id)}`);
}

export function getUsageOverview(
  range: 'today' | 'week' | 'month' = 'today',
): Promise<UsageOverview> {
  return adminFetch<UsageOverview>(`/admin/executions/usage?range=${range}`);
}

// ---- Canvas config ---------------------------------------------------------
//
// CanvasConfigController returns wrapped envelopes via the global
// ResponseInterceptor, so `adminFetch` (which unwraps `{success, code, data}`)
// is the right helper here. Keeping all admin network I/O in one place.

export function getCanvasConfig(): Promise<CanvasConfigPayload> {
  return adminFetch<CanvasConfigPayload>('/api/canvas-flow/config');
}

export function getCanvasConfigVersion(): Promise<CanvasConfigVersion> {
  return adminFetch<CanvasConfigVersion>('/api/canvas-flow/config/version');
}

export function saveCanvasConfig(
  config: CanvasConfigPayload,
  modifiedBy?: string,
): Promise<SaveConfigResult> {
  const qs = modifiedBy ? `?modifiedBy=${encodeURIComponent(modifiedBy)}` : '';
  return adminFetch<SaveConfigResult>(`/api/canvas-flow/config${qs}`, {
    method: 'PUT',
    body: JSON.stringify({ config }),
  });
}

/**
 * Returns the portable JSON envelope. The page just hands it to a Blob
 * download — no client-side rewrap, the server already templated the
 * `$schema` / `exportedAt` / `exportedFromVersion` fields.
 */
export function exportCanvasConfig(): Promise<ConfigExportEnvelope> {
  return adminFetch<ConfigExportEnvelope>('/api/canvas-flow/config/export');
}

/**
 * Two-step import. Pass the parsed file as `envelope` and pick mode:
 *   - 'preview' → backend validates + computes the diff, no writes
 *   - 'apply'   → backend runs replace-all save (same path as PUT /config)
 *
 * Caller is expected to fire 'preview' first, render the summary in a
 * confirm dialog, then fire 'apply' on user OK.
 */
export function importCanvasConfig(
  envelope: ConfigExportEnvelope | unknown,
  mode: 'preview' | 'apply',
  modifiedBy?: string,
): Promise<ImportConfigResponse> {
  return adminFetch<ImportConfigResponse>('/api/canvas-flow/config/import', {
    method: 'POST',
    body: JSON.stringify({ envelope, mode, modifiedBy }),
  });
}

export function getProviderSettings(): Promise<ProviderSettingsView> {
  return adminFetch<ProviderSettingsView>('/api/canvas-flow/provider-settings');
}

export function updateProviderSettings(
  patch: ProviderSettingsUpdate,
): Promise<ProviderSettingsView> {
  return adminFetch<ProviderSettingsView>('/api/canvas-flow/provider-settings', {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}

/**
 * 探活 DashScope. 留空 input 字段 → 用 DB 已存的; 给值 → 用给的 (用于
 * 第一次配置 / 想换一把 key 试试的"先测后存"场景).
 *
 * 后端永远返 200, 失败装在 body.ok=false / body.message; 这里也不抛
 * envelope.success=false (因为整个请求是成功的, 只是探活失败).
 */
export function testProviderSettings(
  input: TestConnectionInput = {},
): Promise<TestConnectionResult> {
  return adminFetch<TestConnectionResult>(
    '/api/canvas-flow/provider-settings/test',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}

// ---- OpenAI-compatible provider --------------------------------------------

export function getOpenaiSettings(): Promise<OpenaiSettingsView> {
  return adminFetch<OpenaiSettingsView>('/api/canvas-flow/openai-settings');
}

export function updateOpenaiSettings(
  patch: OpenaiSettingsUpdate,
): Promise<OpenaiSettingsView> {
  return adminFetch<OpenaiSettingsView>('/api/canvas-flow/openai-settings', {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}

/** OpenAI-compat 探活, 同语义见 testProviderSettings. */
export function testOpenaiSettings(
  input: TestConnectionInput = {},
): Promise<TestConnectionResult> {
  return adminFetch<TestConnectionResult>(
    '/api/canvas-flow/openai-settings/test',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}

// ---- Volcengine (火山方舟 Seedance) -----------------------------------------

export function getVolcengineSettings(): Promise<VolcengineSettingsView> {
  return adminFetch<VolcengineSettingsView>(
    '/api/canvas-flow/volcengine-settings',
  );
}

export function updateVolcengineSettings(
  patch: VolcengineSettingsUpdate,
): Promise<VolcengineSettingsView> {
  return adminFetch<VolcengineSettingsView>(
    '/api/canvas-flow/volcengine-settings',
    {
      method: 'PUT',
      body: JSON.stringify(patch),
    },
  );
}

// ---- Network (proxy) -------------------------------------------------------

export function getNetworkSettings(): Promise<NetworkSettingsView> {
  return adminFetch<NetworkSettingsView>('/api/canvas-flow/network-settings');
}

export function updateNetworkSettings(
  patch: NetworkSettingsUpdate,
): Promise<NetworkSettingsView> {
  return adminFetch<NetworkSettingsView>('/api/canvas-flow/network-settings', {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}

// ---- OSS / TOS object storage ----------------------------------------------

export function getOssSettings(): Promise<OssSettingsView> {
  return adminFetch<OssSettingsView>('/api/canvas-flow/oss-settings');
}

export function updateOssSettings(
  patch: OssSettingsUpdate,
): Promise<OssSettingsView> {
  return adminFetch<OssSettingsView>('/api/canvas-flow/oss-settings', {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}

// ---- History retention -----------------------------------------------------

export function getHistorySettings(): Promise<HistorySettingsView> {
  return adminFetch<HistorySettingsView>('/api/canvas-flow/history-settings');
}

export function updateHistorySettings(
  patch: HistorySettingsUpdate,
): Promise<HistorySettingsView> {
  return adminFetch<HistorySettingsView>('/api/canvas-flow/history-settings', {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}

/**
 * Force a prune now (bypasses the inline 10-min throttle). Backend returns
 * both the deletion outcome (for a toast like "已删除 12 条") and the fresh
 * view payload (so the page state is up-to-date without a second GET).
 */
export function pruneHistory(): Promise<PruneResponse> {
  return adminFetch<PruneResponse>('/api/canvas-flow/history-settings/prune', {
    method: 'POST',
  });
}

// ---- Storage (local disk) -------------------------------------------------

export function getStorageSettings(): Promise<StorageSettingsView> {
  return adminFetch<StorageSettingsView>('/api/canvas-flow/storage-settings');
}

export function updateStorageSettings(
  patch: StorageSettingsUpdate,
): Promise<StorageSettingsView> {
  return adminFetch<StorageSettingsView>('/api/canvas-flow/storage-settings', {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}
