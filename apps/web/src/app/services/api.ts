import axios from 'axios';
import { CanvasFlowValue } from '@canvas-flow/core';
import { apiClient } from '../config/api';

// 后端返回的 Flow 数据结构
export interface FlowDto {
  id: string;
  name: string;
  description?: string;
  structureJson: CanvasFlowValue;
  status: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFlowDto {
  name: string;
  description?: string;
  initialGraph?: CanvasFlowValue;
}

// 创建 Flow Group 资产的请求接口（保存工作流模版用）
export interface CreateFlowGroupDto {
  name: string;
  description: string;
  userId: string;
  flowId: string;
  isPublic?: boolean;
  cover?: string;
  demo?: string;
  tags: Array<{ category: string; value: string }>;
  json: {
    groups: any[];
    nodes: any[];
    edges: any[];
    meta?: any;
  };
}

export interface ExecutionResult {
  id: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'COMPLETED';
  outputData?: any;
  resources?: Array<{ url: string; [key: string]: any }>;
  errorMsg?: string;
}

interface UploadSignResponse {
  uploadUrl: string;
  fileKey: string;
  accessUrl: string;
  expires: number;
  method: 'PUT';
}

/**
 * 前端 ↔ backend 的 HTTP 接口表。
 *
 * 开源版没有 mock 模式：所有方法都直接打到后端。商业版历史里曾有
 * `VITE_ENABLE_BACKEND_SYNC` + `mockService.ts` 的双轨实现，已在收尾
 * 时整体移除（后端 API 跑得起来时 mock 没有任何价值，反而是 1300 行死代码）。
 */
export const api = {
  /**
   * 上传文件（COS 预签名直传）
   *
   * 流程：
   * 1. POST /upload/sign 获取预签名 URL
   * 2. PUT 直传文件到 COS
   * 3. 返回永久访问地址 accessUrl
   */
  uploadFile: async (file: File): Promise<string> => {
    const signRes = await apiClient.post<UploadSignResponse>('/upload/sign', {
      fileName: file.name,
      fileType: file.type || 'application/octet-stream',
      fileSize: file.size,
    });
    const { uploadUrl, accessUrl } = signRes.data;

    await axios.put(uploadUrl, file, {
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
    });

    return accessUrl;
  },

  /** 更新节点业务数据（直接更新 FlowNodeData，不影响 Flow.version） */
  updateNodeData: async (flowId: string, nodeId: string, data: any) => {
    const res = await apiClient.patch(`/flows/${flowId}/nodes/${nodeId}/data`, { data });
    return res.data;
  },

  /** 更新节点业务配置（params, prompt 等） */
  updateNodeParams: async (flowId: string, nodeId: string, params: any) => {
    const res = await apiClient.patch(`/flows/${flowId}/nodes/${nodeId}/params`, params);
    return res.data;
  },

  /** 获取执行状态（轮询用） */
  getExecutionStatus: async (
    executionId: string,
  ): Promise<{
    id: string;
    status: string;
    errorMsg?: string;
    createdAt: string;
    finishedAt?: string;
  }> => {
    const res = await apiClient.get(`/executions/${executionId}/status`);
    return res.data;
  },

  /**
   * 列出某个 Flow 下匹配指定状态的执行记录。
   *
   * 主要用途：刷新页面后恢复"进行中"任务的 loading 状态 + 续轮询。
   * 后端在 `GET /executions` 里专门留了 `status=PENDING,RUNNING` 这个组合
   * 给我们用 (executions.controller.ts 注释里有写)。
   */
  listFlowExecutions: async (
    flowId: string,
    status?: string,
  ): Promise<Array<{ id: string; nodeId: string; status: string }>> => {
    const params = new URLSearchParams();
    params.set('canvasId', flowId);
    if (status) params.set('status', status);
    // 一页 100 条够覆盖任何"刚刷新画布上还在跑的任务数"，再多就是
    // 历史日志，不是恢复目标。
    params.set('limit', '100');

    const res = await apiClient.get(`/executions?${params.toString()}`);
    const items = Array.isArray(res.data?.items) ? res.data.items : [];
    return items
      .filter((row: any) => row?.id && row?.nodeId)
      .map((row: any) => ({
        id: row.id,
        nodeId: row.nodeId,
        status: row.status,
      }));
  },

  createFlow: async (data: CreateFlowDto): Promise<FlowDto> => {
    const res = await apiClient.post<FlowDto>('/flows', data);
    return res.data;
  },

  createFlowGroup: async (data: CreateFlowGroupDto): Promise<any> => {
    const res = await apiClient.post('/flow-groups', data);
    return res.data;
  },

  getFlow: async (id: string): Promise<FlowDto> => {
    const res = await apiClient.get<FlowDto>(`/flows/${id}`);
    return res.data;
  },

  /**
   * 发送操作指令（增量更新）
   * 失败时根据 HTTP 409 抛 'Version mismatch'，调用方据此触发 reload。
   */
  applyOperations: async (flowId: string, version: number, operations: any[]) => {
    try {
      const res = await apiClient.post(`/flows/${flowId}/operations`, {
        version,
        operations, // 格式: [{ op: 'NODE_ADD', data: {...} }]
      });
      return res.data;
    } catch (error: any) {
      if (error.response && error.response.status === 409) {
        throw new Error('Version mismatch');
      }
      throw new Error('Failed to apply operations');
    }
  },

  /** 批量获取 Flow 的所有节点数据 */
  getFlowNodesData: async (flowId: string) => {
    const res = await apiClient.get(`/flows/${flowId}/nodes/data`);
    return res.data;
  },

  /** 批量获取 Flow 的所有节点配置（params, prompt） */
  getFlowNodesParams: async (flowId: string) => {
    const res = await apiClient.get(`/flows/${flowId}/nodes/params`);
    return res.data;
  },

  /** 批量获取分组内节点数据 */
  getGroupNodesData: async (flowId: string, groupId: string) => {
    const res = await apiClient.get(`/flows/${flowId}/groups/${groupId}/nodes/data`);
    return res.data;
  },

  /**
   * 执行画布流程
   *
   * @returns { success: true, data: [...] } 任务数组: [{ executionId, nodeId, status }, ...]
   */
  executeFlow: async (
    canvasId: string,
    targetNodeId?: string,
    groupId?: string,
    userId: string = 'anonymous',
    mode: 'async' | 'sync' = 'async',
  ) => {
    const url = mode === 'sync' ? '/executions/execute?mode=sync' : '/executions/execute';
    const res = await apiClient.post(url, {
      canvasId,
      userId,
      targetNodeId,
      groupId,
    });

    // 响应拦截器已剥过 envelope；为了与历史调用方契约一致再包一层
    return {
      success: true,
      data: res.data,
    };
  },

  // Operation Helpers
  ops: {
    addNode: async (flowId: string, version: number, node: any) => {
      return api.applyOperations(flowId, version, [{ op: 'NODE_ADD', data: node }]);
    },
    deleteNode: async (flowId: string, version: number, nodeId: string) => {
      return api.applyOperations(flowId, version, [{ op: 'NODE_REMOVE', data: { id: nodeId } }]);
    },
    moveNode: async (flowId: string, version: number, nodeId: string, position: { x: number; y: number }) => {
      return api.applyOperations(flowId, version, [{ op: 'NODE_MOVE', data: { id: nodeId, position } }]);
    },
    updateNode: async (flowId: string, version: number, nodeId: string, data: any) => {
      return api.applyOperations(flowId, version, [{ op: 'NODE_UPDATE', data: { id: nodeId, ...data } }]);
    },
    addEdge: async (flowId: string, version: number, edge: any) => {
      return api.applyOperations(flowId, version, [{ op: 'EDGE_ADD', data: edge }]);
    },
    deleteEdge: async (flowId: string, version: number, edgeId: string) => {
      return api.applyOperations(flowId, version, [{ op: 'EDGE_REMOVE', data: { id: edgeId } }]);
    },
    addGroup: async (flowId: string, version: number, group: any, nodeIds?: string[], nodes?: any[]) => {
      return api.applyOperations(flowId, version, [{ op: 'GROUP_ADD', data: { ...group, nodeIds, nodes } }]);
    },
    deleteGroup: async (flowId: string, version: number, groupId: string) => {
      return api.applyOperations(flowId, version, [{ op: 'GROUP_REMOVE', data: { id: groupId } }]);
    },
    updateGroup: async (flowId: string, version: number, groupId: string, data: any) => {
      return api.applyOperations(flowId, version, [{ op: 'GROUP_UPDATE', data: { id: groupId, ...data } }]);
    },
  },
};
