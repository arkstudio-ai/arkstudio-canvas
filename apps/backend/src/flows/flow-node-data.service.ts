import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FlowNodeDataService {
  constructor(private prisma: PrismaService) {}

  /**
   * 获取单个节点的数据
   */
  async getNodeData(flowId: string, nodeId: string) {
    // ✅ 新逻辑：先查找 FlowNode，再获取关联的 data
    const flowNode = await this.prisma.flowNode.findUnique({
      where: { 
        flowId_nodeId: { flowId, nodeId } 
      },
      include: { data: true }
    });

    if (!flowNode || !flowNode.data) {
      return null;
    }

    // ✅ 返回格式包含 flowId 和 nodeId
    return {
      id: flowNode.data.id,
      flowId: flowId,
      nodeId: nodeId,
      data: flowNode.data.data,
      version: flowNode.data.version,
      createdAt: flowNode.data.createdAt,
      updatedAt: flowNode.data.updatedAt
    };
  }

  /**
   * 批量获取某个 Flow 的所有节点数据
   */
  async getFlowNodesData(flowId: string) {
    // ✅ 新逻辑：通过 FlowNode 查询
    const flowNodes = await this.prisma.flowNode.findMany({
      where: { flowId },
      include: { data: true }
    });

    // 过滤出有 data 的节点，并格式化返回
    return flowNodes
      .filter(node => node.data)
      .map(node => ({
        id: node.data!.id,
        flowId: flowId,
        nodeId: node.nodeId,
        data: node.data!.data,
        version: node.data!.version,
        createdAt: node.data!.createdAt,
        updatedAt: node.data!.updatedAt
      }));
  }

  /**
   * 批量获取分组内节点的数据
   */
  async getGroupNodesData(flowId: string, groupId: string) {
    const flowNodes = await this.prisma.flowNode.findMany({
      where: { 
        flowId,
        groupId 
      },
      include: { data: true }
    });

    return flowNodes
      .filter(node => node.data)
      .map(node => ({
        id: node.data!.id,
        flowId: flowId,
        nodeId: node.nodeId,
        data: node.data!.data,
        version: node.data!.version,
        createdAt: node.data!.createdAt,
        updatedAt: node.data!.updatedAt
      }));
  }

  /**
   * 更新节点数据（upsert 模式）
   * 支持合并更新：merge=true 时合并字段，merge=false 时覆盖整个对象
   * 注意：不影响 Flow.version，只更新 FlowNodeData.version
   */
  async updateNodeData(flowId: string, nodeId: string, data: any, merge: boolean = true) {
    // ✅ 1. 先查找或创建 FlowNode
    const flowNode = await this.prisma.flowNode.findUnique({
      where: { flowId_nodeId: { flowId, nodeId } }
    });

    if (!flowNode) {
      throw new Error(`FlowNode not found: flowId=${flowId}, nodeId=${nodeId}`);
    }

    // ✅ 2. 如果启用合并模式，先获取现有数据
    let finalData = data;
    if (merge) {
      const existingData = await this.prisma.flowNodeData.findUnique({
        where: { flowNodeId: flowNode.id }
      });
      
      if (existingData && existingData.data && typeof existingData.data === 'object') {
        // 深度合并：新数据覆盖旧数据中的对应字段
        finalData = {
          ...(existingData.data as Record<string, any>),
          ...data
        };
      }
    }

    // ✅ 3. Upsert FlowNodeData
    return this.prisma.flowNodeData.upsert({
      where: { 
        flowNodeId: flowNode.id 
      },
      update: { 
        data: finalData,
        version: { increment: 1 },
        updatedAt: new Date()
      },
      create: {
        flowNodeId: flowNode.id,
        data: finalData,
        version: 1
      }
    });
  }

  /**
   * 批量更新节点数据
   */
  async batchUpdateNodeData(
    flowId: string,
    updates: Array<{ nodeId: string; data: any }>,
    merge: boolean = true
  ) {
    const results: any[] = [];
    for (const update of updates) {
      const result = await this.updateNodeData(flowId, update.nodeId, update.data, merge);
      results.push(result);
    }
    return results;
  }

  /**
   * 删除节点数据（通过 FlowNode 级联删除自动处理）
   */
  async deleteNodeData(flowId: string, nodeId: string) {
    const flowNode = await this.prisma.flowNode.findUnique({
      where: { flowId_nodeId: { flowId, nodeId } }
    });

    if (flowNode) {
      await this.prisma.flowNodeData.deleteMany({
        where: { flowNodeId: flowNode.id }
      });
    }
  }

  /**
   * 批量删除节点数据
   */
  async batchDeleteNodeData(flowId: string, nodeIds: string[]) {
    const flowNodes = await this.prisma.flowNode.findMany({
      where: {
        flowId,
        nodeId: { in: nodeIds }
      }
    });

    const flowNodeIds = flowNodes.map(node => node.id);

    await this.prisma.flowNodeData.deleteMany({
      where: {
        flowNodeId: { in: flowNodeIds }
      }
    });
  }

}

