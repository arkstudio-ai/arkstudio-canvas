/**
 * 画布服务
 * 封装画布列表查询、更新、删除等 API
 */

import { apiClient } from '../config/api';

/** 画布列表项 */
export interface CanvasItem {
  id: string;
  name: string;
  description?: string | null;
  cover?: string | null;
  demo?: string | null;
  status: string;
  version: number;
  mobile: boolean;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

/** 查询参数 */
export interface CanvasQueryParams {
  page: number;
  limit: number;
  keyword?: string;
  sortBy?: 'createdAt' | 'updatedAt' | 'name';
  sortOrder?: 'asc' | 'desc';
}

/** 查询响应 */
export interface CanvasQueryResponse {
  items: CanvasItem[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

/** 更新画布参数 */
export interface UpdateCanvasDto {
  name?: string;
  description?: string;
  cover?: string;
  demo?: string;
  status?: string;
}

/** 创建画布参数 */
export interface CreateCanvasDto {
  name?: string;
  description?: string;
}

export const canvasService = {
  /**
   * 查询画布列表
   */
  async queryCanvases(params: CanvasQueryParams): Promise<CanvasQueryResponse> {
    const res = await apiClient.post<CanvasQueryResponse>('/flows/query', params);
    return res.data;
  },

  /**
   * 创建空白画布。Workspace 页的"新建画布"按钮会调用，跳到 /canvas
   * 之前先生成 id，避免依赖编辑器空进入时的 auto-create 副作用。
   */
  async createCanvas(data: CreateCanvasDto = {}): Promise<CanvasItem> {
    const body = {
      name: data.name ?? `Flow ${new Date().toLocaleString()}`,
      description: data.description ?? 'Created from Workspace',
      initialGraph: { nodes: [], edges: [], groups: [] },
    };
    const res = await apiClient.post<CanvasItem>('/flows', body);
    return res.data;
  },

  /**
   * 更新画布
   */
  async updateCanvas(id: string, data: UpdateCanvasDto): Promise<CanvasItem> {
    const res = await apiClient.patch<CanvasItem>(`/flows/${id}`, data);
    return res.data;
  },

  /**
   * 删除画布
   */
  async deleteCanvas(id: string): Promise<void> {
    await apiClient.delete(`/flows/${id}`);
  },
};



































