import { HttpException, Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { DashscopeConfigService } from '../canvas-config/dashscope-config.service';
import { firstValueFrom } from 'rxjs';
import type {
  PollResult,
  ProviderClient,
  ProviderInput,
  ProviderResource,
  ProviderUsage,
  SubmitRequest,
  SubmitResult,
} from './provider.types';

/**
 * DashScope (Bailian) async video provider.
 *
 * Covers any video family SKU served by DashScope:
 *   - `wan2.7-{t2v,i2v,r2v,video-edit}`
 *   - `wan2.6-{t2v,i2v,r2v}`
 *   - `happyhorse-1.0-{t2v,i2v,r2v,video-edit}`
 *
 * Endpoint family is uniform across all of them:
 *   submit:  POST {base}/api/v1/services/aigc/video-generation/video-synthesis
 *            header X-DashScope-Async: enable
 *            body   { model, input: { prompt?, media? }, parameters }
 *   poll:    GET  {base}/api/v1/tasks/{task_id}
 *
 * The shape of `input.media[]` depends on the mode suffix in the SKU
 * (-t2v, -i2v, -r2v, -video-edit). See `buildMedia()` for the mapping.
 * New SKUs that follow the same pattern need zero code changes here.
 */
@Injectable()
export class DashScopeVideoProvider implements ProviderClient {
  readonly name = 'dashscope-video';
  private readonly logger = new Logger(DashScopeVideoProvider.name);

  private readonly SUBMIT_PATH = '/api/v1/services/aigc/video-generation/video-synthesis';
  private readonly TASK_PATH = '/api/v1/tasks';
  // Polling 是轻 GET，不暴露给 admin；submit 走 dashscopeConfig.getTimeoutMs.
  private readonly POLL_TIMEOUT_MS = 10_000;

  constructor(
    private readonly httpService: HttpService,
    private readonly dashscopeConfig: DashscopeConfigService,
  ) {}

  /**
   * Recognised video SKU prefixes. Conservatively matched so any new
   * `wan2.7-foo` lands here without code changes.
   */
  supports(modelSku: string): boolean {
    if (!modelSku) return false;
    const sku = modelSku.toLowerCase();
    return (
      sku.startsWith('wan2.7') ||
      sku.startsWith('wan2.6') ||
      sku.startsWith('happyhorse')
    );
  }

  async submit(req: SubmitRequest): Promise<SubmitResult> {
    const apiKey = await this.dashscopeConfig.getApiKey();
    const baseUrl = await this.dashscopeConfig.getBaseUrl();
    const timeout = await this.dashscopeConfig.getTimeoutMs('video');
    const mode = this.detectMode(req.modelSku);

    const input: Record<string, any> = {};
    if (req.prompt) input.prompt = req.prompt;

    const media = this.buildMedia(req.inputs ?? [], mode);
    if (media.length > 0) input.media = media;

    // Mode-specific preflight checks fail fast with a useful message
    // instead of a 400 from upstream.
    this.validateMediaForMode(req.modelSku, mode, media, req.prompt);

    const body = {
      model: req.modelSku,
      input,
      ...(this.hasParameters(req.extraParams) ? { parameters: this.cleanParameters(req.extraParams) } : {}),
    };

    const url = `${baseUrl}${this.SUBMIT_PATH}`;
    this.logger.log(
      `[dashscope-video:submit] sku=${req.modelSku} mode=${mode} requestId=${req.requestId} media=${media.length}`,
    );

    let resp;
    try {
      resp = await firstValueFrom(
        this.httpService.post(url, body, {
          timeout,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'X-DashScope-Async': 'enable',
            'Content-Type': 'application/json',
          },
        }),
      );
    } catch (e: any) {
      const data = e?.response?.data ?? null;
      throw this.toHttpException(
        data?.message || e?.message || 'DashScope submit failed',
        e?.response?.status ?? 502,
        data ?? { requestBody: body },
      );
    }

    const data = resp.data ?? {};
    const taskId = data?.output?.task_id as string | undefined;
    const taskStatus = String(data?.output?.task_status ?? '').toUpperCase();

    if (!taskId) {
      throw this.toHttpException('DashScope submit returned no task_id', 502, data);
    }
    if (taskStatus === 'FAILED' || taskStatus === 'CANCELED') {
      return {
        status: 'failed',
        taskId,
        errorMessage: data?.output?.message || `DashScope task immediately ${taskStatus}`,
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
        e?.message || 'DashScope poll failed',
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
        errorMessage: out?.message || out?.code || `DashScope task ${taskStatus}`,
        raw: data,
      };
    }
    if (taskStatus === 'RUNNING') return { status: 'running', raw: data };
    return { status: 'pending', raw: data };
  }

  // ---- mode-aware media mapping ---------------------------------------

  /**
   * Map ProviderInput[] to DashScope `input.media[]` based on mode.
   *
   * - t2v        : no media (prompt-only)
   * - i2v        : image[0]=first_frame, image[1]=last_frame, video=first_clip, audio=driving_audio
   * - r2v        : image=reference_image, video=reference_video
   * - video-edit : video=video, image=reference_image
   */
  private buildMedia(inputs: ProviderInput[], mode: VideoMode): Array<{ type: string; url: string }> {
    if (mode === 't2v') return [];

    const images = inputs.filter((i) => i.type === 'image');
    const videos = inputs.filter((i) => i.type === 'video');
    const audios = inputs.filter((i) => i.type === 'audio');
    const media: Array<{ type: string; url: string }> = [];

    if (mode === 'i2v') {
      images.forEach((img, idx) => {
        media.push({ type: idx === 0 ? 'first_frame' : 'last_frame', url: img.url });
      });
      videos.forEach((v) => media.push({ type: 'first_clip', url: v.url }));
      audios.forEach((a) => media.push({ type: 'driving_audio', url: a.url }));
      return media;
    }

    if (mode === 'r2v') {
      images.forEach((img) => media.push({ type: 'reference_image', url: img.url }));
      videos.forEach((v) => media.push({ type: 'reference_video', url: v.url }));
      return media;
    }

    if (mode === 'video-edit') {
      videos.forEach((v) => media.push({ type: 'video', url: v.url }));
      images.forEach((img) => media.push({ type: 'reference_image', url: img.url }));
      return media;
    }

    // Unknown mode: pass everything through as reference_image / reference_video
    images.forEach((img) => media.push({ type: 'reference_image', url: img.url }));
    videos.forEach((v) => media.push({ type: 'reference_video', url: v.url }));
    return media;
  }

  private detectMode(sku: string): VideoMode {
    const lower = sku.toLowerCase();
    if (lower.endsWith('-t2v')) return 't2v';
    if (lower.endsWith('-i2v')) return 'i2v';
    if (lower.endsWith('-r2v')) return 'r2v';
    if (lower.endsWith('-video-edit') || lower.endsWith('-videoedit')) return 'video-edit';
    return 'unknown';
  }

  private validateMediaForMode(
    sku: string,
    mode: VideoMode,
    media: Array<{ type: string; url: string }>,
    prompt: string,
  ): void {
    if (mode === 't2v' && !prompt) {
      throw this.toHttpException(`${sku} requires a prompt`, 400, null);
    }
    if (mode === 'i2v' && media.length === 0) {
      throw this.toHttpException(`${sku} requires at least one image (first_frame)`, 400, null);
    }
    if (mode === 'r2v' && media.length === 0) {
      throw this.toHttpException(`${sku} requires at least one reference image/video`, 400, null);
    }
    if (mode === 'video-edit' && !media.some((m) => m.type === 'video')) {
      throw this.toHttpException(`${sku} requires exactly one video input`, 400, null);
    }
  }

  // ---- internals -------------------------------------------------------

  private hasParameters(extraParams?: Record<string, any>): boolean {
    if (!extraParams) return false;
    return Object.keys(this.cleanParameters(extraParams)).length > 0;
  }

  /**
   * Drop frontend bookkeeping keys that shouldn't reach DashScope.
   * `model`, `mode`, `prompt`, `action` are consumed elsewhere.
   *
   * Common keys that DO pass through: resolution, ratio, duration, seed,
   * watermark, prompt_extend, negative_prompt, audio_setting.
   */
  private cleanParameters(extraParams?: Record<string, any>): Record<string, any> {
    if (!extraParams) return {};
    const drop = new Set(['model', 'mode', 'prompt', 'action', 'aspectRatio']);
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(extraParams)) {
      if (drop.has(k)) continue;
      if (v === undefined || v === null || v === '') continue;
      out[k] = v;
    }
    // Frontend uses camelCase `aspectRatio`; DashScope expects `ratio`.
    if (extraParams.aspectRatio && !out.ratio) {
      out.ratio = String(extraParams.aspectRatio);
    }
    if (out.resolution) out.resolution = String(out.resolution).toUpperCase();
    if (out.duration !== undefined) out.duration = Number(out.duration);
    return out;
  }

  /**
   * Normalise DashScope `usage` block. Video endpoints commonly return
   * `{ video_duration, video_ratio, video_count }`; we only persist the
   * duration since that's the billable unit. Pricing is left to deployers.
   */
  private extractUsage(usage: unknown): ProviderUsage | undefined {
    if (!usage || typeof usage !== 'object') return undefined;
    const u = usage as Record<string, any>;
    const duration =
      typeof u.video_duration === 'number'
        ? u.video_duration
        : typeof u.duration === 'number'
          ? u.duration
          : undefined;
    if (duration === undefined) return { raw: usage };
    return { videoDurationSec: duration, raw: usage };
  }

  private extractResources(output: any): ProviderResource[] {
    const list: ProviderResource[] = [];
    if (typeof output?.video_url === 'string') {
      list.push({ type: 'video', url: output.video_url });
    }
    if (Array.isArray(output?.results)) {
      for (const r of output.results) {
        if (typeof r?.url === 'string') list.push({ type: r.type ?? 'video', url: r.url });
      }
    }
    return list;
  }

  private toHttpException(message: string, status: number, payload: unknown): HttpException {
    const err = new HttpException({ errorMessage: message, raw: payload ?? null }, status);
    (err as any).payloadSnippet = payload ?? message;
    return err;
  }
}

type VideoMode = 't2v' | 'i2v' | 'r2v' | 'video-edit' | 'unknown';
