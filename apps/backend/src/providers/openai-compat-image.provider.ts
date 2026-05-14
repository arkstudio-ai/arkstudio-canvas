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
 *   - `openai-image/gpt-image-1`  → gpt-image-1 (n=1..10, only b64_json)
 *   - `openai-image/<vendor>/<sku>` → forwarded as-is for OpenRouter etc.
 *
 * Image-to-image / edits / variations are intentionally NOT covered
 * here — those endpoints (`/images/edits`, `/images/variations`) are
 * `multipart/form-data`. We'll add them when there's a node type that
 * actually needs them; until then, declining loudly is better than
 * silently dropping the upstream image.
 *
 * Frontend params used:
 *   - `aspectRatio` → mapped to OpenAI's `size` enum via SIZE_BY_RATIO
 *   - `n`           → number of images, default 1, clamped to 10
 *   - `quality`     → forwarded as-is (`standard` | `hd`, dall-e-3 only)
 *   - `style`       → forwarded as-is (`vivid` | `natural`, dall-e-3 only)
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
   * Map our universal `aspectRatio` chip to the closest OpenAI-supported
   * `size` value. OpenAI's enum is restricted (no arbitrary WxH like
   * DashScope), so we pick the canonical defaults DALL-E 3 documents.
   *
   * - 1:1   → 1024x1024
   * - 16:9  → 1792x1024 (DALL-E 3 landscape)
   * - 9:16  → 1024x1792 (DALL-E 3 portrait)
   * - 4:3 / 3:2 → fall back to 1024x1024 (closest supported)
   */
  private static readonly SIZE_BY_RATIO: Record<string, string> = {
    '1:1': '1024x1024',
    '16:9': '1792x1024',
    '9:16': '1024x1792',
    '4:3': '1024x1024',
    '3:4': '1024x1024',
    '3:2': '1024x1024',
    '2:3': '1024x1024',
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
      throw this.toHttpException(`${req.modelSku} requires a prompt`, 400, null);
    }
    // Image-to-image is a different endpoint; refuse upfront so the
    // operator sees the limitation instead of silently losing the input.
    const refImage = (req.inputs ?? []).find((i) => i.type === 'image');
    if (refImage) {
      throw this.toHttpException(
        'OpenAI-compat 生图暂不支持参考图（i2i / edit）。请使用 wanx 系列或纯文生图模式。',
        400,
        null,
      );
    }

    const apiKey = await this.openaiConfig.getApiKey();
    const baseUrl = await this.openaiConfig.getBaseUrl();
    const timeout = await this.openaiConfig.getTimeoutMs('image');
    const realSku = this.stripNamespace(req.modelSku);

    const body: Record<string, any> = {
      model: realSku,
      prompt: req.prompt,
      n: this.clampN(req.extraParams),
      response_format: 'url',
    };
    const size = this.resolveSize(req.extraParams);
    if (size) body.size = size;
    const quality = (req.extraParams as any)?.quality;
    if (typeof quality === 'string' && quality) body.quality = quality;
    const style = (req.extraParams as any)?.style;
    if (typeof style === 'string' && style) body.style = style;
    const seed = this.numericParam(req.extraParams, 'seed');
    if (seed !== undefined) body.seed = seed;

    const url = `${baseUrl}${this.IMAGE_PATH}`;
    this.logger.log(
      `[openai-compat-image:submit] sku=${req.modelSku} (real=${realSku}) requestId=${req.requestId} n=${body.n} size=${size ?? '<default>'}`,
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
      throw this.toHttpException(
        data?.error?.message || data?.message || e?.message || 'OpenAI-compat image failed',
        e?.response?.status ?? 502,
        data ?? { requestBody: body },
      );
    }

    const data = resp.data ?? {};
    const resources = this.extractResources(data);
    if (resources.length === 0) {
      throw this.toHttpException('OpenAI-compat image returned no usable url', 502, data);
    }

    return {
      status: 'completed',
      resources,
      usage: this.extractUsage(data?.usage, resources.length),
      raw: data,
    };
  }

  async pollStatus(_taskId: string): Promise<PollResult> {
    throw new HttpException('openai-compat-image is synchronous and has no taskId to poll', 500);
  }

  // ---- helpers ---------------------------------------------------------

  private stripNamespace(modelSku: string): string {
    return modelSku.replace(/^openai-image\//i, '');
  }

  private resolveSize(extra: Record<string, any> | undefined): string | undefined {
    // Explicit `size` wins; falls back to `aspectRatio` chip; otherwise
    // let upstream pick its default (`1024x1024` on DALL-E 3).
    const explicit = extra?.size;
    if (typeof explicit === 'string' && explicit) return explicit;
    const ratio = extra?.aspectRatio;
    if (typeof ratio === 'string' && ratio) {
      return OpenAICompatImageProvider.SIZE_BY_RATIO[ratio];
    }
    return undefined;
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

  private numericParam(extra: Record<string, any> | undefined, key: string): number | undefined {
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

  private extractUsage(usage: unknown, count: number): ProviderUsage | undefined {
    if (usage && typeof usage === 'object') {
      // GPT-image-1 returns usage tokens; DALL-E 2/3 do not. Surface
      // the count plus raw upstream usage when present.
      return { imageCount: count, raw: usage };
    }
    return { imageCount: count };
  }

  private toHttpException(message: string, status: number, payload: unknown): HttpException {
    const err = new HttpException({ errorMessage: message, raw: payload ?? null }, status);
    (err as any).payloadSnippet = payload ?? message;
    return err;
  }
}
