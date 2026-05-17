/**
 * Volcengine 素材库 REST client.
 *
 * Lives under `apps/web/src/app/services/` rather than
 * `apps/web/src/app/pages/admin/api/` because the asset library is a
 * user-facing canvas feature, not an admin config knob — the panel can
 * be opened from anywhere in the editor chrome.
 *
 * Wraps the backend's `/api/volcengine/assets` endpoints. Network errors
 * surface as Error objects; status payload (`Processing` / `Active` /
 * `Failed`) is part of the response model — callers poll for transitions.
 */

import { apiClient } from '../config/api';

export type AssetType = 'Image' | 'Video' | 'Audio';
export type AssetStatus = 'Processing' | 'Active' | 'Failed';

export interface Asset {
  id: string;
  /** `asset://<id>` — paste this into a node's data.src to use as a reference. */
  uri: string;
  name?: string;
  assetType: AssetType;
  status: AssetStatus;
  /** Original public URL the asset was created from. */
  url?: string;
  /** Upstream error.message when status === 'Failed'. */
  error?: string;
  createTime?: string;
  updateTime?: string;
}

export interface ListAssetsParams {
  pageNumber?: number;
  pageSize?: number;
  assetType?: AssetType;
  status?: AssetStatus;
}

export interface ListAssetsResult {
  items: Asset[];
  total: number;
  pageNumber: number;
  pageSize: number;
}

export interface CreateAssetInput {
  /**
   * Volcengine 服务端会 server-side fetch 这个 URL. 公网 URL 直接传;
   * 本地 `/static/uploads/<key>` URL 也能传 — backend 在 CreateAsset
   * 前会自动 stage 到 admin 配的 OSS / TOS, 再用得到的公网 URL 上报.
   * 没配 OSS 又传本地 URL → backend 400 + 中文报错让用户去 /admin/system.
   */
  url: string;
  assetType: AssetType;
  name?: string;
}

/**
 * Cheap probe — does this deployment have an OSS / TOS bucket
 * configured? Used by AddAssetForm to decide whether to expose the
 * "本地上传" radio option. Reads the public oss-settings endpoint
 * (same one /admin/system uses); we only care about the `ready` flag.
 */
export async function getOssReady(): Promise<boolean> {
  try {
    const res = await apiClient.get<{
      success: boolean;
      data: { ready: boolean };
    }>('/api/canvas-flow/oss-settings');
    return Boolean(res.data?.data?.ready);
  } catch {
    return false;
  }
}

const BASE = '/api/volcengine/assets';

export async function listAssets(
  params: ListAssetsParams = {},
): Promise<ListAssetsResult> {
  const res = await apiClient.get<ListAssetsResult>(BASE, { params });
  return res.data;
}

export async function getAsset(id: string): Promise<Asset> {
  const res = await apiClient.get<Asset>(`${BASE}/${encodeURIComponent(id)}`);
  return res.data;
}

export async function createAsset(input: CreateAssetInput): Promise<Asset> {
  const res = await apiClient.post<Asset>(BASE, input);
  return res.data;
}

export async function deleteAsset(id: string): Promise<void> {
  await apiClient.delete<{ success: boolean }>(
    `${BASE}/${encodeURIComponent(id)}`,
  );
}
