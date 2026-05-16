import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Asset type — matches the Volcengine `AssetType` enum. Constrained so a
 * typo from frontend gets caught by class-validator before hitting upstream.
 */
export type AssetType = 'Image' | 'Video' | 'Audio';
export const ASSET_TYPES: AssetType[] = ['Image', 'Video', 'Audio'];

/**
 * Asset status — mirrors the upstream `Status` field.
 *   - Processing: upstream still preprocessing (审核 + 编码 + 入库). Cannot
 *                 be used for video generation yet.
 *   - Active:     ready. The frontend should pin its UI on this state.
 *   - Failed:     upstream rejected (审核未通过 / 文件不合规). Error message
 *                 in the response body.
 */
export type AssetStatus = 'Processing' | 'Active' | 'Failed';
export const ASSET_STATUSES: AssetStatus[] = ['Processing', 'Active', 'Failed'];

export class CreateAssetDto {
  /**
   * Public-internet-reachable URL. Volcengine 代理 (or the official Files
   * API) downloads from this URL — it must be reachable from their servers.
   * Local backend URLs like `http://127.0.0.1:18500/static/uploads/…` will
   * NOT work for desktop deployments; user must paste a public URL (or use
   * a future cloud-storage integration that uploads on their behalf).
   */
  @IsString()
  url!: string;

  @IsString()
  @IsIn(ASSET_TYPES)
  assetType!: AssetType;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  name?: string;
}

export class ListAssetsQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  pageNumber?: number;

  /** Capped at 100 server-side per upstream. */
  @IsOptional()
  @IsInt()
  @Min(1)
  pageSize?: number;

  @IsOptional()
  @IsString()
  @IsIn(ASSET_STATUSES)
  status?: AssetStatus;

  @IsOptional()
  @IsString()
  @IsIn(ASSET_TYPES)
  assetType?: AssetType;
}

/**
 * Normalised asset shape returned by Canvas Flow's controller — already
 * unwrapped from Volcengine's PascalCase + `Result` envelope quirks.
 * Frontend keys stay camelCase per repo convention.
 */
export interface AssetDto {
  /** Volcengine asset id (e.g. `asset-2026...xyz`). */
  id: string;
  /** Canvas Flow's preferred handle: `asset://<id>`. Send this back to the
   *  video provider as the `url` field of an image/video/audio input. */
  uri: string;
  name?: string;
  assetType: AssetType;
  status: AssetStatus;
  /** Original public URL the user supplied. Frontend uses this for the
   *  thumbnail card when the asset is still Processing (no upstream
   *  thumbnail yet) and for "view source" navigation. */
  url?: string;
  /** Upstream error.message when status === 'Failed'. */
  error?: string;
  createTime?: string;
  updateTime?: string;
}

export interface ListAssetsResultDto {
  items: AssetDto[];
  total: number;
  pageNumber: number;
  pageSize: number;
}
