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
import { NetworkConfigService } from '../canvas-config/network-config.service';
import { LocalStorageService } from '../storage/local-storage.service';
import { summarizeBody } from './log-utils';
import {
  clampSeed,
  resolveFamily,
  resolveSize,
  type ImageFamily,
} from './openai-compat-image-sizing';
import { OpenAICompatImageEdits } from './openai-compat-image-edits';

/**
 * OpenAI-compatible image provider.
 *
 *   POST {base}/images/generations      — text-to-image (JSON)
 *   POST {base}/images/edits            — image-to-image (multipart)
 *
 * SKU routing:
 *   - `openai-image/dall-e-3`     → dall-e-3 (only n=1, supports quality/style)
 *   - `openai-image/dall-e-2`     → dall-e-2 (n=1..10)
 *   - `openai-image/gpt-image-1`  → gpt-image-1 / 1.5 (low/med/high quality)
 *   - `openai-image/gpt-image-2`  → gpt-image-2 (low/med/high quality, flexible
 *                                                size up to ~4K, GA 2026-04)
 *   - `openai-image/<vendor>/<sku>` → forwarded as-is for OpenRouter etc.
 *
 * i2i (gpt-image-* only): when `inputs[]` has any image, switches to
 * `/images/edits` (multipart). dall-e-* image inputs are still dropped
 * with a warn — the user explicitly scoped i2i to gpt-image-* this
 * round. Sizing math lives in {@link './openai-compat-image-sizing'},
 * the multipart + b64-persist path in {@link './openai-compat-image-edits'}.
 *
 * Frontend params used:
 *   - `aspectRatio` + `resolution` → mapped to `size` per family
 *   - `n`                          → clamped 1..10
 *   - `quality`                    → forwarded as-is per family
 *   - `style`                      → forwarded only for dall-e-3
 *   - `seed`                       → clamped to [0, 2^32-1]
 *
 * Result URLs from `/images/generations` are short-lived (≈ 1h);
 * the orchestrator's `FileTransferService` mirrors them to local
 * disk. The `/images/edits` path returns `b64_json` for gpt-image-*,
 * which we persist to LocalStorage inline and surface as a
 * `/static/...` URL, so downstream code never sees raw base64.
 */
@Injectable()
export class OpenAICompatImageProvider implements ProviderClient {
  readonly name = 'openai-compat-image';
  private readonly logger = new Logger(OpenAICompatImageProvider.name);
  private readonly IMAGE_PATH = '/images/generations';
  private readonly edits: OpenAICompatImageEdits;

  constructor(
    private readonly httpService: HttpService,
    private readonly openaiConfig: OpenaiCompatConfigService,
    private readonly network: NetworkConfigService,
    private readonly localStorage: LocalStorageService,
  ) {
    this.edits = new OpenAICompatImageEdits(
      httpService,
      localStorage,
      this.logger,
    );
  }

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

    const apiKey = await this.openaiConfig.getApiKey();
    const baseUrl = await this.openaiConfig.getBaseUrl();
    const timeout = await this.openaiConfig.getTimeoutMs('image');
    const realSku = this.stripNamespace(req.modelSku);
    const family = resolveFamily(realSku);

    const imageInputs = (req.inputs ?? []).filter((i) => i.type === 'image');

    // i2i path — only for gpt-image-* (user-scoped). dall-e-* still
    // drops image inputs with a warn (legacy behaviour: better to
    // produce a text-only result than 400 on a connected image node).
    if (imageInputs.length > 0 && family !== 'dalle') {
      const url = `${baseUrl}/images/edits`;
      const proxy = await this.network.getAxiosProxy(url);
      const result = await this.edits.run({
        baseUrl,
        apiKey,
        timeoutMs: timeout,
        proxy,
        realSku,
        prompt: req.prompt,
        imageInputs,
        n: this.clampN(req.extraParams),
        size: resolveSize(req.extraParams, family),
        quality: this.stringParam(req.extraParams, 'quality'),
        seed: clampSeed((req.extraParams as any)?.seed),
        requestId: req.requestId,
      });
      return {
        status: 'completed',
        resources: result.resources,
        usage: result.usage,
        raw: result.raw,
        requestPayload: result.requestPayloadSummary,
      };
    }

