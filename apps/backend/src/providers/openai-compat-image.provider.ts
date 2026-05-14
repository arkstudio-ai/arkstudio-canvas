import { HttpException, Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import type {
  PollResult,
  ProviderClient,
  ProviderResource,
  ProviderUsage,
  SubmitRequest,
  SubmitResult,
} from './provider.types';
import { OpenaiCompatConfigService } from '../canvas-config/openai-compat-config.service';
import { summarizeBody } from './log-utils';

/**
 * OpenAI-compatible synchronous text-to-image provider.
 *
 * Targets the canonical OpenAI Images API:
 *
 *   POST {base}/images/generations
 *   body { model, prompt, n, size, quality?, style?, response_format }
 *   resp { created, data: [{ url } | { b64_json }] }
 *
 * Synchronous: there is no `created → poll` flow like DashScope async
 * tasks. `submit()` returns `status: 'completed'` or `failed` directly,
 * and `pollStatus()` throws (analogous to the chat provider).
 *
 * SKU routing:
 *   - `openai-image/dall-e-3`     → dall-e-3 (only n=1, supports quality/style)
 *   - `openai-image/dall-e-2`     → dall-e-2 (n=1..10)
 *   - `openai-image/gpt-image-1`  → gpt-image-1 / 1.5 (low/med/high quality, b64_json)
 *   - `openai-image/gpt-image-2`  → gpt-image-2 (low/med/high quality, flexible size up to ~4K)
 *   - `openai-image/<vendor>/<sku>` → forwarded as-is for OpenRouter etc.
 *
 * Image-to-image / edits / variations are NOT covered here — those
 * endpoints (`/images/edits`, `/images/variations`) take
 * `multipart/form-data`. When the node has upstream image inputs we
 * silently drop them (with a warn log) and proceed as text-to-image,
 * so a connected image node doesn't kill the whole call.
 *
 * Frontend params used:
 *   - `aspectRatio` → mapped to a `size` string. Three flavours:
 *       - `'auto'`            → forwarded as-is (gpt-image-* only)
 *       - `'W:H'` (e.g. 16:9) → maps to a SIZE_BY_RATIO entry for
 *                               dall-e-* (fixed enum), OR computed
 *                               proportional WxH for gpt-image-*
 *                               (clamped to family pixel cap)
 *   - `resolution`  → `'1k'|'2k'|'4k'` target pixel budget for
 *                     gpt-image-* flexible sizing (no-op on dall-e-*)
 *   - `n`           → number of images, default 1, clamped to 10
 *   - `quality`     → forwarded as-is. SDK accepts:
 *                       dall-e-3:     `standard` | `hd`
 *                       gpt-image-*:  `low` | `medium` | `high`
 *                     Validation lives upstream — sending a wrong
 *                     value just bubbles up the OpenAI 400.
 *   - `style`       → forwarded ONLY for dall-e-3 (`vivid`|`natural`).
 *                     gpt-image-* refuses it, so we drop on that family.
 *
 * Result URLs from OpenAI are short-lived (≈ 1h). The orchestrator's
 * `FileTransferService` mirrors them to COS / DashScope-temp storage
 * before we hand the URL to the frontend, so this provider doesn't
 * need to download/re-upload itself.
 */
@Injectable()
export class OpenAICompatImageProvider implements ProviderClient {
  readonly name = 'openai-compat-image';
  private readonly logger = new Logger(OpenAICompatImageProvider.name);

  private readonly IMAGE_PATH = '/images/generations';

  /**
   * Fixed-enum size map for legacy DALL-E SKUs. DALL-E 2/3 reject any
   * `size` outside this enum with a 400, so we pick the closest
   * supported value for each ratio. gpt-image-* uses {@link computeFlexibleSize}
   * instead — it accepts any `WxH` up to a family pixel cap.
   */
  private static readonly SIZE_BY_RATIO_DALLE: Record<string, string> = {
    '1:1': '1024x1024',
    '16:9': '1792x1024',
    '9:16': '1024x1792',
    '4:3': '1024x1024',
    '3:4': '1024x1024',
    '3:2': '1024x1024',
    '2:3': '1024x1024',
  };

  /**
   * Per-family max pixel cap, used when computing flexible sizes for
   * gpt-image-*. Values from OpenAI's API docs (2026-04 GA) — the
   * hard ceiling for gpt-image-2 is 8.29M (~4K total). Going above
   * is a 400 from upstream.
   *
   * gpt-image-1 / 1.5 share the older 1.5M cap (1024 max edge).
   */
  private static readonly FAMILY_MAX_PIXELS = {
    'gpt-image-2': 8_294_400,
    'gpt-image-1.5': 1_572_864,
    'gpt-image-1': 1_572_864,
  } as const;

  /**
   * Resolution → target pixel budget for the flexible-sizing path.
   * `1k/2k/4k` is the user-facing label; the actual budget is the
   * total pixel count (so a 2k budget produces e.g. 2048×2048,
   * 1664×2496 for 2:3, 2752×1552 for 16:9, ...).
   *
   * Picks below the family cap → upstream accepts; picks above →
   * computeFlexibleSize() clamps.
   */
  private static readonly TARGET_PIXELS_BY_RES: Record<string, number> = {
    '1k': 1_048_576,
    '2k': 4_194_304,
    '4k': 8_294_400,
  };

  constructor(
    private readonly httpService: HttpService,
    private readonly openaiConfig: OpenaiCompatConfigService,
  ) {}

  supports(modelSku: string): boolean {
    if (!modelSku) return false;
    return modelSku.toLowerCase().startsWith('openai-image/');
  }

  async submit(req: SubmitRequest): Promise<SubmitResult> {
    if (!req.prompt) {
      throw this.toHttpException(
        `${req.modelSku} requires a prompt`,
        400,
        null,
      );
    }
    // Image-to-image lives on a different endpoint (`/images/edits`,
    // multipart). We don't implement it yet, but hard-rejecting was
    // hostile: any upstream image (intentional reference OR just an
    // `@`-mention from a connected image node) blew up the whole call,
    // even though the user clearly wanted text-to-image. Drop the
    // image inputs with a warn instead — the prompt still goes
    // through and the user gets a result.
    const imageInputCount = (req.inputs ?? []).filter(
      (i) => i.type === 'image',
    ).length;
    if (imageInputCount > 0) {
      this.logger.warn(
        `[openai-compat-image:submit] sku=${req.modelSku} requestId=${req.requestId} ` +
          `dropping ${imageInputCount} upstream image input(s); /images/edits is not wired up yet, ` +
          `proceeding as text-to-image.`,
      );
    }

    const apiKey = await this.openaiConfig.getApiKey();
    const baseUrl = await this.openaiConfig.getBaseUrl();
    const timeout = await this.openaiConfig.getTimeoutMs('image');
    const realSku = this.stripNamespace(req.modelSku);
    const family = this.resolveFamily(realSku);

    const body: Record<string, any> = {
      model: realSku,
      prompt: req.prompt,
      n: this.clampN(req.extraParams),
      response_format: 'url',
    };
    const size = this.resolveSize(req.extraParams, family);
    if (size) body.size = size;
    const quality = (req.extraParams as any)?.quality;
    if (typeof quality === 'string' && quality) body.quality = quality;
    // `style` is dall-e-3 only. gpt-image-* refuses it (input_fidelity is
    // also disabled per OpenAI's 2026-04 docs — we never send it).
    if (family === 'dalle') {
      const style = (req.extraParams as any)?.style;
      if (typeof style === 'string' && style) body.style = style;
    }
    const seed = this.numericParam(req.extraParams, 'seed');
    if (seed !== undefined) body.seed = seed;

    const url = `${baseUrl}${this.IMAGE_PATH}`;
    this.logger.log(
      `[openai-compat-image:submit] sku=${req.modelSku} (real=${realSku}) ` +
        `requestId=${req.requestId} url=${url} body=${summarizeBody(body)}`,
    );

    let resp;
    try {
      resp = await firstValueFrom(
        this.httpService.post(url, body, {
          timeout,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
        }),
      );
    } catch (e: any) {
      const data = e?.response?.data ?? null;
      const err = this.toHttpException(
        data?.error?.message ||
          data?.message ||
          e?.message ||
          'OpenAI-compat image failed',
        e?.response?.status ?? 502,
        data ?? { requestBody: body },
      );
      (err as any).requestPayload = body;
      throw err;
    }

    const data = resp.data ?? {};
    const resources = this.extractResources(data);
    if (resources.length === 0) {
      const err = this.toHttpException(
        'OpenAI-compat image returned no usable url',
        502,
        data,
      );
      (err as any).requestPayload = body;
      throw err;
    }

    return {
      status: 'completed',
      resources,
      usage: this.extractUsage(data?.usage, resources.length),
      raw: data,
      requestPayload: body,
    };
  }

  async pollStatus(_taskId: string): Promise<PollResult> {
    throw new HttpException(
      'openai-compat-image is synchronous and has no taskId to poll',
      500,
    );
  }

  // ---- helpers ---------------------------------------------------------

  private stripNamespace(modelSku: string): string {
    return modelSku.replace(/^openai-image\//i, '');
  }

  /**
   * Pick a sizing strategy bucket from the real (de-namespaced) SKU.
   * Routing is purely lexical so an unknown SKU defaults to `dalle`'s
   * conservative path (fixed enum) — better to 400 with a clear
   * "unsupported size" than to silently send a 4K request to a model
   * that caps at 1024.
   */
  private resolveFamily(
    realSku: string,
  ): 'dalle' | 'gpt-image-2' | 'gpt-image-1' {
    const sku = realSku.toLowerCase();
    if (sku.startsWith('gpt-image-2')) return 'gpt-image-2';
    if (sku.startsWith('gpt-image-1')) return 'gpt-image-1'; // includes gpt-image-1.5
    return 'dalle';
  }

  private resolveSize(
    extra: Record<string, any> | undefined,
    family: 'dalle' | 'gpt-image-2' | 'gpt-image-1',
  ): string | undefined {
    // Explicit `size` wins. Two acceptable forms:
    //   - 'WxH' literal (gpt-image-* and any future flexible model)
    //   - 'auto' string (gpt-image-* — let upstream pick)
    const explicit = extra?.size;
    if (typeof explicit === 'string' && explicit) return explicit;

    const ratio = extra?.aspectRatio;
    if (typeof ratio !== 'string' || !ratio) return undefined;

    // 'auto' is gpt-image-* feature; for dall-e-* drop it (let upstream
    // default kick in).
    if (ratio === 'auto') {
      return family === 'dalle' ? undefined : 'auto';
    }

    if (family === 'dalle') {
      return OpenAICompatImageProvider.SIZE_BY_RATIO_DALLE[ratio];
    }

    // gpt-image-* flexible sizing: ratio + resolution → WxH within cap.
    const resolution =
      typeof extra?.resolution === 'string' ? extra.resolution : '2k';
    return this.computeFlexibleSize(ratio, resolution, family);
  }

  /**
   * Edge alignment for gpt-image-* flexible sizes. OpenAI's hard
   * constraint is "W and H must be multiples of 16" — anything else
   * 400s. We use 16 (not 32 / 64) to keep the resolved WxH as close
   * to the requested aspect ratio as possible.
   */
  private static readonly EDGE_ALIGN = 16;

  /**
   * Map (`'a:b'`, `'1k'|'2k'|'4k'`) → `'WxH'` for gpt-image-* flexible
   * sizing. Algorithm:
   *   1. start from the resolution's pixel budget
   *   2. solve W,H so W*H = budget AND W/H = a/b
   *   3. round each edge to the nearest multiple of EDGE_ALIGN (16) —
   *      OpenAI rejects anything else with a 400
   *   4. clamp by the family's hard pixel cap — '4k' on gpt-image-1.5
   *      e.g. would otherwise blow past its 1.5M ceiling
   *
   * If `ratio` is malformed we return undefined so the caller skips
   * the `size` field; upstream then falls back to its own default
   * (better than sending a syntactically wrong size and 400-ing).
   */
  private computeFlexibleSize(
    ratio: string,
    resolution: string,
    family: 'gpt-image-2' | 'gpt-image-1',
  ): string | undefined {
    const m = ratio.match(/^(\d+)\s*:\s*(\d+)$/);
    if (!m) return undefined;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0)
      return undefined;

    const target =
      OpenAICompatImageProvider.TARGET_PIXELS_BY_RES[resolution] ??
      OpenAICompatImageProvider.TARGET_PIXELS_BY_RES['2k'];
    const familyCap =
      family === 'gpt-image-2'
        ? OpenAICompatImageProvider.FAMILY_MAX_PIXELS['gpt-image-2']
        : OpenAICompatImageProvider.FAMILY_MAX_PIXELS['gpt-image-1'];
    const budget = Math.min(target, familyCap);
    const align = OpenAICompatImageProvider.EDGE_ALIGN;

    // W*H = budget AND W/H = a/b ⟹ W = sqrt(budget * a / b)
    let w = Math.sqrt((budget * a) / b);
    let h = (w * b) / a;
    w = Math.max(align, Math.round(w / align) * align);
    h = Math.max(align, Math.round(h / align) * align);

    // After rounding the area can creep past the cap; scale down
    // proportionally and floor-align so we stay safely under.
    if (w * h > familyCap) {
      const scale = Math.sqrt(familyCap / (w * h));
      w = Math.max(align, Math.floor((w * scale) / align) * align);
      h = Math.max(align, Math.floor((h * scale) / align) * align);
    }
    return `${w}x${h}`;
  }

  private clampN(extra: Record<string, any> | undefined): number {
    const raw = extra?.n;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(n) || n < 1) return 1;
    // OpenAI caps `n` at 10 for dall-e-2 / gpt-image-1, and 1 for
    // dall-e-3. Capping at 10 here lets dall-e-3 surface its own clear
    // 400 instead of us second-guessing the SKU's policy.
    return Math.min(Math.floor(n), 10);
  }

  private numericParam(
    extra: Record<string, any> | undefined,
    key: string,
  ): number | undefined {
    const v = extra?.[key];
    if (v === undefined || v === null || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }

  private extractResources(data: any): ProviderResource[] {
    const list: ProviderResource[] = [];
    const items = Array.isArray(data?.data) ? data.data : [];
    for (const it of items) {
      if (typeof it?.url === 'string' && it.url) {
        list.push({ type: 'image', url: it.url });
        continue;
      }
      // `b64_json` is what gpt-image-1 returns when `response_format`
      // is missing/unsupported. We refuse silently here (callers see
      // "no usable url" instead of trying to base64 → dataURL → COS,
      // which would explode the `flow_executions.outputs` JSON column
      // for a single 1024x1024 image).
    }
    return list;
  }

  private extractUsage(
    usage: unknown,
    count: number,
  ): ProviderUsage | undefined {
    if (usage && typeof usage === 'object') {
      // GPT-image-1 returns usage tokens; DALL-E 2/3 do not. Surface
      // the count plus raw upstream usage when present.
      return { imageCount: count, raw: usage };
    }
    return { imageCount: count };
  }

  private toHttpException(
    message: string,
    status: number,
    payload: unknown,
  ): HttpException {
    const err = new HttpException(
      { errorMessage: message, raw: payload ?? null },
      status,
    );
    (err as any).payloadSnippet = payload ?? message;
    return err;
  }
}
