import { HttpException, Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { DashscopeConfigService } from '../canvas-config/dashscope-config.service';
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
 * DashScope (Bailian) async image provider.
 *
 * Covers `qwen-image-*` and `wanx-*` / `wanx2.*` SKUs. Endpoint:
 *
 *   submit:  POST {base}/api/v1/services/aigc/text2image/image-synthesis
 *            header X-DashScope-Async: enable
 *            body   { model, input: { prompt, ref_img? }, parameters: { size, n } }
 *   poll:    GET  {base}/api/v1/tasks/{task_id}
 *
 * Image upstream:
 *   - 0 upstream image → text-to-image
 *   - 1 upstream image → image-to-image via `input.ref_img`
 *
 * Frontend params used:
 *   - `aspectRatio` → mapped to `parameters.size` via SIZE_BY_RATIO
 *   - `n`          → number of images, default 1
 *   - `seed`       → forwarded as-is
 */
@Injectable()
export class DashScopeImageProvider implements ProviderClient {
  readonly name = 'dashscope-image';
  private readonly logger = new Logger(DashScopeImageProvider.name);

  private readonly SUBMIT_PATH = '/api/v1/services/aigc/text2image/image-synthesis';
  private readonly TASK_PATH = '/api/v1/tasks';
  // Polling 是轻 GET，没必要做成可配置；submit 才是慢调用 → 走 dashscopeConfig.
  private readonly POLL_TIMEOUT_MS = 10_000;

  /**
   * DashScope text2image accepts `size` as `WIDTH*HEIGHT`. We map the
   * frontend `aspectRatio` chip to a sensible default that all current
   * SKUs accept. Resolution selection is left at the SDK default.
   */
  private static readonly SIZE_BY_RATIO: Record<string, string> = {
    '1:1': '1024*1024',
    '16:9': '1280*720',
    '9:16': '720*1280',
    '4:3': '1152*864',
    '3:4': '864*1152',
    '3:2': '1152*768',
    '2:3': '768*1152',
  };

  constructor(
    private readonly httpService: HttpService,
    private readonly dashscopeConfig: DashscopeConfigService,
  ) {}

  supports(modelSku: string): boolean {
    if (!modelSku) return false;
    const sku = modelSku.toLowerCase();
    return sku.startsWith('qwen-image') || sku.startsWith('wanx');
  }

  async submit(req: SubmitRequest): Promise<SubmitResult> {
    const apiKey = await this.dashscopeConfig.getApiKey();
    const baseUrl = await this.dashscopeConfig.getBaseUrl();
    const timeout = await this.dashscopeConfig.getTimeoutMs('image');
    if (!req.prompt) {
      throw this.toHttpException(`${req.modelSku} requires a prompt`, 400, null);
    }

    const input: Record<string, any> = { prompt: req.prompt };
    const refImage = (req.inputs ?? []).find((i) => i.type === 'image');
    if (refImage) input.ref_img = refImage.url;

    const params = this.cleanParameters(req.extraParams);

    const body = {
      model: req.modelSku,
      input,
      ...(Object.keys(params).length > 0 ? { parameters: params } : {}),
    };

    const url = `${baseUrl}${this.SUBMIT_PATH}`;
    this.logger.log(
      `[dashscope-image:submit] sku=${req.modelSku} requestId=${req.requestId} ` +
        `ref=${refImage ? 1 : 0} url=${url} body=${summarizeBody(body)}`,
    );

    let resp;
    try {
      resp = await firstValueFrom(
        this.httpService.post(url, body, {
          timeout,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'X-DashScope-Async': 'enable',
            // Required when input URLs use the `oss://` scheme (DashScope
            // free temporary storage). Always-on: no-op for https URLs,
            // saves a per-call branch on the input shape.
            'X-DashScope-OssResourceResolve': 'enable',
            'Content-Type': 'application/json',
          },
        }),
      );
    } catch (e: any) {
      const data = e?.response?.data ?? null;
      throw this.toHttpException(
        data?.message || e?.message || 'DashScope image submit failed',
        e?.response?.status ?? 502,
        data ?? { requestBody: body },
      );
    }

    const data = resp.data ?? {};
    const taskId = data?.output?.task_id as string | undefined;
    const taskStatus = String(data?.output?.task_status ?? '').toUpperCase();
    if (!taskId) {
      throw this.toHttpException('DashScope image submit returned no task_id', 502, data);
    }
    if (taskStatus === 'FAILED' || taskStatus === 'CANCELED') {
      return {
        status: 'failed',
        taskId,
        errorMessage: data?.output?.message || `DashScope image task ${taskStatus}`,
        raw: data,
      };
    }
    return { status: 'pending', taskId, raw: data };
  }

  async pollStatus(taskId: string): Promise<PollResult> {
    const apiKey = await this.dashscopeConfig.getApiKey();
    const baseUrl = await this.dashscopeConfig.getBaseUrl();
    const url = `${baseUrl}${this.TASK_PATH}/${taskId}`;

    let resp;
    try {
      resp = await firstValueFrom(
        this.httpService.get(url, {
          timeout: this.POLL_TIMEOUT_MS,
          headers: { Authorization: `Bearer ${apiKey}` },
        }),
      );
    } catch (e: any) {
      const data = e?.response?.data ?? null;
      throw this.toHttpException(
        e?.message || 'DashScope image poll failed',
        e?.response?.status ?? 502,
        data,
      );
    }

    const data = resp.data ?? {};
    const out = data?.output ?? {};
    const taskStatus = String(out?.task_status ?? '').toUpperCase();

    if (taskStatus === 'SUCCEEDED') {
      return {
        status: 'completed',
        resources: this.extractResources(out),
        usage: this.extractUsage(data?.usage),
        raw: data,
      };
    }
    if (taskStatus === 'FAILED' || taskStatus === 'CANCELED' || taskStatus === 'UNKNOWN') {
      return {
        status: 'failed',
        errorMessage: out?.message || out?.code || `DashScope image task ${taskStatus}`,
        raw: data,
      };
    }
    if (taskStatus === 'RUNNING') return { status: 'running', raw: data };
    return { status: 'pending', raw: data };
  }

  // ---- helpers ---------------------------------------------------------

  private cleanParameters(extraParams?: Record<string, any>): Record<string, any> {
    if (!extraParams) return {};
    const drop = new Set(['model', 'mode', 'prompt', 'action', 'aspectRatio']);
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(extraParams)) {
      if (drop.has(k)) continue;
      if (v === undefined || v === null || v === '') continue;
      out[k] = v;
    }
    if (extraParams.aspectRatio && !out.size) {
      const size = DashScopeImageProvider.SIZE_BY_RATIO[String(extraParams.aspectRatio)];
      if (size) out.size = size;
    }
    if (out.n !== undefined) out.n = Number(out.n);
    return out;
  }

  private extractResources(output: any): ProviderResource[] {
    const list: ProviderResource[] = [];
    if (Array.isArray(output?.results)) {
      for (const r of output.results) {
        if (typeof r?.url === 'string') list.push({ type: 'image', url: r.url });
      }
    }
    return list;
  }

  private extractUsage(usage: unknown): ProviderUsage | undefined {
    if (!usage || typeof usage !== 'object') return undefined;
    const u = usage as Record<string, any>;
    const count = typeof u.image_count === 'number' ? u.image_count : undefined;
    if (count === undefined) return { raw: usage };
    return { imageCount: count, raw: usage };
  }

  private toHttpException(message: string, status: number, payload: unknown): HttpException {
    const err = new HttpException({ errorMessage: message, raw: payload ?? null }, status);
    (err as any).payloadSnippet = payload ?? message;
    return err;
  }
}
