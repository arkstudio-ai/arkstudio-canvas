import { HttpException, Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ViduConfigService } from '../canvas-config/vidu-config.service';
import { ViduAssetService } from '../vidu-asset/vidu-asset.service';
import { OssUploadService } from '../upload/oss-upload.service';
import { summarizeBody } from './log-utils';
import type {
  PollResult,
  ProviderClient,
  ProviderResource,
  ProviderUsage,
  SubmitRequest,
  SubmitResult,
} from './provider.types';

/**
 * Vidu viduq3-ad async video provider — short drama generation.
 *
 * Routes any SKU starting with `vidu-ad`.
 *
 * Endpoint:
 *   submit: POST {base}/ent/v1/short-play-keyframes/tasks
 *   poll:   GET  {base}/ent/v1/short-play-keyframes/tasks/{id}
 *   auth:   Authorization: Token <api_key>
 *
 * Request shape:
 *   {
 *     script_name: string,           // ≤20 chars
 *     script_content: string,        // traditional script format, ≤5000 chars EN
 *     assets: [{id, type, name, image_uri}],
 *     resolution?: "1080p",
 *     aspect_ratio?: "16:9" | "9:16"
 *   }
 *
 * Response shape:
 *   { task: { meta: { id, state }, derived_data: { signed_final_video_url, shots[] } } }
 *
 * States: pending → processing → success / failed
 *
 * Integration:
 *   - prompt       → script_content
 *   - extraParams.scriptName  → script_name
 *   - extraParams.assetIds    → resolved from ViduAsset table → assets[]
 *   - extraParams.resolution  → resolution
 *   - extraParams.aspectRatio → aspect_ratio
 */
@Injectable()
export class ViduAdProvider implements ProviderClient {
  readonly name = 'vidu-ad';
  private readonly logger = new Logger(ViduAdProvider.name);

  private readonly SUBMIT_PATH = '/ent/v1/short-play-keyframes/tasks';
  private readonly POLL_TIMEOUT_MS = 10_000;

  constructor(
    private readonly httpService: HttpService,
    private readonly viduConfig: ViduConfigService,
    private readonly viduAsset: ViduAssetService,
    private readonly ossUpload: OssUploadService,
  ) {}

  supports(modelSku: string): boolean {
    if (!modelSku) return false;
    return modelSku.toLowerCase().startsWith('vidu-ad');
  }

  async submit(req: SubmitRequest): Promise<SubmitResult> {
    const apiKey = await this.viduConfig.getApiKey();
    const baseUrl = await this.viduConfig.getBaseUrl();
    const timeout = await this.viduConfig.getTimeoutMs();

    const ep = req.extraParams ?? {};

    const scriptName = this.pickString(ep.scriptName) ?? '未命名短剧';
    const scriptContent = req.prompt;
    if (!scriptContent || !scriptContent.trim()) {
      throw this.toHttpException(
        'Vidu viduq3-ad: 缺少剧本内容 (script_content / prompt)',
        400,
        null,
      );
    }

    const assetIds: string[] = Array.isArray(ep.assetIds)
      ? ep.assetIds
      : typeof ep.assetIds === 'string'
        ? ep.assetIds.split(',').map((s: string) => s.trim()).filter(Boolean)
        : [];

    if (assetIds.length === 0) {
      throw this.toHttpException(
        'Vidu viduq3-ad: 至少需要一个资产 (asset)',
        400,
        null,
      );
    }

    const dbAssets = await this.viduAsset.findByIds(assetIds);
    if (dbAssets.length !== assetIds.length) {
      const found = new Set(dbAssets.map((a) => a.id));
      const missing = assetIds.filter((id) => !found.has(id));
      throw this.toHttpException(
        `Vidu viduq3-ad: 找不到资产: ${missing.join(', ')}`,
        400,
        { missing },
      );
    }

    const assets = await this.buildAssets(dbAssets);

    const body: Record<string, unknown> = {
      script_name: scriptName,
      script_content: scriptContent,
      assets,
    };

    const resolution = this.pickString(ep.resolution);
    if (resolution) body.resolution = resolution;

    const aspectRatio = this.pickString(
      ep.aspect_ratio ?? ep.aspectRatio,
    );
    if (aspectRatio) body.aspect_ratio = aspectRatio;

    const url = `${baseUrl}${this.SUBMIT_PATH}`;
    this.logger.log(
      `[vidu-ad:submit] requestId=${req.requestId} ` +
        `assets=${assets.length} url=${url} body=${summarizeBody(body)}`,
    );

    let resp;
    try {
      resp = await firstValueFrom(
        this.httpService.post(url, body, {
          timeout,
          headers: {
            Authorization: `Token ${apiKey}`,
            'Content-Type': 'application/json',
          },
        }),
      );
    } catch (e: unknown) {
      const ex = e as {
        response?: { data?: unknown; status?: number };
        message?: string;
      };
      const data = ex.response?.data ?? null;
      const upstreamMessage =
        (data as { message?: string } | null)?.message ||
        ex.message ||
        'Vidu submit failed';
      this.logger.error(
        `[vidu-ad:submit] ❌ status=${ex.response?.status ?? '?'} ` +
          `upstream=${JSON.stringify(data).slice(0, 600)}`,
      );
      const err = this.toHttpException(
        upstreamMessage,
        ex.response?.status ?? 502,
        data ?? { requestBody: body },
      );
      (err as unknown as { requestPayload?: unknown }).requestPayload = body;
      throw err;
    }

    const data = resp.data ?? {};
    const taskId = this.extractTaskId(data);
    if (!taskId) {
      const err = this.toHttpException(
        'Vidu submit returned no task id',
        502,
        data,
      );
      (err as unknown as { requestPayload?: unknown }).requestPayload = body;
      throw err;
    }

    const state = this.extractState(data);
    if (state === 'failed') {
      const errMsg =
        (data as any)?.task?.meta?.err_msg || 'Vidu task immediately failed';
      return {
        status: 'failed',
        taskId,
        errorMessage: errMsg,
        raw: data,
        requestPayload: body,
      };
    }

    return { status: 'pending', taskId, raw: data, requestPayload: body };
  }

