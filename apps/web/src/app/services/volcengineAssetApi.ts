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
  /** Public-internet-reachable URL. Local backend URLs WON'T work — Volcengine
   *  servers need to fetch the file. */
  url: string;
  assetType: AssetType;
  name?: string;
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
