import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import type { FlowNode, FlowEdge } from './types/execution.types';

@Injectable()
export class NodeParserService {
  private readonly logger = new Logger(NodeParserService.name);

  /**
   * 解析执行链路：找到目标节点的所有上游节点（拓扑排序）
   * @param nodes 所有节点
   * @param edges 所有连线
   * @param targetNodeId 目标节点ID
   * @returns 按执行顺序排列的节点链路
   */
  parseExecutionChain(
    nodes: FlowNode[],
    edges: FlowEdge[],
    targetNodeId: string,
    onlyDirectParents: boolean = false,
  ): FlowNode[] {
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const targetNode = nodeMap.get(targetNodeId);

    if (!targetNode) {
      throw new BadRequestException(`Target node ${targetNodeId} not found`);
    }

    // 构建邻接表（反向：target -> sources）
    const incomingMap = new Map<string, string[]>();
    edges.forEach((edge) => {
      if (!incomingMap.has(edge.target)) {
        incomingMap.set(edge.target, []);
      }
      const sources = incomingMap.get(edge.target);
      if (sources) {
        sources.push(edge.source);
      }
    });

    // 如果只需要直接父节点
    if (onlyDirectParents) {
      // 获取直接上游的节点 ID
      const sources = incomingMap.get(targetNodeId) || [];

      // 直接获取节点对象，保持原始顺序
      const parents = sources
        .map((id) => nodeMap.get(id))
        .filter((n): n is FlowNode => n !== undefined);

      // 构造链：[父节点1, 父节点2, ..., 目标节点]
      // 注意：这里简单地将所有父节点放在前面。如果父节点之间有顺序要求，
      // 或者需要更复杂的 prompt 拼接逻辑，这里可能需要调整。
      // 目前的 buildPrompt 是简单的顺序拼接，所以这里只要保证父节点在目标节点前即可。
      const chain = [...parents, targetNode];

      this.logger.log(
        `Parsed direct parent execution chain: ${chain.map((n) => `${n.id}(${n.type})`).join(' -> ')}`,
      );
      return chain;
    }

    // DFS 收集所有上游节点
    const visited = new Set<string>();
    const chain: FlowNode[] = [];

    const dfs = (nodeId: string) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);

      const sources = incomingMap.get(nodeId) || [];
      // 按照添加顺序（边的顺序）处理上游节点
      sources.forEach((sourceId) => {
        dfs(sourceId);
      });

      const node = nodeMap.get(nodeId);
      if (node) {
        chain.push(node);
      }
    };

    dfs(targetNodeId);

    this.logger.log(
      `Parsed execution chain: ${chain.map((n) => `${n.id}(${n.type})`).join(' -> ')}`,
    );

    return chain;
  }

  /**
   * 拼接 prompt：所有上游节点的 text/output + 目标节点的 prompt
   * @param chain 执行链路
   * @returns 拼接后的 prompt
   */
  buildPrompt(chain: FlowNode[]): string {
    const parts: string[] = [];

    chain.forEach((node, index) => {
      const isLastNode = index === chain.length - 1;
      // this.logger.debug(`Processing node ${node.id} for prompt. IsLast: ${isLastNode}, Data: ${JSON.stringify(node.data)}`);

      // 收集上游节点的 text 或 output
      if (!isLastNode) {
        if (node.data.text) {
          parts.push(node.data.text);
        } else if (node.data.output) {
          // 检查 output 是否是 URL。如果是 URL，则不拼接到 prompt 中（除非特定需求，否则图片 URL 不应作为 prompt 文本）
          const output = node.data.output;
          if (
            output &&
            !output.startsWith('http://') &&
            !output.startsWith('https://') &&
            !output.startsWith('data:')
          ) {
            parts.push(output);
          }
        }

        // 如果上游节点输出了图片/视频 URL，则清空之前积累的 prompt context
        // 因为这意味着“意图”已经转化为“媒体”，下游节点应该主要基于这个媒体（作为 init_image/video）以及它自己的 prompt
        if (
          node.data.output &&
          (node.data.output.startsWith('http://') ||
            node.data.output.startsWith('https://') ||
            node.data.output.startsWith('data:'))
        ) {
          // this.logger.debug(`Node ${node.id} output is media URL. Clearing accumulated text prompt context.`);
          parts.length = 0;
        }
      }

      // 最后一个节点使用 prompt
      if (isLastNode && node.data.prompt) {
        parts.push(node.data.prompt);
      }
    });

    const prompt = parts.filter(Boolean).join(';');
    // this.logger.log(`Built prompt: ${prompt}`);
    return prompt;
  }

  /**
   * 提取目标节点的配置参数
   * @param targetNode 目标节点
   * @returns 配置对象
   */
  extractConfig(targetNode: FlowNode): Record<string, any> {
    const { params } = targetNode.data;
    if (!params) {
      return {};
    }

    // 返回所有 params 中的字段
    const config = { ...params };
    this.logger.log(`Extracted config: ${JSON.stringify(config)}`);
    return config;
  }

  /**
   * 验证节点是否有必需的字段
   * @param node 节点
   */
  validateNode(node: FlowNode): void {
    if (!node.data.params?.model) {
      throw new BadRequestException(
        `Node ${node.id} is missing required field: params.model`,
      );
    }
  }

  /**
   * 对一组节点进行拓扑排序（仅考虑组内依赖）
   * @param nodes 待排序的节点列表
   * @param edges 所有连线
   * @returns 排序后的节点列表
   */
  sortNodesTopologically(nodes: FlowNode[], edges: FlowEdge[]): FlowNode[] {
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const nodeIds = new Set(nodes.map((n) => n.id));

    // Build adjacency list for nodes within the group
    const incoming = new Map<string, number>();
    const outgoing = new Map<string, string[]>();

    nodes.forEach((n) => {
      incoming.set(n.id, 0);
      outgoing.set(n.id, []);
    });

    edges.forEach((edge) => {
      if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
        outgoing.get(edge.source)?.push(edge.target);
        incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1);
      }
    });

    // Kahn's Algorithm
    const queue: string[] = [];
    incoming.forEach((count, id) => {
      if (count === 0) queue.push(id);
    });

    const sorted: FlowNode[] = [];
    while (queue.length > 0) {
      const id = queue.shift()!;
      const node = nodeMap.get(id);
      if (node) sorted.push(node);

      const neighbors = outgoing.get(id) || [];
      neighbors.forEach((target) => {
        incoming.set(target, incoming.get(target)! - 1);
        if (incoming.get(target) === 0) {
          queue.push(target);
        }
      });
    }

    // Handle remaining nodes (e.g. in case of cycles or logic errors)
    if (sorted.length < nodes.length) {
      const sortedIds = new Set(sorted.map((n) => n.id));
      const remaining = nodes.filter((n) => !sortedIds.has(n.id));
      sorted.push(...remaining);
    }

    return sorted;
  }
}
