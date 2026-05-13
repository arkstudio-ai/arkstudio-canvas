/**
 * 生成历史服务（开源版）。
 *
 * 对应后端 `apps/backend/src/generation-history/`（待实现）。
 *
 * 用户希望在编辑器侧边面板里看到"图片/视频/语音/文本"四类生成结果，
 * 选中一条可以重新拖回画布做二次创作。开源版无用户态，所有历史都按
 * 节点类型/关键字共享。
 */
import { apiClient } from '../config/api';

export type HistoryNodeType = 'image' | 'video' | 'text' | 'audio';

export interface HistoryListItem {
  id: string;
  nodeType: HistoryNodeType;
  thumbnail: string | null;
  promptText: string | null;
  modelName: string | null;
  createdAt: string;
  width: number;
  height: number;
}

export interface QueryHistoryParams {
  nodeType?: HistoryNodeType;
  keyword?: string;
  page?: number;
  limit?: number;
}

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface HistoryListResponse {
  items: HistoryListItem[];
  meta: PaginationMeta;
}

export interface InstantiatedNode {
  id: string;
  type: HistoryNodeType;
  position: { x: number; y: number };
  width: number;
  height: number;
  data: Record<string, unknown>;
  params: Record<string, unknown>;
  meta: {
    sourceHistoryId: string;
    createdAt: string;
  };
}

class GenerationHistoryService {
  private readonly basePath = '/generation-history';

  async query(params: QueryHistoryParams = {}): Promise<HistoryListResponse> {
    const query: Record<string, string> = {};
    if (params.nodeType) query.nodeType = params.nodeType;
    if (params.keyword) query.keyword = params.keyword;
    if (params.page) query.page = String(params.page);
    if (params.limit) query.limit = String(params.limit);

    const res = await apiClient.get<HistoryListResponse>(this.basePath, { params: query });
    return res.data;
  }

  async instantiate(historyId: string): Promise<InstantiatedNode> {
    const res = await apiClient.get<InstantiatedNode>(`${this.basePath}/${historyId}/instantiate`);
    return res.data;
  }

  async remove(historyId: string): Promise<void> {
    await apiClient.delete(`${this.basePath}/${historyId}`);
  }
}

export const generationHistoryService = new GenerationHistoryService();
