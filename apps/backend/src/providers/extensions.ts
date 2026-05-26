/**
 * Provider gateway extension points — reroute provider HTTP calls through
 * a central AI gateway (LiteLLM, One-API, a self-hosted OpenAI-compat
 * relay, an enterprise AI service mesh, etc.) without touching individual
 * provider code.
 *
 * Per-vendor `ConfigService` already exposes a per-vendor base URL —
 * sufficient when the operator has one gateway *per vendor*. These hooks
 * cover the case where a single gateway fronts all vendors at once
 * (DashScope + Volcengine + OpenAI-compat behind one endpoint), and
 * additionally let the caller transform request bodies — e.g. wrap a
 * DashScope multimodal payload into an OpenAI-style envelope the gateway
 * expects.
 *
 * Design rules — same as `apps/web/src/app/extensions.ts`:
 *   - Pure read/write of process-local state. Setters MUST be called once
 *     at NestJS app boot, before any provider fires.
 *   - Default (no setter called) = identical direct-to-vendor behavior.
 *   - Three knobs by call-class (chat / image / video) so the integrator
 *     can redirect each tier independently — e.g. gateway chat traffic
 *     but leave video calls direct because the gateway lacks task-mode
 *     support.
 */

import type { PollResult } from './provider.types';

/** Lookup ctx given to every gateway override fn. Lets forks branch by
 *  provider (e.g. dashscope-chat vs openai-compat-chat) or by model SKU. */
export interface GatewayOverrideContext {
  /** Provider class name, e.g. `dashscope-chat`, `volcengine-video`. */
  providerId: string;
  /** Concrete upstream SKU the caller asked for. */
  modelSku: string;
  /** Number of image inputs (i2i / i2v reference images) the caller is
   *  passing in. Lets forks route i2i/t2i differently — e.g. send t2i
   *  through a unified OpenAI-compat gateway but bypass for i2i which
   *  needs the vendor's multimodal / `/images/edits` shape. Image / video
   *  providers populate this; chat providers leave it undefined. */
  imageInputCount?: number;
}

// ─── Chat ─────────────────────────────────────────────────────────────────

/** Redirect for chat-class providers. Body shape (OpenAI chat completions)
 *  is unchanged — every chat provider here already speaks it. */
export interface ChatGatewayRedirect {
  /** Full URL including path, e.g. `http://gateway:3000/v1/chat/completions`. */
  url: string;
  /** Bearer token sent as `Authorization: Bearer <apiKey>`. */
  apiKey: string;
}

type ChatGatewayOverride = (
  ctx: GatewayOverrideContext,
) => ChatGatewayRedirect | null;

let chatGatewayOverride: ChatGatewayOverride | null = null;

export const setChatGatewayOverride = (fn: ChatGatewayOverride | null): void => {
  chatGatewayOverride = fn;
};

export const getChatGatewayRedirect = (
  ctx: GatewayOverrideContext,
): ChatGatewayRedirect | null =>
  chatGatewayOverride ? chatGatewayOverride(ctx) : null;

// ─── Image ────────────────────────────────────────────────────────────────

/** Redirect for image-class providers. Body shape varies (DashScope wan
 *  multimodal vs OpenAI generations), so the fork supplies a transform fn
 *  that converts the OSS-built body into whatever the gateway expects. */
export interface ImageGatewayRedirect {
  /** Full URL including path, e.g. `http://gateway:3000/v1/images/generations`. */
  url: string;
  /** Bearer token sent as `Authorization: Bearer <apiKey>`. */
  apiKey: string;
  /** Map the OSS-built body (vendor-native shape) into the gateway body. */
  transformBody: (originalBody: unknown) => unknown;
  /** Optional: convert the gateway's response payload back into the
   *  vendor-native shape that the OSS provider's `extractResources` /
   *  `extractUsage` expects. Used when the gateway wraps the upstream
   *  response (e.g. OpenAI-shaped `/v1/images/generations` envelope that
   *  loses DashScope's `output.choices` structure). The fork carries the
   *  raw upstream payload through some side channel (e.g. `metadata`)
   *  and uses this fn to unwrap. Omit for gateways that already pass
   *  through the vendor shape. */
  transformResponse?: (gatewayResponse: unknown) => unknown;
  /** Optional base URL for OpenAI-compatible `/images/edits` multipart i2i
   *  calls (e.g. gpt-image-* image-to-image). Set this when the gateway
   *  supports OpenAI edits at the same auth, e.g. `https://gateway/v1`.
   *  When provided, OpenAI-compat image provider sends i2i through this
   *  base + `apiKey` instead of vendor-direct; when omitted, OSS falls
   *  back to vendor-direct edits (legacy behaviour) or drops image inputs
   *  with a warn if the family doesn't support edits.
   *  Only consumed by the OpenAI-compat image provider; ignored elsewhere. */
  editsBaseUrl?: string;
}

type ImageGatewayOverride = (
  ctx: GatewayOverrideContext,
) => ImageGatewayRedirect | null;

let imageGatewayOverride: ImageGatewayOverride | null = null;

export const setImageGatewayOverride = (
  fn: ImageGatewayOverride | null,
): void => {
  imageGatewayOverride = fn;
};

export const getImageGatewayRedirect = (
  ctx: GatewayOverrideContext,
): ImageGatewayRedirect | null =>
  imageGatewayOverride ? imageGatewayOverride(ctx) : null;

// ─── Video ────────────────────────────────────────────────────────────────

/** Redirect for video-class (async-task) providers.
 *
 *  Submit is split into URL + body transform (consistent with chat/image),
 *  but poll is wholesale-replaced by `pollTask` because gateway poll
 *  responses are typically shaped differently from the vendor's native
 *  task GET — letting the fork return a `PollResult` directly avoids
 *  forcing the gateway response back into vendor shape inside the OSS
 *  provider.
 */
export interface VideoGatewayRedirect {
  /** Submit URL, e.g. `http://gateway:3000/v1/video/generations`. */
  submitUrl: string;
  /** Bearer token sent as `Authorization: Bearer <apiKey>` on submit. */
  apiKey: string;
  /** Map the OSS-built submit body to the gateway envelope. */
  transformSubmitBody: (originalBody: unknown) => unknown;
  /** Optional: convert the gateway's submit response back into the
   *  vendor-native shape OSS expects (DashScope reads
   *  `data.output.task_id` / `data.output.task_status`). Omit for
   *  gateways that already pass vendor shape through. */
  transformSubmitResponse?: (gatewayResponse: unknown) => unknown;
  /** Full poll implementation: fetch task status from the gateway and
   *  shape the result into `PollResult`. Provider calls this verbatim
   *  in place of its own poll path. */
  pollTask: (taskId: string) => Promise<PollResult>;
}

type VideoGatewayOverride = (
  ctx: GatewayOverrideContext,
) => VideoGatewayRedirect | null;

let videoGatewayOverride: VideoGatewayOverride | null = null;

export const setVideoGatewayOverride = (
  fn: VideoGatewayOverride | null,
): void => {
  videoGatewayOverride = fn;
};

export const getVideoGatewayRedirect = (
  ctx: GatewayOverrideContext,
): VideoGatewayRedirect | null =>
  videoGatewayOverride ? videoGatewayOverride(ctx) : null;
