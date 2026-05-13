import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FlowNodeParamsService {
  constructor(private prisma: PrismaService) {}

  /**
   * 获取单个节点的参数配置
   */
  async getNodeParams(flowId: string, nodeId: string) {
    // 先查找 FlowNode
    const flowNode = await this.prisma.flowNode.findUnique({
      where: { 
        flowId_nodeId: { flowId, nodeId } 
      },
      include: { params: true }
    });

    if (!flowNode || !flowNode.params) {
      return null;
    }

    // ✅ 返回格式包含 flowId 和 nodeId
    return {
      id: flowNode.params.id,
      flowId: flowId,
      nodeId: nodeId,
      params: flowNode.params.params,
      version: flowNode.params.version,
      createdAt: flowNode.params.createdAt,
      updatedAt: flowNode.params.updatedAt
    };
  }

  /**
   * 批量获取某个 Flow 的所有节点参数
   */
  async getFlowNodesParams(flowId: string) {
    const flowNodes = await this.prisma.flowNode.findMany({
      where: { flowId },
      include: { params: true }
    });

    // 过滤出有 params 的节点，并格式化返回
    return flowNodes
      .filter(node => node.params)
      .map(node => ({
        id: node.params!.id,
        flowId: flowId,
        nodeId: node.nodeId,
        params: node.params!.params,
        version: node.params!.version,
        createdAt: node.params!.createdAt,
        updatedAt: node.params!.updatedAt
      }));
  }

  /**
   * 批量获取分组内节点的参数
   */
  async getGroupNodesParams(flowId: string, groupId: string) {
    const flowNodes = await this.prisma.flowNode.findMany({
      where: { 
        flowId,
        groupId 
      },
      include: { params: true }
    });

    return flowNodes
      .filter(node => node.params)
      .map(node => ({
        id: node.params!.id,
        flowId: flowId,
        nodeId: node.nodeId,
        params: node.params!.params,
        version: node.params!.version,
        createdAt: node.params!.createdAt,
        updatedAt: node.params!.updatedAt
      }));
  }

  /**
   * 更新节点参数（upsert 模式）
   * 支持合并更新：merge=true 时合并字段，merge=false 时覆盖整个对象
   * 注意：不影响 Flow.version，只更新 FlowNodeParams.version
   */
  async updateNodeParams(flowId: string, nodeId: string, params: any, merge: boolean = true) {
    // 1. 先查找或创建 FlowNode
    const flowNode = await this.prisma.flowNode.findUnique({
      where: { flowId_nodeId: { flowId, nodeId } }
    });

    if (!flowNode) {
      throw new Error(`FlowNode not found: flowId=${flowId}, nodeId=${nodeId}`);
    }

    // 2. 如果启用合并模式，先获取现有参数
    let finalParams = params;
    if (merge) {
      const existingParams = await this.prisma.flowNodeParams.findUnique({
        where: { flowNodeId: flowNode.id }
      });
      
      if (existingParams && existingParams.params && typeof existingParams.params === 'object') {
        // 深度合并：新参数覆盖旧参数中的对应字段
        finalParams = {
          ...(existingParams.params as Record<string, any>),
          ...params
        };
      }
    }

    // 3. Upsert FlowNodeParams
    return this.prisma.flowNodeParams.upsert({
      where: { 
        flowNodeId: flowNode.id 
      },
      update: { 
        params: finalParams,
        version: { increment: 1 },
        updatedAt: new Date()
      },
      create: {
        flowNodeId: flowNode.id,
        params: finalParams,
        version: 1
      }
    });
  }

  /**
   * 批量更新节点参数
   */
  async batchUpdateNodeParams(
    flowId: string,
    updates: Array<{ nodeId: string; params: any }>,
    merge: boolean = true
  ) {
    const results: any[] = [];
    for (const update of updates) {
      const result = await this.updateNodeParams(flowId, update.nodeId, update.params, merge);
      results.push(result);
    }
    return results;
  }

  /**
   * 删除节点参数（通过 FlowNode 级联删除自动处理）
   */
  async deleteNodeParams(flowId: string, nodeId: string) {
    const flowNode = await this.prisma.flowNode.findUnique({
      where: { flowId_nodeId: { flowId, nodeId } }
    });

    if (flowNode) {
      await this.prisma.flowNodeParams.deleteMany({
        where: { flowNodeId: flowNode.id }
      });
    }
  }

  /**
   * 批量删除节点参数
   */
  async batchDeleteNodeParams(flowId: string, nodeIds: string[]) {
    const flowNodes = await this.prisma.flowNode.findMany({
      where: {
        flowId,
        nodeId: { in: nodeIds }
      }
    });

    const flowNodeIds = flowNodes.map(node => node.id);

    await this.prisma.flowNodeParams.deleteMany({
      where: {
        flowNodeId: { in: flowNodeIds }
      }
    });
  }
}

