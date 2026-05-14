import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

/**
 * Single source of truth for a FlowNode's runtime state — both its
 * "media payload" (data) and its "model invocation knobs" (params).
 *
 * 设计动机（Phase 8 双轨清理）：
 *   - 老架构是 `FlowNode → FlowNodeData → data Json` + `FlowNode → FlowNodeParams → params Json`
 *     两张关联表，每张表配一个独立 service。两个 service 几乎逐方法对照，
 *     合计 ~370 行重复代码；version 字段从未被任何乐观锁路径消费。
 *   - 现在合到 `FlowNode.data Json?` / `FlowNode.params Json?` 两列。
 *     读节点不再 join，写节点不再 upsert 关联表，service 只剩一份。
 *
 * 返回形状：刻意只返回 `{ nodeId, data }` / `{ nodeId, params }`。
 *   - 前端唯二消费的字段就是这俩；id / flowId / version / 时间戳都没人用。
 *   - 留太多字段反而让"哪些是契约"模糊；删干净，下次接手的人知道这就是契约。
 */
@Injectable()
export class FlowNodeStateService {
  constructor(private prisma: PrismaService) {}

  // ========== Data ==========

  async getNodeData(
    flowId: string,
    nodeId: string,
  ): Promise<{ nodeId: string; data: any } | null> {
    const flowNode = await this.prisma.flowNode.findUnique({
      where: { flowId_nodeId: { flowId, nodeId } },
      select: { nodeId: true, data: true },
    });
    if (!flowNode || flowNode.data === null) return null;
    return { nodeId: flowNode.nodeId, data: flowNode.data };
  }

  async getFlowNodesData(
    flowId: string,
  ): Promise<Array<{ nodeId: string; data: any }>> {
    const flowNodes = await this.prisma.flowNode.findMany({
      where: { flowId },
      select: { nodeId: true, data: true },
    });
    return flowNodes
      .filter((n) => n.data !== null)
      .map((n) => ({ nodeId: n.nodeId, data: n.data }));
  }

  async getGroupNodesData(
    flowId: string,
    groupId: string,
  ): Promise<Array<{ nodeId: string; data: any }>> {
    const flowNodes = await this.prisma.flowNode.findMany({
      where: { flowId, groupId },
      select: { nodeId: true, data: true },
    });
    return flowNodes
      .filter((n) => n.data !== null)
      .map((n) => ({ nodeId: n.nodeId, data: n.data }));
  }

  /**
   * Merge=true 时浅合并新字段到现有 data；merge=false 时整表覆盖。
   * 不动 Flow.version——这是节点级状态，不应触发画布版本号。
   */
  async updateNodeData(
    flowId: string,
    nodeId: string,
    data: any,
    merge: boolean = true,
  ): Promise<void> {
    const flowNode = await this.prisma.flowNode.findUnique({
      where: { flowId_nodeId: { flowId, nodeId } },
      select: { id: true, data: true },
    });
    if (!flowNode) {
      throw new Error(`FlowNode not found: flowId=${flowId}, nodeId=${nodeId}`);
    }

    let finalData = data;
    if (
      merge &&
      flowNode.data &&
      typeof flowNode.data === 'object' &&
      !Array.isArray(flowNode.data)
    ) {
      finalData = { ...(flowNode.data as Record<string, any>), ...data };
    }

    await this.prisma.flowNode.update({
      where: { id: flowNode.id },
      data: { data: finalData as Prisma.InputJsonValue },
    });
  }

  // ========== Params ==========

  async getNodeParams(
    flowId: string,
    nodeId: string,
  ): Promise<{ nodeId: string; params: any } | null> {
    const flowNode = await this.prisma.flowNode.findUnique({
      where: { flowId_nodeId: { flowId, nodeId } },
      select: { nodeId: true, params: true },
    });
    if (!flowNode || flowNode.params === null) return null;
    return { nodeId: flowNode.nodeId, params: flowNode.params };
  }

  async getFlowNodesParams(
    flowId: string,
  ): Promise<Array<{ nodeId: string; params: any }>> {
    const flowNodes = await this.prisma.flowNode.findMany({
      where: { flowId },
      select: { nodeId: true, params: true },
    });
    return flowNodes
      .filter((n) => n.params !== null)
      .map((n) => ({ nodeId: n.nodeId, params: n.params }));
  }

  async getGroupNodesParams(
    flowId: string,
    groupId: string,
  ): Promise<Array<{ nodeId: string; params: any }>> {
    const flowNodes = await this.prisma.flowNode.findMany({
      where: { flowId, groupId },
      select: { nodeId: true, params: true },
    });
    return flowNodes
      .filter((n) => n.params !== null)
      .map((n) => ({ nodeId: n.nodeId, params: n.params }));
  }

  async updateNodeParams(
    flowId: string,
    nodeId: string,
    params: any,
    merge: boolean = true,
  ): Promise<void> {
    const flowNode = await this.prisma.flowNode.findUnique({
      where: { flowId_nodeId: { flowId, nodeId } },
      select: { id: true, params: true },
    });
    if (!flowNode) {
      throw new Error(`FlowNode not found: flowId=${flowId}, nodeId=${nodeId}`);
    }

    let finalParams = params;
    if (
      merge &&
      flowNode.params &&
      typeof flowNode.params === 'object' &&
      !Array.isArray(flowNode.params)
    ) {
      finalParams = { ...(flowNode.params as Record<string, any>), ...params };
    }

    await this.prisma.flowNode.update({
      where: { id: flowNode.id },
      data: { params: finalParams as Prisma.InputJsonValue },
    });
  }
}