  async pollStatus(taskId: string): Promise<PollResult> {
    const apiKey = await this.viduConfig.getApiKey();
    const baseUrl = await this.viduConfig.getBaseUrl();
    const url = `${baseUrl}${this.SUBMIT_PATH}/${taskId}`;

    let resp;
    try {
      resp = await firstValueFrom(
        this.httpService.get(url, {
          timeout: this.POLL_TIMEOUT_MS,
          headers: { Authorization: `Token ${apiKey}` },
        }),
      );
    } catch (e: unknown) {
      const ex = e as {
        response?: { data?: unknown; status?: number };
        message?: string;
      };
      const data = ex.response?.data ?? null;
      throw this.toHttpException(
        ex.message || 'Vidu poll failed',
        ex.response?.status ?? 502,
        data,
      );
    }

    const data = resp.data ?? {};
    const state = this.extractState(data);

    if (state === 'success') {
      return {
        status: 'completed',
        resources: this.extractResources(data),
        usage: this.extractUsage(data),
        raw: data,
      };
    }
    if (state === 'failed') {
      const errMsg =
        (data as any)?.task?.meta?.err_msg ||
        (data as any)?.task?.meta?.err_code ||
        'Vidu task failed';
      return {
        status: 'failed',
        errorMessage: errMsg,
        raw: data,
      };
    }
    if (state === 'processing') return { status: 'running', raw: data };
    return { status: 'pending', raw: data };
  }

  /**
   * Convert DB assets to Vidu API asset format.
   * Stages local URLs to OSS if needed (Vidu needs publicly accessible URLs).
   */
  private async buildAssets(
    dbAssets: Array<{
      id: string;
      type: string;
      name: string;
      description: string | null;
      imageUrl: string;
    }>,
  ): Promise<Array<Record<string, unknown>>> {
    const result: Array<Record<string, unknown>> = [];
    let idx = 1;

    for (const asset of dbAssets) {
      let imageUri = asset.imageUrl;

      if (isLocalUrl(imageUri)) {
        const ossReady = await this.ossUpload.isReady();
        if (!ossReady) {
          throw this.toHttpException(
            `Vidu 资产 "${asset.name}" 的图片是本地路径, 但未配置 OSS/TOS。` +
              `Vidu API 需要公网可访问的 URL — 请在 /admin/system → 对象存储配置 bucket`,
            400,
            null,
          );
        }
        const staged = await this.ossUpload.stageLocalToOss(imageUri);
        if (!staged) {
          throw this.toHttpException(
            `OSS staging 失败 (${imageUri})`,
            500,
            null,
          );
        }
        imageUri = staged.publicUrl;
        this.logger.log(
          `[vidu-ad:stage] ${asset.imageUrl} → ${imageUri} (${staged.provider})`,
        );
      }

      const entry: Record<string, unknown> = {
        id: String(idx).padStart(2, '0'),
        type: this.mapAssetType(asset.type),
        name: asset.name,
        image_uri: imageUri,
      };
      if (asset.description) {
        entry.description = asset.description;
      }
      result.push(entry);
      idx++;
    }

    return result;
  }