    if (imageInputs.length > 0) {
      this.logger.warn(
        `[openai-compat-image:submit] sku=${req.modelSku} requestId=${req.requestId} ` +
          `dropping ${imageInputs.length} upstream image input(s); dall-e-* /images/edits ` +
          `is not wired up, proceeding as text-to-image.`,
      );
    }

    const body = this.buildGenerationsBody(req, realSku, family);
    const url = `${baseUrl}${this.IMAGE_PATH}`;
    this.logger.log(
      `[openai-compat-image:submit] sku=${req.modelSku} (real=${realSku}) ` +
        `requestId=${req.requestId} url=${url} body=${summarizeBody(body)}`,
    );

    // 显式拿 admin 配置的代理 (或 false). 不依赖 env-based detection,
    // 因为 axios v1 的 agent pool 在 env 翻转时会缓存陈旧 agent →
    // ERR_ASSERTION / protocol mismatch. 见 NetworkConfigService.getAxiosProxy.
    const proxy = await this.network.getAxiosProxy(url);
    let resp;
    try {
      resp = await firstValueFrom(
        this.httpService.post(url, body, {
          timeout,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          proxy,
        }),
      );
    } catch (e: any) {
      const data = e?.response?.data ?? null;
      this.logger.error(
        `[openai-compat-image:submit] ❌ sku=${req.modelSku} ` +
          `status=${e?.response?.status ?? '?'} code=${e?.code ?? '?'} ` +
          `upstream=${JSON.stringify(data).slice(0, 600)} ` +
          `axiosMessage=${(e as Error).message}`,
      );
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

  private buildGenerationsBody(
    req: SubmitRequest,
    realSku: string,
    family: ImageFamily,
  ): Record<string, any> {
    const body: Record<string, any> = {
      model: realSku,
      prompt: req.prompt,
      n: this.clampN(req.extraParams),
      response_format: 'url',
    };
    const size = resolveSize(req.extraParams, family);
    if (size) body.size = size;
    const quality = this.stringParam(req.extraParams, 'quality');
    if (quality) body.quality = quality;
    // `style` is dall-e-3 only. gpt-image-* refuses it.
    if (family === 'dalle') {
      const style = this.stringParam(req.extraParams, 'style');
      if (style) body.style = style;
    }
    const seed = clampSeed((req.extraParams as any)?.seed);
    if (seed !== undefined) body.seed = seed;
    return body;
  }

  private stripNamespace(modelSku: string): string {
    return modelSku.replace(/^openai-image\//i, '');
  }

  private clampN(extra: Record<string, any> | undefined): number {
    const raw = extra?.n;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(n) || n < 1) return 1;
    return Math.min(Math.floor(n), 10);
  }

  private stringParam(
    extra: Record<string, any> | undefined,
    key: string,
  ): string | undefined {
    const v = extra?.[key];
    return typeof v === 'string' && v ? v : undefined;
  }

  private extractResources(data: any): ProviderResource[] {
    const list: ProviderResource[] = [];
    const items = Array.isArray(data?.data) ? data.data : [];
    for (const it of items) {
      if (typeof it?.url === 'string' && it.url) {
        list.push({ type: 'image', url: it.url });
      }
      // b64_json from /images/generations is rare (only when caller
      // requests it). i2i is the common b64 case and is handled in
      // openai-compat-image-edits with disk-persist. If a SKU starts
      // returning b64 here unexpectedly the caller sees "no usable url"
      // — preferable to silently exploding flow_executions.outputs.
    }
    return list;
  }

  private extractUsage(
    usage: unknown,
    count: number,
  ): ProviderUsage | undefined {
    if (usage && typeof usage === 'object') {
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
    // 显式覆盖 .message, 否则 NestJS 默认 .message = 'Http Exception'(类名),
    // ExecutionsService log 只看到 wrapper 名字, root cause 丢失.
    (err as any).message = message;
    return err;
  }
}
