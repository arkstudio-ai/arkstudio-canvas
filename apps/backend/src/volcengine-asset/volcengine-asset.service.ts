import { HttpException, Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { VolcengineConfigService } from '../canvas-config/volcengine-config.service';
import type {
  AssetDto,
  AssetStatus,
  AssetType,
  CreateAssetDto,
  ListAssetsQueryDto,
  ListAssetsResultDto,
} from './dto/asset.dto';

/**
 * Volcengine 火山方舟 asset library client.
 *
 * Endpoints (same base URL as the video API — `VolcengineConfigService.getBaseUrl()`):
 *
 *   POST {base}/open/CreateAsset
 *   POST {base}/open/GetAsset
 *   POST {base}/open/ListAssets
 *   POST {base}/open/DeleteAsset
 *
 * Auth identical to the video API: `Authorization: Bearer ${apiKey}`. Reusing
 * the same VolcengineConfigService means admin only configures one credential
 * pair for the whole vendor (video + asset).
 *
 * Response shape quirks
 * ---------------------
 * Upstream returns PascalCase. Some flavours wrap everything in a `Result`
 * envelope, others return fields at top level. We normalise both inside
 * `unwrap()`. Frontend never sees PascalCase or `Result`.
 *
 * Network errors → HttpException (501 mapped to 503 to avoid the frontend's
 * 401 → re-login path; full message preserved in body for debugging).
 */
@Injectable()
export class VolcengineAssetService {
  private readonly logger = new Logger(VolcengineAssetService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly volcengineConfig: VolcengineConfigService,
  ) {}

  // ============================================================
  // CRUD
  // ============================================================

  async create(input: CreateAssetDto): Promise<AssetDto> {
    this.logger.log(
      `[volc-asset:create] type=${input.assetType} url=${input.url.slice(0, 80)}`,
    );
    const body = {
      URL: input.url,
      AssetType: input.assetType,
      ...(input.name ? { Name: input.name } : {}),
    };
    const raw = await this.post<Record<string, unknown>>(
      '/open/CreateAsset',
      body,
    );
    const r = this.unwrap(raw);
    const id = (r.Id as string) ?? '';
    if (!id) {
      throw new HttpException(
        {
          errorMessage:
            '上游 CreateAsset 没返回 Id —— 可能是审核拒绝或代理异常',
          raw,
        },
        502,
      );
    }
    return this.toAssetDto({
      ...r,
      // CreateAsset 立即返回时上游通常省略 URL/Name；保留我们已知的入参
      Id: id,
      URL: (r.URL as string) ?? input.url,
      Name: (r.Name as string) ?? input.name,
      AssetType: (r.AssetType as string) ?? input.assetType,
      Status: (r.Status as string) ?? 'Processing',
    });
  }

  async get(assetId: string): Promise<AssetDto> {
    const raw = await this.post<Record<string, unknown>>('/open/GetAsset', {
      Id: assetId,
    });
    const r = this.unwrap(raw);
    return this.toAssetDto({ ...r, Id: (r.Id as string) ?? assetId });
  }

  async list(query: ListAssetsQueryDto): Promise<ListAssetsResultDto> {
    const pageNumber = query.pageNumber ?? 1;
    const pageSize = Math.min(query.pageSize ?? 50, 100);
    const filter: Record<string, unknown> = {};
    if (query.status) filter.Statuses = [query.status];
    // 注: 上游目前只过滤 Status / Name；AssetType 没有官方的过滤字段, 我们在客户端再筛一道.
    const body: Record<string, unknown> = {
      PageNumber: pageNumber,
      PageSize: pageSize,
      ...(Object.keys(filter).length > 0 ? { Filter: filter } : {}),
    };
    const raw = await this.post<Record<string, unknown>>(
      '/open/ListAssets',
      body,
    );
    const r = this.unwrap(raw);
    const rawItems = Array.isArray(r.Items) ? r.Items : [];
    const all: AssetDto[] = rawItems.map((it) =>
      this.toAssetDto(it as Record<string, unknown>),
    );
    const items = query.assetType
      ? all.filter((a) => a.assetType === query.assetType)
      : all;
    const total =
      (typeof r.TotalCount === 'number' ? r.TotalCount : items.length) ?? 0;
    return { items, total, pageNumber, pageSize };
  }

  async delete(assetId: string): Promise<void> {
    await this.post('/open/DeleteAsset', { Id: assetId });
    this.logger.log(`[volc-asset:delete] ${assetId}`);
  }

  // ============================================================
  // 便捷方法：批量校验 asset:// 引用是否 Active
  // ============================================================

  /**
   * Throw if any of the given `asset://<id>` URIs is not currently Active.
   * Called by VolcengineVideoProvider as a pre-submit gate so a stale asset
   * doesn't waste a generation cycle.
   *
   * Implementation: parallel GetAsset, then aggregate. We tolerate individual
   * 4xx (treat as "not active" with the upstream message), throwing only when
   * the aggregate result has ≥1 non-Active. Caller catches and rethrows as
   * a 400 with the failing-asset summary.
   */
  async assertActive(uris: string[]): Promise<void> {
    const ids = uris
      .filter((u): u is string => typeof u === 'string' && u.startsWith('asset://'))
      .map((u) => u.slice('asset://'.length).trim())
      .filter(Boolean);
    if (ids.length === 0) return;
    const unique = Array.from(new Set(ids));

    const checks = await Promise.all(
      unique.map(async (id) => {
        try {
          const asset = await this.get(id);
          return { id, status: asset.status, ok: asset.status === 'Active' };
        } catch (err) {
          const ex = err as { message?: string };
          this.logger.warn(
            `[volc-asset:assertActive] GetAsset failed for ${id}: ${ex.message ?? 'unknown'}`,
          );
          return { id, status: `error: ${ex.message ?? 'unknown'}`, ok: false };
        }
      }),
    );
    const failed = checks.filter((c) => !c.ok);
    if (failed.length === 0) return;
    const summary = failed.map((f) => `${f.id}=${f.status}`).join('; ');
    throw new HttpException(
      {
        errorMessage: `VOLCENGINE_ASSET_INVALID: ${failed.length} asset(s) not active: ${summary}`,
        failed,
      },
      400,
    );
  }

  // ============================================================
  // HTTP helpers
  // ============================================================

  private async post<T>(path: string, body: unknown): Promise<T> {
    const baseUrl = await this.volcengineConfig.getBaseUrl();
    const apiKey = await this.volcengineConfig.getApiKey();
    const url = `${baseUrl}${path}`;
    try {
      const resp = await firstValueFrom(
        this.httpService.post<T>(url, body, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 15_000,
          // 火山方舟直连, 跟 volcengine-video provider 一致.
          proxy: false,
        }),
      );
      return resp.data;
    } catch (err) {
      const ex = err as {
        response?: { status?: number; data?: unknown };
        message?: string;
      };
      const status = ex.response?.status ?? 502;
      const data = ex.response?.data as
        | {
            ResponseMetadata?: { Error?: { Message?: string } };
            error?: { message?: string };
            message?: string;
          }
        | string
        | null;
      const message =
        (typeof data === 'object' && data?.ResponseMetadata?.Error?.Message) ||
        (typeof data === 'object' && data?.error?.message) ||
        (typeof data === 'object' && data?.message) ||
        (typeof data === 'string' ? data : null) ||
        ex.message ||
        '代理资产 API 请求失败';
      this.logger.error(
        `[volc-asset] ${path} failed (${status}): ${message}`,
      );
      // 401 映射到 503 避免前端全局登出逻辑被误触发 (跟老 executor 同款)
      throw new HttpException(
        { errorMessage: message, raw: data ?? null },
        status === 401 ? 503 : status,
      );
    }
  }

  /** 兼容直接平铺 / Result 包裹 两种响应结构. */
  private unwrap(raw: Record<string, unknown>): Record<string, unknown> {
    if (raw.Result && typeof raw.Result === 'object') {
      return raw.Result as Record<string, unknown>;
    }
    return raw;
  }

  private toAssetDto(r: Record<string, unknown>): AssetDto {
    const id = (r.Id as string) ?? '';
    const status = (r.Status as AssetStatus) ?? 'Processing';
    const assetType = (r.AssetType as AssetType) ?? 'Image';
    const err = (r.Error as { Message?: string } | undefined)?.Message;
    return {
      id,
      uri: `asset://${id}`,
      name: r.Name as string | undefined,
      assetType,
      status,
      url: r.URL as string | undefined,
      error: err,
      createTime: r.CreateTime as string | undefined,
      updateTime: r.UpdateTime as string | undefined,
    };
  }
}
