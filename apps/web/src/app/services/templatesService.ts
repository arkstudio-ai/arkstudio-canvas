/**
 * 工作流模板服务（开源版）。
 *
 * 对应后端 `apps/backend/src/templates/`。
 *
 * 商业版的 flow-groups 在开源后端被改名为 templates，因此前端这里也用
 * "template" 作为统一名称。Tag 走 { category, value } 的形状，跟后端
 * `TagsOnTemplates` 一一对应。
 *
 * 注意：开源版没有用户态，所有人共享同一份模板库。"我的"、"公开"分流、
 * 发布审批、所有者校验全部弃用。
 */
import { apiClient } from '../config/api';

export interface TemplateTag {
  category: string;
  value: string;
  color?: string | null;
}

export interface TemplateAsset {
  id: string;
  name: string;
  description?: string | null;
  cover?: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  tags: TemplateTag[];
}

export interface TemplateQueryParams {
  page: number;
  limit: number;
  keyword?: string;
  tags?: TemplateTag[];
}

export interface TemplateQueryResponse {
  items: TemplateAsset[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface TemplateInstantiateResponse {
  nodes: Array<{
    id: string;
    type: string;
    position: { x: number; y: number };
    width: number;
    height: number;
    groupId?: string;
    data?: Record<string, unknown>;
    params?: Record<string, unknown>;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    sourceHandle?: string;
    targetHandle?: string;
  }>;
  groups: Array<{
    id: string;
    label?: string;
    position?: { x: number; y: number };
    width?: number;
    height?: number;
  }>;
  meta?: Record<string, unknown>;
}

export interface CreateTemplateDto {
  name: string;
  description?: string;
  cover?: string;
  flowId: string;
  json: {
    nodes: any[];
    edges: any[];
    groups?: any[];
    meta?: Record<string, unknown>;
  };
  tags?: TemplateTag[];
}

export interface UpdateTemplateDto {
  name?: string;
  description?: string;
  cover?: string;
  enabled?: boolean;
  addTags?: TemplateTag[];
  removeTags?: TemplateTag[];
}

export interface TemplateTagInfo {
  id: string;
  category: string;
  value: string;
  color?: string | null;
}

export const templatesService = {
  async getTags(category?: string): Promise<TemplateTagInfo[]> {
    const params = category ? { category } : undefined;
    const res = await apiClient.get<TemplateTagInfo[]>('/templates/tags', { params });
    return res.data;
  },

  async query(params: TemplateQueryParams): Promise<TemplateQueryResponse> {
    const res = await apiClient.post<TemplateQueryResponse>('/templates/query', params);
    return res.data;
  },

  async create(dto: CreateTemplateDto): Promise<TemplateAsset> {
    const res = await apiClient.post<TemplateAsset>('/templates', dto);
    return res.data;
  },

  async update(id: string, dto: UpdateTemplateDto): Promise<TemplateAsset> {
    const res = await apiClient.patch<TemplateAsset>(`/templates/${id}`, dto);
    return res.data;
  },

  async remove(id: string): Promise<void> {
    await apiClient.delete(`/templates/${id}`);
  },

  async instantiate(id: string): Promise<TemplateInstantiateResponse> {
    const res = await apiClient.post<TemplateInstantiateResponse>(`/templates/${id}/instantiate`);
    return res.data;
  },
};