  /**
   * Map internal asset type to Vidu API type.
   * Vidu accepts both Chinese and English type names for viduq3-ad.
   */
  private mapAssetType(type: string): string {
    switch (type) {
      case 'character':
        return '角色';
      case 'scene':
        return '场景';
      case 'tool':
        return '道具';
      default:
        return type;
    }
  }

  private extractTaskId(data: unknown): string | undefined {
    const d = data as Record<string, unknown> | null;
    if (!d) return undefined;
    // Response can be: { task: { meta: { id } } } or flat { id }
    const taskMeta = (d.task as Record<string, unknown> | undefined)
      ?.meta as Record<string, unknown> | undefined;
    if (taskMeta?.id) return String(taskMeta.id);
    if (d.id) return String(d.id);
    return undefined;
  }

  private extractState(data: unknown): string {
    const d = data as Record<string, unknown> | null;
    if (!d) return 'pending';
    const taskMeta = (d.task as Record<string, unknown> | undefined)
      ?.meta as Record<string, unknown> | undefined;
    if (taskMeta?.state) return String(taskMeta.state).toLowerCase();
    if (d.state) return String(d.state).toLowerCase();
    if (d.status) return String(d.status).toLowerCase();
    return 'pending';
  }

  private extractResources(data: unknown): ProviderResource[] {
    const out: ProviderResource[] = [];
    const d = data as Record<string, unknown> | null;
    if (!d) return out;

    const derivedData = (d.task as Record<string, unknown> | undefined)
      ?.derived_data as Record<string, unknown> | undefined;
    if (!derivedData) return out;

    const finalVideo = derivedData.signed_final_video_url;
    if (typeof finalVideo === 'string' && finalVideo) {
      out.push({ type: 'video', url: finalVideo });
    }

    // Also extract individual shots as additional resources
    const shots = derivedData.shots;
    if (Array.isArray(shots)) {
      for (const shot of shots) {
        const s = shot as Record<string, unknown>;
        if (typeof s.signed_video_url === 'string' && s.signed_video_url) {
          out.push({ type: 'video', url: s.signed_video_url });
        }
      }
    }

    return out;
  }

  private extractUsage(data: unknown): ProviderUsage | undefined {
    const d = data as Record<string, unknown> | null;
    if (!d) return undefined;

    const derivedData = (d.task as Record<string, unknown> | undefined)
      ?.derived_data as Record<string, unknown> | undefined;
    if (!derivedData) return { raw: data };

    // Sum up shot durations as total video duration
    const shots = derivedData.shots;
    let totalDuration = 0;
    if (Array.isArray(shots)) {
      for (const shot of shots) {
        const s = shot as Record<string, unknown>;
        if (typeof s.duration_sec === 'number') {
          totalDuration += s.duration_sec;
        }
      }
    }

    const credits =
      typeof derivedData.credits === 'number'
        ? derivedData.credits
        : typeof (d as any).credits === 'number'
          ? (d as any).credits
          : undefined;

    return {
      videoDurationSec: totalDuration || undefined,
      raw: { credits, totalDuration, shots: Array.isArray(shots) ? shots.length : 0 },
    };
  }

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
    (err as unknown as { message: string }).message = message;
    return err;
  }
}

function isLocalUrl(url: string): boolean {
  if (!url) return false;
  if (url.startsWith('/')) return true;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const host = u.hostname;
    if (host === 'localhost' || host === '127.0.0.1') return true;
    if (host.startsWith('192.168.') || host.startsWith('10.')) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
    return false;
  } catch {
    return true;
  }
}
