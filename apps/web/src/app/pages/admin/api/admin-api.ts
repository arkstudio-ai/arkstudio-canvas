import type {
  ApiEnvelope,
  CanvasConfigPayload,
  CanvasConfigVersion,
  ExecutionDetail,
  ExecutionListResponse,
  HistorySettingsUpdate,
  HistorySettingsView,
  ListExecutionsParams,
  PruneResponse,
  ProviderSettingsView,
  ProviderSettingsUpdate,
  SaveConfigResult,
  StorageSettingsUpdate,
  StorageSettingsView,
  UsageOverview,
} from '../types';

// `??` 而非 `||`：空串 (`""`) 是 docker compose 反代部署的合法值（走相对路径）。
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:18500';

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

// ---- Storage (COS) settings -----------------------------------------------

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
