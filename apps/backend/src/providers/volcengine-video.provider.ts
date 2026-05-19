import { HttpException, Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { VolcengineConfigService } from '../canvas-config/volcengine-config.service';
import { VolcengineAssetService } from '../volcengine-asset/volcengine-asset.service';
import { OssUploadService } from '../upload/oss-upload.service';
import { getVideoGatewayRedirect } from './extensions';
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
 * Endpoint family (identical between 火山官方 gateway and any compliant
 * private proxy — only base URL differs):
 *   submit:  POST {base}/contents/generations/tasks
 *   poll:    GET  {base}/contents/generations/tasks/{id}
 *   auth:    Authorization: Bearer <api_key>
 *
 * Default `base = https://ark.cn-beijing.volces.com/api/v3` (火山官方). Admin
 * can flip to a private proxy of the same shape via /admin/system — zero
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
    private readonly ossUpload: OssUploadService,
  ) {}

  supports(modelSku: string): boolean {
    if (!modelSku) return false;
    const sku = modelSku.toLowerCase();
    // 主要前缀: `doubao-seedance-*` 是火山官方 model ID 形态.
    // 同时接受裸 `seedance-*` 以方便用户粘贴时容错.
    return sku.startsWith('doubao-seedance-') || sku.startsWith('seedance-');
  }

  async submit(req: SubmitRequest): Promise<SubmitResult> {
    // Gateway redirect: when a fork supplies one, skip the per-vendor
    // config lookups so deployments without a local Volcengine key still
    // work (the gateway holds the upstream credential).
    const redirect = getVideoGatewayRedirect({
      providerId: this.name,
      modelSku: req.modelSku,
    });
    const timeout = await this.volcengineConfig.getVideoTimeoutMs();
    const defaultModel = await this.volcengineConfig.getDefaultModel();
    let baseUrl: string;
    let apiKey: string;
    if (redirect) {
      baseUrl = '';
      apiKey = redirect.apiKey;
    } else {
      apiKey = await this.volcengineConfig.getApiKey();
      baseUrl = await this.volcengineConfig.getBaseUrl();
    }

    const modelId = (req.modelSku?.trim() || defaultModel || '').trim();
    if (!modelId) {
      throw this.toHttpException(
        'Volcengine Seedance: 未指定 model 且 admin 未配置 defaultModel',
        400,
        null,
      );
    }

    // Volcengine 拉素材是 server-side 通过 URL; 本地 backend 的 /static/uploads/
    // 它够不到. 先把每个 local URL 通过 OssUploadService 上传到用户配的 OSS / TOS
    // 拿公网 URL, 再喂给 content[]. 未配置 OSS 且需要 staging 时, 抛 400 引导用户
    // 去 /admin/system 配 OSS — 跟竞品的"本地上传无法继续, 请配存储"行为对齐.
    const stagedInputs = await this.stageLocalInputs(req.inputs ?? [], modelId);
    const content = this.buildContent(req.prompt, stagedInputs);
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
    // Gateway 模式下跳过: assertActive 依赖本地 Volcengine apiKey, 而 gateway
    // 部署里 key 在 gateway 那侧, 这里也不会出现 asset:// (商业版用公网 URL).
    if (!redirect) {
      const assetUris = (req.inputs ?? [])
        .map((i) => i.url)
        .filter((u): u is string => typeof u === 'string' && u.startsWith('asset://'));
      if (assetUris.length > 0) {
        await this.volcengineAsset.assertActive(assetUris);
      }
    }

    const ep = req.extraParams ?? {};
    let body: Record<string, unknown> = { model: modelId, content };

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

    const url = redirect ? redirect.submitUrl : `${baseUrl}${this.SUBMIT_PATH}`;
    if (redirect) {
      body = redirect.transformSubmitBody(body) as Record<string, unknown>;
    }
    this.logger.log(
      `[volcengine-video:submit] sku=${modelId} requestId=${req.requestId} ` +
        `content_items=${content.length} url=${url} body=${summarizeBody(body)}` +
        (redirect ? ' (via gateway override)' : ''),
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
    // Gateway redirect: if a fork supplied one, hand poll over completely
    // — gateway responses are shaped differently from Volcengine's native
    // task GET, so the fork's `pollTask` returns a ready-to-use PollResult.
    const redirect = getVideoGatewayRedirect({
      providerId: this.name,
      modelSku: '',
    });
    if (redirect) return await redirect.pollTask(taskId);

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
   * Walk inputs. For each one with a local-backend URL (relative
   * `/static/uploads/...` or `http://localhost`-style), stage via
   * OssUploadService and replace `.url` with the resulting public URL.
   * `asset://...` and already-public `https://...` pass through.
   *
   * If OSS isn't configured AND staging is needed, throw 400 with a
   * helpful pointer to /admin/system — this is the runtime error the
   * user explicitly asked for as part of the OSS feature.
   */
  private async stageLocalInputs(
    inputs: ProviderInput[],
    modelId: string,
  ): Promise<ProviderInput[]> {
    const localInputs = inputs.filter((i) => isLocalUrl(i.url));
    if (localInputs.length === 0) return inputs;

    const ossReady = await this.ossUpload.isReady();
    if (!ossReady) {
      throw this.toHttpException(
        `${modelId} 用到了本地上传的素材, 但当前没有配置 OSS / TOS。火山方舟的视频生成 ` +
          `API 只接受公网 URL — 请去 /admin/system → 对象存储 (OSS / TOS) 配一个 bucket, ` +
          `或改用素材库 (asset://) / 直接粘公网 URL.`,
        400,
        null,
      );
    }

    const map = new Map<string, string>();
    for (const inp of localInputs) {
      if (map.has(inp.url)) continue;
      const result = await this.ossUpload.stageLocalToOss(inp.url);
      if (!result) {
        // 理论上 ossReady=true 时不会到这, 但兜底一下 — 比如凭据被 admin 中途清掉
        throw this.toHttpException(
          `OSS staging 失败 (${inp.url}): 凭据被中途清掉或上传过程失败`,
          500,
          null,
        );
      }
      map.set(inp.url, result.publicUrl);
      this.logger.log(
        `[volcengine-video:stage] ${inp.url} → ${result.publicUrl} (${result.provider})`,
      );
    }

    return inputs.map((inp) => {
      const staged = map.get(inp.url);
      return staged ? { ...inp, url: staged } : inp;
    });
  }

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
    // 把 message 显式写到 .message 字段, 这样 ExecutionsService log 这条 err
    // 时不会只看到 NestJS 默认的 "Http Exception" 类名. 跟 dashscope-video
    // provider 后续也会同款修.
    (err as unknown as { message: string }).message = message;
    return err;
  }
}

/**
 * Local URL detection.
 *   - server-root-relative paths (`/static/uploads/...`)
 *   - `http://localhost:<port>/...` / `http://127.0.0.1:<port>/...`
 *   - LAN ranges (192.168.x.x / 10.x.x.x / 172.16-31.x.x)
 *
 * `asset://` URIs, `https://` and public-host `http://` URLs pass through.
 */
function isLocalUrl(url: string): boolean {
  if (!url) return false;
  if (url.startsWith('asset://')) return false;
  if (url.startsWith('/')) return true; // server-root-relative, definitely local
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    // localhost / 127.* / 192.168.* / 10.* / 172.16~31.* 都是 LAN, 火山够不到.
    const host = u.hostname;
    if (host === 'localhost' || host === '127.0.0.1') return true;
    if (host.startsWith('192.168.') || host.startsWith('10.')) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
    return false;
  } catch {
    // 不是 absolute URL — 当 local 处理 (relative path)
    return true;
  }
}
