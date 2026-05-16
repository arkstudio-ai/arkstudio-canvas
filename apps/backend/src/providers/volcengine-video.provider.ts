import { HttpException, Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { VolcengineConfigService } from '../canvas-config/volcengine-config.service';
import { VolcengineAssetService } from '../volcengine-asset/volcengine-asset.service';
import { summarizeBody } from './log-utils';
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
 * Volcengine (火山方舟) async video provider — Doubao Seedance 2.0 family.
 *
 * Routes any SKU starting with `doubao-seedance-` (or the bare `seedance-`
 * prefix users might paste from the Volcengine console). Examples:
 *   - `doubao-seedance-2-0-260128`        (Seedance 2.0)
 *   - `doubao-seedance-2-0-fast-260128`   (Seedance 2.0 Fast)
 *
 * Endpoint family (identical between 第三方代理 and 火山官方 — only base URL differs):
 *   submit:  POST {base}/contents/generations/tasks
 *   poll:    GET  {base}/contents/generations/tasks/{id}
 *   auth:    Authorization: Bearer <api_key>
 *
 * Default `base = http://123.57.80.82/seedance` (第三方代理); admin can flip
 * to `https://ark.cn-beijing.volces.com/api/v3` for direct upstream — zero
 * code change.
 *
 * Request shape (single body, all variants):
 *   {
 *     model: <sku>,
 *     content: [
 *       { type: "text",      text: "..." },
 *       { type: "image_url", image_url: {url}, role: "first_frame"|"last_frame"|"reference_image" },
 *       { type: "video_url", video_url: {url}, role: "reference_video" },
 *       { type: "audio_url", audio_url: {url}, role: "reference_audio" },
 *     ],
 *     resolution: "480p"|"720p"|"1080p"?,
 *     ratio:      "16:9"|"9:16"|"4:3"|"3:4"|"1:1"|"21:9"|"adaptive"?,
 *     duration:   <4..15> | -1?,
 *     generate_audio?: boolean,
 *     watermark?:     boolean,
 *     tools?:         [{ type: "web_search" }]
 *   }
 *
 * Asset URIs (`asset://<asset_id>`) flow through verbatim — the upstream API
 * resolves them server-side; we never download. Status check before submit
 * (so a stale asset doesn't waste a generation) will land in Slice 3 once
 * the asset CRUD service exists.
 *
 * See `doc 82379/1520757` (官方) + the executor reference for the verbatim
 * spec we mirror.
 */
@Injectable()
export class VolcengineVideoProvider implements ProviderClient {
  readonly name = 'volcengine-video';
  private readonly logger = new Logger(VolcengineVideoProvider.name);

  private readonly SUBMIT_PATH = '/contents/generations/tasks';
  // Polling 是轻 GET, 10s 固定上限, 不暴露给 admin (跟 dashscope-video 一致).
  private readonly POLL_TIMEOUT_MS = 10_000;

  constructor(
    private readonly httpService: HttpService,
    private readonly volcengineConfig: VolcengineConfigService,
    private readonly volcengineAsset: VolcengineAssetService,
  ) {}

  supports(modelSku: string): boolean {
    if (!modelSku) return false;
    const sku = modelSku.toLowerCase();
    // 主要前缀: `doubao-seedance-*` 是火山官方 model ID 形态.
    // 同时接受裸 `seedance-*` 以方便用户粘贴时容错.
    return sku.startsWith('doubao-seedance-') || sku.startsWith('seedance-');
  }

  async submit(req: SubmitRequest): Promise<SubmitResult> {
    const apiKey = await this.volcengineConfig.getApiKey();
    const baseUrl = await this.volcengineConfig.getBaseUrl();
    const timeout = await this.volcengineConfig.getVideoTimeoutMs();
    const defaultModel = await this.volcengineConfig.getDefaultModel();

    const modelId = (req.modelSku?.trim() || defaultModel || '').trim();
    if (!modelId) {
      throw this.toHttpException(
        'Volcengine Seedance: 未指定 model 且 admin 未配置 defaultModel',
        400,
        null,
      );
    }

    const content = this.buildContent(req.prompt, req.inputs ?? []);
    if (content.length === 0) {
      throw this.toHttpException(
        `${modelId} 需要至少一个 text/image/video/audio 输入`,
        400,
        null,
      );
    }

    // 二道防线: 提交前批量校验 asset:// 引用是否 Active. Upstream / proxy 偶尔会
    // LRU 淘汰长期不用的 asset, 或仍在 Processing 状态. 不预检的话 submit 会被
    // 上游拒, 但错误信息抽象 (InvalidParameter); 预检失败抛 400 携带具体哪条 asset
    // 出问题, 前端可直接提示用户 "刷新一下素材状态".
    const assetUris = (req.inputs ?? [])
      .map((i) => i.url)
      .filter((u): u is string => typeof u === 'string' && u.startsWith('asset://'));
    if (assetUris.length > 0) {
      await this.volcengineAsset.assertActive(assetUris);
    }

    const ep = req.extraParams ?? {};
    const body: Record<string, unknown> = { model: modelId, content };

    // 顶层参数 — 直接对齐官方 schema. 缺省由 upstream 决定 (resolution=720p,
    // ratio=adaptive, duration=5, generate_audio=true). 不传等于让 upstream 用默认.
    const resolution = this.pickString(ep.resolution);
    if (resolution) body.resolution = resolution;

    const ratio = this.pickString(ep.ratio ?? ep.aspect_ratio ?? ep.aspectRatio);
    if (ratio) body.ratio = ratio;

    if (ep.duration !== undefined && ep.duration !== null && ep.duration !== '') {
      body.duration = Number(ep.duration);
    }

    if (ep.generate_audio !== undefined) {
      body.generate_audio =
        ep.generate_audio === true || ep.generate_audio === 'true' || ep.generate_audio === 1;
    }

    if (ep.watermark !== undefined) {
      body.watermark =
        ep.watermark === true || ep.watermark === 'true' || ep.watermark === 1;
    }

    if (ep.web_search === true || ep.web_search === 'true' || ep.web_search === 1) {
      body.tools = [{ type: 'web_search' }];
    }

    const url = `${baseUrl}${this.SUBMIT_PATH}`;
    this.logger.log(
      `[volcengine-video:submit] sku=${modelId} requestId=${req.requestId} ` +
        `content_items=${content.length} url=${url} body=${summarizeBody(body)}`,
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
    } catch (e: unknown) {
      const ex = e as { response?: { data?: unknown; status?: number }; message?: string };
      const data = ex.response?.data ?? null;
      const upstreamMessage =
        (data as { error?: { message?: string } } | null)?.error?.message ||
        ex.message ||
        'Volcengine submit failed';
      const err = this.toHttpException(
        upstreamMessage,
        ex.response?.status ?? 502,
        data ?? { requestBody: body },
      );
      (err as unknown as { requestPayload?: unknown }).requestPayload = body;
      throw err;
    }

    const data = resp.data ?? {};
    // 火山方舟统一返回结构: { id: 'cgt-2026...xyz', status?: 'queued'|'running'|... }
    // executor / 第三方代理同款.
    const taskId =
      (data as { id?: string }).id ??
      (data as { task_id?: string }).task_id;
    if (!taskId) {
      const err = this.toHttpException(
        'Volcengine submit returned no task id',
        502,
        data,
      );
      (err as unknown as { requestPayload?: unknown }).requestPayload = body;
      throw err;
    }
    const taskStatus = String(
      (data as { status?: string }).status ?? '',
    ).toLowerCase();
    if (taskStatus === 'failed' || taskStatus === 'cancelled') {
      return {
        status: 'failed',
        taskId,
        errorMessage:
          (data as { error?: { message?: string } }).error?.message ||
          `Volcengine task immediately ${taskStatus}`,
        raw: data,
        requestPayload: body,
      };
    }
    return { status: 'pending', taskId, raw: data, requestPayload: body };
  }

  async pollStatus(taskId: string): Promise<PollResult> {
    const apiKey = await this.volcengineConfig.getApiKey();
    const baseUrl = await this.volcengineConfig.getBaseUrl();
    const url = `${baseUrl}${this.SUBMIT_PATH}/${taskId}`;

    let resp;
    try {
      resp = await firstValueFrom(
        this.httpService.get(url, {
          timeout: this.POLL_TIMEOUT_MS,
          headers: { Authorization: `Bearer ${apiKey}` },
        }),
      );
    } catch (e: unknown) {
      const ex = e as { response?: { data?: unknown; status?: number }; message?: string };
      const data = ex.response?.data ?? null;
      throw this.toHttpException(
        ex.message || 'Volcengine poll failed',
        ex.response?.status ?? 502,
        data,
      );
    }

    const data = resp.data ?? {};
    const taskStatus = String(
      (data as { status?: string }).status ?? '',
    ).toLowerCase();

    if (taskStatus === 'succeeded') {
      return {
        status: 'completed',
        resources: this.extractResources(data),
        usage: this.extractUsage(
          (data as { usage?: unknown }).usage,
        ),
        raw: data,
      };
    }
    if (
      taskStatus === 'failed' ||
      taskStatus === 'cancelled' ||
      taskStatus === 'canceled'
    ) {
      return {
        status: 'failed',
        errorMessage:
          (data as { error?: { message?: string } }).error?.message ||
          `Volcengine task ${taskStatus}`,
        raw: data,
      };
    }
    if (taskStatus === 'running') return { status: 'running', raw: data };
    // queued / pending / 未识别 — 都按 pending 处理, 让 executor 继续轮询
    return { status: 'pending', raw: data };
  }

  // ---- content 构建 -------------------------------------------------------

  /**
   * 把 (prompt, ProviderInput[]) 摊成 Seedance content[].
   *
   * Role 取值约定 (per-input 由 `extra.role` 指定, 未指定时按 type 兜底):
   *   - image: first_frame / last_frame / reference_image (default reference_image)
   *   - video: reference_video (only legal value)
   *   - audio: reference_audio (only legal value)
   *
   * 注意: 官方 API 文档说 "图生视频-首帧 / 图生视频-首尾帧 / 多模态参考"
   * 三种模式是 image role 的互斥用法 (frontend 节点 inspector 来定),
   * provider 这层不替前端决策, 信任传进来的 role.
   */
  private buildContent(
    prompt: string,
    inputs: ProviderInput[],
  ): Array<Record<string, unknown>> {
    const content: Array<Record<string, unknown>> = [];

    if (prompt && prompt.trim()) {
      content.push({ type: 'text', text: prompt });
    }

    for (const input of inputs) {
      const url = (input.url ?? '').trim();
      if (!url) continue;

      if (input.type === 'image') {
        content.push({
          type: 'image_url',
          image_url: { url },
          role: this.pickRole(input, 'reference_image'),
        });
      } else if (input.type === 'video') {
        content.push({
          type: 'video_url',
          video_url: { url },
          role: this.pickRole(input, 'reference_video'),
        });
      } else if (input.type === 'audio') {
        content.push({
          type: 'audio_url',
          audio_url: { url },
          role: this.pickRole(input, 'reference_audio'),
        });
      }
    }

    return content;
  }

  private pickRole(input: ProviderInput, fallback: string): string {
    const raw = input.extra?.role;
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
    return fallback;
  }

  // ---- 响应 normalisation -------------------------------------------------

  private extractResources(data: unknown): ProviderResource[] {
    const out: ProviderResource[] = [];
    const d = data as Record<string, unknown> | null;
    if (!d) return out;

    // 火山方舟视频任务的 succeeded 响应里, 视频 URL 通常在 `content.video_url`,
    // 但部分代理 / 早期版本会放到顶层 `video_url`. 双兜底.
    const direct = d.video_url;
    if (typeof direct === 'string') out.push({ type: 'video', url: direct });

    const contentVideoUrl = (d.content as { video_url?: unknown } | null)
      ?.video_url;
    if (typeof contentVideoUrl === 'string') {
      out.push({ type: 'video', url: contentVideoUrl });
    }

    // 尾帧图 (return_last_frame=true 时):
    const lastFrame = (d.content as { last_frame_url?: unknown } | null)
      ?.last_frame_url;
    if (typeof lastFrame === 'string') {
      out.push({ type: 'image', url: lastFrame });
    }

    // 兜底: results: [{url, type}]
    const results = (d as { results?: unknown }).results;
    if (Array.isArray(results)) {
      for (const r of results) {
        const item = r as { url?: unknown; type?: unknown };
        if (typeof item.url === 'string') {
          out.push({
            type: typeof item.type === 'string' ? item.type : 'video',
            url: item.url,
          });
        }
      }
    }

    return out;
  }

  /**
   * Normalise upstream usage. Seedance returns
   *   `{ total_tokens, prompt_tokens, completion_tokens, video_duration?, tool_usage? }`
   * we surface duration (billable unit) + raw for downstream tooling.
   */
  private extractUsage(usage: unknown): ProviderUsage | undefined {
    if (!usage || typeof usage !== 'object') return undefined;
    const u = usage as Record<string, unknown>;
    const duration =
      typeof u.video_duration === 'number'
        ? u.video_duration
        : typeof u.duration === 'number'
          ? u.duration
          : undefined;
    return {
      videoDurationSec: duration,
      raw: usage,
    };
  }

  // ---- helpers ------------------------------------------------------------

  private pickString(v: unknown): string | undefined {
    if (typeof v === 'string') {
      const t = v.trim();
      return t === '' ? undefined : t;
    }
    return undefined;
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
    (err as unknown as { payloadSnippet?: unknown }).payloadSnippet =
      payload ?? message;
    return err;
  }
}
