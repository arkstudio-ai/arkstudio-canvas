/**
 * Backend-side model provider abstraction.
 *
 * Open-source build owns model invocation directly (no external executor
 * service). Each provider wraps a single upstream API family (e.g.
 * DashScope async video, DashScope chat, etc.) and exposes a uniform
 * submit/poll contract that `ExecutionsService` schedules against.
 *
 * Model SKU → provider routing happens in `ProviderRegistry`. Providers
 * are stateless and registered as DI singletons.
 */

export interface ProviderInput {
  type: 'image' | 'video' | 'audio';
  url: string;
}

export interface SubmitRequest {
  /** Internal correlation id (== FlowExecution.id is fine) */
  requestId: string;
  /** Real upstream SKU, e.g. 'wan2.7-r2v' */
  modelSku: string;
  /** Family logical id, kept for logging only, e.g. 'wan2.7' */
  modelName: string;
  prompt: string;
  inputs?: ProviderInput[];
  /** Free-form per-model parameters (resolution, duration, ...) */
  extraParams?: Record<string, any>;
}

export interface ProviderResource {
  type: string;
  url: string;
}

/**
 * Normalised usage / billing units extracted from an upstream response.
 *
 * Each provider decides which fields to populate based on what it knows:
 *   - video : `videoDurationSec`
 *   - image : `imageCount`
 *   - audio : `audioDurationSec`
 *   - text  : `inputTokens` / `outputTokens`
 *
 * `costAmount` is left null in the open-source build — pricing is a
 * deployment concern, not a model code concern. Callers should derive
 * money values at billing time, not at execution time.
 */
export interface ProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
  videoDurationSec?: number;
  audioDurationSec?: number;
  imageCount?: number;
  /** Verbatim upstream `usage` for downstream tooling */
  raw?: unknown;
}

/**
 * Outcome of a submit() call.
 *
 * - `pending` → caller must poll(taskId)
 * - `completed` → synchronous result is already in `resources`/`text`
 * - `failed` → caller throws based on `errorMessage`
 */
export interface SubmitResult {
  status: 'pending' | 'completed' | 'failed';
  taskId?: string;
  resources?: ProviderResource[];
  text?: string;
  errorMessage?: string;
  usage?: ProviderUsage;
  /** Upstream raw response for audit / debugging (already inspected) */
  raw?: unknown;
  /**
   * Actual JSON body the provider POSTed to upstream. Persisted by
   * ExecutionsService into `flow_executions.requestPayload` so the admin
   * LogDrawer can show "what we actually sent" — diagnosing provider
   * issues without needing backend stdout. Provider should fill this
   * even on `status: 'failed'` (alongside throwing) so failed rows still
   * carry the request context. Headers are intentionally NOT included
   * (auth tokens live there).
   */
  requestPayload?: unknown;
}

export interface PollResult {
  status: 'pending' | 'running' | 'completed' | 'failed';
  resources?: ProviderResource[];
  text?: string;
  errorMessage?: string;
  usage?: ProviderUsage;
  raw?: unknown;
}

export interface ProviderClient {
  /** Stable identifier for logging */
  readonly name: string;
  /** Returns true if this provider handles the given upstream SKU */
  supports(modelSku: string): boolean;
  submit(req: SubmitRequest): Promise<SubmitResult>;
  pollStatus(taskId: string): Promise<PollResult>;
}

export const PROVIDER_CLIENTS = Symbol('PROVIDER_CLIENTS');
