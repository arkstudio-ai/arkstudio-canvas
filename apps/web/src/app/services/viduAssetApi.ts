import { apiClient } from '../config/api';

export type ViduAssetType = 'character' | 'scene' | 'tool';

export interface ViduAsset {
  id: string;
  type: ViduAssetType;
  name: string;
  description?: string;
  imageUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateViduAssetInput {
  type: ViduAssetType;
  name: string;
  description?: string;
  imageUrl: string;
}

export interface UpdateViduAssetInput {
  type?: ViduAssetType;
  name?: string;
  description?: string;
  imageUrl?: string;
}

const BASE = '/api/vidu-assets';

export async function listViduAssets(type?: ViduAssetType): Promise<ViduAsset[]> {
  const res = await apiClient.get<ViduAsset[]>(BASE, {
    params: type ? { type } : undefined,
  });
  return res.data;
}

export async function getViduAsset(id: string): Promise<ViduAsset> {
  const res = await apiClient.get<ViduAsset>(`${BASE}/${encodeURIComponent(id)}`);
  return res.data;
}

export async function createViduAsset(input: CreateViduAssetInput): Promise<ViduAsset> {
  const res = await apiClient.post<ViduAsset>(BASE, input);
  return res.data;
}

export async function updateViduAsset(
  id: string,
  input: UpdateViduAssetInput,
): Promise<ViduAsset> {
  const res = await apiClient.patch<ViduAsset>(
    `${BASE}/${encodeURIComponent(id)}`,
    input,
  );
  return res.data;
}

export async function deleteViduAsset(id: string): Promise<void> {
  await apiClient.delete(`${BASE}/${encodeURIComponent(id)}`);
}
