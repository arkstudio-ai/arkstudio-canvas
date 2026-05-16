import { HttpException, Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { DashscopeConfigService } from '../canvas-config/dashscope-config.service';
import { DashscopeUploadService } from '../upload/dashscope-upload.service';
import { summarizeBody } from './log-utils';
import { firstValueFrom } from 'rxjs';
import type {
  PollResult,
  ProviderClient,
  ProviderResource,
  ProviderUsage,
  SubmitRequest,
  SubmitResult,
} from './provider.types';

/**
 * DashScope (Bailian) 万相 2.7 图像生成与编辑 provider — synchronous.
 *
 * Docs: alibabacloud.com/zh/model-studio/wan-image-generation-and-editing-api-reference
 *
 * Endpoint:
 *   POST {base}/api/v1/services/aigc/multimodal-generation/generation
 *   (sync — no `X-DashScope-Async`, no task polling)
 *
 * Body shape (single-turn, role=user):
 *   {
 *     "model": "wan2.7-image-pro" | "wan2.7-image",
 *     "input": {
 *       "messages": [{ "role": "user", "content": [
 *         { "text": "..." },
 *         { "image": "https://..." }, ...   // 0..9 images
 *       ]}]
 *     },
 *     "parameters": {
 *       "size": "1K" | "2K" | "4K" | "WIDTH*HEIGHT",
 *       "n": 1..4,
 *       "watermark": bool,
 *       "prompt_extend": bool,
 *       "thinking_mode": bool   // pro only
 *     }
 *   }
 *
 * Both t2i and i2i go through the same endpoint:
 *   - 0 upstream images → text-to-image
 *   - 1..9 upstream images → image edit / multi-image reference
 *
 * Response (sync):
 *   output.choices[0].message.content[].image  → URLs of generated images
 *   usage.input_tokens / output_tokens / size  → kept verbatim in raw
 *
 * Why sync (vs the previous async text2image/image-synthesis endpoint):
 *   The old `wanx-*` async endpoint never accepted `wan2.7-*` SKUs and
 *   the body format is also different (input.prompt + input.ref_img vs
 *   the new messages structure). Wan 2.7 is the only image SKU we
 *   officially support in the open-source build, so this provider is
 *   sync-only.
 */
@Injectable()
export class DashScopeImageProvider implements ProviderClient {
  readonly name = 'dashscope-image';
  private readonly logger = new Logger(DashScopeImageProvider.name);

  private readonly SUBMIT_PATH =
    '/api/v1/services/aigc/multimodal-generation/generation';

  /**
   * Map (aspectRatio, resolution) → "WIDTH*HEIGHT" string.
   *
   * Wan 2.7 accepts both `1K`/`2K`/`4K` regular shorthands and explicit
   * `WIDTH*HEIGHT` pixels. Shorthands force a square (or follow the
   * input image's ratio when image inputs are present), which is rarely
   * what users want when they pick a ratio chip in the UI. So we expand
   * to explicit pixels here.
   *
   * Keep all values divisible by 16 (Wan recommendation). Total pixel
   * budgets per resolution tier roughly follow the doc:
   *   1K ≈ 1M  pixels  (1024*1024)
   *   2K ≈ 4M  pixels  (2048*2048)
   *   4K ≈ 16M pixels  (pro / t2i only — see size constraints in doc)
   */
  private static readonly SIZE_TABLE: Record<string, Record<string, string>> = {
    '1K': {
      '1:1': '1024*1024',
      '16:9': '1280*720',
      '9:16': '720*1280',
      '4:3': '1152*864',
      '3:4': '864*1152',
      '3:2': '1152*768',
      '2:3': '768*1152',
    },
    '2K': {
      '1:1': '2048*2048',
      '16:9': '2560*1440',
      '9:16': '1440*2560',
      '4:3': '2304*1728',
      '3:4': '1728*2304',
      '3:2': '2304*1536',
      '2:3': '1536*2304',
    },
    '4K': {
      '1:1': '4096*4096',
      '16:9': '4096*2304',
      '9:16': '2304*4096',
      '4:3': '4096*3072',
      '3:4': '3072*4096',
      '3:2': '4096*2720',
      '2:3': '2720*4096',
    },
  };

  constructor(
    private readonly httpService: HttpService,
    private readonly dashscopeConfig: DashscopeConfigService,
    private readonly dashscopeUpload: DashscopeUploadService,
  ) {}

  /** Only Wan 2.7 image SKUs route here. Other DashScope SKUs (chat/video/audio) belong to their own providers. */
  supports(modelSku: string): boolean {
    if (!modelSku) return false;
    return modelSku.toLowerCase().startsWith('wan2.7-image');
  }

  async submit(req: SubmitRequest): Promise<SubmitResult> {
    const apiKey = await this.dashscopeConfig.getApiKey();
    const baseUrl = await this.dashscopeConfig.getBaseUrl();
    const timeout = await this.dashscopeConfig.getTimeoutMs('image');

    if (!req.prompt && (req.inputs?.length ?? 0) === 0) {
      throw this.toHttpException(
        `${req.modelSku} requires either a prompt or at least one image input`,
        400,
        null,
      );
    }

    // Reference images stored locally must be staged to dashscope-temp first;
    // cloud model can't fetch from our intranet. No-op for public https / oss URLs.
    const stagedInputs = await this.dashscopeUpload.stageLocalUrlsToTemp(
      req.inputs ?? [],
      req.modelSku,
    );

    // Wan 2.7 wants a single-turn message whose content array interleaves
    // text and image elements. Order matters per docs: image elements
    // define their visual sequence in the order they appear.
    const content: Array<Record<string, string>> = [];
    if (req.prompt) content.push({ text: req.prompt });
    const images = stagedInputs.filter((i) => i.type === 'image');
    if (images.length > 9) {
      // Wan 2.7 accepts at most 9 images; fail-fast with a clear hint
      // rather than a generic 400 from upstream.
      throw this.toHttpException(
        `${req.modelSku} accepts at most 9 image inputs (received ${images.length})`,
        400,
        null,
      );
    }
    for (const img of images) content.push({ image: img.url });

    const body: Record<string, any> = {
      model: req.modelSku,
      input: {
        messages: [{ role: 'user', content }],
      },
      ...this.buildParameters(req, images.length > 0),
    };

    const url = `${baseUrl}${this.SUBMIT_PATH}`;
    this.logger.log(
      `[dashscope-image:submit] sku=${req.modelSku} requestId=${req.requestId} ` +
        `images=${images.length} url=${url} body=${summarizeBody(body)}`,
    );

    let resp;
    try {
      resp = await firstValueFrom(
        this.httpService.post(url, body, {
          timeout,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            // Required when input URLs use the `oss://` scheme (DashScope
            // free temporary storage). Always-on: no-op for https URLs.
            'X-DashScope-OssResourceResolve': 'enable',
            'Content-Type': 'application/json',
          },
          // 强制直连, 不复用 axios process-wide agent pool 里可能残留的 proxy
          // agent. 见 dashscope-chat.provider 同款 proxy:false 注释.
          proxy: false,
        }),
      );
    } catch (e: any) {
      const data = e?.response?.data ?? null;
      const err = this.toHttpException(
        data?.message ||
          data?.error?.message ||
          e?.message ||
          'DashScope wan2.7 image failed',
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
        'DashScope wan2.7 image returned no usable url',
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

  /**
   * Sync provider; this exists only to satisfy `ProviderClient`. If anyone
   * ever calls it that means `ExecutionsService` saw `status:'pending'`
   * from `submit()` — we never return pending — so the throw is the right
   * signal that the contract diverged and needs revisiting.
   */
  async pollStatus(taskId: string): Promise<PollResult> {
    throw new HttpException(
      `dashscope-image (wan2.7) is synchronous; pollStatus called with taskId=${taskId} indicates a logic bug`,
      500,
    );
  }

  // ---- helpers ---------------------------------------------------------

  /**
   * Build the `parameters` slice from the frontend's free-form extraParams.
   * Drops UI-only fields (model/mode/prompt/action), maps aspectRatio +
   * resolution into a concrete `size`, normalises numeric fields. Unknown
   * keys are passed through verbatim so we don't have to redeploy when a
   * new optional knob ships upstream.
   */
  private buildParameters(
    req: SubmitRequest,
    hasImageInputs: boolean,
  ): { parameters?: Record<string, any> } {
    const extra = req.extraParams ?? {};
    const drop = new Set([
      'model',
      'mode',
      'prompt',
      'action',
      'aspectRatio',
      'resolution',
    ]);
    const out: Record<string, any> = {};

    for (const [k, v] of Object.entries(extra)) {
      if (drop.has(k)) continue;
      if (v === undefined || v === null || v === '') continue;
      out[k] = v;
    }

    // size: only set when not provided directly. Honour explicit `size`
    // from extraParams to leave a back door for "I know what I'm doing"
    // tweaks (e.g. picking exact pixel values from the admin).
    if (!out.size) {
      const aspect = String(extra.aspectRatio ?? '1:1');
      const resolution = String(extra.resolution ?? '2K').toUpperCase();
      // 4K is pro-only and also disallowed when image inputs are present
      // (doc: pro 文生图 1K/2K/4K, 其他场景 1K/2K). Falling back to 2K is
      // safer than letting upstream return a 400 — user picks a tier the
      // model can't honour, we silently soften to the nearest allowed.
      const tier = this.normaliseResolutionTier(
        req.modelSku,
        resolution,
        hasImageInputs,
      );
      const size = DashScopeImageProvider.SIZE_TABLE[tier]?.[aspect];
      if (size) out.size = size;
      else if (tier === '1K' || tier === '2K' || tier === '4K') out.size = tier;
    }

    if (out.n !== undefined) out.n = Number(out.n);
    if (typeof out.watermark === 'string')
      out.watermark = out.watermark === 'true';
    if (typeof out.prompt_extend === 'string')
      out.prompt_extend = out.prompt_extend === 'true';
    if (typeof out.thinking_mode === 'string')
      out.thinking_mode = out.thinking_mode === 'true';

    return Object.keys(out).length > 0 ? { parameters: out } : {};
  }

  /**
   * Per docs: wan2.7-image-pro 文生图 supports 1K/2K/4K, 其他场景 1K/2K;
   * wan2.7-image (standard) only ever supports 1K/2K. Soften an otherwise
   * invalid combo to the nearest allowed tier so the UI stays forgiving.
   */
  private normaliseResolutionTier(
    sku: string,
    requested: string,
    hasImageInputs: boolean,
  ): string {
    const isPro = sku.toLowerCase().includes('-pro');
    if (requested === '4K') {
      if (isPro && !hasImageInputs) return '4K';
      return '2K';
    }
    if (requested === '1K' || requested === '2K') return requested;
    return '2K';
  }

  /**
   * Wan 2.7 returns generated images at output.choices[*].message.content[*].image.
   * One choice contains all `n` images. Defensive against shape drift —
   * also pull from a flat `output.results` if a future API iteration uses
   * the same key as the old async endpoint.
   */
  private extractResources(data: any): ProviderResource[] {
    const list: ProviderResource[] = [];
    const choices = data?.output?.choices;
    if (Array.isArray(choices)) {
      for (const choice of choices) {
        const content = choice?.message?.content;
        if (!Array.isArray(content)) continue;
        for (const item of content) {
          const url = item?.image;
          if (typeof url === 'string' && url) list.push({ type: 'image', url });
        }
      }
    }
    if (list.length === 0 && Array.isArray(data?.output?.results)) {
      for (const r of data.output.results) {
        if (typeof r?.url === 'string')
          list.push({ type: 'image', url: r.url });
      }
    }
    return list;
  }

  private extractUsage(
    usage: unknown,
    generatedCount: number,
  ): ProviderUsage | undefined {
    if (!usage || typeof usage !== 'object') {
      return generatedCount > 0 ? { imageCount: generatedCount } : undefined;
    }
    const u = usage as Record<string, any>;
    const out: ProviderUsage = { raw: usage };
    if (typeof u.input_tokens === 'number') out.inputTokens = u.input_tokens;
    if (typeof u.output_tokens === 'number') out.outputTokens = u.output_tokens;
    if (generatedCount > 0) out.imageCount = generatedCount;
    return out;
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
